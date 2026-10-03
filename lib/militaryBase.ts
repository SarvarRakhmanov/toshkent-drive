import { DECK_X1, HWY_Z, DECK_H } from "@/lib/highway";

// FORT NEON — a fortified compound built on its own platform out over open
// water, at the far end of I-94's sea bridge (lib/highway.ts). Deliberately
// NOT anywhere near downtown/VENU/the airport — the whole point was "all the
// way from the sea," reachable only by crossing the bridge (or by boat/air).
// BASE_X is the bridge's own east end (DECK_X1) plus this compound's own
// half-width, so the platform's west wall/gate lands flush against the
// bridge deck — drive off the bridge straight into the gate, no gap, no
// second ramp.
export const FENCE_X = 220; // half-width — 440x440m platform
export const FENCE_Z = 220;
export const BASE_X = DECK_X1 + FENCE_X;
export const BASE_Z = HWY_Z;
// The whole compound sits on its own platform at deck height — there is no
// ground out here (components/Water.tsx's plane covers everything past
// LAND_EDGE_X=550), so unlike components/Airport.tsx (built on real,
// already-solid city chunks) this platform needs its own full-footprint
// collider — see components/MilitaryBase.tsx's Platform().
export const PLATFORM_Y = DECK_H;

export const WALL_H = 5.2; // taller than the airport's chain-link — a real precast concrete wall, not just a fence
export const TOWER_INSET = 18; // corner guard towers pulled in from the true corner

// Gate on the WEST wall — the side facing the bridge/mainland. Unlike
// components/Airport.tsx's gate (offset to land on a city road centreline),
// this one is centred on local z=0: BASE_Z equals lib/highway.ts's own
// HWY_Z, so z=0 here IS the bridge deck's centreline — driving straight off
// the bridge has to go straight through the gate, not into solid wall
// alongside it.
export const GATE_CZ = 0;
export const GATE_HALF = 24; // 48m opening — narrower than the airport's, reads as tighter/harder to get into
export const GATE_Z0 = GATE_CZ - GATE_HALF;
export const GATE_Z1 = GATE_CZ + GATE_HALF;

// ---- interior layout (all local to BASE_X/BASE_Z, all at platform height) ----
// Laid out in clean depth bands from the gate (x=-220) inward, each with
// generous clearance from its neighbours — a real base road you drive
// straight down, with distinct zones off to each side, not everything
// crammed edge-to-edge:
//   x -220..-160  gate apron, kept clear
//   x -160..-20   motor pool: 2 warehouses flanking a tank formation lane
//   x  -20..60    helipads (either side of the lane)
//   x   60..140   barracks
//   x  140..210   parked-jets apron

// A real motor pool: two big warehouses flanking an open lane, tanks parked
// in a formation down the middle — "parked in a certain way," not scattered.
export const WAREHOUSES: { x: number; z: number; w: number; d: number; h: number }[] = [
  { x: -90, z: -120, w: 110, d: 50, h: 17 },
  { x: -90, z: 120, w: 110, d: 50, h: 17 },
];

// 9 decorative parked tanks in a real 3x3 grid, all facing the gate (west) as
// if ready to roll out — plus one dedicated, obviously-the-drivable-one spot
// further down the road (TANK_SPAWN, components/Tank.tsx).
export const TANK_FORMATION: { x: number; z: number; h: number }[] = (() => {
  const spots: { x: number; z: number; h: number }[] = [];
  for (const z of [-25, 0, 25]) for (const x of [-140, -90, -40]) spots.push({ x, z, h: -Math.PI / 2 });
  return spots;
})();
export const TANK_SPAWN = { x: 0, z: 0 };

export const HELIPAD_POS: { x: number; z: number }[] = [
  { x: 20, z: -70 },
  { x: 20, z: 70 },
];
export const BARRACKS: { x: number; z: number; w: number; d: number; h: number }[] = [
  { x: 100, z: -40, w: 50, d: 18, h: 8 },
  { x: 100, z: 40, w: 50, d: 18, h: 8 },
];
export const TOWER_POS = [
  { x: -(FENCE_X - TOWER_INSET), z: -(FENCE_Z - TOWER_INSET) },
  { x: FENCE_X - TOWER_INSET, z: -(FENCE_Z - TOWER_INSET) },
  { x: -(FENCE_X - TOWER_INSET), z: FENCE_Z - TOWER_INSET },
  { x: FENCE_X - TOWER_INSET, z: FENCE_Z - TOWER_INSET },
];

// Render scale for components/FighterJet.tsx's mesh on this apron — shared by
// the drivable jets (components/DrivableFighterJet.tsx) and by
// lib/flightPhysics.ts's FIGHTER_JET_HANDLING.groundClearance, which is
// derived from it (1.1 * JET_SCALE). Lives here rather than in
// components/MilitaryBase.tsx so those callers can't drift from each other.
export const JET_SCALE = 2.3;

// Big parked jets apron — deepest part of the compound, clear of everything else.
export const JET_APRON: { x: number; z: number; h: number }[] = [
  { x: 175, z: -80, h: Math.PI / 2 },
  { x: 175, z: 0, h: Math.PI / 2 },
  { x: 175, z: 80, h: -Math.PI / 2 },
];

// True ground height at (x,z) if it's inside the compound's footprint, else
// null — see lib/highway.ts's highwayGroundY for why this needs to exist
// separately from the loose isOnBridgeOrBase check (lib/marina.ts).
export function baseGroundY(x: number, z: number): number | null {
  if (x > BASE_X - FENCE_X && x < BASE_X + FENCE_X && z > BASE_Z - FENCE_Z && z < BASE_Z + FENCE_Z) return PLATFORM_Y;
  return null;
}
