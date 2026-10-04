// v1.8: wanted level + police chase. 1) drive through a red light (real
// detection) 2) stay stopped -> BUSTED with fine 3) new crime, teleport far
// away -> ESCAPED with camera fine. MAP=toshkent|bigcity
const pw = require(process.env.PW || "playwright");
const MAP = process.env.MAP || "toshkent";
const URL = process.env.URL || `http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0&map=${MAP}`;
const OUT = process.env.OUT || "shots";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const page = await b.newPage({ viewport: { width: 900, height: 560 } });
  const errors = []; let fails = 0;
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript(() => { localStorage.setItem("td_gfx_quality", "low"); localStorage.removeItem("td_save"); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(3000);
  const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
  await page.evaluate(() => window.__td.giveMoney(2000));
  // 1) red light: wait until the z-axis signal is red with time to spare, then drive north (+z) through x=150,z=50
  await page.waitForFunction(() => { const s = window.__td.signal(); return s.z === 0 && s.t > 0.5 && s.t < 3; }, null, { polling: 100, timeout: 60000 });
  await page.evaluate(() => window.__td.forceCar(145, 35, 0)); await page.waitForTimeout(1200);
  // software GL runs in slow motion here: hold W until the car is through the junction box
  await page.keyboard.down("KeyW");
  for (let i = 0; i < 120; i++) { await page.waitForTimeout(500); const c = await page.evaluate(() => window.__td.car()); if (c.z > 62) break; }
  await page.keyboard.up("KeyW");
  let w = await page.evaluate(() => window.__td.wanted());
  console.log("after red light", JSON.stringify(w), JSON.stringify(await page.evaluate(() => window.__td.car())));
  check(w.level >= 1 && /RED/.test(w.reason), "running a red light gives a wanted star");
  if (!w.level) await page.evaluate(() => window.__td.crime("red"));
  await page.keyboard.down("Space");
  for (let i = 0; i < 120; i++) { await page.waitForTimeout(500); const c = await page.evaluate(() => window.__td.car()); if (Math.abs(c.speed) < 0.3) break; }
  await page.keyboard.up("Space");
  // 2) stay put -> units arrive -> busted
  const m0 = (await page.evaluate(() => window.__td.career())).money;
  let busted = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    w = await page.evaluate(() => window.__td.wanted());
    if (i % 6 === 0) console.log("t", i, JSON.stringify(w), JSON.stringify(await page.evaluate(() => window.__td.car())));
    if (i === 8) { await page.evaluate(() => window.__td.look(0.6, -0.15)); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/v1.8-police-chase-${MAP}.png` }); }
    if (!w.level) { busted = true; break; }
  }
  const m1 = (await page.evaluate(() => window.__td.career())).money;
  check(busted && m1 < m0, `BUSTED clears the stars and fines (${m0} -> ${m1})`);
  // 3) escape
  await page.evaluate(() => { window.__td.crime("ped"); });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__td.forceCar(-650, 350, 0));
  let escaped = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000);
    w = await page.evaluate(() => window.__td.wanted());
    if (!w.level) { escaped = true; break; }
  }
  const m2 = (await page.evaluate(() => window.__td.career())).money;
  check(escaped && m2 < m1, `ESCAPED clears the stars with a camera fine (${m1} -> ${m2})`);
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 5).join("\n"));
  console.log(fails ? `RESULT FAIL (${fails})` : "RESULT PASS");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
