// Mobile/touch test: iPhone-sized viewport with touch, drives with real touch
// input (Chromium: CDP multi-touch; WebKit: pointer events), checks speed/turn,
// console errors, and saves screenshots to shots/mobile-*.png.
//   BROWSER=chromium|webkit  ORIENT=portrait|landscape|desktop  URL=...
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/";
const BROWSER = process.env.BROWSER || "chromium";
const ORIENT = process.env.ORIENT || "portrait";
const OUT = process.env.OUT || "shots";
const WARM = Number(process.env.WARM || 25000);
const tag = `mobile-${BROWSER}-${ORIENT}${process.env.QUALITY ? "-" + process.env.QUALITY : ""}`;
const log = (...a) => console.log(`[${tag}]`, ...a);

(async () => {
  const type = pw[BROWSER];
  const launchArgs = BROWSER === "chromium"
    ? { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=2048"] }
    : {};
  const browser = await type.launch(launchArgs);
  const desktop = ORIENT === "desktop";
  const vp = desktop ? { width: Number(process.env.W || 1280), height: Number(process.env.H || 720) } : ORIENT === "landscape" ? { width: 844, height: 390 } : { width: 390, height: 844 };
  const ctxOpts = desktop
    ? { viewport: vp }
    : {
        viewport: vp,
        screen: vp,
        deviceScaleFactor: 2,
        hasTouch: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      };
  if (!desktop && BROWSER === "chromium") ctxOpts.isMobile = true;
  const context = await browser.newContext(ctxOpts);
  if (process.env.QUALITY) await context.addInitScript((q) => localStorage.setItem("td_gfx_quality", q), process.env.QUALITY);
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("response", (r) => { if (r.status() >= 400) errors.push("http " + r.status() + ": " + r.url()); });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForSelector("canvas", { timeout: 90000 });
  // the loading screen stays up until the city is built and shaders compiled
  const tGo = Date.now();
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 240000 })
    .catch(() => errors.push("never reached ready state"));
  log(`ready (loading screen gone) after ${((Date.now() - tGo) / 1000).toFixed(1)} s`);
  await page.waitForTimeout(Math.min(WARM, 3000));
  const speed = async () => Number((await page.locator("#speedo .num").textContent().catch(() => "-1"))?.trim());
  const world = () => page.evaluate(() => ({ ...window.__tdWorld }));
  const gfx = await page.evaluate(() => localStorage.getItem("td_gfx_quality") || "(default)");
  const state = await page.evaluate(() => ({
    touchClass: document.documentElement.classList.contains("td-touch"),
    tc: !!document.getElementById("tc"),
    controls: !!document.getElementById("controls"),
    camsel: !!document.getElementById("camsel"),
    sens: !!document.getElementById("sensitivity"),
    tdtools: !!document.getElementById("td-tools"),
    helpbtn: !!document.getElementById("helpbtn"),
    gfxLabel: document.querySelector(".tc-gfx")?.textContent || null,
    dpr: window.devicePixelRatio,
  }));
  log("ui:", JSON.stringify(state), "gfx stored:", gfx);
  await page.screenshot({ path: `${OUT}/${tag}-start.png` });

  // overlap check between visible HUD/touch elements
  const overlaps = await page.evaluate(() => {
    const sel = ["#hud", "#speedo", "#nitrobar", "#minimap", "#camsel", "#sensitivity", "#td-tools", "#helpbtn", "#controls", "#tc-top", ".tc-steer", ".tc-gas", ".tc-brake", ".tc-hb", ".tc-nitro", ".tc-use", "#tc-rotate", "#waypoint"];
    const boxes = [];
    for (const s of sel) for (const el of document.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && getComputedStyle(el).display !== "none") boxes.push({ s, r: [r.left, r.top, r.right, r.bottom].map(Math.round) });
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r, b = boxes[j].r;
      if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) out.push(boxes[i].s + " x " + boxes[j].s);
    }
    return { boxes, out, vw: innerWidth, vh: innerHeight };
  });
  log("boxes:", JSON.stringify(overlaps.boxes));
  log("OVERLAPS:", overlaps.out.length ? overlaps.out.join(", ") : "none", `(viewport ${overlaps.vw}x${overlaps.vh})`);

  const center = async (s) => {
    const b = await page.locator(s).first().boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width };
  };
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - t0)); }; requestAnimationFrame(f); }));
  log("render fps (headless software GL):", fps.toFixed(1));
  const w0 = await world();
  log("speed at rest:", await speed(), "pos", w0.px.toFixed(1), w0.pz.toFixed(1), "heading", w0.heading.toFixed(3));

  let maxSpeed = 0;
  let turned = 0;
  if (desktop) {
    await page.keyboard.down("KeyW");
    for (let i = 0; i < 10; i++) { await page.waitForTimeout(700); maxSpeed = Math.max(maxSpeed, await speed()); }
    const h1 = (await world()).heading;
    await page.keyboard.down("KeyA");
    await page.waitForTimeout(2000);
    await page.keyboard.up("KeyA");
    const h2 = (await world()).heading;
    turned = h2 - h1;
    await page.screenshot({ path: `${OUT}/${tag}-driving.png` });
    await page.keyboard.up("KeyW");
    // help button
    await page.click("#helpbtn");
    await page.waitForTimeout(300);
    log("help panel after ? click:", await page.locator("#controls").count());
    await page.screenshot({ path: `${OUT}/${tag}-help.png` });
  } else {
    const gas = await center(".tc-gas");
    const steer = await center(".tc-steer");
    const leftPt = { x: steer.x - steer.w * 0.27, y: steer.y }; // middle of the ◀ half
    if (BROWSER === "chromium") {
      const cdp = await context.newCDPSession(page);
      const tp = (pts) => pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 }));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp([{ ...gas, id: 1 }]) });
      for (let i = 0; i < 10; i++) { await page.waitForTimeout(700); maxSpeed = Math.max(maxSpeed, await speed()); }
      const h1 = (await world()).heading;
      // second finger on the steering pad while the first still holds GAS
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: tp([{ ...gas, id: 1 }, { ...leftPt, id: 2 }]) });
      await page.waitForTimeout(400);
      const pressed = await page.evaluate(() => ({ gas: document.querySelector(".tc-gas").classList.contains("on"), steer: document.querySelector(".tc-steer").className }));
      log("while multi-touch:", JSON.stringify(pressed));
      await page.screenshot({ path: `${OUT}/${tag}-driving.png` });
      await page.waitForTimeout(1600);
      // slide steering finger to centre-right (analog)
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: tp([{ ...gas, id: 1 }, { x: steer.x + steer.w * 0.1, y: steer.y, id: 2 }]) });
      await page.waitForTimeout(200);
      const analog = await page.evaluate(() => document.querySelector(".tc-steer").className);
      log("after slide to right of centre:", analog);
      const h2 = (await world()).heading;
      turned = h2 - h1;
      maxSpeed = Math.max(maxSpeed, await speed());
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      // WebKit: no CDP touch — dispatch real PointerEvents (pointerType touch, two pointer ids)
      const fire = (type, sel, p, id) => page.evaluate(({ type, sel, p, id }) => {
        const el = sel ? document.querySelector(sel) : document.elementFromPoint(p.x, p.y);
        el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 11, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, buttons: type === "pointerup" ? 0 : 1 }));
      }, { type, sel, p, id });
      await fire("pointerdown", null, gas, 11);
      for (let i = 0; i < 10; i++) { await page.waitForTimeout(700); maxSpeed = Math.max(maxSpeed, await speed()); }
      const h1 = (await world()).heading;
      await fire("pointerdown", null, leftPt, 12);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-driving.png` });
      await page.waitForTimeout(1600);
      const h2 = (await world()).heading;
      turned = h2 - h1;
      maxSpeed = Math.max(maxSpeed, await speed());
      await fire("pointerup", ".tc-steer", leftPt, 12);
      await fire("pointerup", ".tc-gas", gas, 11);
    }
    await page.waitForTimeout(1500);
    log("speed 1.5s after releasing:", await speed());
    // top row: reset / camera taps
    if (BROWSER === "chromium") {
      const cam = await page.locator("#tc-top .tc-btn").nth(2).boundingBox();
      await page.touchscreen.tap(cam.x + cam.width / 2, cam.y + cam.height / 2);
      await page.waitForTimeout(400);
      log("after CAM tap msg:", await page.locator("#msg").textContent());
      await page.touchscreen.tap(cam.x + cam.width / 2, cam.y + cam.height / 2);
      await page.touchscreen.tap(cam.x + cam.width / 2, cam.y + cam.height / 2);
      await page.touchscreen.tap(cam.x + cam.width / 2, cam.y + cam.height / 2); // back to CHASE
      const more = await page.locator("#tc-top .tc-btn").nth(5).boundingBox();
      await page.touchscreen.tap(more.x + more.width / 2, more.y + more.height / 2);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${tag}-menu.png` });
      await page.touchscreen.tap(more.x + more.width / 2, more.y + more.height / 2);
      const rst = await page.locator("#tc-top .tc-btn").nth(0).boundingBox();
      await page.touchscreen.tap(rst.x + rst.width / 2, rst.y + rst.height / 2);
      await page.waitForTimeout(400);
      log("after RESET tap msg:", await page.locator("#msg").textContent());
    }
  }
  const scale = await page.evaluate(() => window.visualViewport ? window.visualViewport.scale : 1);
  log(`RESULT maxSpeed=${maxSpeed} km/h, heading change while steering left=${turned.toFixed(3)} rad, page zoom=${scale}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${tag}-end.png` });
  log("ERRORS(" + errors.length + "):" + (errors.length ? "\n" + errors.join("\n") : ""));
  await browser.close();
})().catch((e) => { console.error(`[${tag}] FATAL`, e); process.exit(1); });
