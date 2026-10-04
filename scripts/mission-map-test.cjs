// v1.7.1: missions on a map (MAP=bigcity|toshkent): start each kind, check every
// target is drivable (no collider on it), drive there by teleport + stop, check
// the stage advances and the pay lands.
const pw = require(process.env.PW || "playwright");
const MAP = process.env.MAP || "bigcity";
const URL = process.env.URL || `http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0&map=${MAP}`;
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const page = await b.newPage({ viewport: { width: 640, height: 400 } });
  const errors = []; let fails = 0;
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript(() => { localStorage.setItem("td_gfx_quality", "low"); localStorage.removeItem("td_save"); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(3000);
  for (const kind of ["taxi", "delivery", "race"]) {
    const money0 = (await page.evaluate(() => window.__td.career())).money;
    const r = await page.evaluate((k) => window.__td.startMission(k), kind);
    let m = await page.evaluate(() => window.__td.mission());
    if (!m) { console.log("FAIL", kind, "did not start", r); fails++; continue; }
    console.log(kind, "targets", m.n);
    for (let s = 0; s < m.n; s++) {
      m = await page.evaluate(() => window.__td.mission());
      if (!m) break;
      const t = m.target;
      // probe the target BEFORE the car is on it (its own collider would block the probe)
      await page.evaluate(([x, z]) => window.__td.forceCar(x + 0.5, z + 14, 0), [t.x, t.z]); await page.waitForTimeout(3000);
      const clear = await page.evaluate(([x, z]) => window.__td.clear(x, z, 0, 0), [t.x, t.z]);
      await page.evaluate(([x, z]) => window.__td.forceCar(x, z, 0), [t.x, t.z]); await page.waitForTimeout(2500);
      await page.waitForTimeout(2500);
      const m2 = await page.evaluate(() => window.__td.mission());
      const advanced = !m2 || m2.stage > m.stage || m2.kind !== m.kind;
      console.log(`  stage ${s} target ${t.x.toFixed(0)},${t.z.toFixed(0)} "${t.label}" clear=${clear} advanced=${advanced}`);
      if (!advanced || clear === false) fails++;
    }
    const money1 = (await page.evaluate(() => window.__td.career())).money;
    console.log(`  ${kind}: money ${money0} -> ${money1}`);
    if (money1 <= money0) fails++;
    await page.waitForTimeout(1500);
  }
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 5).join("\n"));
  console.log(fails ? `RESULT FAIL (${fails})` : "RESULT PASS");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
