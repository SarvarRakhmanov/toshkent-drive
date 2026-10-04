// v1.8: load once online (SW installs + caches), then go offline and reload —
// the game must still reach "ready" from the cache.
const pw = require(process.env.PW || "playwright");
const URL = process.env.URL || "http://127.0.0.1:4173/toshkent-drive/?autoq=0&wd=0&sw=1";
(async () => {
  const b = await pw.chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"] });
  const ctx = await b.newContext({ viewport: { width: 800, height: 500 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("td_gfx_quality", "low"));
  await page.goto(URL);
  await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 500, timeout: 400000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)), null, { polling: 1000, timeout: 60000 });
  await page.waitForTimeout(20000);
  const n = await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; });
  console.log("cache entries", JSON.stringify(n));
  await ctx.setOffline(true);
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.reload();
  let ok = false;
  try { await page.waitForFunction(() => window.__td && window.__td.load().phase === "ready", null, { polling: 500, timeout: 400000 }); ok = true; } catch (e) { console.log("not ready offline", e.message.slice(0, 120)); }
  await page.screenshot({ path: "shots/v1.8-offline-reload.png" });
  console.log("errors", errs.slice(0, 3).join(" | "));
  console.log(ok ? "RESULT PASS offline reload reached ready" : "RESULT FAIL");
  await b.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
