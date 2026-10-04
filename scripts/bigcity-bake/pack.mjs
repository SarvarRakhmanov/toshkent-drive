// compress the baked impostors: /tmp/ck/<name>-imp.raw.glb -> public/models/bigcity/<name>-imp.glb (webp + meshopt)
import fs from "node:fs"; import path from "node:path"; import sharp from "sharp";
import { textureCompress, meshopt, prune } from "@gltf-transform/functions";
import { io, MeshoptEncoder } from "../bigcity-lib.mjs";
const RAW = process.env.RAW || "/tmp/ck";
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../public/models/bigcity");
for (const f of fs.readdirSync(RAW).filter((f) => f.endsWith("-imp.raw.glb"))) {
  const doc = await io.read(path.join(RAW, f));
  for (const m of doc.getRoot().listMaterials()) { m.setAlphaMode("MASK"); m.setAlphaCutoff(0.5); }
  await doc.transform(prune(), textureCompress({ encoder: sharp, targetFormat: "webp", quality: 80 }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  const dst = path.join(out, f.replace(".raw.glb", ".glb"));
  await io.write(dst, doc);
  console.log(path.basename(dst), (fs.statSync(dst).size / 1024).toFixed(0), "KB");
}
