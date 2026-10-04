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
import { metalRough, normals, dedup, flatten, join, weld, simplify, prune, textureCompress, meshopt, sparse, palette } from "@gltf-transform/functions";

import { bakeSkins, dropUnusedUVs } from "./gltf-helpers.mjs";

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
  // BMW M3 Competition by VTX (Sketchfab), CC BY-NC-SA 4.0: 658k tris / 47 MB source
  ["bmw-m3-competition.glb", "cars/bmw-m3-competition.glb", 70000, 256],
  ["k5.glb", "cars/k5.glb", 60000, 1024],
  ["lacetti.glb", "cars/lacetti.glb", 22446, 1024],
  // v1.7b Uzbek-street cars (Sketchfab, CC BY): cabin parts dropped (the
  // cockpit view draws CarInterior instead), ground plane removed
  ["cobalt.glb", "cars/cobalt.glb", 50000, 1024, /^bancos|^painel|^steering_ok|^Gravel/i, { strip: true, steps: 10 }],
  ["captiva.glb", "cars/captiva.glb", 55000, 1024, /^plaquette|^visse/i, { strip: true, steps: 10 }],
  ["lada2103.glb", "cars/lada2103.glb", 45000, 1024, /^Torpedoplastic2103|^2103Divan|^steer_02a|^Radiola2103|^Lada2103_gauges|^Suspension|^coilfeal/i],
  // NPC traffic LODs of the same three (no wheel rig, merged static body)
  ["cobalt.glb", "traffic/cobalt.glb", 6000, 256, /^bancos|^painel|^steering_ok|^Gravel/i, { strip: true, steps: 12, errScale: 2 }],
  ["captiva.glb", "traffic/captiva.glb", 6000, 256, /^interior|^plaquette|^visse/i, { untextured: true, strip: true, steps: 12, errScale: 2 }],
  ["lada2103.glb", "traffic/lada2103.glb", 6000, 256, /^Torpedoplastic2103|^2103Divan|^steer_02a|^Radiola2103|^Lada2103_gauges|^Suspension|^coilfeal|^amdb11|^VAZPotolok/i, { untextured: true, strip: true, steps: 12, errScale: 2 }],
  // v1.7b real Tashkent landmarks (Sketchfab; licences in CREDITS.md)
  ["landmarks/temur.glb", "landmarks/temur.glb", 14000, 1024],
  ["landmarks/oliy-majlis.glb", "landmarks/oliy-majlis.glb", 18000, 512, null, { strip: true, steps: 10 }],
  ["landmarks/tv-tower.glb", "landmarks/tv-tower.glb", 9000, 512],
  ["landmarks/tv-tower.glb", "landmarks/tv-tower-far.glb", 1500, 128, null, { untextured: true, strip: true, steps: 12, errScale: 3 }],
  ["landmarks/circus.glb", "landmarks/circus.glb", 4600, 512, null, { strip: true }],
  // phone LOW variants
  ["landmarks/temur.glb", "landmarks/temur-low.glb", 5000, 512],
  ["landmarks/oliy-majlis.glb", "landmarks/oliy-majlis-low.glb", 7000, 256, null, { strip: true, steps: 12, errScale: 1.5 }],
  ["landmarks/tv-tower.glb", "landmarks/tv-tower-low.glb", 5000, 128, null, { untextured: true, strip: true, steps: 12, errScale: 1.5 }],
  ["landmarks/nest-one.glb", "landmarks/nest-one-low.glb", 4000, 256, null, { strip: true, steps: 12, errScale: 1.5 }],
  // the NBU source also carries Google Earth snapshot ground textures — dropped
  ["landmarks/nbu.glb", "landmarks/nbu.glb", 7000, 256, /Google_Earth|^L18X/i],
  ["landmarks/nbu.glb", "landmarks/nbu-low.glb", 5000, 64, /Google_Earth|^L18X/i, { untextured: true, strip: true }],
  ["landmarks/nest-one.glb", "landmarks/nest-one.glb", 9000, 512, null, { strip: true, steps: 10 }],
  ["landmarks/nest-one.glb", "landmarks/nest-one-far.glb", 1200, 128, null, { strip: true, steps: 12, errScale: 3 }],
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
for (const [file, out, budget, px, drop, opts = {}] of JOBS) {
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
  if (drop instanceof RegExp) {
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
  const baked = bakeSkins(doc);
  if (baked) console.log(`  baked ${baked} skinned meshes`);
  dropUnusedUVs(doc);
  // opts.strip: drop normals (and UVs on untextured materials) so the
  // simplifier can collapse across hard-edge seams; normals are rebuilt after
  // opts.untextured: bake each texture's mean colour into the base colour and
  // drop textures + UVs (far LODs / phone variants: palette() then merges
  // everything into one or two materials = one or two draw calls)
  if (opts.untextured) {
    const sharpMod = (await import("sharp")).default;
    for (const mat of doc.getRoot().listMaterials()) {
      const t = mat.getBaseColorTexture();
      if (t && t.getImage()) {
        try {
          const st = await sharpMod(Buffer.from(t.getImage())).stats();
          const ch = st.channels;
          const f = mat.getBaseColorFactor();
          const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          mat.setBaseColorFactor([f[0] * lin(ch[0].mean), f[1] * lin(ch[1].mean), f[2] * lin(ch[2].mean), f[3]]);
        } catch { /* keep factor */ }
      }
      mat.setBaseColorTexture(null); mat.setNormalTexture(null); mat.setMetallicRoughnessTexture(null);
      mat.setOcclusionTexture(null); mat.setEmissiveTexture(null);
    }
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) if (sem.startsWith("TEXCOORD")) prim.setAttribute(sem, null);
    }
    await doc.transform(prune());
  }
  if (opts.strip) {
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const m = prim.getMaterial();
      prim.setAttribute("NORMAL", null);
      const textured = m && (m.getBaseColorTexture() || m.getNormalTexture() || m.getMetallicRoughnessTexture());
      if (!textured) for (const sem of prim.listSemantics()) if (sem.startsWith("TEXCOORD")) prim.setAttribute(sem, null);
    }
  }
  await doc.transform(dedup(), palette({ min: 2 }), flatten(), join({ keepNamed: false }), weld(), prune());
  const t0 = tris(doc);
  if (t0 > budget) {
    // step the ratio down until we land under budget (simplify is error-bounded)
    let ratio = budget / t0;
    for (let k = 0; k < (opts.steps || 6) && tris(doc) > budget * 1.05; k++) {
      await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, ratio), error: 0.004 * (k + 1) * (opts.errScale || 1), lockBorder: false }));
      ratio = (budget / tris(doc)) * 0.95;
    }
  }
  if (opts.strip) await doc.transform(normals({ overwrite: false }));
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
