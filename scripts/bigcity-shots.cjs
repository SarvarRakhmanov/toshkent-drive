// v1.7.1: Big City street shots + draw stats. MAP=bigcity|toshkent QUALITY=low|high W/H
const pw = require(process.env.PW || "playwright");
const MAP = process.env.MAP || "bigcity";
const URL = process.env.URL || `http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0&map=${MAP}`;
const OUT = process.env.OUT || "shots", P = process.env.PREFIX || `v1.7.1-${MAP}`;
// name, car x, z, heading, camera yaw, pitch
const SPOTS = [
  ["street-a", 150, 20, Math.PI, 0, -0.08],
  ["street-b", -50, 230, Math.PI / 2, 0, -0.12],
  ["cross", 250, -150, 3 * Math.PI / 4, 0, -0.1],
  ["aerial", 100, 100, Math.PI / 4, 0, -0.75],
].filter((s) => !process.env.ONLY || new RegExp(process.env.ONLY).test(s[0]));
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  const page = await b.newPage({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "low");
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(4000);
  for (const [n, x, z, h, yaw, pitch] of SPOTS) {
    await page.evaluate(([x, z, h]) => window.__td.summonCar(x, z, h), [x, z, h]); await page.waitForTimeout(6000);
    await page.evaluate(([y, p]) => window.__td.look(y, p), [yaw, pitch]); await page.waitForTimeout(3000);
    const r = await page.evaluate(() => { const p = window.__tdPerf(); return { calls: p.calls, tris: p.triangles, top: window.__tdDraw(true).slice(0, 6), car: window.__td.car() }; });
    console.log(n, "calls", r.calls, "tris", r.tris, JSON.stringify(r.top), JSON.stringify(r.car));
    await page.screenshot({ path: `${OUT}/${P}-${n}.png`, timeout: 180000 });
  }
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 8).join("\n"));
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
