// One-shot signal: Pedestrians.tsx sets this the instant it ragdolls someone
// under a moving vehicle. It can't reach into the driving vehicle's own
// speed — that lives in Car.tsx/Bike.tsx/PoliceCar.tsx's own component-local
// `useRef`, not shared state — so this is the bridge between them, same
// shape as lib/playerTeleport.ts's one-shot request (set by one component,
// consumed-and-cleared by another on its own next frame).
//
// Ported from the original's tick() (index.html ~7333): `v.speed*=0.9` fires
// in the same spot the ragdoll does, right after a hit registers.
export const pedestrianHit = { pending: false };

export function requestPedestrianHitSlowdown() {
  pedestrianHit.pending = true;
}

/** Called by whichever land vehicle is actually driving, once per frame.
 * Consumes the flag (so only the vehicle that caused the hit reacts, and only
 * once) and returns the speed multiplier to apply, or null if nothing fired
 * this frame. */
export function consumePedestrianHitSlowdown(): number | null {
  if (!pedestrianHit.pending) return null;
  pedestrianHit.pending = false;
  return 0.9;
}
