Side-view contact sheet of car GLBs (red arrow = +z = the engine's forward).
Serve this folder with `three` -> node_modules/three and `models` -> public/models symlinked in,
e.g. `python3 -m http.server 4180`, then `SIDE=1 PW=... node shot.cjs "traffic/sedan-a.glb@-1.5708,..." out.png`
(`file@rotY`). Every nose must point along the arrow. Used for the v1.7b NPC orientation fix.
