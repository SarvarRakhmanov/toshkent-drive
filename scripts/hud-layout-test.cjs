// v1.8.1: HUD layout — no two visible HUD boxes may intersect at common sizes
// (desktop 543x388 like Sarvar's window, 1280x720, phone portrait/landscape
// with simulated safe insets). Also: infinite money toggle + a purchase.
const pw = require(process.env.PW || "playwright");
const BASE = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
const SIZES = [
  { name: "desktop-543x388", w: 543, h: 388 },
  { name: "desktop-1280x720", w: 1280, h: 720 },
  { name: "desktop-800x600", w: 800, h: 600 },
  { name: "phone-portrait-390x844", w: 390, h: 844, touch: true, insets: { top: 47, bottom: 34 } },
  { name: "phone-landscape-844x390", w: 844, h: 390, touch: true, insets: { left: 47, right: 47, bottom: 21 } },
  { name: "phone-small-360x640", w: 360, h: 640, touch: true, insets: { top: 24 } },
];
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  let fails = 0;
  const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
  let first = true;
  for (const S of SIZES) {
    if (ONLY && !ONLY.test(S.name)) continue;
    const ctx = await b.newContext({ viewport: { width: S.w, height: S.h }, hasTouch: !!S.touch, isMobile: !!S.touch, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript((ins) => {
      localStorage.setItem("td_gfx_quality", "low");
      if (ins) document.addEventListener("DOMContentLoaded", () => { for (const [k, v] of Object.entries(ins)) document.documentElement.style.setProperty(`--app-inset-${k}`, v + "px"); });
    }, S.insets || null);
    await page.goto(BASE);
    await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 500, timeout: 400000 });
    await page.waitForTimeout(2500);
    // worst case: big money, a job running, wanted stars, a long GPS label
    await page.evaluate(() => { window.__td.giveMoney(1234567); window.__td.crime("ped"); window.__td.startMission("taxi"); });
    await page.waitForTimeout(2500);
    const res = await page.evaluate(() => {
      const vw = innerWidth, vh = innerHeight;
      const sel = ["#hud", "#td-menu-btn", "#td-money", "#camsel", "#sensitivity", "#missionhud > div", "#waypoint", "#td-wanted", "#td-tools", "#minimap", "#speedo", "#nitrobar", "#helpbtn", "#td-fuel", "#maphint",
        "#tc .tc-btn", "#tc .tc-steer"];
      const boxes = [];
      for (const s of sel) for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        if (r.width < 2 || r.height < 2 || cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
        boxes.push({ s: el.id ? "#" + el.id : s + ":" + (el.textContent || "").trim().slice(0, 10), el, r: { x: r.left, y: r.top, w: r.width, h: r.height } });
      }
      const hits = [], off = [];
      for (let i = 0; i < boxes.length; i++) {
        const a = boxes[i].r;
        if (a.x < -1 || a.y < -1 || a.x + a.w > vw + 1 || a.y + a.h > vh + 1) off.push(boxes[i].s);
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
          const c = boxes[j].r;
          const ix = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), iy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
          if (ix > 0.5 && iy > 0.5) hits.push(`${boxes[i].s} x ${boxes[j].s} (${ix.toFixed(0)}x${iy.toFixed(0)})`);
        }
      }
      return { n: boxes.length, list: boxes.map((q) => `${q.s}@${q.r.x.toFixed(0)},${q.r.y.toFixed(0)} ${q.r.w.toFixed(0)}x${q.r.h.toFixed(0)}`), hits, off };
    });
    console.log(`[${S.name}] ${res.n} boxes: ${res.list.join(" | ")}`);
    check(res.hits.length === 0, `[${S.name}] no overlapping HUD boxes${res.hits.length ? ": " + res.hits.join("; ") : ""}`);
    check(res.off.length === 0, `[${S.name}] all HUD boxes on screen${res.off.length ? ": " + res.off.join(", ") : ""}`);
    await page.screenshot({ path: `${OUT}/v1.8.1-hud-${S.name}.png` });
    if (first) {
      first = false;
      // infinite money: toggle in the pause menu, buy a car + fuel, money unchanged, survives reload
      await page.evaluate(() => { window.__td.giveMoney(-99999999); });
      await page.click("#td-menu-btn"); await page.waitForTimeout(600);
      await page.click("#td-infmoney"); await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/v1.8.1-infinite-money-menu.png` });
      await page.click("#td-menu-btn"); await page.waitForTimeout(600);
      const badge = await page.textContent("#td-money");
      check(/∞/.test(badge), `money badge shows ∞ ("${badge}")`);
      const m0 = (await page.evaluate(() => window.__td.career())).money;
      await page.evaluate(() => window.__td.forceCar(-44, 26, Math.PI));
      await page.waitForFunction(() => !!document.querySelector('[data-buy="cobalt"]'), null, { polling: 400, timeout: 60000 });
      await page.click('[data-buy="cobalt"]'); await page.waitForTimeout(600);
      const e = await page.evaluate(() => window.__td.econ());
      const m1 = (await page.evaluate(() => window.__td.career())).money;
      check(e.owned.includes("cobalt") && m1 === m0, `bought the Cobalt with $${m0} and infinite money, money after $${m1}`);
      await page.evaluate(() => { window.__td.crime("ped"); });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/v1.8.1-infinite-money-bought.png` });
      await page.reload();
      await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 500, timeout: 400000 });
      await page.waitForTimeout(1500);
      const badge2 = await page.textContent("#td-money");
      check(/∞/.test(badge2), `infinite money survives reload ("${badge2}")`);
    }
    check(errors.length === 0, `[${S.name}] no page errors ${errors.slice(0, 2).join(" | ")}`);
    await ctx.close();
  }
  console.log(fails ? `RESULT FAIL (${fails})` : "RESULT PASS");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
