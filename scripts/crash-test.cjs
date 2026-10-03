// Crash/freeze regression test: drive the player's car at high speed (nitro)
// head-on and side-on into NPC traffic cars — the BlueStacks report was a
// permanent freeze ~2 s after hitting a black (police) NPC car at ~108 km/h.
// After every hit the render loop must keep producing frames, the car
// position must stay finite, and there must be no console errors.
//   URL=...  TRIALS=4  W=800 H=450  QUALITY=low|high
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0";
const TRIALS = Number(process.env.TRIALS || 4);
const OUT = process.env.OUT || "shots";
const TAG = process.env.TAG || "crash";
const log = (...a) => console.log(`[${TAG}]`, ...a);

(async () => {
  const browser = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage", "--js-flags=--max-old-space-size=2048"] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.W || 800), height: Number(process.env.H || 450) } });
  await page.addInitScript((q) => { localStorage.setItem("td_gfx_quality", q); localStorage.removeItem("td_save"); }, process.env.QUALITY || "low");
  page.setDefaultTimeout(300000);
  const errors = [];
  const warns = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); if (m.type() === "warning") warns.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__td && window.__tdPerf && window.__td.load().phase === "ready", null, { polling: 250 });
  await page.waitForTimeout(2000);
  const frames = () => page.evaluate(() => window.__tdPerf().frames);
  const speed = async () => Number((await page.locator("#speedo .num").textContent().catch(() => "-1"))?.trim());
  let froze = 0, maxHit = 0;
  const fa = await frames(); await page.waitForTimeout(5000); const fb = await frames();
  log(`baseline render rate before any crash: ${((fb - fa) / 5).toFixed(2)} fps (software GL)`);
  let cdp = null;
  if (process.env.PROFILE) {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 2000 });
  }
  for (let t = 0; t < TRIALS; t++) {
    if (cdp && t === 0) await cdp.send("Profiler.start");
    const progBefore = (await page.evaluate(() => window.__tdPerf().programList)) || [];
    const keysBefore = await page.evaluate(() => window.__tdPrograms());
    const traffic = await page.evaluate(() => window.__td.traffic());
    // nearest live NPC to spawn, alternating police / civilian; prefer city lanes
    const cands = traffic.map((c, i) => ({ ...c, i })).filter((c) => !c.stolen && Math.abs(c.x) < 400 && Math.abs(c.z) < 400);
    const pick = cands.filter((c) => (t % 2 === 0 ? c.police : !c.police))[0] || cands[0];
    const sideOn = t % 4 >= 2;
    const fx = Math.sin(pick.h), fz = Math.cos(pick.h);
    let x, z, h;
    if (!sideOn) { x = pick.x + fx * 55; z = pick.z + fz * 55; h = pick.h + Math.PI; } // head-on in its lane
    else { x = pick.x + fx * 6 + fz * 50; z = pick.z + fz * 6 - fx * 50; h = Math.atan2(-fz, fx); } // T-bone from its side
    await page.evaluate(([x, z, h]) => window.__td.summonCar(x, z, h), [x, z, h]);
    await page.waitForTimeout(600);
    await page.keyboard.down("KeyW");
    await page.keyboard.down("ShiftLeft");
    let top = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      await page.waitForTimeout(250);
      const s = await speed();
      top = Math.max(top, s);
      const c = await page.evaluate(() => window.__td.car());
      const npc = (await page.evaluate(() => window.__td.traffic()))[pick.i];
      const d = Math.hypot(c.x - npc.x, c.z - npc.z);
      if (d < 6) break; // contact
    }
    await page.keyboard.up("ShiftLeft");
    // keep the throttle pinned into the NPC for a while, like a player would
    await page.waitForTimeout(3000);
    await page.keyboard.up("KeyW");
    maxHit = Math.max(maxHit, top);
    const f1 = await frames();
    await page.waitForTimeout(8000);
    const f2 = await frames();
    const c = await page.evaluate(() => window.__td.car());
    const finite = [c.x, c.y, c.z, c.h].every(Number.isFinite);
    const health = await page.evaluate(() => window.__td.health());
    const ok = f2 > f1 && finite;
    if (!ok) froze++;
    log(`trial ${t + 1} ${sideOn ? "T-bone" : "head-on"} into lane ${pick.i} (${pick.police ? "police" : pick.kind || "car"}): top speed ${top} km/h, frames +${f2 - f1} in 8 s, car (${c.x.toFixed(1)}, ${c.y.toFixed(2)}, ${c.z.toFixed(1)}) finite=${finite} health=${JSON.stringify(health)} -> ${ok ? "OK" : "FROZE"}`);
    {
      const progAfter = (await page.evaluate(() => window.__tdPerf().programList)) || [];
      const added = progAfter.filter((p) => !progBefore.includes(p));
      log(`programs ${progBefore.length} -> ${progAfter.length}; new: ${added.join(", ") || "none"}`);
      if (process.env.KEYDIFF) {
        const keysAfter = await page.evaluate(() => window.__tdPrograms());
        const oldIds = new Set(keysBefore.map((k) => k.id));
        for (const n of keysAfter.filter((k) => !oldIds.has(k.id))) {
          const nt = n.key.split(",");
          let best = null, bestScore = -1;
          for (const o of keysBefore) {
            const ot = o.key.split(",");
            if (ot.length !== nt.length) continue;
            let same = 0; for (let i = 0; i < nt.length; i++) if (nt[i] === ot[i]) same++;
            if (same > bestScore) { bestScore = same; best = o; }
          }
          if (!best) { log(`  NEW ${n.name}#${n.id}: no comparable key (len ${nt.length})`); continue; }
          const ot = best.key.split(",");
          const diffs = []; for (let i = 0; i < nt.length; i++) if (nt[i] !== ot[i]) diffs.push(`[${i}] ${ot[i].slice(0, 40)} -> ${nt[i].slice(0, 40)}`);
          log(`  NEW ${n.name}#${n.id} vs ${best.name}#${best.id}: ${diffs.slice(0, 8).join(" | ")}`);
        }
      }
    }
    if (cdp && t === 0) {
      const { profile } = await cdp.send("Profiler.stop");
      const self = new Map();
      const byId = new Map(profile.nodes.map((n) => [n.id, n]));
      const dts = profile.timeDeltas;
      profile.samples.forEach((id, k) => {
        const n = byId.get(id);
        const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
        self.set(key, (self.get(key) || 0) + (dts[k] || 0));
      });
      const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
      log("CPU profile top self time (ms):\n" + top.map(([k, v]) => `  ${(v / 1000).toFixed(0).padStart(7)}  ${k}`).join("\n"));
      require("fs").writeFileSync(`${OUT}/${TAG}.cpuprofile`, JSON.stringify(profile));
    }
    if (t === 0) await page.screenshot({ path: `${OUT}/${TAG}-after-hit.png` });
    if (!ok) break;
  }
  log(`RESULT trials=${TRIALS} froze=${froze} max impact speed=${maxHit} km/h`);
  log(`ERRORS(${errors.length})` + (errors.length ? "\n" + errors.slice(0, 15).join("\n") : ""));
  log(`WARNINGS(${warns.length})` + (warns.length ? "\n" + [...new Set(warns)].slice(0, 15).join("\n") : ""));
  await browser.close();
  process.exit(froze || errors.length ? 1 : 0);
})().catch((e) => { console.error(`[${TAG}] FATAL`, e); process.exit(2); });
