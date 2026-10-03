// Headless smoke test: load the static build, drive with simulated keys, capture screenshots.
const { chromium } = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/";
const OUT = process.env.OUT || "shots";
(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage", "--disable-gpu-sandbox", "--js-flags=--max-old-space-size=2048"] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } });
  await page.addInitScript((a) => { if (a.q) localStorage.setItem("td_gfx_quality", a.q); if (a.c) localStorage.setItem("td_player_car", a.c); }, { q: process.env.QUALITY || "", c: process.env.CAR || "" });
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url() + " " + (r.failure()?.errorText || "")));
  page.on("response", (r) => { if (r.status() >= 400) errors.push("http " + r.status() + ": " + r.url()); });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(Number(process.env.WARM || 25000));
  const speed = async () => (await page.locator("#speedo .num").textContent().catch(() => "?"))?.trim();
  await page.keyboard.press("KeyH");
  await page.screenshot({ path: `${OUT}/${process.env.PREFIX || ""}start.png` });
  console.log("speed at rest:", await speed());
  // (no canvas click: it requests pointer lock, which headless chromium does not like)
  await page.keyboard.down("KeyW");
  let max = 0;
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(700); const s = Number(await speed()); if (s > max) max = s; }
  console.log("speed after holding W:", await speed(), "max:", max);
  await page.screenshot({ path: `${OUT}/${process.env.PREFIX || ""}driving.png` });
  await page.keyboard.down("KeyA");
  await page.waitForTimeout(2500);
  await page.keyboard.up("KeyA");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${process.env.PREFIX || ""}turning.png` });
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(2000);
  console.log("speed after reset:", await speed());
  if (process.env.LOWSHOT) {
    await page.keyboard.press("KeyQ");
    await page.waitForTimeout(15000);
    await page.screenshot({ path: `${OUT}/${process.env.PREFIX || ""}low-quality.png` });
  }
  const info = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const gl = c && (c.getContext("webgl2") || c.getContext("webgl"));
    const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "n/a", title: document.title };
  });
  console.log("info:", JSON.stringify(info));
  console.log("ERRORS(" + errors.length + "):\n" + errors.join("\n"));
  await browser.close();
})();
