// Big City map: slice 4 Sketchfab city packs into 68x68 m "block kits" that
// fill the interior of the game's 100 m road grid (see components/BigCity.tsx).
//   node scripts/build-bigcity.mjs          (ONLY=scene|city-a|hk-iv|hk)
// Per kit: buildings are found as connected triangle groups (bbox-merged
// across primitives), the source's own flat ground/road sheets are dropped,
// groups are binned into 68 m tiles by centre, and each tile is written as
//   block-<kit>-<n>.glb      textured, flattened + joined per material, simplified, webp, meshopt
//   block-<kit>-<n>-low.glb  vertex-colour baked (texture sampled per vertex), 1 material = 1 draw call
// plus public/models/bigcity/blocks.json (tile list, tris, cuboid colliders).
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { unweld, metalRough, dedup, flatten, join, weld, simplify, prune, textureCompress, meshopt, palette, cloneDocument, normals } from "@gltf-transform/functions";
import { io, MeshoptEncoder, MeshoptSimplifier, forEachTriangle } from "./bigcity-lib.mjs";
import { dropUnusedUVs } from "./gltf-helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "models-src", "bigcity");
const OUT = path.join(root, "public", "models", "bigcity");
const T = 68; // tile = block interior (m)
const KITS = [
  { id: "scene", file: "scene.glb", scale: 1, hi: 60000, lo: 12000 },
  { id: "citya", file: "city-a.glb", scale: 1, hi: 60000, lo: 12000 },
  { id: "hkiv", file: "hk-iv.glb", scale: 10, hi: 60000, lo: 12000, px: 512 },
  // hk is a facade-only street strip: keep only the tiles that are whole buildings
  { id: "hk", file: "hk.glb", scale: 0.05, hi: 60000, lo: 12000, px: 1024, drop: [0, 1, 2, 5] },
];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const tris = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((a, p) => a + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0), 0);
const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);

/** deterministic prep: no animations, no degenerate nodes, one mesh (with own prims) per node */
async function prep(doc) {
  for (const a of doc.getRoot().listAnimations()) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((x) => x.dispose()); a.dispose(); }
  for (const n of doc.getRoot().listNodes()) if (Math.abs(det3(n.getWorldMatrix())) < 1e-12) n.dispose();
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "KHR_materials_pbrSpecularGlossiness")) await doc.transform(metalRough());
  for (const mat of doc.getRoot().listMaterials()) {
    const tr = mat.getExtension("KHR_materials_transmission");
    if (tr) { mat.setExtension("KHR_materials_transmission", null); mat.setExtension("KHR_materials_volume", null); mat.setAlphaMode("BLEND"); const c = mat.getBaseColorFactor(); mat.setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 0.45)]); }
  }
  const used = new Map();
  for (const n of doc.getRoot().listNodes()) {
    const m = n.getMesh(); if (!m) continue;
    if (used.has(m)) { const c = m.clone(); for (const p of m.listPrimitives()) c.addPrimitive(p.clone()); for (const p of c.listPrimitives().slice(0, m.listPrimitives().length)) c.removePrimitive(p); n.setMesh(c); }
    else used.set(m, 1);
  }
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) if (p.getMode() !== 4) p.dispose();
}
function primList(doc) {
  const out = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    for (const prim of mesh.listPrimitives()) out.push({ node, prim });
  }
  return out;
}

function findGroups(doc, scale) {
  // components per prim (shared indices + positions quantized), then bbox merge
  const comps = []; // {pi, bb:[x0,y0,z0,x1,y1,z1]}
  const triComp = []; // per prim Int32Array tri -> comp id
  const prims = primList(doc);
  prims.forEach(({ node, prim }, pi) => {
    const m = node.getWorldMatrix();
    const pos = prim.getAttribute("POSITION"); const idx = prim.getIndices();
    const nv = pos.getCount(); const nt = (idx ? idx.getCount() : nv) / 3;
    const W = new Float32Array(nv * 3); const v = [0, 0, 0];
    for (let i = 0; i < nv; i++) {
      pos.getElement(i, v);
      W[i * 3] = (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) * scale;
      W[i * 3 + 1] = (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) * scale;
      W[i * 3 + 2] = (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) * scale;
    }
    // weld map by quantized position
    const key = new Map(); const rep = new Int32Array(nv);
    for (let i = 0; i < nv; i++) { const k = `${Math.round(W[i * 3] * 200)},${Math.round(W[i * 3 + 1] * 200)},${Math.round(W[i * 3 + 2] * 200)}`; let r = key.get(k); if (r === undefined) { r = i; key.set(k, i); } rep[i] = r; }
    const par = new Int32Array(nv).map((_, i) => i);
    const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const I = (t) => (idx ? idx.getScalar(t) : t);
    for (let t = 0; t < nt; t++) {
      const a = find(rep[I(t * 3)]), b = find(rep[I(t * 3 + 1)]), c = find(rep[I(t * 3 + 2)]);
      if (a !== b) par[b] = a; const a2 = find(a); if (a2 !== find(c)) par[find(c)] = a2;
    }
    const local = new Map(); const tc = new Int32Array(nt);
    for (let t = 0; t < nt; t++) {
      const r = find(rep[I(t * 3)]);
      let id = local.get(r);
      if (id === undefined) { id = comps.length; local.set(r, id); comps.push({ pi, bb: [1e9, 1e9, 1e9, -1e9, -1e9, -1e9], n: 0 }); }
      tc[t] = id; const bb = comps[id].bb; comps[id].n++;
      for (let k = 0; k < 3; k++) { const vi = I(t * 3 + k); for (let a = 0; a < 3; a++) { const x = W[vi * 3 + a]; if (x < bb[a]) bb[a] = x; if (x > bb[a + 3]) bb[a + 3] = x; } }
    }
    triComp.push(tc);
  });
  // bbox-overlap merge (grid accelerated), but never into a group wider than a tile
  const par = new Int32Array(comps.length).map((_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const G = 8; const grid = new Map();
  const flat = (bb) => bb[4] - bb[1] < 0.8 && (bb[3] - bb[0]) * (bb[5] - bb[2]) > 40;
  comps.forEach((c, i) => {
    if (flat(c.bb)) return;
    for (let gx = Math.floor(c.bb[0] / G); gx <= Math.floor(c.bb[3] / G); gx++) for (let gz = Math.floor(c.bb[2] / G); gz <= Math.floor(c.bb[5] / G); gz++) {
      const k = gx * 100000 + gz; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i);
    }
  });
  const gbb = comps.map((c) => c.bb.slice());
  const e = 0.02;
  for (const l of grid.values()) for (let x = 0; x < l.length; x++) for (let y = x + 1; y < l.length; y++) {
    const A = comps[l[x]].bb, B = comps[l[y]].bb;
    if (A[0] - e > B[3] || B[0] - e > A[3] || A[1] - e > B[4] || B[1] - e > A[4] || A[2] - e > B[5] || B[2] - e > A[5]) continue;
    const ra = find(l[x]), rb = find(l[y]); if (ra === rb) continue;
    const a = gbb[ra], b = gbb[rb];
    const u = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5])];
    if (u[3] - u[0] > T * 0.7 || u[5] - u[2] > T * 0.7) continue;
    par[rb] = ra; gbb[ra] = u;
  }
  for (const c of comps) c.dim = Math.max(c.bb[3] - c.bb[0], c.bb[4] - c.bb[1], c.bb[5] - c.bb[2]);
  const groupOf = comps.map((c, i) => (flat(c.bb) ? -1 : find(i)));
  return { prims, comps, triComp, groupOf, gbb };
}

/** keep only the triangles whose component group is in `keep` (Set of group ids) */
function filterDoc(doc, G, keep, minDim = 0) {
  const prims = primList(doc);
  prims.forEach(({ prim }, pi) => {
    const idx = prim.getIndices(); const tc = G.triComp[pi];
    const nt = tc.length; const out = [];
    for (let t = 0; t < nt; t++) if (keep.has(G.groupOf[tc[t]]) && G.comps[tc[t]].dim >= minDim) for (let k = 0; k < 3; k++) out.push(idx ? idx.getScalar(t * 3 + k) : t * 3 + k);
    if (!out.length) { prim.dispose(); return; }
    const nvMax = prim.getAttribute("POSITION").getCount();
    const arr = nvMax > 65535 ? new Uint32Array(out) : new Uint16Array(out);
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(arr).setBuffer(doc.getRoot().listBuffers()[0]));
  });
}

async function bakeVertexColors(doc) {
  const cache = new Map();
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const one = doc.createMaterial("bigcity-vc").setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial(); const f = mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
    const tex = mat?.getBaseColorTexture(); const uv = prim.getAttribute("TEXCOORD_0");
    let img = null;
    if (tex && uv && tex.getImage()) {
      if (!cache.has(tex)) {
        try { const s = sharp(Buffer.from(tex.getImage())).resize(64, 64, { fit: "fill" }).removeAlpha(); cache.set(tex, { data: await s.raw().toBuffer(), w: 64, h: 64 }); } catch { cache.set(tex, null); }
      }
      img = cache.get(tex);
    }
    const n = prim.getAttribute("POSITION").getCount();
    const col = new Float32Array(n * 4); const t = [0, 0];
    // small textures avg (tiny blur via 64px resize), per-vertex sample
    for (let i = 0; i < n; i++) {
      let r = 1, g = 1, b = 1;
      if (img) {
        uv.getElement(i, t);
        let u = t[0] - Math.floor(t[0]), v = t[1] - Math.floor(t[1]);
        const x = Math.min(img.w - 1, Math.floor(u * img.w)), y = Math.min(img.h - 1, Math.floor(v * img.h));
        const o = (y * img.w + x) * 3; r = lin(img.data[o]); g = lin(img.data[o + 1]); b = lin(img.data[o + 2]);
      }
      col[i * 4] = r * f[0]; col[i * 4 + 1] = g * f[1]; col[i * 4 + 2] = b * f[2]; col[i * 4 + 3] = 1;
    }
    prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC4").setArray(col).setBuffer(doc.getRoot().listBuffers()[0]));
    for (const sem of prim.listSemantics()) if (sem.startsWith("TEXCOORD") || sem === "NORMAL" || sem === "TANGENT") prim.setAttribute(sem, null);
    prim.setMaterial(one);
  }
  await doc.transform(prune());
}

async function reduce(doc, budget, errScale = 1, maxErr = 1) {
  const t0 = tris(doc);
  if (process.env.DEBUG) console.log(`    reduce from ${t0}`);
  if (t0 <= budget) return;
  let ratio = budget / t0;
  for (let k = 0; k < 8 && tris(doc) > budget * 1.05; k++) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, ratio), error: Math.min(maxErr, 0.002 * 2 ** k * errScale), lockBorder: true }));
    if (process.env.DEBUG) console.log(`    simplify k${k}: ${tris(doc)} (verts ${doc.getRoot().listAccessors().filter(a=>a.getType()==="VEC3").reduce((s,a)=>s+a.getCount(),0)})`);
    ratio = (budget / tris(doc)) * 0.95;
  }
}

/** heightmap boxes for the impostor LOD: rasterize the tile's triangles into a
 *  1.5 m max-height grid, then greedily cover it with flat-topped rectangles.
 *  Returns [x0,y0,z0,x1,y1,z1,faceMask] (mask bits: +x,-x,+z,-z,+y; faces hidden
 *  by an equally tall neighbour are dropped). */
function impostorBoxes(doc, G, set, scale, cx, cz, y0, fit) {
  const C = 1.5, R = T / 2 + 8, N = Math.ceil((2 * R) / C);
  const H = new Float32Array(N * N);
  const primIndex = new Map(G.prims.map((p, i) => [p.prim, i]));
  const cell = (x, z) => { const i = Math.floor((x + R) / C), j = Math.floor((z + R) / C); return i >= 0 && j >= 0 && i < N && j < N ? j * N + i : -1; };
  const put = (x, z, y) => { const c = cell(x, z); if (c >= 0 && y > H[c]) H[c] = y; };
  const P = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  forEachTriangle(doc, (w, prim, node, t) => {
    const pi = primIndex.get(prim); if (pi === undefined) return;
    const ci = G.triComp[pi][t]; if (!set.has(G.groupOf[ci]) || G.comps[ci].dim < 0.3) return;
    for (let k = 0; k < 3; k++) { P[k][0] = (w[k * 3] * scale - cx) * fit; P[k][1] = (w[k * 3 + 1] * scale - y0) * fit; P[k][2] = (w[k * 3 + 2] * scale - cz) * fit; }
    const ymax = Math.max(P[0][1], P[1][1], P[2][1]);
    if (ymax < 2.5) return;
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3]; const L = Math.hypot(b[0] - a[0], b[2] - a[2]); const n = Math.max(1, Math.ceil(L / 0.5));
      for (let s = 0; s <= n; s++) { const f = s / n; put(a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f, a[1] + (b[1] - a[1]) * f > 1 ? ymax : ymax); }
    }
    // interior cells (roofs)
    const minx = Math.min(P[0][0], P[1][0], P[2][0]), maxx = Math.max(P[0][0], P[1][0], P[2][0]), minz = Math.min(P[0][2], P[1][2], P[2][2]), maxz = Math.max(P[0][2], P[1][2], P[2][2]);
    if ((maxx - minx) * (maxz - minz) < C * C) return;
    const ar = (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[2][0] - P[0][0]) * (P[1][2] - P[0][2]); if (Math.abs(ar) < 1e-6) return;
    for (let x = Math.floor((minx + R) / C); x <= Math.floor((maxx + R) / C); x++) for (let z = Math.floor((minz + R) / C); z <= Math.floor((maxz + R) / C); z++) {
      const px = x * C - R + C / 2, pz = z * C - R + C / 2;
      const e = (a, b) => (b[0] - a[0]) * (pz - a[2]) - (px - a[0]) * (b[2] - a[2]);
      const s0 = e(P[0], P[1]), s1 = e(P[1], P[2]), s2 = e(P[2], P[0]);
      if ((s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0)) put(px, pz, ymax);
    }
  });
  const used = new Uint8Array(N * N); const boxes = [];
  const near = (h, h0) => h > 0 && Math.abs(h - h0) <= Math.max(1.5, 0.12 * h0);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = j * N + i; if (used[c] || H[c] < 2.5) continue;
    const h0 = H[c]; let i1 = i; while (i1 + 1 < N && !used[j * N + i1 + 1] && near(H[j * N + i1 + 1], h0)) i1++;
    let j1 = j; for (;;) { if (j1 + 1 >= N) break; let ok = true; for (let x = i; x <= i1; x++) { const q = (j1 + 1) * N + x; if (used[q] || !near(H[q], h0)) { ok = false; break; } } if (!ok) break; j1++; }
    let top = 0; for (let z = j; z <= j1; z++) for (let x = i; x <= i1; x++) { used[z * N + x] = 1; top = Math.max(top, H[z * N + x]); }
    boxes.push({ i, j, i1, j1, top });
  }
  const at = (i, j) => (i >= 0 && j >= 0 && i < N && j < N ? H[j * N + i] : 0);
  return boxes.map((b) => {
    const hid = (cells) => cells.every(([x, z]) => at(x, z) >= b.top - 0.5);
    const range = (a, c) => Array.from({ length: c - a + 1 }, (_, k) => a + k);
    let mask = 16;
    if (!hid(range(b.j, b.j1).map((z) => [b.i1 + 1, z]))) mask |= 1;
    if (!hid(range(b.j, b.j1).map((z) => [b.i - 1, z]))) mask |= 2;
    if (!hid(range(b.i, b.i1).map((x) => [x, b.j1 + 1]))) mask |= 4;
    if (!hid(range(b.i, b.i1).map((x) => [x, b.j - 1]))) mask |= 8;
    const r2 = (v) => +v.toFixed(2);
    return [r2(b.i * C - R), 0, r2(b.j * C - R), r2((b.i1 + 1) * C - R), r2(b.top), r2((b.j1 + 1) * C - R), mask];
  });
}

/** topology-free decimation (meshopt simplifySloppy) to hit a hard budget */
function sloppy(doc, budget) {
  const total = tris(doc); if (total <= budget) return;
  const r = budget / total;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices(); const pos = prim.getAttribute("POSITION");
    const I = new Uint32Array(idx.getArray()); const P = new Float32Array(pos.getArray());
    const target = Math.max(3, Math.floor((I.length * r) / 3) * 3);
    const [out] = MeshoptSimplifier.simplifySloppy(I, P, 3, null, target, 1);
    const nv = pos.getCount();
    prim.setIndices(doc.createAccessor().setType("SCALAR").setArray(nv > 65535 ? out : new Uint16Array(out)).setBuffer(doc.getRoot().listBuffers()[0]));
  }
}

/** move the doc's content so the tile centre is the origin and ground = y 0 */
function placeDoc(doc, scale, cx, cz, y0, fit) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const wrap = doc.createNode("tile").setScale([scale * fit, scale * fit, scale * fit]).setTranslation([-cx * fit, -y0 * fit, -cz * fit]);
  for (const c of scene.listChildren()) { scene.removeChild(c); wrap.addChild(c); }
  scene.addChild(wrap);
}

fs.mkdirSync(OUT, { recursive: true });
const manifestPath = path.join(OUT, "blocks.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { tile: T, blocks: [] };
for (const kit of KITS) {
  if (ONLY && !ONLY.test(kit.id)) continue;
  console.log(`== ${kit.id}`);
  const base = await io.read(path.join(SRC, kit.file));
  await prep(base);
  const G = findGroups(base, kit.scale);
  // ground level: low percentile of group bottoms
  const roots = [...new Set(G.groupOf.filter((g) => g >= 0))];
  const bottoms = roots.map((g) => G.gbb[g][1]).sort((a, b) => a - b);
  const y0 = bottoms[Math.floor(bottoms.length * 0.1)] ?? 0;
  let X0 = 1e9, Z0 = 1e9, X1 = -1e9, Z1 = -1e9;
  for (const g of roots) { const b = G.gbb[g]; X0 = Math.min(X0, b[0]); Z0 = Math.min(Z0, b[2]); X1 = Math.max(X1, b[3]); Z1 = Math.max(Z1, b[5]); }
  const nx = Math.max(1, Math.round((X1 - X0) / T)), nz = Math.max(1, Math.round((Z1 - Z0) / T));
  const tx = (X1 - X0) / nx, tz = (Z1 - Z0) / nz;
  console.log(`  bounds ${X0.toFixed(0)}..${X1.toFixed(0)} x ${Z0.toFixed(0)}..${Z1.toFixed(0)}, y0 ${y0.toFixed(2)}, ${nx}x${nz} tiles, ${roots.length} groups`);
  const tiles = new Map();
  for (const g of roots) {
    const b = G.gbb[g]; if (b[4] - y0 < 1.0) continue; // curbs, decals, litter
    const i = Math.min(nx - 1, Math.floor(((b[0] + b[3]) / 2 - X0) / tx)), j = Math.min(nz - 1, Math.floor(((b[2] + b[5]) / 2 - Z0) / tz));
    const k = `${i},${j}`; let s = tiles.get(k); if (!s) tiles.set(k, (s = new Set())); s.add(g);
  }
  manifest.blocks = manifest.blocks.filter((b) => b.kit !== kit.id);
  let n = 0;
  for (const [k, set] of [...tiles.entries()].sort()) {
    let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9, h = 0, tall = 0;
    for (const g of set) { const b = G.gbb[g]; bx0 = Math.min(bx0, b[0]); bz0 = Math.min(bz0, b[2]); bx1 = Math.max(bx1, b[3]); bz1 = Math.max(bz1, b[5]); h = Math.max(h, b[4] - y0); if (b[4] - y0 > 4) tall++; }
    let cover = 0;
    for (const g of set) { const b = G.gbb[g]; if (b[4] - y0 > 4) cover += (b[3] - b[0]) * (b[5] - b[2]); }
    if (tall < 1 || cover < T * T * 0.12) { console.log(`  tile ${k}: skipped (${set.size} groups, ${tall} buildings, cover ${(cover / (T * T) * 100).toFixed(0)}%)`); continue; }
    const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
    const fit = Math.min(1.45, (T + 2) / Math.max(bx1 - bx0, bz1 - bz0)); // fill the block (sources are sparser than a real block)
    const name = `block-${kit.id}-${n}`;
    if (kit.drop?.includes(n)) { console.log(`  ${name}: dropped (kit.drop)`); n++; continue; }
    // colliders (tile space, metres)
    const cols = [];
    for (const g of set) {
      const b = G.gbb[g]; if (b[4] - y0 < 1.5) continue;
      const w = (b[3] - b[0]) * fit, d = (b[5] - b[2]) * fit; if (w < 0.6 && d < 0.6) continue; // poles: skip
      cols.push([+(((b[0] + b[3]) / 2 - cx) * fit).toFixed(2), +(((b[2] + b[5]) / 2 - cz) * fit).toFixed(2), +(w / 2).toFixed(2), +(d / 2).toFixed(2), +(((b[4] - y0) * fit)).toFixed(1)]);
    }
    const imp = impostorBoxes(base, G, set, kit.scale, cx, cz, y0, fit);
    const cov = imp.reduce((a, b) => a + (b[3] - b[0]) * (b[5] - b[2]), 0) / (T * T);
    if (cov < 0.16) { console.log(`  tile ${k}: skipped (impostor cover ${(cov * 100).toFixed(0)}%)`); continue; }
    for (const lod of process.env.NOLO ? ["hi"] : ["hi", "lo"]) {
      const doc = await cloneDocument(base);
      filterDoc(doc, G, set, (lod === "hi" ? 0.3 : 1.6) / fit);
      await doc.transform(prune());
      placeDoc(doc, kit.scale, cx, cz, y0, fit);
      dropUnusedUVs(doc);
      if (lod === "lo") {
        await doc.transform(flatten());
        await bakeVertexColors(doc);
        await doc.transform(flatten(), join({ keepNamed: false }), weld(), prune());
        await reduce(doc, kit.lo, 3);
        sloppy(doc, kit.lo);
        await doc.transform(prune(), unweld(), normals({ overwrite: true }));
      } else {
        for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute("TANGENT", null);
        await doc.transform(dedup(), palette({ min: 2 }), flatten(), join({ keepNamed: false }), prune());
        for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) p.setAttribute("NORMAL", null);
        await doc.transform(weld(), prune());
        await reduce(doc, kit.hi, 0.5, 0.008);
        await doc.transform(prune(), unweld(), normals({ overwrite: true }));
      }
      await doc.transform(prune(), ...(lod === "hi" ? [textureCompress({ encoder: sharp, targetFormat: "webp", resize: [kit.px || 256, kit.px || 256], quality: 78 })] : []), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
      const file = path.join(OUT, `${name}${lod === "lo" ? "-low" : ""}.glb`);
      await io.write(file, doc);
      const mats = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);
      console.log(`  ${path.basename(file)}: ${tris(doc)} tris, ${mats} prims, ${(fs.statSync(file).size / 1e6).toFixed(2)} MB`);
      if (lod === "hi") manifest.blocks.push({ kit: kit.id, name, h: +(h * fit).toFixed(1), tris: tris(doc), calls: mats, imp });
      else manifest.blocks[manifest.blocks.length - 1].lowTris = tris(doc);
    }
    n++;
  }
}
manifest.blocks.sort((a, b) => a.name.localeCompare(b.name));
fs.writeFileSync(manifestPath, JSON.stringify(manifest));
console.log(`blocks.json: ${manifest.blocks.length} blocks`);
