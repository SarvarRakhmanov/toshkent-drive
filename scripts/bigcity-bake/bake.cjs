// node scripts/bigcity-bake/bake.cjs  (PW=<playwright path>; serves via BASE url with three/ + models/ symlinks)
const fs = require("fs"); const path = require("path");
const pw = require(process.env.PW);
const root = path.resolve(__dirname, "../..");
const out = path.join(root, "public/models/bigcity");
const man = JSON.parse(fs.readFileSync(path.join(out, "blocks.json"), "utf8"));
const BASE = process.env.BASE || "http://127.0.0.1:4180";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  p.on("console", (m) => console.log("  [page]", m.text()));
  await p.goto(BASE + "/imp.html"); await p.waitForFunction(() => document.title === "ready");
  for (const blk of man.blocks) {
    if (process.env.ONLY && !new RegExp(process.env.ONLY).test(blk.name)) continue;
    const res = await p.evaluate(([n, boxes]) => window.bake(n, boxes), [blk.name, blk.imp]);
    fs.writeFileSync(path.join("/tmp/ck", blk.name + "-imp.raw.glb"), Buffer.from(res.glb, "base64"));
    if (process.env.ATLAS) fs.writeFileSync(path.join("/tmp/ck", blk.name + "-atlas.png"), Buffer.from(res.atlas.split(",")[1], "base64"));
    console.log(`${blk.name}: ${res.faces} faces, ${res.D} px/m`);
  }
  await b.close();
})();
