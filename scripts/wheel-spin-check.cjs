// v1.6: wheel rig check per player car — detected wheels, then drive + steer
// and verify the front wheels yaw and all wheels roll. Screenshot from the side.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const CARS = (process.env.CARS || "0,1,2,3,4").split(",").map(Number);
const IDS = ["seltos", "lacetti", "m3", "k5", "m3c"];
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errs = [];
  for (const c of CARS) {
    const p = await b.newPage({ viewport: { width: 640, height: 400 } });
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.addInitScript((c) => { localStorage.setItem("td_gfx_quality", "low"); localStorage.setItem("td_player_car", String(c)); localStorage.removeItem("td_save"); }, c);
    await p.goto(URL, { waitUntil: "load" });
    await p.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 300000 });
    if (await p.locator("#controls").count()) await p.keyboard.press("KeyH").catch(() => {});
    await p.waitForFunction((id) => window.__tdWheels && id in window.__tdWheels && window.__tdWheelPose, IDS[c], { polling: 500, timeout: 120000 });
    const info = await p.evaluate((id) => window.__tdWheels[id], IDS[c]);
    console.log(`${IDS[c]} rig: ${JSON.stringify(info)}`);
    const p0 = await p.evaluate(() => window.__tdWheelPose());
    await p.keyboard.down("KeyW"); await p.waitForTimeout(2500);
    await p.keyboard.down("KeyA"); await p.waitForTimeout(600);
    const p1 = await p.evaluate(() => window.__tdWheelPose());
    const perf = await p.evaluate(() => { const x = window.__tdPerf(); return { calls: x.calls, tris: x.triangles }; });
    await p.keyboard.up("KeyW");
    await p.waitForTimeout(400);
    await p.screenshot({ path: `shots/v1.6-wheels-${IDS[c]}.png` });
    await p.keyboard.up("KeyA");
    console.log(`${IDS[c]} pose before ${JSON.stringify(p0)} after ${JSON.stringify(p1)} perf ${JSON.stringify(perf)}`);
    await p.close();
  }
  console.log(`ERRORS(${errs.length}) ${errs.slice(0, 10).join("\n")}`);
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
