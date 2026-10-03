"use client";

import { Suspense } from "react";

import { useRef, useState } from "react";
import { currentProfile } from "@/lib/gfx";
import { useFrame } from "@/lib/safeFrame";
import { RigidBody, CuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { CarMesh } from "@/components/Car";
import { TrafficGlbCar } from "@/components/GlbCar";
import { RIDE_HEIGHT, styleFor, type CarStyle } from "@/components/SupercarBody";
import { PoliceCarMesh } from "@/components/PoliceCar";
import { PoliceJeepMesh } from "@/components/ParkedPoliceJeep";
import { CommercialBody, type CommercialKind } from "@/components/CommercialBody";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { pedestrianPositions } from "@/components/Pedestrians";
import { spawnDebris } from "@/lib/debris";
import { groundYAt } from "@/lib/marina";
import { BASE_X, BASE_Z, FENCE_X, FENCE_Z } from "@/lib/militaryBase";

// Basic traffic AI (Phase 3, part of Milestone 4): a handful of self-driving
// cars patrolling straight lanes. Deliberately not the original's full
// lane-grid/traffic-light/yield system — there's no road grid yet for that to
// follow (World.tsx is still placeholder geometry, see SUMMARY.md). This is
// the original's *other* update loop in miniature: traffic cars were never
// run through the player's collide()/character-controller physics block, they
// always had their own simpler position-driven loop — so skipping Rapier's
// character controller here isn't a shortcut, it's the same split the
// original makes (see updateBoatTraffic vs. the player drive branch, ported
// in Milestone 1/2's own comments).
interface Lane {
  axis: "x" | "z";
  lane: number; // fixed cross-axis position
  min: number;
  max: number;
  speed: number;
  color: string;
  police?: boolean;
  // a police lane that renders the boxy security jeep (PoliceJeepMesh) instead
  // of the interceptor — steals into components/PoliceJeep.tsx's "policeJeep"
  // identity rather than the shared "policeCar" one. Mutually exclusive with
  // `police` in practice (see TrafficCar's render branch — jeep checked first).
  policeJeep?: boolean;
  // undefined = existing sedan (CarMesh), unchanged. Buses/trucks are given
  // slower speeds below than their sedan-lane equivalents — bigger vehicle,
  // slower arcade "traffic" read, same reasoning as the police lanes topping
  // out higher because they're meant to feel urgent.
  kind?: CommercialKind;
  // optional "busier streets" lane — skipped on phones on LOW (see Traffic())
  extra?: boolean;
}

// Lane cross-axis values must land on the real road grid. City.tsx bakes
// asphalt only in the outer 10 units of each chunk edge (buildTileTexture), so
// a road runs along every chunk boundary — coordinates ≡ 50 (mod 100), e.g.
// ±50, ±150. Chunk() now walls each chunk's interior off to Car/Bike/Traffic
// (VEHICLE_ONLY curb at cx±40, see lib/collisionGroups.ts), so a lane anywhere
// off that grid drives straight into a curb. `lane` (the fixed cross-axis
// value) is therefore always an odd multiple of 50.
// AIRPORT_MIN: components/Airport.tsx's fence sits at world x=-510 (AX=-750 +
// FENCE_X=240), with its gate opening centred exactly on the z=50 road line
// (GATE_CZ) — an x-axis lane running to the old min=-85 drove straight
// through that gate and out the other side, reading as "NPC traffic wanders
// into the airport and comes back." Every x-axis lane below is clamped to
// stay clear of the fence instead (z-axis lanes are fixed at x=50/-50 and
// never get anywhere near the airport's x=-990..-510 footprint, so they don't
// need it).
const AIRPORT_MIN = -505;
const LANES: Lane[] = [
  { axis: "x", lane: 50, min: AIRPORT_MIN, max: 85, speed: 10, color: "#8b93a1" },
  { axis: "x", lane: -50, min: AIRPORT_MIN, max: 85, speed: 13, color: "#3a3f4a" },
  { axis: "z", lane: 50, min: -85, max: 85, speed: 9, color: "#1f4a7a" },
  { axis: "z", lane: -50, min: -85, max: 85, speed: 11, color: "#7a2020" },
  { axis: "x", lane: 150, min: AIRPORT_MIN, max: 85, speed: 7, color: "#2a5a3a", kind: "bus" },
  // patrol the police-station neighborhood (lib/landmarks.ts POLICE HARBOR,
  // x:450 z:50) — recruit into a convoy behind the player whenever a police
  // vehicle (policeCar) is being driven nearby, ported from the original's
  // recruit-on-siren convoy system (index.html ~line 7365-7400), ~line
  // 7466's felony-stop boxing-in maneuver deliberately not ported — a
  // meaningfully bigger state machine than a straight follow, left for later.
  // Both lanes on the road intersection under the station (x=450, z=50, both
  // odd-50 road lines) after the shore restore moved it out to (450,50).
  { axis: "x", lane: 50, min: 380, max: 520, speed: 11, color: "#0c0c0e", police: true },
  { axis: "z", lane: 450, min: -30, max: 110, speed: 12, color: "#0c0c0e", police: true },

  // more NPC traffic — a couple more streets, plus a 2nd car on two of the
  // busiest existing ones (same lane spec, different seed stagger)
  { axis: "z", lane: 150, min: -85, max: 85, speed: 8, color: "#b33a3a", kind: "truck", extra: true },
  { axis: "x", lane: -150, min: AIRPORT_MIN, max: 85, speed: 9, color: "#4a6a8a", kind: "jeep", extra: true },
  { axis: "z", lane: -150, min: -85, max: 85, speed: 8, color: "#8a7a3a", kind: "bus", extra: true },
  { axis: "x", lane: 50, min: AIRPORT_MIN, max: 85, speed: 9, color: "#5a5a5a", kind: "truck", extra: true },
  { axis: "z", lane: -50, min: -85, max: 85, speed: 9, color: "#3a5a5a", kind: "jeep", extra: true },

  // more patrol cars, out near spawn rather than only around the station,
  // so you actually run into one without driving out to POLICE HARBOR
  { axis: "x", lane: -50, min: AIRPORT_MIN, max: 85, speed: 10, color: "#0c0c0e", police: true },
  { axis: "z", lane: 50, min: -85, max: 85, speed: 10, color: "#0c0c0e", police: true },

  // airport perimeter patrol: same lane mechanic, entirely inside the fence
  // (world x -970..-540, world z 100) so it can never clip the gate/wall the
  // way the city lanes above were fixed to avoid — steal it like any other
  // police lane (lib/steal.ts) for "drive the airport police car" duty.
  { axis: "x", lane: 100, min: -970, max: -540, speed: 9, color: "#0c0c0e", police: true },
  // the gate-guard trio (components/Airport.tsx's GateGuardPost used to park
  // them statically) now actually patrols the field instead of just sitting
  // there — two more interceptor lanes plus one security-jeep lane, all
  // inside the fence (world x -990..-510, z -140..340 — Airport.tsx's
  // FENCE_X/FENCE_Z=240 around AX/AZ -750/100).
  { axis: "x", lane: 180, min: -970, max: -540, speed: 10, color: "#0c0c0e", police: true },
  { axis: "z", lane: -850, min: -100, max: 280, speed: 10, color: "#0c0c0e", police: true },
  { axis: "z", lane: -600, min: -50, max: 250, speed: 8, color: "#0c0c0e", policeJeep: true },

  // FORT NEON: 24/7 military patrol jeeps, confined entirely inside the
  // compound's own walls (world x/z within BASE_X/BASE_Z ± FENCE_X/FENCE_Z —
  // see lib/militaryBase.ts) — reuses the same PoliceJeepMesh/policeJeep
  // lane mechanic the airport's own gate patrol uses (boxy 4x4 already
  // reads as tactical/security, not worth a second recolored body just for
  // this). Two lanes, north and south of the motor-pool lane, opposite
  // directions so they read as an actual patrol pattern, not two cars stuck
  // in lockstep.
  { axis: "x", lane: BASE_Z - (FENCE_Z - 15), min: BASE_X - (FENCE_X - 15), max: BASE_X + (FENCE_X - 15), speed: 9, color: "#0c0c0e", policeJeep: true },
  { axis: "x", lane: BASE_Z + (FENCE_Z - 15), min: BASE_X - (FENCE_X - 15), max: BASE_X + (FENCE_X - 15), speed: 9, color: "#0c0c0e", policeJeep: true },
];

// Live per-lane traffic slot — same shared-singleton pattern as skyState/
// worldState, updated in place (not replaced) so it never allocates. Read by
// Minimap.tsx for blips and by lib/steal.ts, which needs the pose AND the
// paint/roofline so the car you drive away looks like the one you walked up to.
export interface TrafficSlot {
  x: number;
  z: number;
  h: number;
  color: string;
  style: CarStyle;
  police: boolean;
  // renders/steals as the security jeep (components/PoliceJeep.tsx's
  // "policeJeep" identity) instead of the interceptor — see Lane.policeJeep.
  policeJeep: boolean;
  // undefined = sedan. Read by lib/steal.ts so hijacking a commercial lane
  // hands the player a real jeep/bus/truck instead of a reskinned sedan.
  kind?: CommercialKind;
  // taken by the player (lib/steal.ts): the NPC is hidden and inert until
  // respawnIn runs out, then it re-enters at the end of its lane as a fresh car
  stolen: boolean;
  respawnIn: number;
}

// styleFor(i) rather than the random roll CarMesh does by default: SupercarBody
// already documents the style pick as "deterministic so a given traffic lane
// always renders the same car", but no call site was passing a seed, so every
// remount reshuffled the street. Seeding it here also makes the roofline
// knowable from outside, which is what lets a stolen car keep its silhouette.
export const trafficPositions: TrafficSlot[] = LANES.map((l, i) => ({
  x: 0,
  z: 0,
  h: 0,
  color: l.color,
  style: styleFor(i),
  police: !!l.police,
  policeJeep: !!l.policeJeep,
  kind: l.kind,
  stolen: false,
  respawnIn: 0,
}));

// How long a stolen lane stays empty before a replacement car enters. Long
// enough that the swap doesn't read as a pop-in, short enough that repeatedly
// stealing doesn't visibly thin the city out.
export const RESPAWN_DELAY = 14;

export function Traffic() {
  // phones on LOW run only the core lanes; a skipped lane's slot is parked as
  // "stolen" forever so the minimap/steal/hint/tank code (which all iterate
  // trafficPositions) simply ignore it
  const [extra] = useState(() => currentProfile().trafficExtra);
  return (
    <>
      {LANES.map((lane, i) => {
        if (lane.extra && !extra) {
          trafficPositions[i].stolen = true;
          trafficPositions[i].respawnIn = Infinity;
          return null;
        }
        return <TrafficCar key={i} lane={lane} seed={i} index={i} />;
      })}
    </>
  );
}

// scratch objects: the per-car kinematic rotation used to allocate a new
// Quaternion + Vector3 per car per frame (~45 short-lived objects/frame → GC)
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _kin = { x: 0, y: 0, z: 0 };

const RECRUIT_RADIUS2 = 70 * 70; // matches the original's d2<70*70 land-convoy recruit check

const STOP_DISTANCE = 7; // ahead-of-car braking gap — city sedan is 4.6 long, this clears it plus a margin
// bus/truck are much longer than the sedan STOP_DISTANCE was sized for — scale
// the gap by body length so one doesn't visually clip through whatever it's
// braking for (jeep is close enough to sedan length to use the flat default)
function stopDistanceFor(lane: Lane): number {
  if (lane.kind === "bus") return STOP_DISTANCE * 1.9; // ~6.5m body
  if (lane.kind === "truck") return STOP_DISTANCE * 1.6; // ~5.6m body
  return STOP_DISTANCE;
}
const LANE_HALF_WIDTH = 4.5; // covers either side of the centreline (±LANE_OFFSET) plus car width/slop
const LANE_OFFSET = 3; // sideways shift off the road centreline (road is 20 wide, this stays well inside it)

// Real vehicle world positions to treat as obstacles — vehicleState.car/bike/
// policeCar are kept live every frame by their own components regardless of
// which one is actually active (a parked-and-abandoned car still updates
// its own x/z), so this also works if the player gets out and walks away.
//
// The player ON FOOT is in this list too, and so is every pedestrian
// (components/Pedestrians.tsx's pedestrianPositions) — that used to be
// missing entirely, so a lane car drove clean through anyone standing in the
// road (Pedestrians.tsx's own hit/ragdoll test only ever covers the PLAYER's
// driven vehicle, never a scripted lane car). Traffic cars are
// kinematicPosition and driven purely by the scripted lane position below —
// even with a real collider now (see colliderBoxFor), Rapier never resolves
// kinematic-vs-kinematic overlap, so this stop-short check is the only thing
// that actually prevents the clip-through, physics collider or not.
const obstacles: { x: number; z: number }[] = [];
const footPos = { x: 0, z: 0 }; // scratch, so the on-foot check allocates nothing per frame
function laneBlocked(lane: Lane, nextPos: number, dir: number): boolean {
  obstacles.length = 0; // reused across frames/cars — never reallocated
  obstacles.push(
    vehicleState.car,
    vehicleState.bike,
    vehicleState.policeCar,
    vehicleState.policeJeep,
    vehicleState.jeep,
    vehicleState.bus,
    vehicleState.truck,
    ...pedestrianPositions
  );
  if (useHudStore.getState().active === "foot") {
    footPos.x = worldState.px;
    footPos.z = worldState.pz;
    obstacles.push(footPos);
  }
  const stopDistance = stopDistanceFor(lane);
  for (const v of obstacles) {
    const along = lane.axis === "x" ? v.x : v.z;
    const across = lane.axis === "x" ? v.z : v.x;
    if (Math.abs(across - lane.lane) > LANE_HALF_WIDTH) continue; // not in this lane
    const gap = along - nextPos; // signed distance from where we're about to be
    if (gap * dir > 0 && Math.abs(gap) < stopDistance) return true; // only stop for what's ahead, not what's already behind
  }
  return false;
}

// [width, height, length] per body, eyeballed off CommercialBody.tsx's actual
// mesh extents (sedan matches Car.tsx's own carBox). Root-cause fix for the
// player/police car driving straight through every traffic vehicle — this
// RigidBody had colliders={false} and never added one at all.
function colliderBoxFor(lane: Lane): [number, number, number] {
  if (lane.police) return [1.9, 1.35, 4.8]; // matches PoliceCar.tsx's own carBox
  if (lane.policeJeep) return [1.95, 1.4, 4.4]; // matches PoliceJeep.tsx's own carBox
  if (lane.kind === "bus") return [2.2, 2.3, 6.5];
  if (lane.kind === "truck") return [2.1, 2.0, 5.6];
  if (lane.kind === "jeep") return [1.95, 1.5, 3.6];
  return [1.85, 1.3, 4.6]; // sedan, matches Car.tsx's carBox
}

function TrafficCar({ lane, seed, index }: { lane: Lane; seed: number; index: number }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const pos = useRef((lane.min + lane.max) / 2 + seed * 7);
  const dir = useRef(seed % 2 === 0 ? 1 : -1);
  const recruited = useRef(false);
  const convoyPos = useRef<{ x: number; z: number } | null>(null);
  const lightRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const meshRef = useRef<THREE.Group>(null);
  const wasBlocked = useRef(false); // rising-edge latch for the debris burst below
  const [drawDist2] = useState(() => currentProfile().npcDrawDist ** 2);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const slot = trafficPositions[index];

    // stolen (lib/steal.ts): the player is driving this car now, so the NPC
    // copy hides and stops moving. Minimap.tsx skips the blip on the same
    // flag — the slot keeps its last coords rather than being parked at a
    // sentinel, so nothing downstream has to guard against a junk position.
    if (slot.stolen) {
      if (meshRef.current) meshRef.current.visible = false;
      slot.respawnIn -= d;
      if (slot.respawnIn <= 0) {
        slot.stolen = false;
        // re-enter from whichever end it was heading away from
        pos.current = dir.current > 0 ? lane.min : lane.max;
        recruited.current = false;
        convoyPos.current = null;
      }
      return;
    }
    // draw-distance cull: lane logic keeps running (minimap/obstacles need
    // it), but a car beyond the fogged draw distance isn't drawn
    if (meshRef.current) {
      const ddx = slot.x - state.camera.position.x;
      const ddz = slot.z - state.camera.position.z;
      meshRef.current.visible = ddx * ddx + ddz * ddz < drawDist2;
    }

    // background lane math always advances, even while convoying, so dropping
    // out of the convoy resumes patrol from a live position instead of
    // teleporting back to wherever the lane loop was left off — UNLESS a real
    // vehicle (parked or otherwise) is sitting in the way: traffic cars are
    // kinematic and driven purely by this scripted position, and Rapier never
    // resolves kinematic-vs-kinematic overlap even with the real collider
    // added below, so without this check they'd drive straight through a
    // parked car instead of stopping short of it.
    const nextPos = pos.current + lane.speed * dir.current * d;
    const blocked = laneBlocked(lane, nextPos, dir.current);
    // collision effect: fire once on the frame this car first has to brake
    // for something (a real vehicle or a pedestrian — see laneBlocked's own
    // comment) rather than every frame it sits there, and only while it was
    // actually making progress (lane.speed>0) so a lane's own min/max
    // endpoints — which reverse direction through a separate branch below,
    // not through laneBlocked — never trigger it.
    if (blocked && !wasBlocked.current && lane.speed > 3) {
      spawnDebris({
        x: slot.x,
        y: RIDE_HEIGHT + 0.3,
        z: slot.z,
        dx: lane.axis === "x" ? dir.current : 0,
        dz: lane.axis === "z" ? dir.current : 0,
        power: Math.max(0.3, Math.min(1, lane.speed / 15)),
      });
    }
    wasBlocked.current = blocked;
    if (!blocked) {
      pos.current = nextPos;
      if (pos.current > lane.max) {
        pos.current = lane.max;
        dir.current = -1;
      } else if (pos.current < lane.min) {
        pos.current = lane.min;
        dir.current = 1;
      }
    }

    // right-hand-traffic offset: the ping-pong lane reverses direction at
    // each end instead of running two separate one-way lanes, so a car
    // travelling +dir and one travelling -dir need to sit on opposite sides
    // of the centreline (not glued to it) to read as "in a lane" instead of
    // driving straight down the middle/through oncoming traffic.
    const side = dir.current > 0 ? LANE_OFFSET : -LANE_OFFSET;
    const laneX = lane.axis === "x" ? pos.current : lane.lane + side;
    const laneZ = lane.axis === "x" ? lane.lane + side : pos.current;
    const laneHeading =
      lane.axis === "x" ? (dir.current > 0 ? Math.PI / 2 : -Math.PI / 2) : dir.current > 0 ? 0 : Math.PI;

    let x = laneX;
    let z = laneZ;
    let heading = laneHeading;

    if (lane.police) {
      const sirenOn = useHudStore.getState().active === "policeCar";
      if (!sirenOn) {
        recruited.current = false;
      } else if (!recruited.current) {
        const dx = laneX - worldState.px;
        const dz = laneZ - worldState.pz;
        if (dx * dx + dz * dz < RECRUIT_RADIUS2) recruited.current = true;
      }
      if (recruited.current) {
        // slot-based follow formation, same numbers as the original's land
        // convoy (dist=slot*10+8, lateral alternates by slot parity*2.8)
        const slot = index + 1;
        const dist = slot * 10 + 8;
        const lat = (slot % 2 === 0 ? 1 : -1) * 2.8;
        const fx = Math.sin(worldState.heading);
        const fz = Math.cos(worldState.heading);
        const rx = fz;
        const rz = -fx;
        const targetX = worldState.px - fx * dist + rx * lat;
        const targetZ = worldState.pz - fz * dist + rz * lat;
        const cx = convoyPos.current?.x ?? targetX;
        const cz = convoyPos.current?.z ?? targetZ;
        const ddx = targetX - cx;
        const ddz = targetZ - cz;
        const dd = Math.hypot(ddx, ddz) || 1;
        const step = Math.min(dd, 16 * d); // 16 m/s convoy chase speed
        const nx = cx + (ddx / dd) * step;
        const nz = cz + (ddz / dd) * step;
        if (convoyPos.current) { convoyPos.current.x = nx; convoyPos.current.z = nz; } else convoyPos.current = { x: nx, z: nz };
        x = nx;
        z = nz;
        heading = dd > 0.5 ? Math.atan2(ddx, ddz) : worldState.heading;
      } else {
        if (convoyPos.current) { convoyPos.current.x = laneX; convoyPos.current.z = laneZ; } else convoyPos.current = { x: laneX, z: laneZ };
      }

      const flashRed = Math.floor(state.clock.elapsedTime * 5) % 2 === 0;
      if (lightRefs.current[0]) lightRefs.current[0].color.set(flashRed ? "#ff2020" : "#160000");
      if (lightRefs.current[1]) lightRefs.current[1].color.set(flashRed ? "#0a1030" : "#2040ff");
    } else if (lane.policeJeep) {
      // same flash, no convoy-recruit — the jeep patrols the field on its own,
      // it doesn't chase the player down like a pursuit interceptor
      const flashRed = Math.floor(state.clock.elapsedTime * 5) % 2 === 0;
      if (lightRefs.current[0]) lightRefs.current[0].color.set(flashRed ? "#ff2020" : "#160000");
      if (lightRefs.current[1]) lightRefs.current[1].color.set(flashRed ? "#0a1030" : "#2040ff");
    }

    // groundYAt: 0 everywhere except FORT NEON's patrol lanes (lib/
    // militaryBase.ts's platform sits ~9 units up, not sea level) — same fix
    // Car.tsx/Bike.tsx/etc. needed for the same reason.
    _kin.x = x; _kin.y = groundYAt(x, z) + RIDE_HEIGHT; _kin.z = z;
    body.setNextKinematicTranslation(_kin);
    body.setNextKinematicRotation(_q.setFromAxisAngle(_up, heading));
    slot.x = x;
    slot.z = z;
    slot.h = heading; // lib/steal.ts hands this straight to the vehicle you take over
  });

  const [bw, bh, bl] = colliderBoxFor(lane);

  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[0, RIDE_HEIGHT, 0]}>
      {/* the actual collider — root-cause fix, see colliderBoxFor's comment.
          Dropped the same way Car.tsx/PoliceCar.tsx drop theirs, bottom face
          on the tyre contact patch rather than the mesh origin. */}
      <CuboidCollider args={[bw / 2, bh / 2, bl / 2]} position={[0, bh / 2 - RIDE_HEIGHT, 0]} />
      {/* detail="low" — a dozen NPC cars are never seen close enough for
          spokes/mirrors/occupants to be more than a pixel, and skipping them
          keeps the draw-call count from tripling as traffic density grew */}
      <group ref={meshRef}>
        {lane.police ? (
          <PoliceCarMesh lightRefs={lightRefs} detail="low" />
        ) : lane.policeJeep ? (
          // PoliceJeepMesh's own root sits AT ground level (unlike the
          // SupercarBody-family meshes above, which assume their local
          // origin is RIDE_HEIGHT above ground) — see components/PoliceJeep.tsx's
          // own RIDE_HEIGHT=0 comment. This RigidBody is placed at world
          // y=RIDE_HEIGHT like every other lane, so the mesh needs the
          // opposite local shift to land back on the road instead of
          // floating.
          <group position={[0, -RIDE_HEIGHT, 0]}>
            <PoliceJeepMesh lightRefs={lightRefs} />
          </group>
        ) : lane.kind ? (
          <CommercialBody kind={lane.kind} color={lane.color} detail="low" />
        ) : (
          <Suspense fallback={<CarMesh color={lane.color} style={trafficPositions[index].style} detail="low" />}>
            <TrafficGlbCar index={index} color={lane.color} />
          </Suspense>
        )}
      </group>
    </RigidBody>
  );
}
