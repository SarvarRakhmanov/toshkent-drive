# Credits — Toshkent Drive

## Engine / template
**Neon City Drive** by ma67-ex — https://github.com/ma67-ex/Neon-City
(`web-migration/` app, commit 6b44549, Aug 2026). MIT License, Copyright (c) 2026 ma67-ex.
Full license text: [`LICENSE.template-neon-city`](LICENSE.template-neon-city).
Stack: Next.js 16 (static export), React Three Fiber, @react-three/rapier (Rapier physics),
@react-three/drei, @react-three/postprocessing (N8AO, bloom, SMAA), zustand, three.js (MIT).

Toshkent Drive changes on top of it: Tashkent branding, Uzbek landmark and street names,
the player's own cars as the drivable car (K to switch), CC-BY traffic car models,
Tashkent City / Chilonzor building models, Poly Haven HDRI lighting + physical sky,
high/low graphics toggle (Q), reset key (R), no sign-in, GitHub Pages static build.

## Player cars
| File | Model | Author | License | Source |
|---|---|---|---|---|
| models/cars/seltos.glb | Mexico Seltos PE (Kia Seltos) | supplied by Sarvar (owner) | player-supplied, used with permission of the owner | — (re-compressed with gltf-transform: meshopt + WebP) |
| models/cars/lacetti.glb | Lacetti | uzb_rx7 | CC BY 4.0 | https://sketchfab.com/3d-models/lacetti-d3c32dfa9aea435b838a907394e4f0d2 |
| models/cars/bmw-m3.glb | [FREE] BMW M3 E30 | TinoD2 | CC BY 4.0 | https://sketchfab.com/3d-models/free-bmw-m3-e30-ac3c7013434e403e8faff87948caf422 |
| models/cars/k5.glb | Kia Optima K5 | dannzjs | CC BY 4.0 | https://sketchfab.com/3d-models/kia-optima-k5-6fc788c08348419d92588f2f541c5b50 |
| models/cars/bmw-m3-competition.glb | BMW M3 Competition | [VTX](https://sketchfab.com/VTX_car) | [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), **modified (decimated/compressed)** | https://sketchfab.com/3d-models/bmw-m3-competition-641603169bfa4285a297a59883c653de |
| models/cars/cobalt.glb, models/traffic/cobalt.glb | Chevrolet Cobalt LTZ | [uzb_rx7 (uzbek_supra)](https://sketchfab.com/uzbek_supra) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (verified on the Sketchfab API 2026-10-04), **modified** (cabin + ground plane dropped, 1.05M → 49.8k tris player / 9.4k NPC LOD, palette materials, normals rebuilt, meshopt) | https://sketchfab.com/3d-models/chevrolet-cobalt-ltz-6bbacfcb4c224acda978f5ee74554b58 |
| models/cars/captiva.glb, models/traffic/captiva.glb | Chevrolet Captiva (all-terrain) | [Alien1974555](https://sketchfab.com/Alien1974555) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (verified 2026-10-04), **modified** (1.26M → 55k tris player / 6k NPC LOD, 1024/256 px WebP, palette materials, meshopt) | https://sketchfab.com/3d-models/chevrolet-captiva-all-terr-808a6ae1778c466fab6da5f0a43d5a31 |
| models/cars/lada2103.glb, models/traffic/lada2103.glb | Lada VAZ-2103 Zhiguli | [Black Snow (BlackSnow02)](https://sketchfab.com/BlackSnow02) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (verified 2026-10-04), **modified** (dashboard/seats/suspension dropped, 478k → 47k tris player / 5.8k NPC LOD, WebP textures, meshopt) | https://sketchfab.com/3d-models/lada-vaz-2103-zhiguli-9d02e433d9dc4b92a271a4c8641b6211 |

**BMW M3 Competition by VTX (Sketchfab), CC BY-NC-SA 4.0, modified (decimated/compressed).**
Changes: skeleton baked to static meshes, 658,592 → 73,044 triangles, solid-colour
materials merged into a palette, textures resized to 256 px WebP, glass transmission
replaced by alpha blending, meshopt compression (46.8 MB → 1.53 MB). The modified model
`public/models/cars/bmw-m3-competition.glb` is distributed under the same
**CC BY-NC-SA 4.0** license. Because of this asset, Toshkent Drive is a non-commercial
project (free, no ads, no in-app purchases).

## Cockpit interiors (v1.4, CC BY 4.0, Sketchfab)
Rendered only in the cockpit camera. One shared cabin per car class; modified (props/glass removed,
re-centred on the driver's eye, materials merged, decimated, meshopt-compressed) by
`scripts/optimize-interiors.mjs`. The robot hands/arms on the wheel are procedural (no asset).
| File | Model | Author | Used for | Source |
|---|---|---|---|---|
| models/interiors/gt-interior.glb | Autonomous GT Car Interior Design - Manual Mode | [benlockett](https://sketchfab.com/benlockett) | BMW M3 Competition, Kia K5, Kia Seltos | https://sketchfab.com/3d-models/autonomous-gt-car-interior-design-manual-mode-b4627fc6d22f45c496ed548ba3c9be10 |
| models/interiors/sedan-interior.glb | Car interior | [Gerhald](https://sketchfab.com/Gerhald) | Chevrolet Lacetti, BMW M3 E30 | https://sketchfab.com/3d-models/car-interior-c5f830a811af4917972de8fa47949de9 |

## Player robot (v1.4, CC BY 4.0, Sketchfab)
| File | Model | Author | Source |
|---|---|---|---|
| models/robots/big-boss.glb | The Big Boss | [FrazierChristopher](https://sketchfab.com/FrazierChristopher) | https://sketchfab.com/3d-models/the-big-boss-875e6bda9c4048a2af821d122dbbb1aa |

Modified: scaled to human height (1.85 m), textures 512 px WebP, meshopt compression
(4.6 MB → 0.29 MB, 8,229 triangles). The model has no rig or animations, so the game cuts
its legs and arms apart at load time and swings them procedurally (walk / jump / sit).

## Pedestrian robots (v1.4, CC BY 4.0, Sketchfab — from EveBatStudios' "Robot downloads" collection)
Each posed at a standing frame, skin baked to static geometry, materials merged, decimated
(plus a distance LOD), textures 256 px WebP (64 px for the LOD), meshopt-compressed by
`scripts/optimize-robots.mjs`; drawn instanced with a procedural bob/sway.
| File | Model | Author | Source |
|---|---|---|---|
| models/robots/npc-militor*.glb | Militor Mechanoid | [Lagst](https://sketchfab.com/Lagst) | https://sketchfab.com/3d-models/militor-mechanoid-e70e3e81dc8c43c6a7c6ed5e6a8c4c86 |
| models/robots/npc-checkered-guard*.glb | Checkered Guard (police officers) | [Lagst](https://sketchfab.com/Lagst) | https://sketchfab.com/3d-models/checkered-guard-4ee6292ee3554d8daccd81a9c678e31a |
| models/robots/npc-mini-bot*.glb | Mini-bot | [lorib2306](https://sketchfab.com/lorib2306) | https://sketchfab.com/3d-models/mini-bot-116dc9f062204c09b109bf245e3c5273 |
| models/robots/npc-ww1*.glb | WW1 french robot solider | [bovos5](https://sketchfab.com/bovos5) | https://sketchfab.com/3d-models/ww1-french-robot-solider-dbaaf294eb104e8c88c6e4a1fb2a2402 |
| models/robots/npc-biped*.glb | Biped robot | [Willy Decarpentrie (skudgee)](https://sketchfab.com/skudgee) | https://sketchfab.com/3d-models/biped-robot-801d2a245e4a4405a0c2152b35b5e486 |
| models/robots/npc-bumstrum*.glb | Robot | [DJMaesen (bumstrum)](https://sketchfab.com/bumstrum) | https://sketchfab.com/3d-models/robot-93c9ff1cac014cc382e8666c873cdd70 |

## Traffic cars (all CC BY 4.0, Sketchfab)
| File | Model | Author | Source |
|---|---|---|---|
| models/traffic/sedan-a.glb | Fairheaven LT 80 low poly | DanielZhabotinsky | https://sketchfab.com/3d-models/fairheaven-lt-80-low-poly-model-e2678da920cc4be68dbc193727919ffb |
| models/traffic/sedan-b.glb | Low poly car Chrysler Saratoga 1960 | roh3d | https://sketchfab.com/3d-models/low-poly-car-chrysler-saratoga-1960-3fa89e6bf78b49aab111af4195efb6fe |
| models/traffic/hatch-a.glb | Milano 95 low poly | DanielZhabotinsky | https://sketchfab.com/3d-models/milano-95-low-poly-model-122a22d210234596ad23623588d0d166 |
| models/traffic/hatch-b.glb | Low poly car BMW E30 1985 white | roh3d | https://sketchfab.com/3d-models/low-poly-car-bmw-e30-1985-white-9dea494b447e442fafbddfc7eccbf158 |
| models/traffic/van-a.glb | Shvan 92 low poly | DanielZhabotinsky | https://sketchfab.com/3d-models/shvan-92-low-poly-model-09d718c9cf72401b8534d265a06a803f |
| models/traffic/taxi-a.glb | Canyon 75 Taxi low poly | DanielZhabotinsky | https://sketchfab.com/3d-models/canyon-75-taxi-low-poly-model-9e8f92a215784f3d8aaaaeab1bef54c4 |

(Mapping of file → model follows the original project's `sketchfab/manifest.json`; see
`legacy-grok/SKETCHFAB_CREDITS.txt` for the full list as downloaded.)

## Buildings (all CC BY 4.0, Sketchfab)
| File | Model | Author | Source |
|---|---|---|---|
| models/buildings/building-office.glb | Modern Office Building | cn-entertainment | https://sketchfab.com/3d-models/modern-office-building-3f54b8d7a7064b0da523c49187efcf60 |
| models/buildings/house-a.glb | Small low poly house | MrAeterna | https://sketchfab.com/3d-models/small-low-poly-house-b3a6cff40d02411e8cf35ca18eb14f02 |
| models/buildings/house-b.glb | Modern house villa | bral_unit | https://sketchfab.com/3d-models/modern-house-villa-game-ready-4k-ba52e385eaf6407481fed1b1ede4649e |
| models/buildings/shop-a.glb | Cork corner shop 1 | Lost_Gecko | https://sketchfab.com/3d-models/cork-corner-shop-1-ireland-21818eaa4c1c402a82baf9031ebaa93a |
| models/buildings/shop-b.glb | Bourges corner shop 1 | Lost_Gecko | https://sketchfab.com/3d-models/bourges-corner-shop-1-france-63b23c3e5cd2461f8e3426b35fec72d9 |
| models/buildings/apt-a.glb | Low poly Soviet apartment building | Colin.Greenall | https://sketchfab.com/3d-models/low-poly-soviet-apartment-building-8k-05229ac1d1f94e6c8cacaad91110c602 |
| models/buildings/apt-b.glb | Low poly Asian tower block | Colin.Greenall | https://sketchfab.com/3d-models/low-poly-asian-tower-block-694adf5094fa41f99a245ed822293f47 |
| models/buildings/corner-a.glb | Bordeaux flat 2 corner | Lost_Gecko | https://sketchfab.com/3d-models/bordeaux-flat-2-corner-france-d390f8d7c3064060b03a753ec02c1da1 |
| models/buildings/corner-b.glb | Bordeaux flat 1 corner | Lost_Gecko | https://sketchfab.com/3d-models/bordeaux-flat-1-corner-france-cde0ef76b4ab482bad79d29fe5fb7a88 |

## Lighting / textures (CC0, Poly Haven)
- `hdri/day_1k.hdr` — "Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal (sky edits: Jarod Guest), CC0 — https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
- `textures/tree/*` — "Jacaranda Tree" textures by Rico Cilliers, CC0 — https://polyhaven.com/a/jacaranda_tree (shipped with the template)

## Fictional content
Plates such as `01 D 666 FB` / `90 O 909 BA` are fictional; the plate images
(`textures/plates/*.png`) are generated by `scripts/make-plates.py` (Roboto Condensed, Apache 2.0). Street and landmark names are
used as place names only; the map layout is not a real map of Tashkent.

## Engine sounds (v1.6)
All engine sounds are **procedurally synthesized** in the browser (`lib/engineSound.ts`,
`lib/audio.ts`): no recorded audio files are used or shipped, so no third-party audio
license applies. Each player car has its own tuned voice (Lacetti small 4-cyl, Seltos/K5
turbo 4-cyl, E30 M3 high-rev S14 four, M3 Competition twin-turbo straight six) and the other
vehicles use generic profiles (V8, V6, diesel, tank diesel, bike, boat, turbine, rotor).
Pitch follows the simulated engine RPM (firing frequency rpm/60 × cylinders/2).

## Cockpit interiors (v1.6)
| File | Source model | Author | License | Source | Used for |
|---|---|---|---|---|---|
| models/interiors/sedan2-interior.glb | 2014 Toyota Corolla E180 EU (with interior) | armoredwave | CC BY 4.0, **modified** (cabin only, decimated 84k → 28.5k tris, textures 256 px WebP, steering wheel split + re-pivoted) | https://sketchfab.com/3d-models/2014-toyota-corolla-e180-eu-with-interior-36f95efb0585464cae43a25a3b3392e8 | sedans: Lacetti, K5 |
| models/interiors/suv-interior.glb | 2019 Skoda Karoq | BHP3D | CC BY 4.0, **modified** (cabin only, decimated 186k → 31k tris, textures 256 px WebP, steering wheel cut out of the dash mesh + re-pivoted) | https://sketchfab.com/3d-models/2019-skoda-karoq-7e359874ebe744158eddc37c9da8f487 | SUV / modern: Seltos |
| models/interiors/sport-interior.glb | 2021 BMW M4 Competition | Ricy ([ngon_3d](https://sketchfab.com/ngon_3d)) | [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (license verified on the Sketchfab API 2026-10-04), **modified** (cabin only — body, glass, doors, wheels dropped; decimated 117k → 28.8k tris, textures 256 px WebP, M steering wheel re-pivoted) | https://sketchfab.com/3d-models/2021-bmw-m4-competition-d3f07b471d9f4a2c9a2acf79d88a3645 | sports cockpit (v2.1): BMW M3 Competition, BMW M3 E30 |

The driver's gloved hands and sleeves are procedural (components/CarInterior.tsx).
