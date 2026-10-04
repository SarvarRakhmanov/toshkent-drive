// v1.7b: vehicle switch test — pressing K / the car button / picking a car in
// the menu must swap the vehicle the player is driving, from any vehicle.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots", P = process.env.PREFIX || "v1.7b";
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 390), height: Number(process.env.H || 844) } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript(() => { localStorage.setItem("td_gfx_quality", "low"); localStorage.removeItem("td_save"); localStorage.removeItem("td_player_car"); });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(2500);
  const state = () => page.evaluate(() => {
    const d = window.__tdDraw(true).map((e) => e[0]).filter((n) => n.startsWith("td-car:"));
    return { active: window.__td.active(), cars: d, world: window.__td.world ? window.__td.world() : null };
  });
  const log = async (label) => console.log(label, JSON.stringify(await state()));
  await log("start");
  await page.keyboard.press("KeyK"); await page.waitForTimeout(3000); await log("after K in car");
  await page.keyboard.press("KeyB"); await page.waitForTimeout(2500); await log("after B (bike)");
  await page.keyboard.press("KeyK"); await page.waitForTimeout(3000); await log("after K on bike");
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
