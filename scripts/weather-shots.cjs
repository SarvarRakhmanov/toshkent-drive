// v2.0 weather shots: clouds, rain/fog/snow, wind, dusk & night.
//   X=-750 Z=60 H0=2.4 QUALITY=low|high W H PREFIX
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots", P = process.env.PREFIX || "v2.0-weather";
const X = Number(process.env.X || -700), Z = Number(process.env.Z || 40), H0 = Number(process.env.H0 || 2.4);
const SET = (process.env.SET || "clear:0.9,overcast:0.9,rain:0.9,fog:0.9,snow:0.9,clear:3.45,rain:3.6,clear:4.4").split(",");
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
  await page.addStyleTag({ content: "#nitrobar,#maphint,#helpbtn,#camsel,#sensitivity,#td-tools,#waypoint{display:none!important}" });
  await page.evaluate(([x, z, h]) => window.__td.summonCar(x, z, h), [X, Z, H0]);
  await page.waitForTimeout(3000);
  if (process.env.PITCH) await page.evaluate((p) => window.__td.look(0, p), Number(process.env.PITCH));
  const winds = [];
  for (const s of SET) {
    const [k, ph] = s.split(":");
    await page.evaluate(([k, ph]) => { window.__td.weather(k); window.__td.skyPhase(Number(ph)); }, [k, ph]);
    await page.waitForTimeout(6000); // fog/sky blend
    const w = await page.evaluate(() => window.__td.weather());
    const perf = await page.evaluate(() => { const p = window.__tdPerf(); return { calls: p.calls, tris: p.triangles }; });
    const name = `${OUT}/${P}-${k}-${Math.round(w.hour)}h.png`;
    await page.screenshot({ path: name });
    winds.push(w.wind.speed);
    console.log(`${k} @${w.hour.toFixed(1)}h night=${w.nightK.toFixed(2)} wind=${w.wind.speed.toFixed(1)}m/s dir=${w.wind.dir.toFixed(2)} flash=${w.flash.toFixed(2)} ${JSON.stringify(perf)} -> ${name}`);
  }
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
