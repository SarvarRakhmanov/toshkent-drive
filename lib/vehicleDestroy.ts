// One-shot signal: components/TankCombat.tsx sets this the instant a tank
// shell hits the player's own car (checked against vehicleState.car's live
// position). Consumed by Car.tsx on its own next frame — same shape as
// lib/clubTeleport.ts's teleportRequest — because only Car.tsx can actually
// freeze/hide/respawn its own kinematic body; TankCombat.tsx has no reach
// into that component-local state, same reasoning lib/pedestrianHit.ts's own
// comment gives for why a one-shot flag is the bridge here instead of a
// direct call.
export const carDestroyRequest = { pending: false };

export function requestCarDestroy() {
  carDestroyRequest.pending = true;
}
