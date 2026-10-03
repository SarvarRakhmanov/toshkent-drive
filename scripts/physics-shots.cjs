// v1.6 vehicle-physics screenshots: per car, full-throttle run (HUD gear/rpm
// visible) then a handbrake turn (body roll / drift). Logs the speedo readout.
//   CARS=2,4 OUT=shots PREFIX=v1.6 QUALITY=low W=900 H=600
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
const P = process.env.PREFIX || "v1.6";
const CARS = (process.env.CARS || "2,4").split(",").map(Number);
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  for (const car of CARS) {
    const page = await browser.newPage({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[car ${car}] ` + m.text()); });
    page.on("pageerror", (e) => errors.push(`[car ${car}] pageerror: ` + e.message));
    await page.addInitScript(([q, c]) => { localStorage.setItem("td_gfx_quality", q); localStorage.setItem("td_player_car", String(c)); localStorage.removeItem("td_save"); }, [process.env.QUALITY || "low", car]);
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
    if (await page.locator("#controls").count()) await page.keyboard.press("KeyH").catch(() => {});
    await page.waitForTimeout(1500);
    const speedo = () => page.evaluate(() => { const s = document.querySelector("#speedo"); const f = s && s.querySelector(".rpm .fill"); return s ? `${s.querySelector(".num")?.textContent} km/h gear ${s.querySelector(".gear")?.textContent} rpm ${f ? f.style.width : "?"}` : "no speedo"; });
    await page.keyboard.down("KeyW");
    const log = [];
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(1000); log.push(await speedo()); }
    await page.screenshot({ path: `${OUT}/${P}-accel-car${car}.png` });
    await page.keyboard.down("KeyA");
    await page.keyboard.down("Space");
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${P}-drift-car${car}.png` });
    await page.keyboard.up("Space");
    await page.waitForTimeout(700);
    log.push("drift: " + (await speedo()));
    await page.keyboard.up("KeyA");
    await page.keyboard.up("KeyW");
    console.log(`car ${car}: ` + log.join(" | "));
    await page.close();
  }
  console.log(`ERRORS(${errors.length}):\n` + errors.slice(0, 20).join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
