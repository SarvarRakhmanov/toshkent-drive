// Tiny event bus for one-shot debris bursts, same shared-mutable-singleton
// pattern as worldState/vehicleState. Any system (car/bike crash, later traffic
// rams) pushes a burst; components/Debris.tsx drains the queue each frame and
// fires physics fragments from its pool. Kept out of React state so a crash
// mid-frame never triggers a re-render.
export interface DebrisBurst {
  x: number;
  y: number;
  z: number;
  dx: number; // outward direction (unit-ish), the way the impact was travelling
  dz: number;
  power: number; // 0..1, scales impulse + how many fragments fly
}

export const debrisQueue: DebrisBurst[] = [];

export function spawnDebris(b: DebrisBurst) {
  // cap the backlog so a car pinned against a wall can't flood the queue
  if (debrisQueue.length < 8) debrisQueue.push(b);
}

/** Shared by Car/Bike/PoliceCar: a hard wall/building hit is "the character
 * controller wanted to move a lot this frame but a solid obstacle ate most of
 * it" — the same signal enableAutostep/computeColliderMovement already expose,
 * just compared before/after. Debounced per-vehicle via `cooldown` so a car
 * pinned against a wall doesn't fire every frame. */
export function checkCrashDebris(
  cooldown: { current: number },
  dt: number,
  desired: { x: number; z: number },
  actual: { x: number; z: number },
  speedMs: number,
  pos: { x: number; y: number; z: number },
  heading: number,
) {
  cooldown.current = Math.max(0, cooldown.current - dt);
  const desiredLen = Math.hypot(desired.x, desired.z);
  if (cooldown.current > 0 || speedMs < 9 || desiredLen < 0.02) return;
  const actualLen = Math.hypot(actual.x, actual.z);
  if (desiredLen - actualLen <= desiredLen * 0.5) return;
  const sh = Math.sin(heading);
  const ch = Math.cos(heading);
  spawnDebris({
    x: pos.x + sh * 2.2,
    y: pos.y + 0.5,
    z: pos.z + ch * 2.2,
    dx: sh,
    dz: ch,
    power: Math.max(0.3, Math.min(1, speedMs / 25)),
  });
  cooldown.current = 0.6;
}
