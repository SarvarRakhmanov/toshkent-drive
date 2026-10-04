// v1.7b: visual nose check for every GLB NPC model in use — parks the player
// car in the NPC's lane ahead of it (same heading), camera looking back, so
// the NPC stops behind and its FRONT must face the camera.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const OUT = process.env.OUT || "shots";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => { localStorage.setItem("td_gfx_quality", "high"); localStorage.removeItem("td_save"); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(2000);
  const all = await page.evaluate(() => window.__td.npcTraffic());
  const glb = all.filter((t) => t.npc && t.npc.startsWith("glb"));
  for (const g of glb) {
    const t = (await page.evaluate(() => window.__td.npcTraffic()))[g.i];
    const ax = Math.sin(t.h), az = Math.cos(t.h);
    await page.evaluate(([x, z, h]) => window.__td.forceCar(x, z, h), [t.x + ax * 16, t.z + az * 16, t.h]);
    await page.waitForTimeout(600);
    await page.evaluate(() => window.__td.look(Math.PI, 0.1));
    await page.waitForTimeout(3500);
    const n = (await page.evaluate(() => window.__td.npcTraffic()))[g.i];
    console.log(g.npc, "#" + g.i, "npc speed", (n.speed || 0).toFixed(1), "gap", Math.hypot(n.x - (t.x + ax * 16), n.z - (t.z + az * 16)).toFixed(1));
    await page.screenshot({ path: `${OUT}/v1.7b-npc-face-${g.npc.replace(":", "")}.png` });
  }
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
