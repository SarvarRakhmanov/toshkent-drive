// Manhattan route along the city's road grid — roads run at every coordinate
// ≡ 50 mod 100 (see City.tsx CELL/ROAD_W, reused verbatim by Minimap.tsx).
// The grid is a complete, unobstructed lattice (no missing streets, no
// one-ways), so the shortest on-road path from A to B is always a straight
// hop to the nearest street, one turn at the cross-street nearest B, then a
// straight run in — no graph search needed, this one-turn route already IS
// the shortest path.
const CELL = 100;
const ROAD = 50; // City.tsx: asphalt centred on coord ≡ 50 (mod 100)

function nearestRoad(v: number) {
  return Math.round((v - ROAD) / CELL) * CELL + ROAD;
}

export interface RoutePoint {
  x: number;
  z: number;
}

export function roadRoute(sx: number, sz: number, ex: number, ez: number): RoutePoint[] {
  const nsRoad = nearestRoad(sx); // N-S street entered near the start
  const ewRoad = nearestRoad(ez); // E-W street nearest the destination
  return [
    { x: sx, z: sz },
    { x: nsRoad, z: sz },
    { x: nsRoad, z: ewRoad },
    { x: ex, z: ewRoad },
    { x: ex, z: ez },
  ];
}
