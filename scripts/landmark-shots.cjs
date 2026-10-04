// v1.7b: one chase-camera shot per real landmark + draw stats (phone portrait)
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots", P = process.env.PREFIX || "v1.7b-landmark";
// name, car x, z, heading, camera yaw, pitch
const D = 3 * Math.PI / 4; // facing +x/-z from the block's NW-ish corner crossroads
const SPOTS = [
  ["amir-temur", 200, 250, Math.PI, 0, 0.05],
  ["tv-tower", 150, -50, D, 0, -0.75],
  ["oliy-majlis", -150, -50, D, 0, -0.2],
  ["circus", 250, 150, D, 0, -0.15],
  ["nbu", 50, 250, D, 0, -0.3],
  ["nest-one", -250, 50, D, 0, -0.6],
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
    await page.evaluate(([x, z, h]) => window.__td.summonCar(x, z, h), [x, z, h]); await page.waitForTimeout(4500);
    await page.evaluate(([y, p]) => window.__td.look(y, p), [yaw, pitch]); await page.waitForTimeout(2500);
    const r = await page.evaluate(() => { const p = window.__tdPerf(); const lm = window.__tdDraw(true).filter((e) => String(e[0]).startsWith("td-landmark")); return { calls: p.calls, tris: p.triangles, lm: window.__tdLm }; });
    console.log(n, r.calls, r.tris, JSON.stringify(r.lm[n]));
    await page.screenshot({ path: `${OUT}/${P}-${n}.png` });
  }
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 8).join("\n"));
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
