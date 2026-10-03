// One-shot fire request: components/Tank.tsx pushes one every time the
// driver fires, components/TankCombat.tsx (mounted once in Game.tsx) drains
// the queue and spawns an actual travelling shell from its own pool — same
// shared-mutable-singleton pattern as lib/debris.ts's debrisQueue, kept out
// of React state so firing never triggers a re-render.
export interface FireRequest {
  x: number;
  y: number;
  z: number;
  dx: number; // unit-ish forward direction, x component
  dz: number; // unit-ish forward direction, z component
}

export const fireQueue: FireRequest[] = [];

export function requestFire(x: number, y: number, z: number, dx: number, dz: number) {
  // cap the backlog so holding the fire key can't flood the queue faster
  // than TankCombat.tsx's own per-shot cooldown drains it
  if (fireQueue.length < 4) fireQueue.push({ x, y, z, dx, dz });
}
