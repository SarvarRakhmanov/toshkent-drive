// v1.6: close-up of the player car's wheels (CINE camera, HUD hidden) while
// steering left at low speed — visual check of the wheel rig.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const CARS = (process.env.CARS || "0,1,2,3,4").split(",").map(Number);
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errs = [];
  for (const c of CARS) {
    const p = await b.newPage({ viewport: { width: 900, height: 600 } });
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.addInitScript((c) => { localStorage.setItem("td_gfx_quality", "low"); localStorage.setItem("td_player_car", String(c)); localStorage.removeItem("td_save"); }, c);
    await p.goto(URL, { waitUntil: "load" });
    await p.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 300000 });
    if (await p.locator("#controls").count()) await p.keyboard.press("KeyH").catch(() => {});
    await p.addStyleTag({ content: "#hud,#speedo,#nitrobar,#minimap,#maphint,#helpbtn,#camsel,#sensitivity,#td-tools,#waypoint,#tc-top{display:none!important}" });
    await p.keyboard.down("KeyA"); await p.waitForTimeout(600);
    await p.keyboard.down("KeyW"); await p.waitForTimeout(500); await p.keyboard.up("KeyW");
    await p.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => /cine/i.test(x.textContent || "")); b && b.click(); });
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `shots/v1.6-wheel-closeup-car${c}.png` });
    await p.keyboard.up("KeyA");
    await p.close();
  }
  console.log(`ERRORS(${errs.length}) ${errs.slice(0, 5).join("\n")}`);
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
