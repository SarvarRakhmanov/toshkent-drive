// Perf profile: loads the static build (SwiftShader WebGL), records load time,
// bytes fetched, renderer.info (draw calls/triangles via window.__tdPerf),
// long tasks while driving, and JS heap (after forced GC) over a session.
//   MODE=phone|desktop  URL=...  SESSION=seconds (heap-growth run, default 60)
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/";
const MODE = process.env.MODE || "phone";
const SESSION = Number(process.env.SESSION || 60);
const OUT = process.env.OUT || "shots";
const TAG = process.env.TAG || MODE;
const log = (...a) => console.log(`[perf-${TAG}]`, ...a);

(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage", "--enable-precise-memory-info", "--js-flags=--expose-gc --max-old-space-size=2048"] });
  const phone = MODE === "phone";
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }
    : { viewport: { width: 1280, height: 720 } });
  if (process.env.QUALITY) await ctx.addInitScript((q) => localStorage.setItem("td_gfx_quality", q), process.env.QUALITY);
  if (process.env.CAR) await ctx.addInitScript((c) => localStorage.setItem("td_player_car", c), process.env.CAR);
  await ctx.addInitScript(() => {
    window.__lt = { n: 0, ms: 0, max: 0 };
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { window.__lt.n++; window.__lt.ms += e.duration; window.__lt.max = Math.max(window.__lt.max, e.duration); } }).observe({ type: "longtask", buffered: true });
    } catch {}
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errors = [], warnings = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); if (m.type() === "warning") warnings.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  const bytes = {}; let pending = 0, lastNet = Date.now();
  page.on("request", () => { pending++; lastNet = Date.now(); });
  const done = () => { pending--; lastNet = Date.now(); };
  page.on("requestfailed", (r) => { done(); errors.push("requestfailed " + r.url()); });
  page.on("requestfinished", async (r) => {
    done();
    try {
      const s = await r.sizes();
      const u = r.url().split("?")[0];
      const ext = (u.match(/\.(\w+)$/) || [, "html"])[1];
      bytes[ext] = (bytes[ext] || 0) + s.responseBodySize;
    } catch {}
  });
  const t0 = Date.now();
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 120000 });
  const tCanvas = Date.now() - t0;
  await page.waitForFunction(() => window.__tdPerf && window.__tdPerf().frames > 2, null, { timeout: 240000, polling: 100 });
  const tFirstFrame = Date.now() - t0;
  log("first frame at", tFirstFrame, "ms");
  // "ready" = rendering and network quiet for 1.5 s
  // (capped at 90 s: a stray never-finishing request must not hang the profile)
  const tq = Date.now();
  while (!(pending <= 0 && Date.now() - lastNet > 1500) && Date.now() - tq < 90000) await page.waitForTimeout(200);
  const tReady = Date.now() - t0 - 1500;
  log("pending requests at ready:", pending);
  log(`load: canvas ${tCanvas} ms, first frame ${tFirstFrame} ms, network-quiet ${tReady} ms`);
  const tot = Object.values(bytes).reduce((a, b) => a + b, 0);
  log("bytes fetched (MB):", (tot / 1e6).toFixed(2), JSON.stringify(Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, +(v / 1e6).toFixed(2)]))));
  await page.waitForTimeout(4000);
  const sample = async () => {
    const xs = [];
    for (let i = 0; i < 5; i++) { xs.push(await page.evaluate(() => window.__tdPerf())); await page.waitForTimeout(300); }
    xs.sort((a, b) => a.calls - b.calls);
    return xs[2];
  };
  const gcHeap = async () => { await page.evaluate(() => window.gc && window.gc()); await page.waitForTimeout(300); return (await page.evaluate(() => window.__tdPerf())).heapMB; };
  const idle = await sample();
  log("idle:", JSON.stringify(idle));
  if (process.env.DIAG) log("draw census (idle):", JSON.stringify(await page.evaluate(() => window.__tdDraw && window.__tdDraw(true))));
  log("pedestrian robots drawn (idle):", JSON.stringify(await page.evaluate(() => window.__td && window.__td.pedStats ? window.__td.pedStats() : null)));
  const heap0 = await gcHeap();
  await page.screenshot({ path: `${OUT}/perf-${TAG}-idle.png` });
  // drive: hold W with some steering for the session, sampling long tasks + heap
  await page.evaluate(() => { window.__lt = { n: 0, ms: 0, max: 0 }; });
  const f0 = (await page.evaluate(() => window.__tdPerf())).frames;
  const ts = Date.now();
  await page.keyboard.down("KeyW");
  const heaps = [];
  let drv = null;
  for (let s = 0; s < SESSION; s += 5) {
    const k = (s / 5) % 4 === 1 ? "KeyA" : (s / 5) % 4 === 3 ? "KeyD" : null;
    if (k) await page.keyboard.down(k);
    await page.waitForTimeout(k ? 1500 : 5000);
    if (k) { await page.keyboard.up(k); await page.waitForTimeout(3500); }
    if (s === 5) { drv = await sample(); await page.screenshot({ path: `${OUT}/perf-${TAG}-driving.png` }); if (process.env.DIAG) log("draw census (driving):", JSON.stringify(await page.evaluate(() => window.__tdDraw && window.__tdDraw(true)))); }
    if ((s / 5) % 6 === 5) await page.keyboard.press("KeyR"); // reset every 30 s so we keep moving
    if (s % 30 === 0) heaps.push(await gcHeap());
  }
  await page.keyboard.up("KeyW");
  const secs = (Date.now() - ts) / 1000;
  const frames = (await page.evaluate(() => window.__tdPerf())).frames - f0;
  const lt = await page.evaluate(() => window.__lt);
  const heap1 = await gcHeap();
  log("driving:", JSON.stringify(drv));
  log("pedestrian robots drawn (driving):", JSON.stringify(await page.evaluate(() => window.__td && window.__td.pedStats ? window.__td.pedStats() : null)));
  log(`avg fps (software GL, relative only): ${(frames / secs).toFixed(1)}; long tasks: ${lt.n} totalling ${Math.round(lt.ms)} ms, worst ${Math.round(lt.max)} ms`);
  log(`heap after GC: start ${heap0} MB -> end ${heap1} MB over ${Math.round(secs)} s; samples ${JSON.stringify(heaps)}`);
  const world = await page.evaluate(() => ({ ...window.__tdWorld }));
  log("world:", JSON.stringify(world));
  log(`ERRORS(${errors.length})`, errors.slice(0, 20).join("\n"));
  log(`WARNINGS(${warnings.length})`, [...new Set(warnings)].slice(0, 20).join("\n"));
  await browser.close();
})().catch((e) => { console.error(`[perf-${TAG}] FATAL`, e); process.exit(1); });
