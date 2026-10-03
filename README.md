# Toshkent Drive — open world

Browser open-world driving game themed on Tashkent. Drive your own Kia Seltos (or the
Lacetti, BMW M3 E30, Kia K5 and BMW M3 Competition) through a chunk-streamed city with traffic, pedestrians,
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

## Performance & stability (v1.2)

- **Quality tiers** (`lib/gfx.ts`): LOW is the default on phones. It uses pixel ratio ≤ 1, no shadows, no post-processing or MSAA, short fog with a matching far plane, fewer traffic lanes and 2 pooled point lights. HIGH on desktop keeps soft shadows, the HDR environment, N8AO, bloom and SMAA. `?q=high|low` forces a tier. Auto-quality drops HIGH → LOW and then lowers the pixel ratio when the game holds under 30 fps (turn it off with `?autoq=0`).
- **Loading screen**: the world mounts in stages behind the loader. Every shader is precompiled, including objects that are hidden at boot (crash debris, culled NPCs), and the game is shown only once it is ready.
- **Crash safety**: every `useFrame` goes through `lib/safeFrame.ts` (try/catch and dt ≤ 0.1 s). `lib/physicsGuard.ts` rejects NaN or huge Rapier inputs and caps impulses. `gl.render` is guarded. A frame watchdog remounts the canvas after a lost GL context.
- **Assets**: `node scripts/optimize-models.mjs` rebuilds `public/models/*` (meshopt, WebP, simplification, transmission/specGloss removal) from untouched originals in `models-src/`, which is git-ignored. Use `ONLY=bmw|k5` to rebuild a subset.
- **Tests** (Playwright, serve `out/` at `/toshkent-drive/` on :4173):
  - `scripts/mobile-test.cjs`: touch controls and HUD overlap in portrait or landscape
  - `scripts/smoke.cjs`: desktop drive
  - `scripts/perf-profile.cjs`: draw calls, triangles, load time, bytes and heap
  - `scripts/crash-test.cjs`: high-speed crashes into NPC and police cars; the render loop must keep running

## License note: non-commercial project

The **BMW M3 Competition** player car (`public/models/cars/bmw-m3-competition.glb`) is
"BMW M3 Competition" by [VTX](https://sketchfab.com/VTX_car)
([Sketchfab](https://sketchfab.com/3d-models/bmw-m3-competition-641603169bfa4285a297a59883c653de)),
licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) and modified
(decimated/compressed). The modified model stays under CC BY-NC-SA 4.0. Because of this
asset, **Toshkent Drive is non-commercial**: it is free, with no ads and no paid features.
Remove that model before any commercial use. See [CREDITS.md](CREDITS.md) for all assets.
