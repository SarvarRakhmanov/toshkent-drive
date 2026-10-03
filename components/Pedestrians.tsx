"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@/lib/safeFrame";
import * as THREE from "three";
import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";
import { SHORE_X } from "@/lib/marina";
import { NPC_ROBOTS, useNpcRobots } from "@/components/RobotModels";
import { AIRPORT_CHUNKS } from "@/components/City";
import { requestPedestrianHitSlowdown } from "@/lib/pedestrianHit";

// Real port of the original's pedestrian system (index.html ~line 6148-6182,
// 7591-7632): 44 civilians + 7 cops, each walking a 72m square loop around a
// "block" (matches components/City.tsx's CELL — must stay in sync with it),
// rehomed to a block near the player when they drift too far away or off the
// edge of the walkable land, and panicking (faster, higher-frequency stride)
// when the player drives past close and fast. Also ports the original's
// ragdoll-on-hit reaction (index.html ~7333-7357 hit test, ~7591-7610
// ragdoll update): get hit by a car/bike at real speed and the ped goes
// flying, tumbles, bounces off the tarmac, then gets up and rejoins traffic.
const CELL = 100; // must match components/City.tsx's CELL

const HALF_SIDE = 36; // original's `hs` — half the walking loop's square side
const SIDE = HALF_SIDE * 2;
const LOOP_LEN = SIDE * 4; // 288, matches the original's literal `per`

// v1.4: pedestrians are robots (components/RobotModels.tsx) drawn as one
// InstancedMesh per robot type / LOD / material — ~22 draw calls for all of
// them instead of ~15 per box person. Full detail (~5k tris) inside NEAR_DIST,
// a ~1.6-2.8k LOD out to FAR_DIST, nothing beyond (they're specks by then).
const NEAR_DIST2 = 32 * 32;
const FAR_DIST2 = 150 * 150;
const OFFICER_ROBOT = NPC_ROBOTS.findIndex((r) => r.id === "checkered-guard");
const CIVILIAN_ROBOTS = NPC_ROBOTS.map((_, i) => i).filter((i) => i !== OFFICER_ROBOT);

const CIVILIAN_COUNT = 44;
const OFFICER_COUNT = 7;
const REHOME_DIST2 = 220 * 220; // original's exact rehome-distance threshold
const FLEE_RADIUS2 = 8 * 8; // original's exact "car is close" radius
const FLEE_SPEED_MS = 8; // original's exact "car is fast" threshold (m/s)
const HIT_SPEED_MS = 2.5; // original's exact minimum speed to register a hit
const HIT_RADIUS2 = 8 * 8; // original's cheap far-reject before the oriented-box test
// every player-drivable land vehicle — was missing jeep/bus/truck/policeJeep
// entirely, so running a pedestrian over in one of those silently no-opped
const LAND_VEHICLES = new Set(["car", "bike", "policeCar", "jeep", "bus", "truck", "policeJeep"]);

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(7);

interface PedSpec {
  robot: number;
  officer: boolean;
  dir: 1 | -1;
  baseSpeed: number;
  ci: number;
  cj: number;
  s: number;
}

interface Ragdoll {
  vx: number;
  vy: number;
  vz: number;
  y: number;
  t: number;
  spin: number;
  air: boolean;
}

// Initial blocks are picked in ci -3..0 (clamped west of SHORE_X, same as
// rehoming below) so nobody spawns mid-ocean before the first rehome check.
// Neither the initial spawn range nor the rehome pick below know about
// INTERNATIONAL AIRPORT's footprint (components/City.tsx's AIRPORT_CHUNKS) —
// the airport's one gate is sealed to vehicles only (components/Airport.tsx's
// PerimeterFence, a VEHICLE_ONLY collider), so an ordinary walking civilian
// isn't stopped by it the way a car is. Reroll off any airport chunk so the
// field's only foot traffic is the maintenance crew Airport.tsx places itself.
// FORT NEON (lib/militaryBase.ts) needs no equivalent entry here — it sits
// entirely past SHORE_CI on its own platform over open water, nowhere this
// function's ci/cj range (real city land chunks) ever reaches.
function pickCityBlock(nextCi: () => number, nextCj: () => number): [number, number] {
  for (let i = 0; i < 8; i++) {
    const ci = nextCi();
    const cj = nextCj();
    if (!AIRPORT_CHUNKS.has(`${ci},${cj}`)) return [ci, cj];
  }
  return [nextCi(), nextCj()];
}

function makeSpec(officer: boolean): PedSpec {
  const [ci, cj] = pickCityBlock(
    () => -Math.floor(rand() * 4),
    () => Math.floor(rand() * 7) - 3
  );
  return {
    robot: officer ? OFFICER_ROBOT : CIVILIAN_ROBOTS[(rand() * CIVILIAN_ROBOTS.length) | 0],
    officer,
    dir: rand() < 0.5 ? 1 : -1,
    baseSpeed: officer ? 1.2 + rand() * 0.8 : 1.3 + rand() * 1.3,
    ci,
    cj,
    s: rand() * LOOP_LEN,
  };
}

const PED_SPECS: PedSpec[] = [
  ...Array.from({ length: CIVILIAN_COUNT }, () => makeSpec(false)),
  ...Array.from({ length: OFFICER_COUNT }, () => makeSpec(true)),
];

// Live world position per pedestrian — same shared-mutable-singleton pattern
// as vehicleState/trafficPositions. Read by components/Traffic.tsx's
// laneBlocked() so AI traffic actually brakes for someone standing in the
// road instead of clipping straight through them (that hit-test above only
// ever covered the PLAYER's own driven vehicle, never scripted lane cars).
export const pedestrianPositions: { x: number; z: number; h: number; robot: number }[] = PED_SPECS.map((p) => ({ x: 0, z: 0, h: 0, robot: p.robot }));

// Walks the 72m perimeter of a block centred at (cx,cz) — ported verbatim
// from the original's pedPos(): four straight sides, s wraps mod 288.
function pedPos(cx: number, cz: number, s: number): [number, number, number, number] {
  s = ((s % LOOP_LEN) + LOOP_LEN) % LOOP_LEN;
  const i = Math.floor(s / SIDE);
  const u = s % SIDE;
  if (i === 0) return [cx - HALF_SIDE + u, cz - HALF_SIDE, 1, 0];
  if (i === 1) return [cx + HALF_SIDE, cz - HALF_SIDE + u, 0, 1];
  if (i === 2) return [cx + HALF_SIDE - u, cz + HALF_SIDE, -1, 0];
  return [cx - HALF_SIDE, cz + HALF_SIDE - u, 0, -1];
}

interface PedState {
  cx: number;
  cz: number;
  s: number;
  dir: 1 | -1;
  flee: number;
  rag: Ragdoll | null;
  bob: number;
  sway: number;
}

// Same per-pedestrian logic as before the robot swap (walk loop, flee,
// rehome, car hit + ragdoll) — `g` is now a bare transform holder that the
// instancer below copies into InstancedMesh matrices.
function stepPed(g: THREE.Object3D, spec: PedSpec, ps: PedState, index: number, t: number, dt: number) {
    const d = Math.min(dt, 0.05);
    ps.bob = 0;
    ps.sway = 0;
    // one-frame-stale is fine for a coarse "is anyone standing here" obstacle
    // check — written before this frame's own movement below
    pedestrianPositions[index].x = g.position.x;
    pedestrianPositions[index].z = g.position.z;
    pedestrianPositions[index].h = g.rotation.y;

    // ----- ragdoll: tumble, bounce off the tarmac, settle, then rejoin -----
    if (ps.rag) {
      const r = ps.rag;
      r.t += d;
      r.vy -= 22 * d;
      r.y += r.vy * d;
      g.position.x += r.vx * d;
      g.position.z += r.vz * d;
      if (r.y <= 0.13) {
        r.y = 0.13;
        if (r.vy < -3) {
          r.vy *= -0.32; // bounce off the tarmac
        } else {
          if (r.air) {
            r.air = false;
            g.rotation.x = -Math.PI / 2; // lying flat
          }
          r.vy = 0;
        }
        r.vx *= Math.pow(0.03, d);
        r.vz *= Math.pow(0.03, d);
      }
      g.position.y = r.y;
      if (r.air) g.rotation.x += r.spin * d; // tumble through the air
      if (r.t > 4.5 && !r.air && Math.abs(r.vx) + Math.abs(r.vz) < 0.4) {
        // dust off and walk away
        ps.rag = null;
        g.rotation.x = 0;
        g.position.y = 0;
        ps.cx = Math.round(g.position.x / CELL) * CELL;
        ps.cz = Math.round(g.position.z / CELL) * CELL;
        ps.s = Math.random() * LOOP_LEN;
        ps.flee = 0;
      }
      return;
    }

    // ----- hit test against the active land vehicle, oriented box, extended
    // forward by this frame's travel so a fast car can't tunnel through -----
    const hud = useHudStore.getState();
    const speedMs = hud.speedKmh / 3.6;
    if (LAND_VEHICLES.has(hud.active) && speedMs > HIT_SPEED_MS) {
      const hdx = g.position.x - worldState.px;
      const hdz = g.position.z - worldState.pz;
      if (hdx * hdx + hdz * hdz <= HIT_RADIUS2) {
        const sh = Math.sin(worldState.heading);
        const ch = Math.cos(worldState.heading);
        const isBike = hud.active === "bike";
        const sweep = speedMs * d;
        const halfLen = (isBike ? 1.3 : 2.7) + sweep + 0.35;
        const halfWid = (isBike ? 0.7 : 1.25) + 0.35;
        const fwd = hdx * sh + hdz * ch;
        const lat = hdx * ch - hdz * sh;
        if (Math.abs(fwd) <= halfLen && Math.abs(lat) <= halfWid) {
          const fast = speedMs > 16;
          const side = lat >= 0 ? 1 : -1; // shove them off to the struck side
          // original multiplies by Math.sign(v.speed) here to fling peds backward
          // when reversing into them; hudStore.speedKmh is unsigned (the HUD only
          // ever shows magnitude), so that distinction is dropped — reversing into
          // a ped still ragdolls them, just always shoved "forward" relative to
          // heading rather than behind the car
          ps.rag = {
            vx: sh * speedMs * 0.6 + ch * side * (1.5 + speedMs * 0.05),
            vz: ch * speedMs * 0.6 - sh * side * (1.5 + speedMs * 0.05),
            vy: fast ? 4.5 + speedMs * 0.28 : 2.0,
            y: 0.9,
            t: 0,
            spin: (Math.random() * 2 - 1) * (fast ? 12 : 4),
            air: true,
          };
          // ported from the original's tick(): the car itself loses 10% speed
          // in the same beat the ragdoll fires — the collision costs the
          // driver something too, not just the pedestrian (lib/pedestrianHit.ts)
          requestPedestrianHitSlowdown();
          return;
        }
      }
    }

    // ----- normal walk: rehome if too far / off the map, flee if a car
    // just blew past close and fast, otherwise loop the block sidewalk -----
    const fdx = g.position.x - worldState.px;
    const fdz = g.position.z - worldState.pz;
    const inWater = g.position.x >= SHORE_X;
    if (fdx * fdx + fdz * fdz > REHOME_DIST2 || inWater) {
      const playerCi = Math.round(worldState.px / CELL);
      const playerCj = Math.round(worldState.pz / CELL);
      const [newCi, newCj] = pickCityBlock(
        () => Math.min(playerCi + (Math.floor(Math.random() * 5) - 2), 0),
        () => playerCj + (Math.floor(Math.random() * 5) - 2)
      );
      ps.cx = newCi * CELL;
      ps.cz = newCj * CELL;
      ps.s = Math.random() * LOOP_LEN;
    }

    const nearFast = speedMs > FLEE_SPEED_MS && fdx * fdx + fdz * fdz < FLEE_RADIUS2;
    if (nearFast) ps.flee = 1.4;
    ps.flee = Math.max(0, ps.flee - d);

    const spd = spec.baseSpeed * (ps.flee > 0 ? 3.2 : 1);
    ps.s += ps.dir * spd * d;
    const [x, z, fx, fz] = pedPos(ps.cx, ps.cz, ps.s);
    g.position.set(x, 0, z);
    g.rotation.y = Math.atan2(fx * ps.dir, fz * ps.dir);

    // rigid robots: procedural footstep bob + side-to-side roll
    const ph = t * (ps.flee > 0 ? 16 : 8) + ps.s;
    ps.bob = Math.abs(Math.sin(ph)) * (ps.flee > 0 ? 0.08 : 0.045);
    ps.sway = Math.sin(ph) * (ps.flee > 0 ? 0.09 : 0.05);
}

export function Pedestrians() {
  return <PedestrianRobots />;
}

function PedestrianRobots() {
  const robots = useNpcRobots();
  const holders = useMemo(() => PED_SPECS.map(() => new THREE.Object3D()), []);
  const states = useRef<PedState[]>(
    PED_SPECS.map((spec) => ({ cx: spec.ci * CELL, cz: spec.cj * CELL, s: spec.s, dir: spec.dir, flee: 0, rag: null, bob: 0, sway: 0 }))
  );
  // one InstancedMesh per [robot type][lod][part], sized to that type's head count
  const { root, meshes } = useMemo(() => {
    const root = new THREE.Group();
    root.name = "pedestrian-robots";
    const perType = NPC_ROBOTS.map((_, ti) => PED_SPECS.filter((p) => p.robot === ti).length);
    const meshes = robots.map((lods, ti) =>
      lods.map((parts, lod) =>
        parts.map((p) => {
          const im = new THREE.InstancedMesh(p.geometry, p.material, Math.max(1, perType[ti]));
          im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          im.count = 0;
          im.frustumCulled = false; // all instances share one buffer; bounds would need a per-frame recompute
          im.castShadow = lod === 0;
          im.name = `ped:${NPC_ROBOTS[ti].id}:${lod}`;
          root.add(im);
          return im;
        })
      )
    );
    return { root, meshes };
  }, [robots]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1) }), []);

  useFrame((frameState, dt) => {
    const t = frameState.clock.elapsedTime;
    for (const lods of meshes) for (const parts of lods) for (const im of parts) im.count = 0;
    for (let i = 0; i < PED_SPECS.length; i++) {
      const g = holders[i];
      const spec = PED_SPECS[i];
      const ps = states.current[i];
      stepPed(g, spec, ps, i, t, dt);
      const dx = g.position.x - worldState.px;
      const dz = g.position.z - worldState.pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > FAR_DIST2) continue;
      const lod = d2 < NEAR_DIST2 ? 0 : 1;
      tmp.e.set(g.rotation.x, g.rotation.y, g.rotation.z + ps.sway, g.rotation.order);
      tmp.q.setFromEuler(tmp.e);
      tmp.p.set(g.position.x, g.position.y + ps.bob, g.position.z);
      tmp.m.compose(tmp.p, tmp.q, tmp.one);
      for (const im of meshes[spec.robot][lod]) im.setMatrixAt(im.count++, tmp.m);
    }
    // an empty InstancedMesh still costs a draw call (and a shadow-pass one): hide it
    for (const lods of meshes) for (const parts of lods) for (const im of parts) { im.visible = im.count > 0; if (im.count) im.instanceMatrix.needsUpdate = true; }
  });

  return <primitive object={root} />;
}
