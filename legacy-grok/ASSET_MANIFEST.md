# Toshkent Drive — asset manifest

This is a browser build of the Amir Temur vertical slice, not a Unity or Unreal project and not an Android APK. The live preview is the playable build.

## Player car

The player Kia Seltos is the user-supplied mesh `public/models/seltos.glb` (Mexico_Seltos_PE_pc13). It replaces only the player's Seltos. Other catalog cars and traffic stay original low-poly geometry. The earlier Sketchfab Free Standard model was not downloaded.

## Original geometry

Roads, buildings, vegetation, signs, traffic, pedestrians, UI, and audio (synthesized sports-style engine for the Seltos) are generated in code. The only bundled GLB is the user-supplied Seltos.

## Map

Anchor: Amir Temur Square, 41.31143 N, 69.27966 E. The gardens, monument, perimeter boulevards, hotel to the east, and Sayilgoh to the west follow that arrangement. Oliy Majlis and the TV tower are brought into the first 520 m tile so they are reachable. This is not an OpenStreetMap tile renderer. If a later pipeline ingests OSM, keep the ODbL attribution.

## Plate

`01 D 666 FB` is a fictional in-game number, not a real Uzbekistan registration.

## Save

Local only (`localStorage`, key `toshkent-drive-v1`). No account.

## Run

The preview starts with the app. Graphics presets: Low, Medium, High, Ultra. Auto quality drops a step if the frame rate stays under about 28.
