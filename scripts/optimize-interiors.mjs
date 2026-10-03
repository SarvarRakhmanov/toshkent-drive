// Cockpit interiors (v1.4): strip studio props / glass, bake into a common
// frame — metres, driver's EYE at the origin, +Z forward (nose), +X = the
// driver's left (LHD, so the passenger seat is at -X), y up — merge
// materials into a palette, simplify to the phone budget, meshopt.
//   node scripts/optimize-interiors.mjs      (reads models-src/interiors/*.glb)
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, flatten, join, weld, simplify, prune, meshopt, palette, clearNodeTransform, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { dropUnusedUVs } from "./gltf-helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

// eye: driver's eye point in source units; scale: metres per source unit;
// rotY: turns the source so its nose faces +Z; keep: source-space box,
// anything not fully inside is dropped; drop: material/node name pattern.
const JOBS = [
  {
    src: "gt-interior.glb", out: "interiors/gt-interior.glb", budget: 28000,
    eye: JSON.parse(process.env.GT_EYE || "[1.0, 2.72, 1.62]"), scale: 0.41, rotY: Math.PI,
    keep: [[-0.3, -0.2, -2.2], [4.1, 3.3, 5.7]],
    drop: /glass|Stick_Lights|Plane00/i,
    wheel: { box: [[0.6, 1.36, -0.02], [1.4, 2.16, 0.34]] },
  },
  {
    src: "sedan-interior.glb", out: "interiors/sedan-interior.glb", budget: 28000,
    eye: JSON.parse(process.env.SEDAN_EYE || "[0.4, 1.9, 0.87]"), scale: Number(process.env.SEDAN_SCALE || 0.34), rotY: Math.PI / 2,
    keep: [[-1e9, -1e9, -1e9], [1e9, 1e9, 1e9]],
    drop: /glass/i,
    wheel: { name: /weel|wheel/i },
  },
];

// Column axis of the steering wheel: smallest-variance direction of its
// vertices (the rim's plane normal), by Jacobi eigen-decomposition.
function planeNormal(pts) {
  const n = pts.length / 3, m = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) m[k] += pts[i * 3 + k] / n;
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) { const d = [0, 1, 2].map((k) => pts[i * 3 + k] - m[k]); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b]; }
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) {
    if (Math.abs(C[p][q]) < 1e-12) continue;
    const th = 0.5 * Math.atan2(2 * C[p][q], C[q][q] - C[p][p]); const c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const a = C[k][p], b = C[k][q]; C[k][p] = c * a - s * b; C[k][q] = s * a + c * b; }
    for (let k = 0; k < 3; k++) { const a = C[p][k], b = C[q][k]; C[p][k] = c * a - s * b; C[q][k] = s * a + c * b; }
    for (let k = 0; k < 3; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
  }
  let best = 0; for (let k = 1; k < 3; k++) if (C[k][k] < C[best][best]) best = k;
  return [V[0][best], V[1][best], V[2][best]];
}
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; } return Math.round(t); };
const inside = (b, k) => b.min.every((v, i) => v >= k[0][i]) && b.max.every((v, i) => v <= k[1][i]);

fs.mkdirSync(path.join(root, "public/models/interiors"), { recursive: true });
for (const job of JOBS) {
  if (ONLY && !ONLY.test(job.src)) continue;
  const input = path.join(root, "models-src/interiors", job.src);
  const doc = await io.read(input);
  const r = doc.getRoot();
  const before = { tris: tris(doc), bytes: fs.statSync(input).size };
  let dropped = 0;
  const isWheel = (n) => job.wheel.name ? job.wheel.name.test(n.getName()) : inside(getBounds(n), job.wheel.box);
  for (const n of r.listNodes()) if (n.getMesh() && isWheel(n)) n.setExtras({ wheel: true });
  for (const n of r.listNodes()) {
    const m = n.getMesh();
    if (!m) continue;
    const matName = m.listPrimitives().map((p) => p.getMaterial()?.getName() ?? "").join(" ");
    if (job.drop.test(matName) || job.drop.test(n.getName()) || !inside(getBounds(n), job.keep)) { n.setMesh(null); dropped++; }
  }
  // no glass transmission on phones: strip the extensions, everything opaque, both faces
  for (const m of r.listMaterials()) {
    m.setExtension("KHR_materials_transmission", null);
    m.setExtension("KHR_materials_volume", null);
    m.setExtension("KHR_materials_ior", null);
    m.setExtension("KHR_materials_specular", null);
    m.setExtension("KHR_materials_clearcoat", null);
    m.setAlphaMode("OPAQUE");
    m.setDoubleSided(true);
  }
  // re-root under one node carrying the eye-centred, metric, nose-+Z transform
  const scene = r.listScenes()[0];
  const top = doc.createNode("interior");
  for (const c of scene.listChildren()) { scene.removeChild(c); top.addChild(c); }
  scene.addChild(top);
  const s = job.scale, c = Math.cos(job.rotY), sn = Math.sin(job.rotY), [ex, ey, ez] = job.eye;
  // M = R_y * S * T(-eye), column-major
  const tx = -ex * s, ty = -ey * s, tz = -ez * s;
  top.setMatrix([c * s, 0, -sn * s, 0, 0, s, 0, 0, sn * s, 0, c * s, 0, c * tx + sn * tz, ty, -sn * tx + c * tz, 1]);
  await doc.transform(prune(), flatten());
  for (const n of r.listNodes()) if (n.getMesh()) clearNodeTransform(n);
  dropUnusedUVs(doc);
  // two sibling groups so join() merges the cabin and the wheel separately
  const cabin = doc.createNode("cabin"), wheelG = doc.createNode("steering-wheel-group");
  for (const n of [...scene.listChildren()]) { scene.removeChild(n); }
  for (const n of r.listNodes()) {
    if (!n.getMesh()) continue;
    (n.getExtras().wheel ? wheelG : cabin).addChild(n);
  }
  scene.addChild(cabin); scene.addChild(wheelG);
  await doc.transform(prune(), dedup(), palette({ min: 2 }), join({ keepNamed: false }), weld(), prune());
  for (let k = 0; k < 12 && tris(doc) > job.budget * 1.05; k++) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, (job.budget / tris(doc)) * 0.95), error: 0.002 * (k + 1) * (k > 5 ? 3 : 1), lockBorder: false }));
  }
  // steering-wheel pivot: node at the hub, local +Z = column axis toward the driver
  const wn = wheelG.listChildren().find((n) => n.getMesh());
  if (wn) {
    const prims = wn.getMesh().listPrimitives();
    const pts = []; for (const p of prims) { const a = p.getAttribute("POSITION"); const v = []; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push(...v); } }
    const b = getBounds(wn); const c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2);
    let ax = planeNormal(pts);
    if (ax[0] * -c[0] + ax[1] * -c[1] + ax[2] * -c[2] < 0) ax = ax.map((v) => -v);
    // rotation taking +Z onto ax (quaternion), and its inverse applied to the vertices
    const z = [0, 0, 1], d = ax[2], cr = [z[1] * ax[2] - z[2] * ax[1], z[2] * ax[0] - z[0] * ax[2], z[0] * ax[1] - z[1] * ax[0]];
    let q = [cr[0], cr[1], cr[2], 1 + d]; const ql = Math.hypot(...q); q = q.map((v) => v / ql);
    const rot = (v, qq) => { const [x, y, zz, w] = qq; const ix = w * v[0] + y * v[2] - zz * v[1], iy = w * v[1] + zz * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - zz * v[2]; return [ix * w + iw * -x + iy * -zz - iz * -y, iy * w + iw * -y + iz * -x - ix * -zz, iz * w + iw * -zz + ix * -y - iy * -x]; };
    const qi = [-q[0], -q[1], -q[2], q[3]];
    for (const p of prims) {
      const a = p.getAttribute("POSITION").clone(); const v = [];
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); a.setElement(i, rot([v[0] - c[0], v[1] - c[1], v[2] - c[2]], qi)); }
      p.setAttribute("POSITION", a);
      const nrm = p.getAttribute("NORMAL"); if (nrm) { const na = nrm.clone(); for (let i = 0; i < na.getCount(); i++) { na.getElement(i, v); na.setElement(i, rot(v, qi)); } p.setAttribute("NORMAL", na); }
    }
    // rim radius (grip centreline) = 97th-percentile radial distance in the wheel plane, minus a bit
    const rad = []; for (const p of prims) { const a = p.getAttribute("POSITION"); const v = []; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); rad.push(Math.hypot(v[0], v[1])); } }
    rad.sort((x, y) => x - y);
    const rimRadius = rad[Math.floor(rad.length * 0.97)] * 0.93;
    // pivot parent carries the hub transform; the mesh child stays identity so
    // meshopt's quantisation (which rewrites the mesh node's TRS) can't move the pivot
    wn.setName("steering-wheel-mesh");
    const pivot = doc.createNode("steering-wheel").setTranslation(c).setRotation(q).setExtras({ rimRadius });
    wheelG.removeChild(wn); pivot.addChild(wn); wheelG.addChild(pivot);
    console.log(`  wheel hub ${c.map((v) => v.toFixed(3))} axis ${ax.map((v) => v.toFixed(3))} rim ${rimRadius.toFixed(3)}`);
  } else console.log("  (no steering wheel found)");
  for (const e of r.listExtensionsUsed()) if (/transmission|volume|KHR_materials_ior|clearcoat|KHR_materials_specular/.test(e.extensionName)) e.dispose();
  await doc.transform(prune(), textureCompress({ targetFormat: "webp", resize: [256, 256], quality: 85 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const dst = path.join(root, "public/models", job.out);
  await io.write(dst, doc);
  const b = getBounds(r.listScenes()[0]);
  console.log(`${job.out}: ${before.tris} -> ${tris(doc)} tris, ${(before.bytes / 1e6).toFixed(2)} -> ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB, ${r.listMeshes().length} meshes, ${r.listMaterials().length} mats, dropped ${dropped} nodes; bounds ${b.min.map((v) => v.toFixed(2))} .. ${b.max.map((v) => v.toFixed(2))}`);
}
