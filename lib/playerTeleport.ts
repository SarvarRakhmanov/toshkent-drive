// One-shot teleport request consumed only by Player.tsx — mirrors
// lib/clubTeleport.ts (which Car/Bike consume) but kept separate since the
// two are never meant to serve the same frame's request: club-door entry
// targets whichever of {car,bike,foot} is currently active, dismounting a
// vehicle always targets the player.
// vx/vz: world-space m/s to hand the player as a bail-out slide (see
// lib/player.ts's dismount call) — 0 for every other caller (club door),
// so they're optional and default to a dead stop, same as before this existed.
// y defaults to 1 (ordinary ground level everywhere in the city except FORT
// NEON's elevated platform/I-94's deck) — lib/player.ts's dismount passes the
// vehicle's own real y instead of relying on that default, which is what
// fixes dismounting on the platform dropping the player through to the sea
// below instead of standing on the deck.
export const playerTeleport = { pending: false, x: 0, y: 1, z: 0, h: 0, vx: 0, vz: 0 };

export function requestPlayerTeleport(x: number, z: number, h: number, y = 1, vx = 0, vz = 0) {
  playerTeleport.pending = true;
  playerTeleport.x = x;
  playerTeleport.y = y;
  playerTeleport.z = z;
  playerTeleport.h = h;
  playerTeleport.vx = vx;
  playerTeleport.vz = vz;
}
