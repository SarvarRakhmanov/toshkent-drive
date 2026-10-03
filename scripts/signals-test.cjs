// v1.8 traffic lights / yielding / crosswalk pedestrians: samples lane cars and
// robots for SECS seconds near the (50,50) junction and takes screenshots.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const P = process.env.PREFIX || "v1.8-signals";
const SECS = Number(process.env.SECS || 45);
const near50 = (v) => { const m = ((v - 50) % 100 + 100) % 100; return Math.min(m, 100 - m); };
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "low");
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  if (await p.locator("#controls").count()) await p.keyboard.press("KeyH").catch(() => {});
  await p.evaluate(() => window.__td.summonCar(58, 86, Math.PI));
  await p.waitForTimeout(2500);
  let prev = null, stopsAtLine = 0, stopsOnGreen = 0, pedOnRoad = 0, pedMax = 0, samples = 0, shot = 0, perf = null;
  const t0 = Date.now();
  while (Date.now() - t0 < SECS * 1000) {
    const s = await p.evaluate(() => ({ tr: window.__td.traffic(), peds: window.__td.peds(), sig: window.__td.signal() }));
    if (prev) {
      s.tr.forEach((c, i) => {
        const o = prev.tr[i]; if (c.stolen || c.police) return;
        const moved = Math.hypot(c.x - o.x, c.z - o.z);
        const alongX = Math.abs(Math.sin(c.h)) > 0.7;
        const along = alongX ? c.x : c.z;
        const dj = near50(along);
        if (moved < 0.05 && dj > 14.5 && dj < 20) { stopsAtLine++; if ((alongX ? s.sig.x : s.sig.z) === 2) stopsOnGreen++; }
      });
    }
    const onRoad = s.peds.filter((q) => (near50(q.x) < 9 || near50(q.z) < 9) && !(near50(q.x) < 9 && near50(q.z) < 9)).length;
    pedOnRoad += onRoad; pedMax = Math.max(pedMax, onRoad); samples++;
    prev = s;
    const el = (Date.now() - t0) / 1000;
    if ((shot === 0 && el > 4) || (shot === 1 && el > SECS / 2)) {
      perf = await p.evaluate(() => { const x = window.__tdPerf(); return { calls: x.calls, tris: x.triangles }; });
      await p.screenshot({ path: `shots/${P}-${shot}.png` });
      console.log(`shot ${shot} signal ${JSON.stringify(s.sig)} perf ${JSON.stringify(perf)}`);
      shot++;
    }
    await p.waitForTimeout(500);
  }
  console.log(`RESULT samples=${samples} carStopSamplesAtLine=${stopsAtLine} ofWhichOnGreen=${stopsOnGreen} pedOnRoadAvg=${(pedOnRoad / samples).toFixed(2)} pedOnRoadMax=${pedMax}`);
  console.log(`ERRORS(${errs.length}) ${errs.slice(0, 8).join("\n")}`);
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
