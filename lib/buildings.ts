export type Building = { x: number; z: number; w: number; h: number; d: number };

// ponytail: deterministic seeded grid, not a real city layout — placeholder
// until buffalodataa.geojson has actual Buffalo building footprints in it.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COUNT = 500;
const GRID = 23; // 23*23 = 529, sliced to 500
const SPACING = 26;

export const BUILDINGS: Building[] = (() => {
  const rand = mulberry32(1337);
  const list: Building[] = [];
  for (let i = 0; i < GRID * GRID && list.length < COUNT; i++) {
    const gx = i % GRID;
    const gz = Math.floor(i / GRID);
    list.push({
      x: (gx - GRID / 2) * SPACING + (rand() - 0.5) * 8,
      z: (gz - GRID / 2) * SPACING + (rand() - 0.5) * 8,
      w: 8 + rand() * 10,
      d: 8 + rand() * 10,
      h: 10 + rand() * 40,
    });
  }
  return list;
})();

// Used by lib/flightPhysics.ts callers (Plane.tsx/Helicopter.tsx/
// DrivableAirliner.tsx) so an aircraft descending onto a building's footprint
// lands on the roof instead of falling straight through it. Linear scan over
// 500 boxes is trivial at 6 aircraft/frame — no spatial index needed.
export function roofHeightAt(x: number, z: number): number {
  let best = 0;
  for (const b of BUILDINGS) {
    if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2 && b.h > best) best = b.h;
  }
  return best;
}
