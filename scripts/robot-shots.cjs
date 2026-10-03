// Screenshots of the v1.4 robots: on-foot player (back, front, walking) and the
// pedestrian robots (camera dropped next to the nearest pedestrian cluster).
//   OUT=shots PREFIX=v1.4  W=900 H=600
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
const P = process.env.PREFIX || "v1.4";
(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 900), height: Number(process.env.H || 600) } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "high");
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 300000 });
  if (await page.locator("#controls").count()) await page.keyboard.press("KeyH").catch(() => {});
  await page.addStyleTag({ content: "#speedo,#nitrobar,#minimap,#maphint,#helpbtn,#camsel,#sensitivity,#td-tools,#waypoint{display:none!important}" });
  await page.waitForTimeout(1500);
  await page.keyboard.press("KeyE"); // get out of the car
  await page.waitForTimeout(2500);
  console.log("active:", await page.evaluate(() => window.__td.active()));
  // find the densest pedestrian spot and stand next to it
  const spot = await page.evaluate(() => {
    const ps = window.__td.peds();
    let best = ps[0], bn = -1;
    for (const a of ps) { const n = ps.filter((b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 400).length; if (n > bn) { bn = n; best = a; } }
    return { ...best, n: bn };
  });
  console.log("ped spot", spot);
  await page.evaluate((s) => window.__td.tp(s.x + 4, s.z + 4, Math.PI * 1.25), spot);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${P}-robot-player-back.png` });
  await page.evaluate(() => window.__td.look(Math.PI, 0.1));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/${P}-robot-player-front.png` });
  await page.evaluate(() => window.__td.look(Math.PI * 0.5, 0.05));
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${P}-robot-player-walk.png` });
  await page.keyboard.up("KeyW");
  // NPCs: stand at the nearest pedestrian, look along them
  const near = await page.evaluate(() => {
    const me = window.__td.player();
    return window.__td.peds().map((p) => ({ ...p, d: Math.hypot(p.x - me.x, p.z - me.z) })).sort((a, b) => a.d - b.d).slice(0, 6);
  });
  console.log("nearest peds", near.map((n) => n.d.toFixed(1)).join(" "));
  const t = near[0];
  await page.evaluate((s) => window.__td.tp(s.x + 5, s.z + 5, 0), t);
  await page.waitForTimeout(800);
  for (let k = 0; k < 3; k++) {
    // re-aim at the (moving) closest pedestrian, chase-cam yaw from player->ped
    await page.evaluate(() => {
      const me = window.__td.player();
      const p = window.__td.peds().map((p) => ({ ...p, d: Math.hypot(p.x - me.x, p.z - me.z) })).sort((a, b) => a.d - b.d)[0];
      window.__td.tp(p.x - 3.5, p.z - 3.5, 0);
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const me = window.__td.player();
      const p = window.__td.peds().map((p) => ({ ...p, d: Math.hypot(p.x - me.x, p.z - me.z) })).sort((a, b) => a.d - b.d)[0];
      window.__td.look(Math.atan2(p.x - me.x, p.z - me.z) - me.h, 0.05);
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${P}-robot-npcs-${k}.png` });
    await page.waitForTimeout(4000);
  }
  // close-up of one pedestrian of each robot type: stand 3.5 m ahead of it, look back at it
  const types = await page.evaluate(() => [...new Set(window.__td.peds().map((p) => p.robot))].sort());
  await page.keyboard.press("KeyC"); // first-person on foot
  await page.waitForTimeout(500);
  for (const ty of types) {
    const pick = await page.evaluate((ty) => {
      const me = window.__td.player();
      return window.__td.peds().map((p, i) => ({ ...p, i, d: Math.hypot(p.x - me.x, p.z - me.z) })).filter((p) => p.robot === ty).sort((a, b) => a.d - b.d)[0];
    }, ty);
    await page.evaluate((p) => window.__td.tp(p.x + Math.sin(p.h) * 30, p.z + Math.cos(p.h) * 30, 0), pick);
    await page.waitForTimeout(1200); // let it come within LOD-0 range and settle
    await page.evaluate((i) => {
      const p = window.__td.peds()[i];
      const x = p.x + Math.sin(p.h) * 6, z = p.z + Math.cos(p.h) * 6;
      window.__td.tp(x, z, p.h + Math.PI);
    }, pick.i);
    await page.waitForTimeout(300);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${P}-npc-type-${ty}.png` });
  }
  for (let k = 0; k < 3; k++) await page.keyboard.press("KeyC"); // back to chase
  const perf = await page.evaluate(() => window.__tdPerf && window.__tdPerf());
  console.log("perf", JSON.stringify(perf));
  console.log(`ERRORS(${errors.length})`, errors.join("\n"));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
