// v1.7.1: map switching. Default must be Toshkent; Pause menu -> MAP: BIG CITY
// reloads into Big City with the same car/position/money; then back again.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = []; let fails = 0;
  const page = await b.newPage({ viewport: { width: 1000, height: 640 } });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript(() => { if (!sessionStorage.getItem("td_t")) { localStorage.clear(); localStorage.setItem("td_gfx_quality", "low"); sessionStorage.setItem("td_t", "1"); } });
  const ready = () => page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  const state = () => page.evaluate(() => {
    let big = 0, lm = 0;
    const d = window.__tdDraw(false);
    for (const [k, n] of d) { if (/block-.*-imp|BigCity/.test(k)) big += n; if (/Landmarks/.test(k)) lm += n; }
    return { map: localStorage.getItem("td_map") || "(default)", big, bigMeshes: (window.__tdDrawIn("BigCity") || []).length, car: window.__td.car() };
  });
  const check = (c, msg) => { console.log((c ? "PASS " : "FAIL ") + msg); if (!c) fails++; };
  await page.goto(URL); await ready(); await page.waitForTimeout(3000);
  await page.evaluate(() => window.__td.summonCar(150, 20, Math.PI)); await page.waitForTimeout(5000);
  let s = await state(); console.log(JSON.stringify(s));
  check(s.map === "(default)" && s.bigMeshes === 0, "default map is Toshkent (no Big City blocks)");
  const pos0 = s.car;
  await page.click("#td-menu-btn"); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/v1.7.1-map-picker.png` });
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('#td-map-picker [data-map="bigcity"]')]);
  await ready(); await page.waitForTimeout(6000);
  s = await state(); console.log(JSON.stringify(s));
  check(s.map === "bigcity" && s.bigMeshes > 0, "switched to Big City (blocks rendered)");
  check(Math.hypot(s.car.x - pos0.x, s.car.z - pos0.z) < 12, `car kept its spot (${pos0.x.toFixed(1)},${pos0.z.toFixed(1)} -> ${s.car.x.toFixed(1)},${s.car.z.toFixed(1)})`);
  await page.screenshot({ path: `${OUT}/v1.7.1-map-switched.png` });
  await page.click("#td-menu-btn"); await page.waitForTimeout(500);
  await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('#td-map-picker [data-map="toshkent"]')]);
  await ready(); await page.waitForTimeout(5000);
  s = await state(); console.log(JSON.stringify(s));
  check(s.map === "toshkent" && s.bigMeshes === 0, "switched back to Toshkent");
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 5).join("\n"));
  console.log(fails ? `RESULT FAIL (${fails})` : "RESULT PASS");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
