// v1.8 economy: clear spots for every station/home, fuel burn + dry tank +
// fuel van, refuel at a station, repair, buy a car at AVTO BOZOR, buy a home +
// GO HOME, night taxi gating, ambience + service worker. MAP=toshkent|bigcity
const pw = require(process.env.PW || "playwright");
const MAP = process.env.MAP || "toshkent";
const URL = process.env.URL || `http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0&map=${MAP}&sw=1`;
const OUT = process.env.OUT || "shots";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  const page = await b.newPage({ viewport: { width: 900, height: 560 } });
  const errors = []; let fails = 0;
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.addInitScript(() => { localStorage.setItem("td_gfx_quality", "low"); });
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 250, timeout: 400000 });
  await page.waitForTimeout(3000);
  const ev = (f, a) => page.evaluate(f, a);
  const check = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fails++; };
  const until = async (f, a, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(f, a)) return true; await page.waitForTimeout(400); } return false; };
  await ev(() => window.__td.giveMoney(30000));
  // 0) places are clear of buildings (Rapier query at the kerb spot)
  const st = await ev(() => window.__td.stations());
  const hs = await ev(() => window.__td.houses());
  for (const s of st) { await ev((p) => window.__td.forceCar(p.x, p.z + 30, 0), s.pump); await page.waitForTimeout(2500); const ok = await ev((p) => window.__td.clear(p.x, p.z, 0, 4), s.pump); check(ok !== false, `${s.name} kerb spot clear (${s.pump.x},${s.pump.z}) -> ${ok}`); }
  for (const h of hs) { await ev((p) => window.__td.forceCar(p.x, p.z + 30, 0), h.spot); await page.waitForTimeout(2500); const ok = await ev((p) => window.__td.clear(p.x, p.z, 0, 4), h.spot); check(ok !== false, `${h.name} kerb spot clear -> ${ok}`); }
  // 1) fuel burn -> dry tank -> no power -> fuel van
  const s0 = st[0];
  await ev((p) => window.__td.summonCar(p.x, p.z - 60, 0), s0.pump); await page.waitForTimeout(2000);
  await ev(() => window.__td.setFuel(0.08));
  await page.keyboard.down("KeyW");
  const dry = await until(() => window.__td.fuel().litres <= 0, null, 180000);
  check(dry, "fuel burns while driving and runs dry");
  await page.waitForTimeout(1500);
  const v0 = Math.abs((await ev(() => window.__td.car())).speed);
  await page.waitForTimeout(5000);
  const v1 = Math.abs((await ev(() => window.__td.car())).speed);
  await page.keyboard.up("KeyW");
  console.log("dry speeds", v0, v1);
  check(v1 <= v0 + 0.05, `dry tank: no drive power (speed ${v0.toFixed(2)} -> ${v1.toFixed(2)} m/s)`);
  const van = await until(() => !!document.querySelector("#td-fuelvan"), null, 10000);
  check(van, "OUT OF FUEL panel offers the fuel van");
  await page.screenshot({ path: `${OUT}/v1.8-out-of-fuel-${MAP}.png` });
  if (van) await page.click("#td-fuelvan");
  await page.waitForTimeout(800);
  check((await ev(() => window.__td.fuel())).litres >= 9.9, "fuel van adds 10 L");
  // 2) station: refuel + repair
  await ev((p) => window.__td.forceCar(p.x, p.z + 4, Math.PI), s0.pump);
  await ev(() => window.__td.damage(0.4));
  const atPump = await until(() => !!document.querySelector("#td-service") && !!document.querySelector("#td-fuel-petrol"), null, 30000);
  check(atPump, "gas station panel appears when stopped at the pump");
  await ev((p) => window.__td.look(Math.PI * 0.75, -0.12), null); await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/v1.8-gas-station-${MAP}.png` });
  const m0 = (await ev(() => window.__td.career())).money;
  if (atPump) await page.click("#td-fuel-petrol");
  await page.waitForTimeout(600);
  const f = await ev(() => window.__td.fuel());
  const m1 = (await ev(() => window.__td.career())).money;
  check(f.litres >= f.tank - 0.5 && m1 < m0, `refuel fills the tank (${f.litres.toFixed(1)}/${f.tank} L, $${m0} -> $${m1})`);
  console.log("damage before repair", f.damage);
  if (atPump) await page.click("#td-repair");
  await page.waitForTimeout(1500);
  const f2 = await ev(() => window.__td.fuel());
  const m2 = (await ev(() => window.__td.career())).money;
  check(f.damage > 0.3 && f2.damage === 0 && m2 < m1, `repair resets damage ${f.damage} -> ${f2.damage} ($${m1} -> $${m2})`);
  // 3) dealer: locked car refused, buy, then selectable
  const e0 = await ev(() => window.__td.econ());
  console.log("econ", JSON.stringify(e0));
  await ev(() => window.__td.forceCar(-44, 26, Math.PI));
  const dealer = await until(() => !!document.querySelector('[data-buy="captiva"]'), null, 30000);
  check(dealer, "AVTO BOZOR panel lists cars for sale");
  await ev(() => window.__td.look(Math.PI * 0.5, -0.1)); await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/v1.8-avto-bozor-${MAP}.png` });
  if (!e0.owned.includes("captiva")) {
    if (dealer) await page.click('[data-buy="captiva"]');
    await page.waitForTimeout(600);
    check((await ev(() => window.__td.econ())).owned.includes("captiva"), "bought the Captiva");
  }
  // 4) home: buy, then GO HOME from the menu
  const h0 = hs[0];
  await ev((p) => window.__td.forceCar(p.x, p.z + 3, Math.PI), h0.spot);
  const hp = await until(() => !!document.querySelector("#td-buyhouse") || !!document.querySelector("#td-sethome"), null, 30000);
  check(hp, "home for sale panel");
  await ev(() => window.__td.look(Math.PI * 0.5, -0.1)); await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/v1.8-home-for-sale-${MAP}.png` });
  if (await page.$("#td-buyhouse")) await page.click("#td-buyhouse");
  await page.waitForTimeout(600);
  check((await ev(() => window.__td.econ())).home === h0.id, "home bought and set");
  await ev(() => window.__td.forceCar(300, -350, 0)); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape"); await page.waitForTimeout(800);
  await page.click("#td-gohome"); await page.waitForTimeout(500);
  const home = await until((p) => { const c = window.__td.car(); return Math.hypot(c.x - p.x, c.z - p.z) < 25; }, h0.spot, 30000);
  check(home, "GO HOME brings the car to the home");
  // 5) night taxi only at night, 1.8x pay
  const day = await ev(() => window.__td.startMission("night"));
  check(/20:00/.test(day || ""), `night job refused by day ("${day}")`);
  await ev(() => window.__td.skyPhase(4.7)); await page.waitForTimeout(4000);
  const hour = (await ev(() => window.__td.weather())).hour;
  const ng = await ev(() => window.__td.startMission("night"));
  const nm = await ev(() => window.__td.mission());
  console.log("night", hour, ng, JSON.stringify(nm));
  check(!ng && nm && nm.kind === "night", `night taxi starts at ${hour.toFixed(1)}h (pay $${nm && nm.pay})`);
  // 6) ambience + offline cache
  await page.mouse.click(450, 300); await page.waitForTimeout(3000);
  const amb = await ev(() => window.__td.ambience());
  console.log("ambience", JSON.stringify(amb));
  check(amb.on && amb.rumble > 0, "ambience running");
  const sw = await until(() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined && navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)), null, 30000);
  const keys = await ev(() => caches.keys());
  console.log("caches", JSON.stringify(keys));
  await page.waitForTimeout(8000);
  const keys2 = await ev(() => caches.keys());
  const nStatic = await ev(async () => (await (await caches.open("td-v1.8-static")).keys()).length);
  console.log("caches", JSON.stringify(keys2), "static entries", nStatic);
  check(sw && keys.some((k) => k.startsWith("td-v1.8")) && nStatic > 3, "service worker active with td-v1.8 caches (scripts cached for offline)");
  console.log(`ERRORS(${errors.length})`, errors.slice(0, 5).join("\n"));
  console.log(fails ? `RESULT FAIL (${fails})` : "RESULT PASS");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
