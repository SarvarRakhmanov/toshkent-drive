// v1.6.1: "car won't move" regression test — touch GAS held from the start
// spawn, per car / weather / quality / orientation. Prints speed over time.
//   CAR=3 WEATHER=snow QUALITY=high W=1024 H=549
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const W = Number(process.env.W || 1024), H = Number(process.env.H || 549);
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, screen: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36" });
  await ctx.addInitScript(([q, c]) => { localStorage.setItem("td_gfx_quality", q); if (c !== "") localStorage.setItem("td_player_car", c); localStorage.removeItem("td_save"); }, [process.env.QUALITY || "high", process.env.CAR ?? "3"]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  if (process.env.WEATHER) await page.evaluate((w) => window.__td.weather(w), process.env.WEATHER);
  await page.waitForTimeout(2500);
  console.log("safety after spawn", JSON.stringify(await page.evaluate(() => window.__td.safety())));
  if (process.env.FORCE === "auto") {
    // find a spot whose car footprint overlaps a static collider, near the spawn
    const spot = await page.evaluate(() => { for (let r = 10; r < 200; r += 3) for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, x = Math.sin(a) * r, z = Math.cos(a) * r; if (window.__td.clear(x, z, 0, 0) === false) return [x, z]; } return null; });
    console.log("blocked spot", JSON.stringify(spot));
    process.env.FORCE = spot ? `${spot[0]},${spot[1]},0` : "";
  }
  if (process.env.FORCE) { const [fx, fz, fh] = process.env.FORCE.split(",").map(Number); await page.evaluate(([x, z, h]) => window.__td.forceCar(x, z, h), [fx, fz, fh]); await page.waitForTimeout(1500); }
  const gas = await page.locator(".tc-gas").boundingBox();
  console.log("viewport", W, H, "gas box", JSON.stringify(gas), "start", JSON.stringify(await page.evaluate(() => window.__td.car())));
  const cdp = await ctx.newCDPSession(page);
  const x = gas.x + gas.width / 2, y = gas.y + gas.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  const samples = [];
  for (let i = 0; i < Number(process.env.SECS || 6); i++) {
    await page.waitForTimeout(1000);
    const c = await page.evaluate(() => { const c = window.__td.car(); return { x: +c.x.toFixed(1), z: +c.z.toFixed(1), v: +(c.speed ?? 0).toFixed(2), dbg: window.__td.dyn ? window.__td.dyn() : null }; });
    samples.push(c);
    console.log("t", i + 1, JSON.stringify(c), JSON.stringify(await page.evaluate(() => window.__td.safety().unstucks)), "speedo", await page.locator("#speedo .num").textContent().catch(() => "?"));
  }
  await page.screenshot({ path: `${OUT}/stuck-${process.env.TAG || "t"}.png` });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const d = Math.hypot(samples.at(-1).x - samples[0].x, samples.at(-1).z - samples[0].z);
  console.log("safety end", JSON.stringify(await page.evaluate(() => window.__td.safety())));
  console.log(`MOVED ${d.toFixed(1)} m  ${d > 10 ? "OK" : "STUCK"}`);
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
