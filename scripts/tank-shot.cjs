// Tank cockpit (camMode 1) screenshot: teleport by the FORT NEON tank, take the tank, press C.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots", P = process.env.PREFIX || "v2.1";
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "high");
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  if (await page.locator("#controls").count()) await page.keyboard.press("KeyH").catch(() => {});
  await page.addStyleTag({ content: "#speedo,#nitrobar,#minimap,#maphint,#helpbtn,#camsel,#sensitivity,#td-tools,#waypoint{display:none!important}" });
  await page.evaluate(() => window.__td.tp(1670, -392, 0));
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__td.enter("tank"));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${P}-tank-chase.png` });
  await page.keyboard.press("KeyC");
  await page.waitForTimeout(2500);
  console.log("active", await page.evaluate(() => window.__td.active()));
  await page.screenshot({ path: `${OUT}/${P}-tank-cockpit.png` });
  await page.keyboard.down("KeyW"); await page.waitForTimeout(1500); await page.keyboard.up("KeyW");
  await page.screenshot({ path: `${OUT}/${P}-tank-cockpit-drive.png` });
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
