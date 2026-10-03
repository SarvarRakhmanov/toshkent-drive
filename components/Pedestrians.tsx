"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";
import { SHORE_X } from "@/lib/marina";
import { PersonFigure, PERSON_MODEL_HEIGHT } from "@/components/PersonFigure";
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

const TARGET_HEIGHT = 1.8;
const SCALE = TARGET_HEIGHT / PERSON_MODEL_HEIGHT;

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

const SKINS = ["#d9a066", "#8a5a2b", "#f0c8a0", "#6b4423", "#c79a6b", "#a06a3a"];
const SHIRTS = ["#c84f4f", "#4f7ac8", "#4fc87a", "#c8b44f", "#9a4fc8", "#e8e8e8", "#2a2e38", "#d98a3a", "#2f8a6a"];
const PANTS = ["#23262e", "#2a2a3a", "#4a3a2a", "#1a1a22", "#3a4a5a", "#5a5a5a"];

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
  skin: string;
  shirt: string;
  pants: string;
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
    skin: SKINS[(rand() * SKINS.length) | 0],
    shirt: officer ? "#1c2c4e" : SHIRTS[(rand() * SHIRTS.length) | 0],
    pants: officer ? "#131a2b" : PANTS[(rand() * PANTS.length) | 0],
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
export const pedestrianPositions: { x: number; z: number }[] = PED_SPECS.map(() => ({ x: 0, z: 0 }));

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

function Ped({ spec, index }: { spec: PedSpec; index: number }) {
  const group = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const st = useRef({
    cx: spec.ci * CELL,
    cz: spec.cj * CELL,
    s: spec.s,
    dir: spec.dir,
    flee: 0,
    rag: null as Ragdoll | null,
  });

  useFrame((frameState, dt) => {
    const g = group.current;
    if (!g) return;
    const d = Math.min(dt, 0.05);
    const ps = st.current;
    // one-frame-stale is fine for a coarse "is anyone standing here" obstacle
    // check — written before this frame's own movement below
    pedestrianPositions[index].x = g.position.x;
    pedestrianPositions[index].z = g.position.z;

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

    const t = frameState.clock.elapsedTime;
    const sw = Math.sin(t * (ps.flee > 0 ? 16 : 8) + ps.s) * 0.55;
    if (legL.current) legL.current.rotation.x = sw;
    if (legR.current) legR.current.rotation.x = -sw;
    if (armL.current) armL.current.rotation.x = -sw * 0.8;
    if (armR.current) armR.current.rotation.x = sw * 0.8;
  });

  return (
    <group ref={group} scale={SCALE}>
      <PersonFigure
        legL={legL}
        legR={legR}
        armL={armL}
        armR={armR}
        jacketColor={spec.shirt}
        pantsColor={spec.pants}
        skinColor={spec.skin}
        officer={spec.officer}
      />
    </group>
  );
}

export function Pedestrians() {
  return (
    <>
      {PED_SPECS.map((spec, i) => (
        <Ped key={i} spec={spec} index={i} />
      ))}
    </>
  );
}
