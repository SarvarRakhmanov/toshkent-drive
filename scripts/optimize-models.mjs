#!/usr/bin/env node
// Mobile-first optimisation of the car / traffic / landmark GLBs.
// Reads the untouched sources in models-src/ (kept out of the deployed site),
// writes public/models/**. Re-runnable.
//   - flatten + join: one draw call per material instead of one per node
//     (the Seltos was 261 meshes / ~260 draw calls on its own)
//   - weld + meshopt simplify to a per-model triangle budget
//   - textures → WebP, capped at 1024 px (player cars) / 256 px (traffic)
//   - EXT_meshopt_compression + quantization (drei's useGLTF decodes it)
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { metalRough, dedup, flatten, join, weld, simplify, prune, textureCompress, meshopt, sparse } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import draco3d from "draco3d";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "models-src");
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
  "draco3d.decoder": await draco3d.createDecoderModule(),
});

// [source file, output path, triangle budget, max texture px]
const JOBS = [
  // the Seltos source is a full CAD interior; the chase camera never sees the
  // cabin (CarInterior.tsx draws its own cockpit for the in-car view)
  ["seltos.glb", "cars/seltos.glb", 70000, 1024, /seat|leather|floor|stitch|seatbelt|wheelbutton|steering wheel|^drive|console|aircon|^gear|display|doorspeaker|doorbutton|doorlock|pelt|charge|^press|^accel|^brake \[|rooflamp|indicator|plastic2|^Lining|Material #168/i],
  ["bmw-m3.glb", "cars/bmw-m3.glb", 60000, 1024],
  ["k5.glb", "cars/k5.glb", 60000, 1024],
  ["lacetti.glb", "cars/lacetti.glb", 22446, 1024],
  ["sedan-a.glb", "traffic/sedan-a.glb", 6000, 256],
  ["sedan-b.glb", "traffic/sedan-b.glb", 6000, 256],
  ["hatch-a.glb", "traffic/hatch-a.glb", 6000, 256],
  ["hatch-b.glb", "traffic/hatch-b.glb", 6000, 256],
  ["van-a.glb", "traffic/van-a.glb", 6000, 256],
  ["taxi-a.glb", "traffic/taxi-a.glb", 6000, 256],
  ["building-office.glb", "buildings/building-office.glb", 3000, 512],
  ["apt-a.glb", "buildings/apt-a.glb", 8000, 512],
  ["apt-b.glb", "buildings/apt-b.glb", 8000, 512],
  ["corner-a.glb", "buildings/corner-a.glb", 8000, 512],
  ["shop-a.glb", "buildings/shop-a.glb", 8000, 512],
];

function tris(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const i = p.getIndices();
    t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3;
  }
  return Math.round(t);
}

const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // e.g. ONLY="bmw|k5"
for (const [file, out, budget, px, drop] of JOBS) {
  if (ONLY && !ONLY.test(file)) continue;
  const input = path.join(src, file);
  if (!fs.existsSync(input)) { console.log("skip", file); continue; }
  const doc = await io.read(input);
  const before = { tris: tris(doc), meshes: doc.getRoot().listMeshes().length, bytes: fs.statSync(input).size };
  // the game never plays the GLB animations (doors/wheels demo clips) and an
  // animated node can't be flattened/joined, so drop them first
  for (const a of doc.getRoot().listAnimations()) { a.listChannels().forEach((c) => c.dispose()); a.listSamplers().forEach((x) => x.dispose()); a.dispose(); }
  // nodes hidden by a zero scale (e.g. "lights on" variants) are invisible and
  // have a singular matrix that breaks join() — drop them
  const det3 = (m) => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  for (const n of doc.getRoot().listNodes()) {
    if (Math.abs(det3(n.getWorldMatrix())) < 1e-12) n.dispose();
  }
  if (drop) {
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      if (drop.test(prim.getMaterial()?.getName() || "")) prim.dispose();
    }
    await doc.transform(prune());
  }
  // KHR_materials_pbrSpecularGlossiness isn't supported by three's GLTFLoader
  // (console warning + wrong shading) — convert to metal/rough
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === "KHR_materials_pbrSpecularGlossiness")) await doc.transform(metalRough());
  // KHR_materials_transmission makes three.js run a whole extra transmission
  // render pass (every opaque object again, with its own shader variants) the
  // moment a glass pane is on screen — a multi-second shader-compile stall on
  // mobile GPUs. Plain alpha-blended glass looks the same at game distances.
  for (const mat of doc.getRoot().listMaterials()) {
    const tr = mat.getExtension("KHR_materials_transmission");
    if (!tr) continue;
    const amount = tr.getTransmissionFactor();
    mat.setExtension("KHR_materials_transmission", null);
    mat.setExtension("KHR_materials_volume", null);
    const c = mat.getBaseColorFactor();
    mat.setAlphaMode("BLEND");
    mat.setBaseColorFactor([c[0], c[1], c[2], Math.min(c[3], 1 - 0.65 * amount)]);
  }
  for (const e of doc.getRoot().listExtensionsUsed()) {
    if (e.extensionName === "KHR_materials_transmission" || e.extensionName === "KHR_materials_volume") {
      if (!doc.getRoot().listMaterials().some((m) => m.getExtension(e.extensionName))) e.dispose();
    }
  }
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), weld(), prune());
  const t0 = tris(doc);
  if (t0 > budget) {
    // step the ratio down until we land under budget (simplify is error-bounded)
    let ratio = budget / t0;
    for (let k = 0; k < 6 && tris(doc) > budget * 1.05; k++) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, ratio), error: 0.004 * (k + 1), lockBorder: false }));
      ratio = (budget / tris(doc)) * 0.95;
    }
  }
  await doc.transform(
    prune(),
    textureCompress({ targetFormat: "webp", resize: [px, px], quality: 82 }),
    sparse(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  const dst = path.join(root, "public", "models", out);
  await io.write(dst, doc);
  const after = { tris: tris(doc), meshes: doc.getRoot().listMeshes().length, bytes: fs.statSync(dst).size };
  console.log(`${out}: ${before.tris} -> ${after.tris} tris, ${before.meshes} -> ${after.meshes} meshes, ${(before.bytes / 1e6).toFixed(2)} -> ${(after.bytes / 1e6).toFixed(2)} MB`);
}

// tree bark/leaf photo textures: 2K JPG/PNG → 512 px (they tile on thin
// trunks and leaf cards; 2K was ~4 MB of download and ~90 MB of GPU memory)
import sharp from "sharp";
const tdir = path.join(src, "textures-tree");
if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir)) {
  const out = path.join(root, "public", "textures", "tree", f);
  const img = sharp(path.join(tdir, f)).resize(512, 512, { fit: "inside" });
  await (f.endsWith(".png") ? img.png({ compressionLevel: 9 }) : img.jpeg({ quality: 82, mozjpeg: true })).toFile(out);
  console.log(`textures/tree/${f}: ${(fs.statSync(path.join(tdir, f)).size / 1e6).toFixed(2)} -> ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
}
