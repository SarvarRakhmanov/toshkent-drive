// Screenshots of the player cars (rear + front view) for checking models/plates.
//   CARS=0,1,4  W=900 H=600  OUT=shots
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
const CARS = (process.env.CARS || "0,1,4").split(",").map(Number);
(async () => {
  const DSF = Number(process.env.DSF || 1);
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  for (const car of CARS) {
    const page = await browser.newPage({ deviceScaleFactor: DSF, viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[car ${car}] ` + m.text()); });
    page.on("pageerror", (e) => errors.push(`[car ${car}] pageerror: ` + e.message));
    await page.addInitScript(([q, c]) => { localStorage.setItem("td_gfx_quality", q); localStorage.setItem("td_player_car", String(c)); localStorage.removeItem("td_save"); }, [process.env.QUALITY || "high", car]);
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 300000 });
    if (await page.locator("#controls").count()) await page.keyboard.press("KeyH").catch(() => {}); // hide help panel
    if (process.env.HIDEHUD) await page.addStyleTag({ content: "#speedo,#nitrobar,#minimap,#maphint,#helpbtn,#camsel,#sensitivity,#td-tools,#waypoint,#hud{display:none!important}" });
    await page.waitForTimeout(3000);
    const progs0 = await page.evaluate(() => window.__tdPerf().programs);
    await page.screenshot({ path: `${OUT}/car-${car}-rear.png`, timeout: 180000 });
    await page.evaluate((y) => window.__td.look(y, 0.05), Number(process.env.YAW || Math.PI * 0.82));
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${OUT}/car-${car}-front.png`, timeout: 180000 });
    const progs1 = await page.evaluate(() => window.__tdPerf().programs);
    console.log(`car ${car}: shots saved, programs ${progs0} -> ${progs1}`);
    await page.close();
  }
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
