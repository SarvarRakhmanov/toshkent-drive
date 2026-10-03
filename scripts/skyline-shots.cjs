// v1.7 skyline: chase-cam screenshots facing 4 headings (+ one at night via
// ?t= if supported). QUALITY=low|high  W/H viewport  PREFIX
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const P = process.env.PREFIX || "v1.7-skyline";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "low");
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  if (await p.locator("#controls").count()) await p.keyboard.press("KeyH").catch(() => {});
  const H = (process.env.HEADINGS || "0,1.5708,3.1416,4.7124").split(",").map(Number);
  for (const h of H) {
    await p.evaluate(([h, x, z]) => window.__td.summonCar(x, z, h), [h, Number(process.env.X || 50), Number(process.env.Z || 250)]);
    await p.waitForTimeout(3500);
    const perf = await p.evaluate(() => { const x = window.__tdPerf(); return { calls: x.calls, tris: x.triangles }; });
    await p.screenshot({ path: `shots/${P}-h${h.toFixed(1)}.png` });
    console.log(`heading ${h}: ${JSON.stringify(perf)} car ${JSON.stringify(await p.evaluate(() => window.__td.car()))}`);
  }
  console.log(`ERRORS(${errs.length}) ${errs.slice(0, 8).join("\n")}`);
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
