// Robots (player "The Big Boss" + NPC pedestrians): pose at an idle/walk frame,
// bake the skin to static geometry (NPCs are instanced + procedurally bobbed),
// merge materials, simplify, WebP textures, meshopt.
//   node scripts/optimize-robots.mjs        (reads models-src/robots/*.glb)
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { metalRough, dedup, flatten, join, weld, simplify, prune, textureCompress, meshopt, palette } from "@gltf-transform/functions";
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from "meshoptimizer";
import { bakeSkins, dropUnusedUVs, applyAnimationPose } from "./gltf-helpers.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await Promise.all([MeshoptSimplifier.ready, MeshoptEncoder.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder });

// [source, output, triangle budget, texture px, pose animation]
const JOBS = [
  ["big-boss.glb", "robots/big-boss.glb", 9000, 512],
  ["militor.glb", "robots/npc-militor.glb", 8000, 256],
  ["mini-bot.glb", "robots/npc-mini-bot.glb", 8000, 256, /static_idle/, 2800],
  ["checkered-guard.glb", "robots/npc-checkered-guard.glb", 8000, 256, /Static Stance/, 2800],
  ["ww1-robot.glb", "robots/npc-ww1.glb", 8000, 256],
  ["biped-robot.glb", "robots/npc-biped.glb", 8000, 256],
  ["robot-bumstrum.glb", "robots/npc-bumstrum.glb", 8000, 256],
];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const tris = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; } return Math.round(t); };

fs.mkdirSync(path.join(root, "public/models/robots"), { recursive: true });
const NPC_BUDGET = Number(process.env.NPC_BUDGET || 5000);
const LOD_BUDGET = Number(process.env.LOD_BUDGET || 1600);
const RUNS = [];
for (const [file, out, budget, px, poseRe, lodBudget] of JOBS) {
  if (out.includes("/npc-")) {
    RUNS.push([file, out, NPC_BUDGET, px, poseRe]);
    RUNS.push([file, out.replace(".glb", "-lod.glb"), lodBudget || LOD_BUDGET, 64, poseRe]);
  } else RUNS.push([file, out, budget, px, poseRe]);
}
for (const [file, out, budget, px, poseRe] of RUNS) {
  if (ONLY && !ONLY.test(file)) continue;
  const input = path.join(root, "models-src/robots", file);
  const doc = await io.read(input);
  const r = doc.getRoot();
  const before = { tris: tris(doc), bytes: fs.statSync(input).size };
  const animNames = r.listAnimations().map((a) => a.getName());
  const posed = applyAnimationPose(doc, poseRe || /idle|stand|walk/i, Number(process.env.POSE_T || 0));
  const baked = bakeSkins(doc);
  // shape keys are never used (static instanced NPCs) and can be most of the file
  for (const m of r.listMeshes()) for (const prim of m.listPrimitives()) for (const t of prim.listTargets()) { prim.removeTarget(t); t.dispose(); }
  for (const m of r.listMeshes()) m.setWeights([]);
  // drop flat "ground disc"/shadow-catcher meshes shipped under some characters
  {
    const all = getBounds(r.listScenes()[0]); const H = all.max[1] - all.min[1];
    for (const n of r.listNodes()) {
      if (!n.getMesh()) continue;
      const b = getBounds(n); const h = b.max[1] - b.min[1]; const w = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
      if (h < H * 0.02 && w > H * 0.25 && b.max[1] < all.min[1] + H * 0.05) { console.log("  dropping flat mesh", n.getName()); n.setMesh(null); }
    }
  }
  for (const a of r.listAnimations()) { for (const c of a.listChannels()) c.dispose(); for (const s of a.listSamplers()) s.dispose(); a.dispose(); }
  for (const s of r.listSkins()) s.dispose();
  for (const m of r.listMaterials()) { m.setExtension("KHR_materials_transmission", null); m.setExtension("KHR_materials_volume", null); }
  if (r.listExtensionsUsed().some((e) => e.extensionName === "KHR_materials_pbrSpecularGlossiness")) await doc.transform(metalRough());
  dropUnusedUVs(doc);
  await doc.transform(prune(), dedup(), palette({ min: 2 }), flatten(), join({ keepNamed: false }), weld(), prune());
  for (let k = 0; k < 12 && tris(doc) > budget * 1.05; k++) {
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, (budget / tris(doc)) * 0.95), error: 0.003 * (k + 1) * (k > 5 ? 3 : 1), lockBorder: false }));
  }
  // distance LODs only: topology-agnostic sloppy decimation when the regular
  // simplifier is blocked by seams / disconnected parts
  if (out.includes("-lod") && tris(doc) > budget * 1.3) {
    await MeshoptSimplifier.ready;
    const ratio = budget / tris(doc);
    for (const m of r.listMeshes()) for (const prim of m.listPrimitives()) {
      const idx = prim.getIndices(); const pos = prim.getAttribute("POSITION");
      if (!idx || !pos) continue;
      const src = new Uint32Array(idx.getArray());
      const target = Math.max(12, Math.floor((src.length * ratio) / 3) * 3);
      const [dst] = MeshoptSimplifier.simplifySloppy(src, new Float32Array(pos.getArray()), 3, null, target, 0.05);
      idx.setArray(new Uint32Array(dst));
    }
    await doc.transform(prune());
  }
  await doc.transform(prune(), textureCompress({ targetFormat: "webp", resize: [px, px], quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  // orphan accessors (old skin/animation data) that prune() leaves behind
  for (const a of r.listAccessors()) if (doc.getGraph().listParentEdges(a).every((e) => e.getParent() === r)) a.dispose();
  const dst = path.join(root, "public/models", out);
  await io.write(dst, doc);
  console.log(`${out}: ${before.tris} -> ${tris(doc)} tris, ${(before.bytes / 1e6).toFixed(2)} -> ${(fs.statSync(dst).size / 1e6).toFixed(2)} MB, ${r.listMeshes().length} meshes, ${r.listMaterials().length} mats; anims [${animNames.join(", ")}] posed=${posed} baked=${baked}`);
}
