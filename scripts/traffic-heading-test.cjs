// v1.7b NPC traffic test: every NPC car must face its direction of travel
// (|heading − velocity direction| < 15°), keep to the right-hand lane
// (Uzbekistan drives on the right) when not U-turning, and never jump
// sideways. Samples every NPC slot every 0.25 s of game time for SECS.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0";
const SECS = Number(process.env.SECS || 40);
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const errors = [];
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "high");
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(2000);
  const stats = {}; // npc type -> {n, bad, maxErr, wrongSide, jumps}
  const fails = [];
  let prev = await page.evaluate(() => ({ t: performance.now(), s: window.__td.npcTraffic() }));
  const t0 = Date.now();
  while (Date.now() - t0 < SECS * 1000) {
    await page.waitForTimeout(250);
    const cur = await page.evaluate(() => ({ t: performance.now(), s: window.__td.npcTraffic() }));
    for (const c of cur.s) {
      const p = prev.s[c.i];
      if (!c.npc || c.stolen || p.stolen || c.convoy) continue;
      const st = (stats[c.npc] ??= { n: 0, bad: 0, maxErr: 0, wrongSide: 0, sideChecks: 0, jumps: 0, uturns: 0 });
      const dx = c.x - p.x, dz = c.z - p.z, dist = Math.hypot(dx, dz);
      const dtSec = (cur.t - p.t) / 1000 || 0.25;
      if (dist > 25 * dtSec + 2) { st.jumps++; fails.push(`${c.npc}#${c.i} jumped ${dist.toFixed(1)} m`); continue; }
      if (c.uturn) st.uturns++;
      if (dist > 0.4) {
        // heading at the midpoint of the sample vs. the chord direction
        let hm = (p.h + c.h) / 2;
        if (Math.abs(c.h - p.h) > Math.PI) hm += Math.PI;
        const vdir = Math.atan2(dx, dz);
        let err = Math.abs(((vdir - hm) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * 180 / Math.PI;
        st.n++;
        st.maxErr = Math.max(st.maxErr, err);
        if (err > 15) { st.bad++; if (fails.length < 30) fails.push(`${c.npc}#${c.i} heading err ${err.toFixed(1)}° (h=${c.h.toFixed(2)} v=${vdir.toFixed(2)}${c.uturn ? " uturn" : ""})`); }
      }
      if (!c.uturn && c.axis && c.speed > 0.5) {
        // right vector of heading (-cos h, sin h) must point from the centreline toward the car
        const off = c.axis === "x" ? { x: 0, z: c.z - c.c } : { x: c.x - c.c, z: 0 };
        const side = -Math.cos(c.h) * off.x + Math.sin(c.h) * off.z;
        st.sideChecks++;
        if (side <= 0.5) { st.wrongSide++; if (fails.length < 30) fails.push(`${c.npc}#${c.i} on the LEFT (side=${side.toFixed(2)})`); }
      }
    }
    prev = cur;
  }
  // wheels: park next to each GLB NPC lane and check its near-LOD wheel rig spins
  const glbs = (await page.evaluate(() => window.__td.npcTraffic())).filter((t) => t.npc && t.npc.startsWith("glb"));
  for (const g of glbs) {
    const t = (await page.evaluate(() => window.__td.npcTraffic()))[g.i];
    await page.evaluate(([x, z, h]) => window.__td.forceCar(x + Math.cos(h) * 9, z - Math.sin(h) * 9, h), [t.x, t.z, t.h]);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(1000);
  const spin0 = await page.evaluate(() => ({ ...(window.__tdNpcSpin || {}) }));
  await page.waitForTimeout(1000);
  const spin1 = await page.evaluate(() => ({ ...(window.__tdNpcSpin || {}) }));
  console.log("NPC near-LOD wheel rigs:", JSON.stringify(await page.evaluate(() => window.__tdNpcRigs || {})));
  console.log("NPC wheel spin (rad, 1 s apart):", JSON.stringify(Object.fromEntries(Object.keys(spin1).map((k) => [k, [+(spin0[k] ?? 0).toFixed(2), +spin1[k].toFixed(2)]]))));
  console.log("NPC type stats:");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(12)} samples=${v.n} maxHeadingErr=${v.maxErr.toFixed(1)}° bad=${v.bad} sideChecks=${v.sideChecks} wrongSide=${v.wrongSide} jumps=${v.jumps} uturnSamples=${v.uturns}`);
  const bad = Object.values(stats).reduce((a, v) => a + v.bad + v.wrongSide + v.jumps, 0);
  console.log(fails.slice(0, 30).join("\n"));
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 5).join("\n"));
  console.log(bad === 0 && errors.length === 0 ? "PASS" : `FAIL (${bad} bad samples)`);
  await b.close();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
