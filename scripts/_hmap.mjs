import { io, forEachTriangle } from "./bigcity-lib.mjs";
const [f, cellArg] = process.argv.slice(2);
const doc = await io.read(f);
let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
forEachTriangle(doc, (w) => { for (let k = 0; k < 3; k++) { x0 = Math.min(x0, w[k*3]); x1 = Math.max(x1, w[k*3]); z0 = Math.min(z0, w[k*3+2]); z1 = Math.max(z1, w[k*3+2]); y0 = Math.min(y0, w[k*3+1]); } });
const cell = Number(cellArg) || Math.max(x1 - x0, z1 - z0) / 70;
const W = Math.ceil((x1 - x0) / cell), H = Math.ceil((z1 - z0) / cell);
const hm = new Float32Array(W * H).fill(-1);
forEachTriangle(doc, (w) => { const cx = (w[0]+w[3]+w[6])/3, cz = (w[2]+w[5]+w[8])/3, ym = Math.max(w[1],w[4],w[7]) - y0; const i = Math.min(W-1, Math.floor((cx-x0)/cell)), j = Math.min(H-1, Math.floor((cz-z0)/cell)); hm[j*W+i] = Math.max(hm[j*W+i], ym); });
console.log(f, `x ${x0.toFixed(1)}..${x1.toFixed(1)} z ${z0.toFixed(1)}..${z1.toFixed(1)} y0 ${y0.toFixed(2)} cell ${cell.toFixed(2)} grid ${W}x${H}`);
const ch = (h) => h < 0 ? " " : h < 0.15 * cell ? "." : h < 0.6 * cell ? "-" : h < 3 * cell ? "o" : "#";
for (let j = 0; j < H; j++) { let s = ""; for (let i = 0; i < W; i++) s += ch(hm[j*W+i]); console.log(String(j).padStart(3), s); }
