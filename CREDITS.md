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
Plates such as `01 D 666 FB` / `90 O 909 BA` are fictional. Street and landmark names are
used as place names only; the map layout is not a real map of Tashkent.
