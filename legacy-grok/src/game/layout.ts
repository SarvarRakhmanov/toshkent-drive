/** Central Tashkent slice around Amir Temur Square.
 *  Real anchor: 41.31143 N, 69.27966 E.
 *  The square keeps its real arrangement (gardens, monument, perimeter
 *  boulevards, hotel to the east, Sayilgoh to the west). Farther landmarks
 *  are compressed into this ~520 m district so they are driveable.
 *  +X east, +Z south, +Y up. Yaw 0 faces north (−Z).
 */

export const WORLD = 900;

export const XS = [-168, -76, 76, 168] as const;
export const ZS = [-168, -76, 76, 168] as const;

export type Paved = { x: number; z: number; w: number; d: number };

export const ROADS: Paved[] = [
  { x: 0, z: -76, w: WORLD, d: 22 },
  { x: 0, z: 76, w: WORLD, d: 22 },
  { x: -76, z: 0, w: 22, d: WORLD },
  { x: 76, z: 0, w: 22, d: WORLD },
  { x: 0, z: -168, w: WORLD, d: 16 },
  { x: 0, z: 168, w: WORLD, d: 16 },
  { x: -168, z: 0, w: 16, d: WORLD },
  { x: 168, z: 0, w: 16, d: WORLD },
];

/** Shoulder bays and station pads that are legal to drive. */
export const LOTS: Paved[] = [
  { x: 18, z: 118, w: 38, d: 30 },
  { x: 18, z: 96, w: 9, d: 22 },
  { x: -198, z: -108, w: 34, d: 26 },
  { x: -180, z: -108, w: 16, d: 10 },
];

export const PAVED: Paved[] = [...ROADS, ...LOTS];

export type Poi = {
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
};

export const POIS: Poi[] = [
  { id: "amir", name: "Amir Temur xiyoboni", x: 0, z: 0, r: 22 },
  { id: "hotel", name: "Hotel Uzbekistan", x: 124, z: 0, r: 20 },
  { id: "sayil", name: "Sayilgoh", x: -118, z: 0, r: 18 },
  { id: "majlis", name: "Oliy Majlis", x: 0, z: -214, r: 22 },
  { id: "tower", name: "Toshkent minorasi", x: 214, z: -214, r: 20 },
  { id: "fuel", name: "Yoqilg'i", x: -198, z: -108, r: 16 },
  { id: "park", name: "Avtoturargoh", x: 18, z: 118, r: 16 },
  { id: "servis", name: "Servis", x: -8, z: 124, r: 12 },
  { id: "minor", name: "Minor", x: 200, z: 40, r: 14 },
  { id: "mustaqillik", name: "Mustaqillik maydoni", x: 0, z: -310, r: 18 },
  { id: "chorsu", name: "Chorsu", x: 8, z: 260, r: 16 },
  { id: "anhor", name: "Anhor", x: -400, z: 20, r: 14 },
  { id: "osh", name: "Oshxona", x: -176, z: -148, r: 12 },
];

export const SPAWN = { x: 18, z: 122, yaw: 0 };
export const PARK_BAY = { x: 30, z: 126, yaw: 0 };

export type Style = "plaster" | "soviet" | "glass" | "hotel" | "white" | "shop" | "stone";
export type TileId = "center" | "north" | "south" | "east" | "west";

export type Building = {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
  style: Style;
  tile: TileId;
};

export type TreeSpot = { x: number; z: number; k: "plane" | "poplar"; s: number; tile: TileId };
export type LampSpot = { x: number; z: number };
export type SignSpot = { x: number; z: number; yaw: number; text: string; kind: "info" | "stop" | "speed" | "warn" | "park" };

function tileOf(x: number, z: number): TileId {
  if (x > 170) return "east";
  if (x < -170) return "west";
  if (z < -170) return "north";
  if (z > 170) return "south";
  return "center";
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hits(x: number, z: number, w: number, d: number, b: { x: number; z: number; w: number; d: number }) {
  return Math.abs(x - b.x) * 2 < w + b.w && Math.abs(z - b.z) * 2 < d + b.d;
}

const EXCLUDE: Paved[] = [
  { x: 0, z: 0, w: 120, d: 120 },
  { x: 124, z: 0, w: 70, d: 78 },
  { x: -118, z: 0, w: 36, d: 100 },
  { x: 18, z: 118, w: 50, d: 46 },
  { x: 0, z: -214, w: 90, d: 55 },
  { x: 214, z: -214, w: 70, d: 70 },
  { x: -198, z: -108, w: 50, d: 40 },
  { x: -36, z: 124, w: 28, d: 26 },
  { x: 120, z: -124, w: 28, d: 26 },
  { x: 124, z: 124, w: 26, d: 24 },
];

export function handBuildings(): Building[] {
  const mid: Building[] = [
    { x: -36, z: -122, w: 28, d: 18, h: 26, rot: 0, style: "soviet", tile: "center" },
    { x: 28, z: -124, w: 22, d: 16, h: 18, rot: 0, style: "white", tile: "center" },
    { x: -40, z: 126, w: 22, d: 16, h: 22, rot: 0, style: "plaster", tile: "center" },
    { x: 120, z: -124, w: 22, d: 18, h: 34, rot: 0, style: "glass", tile: "center" },
    { x: 126, z: 122, w: 20, d: 16, h: 16, rot: 0, style: "stone", tile: "center" },
    { x: -124, z: -124, w: 24, d: 16, h: 20, rot: 0, style: "plaster", tile: "center" },
    { x: -122, z: 120, w: 26, d: 14, h: 14, rot: 0, style: "white", tile: "center" },
  ];
  const shops: Building[] = [];
  const colors: Style[] = ["shop", "shop", "shop", "shop", "shop", "shop"];
  for (let i = 0; i < colors.length; i++) {
    shops.push({
      x: -108,
      z: -42 + i * 16,
      w: 12,
      d: 14,
      h: 8 + (i % 3),
      rot: 0,
      style: "shop",
      tile: "center",
    });
  }
  return [...mid, ...shops];
}

export function outerBuildings(): Building[] {
  const rand = mulberry(2026);
  const bands = [
    [-420, -280],
    [-248, -186],
    [-152, -98],
    [98, 152],
    [186, 248],
    [280, 420],
  ];
  const out: Building[] = [];
  const styles: Style[] = ["plaster", "soviet", "white", "stone", "glass", "plaster"];
  for (const xb of bands) {
    for (const zb of bands) {
      if (Math.abs(xb[0]) < 170 && Math.abs(zb[0]) < 170) continue;
      const bw = xb[1] - xb[0];
      const bd = zb[1] - zb[0];
      const cols = bw > 50 ? 2 : 1;
      const rows = bd > 50 ? 2 : 1;
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const w = 14 + rand() * 12;
          const d = 12 + rand() * 10;
          const x = xb[0] + ((c + 0.5) * bw) / cols + (rand() - 0.5) * 4;
          const z = zb[0] + ((r + 0.5) * bd) / rows + (rand() - 0.5) * 4;
          const h = 10 + rand() * 22;
          const b = { x, z, w, d };
          if (EXCLUDE.some((e) => hits(x, z, w, d, e))) continue;
          if (PAVED.some((p) => hits(x, z, w + 6, d + 6, p))) continue;
          out.push({
            x,
            z,
            w,
            d,
            h,
            rot: 0,
            style: styles[(c + r + out.length) % styles.length]!,
            tile: tileOf(x, z),
          });
        }
      }
    }
  }
  return out;
}

export function treeSpots(): TreeSpot[] {
  const out: TreeSpot[] = [];
  const push = (x: number, z: number, k: TreeSpot["k"], s: number) => {
    if (PAVED.some((p) => Math.abs(x - p.x) < p.w / 2 + 1.2 && Math.abs(z - p.z) < p.d / 2 + 1.2)) return;
    if (Math.hypot(x, z) < 12) return;
    out.push({ x, z, k, s, tile: tileOf(x, z) });
  };
  for (let a = 0; a < 360; a += 11) {
    const rad = (a * Math.PI) / 180;
    const cardinal = a % 90 < 10 || a % 90 > 80;
    if (cardinal) continue;
    push(Math.cos(rad) * 26, Math.sin(rad) * 26, "plane", 0.9 + (a % 5) * 0.06);
    push(Math.cos(rad) * 42, Math.sin(rad) * 42, a % 2 ? "poplar" : "plane", 1);
  }
  const lanes = [
    { z: -96, x0: -420, x1: 420 },
    { z: -58, x0: -420, x1: 420 },
    { z: 58, x0: -420, x1: 420 },
    { z: 96, x0: -420, x1: 420 },
    { z: -184, x0: -420, x1: 420 },
    { z: -152, x0: -420, x1: 420 },
    { z: 152, x0: -420, x1: 420 },
    { z: 184, x0: -420, x1: 420 },
  ];
  for (const lane of lanes) {
    for (let x = lane.x0; x <= lane.x1; x += 18) {
      if (Math.abs(x) > 50 && Math.abs(x) < 100) continue;
      if (Math.abs(x - 18) < 12 && lane.z > 70 && lane.z < 110) continue;
      push(x, lane.z, Math.abs(x) % 36 < 18 ? "plane" : "poplar", 0.85 + (Math.abs(x) % 7) * 0.04);
    }
  }
  const cols = [
    { x: -96, z0: -420, z1: 420 },
    { x: -58, z0: -420, z1: 420 },
    { x: 58, z0: -420, z1: 420 },
    { x: 96, z0: -420, z1: 420 },
  ];
  for (const col of cols) {
    for (let z = col.z0; z <= col.z1; z += 18) {
      if (Math.abs(z) < 100 && Math.abs(z) > 50) continue;
      push(col.x, z, "plane", 0.95);
    }
  }
  return out;
}

export function lampSpots(): LampSpot[] {
  const out: LampSpot[] = [];
  for (let x = -420; x <= 420; x += 32) {
    out.push({ x, z: -90 });
    out.push({ x, z: 90 });
  }
  for (let z = -420; z <= 420; z += 32) {
    out.push({ x: -90, z });
    out.push({ x: 90, z });
  }
  return out;
}

export function signSpots(): SignSpot[] {
  return [
    { x: -62, z: 62, yaw: 0.8, text: "AMIR TEMUR\nXIYOBONI", kind: "info" },
    { x: 62, z: -62, yaw: -2.3, text: "TOSHKENT", kind: "info" },
    { x: 96, z: 8, yaw: Math.PI / 2, text: "HOTEL\nUZBEKISTAN", kind: "info" },
    { x: -96, z: -48, yaw: -Math.PI / 2, text: "SAYLGoh", kind: "info" },
    { x: 70, z: 92, yaw: 0, text: "50", kind: "speed" },
    { x: -92, z: 70, yaw: Math.PI / 2, text: "STOP", kind: "stop" },
    { x: 40, z: 70, yaw: 0, text: "PIYODALAR\nO'TISH JOYI", kind: "warn" },
    { x: 8, z: 100, yaw: 0, text: "AVTOTURARGOH", kind: "park" },
    { x: -168, z: -90, yaw: 0, text: "DIQQAT", kind: "warn" },
    { x: 150, z: -168, yaw: Math.PI, text: "OLIY MAJLIS", kind: "info" },
    { x: 168, z: -180, yaw: -Math.PI / 2, text: "TOSHKENT\nMINORASI", kind: "info" },
    { x: -176, z: -96, yaw: 0, text: "YOQILG'I", kind: "info" },
    { x: -20, z: 108, yaw: 0, text: "SERVIS", kind: "info" },
    { x: 88, z: -70, yaw: Math.PI, text: "40", kind: "speed" },
    { x: -168, z: -12, yaw: Math.PI / 2, text: "30", kind: "speed" },
    { x: 188, z: 28, yaw: Math.PI / 2, text: "MINOR", kind: "info" },
    { x: 12, z: -250, yaw: Math.PI, text: "MUSTAQILLIK", kind: "info" },
    { x: 24, z: 230, yaw: 0, text: "CHORSU", kind: "info" },
    { x: -150, z: -140, yaw: 0, text: "OSHXONA", kind: "info" },
  ];
}

export type Intersection = { x: number; z: number };

export function intersections(): Intersection[] {
  const list: Intersection[] = [];
  for (const x of XS) for (const z of ZS) list.push({ x, z });
  return list;
}

export type Pt = { x: number; z: number };

function edge(a: Pt, b: Pt, step = 8): Pt[] {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.round(len / step));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return pts;
}

/** Park-on-the-left circulation. laneOut > 0 pushes onto the outer lane. */
export function ringLoop(center: number, laneOut: number): Pt[] {
  const R = center + laneOut;
  const c: Pt[] = [
    { x: -R, z: R },
    { x: R, z: R },
    { x: R, z: -R },
    { x: -R, z: -R },
  ];
  const pts: Pt[] = [];
  for (let i = 0; i < 4; i++) pts.push(...edge(c[i]!, c[(i + 1) % 4]!));
  return pts;
}

/** Opposite flow, inner lane (negative laneOut). */
export function ringLoopReverse(center: number, laneIn: number): Pt[] {
  const R = center - laneIn;
  const c: Pt[] = [
    { x: R, z: R },
    { x: -R, z: R },
    { x: -R, z: -R },
    { x: R, z: -R },
  ];
  const pts: Pt[] = [];
  for (let i = 0; i < 4; i++) pts.push(...edge(c[i]!, c[(i + 1) % 4]!));
  return pts;
}

/** East–west boulevards beside the square, closed via the outer avenues. */
export function boulevardLoop(): Pt[] {
  const L = 4.2;
  const pts: Pt[] = [];
  pts.push(...edge({ x: -150, z: 76 + L }, { x: 168, z: 76 + L }));
  pts.push(...edge({ x: 168 + 3.2, z: 76 }, { x: 168 + 3.2, z: -76 }));
  pts.push(...edge({ x: 168, z: -76 - L }, { x: -168, z: -76 - L }));
  pts.push(...edge({ x: -168 - 3.2, z: -76 }, { x: -168 - 3.2, z: 76 }));
  return pts;
}

export function boulevardReverse(): Pt[] {
  const L = 4.2;
  const pts: Pt[] = [];
  pts.push(...edge({ x: 150, z: 76 - L }, { x: -168, z: 76 - L }));
  pts.push(...edge({ x: -168 + 3.2, z: 76 }, { x: -168 + 3.2, z: -76 }));
  pts.push(...edge({ x: -168, z: -76 + L }, { x: 168, z: -76 + L }));
  pts.push(...edge({ x: 168 - 3.2, z: -76 }, { x: 168 - 3.2, z: 76 }));
  return pts;
}

export function avenueLoop(): Pt[] {
  const L = 4.2;
  const pts: Pt[] = [];
  pts.push(...edge({ x: 76 + L, z: 200 }, { x: 76 + L, z: -200 }));
  pts.push(...edge({ x: 76, z: -168 - 3.2 }, { x: -76, z: -168 - 3.2 }));
  pts.push(...edge({ x: -76 - L, z: -200 }, { x: -76 - L, z: 200 }));
  pts.push(...edge({ x: -76, z: 168 + 3.2 }, { x: 76, z: 168 + 3.2 }));
  return pts;
}

export function avenueReverse(): Pt[] {
  const L = 4.2;
  const pts: Pt[] = [];
  pts.push(...edge({ x: 76 - L, z: -200 }, { x: 76 - L, z: 200 }));
  pts.push(...edge({ x: 76, z: 168 - 3.2 }, { x: -76, z: 168 - 3.2 }));
  pts.push(...edge({ x: -76 + L, z: 200 }, { x: -76 + L, z: -200 }));
  pts.push(...edge({ x: -76, z: -168 + 3.2 }, { x: 76, z: -168 + 3.2 }));
  return pts;
}

export function pathLength(pts: Pt[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  }
  const close = Math.hypot(pts[0]!.x - pts[pts.length - 1]!.x, pts[0]!.z - pts[pts.length - 1]!.z);
  cum.push(cum[cum.length - 1]! + close);
  return cum;
}

export function samplePath(pts: Pt[], cum: number[], dist: number, out: Pt) {
  const total = cum[cum.length - 1]!;
  let d = ((dist % total) + total) % total;
  let i = 1;
  while (i < cum.length - 1 && cum[i]! < d) i++;
  const a = pts[(i - 1) % pts.length]!;
  const b = pts[i % pts.length]!;
  const span = cum[i]! - cum[i - 1]!;
  const t = span > 0.001 ? (d - cum[i - 1]!) / span : 0;
  out.x = a.x + (b.x - a.x) * t;
  out.z = a.z + (b.z - a.z) * t;
}

export function onPaved(x: number, z: number) {
  for (const p of PAVED) {
    if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return true;
  }
  return false;
}

/** 50 on the boulevards, 40 on the outer avenues, 30 along Sayilgoh. */
export function speedLimit(x: number, z: number) {
  if (Math.abs(x + 118) < 28 && Math.abs(z) < 70) return 30;
  if (Math.abs(Math.abs(x) - 168) < 14 || Math.abs(Math.abs(z) - 168) < 14) return 40;
  return 50;
}

export const TILE_CENTERS: Record<TileId, Pt> = {
  center: { x: 0, z: 0 },
  north: { x: 0, z: -210 },
  south: { x: 0, z: 210 },
  east: { x: 210, z: 0 },
  west: { x: -210, z: 0 },
};
