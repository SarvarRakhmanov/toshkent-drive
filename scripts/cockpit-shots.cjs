// Cockpit-view screenshots (v1.4): straight ahead and steering left, per car,
// plus a check that entering the cockpit compiles no new shader programs.
//   CARS=4,1  OUT=shots PREFIX=v1.4  W=900 H=600
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
const P = process.env.PREFIX || "v1.4";
const CARS = (process.env.CARS || "4,1").split(",").map(Number);
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  for (const car of CARS) {
    const page = await browser.newPage({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[car ${car}] ` + m.text()); });
    page.on("pageerror", (e) => errors.push(`[car ${car}] pageerror: ` + e.message));
    await page.addInitScript(([q, c]) => { localStorage.setItem("td_gfx_quality", q); localStorage.setItem("td_player_car", String(c)); localStorage.removeItem("td_save"); }, [process.env.QUALITY || "high", car]);
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
    if (await page.locator("#controls").count()) await page.keyboard.press("KeyH").catch(() => {});
    await page.addStyleTag({ content: "#speedo,#nitrobar,#minimap,#maphint,#helpbtn,#camsel,#sensitivity,#td-tools,#waypoint{display:none!important}" });
    await page.waitForTimeout(1500);
    const p0 = await page.evaluate(() => window.__tdPerf().programs);
    await page.keyboard.press("KeyC"); // chase -> cockpit
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${P}-cockpit-car${car}.png` });
    await page.keyboard.down("KeyW");
    await page.keyboard.down("KeyA");
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/${P}-cockpit-car${car}-steer.png` });
    await page.keyboard.up("KeyA");
    await page.keyboard.up("KeyW");
    const p1 = await page.evaluate(() => window.__tdPerf().programs);
    const perf = await page.evaluate(() => { const p = window.__tdPerf(); return { calls: p.calls, tris: p.triangles }; });
    console.log(`car ${car}: programs ${p0} -> ${p1} (cockpit), ${JSON.stringify(perf)}`);
    await page.close();
  }
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
