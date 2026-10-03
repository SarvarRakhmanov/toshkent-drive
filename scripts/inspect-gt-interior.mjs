import { NodeIO, getBounds } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]); const r = doc.getRoot();
const rows = [];
for (const n of r.listNodes()) { const m = n.getMesh(); if (!m) continue;
  let t = 0; for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3;
  const b = getBounds(n); rows.push({ name: n.getName().slice(0, 34), mat: m.listPrimitives()[0].getMaterial()?.getName(), t, sx: +(b.max[0]-b.min[0]).toFixed(2), sy: +(b.max[1]-b.min[1]).toFixed(2), sz: +(b.max[2]-b.min[2]).toFixed(2), min: b.min.map(v=>+v.toFixed(2)), max: b.max.map(v=>+v.toFixed(2)) }); }
rows.sort((a, b) => Math.max(b.sx, b.sy, b.sz) - Math.max(a.sx, a.sy, a.sz));
for (const x of rows.slice(0, 25)) console.log(JSON.stringify(x));
console.log("--- by tris"); rows.sort((a, b) => b.t - a.t); for (const x of rows.slice(0, 25)) console.log(JSON.stringify(x));
const mats = {}; for (const x of rows) mats[x.mat] = (mats[x.mat] || 0) + x.t; console.log(Object.entries(mats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+":"+v).join("  "));
console.log("--- wheel/glass/screens");
for (const x of rows) if (/Wheel|glass|Glass|Screens|Alcantara|Carpet|Material_59/.test(x.mat)) console.log(JSON.stringify(x));
console.log("--- z<-0.5 big parts"); for (const x of rows) if (x.min[2] < -0.8 && x.t > 300 && Math.max(x.sx,x.sy,x.sz) < 6) console.log(JSON.stringify(x));
