// Phase 2 of lib/interiors.ts: a spread of ordinary enterable buildings
// beyond VENU (components/EnterableBuildings.tsx renders these). Block-center
// placement (k*100+50, m*100+50) — CELL=100/ROAD_W=20 in City.tsx means a
// road occupies the 20 units either side of every multiple of 100, so +50
// lands mid-block clear of a road centerline, same trick POLICE HARBOR's own
// comment (lib/landmarks.ts) documents. Interior "pockets" are a separate row
// out past CLUB_IN (lib/club.ts, at x=-50,z=-4050) — z=-4400 keeps 300+ units
// clear of it — self-contained rooms with their own floor, not reliant on the
// chunk streamer the way the real map is.
export interface BuildingSpot {
  id: string;
  displayName: string;
  ext: { x: number; z: number }; // exterior world position (block center)
  w: number;
  d: number;
  h: number;
  color: string; // exterior wall tint
  signColor: string;
  pocket: { x: number; z: number }; // interior room world position
  roomW: number;
  roomD: number;
  hospital?: boolean; // red-cross treatment instead of the plain sign
}

const P = (i: number) => ({ x: -660 + i * 120, z: -4400 }); // interior pocket row, spaced clear of each other

export const BUILDING_SPOTS: BuildingSpot[] = [
  { id: "hospital", displayName: "MERCY GENERAL", ext: { x: 250, z: 250 }, w: 34, d: 24, h: 18, color: "#e8ecf0", signColor: "#ff3b3b", pocket: P(0), roomW: 20, roomD: 16, hospital: true },
  { id: "cornerStore", displayName: "QUIK-STOP", ext: { x: 250, z: -50 }, w: 16, d: 14, h: 6, color: "#2f7dd4", signColor: "#ffd12f", pocket: P(1), roomW: 12, roomD: 10 },
  { id: "gym", displayName: "IRON YARD GYM", ext: { x: -250, z: 250 }, w: 22, d: 18, h: 8, color: "#2a2a30", signColor: "#ff6a2f", pocket: P(2), roomW: 16, roomD: 14 },
  { id: "bank", displayName: "FIRST NEON BANK", ext: { x: -250, z: -50 }, w: 24, d: 20, h: 12, color: "#d8d4c0", signColor: "#2fbd6e", pocket: P(3), roomW: 16, roomD: 14 },
  { id: "pizzeria", displayName: "TONY'S PIZZERIA", ext: { x: 350, z: 50 }, w: 16, d: 14, h: 7, color: "#c94a2f", signColor: "#ffd12f", pocket: P(4), roomW: 12, roomD: 10 },
  { id: "electronics", displayName: "CIRCUIT CITY", ext: { x: -350, z: 50 }, w: 18, d: 16, h: 8, color: "#1c1c22", signColor: "#2fe9ff", pocket: P(5), roomW: 14, roomD: 12 },
  { id: "barber", displayName: "CLIP JOINT", ext: { x: 50, z: 250 }, w: 14, d: 12, h: 6, color: "#e0e0e4", signColor: "#ff3fd6", pocket: P(6), roomW: 10, roomD: 9 },
  { id: "bar", displayName: "THE RUSTBUCKET", ext: { x: 50, z: -250 }, w: 18, d: 16, h: 7, color: "#3a2a20", signColor: "#ff8a2a", pocket: P(7), roomW: 13, roomD: 11 },
  { id: "pawnShop", displayName: "QUICK CASH PAWN", ext: { x: 350, z: -250 }, w: 16, d: 14, h: 6, color: "#5a4a30", signColor: "#ffd12f", pocket: P(8), roomW: 11, roomD: 10 },
  { id: "officeTower", displayName: "MERIDIAN TOWER", ext: { x: -350, z: -250 }, w: 28, d: 24, h: 40, color: "#a8c0d8", signColor: "#2fe9ff", pocket: P(9), roomW: 18, roomD: 16 },
  { id: "cinema", displayName: "NEON CINEMA", ext: { x: 250, z: 450 }, w: 26, d: 20, h: 10, color: "#1a1420", signColor: "#b06bff", pocket: P(10), roomW: 16, roomD: 14 },
  { id: "laundromat", displayName: "SUDS LAUNDROMAT", ext: { x: -250, z: 450 }, w: 14, d: 12, h: 6, color: "#e8e8ec", signColor: "#2fbd6e", pocket: P(11), roomW: 10, roomD: 9 },
];
