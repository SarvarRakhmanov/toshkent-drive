import { SHORE_X } from "@/lib/marina";

// Last line of defence against a vehicle ending up under the world.
//
// The chunk streamer builds ground a few chunks at a time, so there are
// windows — a page load, a long stall, a teleport to somewhere not yet
// streamed — where a kinematic body can step down through a gap. Once it is
// below the ground box the ground is ABOVE it, `computedGrounded()` never goes
// true again, and the constant gravity in each vehicle's loop just keeps
// integrating: the observed failure was y = -65,000 with the fall speed still
// climbing, i.e. the car was gone for good and only a reload brought it back.
//
// The ground plane sits at y=0 (a 1-unit box centred at -0.5), so anything
// this far under it is not "on a slope" or "in a dip", it is out of the world.
export const VOID_Y = -12;

/**
 * True when the body has dropped out of the world and should be put back on
 * the surface at the same x/z — it reappears on the road it fell through,
 * which is where the player still is, rather than being yanked across the city.
 *
 * `x` matters because open water has no ground either, so a car driven into
 * the sea also "falls out of the world" — but that case already belongs to
 * each vehicle's drown handler, which respawns it ON LAND after DROWN_LIMIT.
 * Gravity reaches VOID_Y in ~1.4s and DROWN_LIMIT is 2s, so without this gate
 * the guard fires FIRST and bounces the car back up in the middle of the sea,
 * over and over, until the drown timer finally wins. Past the shore this
 * returns false and the drown handler owns the recovery.
 */
export function fellOutOfWorld(y: number, x: number): boolean {
  return y < VOID_Y && x < SHORE_X;
}
