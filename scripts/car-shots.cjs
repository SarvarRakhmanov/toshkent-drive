// v1.7b: chase-camera orbit shots of player cars (CARS=5,6,7) + wheel rig and draw stats
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots", P = process.env.PREFIX || "v1.7b-car";
const CARS = (process.env.CARS || "5,6,7").split(",").map(Number);
const YAWS = (process.env.YAWS || "0,2.4,1.57").split(",").map(Number);
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  const page = await b.newPage({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); localStorage.setItem("td_player_car", "0"); }, process.env.QUALITY || "low");
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.evaluate(() => window.__td.skyPhase && window.__td.skyPhase(0.3));
  for (const c of CARS) {
    await page.click("#td-menu-btn"); await page.waitForTimeout(300);
    const id = await page.evaluate((i) => document.querySelectorAll("#td-vehicles [data-car]")[i].getAttribute("data-car"), c);
    await page.click(`#td-vehicles [data-car="${id}"]`); await page.waitForTimeout(800);
    await page.evaluate(() => window.__td.summonCar(12, 52, 0)); await page.waitForTimeout(4000);
    console.log(id, "wheels", JSON.stringify(await page.evaluate((i) => (window.__tdWheels || {})[i], id)));
    for (const y of YAWS) {
      await page.evaluate((y) => window.__td.look(y, 0.12), y); await page.waitForTimeout(1500);
      const p = await page.evaluate(() => window.__tdPerf());
      console.log(id, "yaw", y, "calls", p.calls, "tris", p.triangles);
      await page.screenshot({ path: `${OUT}/${P}-${id}-${y}.png` });
    }
  }
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 8).join("\n"));
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
