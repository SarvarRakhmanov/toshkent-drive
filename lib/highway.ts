// I-94 — a sea bridge, not an inland overpass. One ramp climbs up from solid
// ground on the west/land side; the deck then runs 950m straight east,
// crossing the shoreline (LAND_EDGE_X=550, lib/marina.ts) into open water
// (components/Water.tsx's plane covers everything past that), and ends flush
// against FORT NEON's own platform (lib/militaryBase.ts) at the same deck
// height — no second ramp back down, because there's no ground out there to
// ramp down TO. HWY_Z is chosen well clear of every existing landmark
// (EAST MARINA/POLICE HARBOR sit at z=50/90, HARBOR LAKE at z=-250).
export const HWY_Z = -400;
export const HWY_W = 26; // deck width — 2 lanes + shoulders
export const DECK_H = 9; // deck/platform height above ground or water
export const RAMP_THICK = 1.6; // deck/ramp slab thickness

export const RAMP_X0 = 400; // ramp base, on solid land (city chunk ci=4)
export const RAMP_X1 = 500; // top of ramp — also the deck's west end (chunk ci=5, last land chunk before open water)
export const DECK_X0 = RAMP_X1;
export const DECK_X1 = 1450; // deck's east end — meets FORT NEON's platform (lib/militaryBase.ts's BASE_X - FENCE_X)

const CELL = 100; // components/City.tsx CELL
// Only the ramp's footprint sits on real, rendered land chunks (ci 4-5) —
// everything east of ci=6 is open water that City.tsx already skips
// generating chunks for (see City()'s `if (ci >= SHORE_CI) return null`), so
// there's nothing to exempt out there.
export const HIGHWAY_CHUNKS = new Set<string>();
{
  const cj = Math.round(HWY_Z / CELL);
  for (let ci = Math.round(RAMP_X0 / CELL); ci <= Math.round(RAMP_X1 / CELL); ci++) HIGHWAY_CHUNKS.add(`${ci},${cj}`);
}

// True ground height at (x,z) if it's over the ramp or deck, else null (not
// over the corridor at all). Used to spawn a vehicle at the correct
// elevation when its saved position lands on the bridge — every land
// vehicle's initial RigidBody position used to hardcode a sea-level ride
// height regardless of where its save actually put it, which meant a car
// saved while parked on the deck would spawn back at y≈1 on reload, well
// under the real deck surface, and fall straight through into the water.
// Deliberately tighter than lib/marina.ts's isOnBridgeOrBase (that one's
// z-band alone, with no lower x bound, is fine for "skip the water clamp"
// but would wrongly report DECK_H for ordinary ground west of the ramp).
export function highwayGroundY(x: number, z: number): number | null {
  if (z < HWY_Z - HWY_W / 2 || z > HWY_Z + HWY_W / 2) return null;
  if (x < RAMP_X0) return null;
  if (x <= RAMP_X1) return ((x - RAMP_X0) / (RAMP_X1 - RAMP_X0)) * DECK_H;
  if (x <= DECK_X1) return DECK_H;
  return null;
}
