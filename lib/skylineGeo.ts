import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// v1.7 distant Tashkent skyline — one merged, vertex-coloured mesh (1 draw
// call) of low-poly silhouettes placed on a ring around the camera:
//   TV Tower (north), Minor Mosque (north-north-west), Tashkent City + Nest
//   One (west), Hotel Uzbekistan (east), the Chimgan / Western Tian Shan
//   ridge (north-east to east, snow caps), plus low distant city blocks
//   filling the rest of the horizon. Bearings follow the real city as seen
//   from Amir Temur square (game north = -z, east = +x).
// Attributes: color (rgb), glow (night window/beacon emission 0..1).

export const SKYLINE_R = 330; // ring radius (m), inside the 400 m camera far plane

type Part = THREE.BufferGeometry;
const parts: Part[] = [];

function paint(g: THREE.BufferGeometry, col: THREE.ColorRepresentation, glow = 0, topCol?: THREE.ColorRepresentation, snowLine?: number) {
  const ng = g.index ? g.toNonIndexed() : g;
  const pos = ng.getAttribute("position");
  const c = new THREE.Color(col), t = topCol ? new THREE.Color(topCol) : null;
  const cols = new Float32Array(pos.count * 3), gl = new Float32Array(pos.count);
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.count; i++) { y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i)); }
  for (let i = 0; i < pos.count; i++) {
    const k = (pos.getY(i) - y0) / Math.max(1e-6, y1 - y0);
    const cc = t ? (snowLine !== undefined ? (k > snowLine ? t : c) : c.clone().lerp(t, k)) : c;
    cols[i * 3] = cc.r; cols[i * 3 + 1] = cc.g; cols[i * 3 + 2] = cc.b;
    gl[i] = glow;
  }
  ng.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  ng.setAttribute("glow", new THREE.BufferAttribute(gl, 1));
  ng.deleteAttribute("uv");
  ng.deleteAttribute("normal");
  return ng;
}

/** place a part at bearing (deg from north, clockwise), extra distance, lateral offset */
function put(g: THREE.BufferGeometry, bearing: number, dist = 0, lateral = 0, rotY = 0) {
  const b = (bearing * Math.PI) / 180;
  const r = SKYLINE_R + dist;
  const fx = Math.sin(b), fz = -Math.cos(b); // outward
  const rx = Math.cos(b), rz = Math.sin(b); // to the right
  g.rotateY(-b + rotY); // face the camera
  g.translate(fx * r + rx * lateral, 0, fz * r + rz * lateral);
  parts.push(g);
}

const box = (w: number, h: number, d: number, y = 0) => new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);
const cyl = (r0: number, r1: number, h: number, y = 0, seg = 10) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, true).translate(0, y + h / 2, 0);
const dome = (r: number, y: number, seg = 14) => new THREE.SphereGeometry(r, seg, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, y, 0);
const cone = (r: number, h: number, y: number, seg = 8) => new THREE.ConeGeometry(r, h, seg).translate(0, y + h / 2, 0);

function tvTower() {
  // Tashkent TV Tower: three splayed legs, slim shaft, observation pod, spire
  const g: Part[] = [];
  for (let i = 0; i < 3; i++) {
    const leg = new THREE.CylinderGeometry(0.35, 0.9, 16, 5).translate(0, 8, 0);
    leg.rotateZ(0.22).translate(-3.2, 0, 0).rotateY((i * Math.PI * 2) / 3);
    g.push(paint(leg, "#8a94a3"));
  }
  g.push(paint(cyl(1.1, 0.75, 34, 14, 8), "#9aa4b2"));
  g.push(paint(cyl(2.6, 2.6, 2.4, 30, 12), "#3d4a5c", 0.6)); // pod (lit windows at night)
  g.push(paint(cyl(2.0, 2.0, 1.4, 34, 12), "#5b6778", 0.4));
  g.push(paint(cyl(0.5, 0.12, 18, 48, 6), "#c7ccd4"));
  g.push(paint(box(0.5, 0.6, 0.5, 66), "#ff3030", 1)); // aviation beacon
  return mergeGeometries(g)!;
}

function minorMosque() {
  // white marble Minor Mosque: main hall, sky-blue dome on a drum, 2 minarets
  const g: Part[] = [];
  g.push(paint(box(22, 7, 12), "#e8e6df", 0.15));
  g.push(paint(box(9, 11, 3, 0), "#ece9e2", 0.1)); // portal (peshtak)
  g.push(paint(cyl(4.2, 4.2, 3, 7, 14), "#e4e1d9"));
  g.push(paint(dome(4.6, 10), "#4fb2d8", 0, "#8ed3ee"));
  g.push(paint(cone(0.25, 2.2, 14.4, 6), "#d9c27a"));
  for (const x of [-13, 13]) {
    const m = cyl(1.0, 0.75, 22, 0, 10).translate(x, 0, 0);
    g.push(paint(m, "#efece4"));
    g.push(paint(cyl(1.25, 1.25, 1.2, 20, 10).translate(x, 0, 0), "#d8d4c9", 0.3));
    g.push(paint(dome(0.9, 22.2, 10).translate(x, 0, 0), "#4fb2d8"));
  }
  return mergeGeometries(g)!;
}

function nestOne() {
  // Nest One: tallest tower in Tashkent City — slim glass slab with a split crown
  const g: Part[] = [];
  g.push(paint(box(8, 56, 8), "#5f7fa3", 0.55, "#9fc1e0"));
  g.push(paint(box(3.5, 8, 7, 56).translate(-2.2, 0, 0), "#7d9cc0", 0.3));
  g.push(paint(box(3.5, 5, 7, 56).translate(2.2, 0, 0), "#7d9cc0", 0.3));
  g.push(paint(box(0.4, 6, 0.4, 64).translate(-2.2, 0, 0), "#d0d6de"));
  return mergeGeometries(g)!;
}

function tashkentCity() {
  const g: Part[] = [];
  const towers: [number, number, number, number, string][] = [
    [-16, 6, 34, 7, "#6d8aa8"], [-8, -4, 42, 6, "#4f6f92"], [10, 3, 38, 7, "#7894b0"], [18, -6, 28, 9, "#5d7a99"], [26, 4, 22, 8, "#8aa2ba"], [-26, -2, 24, 8, "#7a91a8"],
  ];
  for (const [x, z, h, w, c] of towers) g.push(paint(box(w, h, w).translate(x, 0, z), c, 0.5, "#b6cde3"));
  // Hilton / congress hall low block
  g.push(paint(box(30, 9, 10).translate(0, 0, 10), "#9aa7b4", 0.4));
  return mergeGeometries(g)!;
}

function hotelUzbekistan() {
  // Hotel Uzbekistan: 17-storey concave slab with the oriental brise-soleil grid
  const g: Part[] = [];
  const W = 34, H = 26, n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / (n - 1) - 0.5) * 0.9; // concave curve
    const seg = box(W / n + 0.2, H, 3).translate(Math.sin(a) * 22, 0, -Math.cos(a) * 22 + 22);
    seg.rotateY(0); // keep
    g.push(paint(seg, "#e3dccb", 0.45, "#efe9da"));
  }
  g.push(paint(box(W + 4, 1.4, 5, H), "#cfc6b2"));
  g.push(paint(box(10, 3, 6, H + 1.4), "#d8d0bd", 0.2));
  return mergeGeometries(g)!;
}

function mountains() {
  // Chimgan / Big Chimgan + Western Tian Shan ridge: jagged strip, snow caps
  const g: Part[] = [];
  const seg = 70;
  const span = 100; // degrees of horizon covered (bearing 15..115)
  const pos: number[] = [];
  const peak = (t: number) => {
    const big = Math.exp(-(((t - 0.42) / 0.06) ** 2)) * 46; // Big Chimgan
    const ridge = 22 + 14 * Math.sin(t * 17.3) * Math.sin(t * 5.1 + 1) + 8 * Math.sin(t * 41.7);
    return Math.max(12, (ridge + big) * 1.3) * (0.55 + 0.45 * Math.sin(Math.PI * t));
  };
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg, t1 = (i + 1) / seg;
    const h0 = peak(t0), h1 = peak(t1);
    const b0 = ((15 + span * t0) * Math.PI) / 180, b1 = ((15 + span * t1) * Math.PI) / 180;
    const R = SKYLINE_R + 40;
    const p = (b: number, y: number) => [Math.sin(b) * R, y, -Math.cos(b) * R];
    const a0 = p(b0, -4), a1 = p(b1, -4), c0 = p(b0, h0), c1 = p(b1, h1);
    pos.push(...a0, ...a1, ...c0, ...a1, ...c1, ...c0); // CCW seen from the ring centre
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const col = new Float32Array(pos.length), gl = new Float32Array(pos.length / 3);
  const rock = new THREE.Color("#6f7d92"), snow = new THREE.Color("#f2f5fa"), base = new THREE.Color("#8d9aae");
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    const c = y > 42 ? snow : y > 4 ? rock.clone().lerp(base, 0.4) : base;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("glow", new THREE.BufferAttribute(gl, 1));
  g.push(geo);
  return g[0];
}

function lowCity(seed: number, n: number) {
  // generic distant mid/low-rise blocks (panel houses, mahalla roofs)
  const g: Part[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const w = 6 + rnd() * 14, h = 4 + rnd() * (rnd() < 0.15 ? 22 : 10);
    const x = (rnd() - 0.5) * 80;
    const c = new THREE.Color().setHSL(0.58 + rnd() * 0.06, 0.08 + rnd() * 0.1, 0.5 + rnd() * 0.15);
    g.push(paint(box(w, h, 4 + rnd() * 6).translate(x, 0, rnd() * 10), c, 0.35));
  }
  return mergeGeometries(g)!;
}

let cached: THREE.BufferGeometry | null = null;
export function buildSkyline(): THREE.BufferGeometry {
  if (cached) return cached;
  parts.length = 0;
  // filler city all round the horizon (skipping the mountain sector's base a bit)
  for (let b = 0; b < 360; b += 24) put(lowCity(1000 + b, 7), b + 6, 6);
  put(tvTower(), 352, -6);
  put(minorMosque(), 335, -18);
  put(tashkentCity(), 268, -10);
  put(nestOne(), 276, -16);
  put(hotelUzbekistan(), 92, -24);
  parts.push(mountains());
  cached = mergeGeometries(parts)!;
  cached.computeBoundingSphere();
  return cached;
}
