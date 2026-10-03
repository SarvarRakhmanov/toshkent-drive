// Quick GLB report: triangles, meshes, materials, textures, skins, animations, bounds.
//   node scripts/inspect-glb.mjs file.glb [--nodes]
import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import draco3d from "draco3d";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "draco3d.decoder": await draco3d.createDecoderModule() });
for (const f of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  const doc = await io.read(f); const r = doc.getRoot();
  let t = 0; for (const m of r.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; }
  let tex = 0; for (const x of r.listTextures()) tex += x.getImage()?.byteLength || 0;
  const b = getBounds(r.listScenes()[0]);
  console.log(`${f.split("/").pop()}: tris=${Math.round(t)} meshes=${r.listMeshes().length} mats=${r.listMaterials().length} tex=${r.listTextures().length} (${(tex / 1e6).toFixed(2)} MB) skins=${r.listSkins().length} anims=${r.listAnimations().length} nodes=${r.listNodes().length} bounds=[${b.min.map((v) => v.toFixed(2))}]..[${b.max.map((v) => v.toFixed(2))}] ext=${r.listExtensionsUsed().map((e) => e.extensionName).join(",")}`);
  if (process.argv.includes("--nodes")) for (const n of r.listNodes()) if (n.getMesh()) { const nb = getBounds(n); console.log("   ", n.getName(), "|", n.getMesh().listPrimitives().map((p) => p.getMaterial()?.getName()).join(","), "| y", nb.min[1].toFixed(2), nb.max[1].toFixed(2), "x", nb.min[0].toFixed(2), nb.max[0].toFixed(2)); }
}
