// v1.7b: heuristic nose-direction check for car GLBs. On a car the roof /
// greenhouse sits behind the middle (long hood, short boot), so the mean z of
// the top 15 % of vertices is < 0 when the nose faces +z. Applies each
// model's rotY (lib/playerCar.ts / GlbCar.tsx TRAFFIC_MODELS) and reports.
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const MODELS = [
  ["cars/seltos.glb", Math.PI / 2], ["cars/lacetti.glb", 0], ["cars/bmw-m3.glb", 0], ["cars/k5.glb", 0], ["cars/bmw-m3-competition.glb", Math.PI],
  ["cars/cobalt.glb", Math.PI], ["cars/captiva.glb", 0], ["cars/lada2103.glb", 0],
  ["traffic/sedan-a.glb", -Math.PI / 2], ["traffic/sedan-b.glb", 0], ["traffic/hatch-a.glb", -Math.PI / 2], ["traffic/hatch-b.glb", Math.PI / 2], ["traffic/van-a.glb", -Math.PI / 2], ["traffic/taxi-a.glb", -Math.PI / 2],
  ["traffic/cobalt.glb", Math.PI], ["traffic/captiva.glb", 0], ["traffic/lada2103.glb", 0],
];
let bad = 0;
for (const [f, rotY] of MODELS) {
  const doc = await io.read(`public/models/${f}`);
  const pts = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const a = prim.getAttribute("POSITION"); const v = [0, 0, 0];
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        pts.push([x * Math.cos(rotY) + z * Math.sin(rotY), y, -x * Math.sin(rotY) + z * Math.cos(rotY)]);
      }
    }
  }
  let y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (const [x, y, z] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  const lenAxis = (z1 - z0) >= (x1 - x0) ? "z" : "x";
  const top = pts.filter((p) => p[1] > y1 - 0.15 * (y1 - y0));
  const zm = top.reduce((s, p) => s + p[2], 0) / top.length;
  const rel = (zm - (z0 + z1) / 2) / (z1 - z0);
  // hard check: the body's long axis must be z (else the car crab-walks);
  // soft check: roof behind the middle (boxy cars like the 2103 or low-poly
  // NPCs can sit near 0 — confirm those on the side-view contact sheet)
  const axisOk = lenAxis === "z";
  if (!axisOk) bad++;
  const verdict = !axisOk ? "FAIL: long axis is x (drives sideways)" : rel < -0.03 ? "nose +z OK" : rel < 0.03 ? "nose ambiguous (see contact sheet)" : "WARN: roof ahead of middle (nose may face -z; see contact sheet)";
  console.log(`${f.padEnd(32)} rotY=${rotY.toFixed(2)} long-axis=${lenAxis} roof centre ${(rel * 100).toFixed(1)}% → ${verdict}`);
}
process.exit(bad ? 1 : 0);
