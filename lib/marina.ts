// Dock/pier data shared between components/Marina.tsx (renders it, gives land
// traversal a normal solid RigidBody collider — see that file for why that's
// enough for Car/Bike/Player but not boats) and Boat.tsx/PatrolBoat.tsx (hulls
// need their own check, ported from the original's pierPush()/pierColliders,
// since Boat.tsx never queries Rapier colliders at all — Milestone 2).
import { HWY_Z, HWY_W, DECK_X1, highwayGroundY } from "@/lib/highway";
import { BASE_X, BASE_Z, FENCE_X, FENCE_Z, baseGroundY } from "@/lib/militaryBase";
export const SHORE_X = 600; // land/water edge near EAST MARINA — matches the original's raw SHORE_X (see lib/landmarks.ts)
// True edge of the last solid city chunk (City.tsx: CELL=100, SHORE_CI=6 —
// chunks at/after ci=6 render no ground). The shore wall/dock MUST start
// here, not further out at SHORE_X: a car reaching x=550 with nothing to
// stand on falls before it ever travels the remaining ~49 units to a wall
// planted near SHORE_X, sinking under the wall's collision height on the way
// down and drowning forever — this was the actual cause of the drowning bug.
export const LAND_EDGE_X = 550;
export const PIER_LEN = 90; // bridges the gap from LAND_EDGE_X straight out over the water
export const PIER_Z = 50;

export const PIER_COLLIDERS: { x0: number; x1: number; z0: number; z1: number }[] = [
  { x0: LAND_EDGE_X, x1: LAND_EDGE_X + PIER_LEN, z0: PIER_Z - 4.5, z1: PIER_Z + 4.5 },
];

// Where a vehicle that somehow ends up drowning respawns — same clear spot
// policeCar already parks at (lib/vehicleState.ts), reused so Car.tsx/Bike.tsx
// don't need their own separate safe-spot check.
export const DROWN_RESPAWN = { x: 482, z: 75, h: 0 };

/** Ported verbatim from the original's pierPush(x,z,r) — same AABB push-out
 * math as collide(), just against the dock's own footprint instead of the
 * general staticColliders/chunk list. Boat.tsx calls this every frame with
 * r=2.0 (matches the original) so a hull slides off the dock's edge instead
 * of ghosting through it. */
export function pierPush(x: number, z: number, r: number): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (const c of PIER_COLLIDERS) {
    const nx = clamp(x, c.x0, c.x1);
    const nz = clamp(z, c.z0, c.z1);
    const dx = x - nx;
    const dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = true;
      const d = Math.sqrt(d2) || 0.001;
      x = nx + (dx / d) * r;
      z = nz + (dz / d) * r;
    }
  }
  return { x, z, hit };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// True over I-94's bridge deck (lib/highway.ts) or standing on FORT NEON's
// platform (lib/militaryBase.ts) — both real, driven-on structures that sit
// legitimately out past LAND_EDGE_X/SHORE_X, elevated above the water below
// them. Every "is this position actually in open water" check past the
// coastline needs this exemption, not just clampFromWater: Car.tsx/Bike.tsx/
// Player.tsx's own drowning timers (`nextPos.x >= SHORE_X`) hit the identical
// blind spot — they only look at x, never elevation or "is there real
// geometry here" — and would happily drown a car standing still on the
// bridge deck a few seconds after it crosses x=600.
// True ground/deck height a vehicle should spawn/reset at for its (x,z) —
// 0 (ordinary sea-level ground) everywhere except the bridge and the base,
// where every land vehicle's initial RigidBody position (Car.tsx and
// friends) needs to add this instead of assuming sea level. A vehicle saved
// while parked on the deck or the platform used to always spawn back at its
// hardcoded ride height above y=0 on reload — well under the real surface —
// and immediately fall through into the water below.
export function groundYAt(x: number, z: number): number {
  return highwayGroundY(x, z) ?? baseGroundY(x, z) ?? 0;
}

export function isOnBridgeOrBase(pos: { x: number; z: number }): boolean {
  const onBridge = pos.z > HWY_Z - HWY_W / 2 - 5 && pos.z < HWY_Z + HWY_W / 2 + 5 && pos.x < DECK_X1 + 10;
  const onBase =
    pos.x > BASE_X - FENCE_X - 10 &&
    pos.x < BASE_X + FENCE_X + 10 &&
    pos.z > BASE_Z - FENCE_Z - 10 &&
    pos.z < BASE_Z + FENCE_Z + 10;
  return onBridge || onBase;
}

// Hard numeric backstop, independent of Rapier's WATER_BOUNDARY collider
// (components/Marina.tsx, lib/collisionGroups.ts): at extreme speed (nitro,
// 200+ km/h) the character controller's slide-along-a-wall iteration can
// still let a kinematic sweep punch through a thin static collider in one
// frame — confirmed by actually doing it. A collider is "should never let
// you through"; this is "physically cannot end up on the other side" — it
// mutates the vehicle's own next-position in place every frame, after
// physics has already computed it, so no amount of collider-tunneling can
// bypass it. Every land vehicle (Car/Bike/PoliceCar/CommercialVehicle) calls
// this on its own `nextPos` right after computing it. `onPier` is generous
// (the full pier footprint, not just the walkway sliver) so this never
// fights the dock itself — it only ever clamps at the true coastline.
export function clampFromWater(pos: { x: number; z: number }) {
  if (isOnBridgeOrBase(pos)) return;
  const onPier = pos.z > PIER_Z - 4.5 && pos.z < PIER_Z + 4.5;
  const maxX = onPier ? LAND_EDGE_X + PIER_LEN : LAND_EDGE_X;
  if (pos.x > maxX) pos.x = maxX;
}

// Mirror image of clampFromWater, for BOATS: the coastline here is a single
// half-plane (x >= LAND_EDGE_X is water — see City.tsx's SHORE_CI/Water.tsx's
// CENTER_X, there's no other shore edge a boat could reach), so the same
// PIER_Z-band split applies, just inverted — a boat caught in the pier's z
// band gets pushed all the way past the dock's far end (LAND_EDGE_X +
// PIER_LEN) rather than just the shoreline, since pierPush's own radius-2
// push-out already keeps a hull off the dock's actual footprint; this is only
// the same "physically cannot end up on the other side" backstop
// clampFromWater documents, generalized to boats instead of land vehicles.
// `margin` widens the boundary for the hull's own half-length (Boat.tsx's
// original hardcoded `LAND_EDGE_X + 5`), since a boat clamped by its center
// point alone would still let its bow poke onto land.
export function clampToWater(pos: { x: number; z: number }, margin = 0) {
  const onPier = pos.z > PIER_Z - 4.5 && pos.z < PIER_Z + 4.5;
  const minX = (onPier ? LAND_EDGE_X + PIER_LEN : LAND_EDGE_X) + margin;
  if (pos.x < minX) pos.x = minX;
}
