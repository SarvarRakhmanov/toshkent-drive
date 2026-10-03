# Toshkent Drive — open world

Browser open-world driving game themed on Tashkent. Drive your own Kia Seltos (or the
Lacetti, BMW M3 E30 and Kia K5) through a chunk-streamed city with traffic, pedestrians,
day/night cycle, weather, minimap and soft shadows. Static site — no server, no login.

Built on the MIT-licensed **Neon City Drive** engine by ma67-ex
(https://github.com/ma67-ex/Neon-City, Next.js + React Three Fiber + Rapier). See [CREDITS.md](CREDITS.md).

## Controls
W A S D / arrows drive · Space handbrake · Shift nitro · **R** reset car onto road ·
**K** change car · **Q** graphics high/low · C camera · L headlights · V weather · G map ·
E enter/exit vehicle · B switch car/bike/boat · H (or the **?** button) shows this help.

**Phones / tablets** (`components/TouchControls.tsx`, shown on touch devices only — force with
`?touch=1` / `?touch=0`): analog steering pad bottom-left, GAS / BRAKE (reverse) bottom-right with
small HB (handbrake) and N₂O above them, an **E** button when there is something to use, and a top
row of icons: reset · change car · camera · HI/LO graphics · headlights · ⋯ (enter/exit, switch
vehicle, map, phone, weather, sound, look sensitivity). Drag on the scene to look around.
Phones start on LOW graphics. `scripts/mobile-test.cjs` is the Playwright iPhone-emulation test.

## Develop / build
```bash
npm install
npm run dev                                # http://localhost:3000
BASE_PATH=/toshkent-drive npm run build    # static site in out/ for GitHub Pages
```
GitHub Pages: `.github/workflows/pages.yml` builds with `BASE_PATH=/<repo>` and deploys `out/`
(Settings → Pages → Source: GitHub Actions).

`scripts/smoke.cjs` is a headless Playwright smoke test (SwiftShader WebGL) that drives with
simulated keys and saves screenshots to `shots/`.

`legacy-grok/` holds the original Grok Build version's source for reference.
