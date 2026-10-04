// shared helpers for the Big City pipeline (scripts/build-bigcity.mjs)
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3d";
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
export const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder, "meshopt.encoder": MeshoptEncoder, "draco3d.decoder": await draco3d.createDecoderModule() });
export { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier };

/** every triangle of the scene in world space: [{x,y,z}×3, prim, node, tri index] via callback */
export function forEachTriangle(doc, cb) {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const pos = prim.getAttribute("POSITION"); const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const v = [0, 0, 0]; const w = new Float32Array(9);
      for (let t = 0; t < n; t += 3) {
        for (let k = 0; k < 3; k++) {
          pos.getElement(idx ? idx.getScalar(t + k) : t + k, v);
          w[k * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
          w[k * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
          w[k * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        }
        cb(w, prim, node, t / 3);
      }
    }
  }
}
