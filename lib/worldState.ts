// Shared per-frame player-position singleton, same pattern as skyState in
// SkyCycle.tsx — a plain mutable object, not React state, so the city
// chunk-streamer can read it every frame without subscribing/re-rendering.
// Whichever vehicle is active writes its own position here (mirrors the
// original's `player.veh ? player.veh.x : player.x`).
//
// SEEDED FROM THE SAVE, and that matters more than it looks. City.tsx's chunk
// streamer reads this in its own useFrame, and component order puts <City />
// ahead of the vehicles in Game.tsx — so on the very first frame City would
// read a still-default (0,0), decide every chunk around the real spawn was
// "stale", and drop the ground the car was standing on. The car then fell for
// a few frames until the chunk remounted around it, leaving it resting under
// the road surface (visible as "only the top half of the car shows").
// Seeding here, at module scope, means the first frame already knows where the
// player is, so the ground under the spawn is never thrown away.
//
// `py` is the player's own altitude — written by Player.tsx while on foot
// (cars/bikes/boats sit close enough to 0 that they don't bother). It exists
// only for lib/player.ts's mount-range scan: without it, a plane or
// helicopter flying overhead reads as "in range, press E" from directly
// underneath on the ground, because the scan only ever compared x/z.
export const worldState = { px: 0, pz: 0, py: 0, heading: 0 };

if (typeof window !== "undefined") {
  try {
    const raw = localStorage.getItem("ncd_web_save_v1");
    if (raw) {
      const save = JSON.parse(raw);
      const spawn = save?.active && save.active !== "foot" ? save.vehicles?.[save.active] : null;
      if (spawn) {
        worldState.px = spawn.x;
        worldState.pz = spawn.z;
        worldState.heading = spawn.h;
      }
    }
  } catch {
    // unreadable save — the (0,0) default is fine, that's where a new game starts
  }
}
