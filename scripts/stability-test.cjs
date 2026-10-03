// HIGH-graphics stability soak: loads the game, drives for DURATION seconds and
// logs every page load (navigation), Canvas (re)creation, WebGL context
// lost/restored event, loading-screen re-entry, quality changes, JS heap and
// console errors. Fails on any reload, context loss loop or error.
//   MODE=desktop|phone  QUALITY=high|low  DURATION=200  URL=...  (AutoQuality ON by default)
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/";
const MODE = process.env.MODE || "desktop";
const QUALITY = process.env.QUALITY || "high";
const DURATION = Number(process.env.DURATION || 200);
const OUT = process.env.OUT || "shots";
const TAG = `stab-${MODE}-${QUALITY}`;
const log = (...a) => console.log(`[${TAG}]`, ...a);
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
  const phone = MODE === "phone";
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36" }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: Number(process.env.DSF || 2) });
  await ctx.addInitScript((q) => {
    if (!sessionStorage.getItem("__stab_init")) { sessionStorage.setItem("__stab_init", "1"); localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }
    window.__stab = { canvases: 0, lost: 0, restored: 0 };
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      const c = orig.call(this, type, ...rest);
      if (c && /webgl/.test(type) && !this.__stabHooked) {
        this.__stabHooked = true; this.__stabGl = c; window.__stab.canvases++; (window.__stab.live = window.__stab.live || []).push(this);
        this.addEventListener("webglcontextlost", () => { window.__stab.lost++; console.log("[stab] webglcontextlost"); });
        this.addEventListener("webglcontextrestored", () => { window.__stab.restored++; console.log("[stab] webglcontextrestored"); });
      }
      return c;
    };
  }, QUALITY);
  const page = await ctx.newPage();
  const errors = [], tdLogs = [];
  let navs = 0;
  const t0 = Date.now();
  // real document loads only (same-document history updates also fire framenavigated)
  page.on("domcontentloaded", () => { navs++; tdLogs.push(`${((Date.now() - t0) / 1000).toFixed(0)}s PAGE LOAD #${navs}`); });
  page.on("console", (m) => { const t = m.text(); if (m.type() === "error") errors.push(t); if (/\[td\]|\[stab\]/.test(t)) tdLogs.push(`${((Date.now() - t0) / 1000).toFixed(0)}s ${t}`); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("crash", () => errors.push("PAGE CRASHED"));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  log(`ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const snap = () => page.evaluate(() => {
    const p = window.__tdPerf ? window.__tdPerf() : {};
    return { safe: localStorage.getItem("td_gfx_safe"), phase: window.__td.load().phase, q: localStorage.getItem("td_gfx_quality"), canvases: window.__stab.canvases, lost: window.__stab.lost, restored: window.__stab.restored, frames: p.frames, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null, gpuTex: p.textures, gpuGeo: p.geometries, msg: document.querySelector("#msg, .msg, #hudmsg")?.textContent || "" };
  });
  let notReady = 0, prevQ = null;
  const tEnd = Date.now() + DURATION * 1000;
  let k = 0, toggled = false;
  const lostDone = new Set();
  if (!phone) await page.mouse.click(640, 360).catch(() => {});
  while (Date.now() < tEnd) {
    // drive in circles: hold W, alternate steering
    const key = k % 2 ? "KeyA" : "KeyD";
    await page.keyboard.down("KeyW").catch(() => {});
    await page.keyboard.down(key).catch(() => {});
    await page.waitForTimeout(5000);
    await page.keyboard.up(key).catch(() => {});
    let s;
    try { s = await snap(); } catch (e) { errors.push("snap failed: " + e.message); break; }
    if (s.phase !== "ready") notReady++;
    if (prevQ && s.q !== prevQ) tdLogs.push(`${((Date.now() - t0) / 1000).toFixed(0)}s quality ${prevQ} -> ${s.q}`);
    prevQ = s.q;
    if (process.env.TOGGLE_AT && !toggled && Date.now() - t0 > Number(process.env.TOGGLE_AT) * 1000) { toggled = true; tdLogs.push(`${((Date.now() - t0) / 1000).toFixed(0)}s pressed Q (quality toggle)`); await page.keyboard.press("KeyQ"); }
    // simulate GPU memory loss of the LIVE canvas (no restore), e.g. LOSE_AT=60,130
    for (const at of (process.env.LOSE_AT || "").split(",").filter(Boolean).map(Number)) {
      if (!lostDone.has(at) && Date.now() - t0 > at * 1000) {
        lostDone.add(at);
        tdLogs.push(`${((Date.now() - t0) / 1000).toFixed(0)}s forcing WEBGL_lose_context on the live canvas`);
        await page.evaluate(() => { const c = (window.__stab.live || []).filter((x) => x.isConnected).pop(); const gl = c && c.__stabGl; const ext = gl && gl.getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); }).catch(() => {});
      }
    }
    if (process.env.VERBOSE || k % 6 === 0) log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s`, JSON.stringify(s));
    k++;
  }
  await page.keyboard.up("KeyW").catch(() => {});
  const s = await snap().catch(() => ({}));
  await page.screenshot({ path: `${OUT}/${TAG}-end.png` }).catch(() => {});
  log("final", JSON.stringify(s));
  log("events:\n  " + (tdLogs.join("\n  ") || "none"));
  log(`RESULT navigations=${navs} canvases=${s.canvases} contextLost=${s.lost} notReadySamples=${notReady} quality=${s.q}`);
  log(`ERRORS(${errors.length})`, errors.slice(0, 10).join("\n"));
  await browser.close();
  process.exit(errors.length || navs > 1 ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
