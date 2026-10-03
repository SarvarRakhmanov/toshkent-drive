// Wheels-on-ground check: for every player car, the lowest vertex of the
// visible body (world space, precise) must sit at the road surface (±3 cm).
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const IDS = ["seltos", "lacetti", "m3", "k5", "m3c"];
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const p = await b.newPage({ viewport: { width: 640, height: 360 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await p.addInitScript(() => { localStorage.setItem("td_gfx_quality", "low"); localStorage.setItem("td_player_car", "0"); localStorage.removeItem("td_save"); });
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 300000 });
  let bad = 0;
  for (let i = 0; i < IDS.length; i++) {
    if (i > 0) { await p.keyboard.press("KeyK"); }
    await p.waitForFunction((id) => !!window.__tdBox("td-car:" + id), IDS[i], { polling: 500, timeout: 120000 });
    await p.waitForTimeout(1500);
    const r = await p.evaluate((id) => ({ box: window.__tdBox("td-car:" + id), car: window.__td.car() }), IDS[i]);
    const ground = r.car.y - 0.98; // body origin rides RIDE_HEIGHT above the road
    const gap = r.box.min[1] - ground;
    const ok = Math.abs(gap) < 0.03;
    if (!ok) bad++;
    if (!ok || process.env.VERBOSE) console.log("   lowest meshes:", JSON.stringify(await p.evaluate((id) => window.__tdLowest("td-car:" + id), IDS[i])));
    console.log(`${IDS[i].padEnd(8)} lowest vertex ${r.box.min[1].toFixed(3)} road ${ground.toFixed(3)} gap ${(gap * 100).toFixed(1)} cm height ${(r.box.max[1] - r.box.min[1]).toFixed(2)} m -> ${ok ? "OK" : "OFF"}`);
  }
  console.log(`RESULT bad=${bad} ERRORS(${errs.length}) ${errs.join(" | ")}`);
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
