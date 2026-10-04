"use client";

// v1.6.1 "car won't move" hotfix: the player's car is a kinematic character
// controller, so if it is ever placed overlapping a static collider (an old
// save parked against a wall/prop, a reset onto a kerb object…) every sweep
// is blocked, the hard-hit code bleeds the speed to ~0 every frame and the
// car never pulls away. These helpers find a spot whose footprint — plus a
// run-up ahead — is free of colliders, for the start spawn, reset/summon and
// the auto-unstuck in components/Car.tsx.
import { Cuboid, QueryFilterFlags, type World, type Collider } from "@dimforge/rapier3d-compat";
import { VEHICLE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import { groundYAt, SHORE_X } from "@/lib/marina";

/** the open plaza at the city centre: the default fresh-game spawn */
export const SAFE_SPAWN = { x: 0, z: 0, h: 0 };

const shapes = new Map<string, Cuboid>();
function box(hx: number, hy: number, hz: number) {
  const k = `${hx},${hy},${hz}`;
  let s = shapes.get(k);
  if (!s) { s = new Cuboid(hx, hy, hz); shapes.set(k, s); }
  return s;
}

/** true if a car-sized box at x,z facing h (and `ahead` metres of road in
 *  front of it) touches no solid collider. Sensors, dynamic props and the
 *  ground plane (box starts 0.3 m above the ground) are ignored. */
export function isClear(world: World, x: number, z: number, h: number, ahead = 8, exclude?: Collider | null): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (x >= SHORE_X - 4) return false; // never into the marina water
  const gy = groundYAt(x, z);
  const halfLen = 2.5 + ahead / 2;
  const off = ahead / 2; // box centre slides forward to cover the run-up
  const cx = x + Math.sin(h) * off, cz = z + Math.cos(h) * off;
  const rot = { x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) };
  let hit = false;
  world.intersectionsWithShape(
    { x: cx, y: gy + 0.3 + 0.75, z: cz }, rot, box(1.3, 0.75, halfLen),
    () => { hit = true; return false; },
    QueryFilterFlags.EXCLUDE_DYNAMIC | QueryFilterFlags.EXCLUDE_SENSORS, VEHICLE_SWEEP_GROUPS, exclude ?? undefined, undefined,
  );
  return !hit;
}

/** nearest clear spot to (x,z): the spot itself, then road lanes of the
 *  100 m street grid nearby, then rings out to 80 m, else the plaza spawn. */
export function findSafeSpot(world: World, x: number, z: number, h: number, exclude?: Collider | null): { x: number; z: number; h: number } {
  if (isClear(world, x, z, h, 8, exclude)) return { x, z, h };
  const cands: { x: number; z: number; h: number }[] = [];
  // street grid: x-roads at z = 50 + 100k, z-roads at x = 50 + 100k (lane +2.5 m)
  const zs = Math.round((z - 50) / 100) * 100 + 50, xs = Math.round((x - 50) / 100) * 100 + 50;
  for (const dz of [0, -100, 100]) for (const along of [0, -20, 20, -40, 40]) {
    cands.push({ x: x + along, z: zs + dz + 2.5, h: Math.PI / 2 }, { x: x + along, z: zs + dz - 2.5, h: -Math.PI / 2 });
  }
  for (const dx of [0, -100, 100]) for (const along of [0, -20, 20, -40, 40]) {
    cands.push({ x: xs + dx + 2.5, z: z + along, h: 0 }, { x: xs + dx - 2.5, z: z + along, h: Math.PI });
  }
  cands.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  for (let r = 4; r <= 80; r += 6) for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cands.push({ x: x + Math.sin(a) * r, z: z + Math.cos(a) * r, h });
  }
  for (const c of cands) {
    if (isClear(world, c.x, c.z, c.h, 8, exclude)) return c;
    // same spot, other headings
    for (const hh of [c.h + Math.PI / 2, c.h + Math.PI, c.h - Math.PI / 2]) if (isClear(world, c.x, c.z, hh, 8, exclude)) return { ...c, h: hh };
  }
  return { ...SAFE_SPAWN };
}
