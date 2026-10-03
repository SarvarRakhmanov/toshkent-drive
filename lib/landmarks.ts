// Exact positions/colors from the original's LANDMARKS array. The original
// builds a distinct structure per landmark (park, stadium, tower, plaza,
// club, marina, police station); this build marks each spot with a beacon +
// label for now and reserves the coordinates — the actual structures
// (club interior, police station, etc.) are later milestones that slot in
// at these same coordinates rather than picking new ones.
export interface Landmark {
  name: string;
  x: number;
  z: number;
  col: string;
}

export const LANDMARKS: Landmark[] = [
  { name: "VENU", x: 0, z: -84.5 }, // CLUB.cx=0, CLUB.cz=-100, door at z+15.5 (see lib/club.ts)
  { name: "AVTO BOZOR", x: -48, z: 20, col: "#00e5ff" },
  { name: "AMIR TEMUR XIYOBONI", x: 150, z: 150, col: "#3fdd66" },
  { name: "BUNYODKOR STADIONI", x: -150, z: 150, col: "#4fd8ff" },
  { name: "TOSHKENT MINORASI", x: 150, z: -150, col: "#dfe4ff" },
  { name: "MUSTAQILLIK MAYDONI", x: -150, z: -150, col: "#b06bff" },
  { name: "ANHOR KO'LI", x: 50, z: -250, col: "#2fb8ff" },
  { name: "CHORVOQ MARINA", x: 566, z: 50, col: "#2fe8ff" }, // original: SHORE_X-34, SHORE_X=600
  // moved off the original's raw (450,50) — that point sits exactly on the
  // chunk-grid road intersection (both x=450 and z=50 are road centerlines,
  // see City.tsx's CELL/ROAD_W), so the station was literally built in the
  // middle of the road. (490,90) is the nearest fully-clear interior block —
  // same corner of the map, just off the pavement.
  { name: "IIB POST", x: 490, z: 90, col: "#2452ff" },
  { name: "TASHKENT CITY", x: -100, z: 0, col: "#ffd76a" },
  { name: "CHILONZOR", x: 0, z: 100, col: "#1e8f7b" },
  { name: "MIZU 21", x: 100, z: 0, col: "#f4c430" },
  // chunk (-8,1) — round(-750/100)=-8, round(100/100)=1 — free: every other
  // landmark rounds to (0,-1)/(0,0)/(2,2)/(-2,2)/(2,-2)/(-2,-2)/(1,-3)/(6,1)/
  // (5,1)/(1,0), none of them (-8,1). See components/Airport.tsx for the
  // whole-chunk layout built around this coordinate. 450m further west than
  // its original -300 anchor, so it reads as a real trip from VENU instead
  // of sitting right next door.
  { name: "TOSHKENT AEROPORTI", x: -750, z: 100, col: "#8fd6ff" },
  // FORT NEON — a fortified compound out on its own platform at the far end
  // of I-94's sea bridge (see lib/militaryBase.ts's BASE_X/BASE_Z, lib/
  // highway.ts, components/MilitaryBase.tsx) — deliberately far from every
  // other landmark, reachable only by crossing the bridge (or by boat/air)
  { name: "FORT NEON", x: 1670, z: -400, col: "#8a9a4a" },
].map((l) => ({ col: "#ff3fd6", ...l })) as Landmark[];
