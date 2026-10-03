// One-shot request, same mutable-singleton pattern as lib/clubTeleport.ts's
// teleportRequest — but that one is only ever consumed by the ACTIVE
// vehicle (Car.tsx checks `isActive && teleportRequest.pending`), which is
// exactly wrong for "call my car to me": the player is on foot (not driving
// it) when they place the call. Car.tsx checks this unconditionally instead,
// same as its own tank-shell-destroy/respawn blocks already do regardless
// of isActive.
export const carSummon = { pending: false, x: 0, z: 0, h: 0 };

export function requestCarSummon(x: number, z: number, h: number) {
  carSummon.pending = true;
  carSummon.x = x;
  carSummon.z = z;
  carSummon.h = h;
}
