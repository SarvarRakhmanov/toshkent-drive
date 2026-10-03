// v1.9 missions: run a taxi, a delivery and a race by summoning the car onto
// each target, check payouts, buy an upgrade, reload and verify the save.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const P = process.env.PREFIX || "v1.9-missions";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const ctx = await b.newContext({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.addInitScript(() => { if (!sessionStorage.getItem("td_once")) { sessionStorage.setItem("td_once", "1"); localStorage.setItem("td_gfx_quality", "low"); for (const k of Object.keys(localStorage)) if (k.startsWith("td_career")) localStorage.removeItem(k); } });
  const ready = () => p.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await p.goto(URL, { waitUntil: "load" }); await ready();
  if (await p.locator("#controls").count()) await p.keyboard.press("KeyH").catch(() => {});
  await p.waitForTimeout(1500);
  const log = (...a) => console.log(...a);
  for (const kind of ["taxi", "delivery", "race"]) {
    const err = await p.evaluate((k) => window.__td.startMission(k), kind);
    if (err) { log(kind, "start error", err); continue; }
    let m = await p.evaluate(() => window.__td.mission());
    log(kind, "started", JSON.stringify(m));
    if (kind === "taxi") { await p.waitForTimeout(1500); await p.screenshot({ path: `shots/${P}-taxi-hud.png` }); }
    let guard = 0;
    while (m && guard++ < 10) {
      const t = m.target;
      await p.evaluate(([x, z]) => window.__td.summonCar(x, z - 3, 0), [t.x, t.z]);
      await p.waitForTimeout(2500);
      if (kind === "race" && guard === 1) await p.screenshot({ path: `shots/${P}-race-beam.png` });
      m = await p.evaluate(() => window.__td.mission());
    }
    log(kind, "finished; career", JSON.stringify(await p.evaluate(() => window.__td.career())));
  }
  await p.evaluate(() => window.__td.giveMoney(1000));
  log("buy power:", await p.evaluate(() => window.__td.buyUpgrade("seltos", "power")), "grip:", await p.evaluate(() => window.__td.buyUpgrade("seltos", "grip")));
  const before = await p.evaluate(() => window.__td.career());
  await p.keyboard.press("KeyP"); await p.waitForTimeout(800);
  await p.screenshot({ path: `shots/${P}-phone.png` });
  await p.keyboard.press("Escape").catch(() => {});
  await p.reload({ waitUntil: "load" }); await ready(); await p.waitForTimeout(1000);
  const after = await p.evaluate(() => window.__td.career());
  log("before reload", JSON.stringify(before)); log("after reload ", JSON.stringify(after));
  log(`RESULT saved=${after.money === before.money && JSON.stringify(after.levels) === JSON.stringify(before.levels)} money=${after.money} jobs=${after.jobs}`);
  log(`ERRORS(${errs.length}) ${errs.slice(0, 8).join("\n")}`);
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
