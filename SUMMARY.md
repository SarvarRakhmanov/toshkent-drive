# Neon City Drive — Web Migration

Rewriting the single-file `index.html` game (repo root) into a real web app:
Next.js + React Three Fiber (three.js for React) + Rapier (physics engine) +
zustand (HUD state). The original file is untouched and still fully playable —
this folder is a from-scratch parallel build, following the phased plan below.
Nothing here is wired back into the original game yet.

**Goal is full look-and-feel parity with the original**, not just matching
physics. "Feel" (Milestone 1) is done — the driving math is ported verbatim.
"Look" (bloom, exact colors, real vehicle silhouettes, real building facades
with baked window textures, roads with lane markings/sidewalks, parks/trees,
landmarks, club interior, police station/convoy, minimap, HUD chrome) is now
largely in, through Milestone 12. What's left is mostly named simplifications
inside otherwise-real systems (the club's crowd/set-dressing, the convoy's
felony-stop maneuver, instanced-prop variety) rather than whole missing
systems — read each milestone below for exactly what currently matches vs.
what's still a documented cut.

## How to run

```bash
cd web-migration
npm install
npm run dev   # http://localhost:3000
```

WASD/arrows to drive, Space to handbrake, **SHIFT** for nitro (car only), **B**
to cycle control between car, bike, and boat, **C** (or the on-screen buttons)
to cycle camera CHASE/COCKPIT/HOOD/CINE, **M** to mute, **G** (or click the
minimap) to open the map and pick a destination — the waypoint arrow up top
points at it. A few self-driving traffic cars patrol the arena on their own.
The city now streams in real chunks (roads, seeded buildings) as you drive,
plus a water area the boat floats on, plus 9 landmark beacons at the
original's exact coordinates — see Milestones for exactly what's real
vs. placeholder.

## Migration phases

| Phase | What | Status |
|---|---|---|
| 0 | Next.js scaffold, full-viewport Canvas, day/night sky cycle, ground | ✅ done |
| 1 | Real chunk-streamed city: roads, seeded-random buildings, streaming as the player moves | ✅ done (see Milestone 5 — placeholder arena fully replaced) |
| 2 | **Validation vehicle**: one car, arcade physics ported from the original game, collision via Rapier's `KinematicCharacterController` | ✅ done — feel holds up, see below |
| 3 | Remaining vehicle types (bikes, boats w/ buoyancy), traffic AI | ✅ done (basic traffic; original's road-grid/lights/yielding still to come) |
| 4 | HUD → real React components: title/clock, speedo, nitro, hint/msg, camsel, controls legend, vignette, minimap | ✅ done (waypoint/big-map/touch-controls still need a landmark system — see Milestone 6) |
| 5 | Audio, save/load, landmarks/waypoint/map, club interior, police convoy, boat-swap, police station | ✅ done (Milestones 7-11) — club interior itself still simplified, see Milestone 9 |
| 6 | Instance repeated props, perf pass, deploy | ⏳ not started |

## Milestone 1 — Phase 0–2: physics validation (2026-07-24)

**Goal:** prove the architecture before porting the other ~7,500 lines. The
real risk was always Phase 2 — does an arcade "feel" hand-tuned in raw
position-integration code survive a move to a real physics engine?

**Decision: kinematic body + Rapier's `KinematicCharacterController`, not a
dynamic rigid body.** The original plan said "apply forces to a dynamic rigid
body." In practice that means re-deriving the whole feel from scratch via
force/impulse tuning — high risk, high effort, and Rapier's dynamics are not
what a hand-tuned arcade racer wants anyway. Instead: `lib/carPhysics.ts` is
the *exact* velocity/steering math from the original `tick()` (steering ramp,
engine/drag, lateral grip), untouched. Each frame it produces a desired
`(dx, dz)`; Rapier's `KinematicCharacterController.computeColliderMovement()`
takes that desired move and returns a corrected one that slides along
obstacles instead of just stopping dead — a straight upgrade over the
original's hand-rolled AABB push-out, with zero risk to the feel. This is the
real "improved physics" the migration was asked for: not different-feeling
driving, but collision that works properly against real geometry (angles,
corners, stacked shapes) instead of axis-aligned boxes.

**Bug hit and fixed:** the very first working build crashed on load with
`recursive use of an object detected which would lead to unsafe aliasing in
rust` / `null pointer passed to rust`, thrown from inside Rapier's WASM.
Ruled out, in order: React StrictMode (disabled it, still crashed — later
re-enabled once the real cause was found and confirmed it wasn't this),
Turbopack vs. webpack (tried both, same crash — not a bundler issue), a
duplicate nested `@dimforge/rapier3d-compat` install (real issue, fixed by
pinning the exact version `@react-three/rapier` expects so npm dedupes to one
copy — but not the crash's cause). Isolated it by building a bare test scene
and adding pieces back one at a time: `Physics` + static bodies alone → fine;
adding a kinematic body → fine; creating a `KinematicCharacterController` in
`useEffect` → fine; calling `body.collider(0)` **inside `useFrame`, every
frame** → crash, reproduced exactly. Querying a rigid body's collider by index
from inside the render loop re-enters Rapier's internal borrow while the
physics step (also running via `useFrame`) holds it. Fix: stop querying it —
render an explicit `<CuboidCollider ref={colliderRef}>` as a child of the
`RigidBody` (with `colliders={false}` on the body itself) and use that stable
ref every frame instead. No more dynamic lookups, no more crash, confirmed
stable with StrictMode back on.

**Files:**
- `lib/carPhysics.ts` — the ported arcade math, pure function, framework-agnostic
- `lib/useKeyboard.ts` — keyboard state in a ref (no re-renders)
- `lib/hudStore.ts` — zustand store for the speedo
- `components/Car.tsx` — kinematic RigidBody + character controller + chase camera
- `components/World.tsx` — ground, boundary walls, a handful of test buildings
- `components/SkyCycle.tsx` — day/night background + sun lerp
- `components/Game.tsx` / `components/HUD.tsx` — top-level wiring
- `app/page.tsx` — client-only dynamic import (Canvas/WASM can't SSR)

## Milestone 2 — Phase 3 (part 1): boat + vehicle switching (2026-07-24)

**Goal:** prove a second, physically-different vehicle type coexists with the
car in the same physics world, and that switching control between them is
clean — the next step toward the original game's full vehicle roster.

**Boat physics deliberately skips `KinematicCharacterController`.** A hull has
no floor to snap to, so there's nothing for a character controller to do —
it's built for walking on ground, not floating. `Boat.tsx` reuses the exact
same `stepCarPhysics` from Milestone 1 (that function is vehicle-agnostic; it
just turns input + handling constants into a velocity), but with a new
`BOAT_HANDLING` preset (low grip, wide turns — same numbers as the original
game's `BOAT_HANDLING`) and integrates position directly instead of going
through Rapier collision. Height is a simple `WATER_LEVEL + sin(...)` bob, no
physics involved, matching the original's idle-boat visual. It's still a
Rapier `kinematicPosition` RigidBody (not a bare mesh) with no collider
attached yet — so it's already a citizen of the physics world, ready for dock
collision later, without re-opening the `body.collider(0)`-in-`useFrame` trap
from Milestone 1 (this component never queries a collider at all, so that
whole bug class doesn't apply here).

**Vehicle switching (`B` key)** is one field in `hudStore` (`active: "car" |
"boat"`), read by both `Car.tsx` and `Boat.tsx` inside their own `useFrame` —
whichever isn't active still runs its physics step (with no input, so it
decelerates naturally instead of freezing mid-slide) but skips the camera
update. No shared "vehicle manager" component needed for two vehicles; if a
third and fourth show up in Phase 3 this should get promoted to a real
registry instead of copy-pasted `isActive` checks in every vehicle file.

**Files added/changed:**
- `lib/carPhysics.ts` — added `BOAT_HANDLING` (same function, new constants)
- `lib/hudStore.ts` — added `active`/`toggleActive`
- `components/Boat.tsx`, `components/Water.tsx` — new
- `components/Car.tsx` — gated input/camera on `active === "car"`
- `components/Game.tsx` — mounts `Water`/`Boat`, `B` keybind
- `components/HUD.tsx` — shows active vehicle + switch hint

**Known rough edge, not a bug:** the ground plane (Milestone 1) and the water
plane currently overlap in X — the original game has a hard `SHORE_X`
coastline boundary, this doesn't yet. Fine for a physics-validation slice,
worth fixing when `World.tsx` becomes the real chunk-streamed city.

## Milestone 3 — visual parity pass (2026-07-24)

**Goal:** the user asked explicitly for the web version to look and feel like
the original, not just drive like it. Everything up to Milestone 2 used
placeholder boxes on purpose (physics validation first). This milestone
brings the *existing* pieces (car, boat, sky, world) toward the original's
actual look before adding more scope on top of the wrong visuals.

**What now matches the original, specifically:**
- **Bloom**: `EffectComposer` + `Bloom` (luminance threshold 0.82, intensity
  0.9) — the exact numbers from the original's `UnrealBloomPass`. Only true
  emissive materials (headlights, taillights, boat nav light) cross that
  threshold and glow; body paint and lit building facades sit just under it,
  same split the original deliberately tunes for.
- **Sky colors**: `cDay`/`cNight` are now the original's literal hex values
  (`0x7ec4f2` / `0x05070f`), not approximations. Cycle now starts at night —
  the look every reference screenshot in this conversation has been.
- **Car silhouette**: real body-+ set-back-cabin stack instead of one box, on
  four wheel cylinders, randomized from the original's exact `sedanColors`
  array, emissive head/tail lights.
- **Boat**: blue-tinted mirrors (the literal fix from the original's own
  `attachMirrors` — same hex, `#1f6fe0`) and an emissive red bow light.
- **Buildings**: grey/glass color palette matching the original's
  `facadeMats`/`glassTowerMats` tones, and now fade in a warm emissive glow at
  night (`skyState.nightK`, a module-level value `SkyCycle` updates every
  frame so any component can read the current night factor without a
  re-render) — approximating "lit windows at night" without the original's
  baked canvas window texture.

**Still a placeholder, not yet matching:** the actual procedural city
generation (chunk streaming, real building shapes/textures, roads with lane
markings, sidewalks, trees, parks, landmarks, the club interior, AUTO YARD,
POLICE HARBOR STATION), pedestrians, traffic AI, the minimap/HUD chrome, and
audio. World.tsx is still 7 boxes in a field. This is the honest gap between
"looks like the original in the small" (true now) and "looks like the
original" (not yet) — closing it is most of what's left in Phase 3/5/6.

**New shared pattern:** `skyState` (a plain mutable object exported from
`SkyCycle.tsx`, not React state/context) is how per-frame environment values
get shared across components cheaply. Reach for this again for anything else
that changes every frame and many components need to read (time of day,
weather, siren-active) rather than adding it to `hudStore` (which is for
values the *UI* renders, and re-renders on).

**Files changed:** `components/Game.tsx` (bloom), `components/SkyCycle.tsx`
(exact colors, `skyState`), `components/Car.tsx` (real silhouette),
`components/Boat.tsx` (mirrors, nav light), `components/World.tsx`
(palette + night-emissive buildings).

## Milestone 4 — Phase 3 complete: bike + traffic AI (2026-07-24)

**Goal:** finish Phase 3 — the last vehicle type, plus proof that vehicles can
drive themselves (needed for any city to feel alive).

**Bike** (`Bike.tsx`) is structurally a near-copy of `Car.tsx` — same
`KinematicCharacterController` setup, same gravity/ground-snap integration —
because in the original, a bike goes through the *identical* drive-loop
physics as a car; the only difference is it defaults to grip 9 instead of 6.5
(`BIKE_HANDLING` in `carPhysics.ts`) and leans visually into turns
(`rotation.z = -steer * speed-scaled * 0.45`, the original's exact formula,
smoothed with a small lerp so it doesn't snap). Noted directly in the file:
if a fourth land vehicle shows up, the copy-pasted controller/gravity/camera
boilerplate between `Car.tsx` and `Bike.tsx` should get pulled into a shared
hook rather than copied a third time.

**Vehicle switching is now 3-way** — `hudStore.toggleActive` cycles
car → bike → boat → car via a small `CYCLE` array instead of a binary flip.

**Traffic AI** (`Traffic.tsx`) is intentionally *not* routed through Rapier's
character controller — and that's not a shortcut, it matches the original's
own architecture: traffic cars there were always driven by a simpler, separate
position loop from the player's physics block (the same split Milestone 1/2
already ported for boats). Five cars patrol fixed x- or z-axis lanes at
different cruise speeds, reversing direction at the arena bounds, reusing the
same `CarMesh` visual as the player's car (now accepts an optional `color`
prop instead of always randomizing).

**Explicitly not done, and next in line precisely because of that:** traffic
cars don't yet collide with the player, obey a road grid, stop at lights, or
yield — there's no road grid for any of that to attach to yet. That's the
same "still a placeholder" gap called out in Milestone 3: real city geometry
in `World.tsx` is what unlocks all of it at once, which is why it's next.

**Files added/changed:** `lib/carPhysics.ts` (`BIKE_HANDLING`),
`lib/hudStore.ts` (3-way cycle), `components/Bike.tsx`, `components/Traffic.tsx`
(new), `components/Car.tsx` (`CarMesh` exported + `color` prop),
`components/Game.tsx`/`HUD.tsx` (mount + copy).

## Milestone 5 — real chunk-streamed city, replacing the placeholder arena (2026-07-24)

**Goal:** replace the 7-box test arena with the original's actual architecture
— a city that streams in around the player as real chunks, not a fixed set of
props. This was flagged in Milestones 3/4 as the single biggest remaining gap
toward "looks exactly like the original."

**`components/City.tsx` replaces `components/World.tsx` entirely** (deleted,
not kept alongside). Same constants and algorithm as the original's
`buildChunk()`/`ensureChunks()` — `CELL=100`, `ROAD_W=20`, and `mulberry32` is
the *identical* PRNG (not a substitute) so chunk content is deterministic and
stable as chunks stream in/out, exactly like the original's per-chunk seed
`(ci*73856093) ^ (cj*19349663) ^ 0x5bd1e995`. Chunks are plain React state (an
array of `"ci,cj"` keys); mounting/unmounting a `<Chunk>` is what creates/frees
its Rapier RigidBodies — no manual `scene.add`/`remove` bookkeeping the way the
original's raw three.js version needed. Streaming itself follows the original's
own throttling trick: a `useFrame` computes the player's current chunk index
from the new `worldState` singleton (same pattern as `skyState` — a plain
mutable object each active vehicle writes its position into, read here without
subscribing) and only recomputes the visible set when that index actually
changes, not every frame.

**Deliberately simplified vs. the original, and explicitly not yet done:**
buildings are seeded boxes with a flat color, not real facade shapes with baked
window textures; the "road" is a color-strip approximation at chunk edges, not
real geometry with lane markings; there are no sidewalks, trees, parks, or
landmarks; traffic (`Traffic.tsx`, Milestone 4) still patrols its own
hardcoded lanes rather than following this road grid. The spawn chunk
(`ci===0 && cj===0`) is kept building-free on purpose, matching the original's
showroom/club exemption — both the car and bike spawn there.

**Bug found and fixed via direct browser testing, not yet re-verified
visually:** used Chrome DevTools Protocol (a WebSocket JS-execution/screenshot
interface) to actually drive the car via dispatched key events and capture
screenshots, rather than just watching the dev-server log for crashes. Two
screenshots (before/after 8s of simulated driving) both showed a hard vertical
split down the middle of the frame — left half rendered normally, right half
render almost pure black. Zero JS errors were thrown (confirmed via
`Runtime.exceptionThrown`/console-error listeners over the same CDP
connection), so this is a rendering-pipeline issue, not a crash. Diagnosis: a
devicePixelRatio mismatch between the main WebGL canvas (sized at full
physical/Retina resolution by R3F's default `dpr`) and `EffectComposer`'s
internal render targets (sized off `useThree`'s CSS-pixel `size`, not always
multiplied back up correctly by this version combination) — the composite
pass would then only cover part of the true backing buffer. Applied the
standard fix: `<Canvas dpr={1}>` in `Game.tsx`, pinning to 1x instead of
auto-detecting the display's pixel ratio. Type-checks clean and the dev server
loads with no runtime errors, but the CDP session that found the bug was lost
mid-investigation (a follow-up step tried to quit/relaunch the browser to get
a clean debugging profile, which is the user's actual browser window — that
step was correctly stopped) and hasn't been reopened, so **this fix is
reasoned from the library's sizing code, not yet re-confirmed with a
screenshot.** Worth an explicit visual check on real hardware before trusting
it fully.

**Files added/changed:** `components/City.tsx` (new, replaces `World.tsx`),
`lib/worldState.ts` (new), `components/Car.tsx`/`Bike.tsx`/`Boat.tsx` (write
`worldState` when active), `components/Game.tsx` (`City` swap, `dpr={1}`).

## Milestone 6 — HUD/UI parity pass, Phase 4 complete (2026-07-24)

**Goal:** the user asked explicitly for the UI to match the original,
"better is more preferable, but I don't want to compromise on anything." This
milestone ports the original's actual DOM/CSS HUD chrome, not a redesigned
substitute — and adds the real mechanics behind pieces of it that didn't
exist yet (nitro, alternate cameras), rather than static-only chrome.

**HUD DOM/CSS is a direct port**, not a reinterpretation: `app/globals.css`
carries over the original's `#hud`/`#speedo`/`#nitrobar`/`#hint`/`#msg`/
`#camsel`/`#controls`/`#vig`/`#minimap` rules near-verbatim (same colors,
same gradients, same layout numbers), and `HUD.tsx` renders the matching DOM
structure so those rules apply exactly as they did in the original.

**Real nitro, not just a bar**: `Car.tsx` now has the original's actual
mechanic — `NITRO_MAX=10`s fuel, `NITRO_BOOST=41.7` m/s (+150km/h) raised cap,
2.7× effective accel while boosting (same `accel*dt` base + `accel*1.7*dt`
extra thrust as the original), fuel drains 1:1 while boosting and refills at
half rate otherwise. SHIFT is now a real input (`useKeyboard` gained a
`boost` key). Cars only — bikes and boats don't get nitro, matching the
original.

**Four real camera modes, not one**: `lib/cameraRig.ts` is a new shared
module porting the original's *entire* camera block (chase/cockpit/hood/
cinematic) — same distances, eye heights, and the cinematic mode's exact
4-phase/20s-cycle orbiting-angle timings. Previously only a hardcoded chase
cam existed; now all three vehicles get all four modes through one shared
function (`C` key cycles, or click a `#camsel` button), rather than
duplicating camera math per vehicle a third and fourth time.

**Minimap is a real radar**, not a decoration: a canvas 2D component rotates
the world by `-heading` so the player always faces "up" (the original's
convention), drawing a faint road grid at `City.tsx`'s actual `CELL` spacing
and live traffic blips from a new shared `trafficPositions` array (same
plain-mutable-singleton pattern as `skyState`/`worldState`).

**Caught and fixed 4 real bugs via a stricter linter this project ships with
by default** (`eslint-config-next`'s bundled React Compiler rules, notably
stricter than what came before): a genuine Rules-of-Hooks violation in
`City.tsx` (`useMemo` called after a conditional early return — fixed by
moving the shore-chunk skip to the parent's `.map` instead of inside
`Chunk`), a ref read during render in `Boat.tsx`'s initial JSX position
(fixed with the literal spawn coordinates instead), and an impure
`Math.random()` inside a `useMemo` in `Car.tsx` (moved to a `useState` lazy
initializer — canonical place for a one-time impure value). One category was
a false positive worth understanding, not silencing blindly: the same
linter flags `SkyCycle.tsx`'s `scene.background`/`fog` mutation inside
`useFrame` as an "impurity," but `useFrame` callbacks run in three.js's
render loop, outside React's own render cycle entirely — imperatively
mutating scene state there is R3F's documented pattern, not a bug. Disabled
with an explanatory comment at exactly those two lines, not file-wide.

**Explicitly not done, by design — needs a landmark system that doesn't
exist yet:** `#waypoint` (distance/arrow to a nav target — there's no target
without landmarks), the big map screen (`#mapscreen`/`#bigmap`/destination
list — same blocker), and `#touch-controls` (mobile joystick/buttons —
deferred behind desktop parity, not forgotten).

**Files added/changed:** `lib/cameraRig.ts`, `components/Minimap.tsx` (new);
`lib/hudStore.ts` (camMode/hint/msg/nitro/clock state), `lib/useKeyboard.ts`
(`boost` key), `lib/worldState.ts` (`heading`), `components/HUD.tsx`
(full rebuild), `app/globals.css` (original's HUD CSS), `components/SkyCycle.tsx`
(clock string), `components/Car.tsx`/`Bike.tsx`/`Boat.tsx` (cameraRig wiring,
nitro), `components/Traffic.tsx` (`trafficPositions` export), `components/City.tsx`
(hook-order fix).

## Milestone 7 — procedural audio + save/load (2026-07-24)

**Goal:** two more items off the "everything, no compromise" list — the
original's real audio isn't decoration, and neither is persistence (its own
comment calls out that losing position on reload was a user complaint that
got fixed).

**Audio is the original's actual oscillator graph, same numbers.**
`lib/audio.ts` ports `initAudio()`'s engine voice (sawtooth + square through
a 420Hz lowpass) and nitro voice (sawtooth + square through an 260Hz/Q0.8
bandpass) with the exact frequency/gain formulas from the original's audio
update block — `48+drv*2.4` / `24+drv*1.2` for engine pitch, `0.02+drv*0.0008`
clamped to 0.06 for engine gain, `0.13` nitro gain with filter frequency
`220+drv*9`, all smoothed with the same `setTargetAtTime` time constants
(0.05/0.08). `AudioContext` requires a real user gesture to start, so
`initAudio()` is called from the first keydown or pointerdown in `Game.tsx`
(no-ops on every call after the first) rather than needing an explicit
"click to start" screen. **M** toggles mute (suspends/resumes the context,
not just gain — matches the original, saves CPU while muted). Engine sound
is car-only in this build since bikes/boats don't have their own engine
voice yet in the original either at this stage — a gap to note, not a
regression.

**Save/load persists per-vehicle position, not just "the player."** The
original has one `player.veh` that gets swapped; this build has three
simultaneously-existing vehicles, so `lib/vehicleState.ts` is a new shared
singleton (same pattern as `skyState`/`worldState`) that all three — not
just the active one — write their `{x,z,h}` into every frame, so switching
which vehicle you're driving and then saving doesn't lose the other two's
position. `lib/saveGame.ts` snapshots `vehicleState` plus active vehicle,
camera mode, mute, and the day-cycle phase (`skyState.phase`, newly exported
— pulled `skyState` out of `SkyCycle.tsx` into its own `lib/skyState.ts` to
avoid a circular import with `saveGame.ts`) to `localStorage`, autosaved
every 3s and on `beforeunload`, same cadence as the original. Restored two
different ways depending on what changes how often: vehicle *positions* load
inside each vehicle's own `useState(() => loadSave()...)` lazy initializer
(spawns in the right spot on frame one, no load-then-jump), while
active/camMode/mute — global, rarely-changing — get applied once in a
`Game.tsx` effect after mount.

**Files added/changed:** `lib/audio.ts`, `lib/saveGame.ts`,
`lib/vehicleState.ts`, `lib/skyState.ts`, `components/AudioEngine.tsx` (new);
`components/SkyCycle.tsx` (moved `skyState` out, added `phase`), `components/City.tsx`
(updated `skyState` import), `components/Car.tsx`/`Bike.tsx`/`Boat.tsx`
(save-aware spawn position, `vehicleState` writes), `components/Game.tsx`
(audio init, autosave wiring, M key), `components/HUD.tsx` (controls legend).

## Milestone 8 — landmarks, waypoint, big map (2026-07-24)

**Goal:** unblock everything that was waiting on "there's no landmark
system yet" — the waypoint arrow, the destination map screen, and (next)
real destinations for the club door and police convoy to target.

**Exact coordinates, ported structures deferred.** `lib/landmarks.ts` carries
over the original's `LANDMARKS` array verbatim — same 9 names, same x/z, same
colors (VENU, AUTO YARD, CENTRAL PARK, NEON STADIUM, SKY TOWER, FOUNTAIN
PLAZA, HARBOR LAKE, EAST MARINA, POLICE HARBOR). What's *not* ported yet is
each landmark's actual structure (the original builds a real park/stadium/
tower/plaza/club/marina per landmark); for now each is a colored beacon pillar
+ billboarded name label (`components/LandmarkMarkers.tsx`, using drei's
`Text`/`Billboard` — no custom font-texture pipeline needed). This is
deliberate sequencing, not corner-cutting: the coordinates are locked in now
so club/police-station work (next) slots into the *same* spots rather than
picking new ones later. Markers are always rendered, independent of chunk
streaming — same as the original's persistent top-level sign group — so
they're visible from a distance the way the real landmarks are, not gated
behind `City.tsx`'s streaming radius. `City.tsx` also now skips random
buildings in any landmark's chunk (extending the existing spawn-block
exemption to a `LANDMARK_CHUNKS` set), so nothing spawns on top of a beacon.

**Waypoint uses the original's exact bearing math.** `components/WaypointTracker.tsx`
computes `along`/`side` relative to the player's own heading (not compass
north) via the same `atan2` formula as the original, so the arrow always
points the right screen-relative direction regardless of which way the
camera/vehicle is facing. Runs inside `<Canvas>` (needs `useFrame`) and
writes into `hudStore`, which the DOM-side `#waypoint` element (outside the
canvas) reads reactively.

**Big map is a fixed full-world view, not player-centred/pannable like the
original.** `components/BigMap.tsx` shows all 9 landmarks and the player
marker inside one static viewport sized to cover every landmark with margin.
Simplified deliberately: the destination list (`#maplist`, sorted by live
distance) already covers selection, so a pannable/zoomable canvas wasn't
worth building yet — noted here as a real simplification, not hidden. `G`
or clicking the minimap opens it; `Escape`, the close button, or a click
outside the card closes it.

**Files added/changed:** `lib/landmarks.ts`, `components/LandmarkMarkers.tsx`,
`components/WaypointTracker.tsx`, `components/BigMap.tsx` (new); `lib/hudStore.ts`
(`navTarget`/`waypointDist`/`waypointDeg`/`mapOpen`), `components/City.tsx`
(`LANDMARK_CHUNKS` exemption), `components/HUD.tsx` (`#waypoint`/`#maphint`,
minimap click, mounts `BigMap`), `components/Game.tsx` (`G`/`Escape` keys),
`app/globals.css` (`#waypoint`/`#mapscreen`/`#bigmap`/`#maplist`/`#mapclose`
rules, ported from the original).

## Milestone 9 — club interior, door-proximity mechanic (2026-07-24)

**Goal:** the first half of "Next up" — a real walk-in VENU, not just a
beacon. Deliberately scoped down from a full port (see below); the police
station/convoy/boat-swap/dock-collision work is still next, unstarted.

**No on-foot mode exists in this build (Phase 3 never added one), so the
door mechanic is redefined around vehicles instead of walking.** The
original requires `player.onFoot` before `clubDoorAction()` does anything;
building a real walking-player system (leave-vehicle, capsule controller,
re-enter) just to gate a door was judged out of scope for this pass — so
entry/exit triggers off proximity to the door while driving car or bike
(boat explicitly excluded, see `lib/club.ts`), same squared-distance
thresholds as the original otherwise. **Not building an on-foot mode is the
single biggest simplification here** — it's also what blocks the
Bollywood dance-emote and the original's "walk up, steal a car" mechanic
from ever being ported as-is.

**The interior is a real place in the world, not an overlay scene** —
`CLUB`/`CLUB_IN` in `lib/club.ts` are the original's exact coordinates
(`CLUB_IN` built far south so it never meets the streamed city).
`City.tsx` gained one more chunk exemption (alongside spawn/landmark
chunks) so no random building spawns on top of the room. Entering/exiting
teleports the active vehicle via a new `lib/clubTeleport.ts` singleton
(same mutable-object pattern as `worldState`/`skyState`) — `Car.tsx` and
`Bike.tsx` poll it once per frame and consume it with `body.setTranslation`
when they're the active vehicle; nothing polls it for the boat, which is
why boat entry is blocked at the source in `clubDoorAction()` rather than
silently queuing a teleport nobody picks up.

**Crowd is deliberately not rigged.** The original's ~40 dancers/patrons
each have independently-animated arms/legs/torso (`fig()`'s bollywood
thumka/jhatka). That's cut to 16 simple capsule-body blobs
(`components/ClubInterior.tsx`) that bob and sway in place, driven by the
same 130bpm `beat`/`bps` math as the original's `updateClub()` — reads as a
moving crowd from driving distance, costs a fraction of the geometry and
skips per-figure limb rigs entirely. Also cut for scope, all decoration-only:
the bar/bottle-shelf, VIP couches, chrome poles + pole dancers, and the
three exterior light-beam cones. Kept: floor/walls/ceiling (with real
`RigidBody` colliders so driving can't clip through), stage, DJ booth,
disco ball, 3 orbiting color-cycling spotlights, 8 laser cones, checker
dance floor with beat-synced emissive pulse, exit door/sign.

**Club music is a near-verbatim port**, not a placeholder — `lib/audio.ts`
gained `startClubMusic()`/`stopClubMusic()`, the original's full tabla/tap/
hat/melody/bass oscillator schedule at the same 130bpm, same synthesis
constants, same self-scheduling `requestAnimationFrame` look-ahead
technique. Skipped restoring club music across a page reload (saving/
restoring `hud.inClub` itself was judged not worth it this pass either) —
if you reload mid-club you land back outside; noted as a real gap, not
hidden.

**Verified:** `tsc --noEmit` and `eslint` clean; dev server recompiles with
no runtime errors. **Not yet done:** driving the car to the door and back
through an actual browser session — no browser-automation tool is
installed in this project, so this is reasoned from the code and the
original's line-for-line port, not confirmed with a screenshot. Same honest
gap as Milestone 5's `dpr={1}` fix, which is *also* still unconfirmed.

**Files added/changed:** `lib/club.ts`, `lib/clubTeleport.ts` (new),
`components/Club.tsx`, `components/ClubInterior.tsx` (new); `lib/audio.ts`
(`startClubMusic`/`stopClubMusic`), `lib/hudStore.ts` (`inClub`),
`components/Car.tsx`/`Bike.tsx` (teleport consume), `components/City.tsx`
(`CLUB_IN` chunk exemption), `components/LandmarkMarkers.tsx` (VENU marker
suppressed — the club has its own sign now, same as the original's
`if(L.kind==='club') continue`), `components/Game.tsx` (`E` key, mounts).

## Milestone 10 — on-foot mode (2026-07-24)

**Goal:** Milestone 9 named this the single biggest gap it left behind —
the user asked for it directly, calling on-foot movement the actual point
of the game. Full port, not a cut-down: `components/Player.tsx` is a real
walking player with the original's exact numbers (turn 2.6 rad/s, walk 4.5
/ sprint 9 m/s SHIFT, accel/decel ramp 30/36, jump vy=7.5 with the
asymmetric held/released gravity for a variable-height hop), a proper suit
figure ported mesh-for-mesh from the original's `pMesh` (jacket/vest/tie,
exact box dimensions and pivots — not a placeholder capsule), and the
original's own walk-cycle/mid-air-tuck/bollywood-dance-emote limb math.

**Same architecture as Car/Bike, not a new one**: a `kinematicPosition`
RigidBody + `KinematicCharacterController`, the identical pattern Milestone
1 established — jump is the only new physics shape (a signed vertical
velocity fed through the controller each frame instead of Car/Bike's
constant ground-snap pull).

**Mount/dismount (E) reuses vehicleState, no new collision needed** —
`lib/player.ts`'s `toggleVehicleFoot()` finds the nearest of
`vehicleState.{car,bike,boat}` within 4.5 units (ported threshold) and
flips `hud.active`; dismounting computes the original's exact spawn offset
(`v.x+cos(h)*2.4, v.z-sin(h)*2.4`) and hands it to a new one-shot
`lib/playerTeleport.ts` singleton (mirrors `lib/clubTeleport.ts`, kept
separate on purpose — the two are never meant to serve the same frame's
request, see the learnings note). Car/Bike already ran their physics step
every frame regardless of `active` (Milestone 2's "decelerates naturally
instead of freezing" design) so a parked vehicle is already sitting still
by the time you walk up to it — no extra state needed there.

**Club door now genuinely supports all three ways in** (car, bike, or on
foot) — `lib/club.ts`'s `clubDoorAction()` routes its teleport to whichever
singleton the active mode actually polls. Walking into VENU now plays the
real bollywood dance emote when you stand still on the dance floor,
matching the original exactly (this was impossible before Player.tsx
existed).

**Hint text centralized to avoid a two-writer race**: both the club door
and the new vehicle-mount check want to drive `#hint` every frame; rather
than let `Club.tsx` and `Player.tsx` both call `hud.setHint()` (order-
dependent flicker), `lib/hint.ts` is the single priority-ordered function
(club door beats vehicle-mount, same order as the original's
`if(!clubDoorAction()) toggleVehicle()`), polled from the one place
(`Club.tsx`) that was already always-mounted.

**Verified in a real browser, not just compiled** — installed Playwright
(`npm install --no-save playwright`, not persisted to `package.json`) and
drove a headless Chromium through: load → click (user gesture for audio) →
`E` to dismount → walk (W+A) → sprint+jump (SHIFT+Space) → `E` again.
Zero console/page errors across the whole run. Screenshots confirm: the
suited player mesh renders next to the car, `ON FOOT` toast fires, `#speedo`
correctly unmounts, the mount hint (`Press E to drive — CITY SEDAN`) shows
at the right distance, the minimap/waypoint rotate correctly off the
player's own heading (not the last vehicle's), and the jump arc visibly
lifts the chase camera. This is real confirmation, not the "reasoned from
the code" caveat Milestones 5 and 9 had to leave behind.

**Files added/changed:** `components/Player.tsx`, `lib/player.ts`,
`lib/playerTeleport.ts`, `lib/hint.ts` (new); `lib/hudStore.ts`
(`ActiveMode = VehicleKind | "foot"`, `setActive`, `toggleActive` no-ops on
foot, exported `VEHICLE_NAMES`), `lib/club.ts` (teleport routing, foot
allowed through the door), `lib/saveGame.ts` (`SaveData.active: ActiveMode`),
`components/Game.tsx` (`E` falls through to `toggleVehicleFoot()`, mounts
`Player`, fixed the save-restore loop so `active:"foot"` can't infinite-loop
`toggleActive`), `components/HUD.tsx` (`#speedo` hidden on foot, `E`/jump
added to the controls legend).

## Milestone 11 — police station, convoy AI, dock collision, boat-swap (2026-07-25)

**Goal:** the "Next up" this milestone inherited, named directly by the
user. Unlike most of this migration, **this was a pure port with one real
bug fix along the way**, not new design work — a prior session had already
built the police/dock/convoy systems for real in the original `index.html`
(see the
[boat-physics-and-police-harbor](../learnings/2026-07-24-boat-physics-and-police-harbor.md)
learnings note).

**Found and fixed: `lib/landmarks.ts`'s `POLICE HARBOR` coordinate was a
real bug, not a placeholder.** It was still the original's raw, unconverted
`x:450` — at this build's `CELL=100`/`SHORE_CI=1`, that's deep inside open
water (unreachable by land), not "one block inland of the marina" like the
original's own comment describes. Every other landmark got rescaled to
this build's much smaller coastline back in Milestone 8; this one was
missed. Relocated to `(0, 50)` — chunk `(0,1)`, one chunk inland of EAST
MARINA's chunk `(1,1)` — the same *relative* placement the original
intended, adapted to this build's compact world. Fixing the coordinate
also automatically pulled the station chunk into `City.tsx`'s existing
`LANDMARK_CHUNKS` exemption (computed generically from every entry in
`LANDMARKS`) — no separate exemption code needed.

**Two new mountable vehicles, not a general n-instance fleet.** The
original has a large `vehicles[]` array (many boardable instances per
type); this build has always had exactly one fixed instance per
`VehicleKind`. Rather than rearchitect that for "one more police unit,"
`VehicleKind` gained two new members (`policeCar`, `patrolBoat`) that slot
into the exact same pattern as `car`/`bike`/`boat` — own component
(`PoliceCar.tsx`, near-copy of `Car.tsx`, `POLICE_HANDLING` = the
original's 83.3 m/s pursuit stats), own `vehicleState`/`VEHICLE_NAMES`
entry, mountable via the *already-generic* code in `lib/player.ts`/
`lib/hint.ts` (both iterate `Object.keys(vehicleState)`, so they needed
zero changes to pick the new kinds up). `BOAT_KINDS` (a new export from
`hudStore.ts`) replaced the old hardcoded `active === "boat"` check in
`lib/club.ts` so hull-exclusion from the club door generalizes to both
boats automatically.

**Police "siren" is implicit, matching the original exactly** — driving
`policeCar` *is* having your siren on (`hud.active === "policeCar"`), no
separate toggle key, same as the original's
`player.veh.userData.siren.kind==='police'` check. `PoliceCar.tsx`'s light
bar (two flashing red/blue boxes) flashes continuously whether driven or
parked, matching "looks on duty" at the station.

**Convoy AI extends `Traffic.tsx`, doesn't replace its architecture.** Two
of its lane-patrol cars are now `police: true`. Every frame each keeps
computing its ordinary patrol position in the background (even while
convoying) so dropping out of convoy resumes patrol live instead of
teleporting back; when `policeCar` is active and a police car comes within
70 units (the original's exact recruit radius), it "recruits" and instead
steers toward a slot-based formation target behind the player (`dist =
slot*10+8`, lateral `±2.8`, the original's exact land-convoy numbers) at a
capped chase speed. **Deliberately not ported: the felony-stop boxing-in
maneuver** (original ~line 7466) — a meaningfully bigger state machine
than a straight follow (surrounding the player's car from multiple angles
and slowing to box it in), left for later and named explicitly rather than
silently dropped.

**Dock collision is an upgrade, not a straight port, for land traffic —
and a straight port for hulls, because it has to be.** The original's pier
deck is walkable/drivable via a height-lookup hack (`onPier()`) because its
`collide()` system is 2D-only; `components/Marina.tsx` instead gives the
deck a real `RigidBody`+`CuboidCollider`, so Car/Bike/Player already climb
onto it through their existing `KinematicCharacterController` autostep —
zero new code for land traversal, the same call Milestone 1 made generally.
Boats are different: `Boat.tsx`/`PatrolBoat.tsx` never query Rapier
colliders at all (Milestone 2's direct-integration design), so the solid
deck doesn't stop a hull — `lib/marina.ts`'s `pierPush()` is a verbatim
port of the original's function (same AABB push-out math, same `r=2.0`),
called every frame from both boats' position-integration step.

**Boat-swap (E while already in a boat) reuses the mount/dismount E-key
chain**, not a new key — `lib/boatSwap.ts`'s `boatSwapAction()` slots in
between `clubDoorAction()` and `toggleVehicleFoot()` in `Game.tsx`'s `E`
handler (`clubDoorAction() || boatSwapAction() || toggleVehicleFoot()`),
so swapping into the other hull short-circuits before falling through to
"dismount to foot." With only two hulls in this build, "the other one"
needs no search; a third would need the same nearest-scan `lib/player.ts`
already does for land vehicles.

**Verified, with one caveat.** `tsc --noEmit`/`eslint` clean. A headless
Chromium session confirmed zero console/page errors across: mounting
`policeCar` (HUD correctly shows `POLICE CRUISER`, light bar visibly
flashing, drives at pursuit speed), mounting/driving near the station and
dock, and swapping directly into `patrolBoat` (HUD correctly shows `HARBOR
PATROL`). **This sandbox renders at only a few FPS** (SwiftShader
software GPU — see Milestone 12's independent confirmation of the same
finding) **too slow to cover the ~70-unit convoy-recruit radius through
real-time physical driving within a practical test window** — mount/
physics/naming were verified directly by driving and by jumping
`hudStore.active` programmatically (still exercises every real component's
reaction to the state change, just skips the slow physical approach), but
the convoy formation itself was verified by code review against the
original's formulas, not by watching it happen on screen. Named honestly
rather than claimed as confirmed.

**Files added/changed:** `components/PoliceCar.tsx`, `components/
PoliceStation.tsx`, `components/Marina.tsx`, `components/PatrolBoat.tsx`,
`lib/marina.ts`, `lib/boatSwap.ts` (new); `lib/hudStore.ts`
(`policeCar`/`patrolBoat` VehicleKind, `BOAT_KINDS`), `lib/vehicleState.ts`
(new entries), `lib/carPhysics.ts` (`POLICE_HANDLING`), `lib/club.ts`
(`BOAT_KINDS`-based exclusion), `lib/landmarks.ts` (POLICE HARBOR
coordinate fix), `components/Boat.tsx` (`pierPush` hull collision),
`components/Traffic.tsx` (convoy AI, light bars), `components/Game.tsx`
(mounts, `E`-key chain, save-restore fix for non-cyclable `ActiveMode`
values).

## Milestone 12 — real building facades, roads/lane markings, sidewalks, parks & trees (2026-07-25)

**Goal:** close the gap Milestones 3 and 5 both flagged as the single
biggest remaining one — `City.tsx` was still flat-colored boxes and
color-strip "roads." The user asked explicitly for real parity here, not
placeholder fidelity. Built directly from the original's actual
`buildChunk()`/`facadeMats`/`glassTowerMats`/street-tile code (read in
full first, not skimmed).

**Roads + sidewalks + lane markings turned out to be one change, not
three.** The original's own road/sidewalk/curb/crosswalk system isn't
per-chunk geometry at all — it's a single baked canvas texture
(`tileTex`, 1024×1024, tiled 16×16) mapped onto one giant ground plane, with
the curb and lane markings drawn as texture strokes, not raised 3D meshes.
That's a gift for a chunk-streamed city: one `buildTileTexture()` here
builds the equivalent (asphalt ring + concrete/grass interior + curb
stripes + dashed yellow centerline + white edge lines + corner crosswalk
zebras) as **one** `THREE.CanvasTexture` per variant (`CITY_TILE_TEX`,
`PARK_TILE_TEX`), built once at module load and reused by every chunk's
existing ground plane via `map=`. Zero new geometry, zero new colliders —
the flat ground plane that already existed for physics just got a real
texture instead of a flat color.

**Building facades**: ported the technique, not the exact pipeline. The
original bakes wall-color + window-grid + bump into one texture per stone
tint (8 separate `facadeTexPair()` canvases) plus a shared blue glass
curtain-wall texture, each paired with a lit-window "glow" map whose
`emissiveIntensity` is driven by `nightK`, updated on the *materials*,
globally, once a frame — never per-building. `City.tsx` now does the same:
one neutral window-grid texture + one warm glow texture for stone facades,
one blue-tinted grid + glow pair for glass towers (built once, module
scope), a small fixed palette of materials tinted via `color` reusing
those same two textures, and `City()`'s own `useFrame` sets
`emissiveIntensity` on all ~10 shared materials once per frame — replacing
the old per-`Building` `useFrame`+`ref` (O(buildings) before, O(materials)
now).

**Parks + trees**: `Chunk`'s existing per-chunk `mulberry32` PRNG now also
decides `isPark` (`rand() < 0.13`, the original's exact chance), before
the building-count draw — deterministic and stable across stream-in/out
exactly like buildings already were. Park chunks get the grass-tinted
ground texture instead of the sidewalk one, zero random buildings, and 6
extra trees in a 15–34 unit ring from chunk center. Every non-exempt chunk
also gets 3 streetside trees near its edges. Trees are a shared
cylinder-trunk + sphere-crown geometry/material set — no textures, no
collision (visual dressing only).

**Deliberately cut** (boxes-with-better-materials, matching the original's
own fidelity level, not exceeding it): per-building UV rescaling on stone
facades, macro-district zoning, building tiers/AC units/roof antennas
(that's the roadmap's Phase 6 "instance repeated props," not this ask),
tree bark/leaf textures, park fountains/benches/sports fields, road
manholes/oil-stains/cracks, tree collision (would add up to ~225 extra
static bodies live at `VIEW=2` for scenery — not worth it).

**Verified with a headless Chromium session**: `tsc --noEmit`/`eslint`
both clean; multiple 15–20+ second drive sessions (plain and
nitro-boosted) streamed several chunks including a visibly green park
chunk with trees, zero console/page errors. **Independently tracked down
the exact `dpr={1}` render-artifact mystery Milestone 5 left open**: the
hard vertical-split (left half renders normally, right half solid dark)
still reproduces here; directly probed `devicePixelRatio`/canvas buffer
size (both correctly `1`/`1280×800`, ruling the `dpr` theory out for real
this time) and confirmed via `WEBGL_debug_renderer_info` that this
sandbox's headless Chromium runs on `SwiftShader` — software rendering, no
real GPU. The artifact is most likely a software-rasterizer/
`EffectComposer` render-target quirk specific to sandboxed headless
environments, not an app bug — but still not visually re-confirmed on
real hardware, the same open item Milestone 5 first left behind, now with
a concrete lead instead of a guess.

**Files changed:** `components/City.tsx` (facade/glass/tile/tree texture
builders and materials, `Chunk`'s park logic, simplified `Building`, new
`Tree`).

## Milestone 13 — real pedestrians + lighting/color fidelity fix (2026-07-25)

**Goal:** two things the user actually asked for this session — "I don't see
a character in the game" (pedestrians never got ported at all) and "improve
brightness and colors" (night driving reads near-black). Both turned out to
be real gaps against the original, not stylistic choices worth re-litigating.

**Pedestrians are a genuine, previously-dropped gap, now closed.**
Milestone 3 flagged "pedestrians" as not-yet-done and no milestone after it
ever came back for them — not even named in any later "Next up" section.
`components/Pedestrians.tsx` is a real port of the original's system
(index.html ~line 6148-6182, 7591-7632): 44 civilians + 7 cops, each walking
a 72m square loop around a city block (`pedPos()`, ported verbatim — four
straight sides, `s` wraps mod 288), rehomed to a block near the player when
they drift >220m away or would end up in the water (clamped to `ci<=0` so
the loop always stays inside `SHORE_X`, reusing the existing `lib/marina.ts`
constant instead of re-deriving a new one), and panicking (3.2× speed,
double stride frequency) when the player drives past close (<8 units) and
fast (>8 m/s) — all the original's exact numbers. Also ports the original's
ragdoll-on-hit reaction (~line 7333-7357 hit test, ~7591-7610 ragdoll
update): an oriented-box test against the active land vehicle, extended
forward by the frame's travel distance so a fast car can't tunnel through:
hit peds get flung, tumble mid-air, bounce off the tarmac, settle, then
dust off and rejoin traffic after 4.5s. One named simplification: the
original multiplies the shove direction by `Math.sign(v.speed)` so reversing
into a ped flings them backward; `hudStore.speedKmh` is unsigned (the HUD
only ever displays magnitude), so that distinction is dropped — reversing
into someone still ragdolls them correctly, just always shoved forward-
relative-to-heading. Also not ported: the original's `v.speed*=0.9` slowdown
on impact — the car's own speed isn't exposed through any shared singleton
(`worldState` only carries position/heading), and wiring it back from
`Pedestrians.tsx` into three separate vehicle components' internal speed
refs was judged not worth it for a secondary effect.

Walk cycle reuses the same box-figure rig built for the crowd-test scene
below — factored out into `components/PersonFigure.tsx` so both consumers
share one geometry definition instead of two copies drifting apart.

**Lighting had drifted from the original, not just "looked different on
purpose."** `components/SkyCycle.tsx` was missing several real pieces of
the original's actual light setup (index.html ~line 3548-3582,
6993-7040): `renderer.toneMappingExposure` was never set at all (R3F
default 1.0) where the original always runs 1.08-1.26 — a straight
multiplier on the whole final image; a flat `AmbientLight` stood in for the
original's `HemisphereLight` (sky-color-from-above `0xc8e0ff` / ground-
color-from-below `0x3a3020`), which reads noticeably flatter than true
hemisphere lighting; the original's fixed-intensity `fillLight`
(`0x8ab4d8` @ 0.25, from `(-60,40,-30)`) was missing entirely; and the sun
never changed color (original shifts warm-white by day, `0x7d8fc8`
moonlight-blue by night — now ported via a lerp between those same two
colors). `components/Game.tsx`'s bloom was also a static `intensity={0.9}`
where the original rescales it every frame
(`bloomPass.strength=0.18+nightK*0.72` — dim by day so daylight isn't
blown out, full glow at night) — `DynamicBloom` now ports that exact
formula via a ref + `useFrame`, since `@react-three/postprocessing`'s
`<Bloom>` forwards its ref straight to the underlying `BloomEffect`
instance. Kept: the existing sine-phase `dayK`/`nightK` driver instead of
rebuilding the original's true sun-elevation-angle math — same light
values, simpler driver, explicitly deferred rather than scope-creeped into
this pass (the user's own framing: "get the colors from index.html, we can
improve that later"). Road/sidewalk texture colors were checked against
the original and are already pixel-correct (`#23252a` asphalt, `#82868d`
sidewalk, verbatim) — what's still cut is texture *detail* (aggregate
speckle, wheel-path polish, oil stains, cracks, manholes, slab joints,
bump-mapped grain), already named honestly in Milestone 12, unchanged here.

**Side artifact, not part of the migration:** a separate `/crowd-test`
route (`components/CrowdScene.tsx`/`Buildings.tsx`/`Crowd.tsx`,
`lib/buildings.ts`) exists from an earlier unrelated ask this session (500
procedural buildings + 50 walking humans, prompted by an empty/failed
`buffalodataa.geojson` Overpass export). Not wired into the real game.
Worth knowing about: `scripts/optimize-character.mjs` (a checked-in
`@gltf-transform` decimation script, `npm run optimize:crowd`) exists from
an abandoned attempt to use a Mixamo GLB there — the source
`characters/walking.glb` turned out to be a mislabeled 161,634-vertex/
4096×4096-texture asset that crashed WebGL at 50 instances even after
decimation produced an ugly exaggerated-kick pose, so `/crowd-test`'s
walker was switched to the same procedural box-figure approach as the real
pedestrians. `characters/` (the ~440MB FBX/GLB folder) is still untouched,
still not staged/committed.

**Verification status — honest gap, not silently claimed done.**
`tsc --noEmit`/`eslint` clean on every file above. The lighting fix was
visually confirmed live (screenshot comparison at the VENU landmark: road/
sidewalk contrast, sign legibility, and pedestrian visibility all
measurably improved). The ragdoll hit-test was **not** confirmed live —
mid-verification the dev server's HMR left the HUD in a state with no
vehicle panel showing (car speed/name missing after a reload), and the
session was interrupted before root-causing whether that's a real bug or
just an HMR artifact from editing `Game.tsx` while the page was live. Next
session: hard-restart the dev server cleanly (don't rely on HMR surviving
a `Game.tsx`/`SkyCycle.tsx` edit), then actually drive into a pedestrian
and confirm the ragdoll fires.

**Files changed:** `components/Pedestrians.tsx`, `components/
PersonFigure.tsx` (new); `components/Crowd.tsx` (refactored onto
`PersonFigure`); `components/Game.tsx` (`Pedestrians` mount, `DynamicBloom`);
`components/SkyCycle.tsx` (hemisphere/fill lights, sun color, tone-mapping
exposure).

## Milestone 14 — world-scale restore + shore/drowning/pier physics (2026-07-26)

The coastline (`SHORE_X`/`SHORE_CI` in `lib/marina.ts`/`components/City.tsx`)
had been shrunk to `45`/`1` at some point, compressing the whole east side of
the map into a ~95-unit strip and putting the shore right next to VENU. Restored
to the original's real numbers (`SHORE_X=600`, `SHORE_CI=6`), and cascaded the
fix through everything anchored off the old value: `Water.tsx`'s plane, the
EAST MARINA/POLICE HARBOR landmarks, `PoliceStation.tsx`, and the
`policeCar`/`patrolBoat`/`boat` spawn defaults in `lib/vehicleState.ts` — all
shifted by the same delta so they still sit at the (real) shoreline instead of
floating in open water.

Fixed two real bugs found while restoring it: `Boat.tsx` had its old-shore
`x:40` default hardcoded in **two** places (a `pos` ref used every frame, and
a separate `RigidBody` JSX `position` prop) — only one got updated the first
pass, so the boat kept resting on dry land next to spawn. And the on-foot
`Player.tsx` had a doubled-transform bug: its visual `<group>` was a *child*
of the `RigidBody`, which already tracks the body's world position, but the
group's own position was *also* being set to that same absolute position every
frame — doubling the offset from spawn so the character rendered nowhere near
where the camera looked (invisible in practice). Fixed by giving the group a
constant local offset instead.

Added a real coastline: an invisible `VEHICLE_ONLY`-tagged wall (new
`lib/collisionGroups.ts` — group 0 = player, group 1 = vehicle-only geometry)
along the full length of the shore, with a gap at the marina pier that's
closed to cars/bikes but stays open for the on-foot player to walk out and
board the boat. Added a drowning timer to `Player.tsx`: >2s with `x >=
SHORE_X` on foot respawns at `START`. Traffic's fixed lane coordinates
(`Traffic.tsx`) didn't line up with the real road grid (asphalt only runs at
chunk-boundary multiples of `CELL`, i.e. `x/z ≡ 50 mod 100`) — realigned every
lane, including the police patrol lanes onto the police station's new
location.

Also relocated the VENU club exterior itself (`lib/club.ts`'s `CLUB`
constant): it sat at `(-50,-50)`, a road intersection, so the 38×28 building
straddled both streets. Moved to the center of the block one south of spawn,
clear of every road band.

**Files changed:** `lib/marina.ts`, `components/City.tsx` (`SHORE_CI`),
`components/Water.tsx`, `lib/landmarks.ts`, `components/PoliceStation.tsx`,
`lib/vehicleState.ts`, `components/Boat.tsx`, `components/Player.tsx`,
`components/Marina.tsx` (shore wall), `lib/collisionGroups.ts` (new),
`components/Traffic.tsx`, `lib/club.ts`.

## Milestone 15 — real Rapier dynamics, tree collision, redesigned maps (2026-07-26)

Every mover in the game (car/bike/police/player) is a Rapier `kinematicPosition`
body driven by hand-rolled arcade math — real dynamics (forces/impulses/
momentum) were unused anywhere. Added the first dynamic (non-kinematic)
bodies: a fixed pool of knockable props (traffic cones/barrels/crates,
`components/Props.tsx`) that a car physically shoves via the normal contact
solver, plus a pooled debris-fragment system that bursts on a hard crash
(`lib/debris.ts`'s `checkCrashDebris`, wired into `Car.tsx`/`Bike.tsx`/
`PoliceCar.tsx`, drained each frame by `Props.tsx`). The car/bike/police
`computeColliderMovement` calls now pass `QueryFilterFlags.EXCLUDE_DYNAMIC` so
the character-controller's obstacle sweep ignores these props — driving stays
exactly as tuned, a cone just gets knocked aside instead of stopping the car.

Trees (`City.tsx`) were flagged visual-only in the original file header ("no
tree collision — dressing, not an obstacle") — a car could drive straight
through one. Gave the trunk a real `CylinderCollider` (the crown stays
visual-only, matching how a real tree behaves). Also gave trees actual
canopy structure: 5 offset foliage lobes with tint variation instead of one
smooth sphere, plus 2 base-anchored branch stubs bridging trunk to canopy
(the first version centred the branch geometry, which left half its length
going nowhere instead of reaching the canopy — re-anchored to its root so
`scale.y=length` always reaches exactly that far).

Redesigned both maps (`Minimap.tsx`, `BigMap.tsx`): the street grid had been
drawn at chunk *centres* (multiples of `CELL`), a half-block off from where
`City.tsx` actually bakes asphalt (chunk *boundaries*, `x/z ≡ 50 mod 100`) —
landmarks and VENU in particular looked like they sat on the road. Redrawn
with the real grid, every landmark marker clamped to within ±20 of its block
centre so it reads as sitting on the footpath, brighter concrete-block palette,
water past the shore, non-overlapping staggered labels.

Also sharpened the road/sidewalk canvas texture (`buildTileTexture` in
`City.tsx`): canvas antialiases anything drawn at fractional pixel
coordinates, which is what made lane lines/curbs/crosswalks look soft —
snapped every coordinate to whole pixels, quadrupled the bake resolution
(384→1536), and switched the texture to `NearestFilter` + 16x anisotropy so
edges stay hard instead of bilinear-blurring up close.

**Files changed:** `components/Props.tsx` (new), `lib/debris.ts`,
`components/Car.tsx`, `components/Bike.tsx`, `components/PoliceCar.tsx`,
`components/City.tsx` (tree collider/detail, texture sharpening),
`components/Minimap.tsx`, `components/BigMap.tsx`, `components/Game.tsx`
(`Props` mount).

## Milestone 16 — zoned building variety: districts, 8 archetypes (2026-07-26)

The whole city was one archetype — a box, randomly sized, textured from a
shared facade/glass palette. Replaced it with a zoned district system:
`zoneFor(ci,cj)` in `City.tsx` groups chunks into 5x5-chunk (500x500 unit)
districts sharing one of 4 zones (downtown/office/residential/commercial),
hashed deterministically off the district coordinate so it reads as actual
neighbourhoods you drive between, with a ring of downtown districts around
spawn.

Each zone spawns genuinely different structures, not one shape re-tinted:

- **Downtown/office** — sparse (1-3 per block): glass **towers** (parapet cap
  + rooftop antenna), stone **offices** (parapet + rooftop AC units), and a
  residential **high-rise** (10-18 floors) for downtown's mixed-use skyline.
- **Residential** — a block is one of: an **apartment** block (3-5 floors,
  tiled windows + balconies front and back), an attached 3-unit **townhouse**
  row (one shared roofline/collider, but each unit hashes its own wall
  colour/door/windows off its own centre — distinct units within one
  structure), or a uniform **house/hut** row: one template (kind/size/colour)
  picked *once* per block and repeated across a 2x2 grid, so a street reads as
  one colony phase, not 4 independently randomised houses. Houses got real
  detail — door, flanking windows, optional side windows/chimney/porch, all
  hashed off the *block's* anchor coordinate (not each house's own position)
  so a uniform row's features actually match across the row.
- **Commercial** — a 3-shop storefront row, each shop one of 3 structural
  categories (not just a recolour): **retail** (glass storefront + sign),
  **cafe** (retail + a striped awning), or **garage** (auto shop/car wash —
  a real open drive-in bay: the collider only covers the back 2/3 of the
  footprint, so the car can actually pull into the front third and park, with
  a visible dark interior back wall). Every shop gets a readable business-type
  sign (`SHOP_TYPES`, 20 real categories) glued flat to the wall — an earlier
  version wrapped it in `<Billboard>`, which rotates to face the camera while
  the sign board stays fixed to the wall, so from any angle but dead-on the
  text visibly detached from its board; fixed by using a plain fixed `<Text>`
  (buildings never rotate, so nothing needs billboarding). Shop/house walls
  use flat single-colour materials instead of `FACADE_MATS` — that texture is
  a dense window-grid baked for 10+ unit towers, and tiled into a busy
  checkerboard ("mirror buildings") on an 8-unit shop or house wall.
  `FACADE_MATS` is now reserved for actual office/tower/apartment buildings
  tall enough for the texture's repeat scale to read correctly.
- **Every tower/office/apartment** got a ground-floor entrance (dark glass
  double-door + canopy overhang, shared `Entrance` component) — previously
  the facade ran straight to the ground with no way in.

**Files changed:** `components/City.tsx` (districts/zones, `BuildingSpec`,
8 archetype renderers, shop categories, entrances, shop signage).

## Milestone 17 — traffic collision avoidance, road names, poster signage, graffiti (2026-07-26)

Real bug: traffic cars are kinematic bodies driven purely by scripted lane
math with no collider at all — Rapier never resolves kinematic-vs-kinematic
overlap, so a parked player car (or any vehicle) had nothing stopping traffic
from driving straight through it. Added `laneBlocked()` (`Traffic.tsx`): before
advancing its scripted position each frame, a traffic car now checks the live
world position of `vehicleState.car/bike/policeCar` (kept current every frame
by their own components regardless of which is active, so an abandoned parked
car still blocks traffic) against its own lane line, and holds if one is ahead
within a braking distance — direction-aware, so it doesn't stall right after
clearing a car it just passed.

Added GTA5-style road names to the minimap (`Minimap.tsx`): every road line
(`x/z ≡ 50 mod 100`) gets a permanent name from two curated Buffalo, NY street
lists (hashed deterministically off which multiple of `CELL` it falls on, so
the same street always shows the same name), drawn curved along the street and
kept upright as the map rotates with heading.

Redesigned shop signage as an actual baked poster (icon + business name +
worn border on one canvas texture, cached per name/category/colour) instead
of a flat-coloured box with separate floating 3D text — reads as a printed
sign, not two independent objects. Added a category icon (wrench/cup/bag) per
sign. Added spray-paint graffiti decals (`SideGraffiti`) to house/apartment/
shop side walls — ~1 in 4-5 buildings, hashed per-position so it's stable,
using 4 baked transparent-background canvas textures.

**Files changed:** `components/Traffic.tsx` (obstacle check), `components/
Minimap.tsx` (street names), `components/City.tsx` (poster signage, category
icons, graffiti decals, `SIGN_TINTS` extracted from `SIGN_MATS`).

## Milestone 18 — weather, nitro FX, commercial traffic, airport + flyable aircraft (2026-07-30)

**Goal:** a batch of user-requested additions on top of the now-complete
whole-city base (Milestones 1-17) — weather parity with the original, a
visible nitro effect, three background-agent-built additions (commercial
traffic, an airport, flyable planes/helicopters), and a run of small bug
fixes surfaced along the way. Several pieces this milestone were built by
background `sonnet-craftsman` agents rather than directly, per this session's
own workflow — each one's diff was read and checked for bugs before being
folded in here, not taken on faith from the agent's own report.

**Weather ported from the original, with real wet-grip physics.**
`lib/weatherState.ts` (new) is a `WEATHER`/`WEATHER_W`-weighted picker +
`cycleWeather()` (bound to `V`), same shared-singleton pattern as
`skyState`/`worldState`. `components/Weather.tsx` (new) blends fog/background/
hemisphere-light and drives a 500-point rain particle system, deliberately
rendered *after* `<SkyCycle/>` in `Game.tsx` so it blends onto the same-frame
`scene.fog` SkyCycle already set rather than fighting it. `lib/carPhysics.ts`'s
grip formula now multiplies by `weatherState.wetGrip` (replacing a literal
`*1` placeholder) — affects all five vehicle types since they share
`stepCarPhysics`.

**Real nitro flame/exhaust, not just the HUD bar.** `components/NitroFX.tsx`
(new) is a 24-puff particle pool plus a two-cone flame rig with its own
`PointLight`, spawning while boosting, reading `vehicleState.car`.

**Restored the original's `H` key** (hide/show the `#controls` hint panel) —
`hudStore.controlsVisible` + `toggleControlsVisible()`, wired in `Game.tsx`'s
key handler. Hit a real Turbopack/SWC parser bug doing this the obvious way:
`{cond && (<div>...)}` conditional-mount JSX intermittently threw a
persistent "Expected '</', got 'ident'" parse error on the *next* line, even
with `tsc --noEmit` clean and a full cache clear — worked around by using
`style={{display: cond ? "block" : "none"}}` instead of conditional mount,
which doesn't trip the same parser path. Also dropped the `MOUSE pan camera`
and `G map / directions` lines from the displayed panel (redundant/already
known, per direct user ask) — display-only, the actual `G` keybinding in
`Game.tsx` was left untouched and re-verified still working.

**Fixed: player's own headlights stayed visibly lit even toggled OFF.**
`Headlights.tsx`'s shared `HEADLIGHT`/`TAILLIGHT`/`BEAM` materials are
deliberately global (so one `L` toggle doesn't dim an NPC three streets away)
— which meant the player's own car had no way to actually go dark. Added a
`lit` prop threaded `CarMesh` (`Car.tsx`) → `SupercarBody` (`SupercarBody.tsx`),
backed by new static `HEADLIGHT_OFF`/`TAILLIGHT_OFF` materials (never touched
by the day/night loop) and skipping the `BEAM` ground-light mesh entirely
(not just hiding it) when unlit. `StolenAwareCarMesh` now passes
`lit={hud.lightMode !== 2}`; every decorative parked car (MizuRestaurant.tsx)
now passes `lit={false}` so parked cars read as off, not idling.

**Commercial traffic — jeeps/buses/trucks, background agent, reviewed clean.**
`components/CommercialBody.tsx` (new) builds three genuinely different boxy
silhouettes (not a recolour of the sedan wedge) sharing one paint/glass/trim/
wheel material cache; `Traffic.tsx` tags 6 of its lanes with a `kind`, at
speeds slowed relative to their sedan-lane equivalents. Reviewed line-by-line
against `SupercarBody.tsx`'s export surface (confirmed `HEADLIGHT_OFF`/
`TAILLIGHT_OFF` really are module-private, so the local redeclaration was
correct, not an oversight) — no bugs found, `tsc`/lint clean.

**Airport + drivable planes/helicopters — background agent, reviewed clean.**
`components/Airport.tsx` (new): REGIONAL AIRPORT landmark at world
`(-300,100)` (chunk `(-3,1)`, confirmed free of every other landmark's
chunk) — runway, taxiway, apron, helipad, terminal + control tower with a
pulsing beacon, hangar, windsock, one shared `RigidBody` with 3
`CuboidCollider`s. `lib/flightPhysics.ts` (new) is a shared arcade flight
step (`stepFlight` + `PLANE_HANDLING`/`HELI_HANDLING`), same
"function + sibling handling-constant objects" shape as `carPhysics.ts`, but
its own model (vertical axis, ground floor, no tyre grip) rather than reusing
`stepCarPhysics`. `components/Plane.tsx`/`Helicopter.tsx` (new) are
kinematic, direct-integration rigs matching `PatrolBoat.tsx`'s idiom — mount
by walking up + `E` (added to `VehicleKind`, deliberately *not* added to the
`B`-cycle, same precedent as `policeCar`/`patrolBoat`). Reviewed against the
chunk/curb math (confirmed the whole layout fits inside the chunk's drivable
interior, apron/helipad don't overlap the terminal/hangar colliders, parked
`vehicleState.plane`/`.helicopter` coordinates land inside the apron/helipad
shapes) and against `PatrolBoat.tsx`'s own established pattern (confirmed the
RigidBody's initial JSX `position` ignoring a saved position on first mount
isn't a new bug — `PatrolBoat.tsx` has the exact same characteristic, it's
this codebase's accepted pattern for kinematic vehicles, not an oversight) —
no bugs found, `tsc`/lint clean.

**Real bug found and fixed after the user reported it: planes/helicopters
"drove on the road like any other car."** Root cause in `stepFlight`
(`lib/flightPhysics.ts`): the vertical-rate target defaulted to `0` unless
the `climb` key was *explicitly* held, so a grounded plane accelerating with
just `W` never left the ground — it just rolled forward, visually
indistinguishable from driving. Real planes don't need a separate button once
past takeoff speed; added a `mode === "plane"` branch so a grounded plane at
or above `liftMinSpeed` auto-rotates into a climb on its own (real runway
behaviour), while airborne cruise (holds altitude unless climb/descend held)
is unchanged. Helicopters deliberately excluded from the same rule —
`liftMinSpeed=0` means "always fast enough," so the same branch would launch
one the instant it's mounted, at rest, which isn't what "true hover" is
supposed to mean; helicopters still require an explicit `SPACE` to climb,
matching real collective-pitch control.

**In progress as of this writing:** a fourth background agent is scaling the
airport up and adding a security layer, per a follow-up user ask —
multi-chunk clearing around `(-3,1)` in `City.tsx` so the airfield reads as
its own isolated compound rather than sitting inside ordinary block-by-block
sprawl, a bigger runway/apron/terminal/hangar, a perimeter fence + gate, and
2-4 decorative parked police cars (reusing `PoliceCar.tsx`'s exported
`PoliceCarMesh`) near the entrance. Not yet reviewed or folded in — do that
before treating any of it as done.

**Verification status — same honest gap as every prior milestone's flight-
adjacent work.** All of the above is `tsc --noEmit`/lint clean per each
agent's own run (re-confirmed by direct review of the diffs, not taken on
faith), but **nothing in this milestone has been flown, driven, or visually
confirmed in a live browser** — this sandbox's synthetic keyboard-driving
input (`computer{action:"key"}`) doesn't reach the game's real controls (only
simple toggle-style `KeyboardEvent` dispatch via `javascript_tool` reliably
does), so there was no way to actually test drift/turn feel, the new
liftoff behaviour, weather's visual blend, or the commercial vehicles' lane
speeds. All handling constants in `flightPhysics.ts` are first-guess and
named as such in its own header comment — retune once someone actually flies
it.

**Files added:** `lib/weatherState.ts`, `components/Weather.tsx`,
`components/NitroFX.tsx`, `components/CommercialBody.tsx`,
`lib/flightPhysics.ts`, `components/Airport.tsx`, `components/Plane.tsx`,
`components/Helicopter.tsx`.
**Files changed:** `lib/carPhysics.ts` (wet-grip), `lib/hudStore.ts`
(`controlsVisible`, `plane`/`helicopter` `VehicleKind`), `components/HUD.tsx`
(`#controls` display toggle, trimmed legend lines), `components/Game.tsx`
(`H`/`V` keys, new component mounts), `components/Car.tsx`/`SupercarBody.tsx`
(`lit` prop + off-state materials), `components/MizuRestaurant.tsx` (parked
cars pass `lit={false}`), `components/Traffic.tsx` (commercial lane tagging),
`lib/landmarks.ts`/`lib/vehicleState.ts` (REGIONAL AIRPORT + plane/helicopter
entries).

## Milestone 19 — airport security layer: multi-chunk clearing, bigger compound, perimeter fence + gate, parked cruisers (2026-07-30)

**Goal:** fold in the item Milestone 18 left "in progress" — its background
security agent never actually landed any code (the worktree it was meant to
be running in, `.claude/worktrees/agent-af03d7d41032ac852`, diffed identical
to `main`; no task was tracked for it either), so this milestone builds the
security layer directly instead of reviewing someone else's diff.

**Multi-chunk clearing, not a bigger single chunk.** `components/City.tsx`
gained `AIRPORT_CHUNKS` — a 3x3 block centred on the airport's own chunk
`(-3,1)` (`Math.round(-300/CELL), Math.round(100/CELL)`) — added as a fourth
term in `Chunk`'s `isExempt` check alongside the spawn/landmark/club-interior
exemptions. Chunks outside that block still get ordinary buildings right up
to the fence line, so the compound reads as carved out of the city rather
than an oversized landmark chunk. Road-grid ground tiles still render inside
the cleared chunks (the exemption only skips `buildings`/`trees`, per
`Chunk`'s existing logic) — `Airport.tsx`'s own asphalt/apron surfaces sit on
top of that ground plane, same layering every other landmark already uses.

**Runway/apron/terminal/hangar scaled up to fill the new footprint**
(`components/Airport.tsx`): runway 56→100 units, apron 44×26→80×46, terminal
14×9→24×16, hangar 13×11→22×17 — roughly the same proportions, just sized for
a 300×300 compound instead of one 100×100 chunk. The helipad marking moved to
stay clear of the bigger terminal footprint; every other structure kept its
original relative layout (taxiway still connects runway to apron, hangar
still sits east of the terminal).

**Perimeter fence is 4 straight axis-aligned runs, not a generic polygon
walker** — the compound is a plain rectangle, so `FenceWallX`/`FenceWallZ`
just place one long chain-link panel + evenly-spaced posts per side, no
rotation math. A 22-unit gap in the east wall (the side facing the city) is
the gate. Each straight run gets its own `CuboidCollider` (5 total: north,
south, west, and the two segments flanking the gate gap) so a vehicle can
only get in through the opening — verified by hand after catching a sign
error in the first cut of the gap-segment half-extent math (was computing the
wrong side's length; fixed before it ever ran).

**Gate is checkpoint dressing, not a working barrier arm** — two pillars, an
overhead "AIRPORT SECURITY" sign beam, both with their own colliders. No
animated arm: nothing in this build tracks authorized-vs-not, so a barrier
that swings for every vehicle regardless would be a mechanic with nothing to
react to.

**3 parked cruisers posted just inside the gate**, reusing
`components/PoliceCar.tsx`'s `PoliceCarMesh` and
`components/ParkedPoliceJeep.tsx`'s `PoliceJeepMesh` — same
visual-only-no-collider convention `components/PoliceStation.tsx`'s own
fleet lot already established (drive-through dressing, not an obstacle),
not a new pattern invented for this milestone.

**Verified in a real browser, not just compiled.** `tsc --noEmit`/`eslint`
both clean. Rather than physically drive ~380 units from spawn, seeded
`localStorage`'s save slot directly with a vehicle spawned near the compound
and reloaded — confirmed live: the fence line, the gate's two pillars +
sign beam, and the parked cruisers all render at the correct position and
distance relative to the REGIONAL AIRPORT waypoint. Simple `computer{action:
"key"}` presses didn't reach the game's controls in this sandbox (same
finding Milestone 18 already named); raw `KeyboardEvent` dispatch via
`javascript_tool` did, and moved the bike at real speed — but steering back
through the gate itself for a straight-on drive-through shot wasn't nailed
down before wrapping up, so **the gate opening's collider gap has been
verified by hand-checked math and by seeing the compound render correctly
from outside, not by physically driving a vehicle through it on screen.**
Worth a real drive-through check next session.

**Files changed:** `components/City.tsx` (`AIRPORT_CHUNKS`, `isExempt`),
`components/Airport.tsx` (scaled dimensions, `FenceWallX`/`FenceWallZ`/
`PerimeterFence`/`Gate`/`GateGuardPost`).

## Milestone 20 — INTERNATIONAL AIRPORT rebuild: real scale, drivable wide-bodies, gate-access fix, empty field (2026-07-30)

**Goal:** the user's own airport walkthrough surfaced three real problems
with Milestone 18/19's airport — it read as a single small landmark, not a
"huge" international field; every parked aircraft was decoration, only the
one small prop plane and the helicopter were flyable; and it was either wide
open to city traffic or (after the first access fix) effectively unreachable.
This milestone rebuilds the field at real scale and fixes the access model
for real, not by hand-waving.

**The airport is now genuinely huge, not a scaled-up version of the old
single-chunk footprint.** `components/Airport.tsx` was rewritten wholesale:
a 420m runway with real threshold markings/piano-keys/touchdown-zone bars,
edge/threshold/PAPI lights and a 5-bar sequenced approach-lighting "rabbit"
off the 09 end (all `MeshBasicMaterial` emitters, no per-light real lights —
the scene's bloom pass is what makes them glow), a parallel taxiway with 3
connectors, a 470×200m apron, a 300m-long terminal pier with 3 jet bridges
and a real curtain-wall texture, a freestanding 52m control tower with a
rotating radar dish, two 74×62m maintenance hangars (one with its doors
open), a cargo yard with stacked shipping containers, a 3-tank fuel farm,
6 apron floodlight masts, and a 480×480m perimeter fence. `components/
Airport.tsx`'s exempted chunk radius in `City.tsx` grew from a 3x3 to a 5x5
block to match. New `lib/airportTextures.ts` bakes canvas textures for
runway asphalt, apron concrete, corrugated hangar/container steel, and the
terminal's lit curtain wall — same `canvasTex`/`NearestFilter`+anisotropy
idiom `City.tsx` already established, not a new pattern.

**Airliners are now built at real scale, not model-kit scale.**
`components/Airliner.tsx` (new) is a 58m nose-to-tail, 56m-span wide-body
— wings, twin underslung engines, a proper empennage, multi-wheel main
gear bogies — sized so standing under one next to the 1.8m pedestrian rig
reads as standing under a building, matching the user's explicit ask.
Three variants share one model: `livery` (6 paint schemes), `cargo` (swaps
the cabin window strip for a freighter's main-deck door), and `broken` (the
one deliberately un-flyable airframe: missing starboard wing + engine,
scorched skin, canted tail, sat on a jack instead of its right main gear).

**The field is alive, not a parked-car lot.** `components/AirportLife.tsx`
(new): a shared `usePathFollower` hook drives every mover — two wide-bodies
fly a full ~4-minute taxi→takeoff→climb-out→approach→land→taxi circuit
(`circuitKeys`), two freighters taxi a shorter ground-only loop
(`taxiKeys`), and 5 ground-service vehicles (tug, baggage train, fuel
bowser, stairs truck, catering lift, pushback tractor — each its own boxy
model, `WorkVehicleMesh`) run their own apron circuits. The broken jet's
maintenance bay (`BrokenJet`) has its removed wing and engine laid out on
trestles/stands, 3 scaffold towers with ladders, 2 flickering welding-arc
point lights, and a small fixed repair crew — the only humans anywhere on
the field, and the one place it was always meant to have people (see
below).

**Every parked wide-body is now a real vehicle, not a static prop —
the actual point of this milestone.** New `components/DrivableAirliner.tsx`
generalizes `Plane.tsx`'s kinematic-body/walk-up-and-`E` rig over an `id`,
so one component drives all 4 mountable airframes (`airliner1`/`2`/`3` at
the terminal's 3 gate stands, `airlinerCargo` on the cargo apron) —
`lib/hudStore.ts` gained a new `AirlinerId` union folded into `VehicleKind`,
`lib/vehicleState.ts` gained their parked coordinates (derived directly from
`Airport.tsx`'s own gate/cargo-apron layout constants, not guessed), and
`lib/flightPhysics.ts` gained `AIRLINER_HANDLING` — heavy and slow to turn
(`turnRate` a quarter of the small plane's), needing a real ~110m takeoff
roll before `liftMinSpeed` (26 m/s) lets it climb, well inside the new
420m runway. Mounting one is identical to mounting the existing small
plane/helicopter: walk up, press `E`. The broken jet is the deliberate
exception named directly in the user's own ask ("unless it's broken or
under construction") — it has no `vehicleState` entry and no mount trigger
at all, by construction, not by a runtime check.

**Real bug found and fixed: the airport was reachable by ordinary city
traffic with zero collision.** The user reported cars driving straight into
the compound and back out "without any touches." The gate gap in Milestone
19's perimeter fence had no collider at all — open to everything. Fixed by
adding one `CuboidCollider` across the gap tagged `VEHICLE_ONLY`
(`lib/collisionGroups.ts`) — the same interaction-groups trick
`Marina.tsx`'s shore wall already uses to block cars/bikes/traffic while
staying invisible to the player's own on-foot collider (verified against
Rapier's actual bitmask rule: `VEHICLE_ONLY`'s membership bit doesn't
intersect the player collider's filter bits, so the math guarantees a
pedestrian passes through regardless of gap width). NPC `Traffic.tsx` never
reaches the airport's coordinates in the first place (its lanes are all
within ±85 units of spawn), so this specifically stops the player's own car
from driving in and stops nothing else from working.

**Second real bug, found only after re-testing the first fix live: the
gate itself was unfindable.** Sealing vehicles out is only correct if a
pedestrian can actually *find* the opening — the first pass left the gate a
28m gap floating mid-block in a 480m wall, off any road, which is why "make
sure the player can get in" kept failing in live testing even after the
collider fix was correct. Moved the gate to `GATE_CZ = -50` (world z = 50),
a real road centreline (`components/City.tsx`'s grid puts asphalt at
`x/z ≡ 50 mod 100`), and widened it to 60m. A car now drives straight up to
the gate on the city's own road grid, hits the `VEHICLE_ONLY` wall, and has
to U-turn — exactly the "take a U-turn... but not inside" behaviour asked
for, achieved by routing, not a special-cased block. The 3 decorative
parked cruisers (`GateGuardPost`) moved to flank the new gate position.
**Verified live, not just by code review**: drove a car up to the new gate
and confirmed it stops dead at the fence line (speed drops and stays
pinned across repeated throttle, several real physics frames apart);
dismounted with `E` and walked the same path on foot, confirmed reaching
the interior grass/apron with a parked airliner visible ahead, past where
the car had been stopped.

**Third real bug: ordinary city pedestrians could wander onto the runway.**
Not just the airport's own added crew — `components/Pedestrians.tsx`'s
civilian spawn range (`ci` -3..0, `cj` -3..3) and its rehome-near-the-player
logic both happen to cover the airport's exact chunk block, and neither
knew the airport existed. A civilian rehoming while the player is anywhere
near the field would land inside the fence, on foot, past the same
`VEHICLE_ONLY` wall that (correctly) doesn't apply to them. Exported
`AIRPORT_CHUNKS` from `City.tsx` and added a small retry-until-clear helper
(`pickCityBlock`) to both `Pedestrians.tsx` call sites (initial spawn and
rehome) so no ordinary civilian or beat-cop NPC ever picks an airport
block. Combined with removing every ambient NPC `Airport.tsx` itself used
to place (guard patrols, terminal foot traffic, per-gate ground crew), the
field's only people are now the fixed repair team in the maintenance bay —
matching the user's explicit "I want no one inside" (with that one named,
deliberate exception, since it's the working scene they asked for
directly).

**Fourth real bug: a genuine glitch, not a perception issue — bank angle
spiked on frame-rate variance.** `AirportLife.tsx`'s `usePathFollower`
originally derived each mover's roll from `(this frame's heading change) /
(this frame's dt)` — mathematically reasonable at a constant frame rate, but
a stutter (more likely now that the airport renders far more geometry than
before) spikes the estimate and snaps the roll visibly. Replaced with a
frame-rate-independent estimate: sample the path's own heading at two fixed
points in *path time* (0.35s apart, both derived from `s.clock.elapsedTime`
directly, not from how long the last frame took) and smooth toward that at
a normal fixed rate. Every mover on the field (both circuit airliners, both
taxiing freighters) uses this same shared function, so this is a real,
global smoothness fix, not a per-instance patch.

**Not done this milestone, named honestly:** a broader draw-call/perf pass
was requested ("optimize so planes run smoothly") but only the bank-angle
correctness bug above was actually fixed — geometry segment counts in
`Airliner.tsx` are still uninstanced/un-reduced (each aircraft is ~70+
individual meshes: fan blades, gear, fairings), and the runway/taxiway/
approach light spheres and cargo containers in `Airport.tsx` are still one
draw call each rather than `InstancedMesh`. With up to 9 aircraft instances
live at once this is the field's real remaining performance cost and the
next thing worth profiling before adding more per-aircraft detail.

**Files added:** `components/Airliner.tsx`, `components/AirportLife.tsx`,
`components/DrivableAirliner.tsx`, `lib/airportTextures.ts`.
**Files rewritten:** `components/Airport.tsx` (real scale, textures,
lighting, drivable-vehicle wiring, gate relocation).
**Files changed:** `components/City.tsx` (5x5 `AIRPORT_CHUNKS`, exported for
`Pedestrians.tsx`), `components/Pedestrians.tsx` (`pickCityBlock` airport
exclusion), `lib/hudStore.ts` (`AirlinerId`, `VEHICLE_NAMES`),
`lib/vehicleState.ts` (4 new parked-airliner entries), `lib/flightPhysics.ts`
(`AIRLINER_HANDLING`), `lib/landmarks.ts` (REGIONAL → INTERNATIONAL
AIRPORT), `components/Game.tsx` (mounts the 4 `DrivableAirliner`s),
`components/Helicopter.tsx` (`HeliMesh` exported, reused for parked
decorative helis).

## Milestone 21 — three small fixes off Milestone 20's own "Next up" list (2026-07-31)

**Goal:** Milestone 20 closed with a long list of named-but-not-done items.
This picks off the three that were genuinely small and well-scoped rather
than the big ones (airport perf pass, live flight-testing the new
handling numbers) — real code, not more testing.

**BigMap now has street names, same source as Minimap.** `Minimap.tsx` had
a pure `streetName(coord, axis)` function + two name lists, naming every
road deterministically; `BigMap.tsx` drew the identical road grid with no
labels at all. Extracted both into new `lib/streetNames.ts` so the two
maps import one canonical source instead of (as it would have been) two
copies that could drift — a road shows the same name on both maps by
construction. `BigMap.tsx` is fixed north-up and never rotates, so its
version skips all of `Minimap.tsx`'s upright-angle math; it just draws each
label flat along its road (vertical roads rotated 90°, horizontal roads
plain). Verified live: opened the map, every visible road on both axes is
labeled and matches the minimap's names for the same streets.

**The car itself now loses speed when it hits a pedestrian.**
`Pedestrians.tsx` already had the full ragdoll + hit-test port; the
original's `v.speed*=0.9` on the vehicle's own side, fired in the same beat,
had never been ported. The wiring problem: `Pedestrians.tsx` has no way to
reach into `Car.tsx`/`Bike.tsx`/`PoliceCar.tsx`'s own component-local speed
refs directly. Added `lib/pedestrianHit.ts` — a one-shot signal in the same
shape as the existing `lib/playerTeleport.ts` (set by the component that
detects the event, consumed-and-cleared by the interested component on its
own next frame) — set the instant a hit registers, consumed by whichever
land vehicle is actually driving at the same spot each of the three already
calls `checkCrashDebris`.

**Aircraft mount-hint is now a real 3D distance, not x/z only.** The named
bug: a plane/helicopter flying overhead reads as "in range, press E" from
directly underneath on the ground. Root cause was that nothing tracked
altitude anywhere — `vehicleState` was typed `{x,z,h}` only, and
`worldState` had no `y` at all. Added `y?: number` to `vehicleState` (only
`Plane.tsx`/`Helicopter.tsx` ever write it, next to their existing x/z/h
writes each frame; every other vehicle stays close enough to ground/water
level that a missing `y` defaulting to 0 is correct) and `py` to
`worldState` (written by `Player.tsx` on foot, next to its existing
px/pz/heading write). `lib/player.ts`'s mount scan now compares
`dx²+dy²+dz²` against the same `MOUNT_RADIUS2` instead of `dx²+dz²`.

All three: `tsc --noEmit` and `eslint` clean, `next build` green.

## Milestone 22 — commercial vehicles, water-boundary hardening, airport relocation + patrols, the debris system, VENU redesign, sunny weather (2026-07-31)

**Goal:** A long user-driven session mixing reported bugs (tyres floating
exposed, cars driving into the sea, traffic ghosting through pedestrians,
gate-guard vehicles being pure decoration) with requested features
(steal-and-drive commercial traffic, a marina boat lot, moving the airport
away from VENU, a premium VENU exterior, sunny weather with real
reflections).

**Tyres no longer float exposed below the body.** `SupercarBody.tsx`'s and
`CommercialBody.tsx`'s fender flares only ever covered the top third of each
wheel — the rocker skirt ran *between* the wheels, not over them, so the
lower two-thirds of every tyre had no bracketing geometry at all and read as
detached, hanging in front of the car. Added wheel-arch liner panels per
corner (`SupercarBody.tsx`) and a shared `WheelArch` helper
(`CommercialBody.tsx`, scaled off each wheel's own radius so it fits the
jeep/bus/truck's very different tyre sizes).

**Nitro locks out on empty until fully recharged.** `Car.tsx`'s
`nitroLocked` ref: hitting 0 sets a locked flag that only clears once fuel
is back at `NITRO_MAX`, so tapping SHIFT on a half-full tank right after
running dry no longer restarts the boost.

**A real boat lot at EAST MARINA.** `Boat.tsx` generalized to take
`kind`/`spawn` props; two more moored hulls (`boat2` "HARBOR SKIFF", `boat3`
"MARINA CRUISER") sit alongside the original. `lib/boatSwap.ts`'s
swap-while-driving logic — previously hardcoded to "the one other boat" —
now does a nearest-of-`BOAT_KINDS` scan since there are 4 hulls, not 2.

**Traffic finally has real colliders — the actual "drove right through a
commercial car" bug.** `Traffic.tsx`'s `TrafficCar` `RigidBody` had
`colliders={false}` and never added a real `CuboidCollider` at all, for
every lane including plain sedans. Added a per-kind collider
(`colliderBoxFor`) plus a length-scaled `STOP_DISTANCE` so a bus/truck
doesn't visually clip through whatever it's braking for.

**Jeep/bus/truck are real driveable vehicles, not sedan reskins.**
`lib/steal.ts` unconditionally mapped every non-police lane to `"car"` —
stealing a bus silently handed you a repainted sedan. New
`components/CommercialVehicle.tsx` (the `Car.tsx`/`PoliceCar.tsx` drive-rig
pattern, generalized over `kind`) plus per-kind handling presets
(`JEEP_HANDLING`/`BUS_HANDLING`/`TRUCK_HANDLING` in `lib/carPhysics.ts`),
amber mirror-mounted beacons on `CommercialBody.tsx`, and per-kind
cockpit-camera offsets (`lib/cameraRig.ts`'s new optional
`cockpitEyeHeight`/`cockpitForward` params, defaults unchanged for every
existing caller).

**Water boundary: root cause, then a hard backstop.** The marina's
pier-gap collider reused `VEHICLE_ONLY` — a tag specifically designed to
let the *player's own* vehicle pass through it (that's the exact mechanism
that lets the car through the airport gate while blocking traffic/police) —
so it was never actually going to stop a player-driven car reaching the sea
through that one gap. Added a second group,
`VEHICLE_BODY_GROUPS`/`WATER_BOUNDARY` (`lib/collisionGroups.ts`), that
blocks every player-driven land vehicle while staying invisible to the
on-foot player. Live nitro-speed testing then found the character
controller's own slide-along-a-wall sweep can still be beaten by a hard
enough, fast enough hit — so also added `lib/marina.ts`'s
`clampFromWater()`, a plain numeric position clamp applied every frame in
`Car.tsx`/`Bike.tsx`/`PoliceCar.tsx`/`CommercialVehicle.tsx` right after
physics has already moved the vehicle, as a collider-independent guarantee
that can't be defeated by any sweep/CCD edge case.

**Airport moved 450m west.** It read as sitting right next to VENU. `AX`/`AZ`
in `Airport.tsx` are the single anchor the whole structure hangs off (one
`<group position={[AX,0,AZ]}>` wrapper), but three *other* files
independently hardcoded the same `-300/100` pair instead of importing it:
`City.tsx`'s `AIRPORT_CENTER_CHUNK` (the building-exclusion carve-out),
`lib/landmarks.ts`'s map entry, `lib/vehicleState.ts`'s
plane/helicopter/policeJet/airliner1-3/airlinerCargo spawn points, and
`components/Traffic.tsx`'s `AIRPORT_MIN` clamp + perimeter-patrol lane
bounds. All four translated by the same delta.

**The airport's 3 gate-guard vehicles patrol instead of sitting still.**
They started as pure decoration (`PoliceJeepMesh`/`PoliceCarMesh` rendered
as bare meshes, "no physics rig" by original design). First pass made them
real parked/driveable vehicles (new `components/PoliceJeep.tsx`,
`PoliceCar.tsx` generalized with a `kind` prop); on the user's follow-up ask
they were upgraded again into 3 real `Traffic.tsx` patrol lanes (2
interceptor, 1 security jeep) confined inside the fence, steal-able exactly
like any other police lane — the static parked-only versions were removed
once the lanes made them redundant. The 2 interceptor lanes share the
existing single `"policeCar"` identity (same as every other police lane in
the game); the jeep gets its own `"policeJeep"` identity since it's a
visually distinct body.

**Traffic no longer ghosts through pedestrians — and crash debris is
actually visible for the first time.** Two separate, related gaps found
while chasing the user's "why are these cars able to drive past the
humans" report: (1) `Pedestrians.tsx`'s ragdoll/hit-test only ever checked
the *player's own driven vehicle* (and its `LAND_VEHICLES` set was still
missing `jeep`/`bus`/`truck`/`policeJeep` entirely) — AI traffic never
looked at pedestrian positions at all. Added
`components/Pedestrians.tsx`'s `pedestrianPositions` (a live per-pedestrian
position array, same shared-singleton pattern as `vehicleState`), consumed
by `Traffic.tsx`'s `laneBlocked()` alongside real vehicles, so a lane car
now brakes for someone standing in the road. (2) `lib/debris.ts`'s
`spawnDebris()`/`checkCrashDebris()` have been called since early
milestones with nothing ever draining `debrisQueue` —
`components/Debris.tsx`, referenced in that file's own comments, never
actually existed. Built it: a pooled, manually-integrated fragment burst
(same idiom as `NitroFX.tsx`'s puffs / `Pedestrians.tsx`'s ragdoll, not real
Rapier bodies), mounted in `Game.tsx`. `Traffic.tsx` also now fires a burst
itself on the rising edge of `laneBlocked` (any lane car braking hard for an
obstacle), which is what makes the airport's new police patrols show a
visible collision effect.

**VENU rebuilt as a premium-club exterior.** Was a plain neon box. Now: the
building grew wider and deeper (front face pinned at the same world z the
door/hint distance checks in `lib/club.ts` already assume, so nothing about
entering/exiting VENU had to change), an asymmetric folded-shard black
roofline over the entrance with a backlit vertical-wood-slat soffit texture
(canvas-baked, tiled) and a brushed-panel noise texture on the black facade,
full glass frontage with mullions and a warm interior glow, front steps,
potted plants, two bouncers (`PersonFigure` reused statically), a red
carpet with velvet-rope stanchions, and a marked parking lot.

**Sunny weather.** New `WEATHER` kind alongside clear/overcast/rain/fog/snow.
A visible sun disc (a glow sprite fixed at the same angle as `SkyCycle.tsx`'s
directional light, so it doesn't visually disagree with where the light
actually comes from), a real specular-reflection environment map
(`lib/skyEnv.ts`, `PMREMGenerator`-baked once and set as `scene.environment`,
faded via `scene.environmentIntensity`) so car mirrors/glass/water genuinely
reflect the sky, a sunny pass on the existing weather-coat shader
(`lib/weatherCoat.ts`'s `uSunnyAmount` — lower roughness plus a metalness
bump on upward faces, same masked-to-upward-faces trick the wet/snow passes
already use) for a general sunlit glint on paint/road/rooftops, and a
boosted, warmed version of the actual sun light itself.

Verified live in-browser for every piece in this milestone (tyre arches,
nitro lockout, boat lot, traffic collider stop, jeep/bus/truck steal-and-
drive, the water boundary at both normal and nitro speed — including the
nitro-speed exploit that forced the `clampFromWater` backstop — airport
relocation (and the stale-localStorage-save gotcha that made the first
check look broken), gate-vehicle patrol + steal, a debris burst on a wall
ram, the new VENU frontage, sunny weather cycling); `tsc --noEmit` clean
throughout.

**Files added:** `components/CommercialVehicle.tsx`, `components/PoliceJeep.tsx`,
`components/Debris.tsx`, `lib/skyEnv.ts`.
**Files substantially rewritten:** `components/Club.tsx` (full exterior),
`components/Weather.tsx` (sunny pass), `lib/collisionGroups.ts` (new
groups), `lib/marina.ts` (`clampFromWater`).
**Files changed:** `components/Airport.tsx` (`AX`/`AZ`, `GateGuardPost`
removed), `components/Bike.tsx`/`Car.tsx`/`PoliceCar.tsx`
(`VEHICLE_BODY_GROUPS`, `clampFromWater`), `components/Boat.tsx`
(`kind`/`spawn` props), `components/City.tsx` (`AIRPORT_CENTER_CHUNK`),
`components/CommercialBody.tsx` (`WheelArch`, mirror beacons),
`components/Game.tsx` (new mounts), `components/ParkedPoliceJeep.tsx`
(`lightRefs` prop), `components/Pedestrians.tsx` (`pedestrianPositions`,
`LAND_VEHICLES`), `components/SupercarBody.tsx` (wheel arches),
`components/Traffic.tsx` (colliders, pedestrian obstacles, debris, 3 new
patrol lanes), `lib/boatSwap.ts`, `lib/cameraRig.ts` (cockpit offset
params), `lib/carPhysics.ts` (3 new handling presets), `lib/hudStore.ts`
(new `VehicleKind`s), `lib/landmarks.ts`, `lib/steal.ts` (kind-aware
mapping), `lib/vehicleState.ts`, `lib/weatherCoat.ts`, `lib/weatherState.ts`.

## Milestone 23 — Phase A: draw-call/perf pass, airport + city trees (2026-08-03)

**Goal:** the two items named in "Next up" Phase A — the airport's
never-done perf pass (flagged as far back as Milestone 20) and a city-wide
draw-call pass now that Milestones 16-18 add meaningfully more meshes per
chunk.

**Airport: `InstancedMesh` for the four categories named in Milestone 20's
own gap list.** `components/Airliner.tsx`'s `Engine()` had 18 separate
`<mesh>` fan blades; now one `FanBlades` `InstancedMesh` per engine (static
local-frame matrices, set once via `useEffect`) — up to 9 aircraft x 2
engines was ~288 draw calls, now ~16. `components/Airport.tsx`'s runway
white/green/red edge+threshold lights (~58 spheres), taxiway blue edge
lights (22 spheres), and cargo-yard containers (~32 boxes, bucketed by their
5 paint colours) all moved to a shared `InstancedStatic` helper the same
way — positions precomputed once at module scope from the existing
dimension constants, matrices written once on mount. The approach-lighting
"rabbit" (25 spheres, 5 bars x 5 lights) needed to keep animating, so it's
one `InstancedMesh` with `vertexColors: true`, recoloured per-instance via
`setColorAt` in `useFrame` instead of swapping 5 shared materials across 25
meshes. PAPI (4 boxes) left as plain meshes — too small to bother.

**City: trees, the single largest repeat-geometry cost by a wide margin.**
`components/City.tsx`'s per-tree `Tree()` rendered 8 separate meshes (trunk
+ 2 branches + 5 crown lobes) — at ~75-100 trees live at `VIEW=2` (per the
file's own shadow-pass comment), that's 600-800 draw calls for trees alone.
Replaced with `Trees({ specs })`, rendering one chunk's whole tree set via
the project's own established `<Instances>`/`<Instance>` pattern (already
used for apartment windows/balconies, not a new technique): trunk and
branches each always share one material regardless of tree, so they
collapse straight to 2 `<Instances>`; crown lobes pick one of 9 `CROWN_MATS`
(`matIdx*3+tint`), so they're bucketed by material into up to 9 more — still
a hard ceiling of ~11 draw calls for however many trees are in the chunk,
down from 8-per-tree. Per-tree colliders (`RigidBody`+`CylinderCollider`)
are unchanged, one per tree, since Rapier bodies aren't part of the
draw-call cost this pass targets. Math (positions/rotations/scales) ported
1:1 from the deleted `Tree()` — same `hash2` jitter, same lobe/branch
formulas — visual result is unchanged, only how it reaches the GPU changed.

**Verification, and an honest gap.** `tsc --noEmit` and `eslint` both clean
on every changed file (one pre-existing unrelated warning in `Airport.tsx`,
confirmed via `git stash` to predate this session). No new console or dev-
server errors on a clean `.next` rebuild + fresh tab load, checked against
this session's embedded browser tool specifically because it turned out to
matter: **this sandbox's Browser pane cannot render a visible frame at
all** — `document.hidden` reports `true` even on the tool's own "active"
tab, so Chromium throttles the R3F render loop's `requestAnimationFrame` to
zero (`WebGL2RenderingContext.prototype.drawElements`/`drawElementsInstanced`
call counts confirmed at 0 over a real time window). Confirmed this is not
a regression from this session's diff: reverted to the unmodified
pre-Milestone-23 code via `git stash` and reproduced the identical black
canvas / zero draw calls before restoring the changes. This is a different
symptom of the same class of sandbox limitation Milestones 5/12/13 already
named (that one was software-rendering artifacts via SwiftShader; this one
is the embedding tool never granting the tab real OS-level focus) — the dev
server at `localhost:3000` renders normally in a real browser outside this
tool, which is the recommended way to actually eyeball this milestone's
result.

**Follow-up, same session: chunk-boundary flinch at speed — confirmed
pre-existing, not caused by the InstancedMesh work above, but real and
fixed.** The user reported the car/camera visibly pausing-then-snapping
while driving fast, then confirmed via direct question that it did this
before today's changes too. Root cause was already half-diagnosed in
`City.tsx`'s own comment: crossing a chunk boundary mounts new buildings'
RigidBodies/colliders (and now `Trees`'s `InstancedMesh` buffers) — already
throttled to `ADD_PER_FRAME=2` chunks per frame on the *add* side, but the
*remove* side dropped every now-stale chunk in one uncapped commit, on the
comment's own now-inaccurate assumption that "unmount is cheap." A diagonal
boundary crossing can go stale on up to 9 chunks at once (an L-shape of the
5x5 `VIEW` window), each disposing Rapier colliders and `InstancedMesh` GPU
buffers synchronously — that uncapped side was the real remaining hitch.
Fixed by queuing removals through the same per-frame-batch mechanism as
additions (`pendingRemove`, mirrors `pendingAdd`), so both sides drain at
`ADD_PER_FRAME` chunks/frame — the chunk set is briefly a superset of the
ideal window while both queues empty, never a shrunk-then-grown one. One
subtlety caught before it shipped: the first draft peeked at the live
`chunks` state directly from the `useFrame` closure to compute the
add/remove queues, which reintroduces the exact same-tick staleness the
file's own existing dedupe comment warns about (`useFrame` runs outside
React's batched-event context). Fixed by peeking through `setChunks`'s
functional-update form instead (returns the same array reference, a no-op
commit) — guaranteed-fresh `cur` without an early, premature state change.
`tsc`/`eslint` clean, no new console/server errors on a clean rebuild — same
sandbox-can't-render caveat as everything else in this milestone applies;
whether it actually feels smoother needs the user's own browser.

**Files changed:** `components/Airliner.tsx` (`FanBlades`), `components/
Airport.tsx` (`InstancedStatic`, `RUNWAY_WHITE_LIGHT_POS`/`_GREEN_`/`_RED_`,
`TAXI_BLUE_LIGHT_POS`, `APPROACH_LIGHT_*`, `CARGO_CONTAINER_*`, rewritten
`RunwayLights`/`TaxiwayMarkings`/`ApproachLights`/`CargoYard`), `components/
City.tsx` (`Trees` replaces `Tree`; `City()`'s chunk streamer gained
`pendingRemove` to throttle removals same as additions).

## Milestone 24 — I-94 sea bridge + FORT NEON military base (2026-08-03)

**Goal:** a new landmark pair asked for directly — an elevated highway with
a real drivable ramp, and a heavily-secured military base (tanks,
helicopters, patrolling personnel/vehicles, jet flyovers) — with one hard
constraint stated explicitly after the first pass got it wrong: the whole
thing had to sit far from every existing landmark, out over the sea,
reachable only by crossing the bridge. The first build put both inland,
just north of downtown; corrected to a real sea crossing once that was
called out.

**I-94 is a single-ramp sea bridge, not a symmetric inland overpass.**
`components/Highway.tsx`: one sloped `RigidBody`+`CuboidCollider` ramp
(`lib/highway.ts`'s `RAMP_X0`→`RAMP_X1`, solid ground, real city chunks)
climbs to `DECK_H`=9m, then a flat deck runs 950m straight east
(`DECK_X0`→`DECK_X1`) over open water — `components/Water.tsx`'s plane
already covers everything past `LAND_EDGE_X`=550 — ending flush against
FORT NEON's own platform, at the same height, no second ramp down (there's
no ground out there to ramp down to). The ramp is one tilted collider, not a
discrete step: `run`/`rise`→`atan2` gives the tilt angle, `run/cos(theta)`
the true slope length, so the existing `KinematicCharacterController`
climbs it the same way it climbs any sloped/uneven collider — no special-
cased "is this a ramp" branch anywhere in `Car.tsx`/`Bike.tsx`/etc, same
"solid geometry, not a height-hack" call `components/Marina.tsx`'s pier deck
already made for a flat surface. Only the ramp's own footprint (chunks
ci=4-5) needed a `City.tsx` exemption (`HIGHWAY_CHUNKS`) — everything past
ci=6 is open water `City.tsx` already skips generating chunks for.

**FORT NEON sits on its own platform out over open water — it has no
natural ground the way `components/Airport.tsx` gets for free from a real
city chunk.** `lib/militaryBase.ts`'s `BASE_X` is the bridge's own `DECK_X1`
plus the compound's half-width, so the platform's gate wall lands exactly
flush against the deck — drive off the bridge straight through the gate.
`components/MilitaryBase.tsx`'s `Platform()` is a real full-footprint
`RigidBody`+`CuboidCollider` (there being nothing else to stand on out
there), plus decorative support pylons reaching down toward the waterline
so it reads as a built structure and not a slab floating in air. Two real
bugs caught before shipping, both from copying the airport's own gate
convention without checking it still applied: (1) the gate's `GATE_CZ`
started at -50 (the airport's own "land on a city road centreline" offset)
— meaningless here since there's no road grid, and it put the gate 13-26
units off the bridge's actual centreline, so a car crossing the bridge
would have hit solid wall instead of the opening; fixed to `GATE_CZ=0`,
which *is* the bridge's centreline since `BASE_Z` is defined equal to
`HWY_Z`. (2) The mountable tank's `TANK_GROUND_Y` was defined as
`PLATFORM_Y + 0.55` for the world-space drivable rig, but the tank yard's
*decorative* `ParkedTank`s render inside `MilitaryBase.tsx`'s own group
(already offset by `PLATFORM_Y`) — reusing the same constant there would
have doubled the offset, floating every parked tank ~9m above the platform.
Split into two: the drivable `Tank()` keeps the full world-space constant,
`ParkedTank` uses a bare local ride height instead.

**Everything else reuses existing patterns rather than inventing new
ones:** solid precast-look walls + barbed-wire trim (same technique
`components/Airport.tsx`'s chain-link fence uses, heavier materials), 4
corner guard towers with a posted `PersonFigure` guard each, a hardened
gate with a checkpoint booth + "RESTRICTED AREA — DEADLY FORCE AUTHORIZED"
signage + a `VEHICLE_ONLY` gap (`lib/collisionGroups.ts`) identical to the
airport's own walk-in-only design — a car hits the wall, a pedestrian walks
through, then can steal a tank or chopper off the yard. `components/
Tank.tsx`'s `Tank`/`TankMesh` are a new mountable `VehicleKind`
(`TANK_HANDLING` in `lib/carPhysics.ts`: slow, heavy, near-zero slide,
turret+barrel fixed forward — "drive a tank," not "operate a turret," a
materially bigger control scheme that wasn't asked for) built by copying
`components/PoliceJeep.tsx`'s drive-rig template directly. Parked
`ParkedTank`s fill out the tank yard using the same mesh. Choppers reuse
`components/Helicopter.tsx`'s `HeliMesh` wholesale — gained one optional
`bodyMat` prop (defaults to the existing civilian orange-red, every other
caller unaffected) so the base's parked-and-patrolling choppers can wear
olive drab instead. The fighter-jet flyover (`components/FighterJet.tsx`,
new `FighterJetMesh`) and the patrol chopper's low loop both reuse
`components/AirportLife.tsx`'s `usePathFollower` (newly exported) — the
same keyframed-path/bank/pitch driver the airport's circling airliners
already use — rather than a second copy of that math. The jet is
deliberately **not** mountable: the ask was jets "flying over it," and a
fighter's flight envelope doesn't fit `lib/flightPhysics.ts`'s arcade-
airliner model without its own tuning pass. `components/Pedestrians.tsx`
needed no equivalent of the airport's `pickCityBlock` exclusion — the base
sits entirely past the point where ordinary civilians' spawn/rehome range
(real city land chunks) ever reaches, unlike the airport which sits on
real, reachable land.

**Verification, same honest caveat as Milestone 23.** `tsc --noEmit` and
`eslint` both clean across every new/changed file, no new console or dev-
server errors on a clean `.next` rebuild + fresh-tab load. This session's
embedded Browser pane rendered pixels inconsistently across attempts
(`document.hidden` flips between `true`/`false` run to run, independent of
anything in this diff — same underlying tool limitation named in Milestone
23) — got one clean screenshot of the bridge/ramp structure mid-build (before
the coordinates were corrected to the sea-crossing layout), but the
corrected FORT NEON-on-a-platform layout has **not** been visually
confirmed on screen, only verified by hand-checked coordinate math (which is
exactly what caught the two bugs above). Worth a real look in an actual
browser before trusting the gate alignment/platform height fully.

**Three more real bugs, all caught from the user actually driving it** (the
first real-hardware test this milestone got, and it found things hand-
checked math didn't): (1) `components/BigMap.tsx`'s world-view was a
hand-picked fixed box (`WX0=-260, WX1=620, WZ0=-320, WZ1=320`) — FORT NEON
at (1670,-400) fell miles outside it, so its pin silently never rendered on
the map canvas (the destination list still worked). Turned out
INTERNATIONAL AIRPORT at x=-750 had the exact same bug already, unnoticed
until this prompted a look. Fixed by deriving the bounds from `LANDMARKS`
itself (min/max + margin) instead of a hardcoded box that goes stale every
time a landmark is added — can't happen again. (2) The ramp's `RigidBody`
was positioned at its *centre* height, but a tilted box's centre and its
top face land at different world heights once rotated — the top surface
actually sat ~0.8 units above the ground at the ramp's low end, a real
step, not a ramp; tall enough that Car.tsx's character controller (no
autostep configured, `enableSnapToGround(0.4)` alone doesn't cover a full
unit) simply couldn't get onto it. Reported as "the ramp is too high, the
car can't even get on it" — fixed by solving for where the box's centre
must sit so its top face, not its centre, passes through (xA,0) and
(xB,DECK_H) exactly. (3) `lib/marina.ts`'s `clampFromWater()` — a hard
numeric backstop that runs on every land vehicle every frame — clamps x
back to the coastline (≤550) unconditionally, with zero awareness the
bridge/base now legitimately extend past it, and with no elevation check
at all. Reported as "stuck mid-ramp, can't go forward" — the car's x was
being yanked back to 550 every single frame regardless of being up on the
elevated deck. Fixed by skipping the clamp entirely inside the bridge
corridor or the base's footprint (small margin), leaving the original
coastline clamp intact everywhere else. All three: `tsc`/`eslint` clean, no
new console/server errors — not independently re-confirmed on screen after
the fix (the user was mid-test in their own browser when these were
reported and fixed), so worth another real drive to confirm each one.

**Files added:** `lib/highway.ts`, `lib/militaryBase.ts`, `components/
Highway.tsx`, `components/MilitaryBase.tsx`, `components/Tank.tsx`,
`components/FighterJet.tsx`.
**Files changed:** `components/City.tsx` (`HIGHWAY_CHUNKS` exemption),
`components/BigMap.tsx` (bounds derived from `LANDMARKS` instead of a
hardcoded box), `lib/marina.ts` (`clampFromWater` exempts the bridge/base
footprint), `components/Pedestrians.tsx` (doc comment only, no behavior
change), `components/AirportLife.tsx` (exported `usePathFollower`),
`components/Helicopter.tsx` (`HeliMesh` gained optional `bodyMat`), `components/
Game.tsx` (mounts `Highway`/`MilitaryBase`/`Tank`), `lib/carPhysics.ts`
(`TANK_HANDLING`), `lib/hudStore.ts` (`"tank"` `VehicleKind` + name),
`lib/vehicleState.ts` (`tank` spawn entry), `lib/landmarks.ts` ("FORT NEON").

**Two more real bugs, both live-tested and confirmed fixed in-browser (not
just hand-checked math this time).** (1) `nextPos.x >= SHORE_X` drowning
timers in `Car.tsx`/`Bike.tsx`/`Player.tsx` have the identical blind spot
`clampFromWater` had — x-only, no elevation check — so driving onto the
bridge deck (or walking through the base's gate, the *intended* way in on
foot) got the player teleported to POLICE HARBOR a couple seconds later,
"the game thinks the car fell in the water." Root-caused and fixed by
extracting the bridge/base check into one shared `lib/marina.ts` export,
`isOnBridgeOrBase()`, used by `clampFromWater` and all three drowning
timers alike. (2) Every land vehicle's *initial* `RigidBody` spawn position
and the dismount-to-on-foot teleport both hardcoded a sea-level ride height
(`RIDE_HEIGHT`/literal `1`) regardless of where the vehicle's save actually
put it — reported as "I got out of the car and it just threw me in the
water" after successfully reaching FORT NEON's platform. Two separate call
sites, same root assumption ("the ground is always at y=0") that the
platform breaks. Fixed generically rather than special-cased: `lib/
highway.ts`'s `highwayGroundY()` and `lib/militaryBase.ts`'s `baseGroundY()`
(deliberately tighter than the loose `isOnBridgeOrBase` check — that one's
missing lower-x bound is fine for "skip a clamp" but would wrongly report
deck height for ordinary ground west of the ramp) feed a combined `lib/
marina.ts`'s `groundYAt(x,z)`, added to `RIDE_HEIGHT` at every land
vehicle's spawn (`Car`/`Bike`/`PoliceCar`/`PoliceJeep`/`CommercialVehicle`
— `Tank` already hardcodes the platform height directly since it only ever
spawns there). Every land vehicle also now writes its real `y` into
`vehicleState` every frame (previously only `Plane`/`Helicopter` did), and
`lib/player.ts`'s dismount reads that instead of assuming 1. **Both
confirmed live**: drove the full bridge (ramp climb → 950m deck → gate,
no drowning-respawn at any point), spawned a car directly on the platform
(sat correctly instead of falling through), and dismounted with `E` right
next to it (player stood on the platform, not in the water below).

**Files changed further:** `components/Car.tsx`/`Bike.tsx`/`PoliceCar.tsx`/
`PoliceJeep.tsx`/`CommercialVehicle.tsx`/`Tank.tsx` (write `vehicleState.<kind>.y`
each frame; first five also use `groundYAt` at spawn), `components/Player.tsx`
(dismount teleport uses `playerTeleport.y` instead of a hardcoded `1`),
`lib/player.ts` (passes the mounted vehicle's real `y` to the teleport),
`lib/playerTeleport.ts` (`y` field, `requestPlayerTeleport` gained a `y`
param), `lib/marina.ts` (`isOnBridgeOrBase` exported and reused by the
drowning timers, new `groundYAt`), `lib/highway.ts` (`highwayGroundY`),
`lib/militaryBase.ts` (`baseGroundY`).

## Milestone 25 — FORT NEON expansion: bigger drivable tanks, motor pool,
parked jets, 24/7 patrols, tank main gun + vehicle destruction (2026-08-03)

**Goal:** a big follow-up ask on top of Milestone 24's base — scale up the
tank, let it actually leave the compound, give the base real military set
dressing (camo texture, warehouses, a proper tank formation, parked jets),
round-the-clock patrols, and — the biggest new system — a working tank main
gun that can destroy vehicles (stop, burn, vanish, respawn) and visibly
damage the environment.

**Bigger tanks, and a gate that's actually drivable.** `components/Tank.tsx`
gained `TANK_SCALE=1.7`, applied to the visual mesh and the collider box
alike (kept `TankMesh` itself authored at 1x, scaled by its callers — same
convention `components/Airport.tsx`'s `ParkedHeli` already uses for
`HeliMesh`). `components/MilitaryBase.tsx`'s gate lost its `VEHICLE_ONLY`
collider entirely: Milestone 24 built it walk-in-only on purpose (matching
`components/Airport.tsx`'s own gate), but the user asked directly for tanks
to leave the base, so this gate is now a real open drivable entrance/exit
for every vehicle — the barrier arm is raised, pure dressing, no collider of
its own.

**Military set dressing.** New `lib/militaryTextures.ts` bakes a canvas camo
texture (`CAMO_TEX`, same `tex()`/module-load idiom as `lib/
airportTextures.ts`) — olive base, brown/khaki/black blotches — applied to
the compound's ground and the new warehouse walls. `lib/militaryBase.ts`'s
interior layout was rebuilt as clean, generously-separated depth bands
running from the gate inward (gate apron → motor pool → helipads →
barracks → jets), specifically to guarantee no two structures overlap after
the first layout attempt got cramped. The motor pool (`WAREHOUSES`,
`TANK_FORMATION`) is two big sheds flanking a real 3x3 grid of parked tanks,
all facing the gate as if ready to roll out — "parked in a certain way," not
scattered — plus one dedicated spot (`TANK_SPAWN`) further down the lane for
the actual drivable tank. `JET_APRON` parks three of `components/
FighterJet.tsx`'s `FighterJetMesh` at 2.3x scale as "big jets," reusing the
flyover's own mesh rather than building a second aircraft model.

**24/7 patrols.** `components/Traffic.tsx` gained two more `policeJeep`
lanes confined entirely inside the compound's walls (world coordinates
derived from `BASE_X`/`BASE_Z`/`FENCE_X`/`FENCE_Z`), running opposite
directions north/south of the motor-pool lane. Reuses the existing boxy
`PoliceJeepMesh` rather than a new recolored body — it already reads as
tactical/security, named as a deliberate scope cut rather than building a
second jeep skin. **Real bug caught before it shipped**: `TrafficCar`'s own
`setNextKinematicTranslation` hardcodes `y: RIDE_HEIGHT` (sea level) every
frame — the exact same elevation blind spot Milestone 24 fixed for every
*player* land vehicle, just never touched for scripted NPC lanes. Without
the fix, these two new patrol lanes would drive at sea level while the
compound floats ~9 units above it. Fixed with the same `groundYAt` this
milestone already leans on everywhere else.

**Tank main gun.** New `lib/tankShell.ts` (`fireQueue`, a one-shot request
queue — same shape as `lib/debris.ts`'s `debrisQueue`) and `components/
TankCombat.tsx` (mounted once in `Game.tsx`, pooled: 6 shells, 6 explosion
flashes, 3 burning wrecks — same manually-integrated-physics idiom as
`components/Debris.tsx`/`NitroFX.tsx`, no real Rapier bodies). `lib/
useKeyboard.ts` gained a `fire` field (**F** key) that every non-tank
vehicle simply ignores, same as they already ignore `boost` unless they're
the car. `components/Tank.tsx` fires from an approximated barrel-tip offset
on a 0.8s cooldown.

**Vehicle destruction — the user's exact spec:** "the car stops, burns till
it's black, and after 2, 3, or maybe 5 seconds, it disappears." A shell
hit-tests each frame against `vehicleState.car` (the player's own car) and
every `components/Traffic.tsx` `trafficPositions` slot (civilian + police +
the new base patrols). On a hit: a burning-wreck actor spawns at the impact
point (blackened silhouette + flickering flame + fading point light, 4
seconds — the middle of the user's own range) while the *real* vehicle is
handled separately. For the player's car, new `lib/vehicleDestroy.ts`'s
`carDestroyRequest` (consumed by `components/Car.tsx`, same one-shot-signal
shape as `lib/clubTeleport.ts`) freezes it, stashes it far below the map,
force-dismounts the player on foot if they were driving it (reusing `lib/
playerTeleport.ts`, correctly elevation-aware per Milestone 24's own fix),
then respawns a fresh car at the game's default spawn point once the burn
timer elapses. NPC traffic reuses the lane's *existing* `stolen`/
`respawnIn` hide-and-respawn mechanism (`lib/steal.ts`'s own plumbing) —
no new state needed there, just set from a new caller.

**"Damage buildings" — a deliberately named scope cut, not a missing
feature.** Procedural chunk buildings (`components/City.tsx`) have no
id/health state to attach damage to, and chunks stream in/out as the player
drives — tracking "this specific building took damage" would need a real
persistent-damage system, a much bigger undertaking than "the tank can fire
and it looks like it did something." A shell that doesn't hit a vehicle
within its range/lifetime is treated as a building/ground impact: a real
explosion flash plus a debris burst (reusing `components/Debris.tsx`'s
already-mounted pooled fragment system via `spawnDebris`) fires at the
impact point. It reads as damage without any building actually losing
health or geometry.

**Verification — mixed, named honestly.** `tsc --noEmit` and `eslint` both
clean across every new/changed file (only the same two pre-existing
`PoliceCar.tsx` errors from before this session, confirmed via `git stash`
not introduced here). No new console or dev-server errors across several
clean `.next` rebuilds. **This session's live-in-browser testing hit real
tool flakiness, not code bugs**: a save/reload race (this sandbox's
`localStorage` autosave firing between a seeded save and the reload taking
effect — the same class of issue Milestone 23/24 already worked around, not
new here) meant the final live test loaded with default state instead of
the intended "spawn in the tank, fire it" scenario; confirmed instead that
the build loads and runs with zero console/runtime errors and that basic
driving input works. **The fire→hit→destroy→respawn chain, the reworked
gate collision, and the new patrol lanes have not been visually confirmed
on screen this session** — verified by code review and the same hand-
checked-math discipline that caught Milestone 24's two real bugs, not by
watching a shell actually connect. Worth a real playtest before trusting
the whole chain.

**Files added:** `lib/tankShell.ts`, `lib/vehicleDestroy.ts`, `lib/
militaryTextures.ts`, `components/TankCombat.tsx`.
**Files changed:** `components/Tank.tsx` (`TANK_SCALE`, fire input/cooldown,
barrel-offset fire origin), `components/MilitaryBase.tsx` (gate collider
removed, camo ground material, `Warehouse`/`MotorPool`/`ParkedJets`
components replacing `TankYard`), `lib/militaryBase.ts` (`WAREHOUSES`,
`TANK_FORMATION`, `TANK_SPAWN`, `JET_APRON`, rebanded interior layout),
`components/Traffic.tsx` (two base-patrol lanes, `groundYAt` fix for every
lane's elevation), `components/Car.tsx` (`carDestroyRequest` consumption,
`BURN_DURATION`/`CAR_RESPAWN`), `lib/useKeyboard.ts` (`fire` key/`KeyF`),
`components/HUD.tsx` (controls legend), `components/Game.tsx` (mounts
`TankCombat`), `lib/vehicleState.ts` (`tank` spawn updated to `TANK_SPAWN`).

## Milestone 26 — Fast Refresh crash fix, full verification pass, real cockpit interiors for all four drivable aircraft/car (2026-08-05)

**Goal:** two things. First, root-cause the `Converting circular structure to
JSON` crash that hit right after pulling a collaborator's Phase F changes —
initially misdiagnosed as a stale Turbopack cache (wrong; that "fix" only
looked like it worked because the follow-up test happened to be a cold start
with no live edits). Second, the user asked to actually try every unverified
item on the "Next up" list and fix whatever's broken, then build real cockpit
interiors — dashboard, wheel/yoke/cyclic, gauges, switches, throttle — for
the car, airliner, helicopter, and small plane, since `camMode===1` had been
camera-position-only with zero interior geometry since the feature was
first ported.

**The real bug: React Refresh + R3F's HMR bookkeeping, not a cache issue.**
`@react-three/fiber`'s dev-mode Fast Refresh support tries to diff the live
Three.js scene graph (materials/textures/objects) against the previous one
on every hot-patched edit to `Game.tsx` while a `<Canvas>` is mounted.
`THREE.Texture` defines a `toJSON()` so that path degrades to a console
warning ("Unable to serialize Texture"); a plain `Object3D`/`Group` doesn't,
and its circular `parent`/`children` refs throw the moment that bookkeeping
tries to `JSON.stringify` one — which is exactly what happens on *any*
hot-reloaded edit to that file, including a `git pull` landing new file
content while a dev server tab is open (confirmed by reproducing it via a
live edit, not just a pull). Fix: a `// @refresh reset` directive at the top
of `components/Game.tsx`, which makes React Refresh fully unmount+remount
`Game` on every change instead of attempting the fragile in-place diff —
`saveGame`'s autosave restores state right after, so a full remount costs
nothing. Verified clean across several live edits with zero crashes, where
every edit previously reproduced it 100% of the time.

**Verification pass, all 5 previously-unconfirmed items:**
1. **Drivable airliner end-to-end** (gate → taxi → takeoff → climb → bank
   turn → descent) — clean, `AIRLINER_HANDLING` numbers feel right, camera
   tracked smoothly throughout.
2. **Small plane + helicopter flight, weather cycling** — both aircraft fly
   clean; cycled all 6 `WEATHER` states (clear/sunny/overcast/rain/fog/snow)
   via the `V` key; drove the car and flew the helicopter through fog/snow,
   zero errors.
3. **Pedestrian ragdoll hit-test** — confirmed live at both thresholds: a
   17 km/h hit knocked a pedestrian down flat (the `fast = speedMs > 16`
   branch's `else`), a 77 km/h hit (nitro-boosted, above the 57.6 km/h/16 m/s
   `fast` cutoff) launched one visibly airborne mid-tumble — exactly matching
   `Pedestrians.tsx`'s branch logic.
4. **`dpr={1}`/`EffectComposer` vertical-split render artifact** (open since
   Milestone 5, narrowed to a `SwiftShader`-software-rendering-only theory in
   Milestone 12) — this session's browser pane runs on real hardware
   (`ANGLE (Apple, ANGLE Metal Renderer: Apple M5)`, confirmed via
   `WEBGL_debug_renderer_info`), the actual real-GPU check that was never
   possible before. Zero trace of the artifact across dozens of screenshots.
   Closed.
5. **FORT NEON alert/return-fire (#19)** — confirmed still unbuilt (not a
   bug), scoped rather than built blind: hook point is `Tank.tsx`'s
   `fireQueue` push on `F`-press; needs a shared alert singleton (same
   pattern as `worldState`/`weatherState`) that `PatrolSoldier`/`Soldier`/
   `GuardTower` in `MilitaryBase.tsx` read to switch to alert pose + return
   fire, with a cooldown to de-escalate. Not built this session.

**Cockpit interiors — car, airliner, helicopter, small plane.** Built via
four parallel agents (one per vehicle, `components/CarInterior.tsx`,
`components/AirlinerCockpit.tsx`, `components/HeliCockpit.tsx`,
`components/PlaneCockpit.tsx`), each mounted as a sibling inside its
vehicle's own `<RigidBody>` so it moves/rotates for free, matching the
game's low-poly/flat-shaded style rather than photoreal:
- **Car**: steering wheel (rotates live with `car.current.steerAng`),
  canvas-baked speedo/tach gauge cluster with live needles, warning-light
  row, center console (shifter, switches, cup holders), A-pillars/headliner/
  door panel, static mirror housing.
- **Airliner**: dual yokes (tilt with live `fs.current.pitch`/`roll`),
  glass-cockpit-style panel (attitude/speed-tape/altitude-tape/heading, all
  reading live flight data), throttle quadrant, overhead switch panel,
  two-seat flight deck framing.
- **Helicopter**: cyclic (tilts with pitch/roll), collective (angle tied to
  `fs.current.vy`), pedals, 5-gauge instrument panel (altimeter/airspeed/VSI/
  rotor-RPM/artificial-horizon), canopy strut framing — shared between the
  civilian and `militaryHeli` variants (olive trim swap only).
- **Small plane**: center stick, 5-gauge panel (airspeed/attitude/altimeter/
  heading/RPM), 3-lever throttle quadrant (tied to live speed), single-seat
  framing.

Two real, shared bugs found and fixed across all four during live
verification, not just at build time:
1. **No interior lighting** — every cabin sits under a roof/canopy, out of
   the scene's directional sun, so all four read as near-black silhouettes
   until a small warm `pointLight` was added per cockpit (car/heli/plane
   tuned to avoid being close enough to the eye to blow out; airliner's
   panel is far enough from its own light that this wasn't an issue there).
2. **`cameraRig.ts`'s shared cockpit math couldn't frame a close panel** —
   `camMode===1`'s look-AT target was hardcoded to 30 units ahead with a
   fixed `lookDrop`, which produces an almost-level glance (`atan(0.9/30)
   ≈ 1.7°` down) that works for a car dashboard sitting nearly at eye level,
   but structurally can't aim at an aircraft panel that's both close
   (~0.15-0.3m) and well below eye level — the far look-at target dominates
   the angle regardless of `lookDrop`'s value. Added two new optional,
   additive `CameraRigArgs` fields, `cockpitLookAhead`/`cockpitLookDrop`
   (both default to the exact prior car-tuned behavior, zero change for
   every existing vehicle), so aircraft can look AT their own close panel
   instead. Fixed and confirmed live for the helicopter and airliner (yoke,
   overhead switches, and gauges all clearly visible and correctly framed).

**Known incomplete: the small plane's cockpit camera.** Multiple tuning
passes converged the helicopter and airliner correctly, but the plane's
identical-in-principle fix (eye position between the seat and panel) kept
producing a flat, wrongly-lit wash filling the whole frame instead — not
fully root-caused (ruled out: near-clip-plane clipping, point-light
proximity, time-of-day/bloom coincidence, being embedded inside the seat
mesh). `components/Plane.tsx` was reverted to its last known-safe
configuration (`cockpitEyeHeight: 0.32, cockpitAhead: 0.85`, no
`cockpitLookAhead`/`cockpitLookDrop` override) — prop/cowling/struts read
correctly through the windshield and the panel is partially visible at the
bottom edge, but it isn't dead-center like the other three. Worth a fresh,
focused pass with the geometry re-derived from scratch rather than more
numeric nudging.

**Verification:** `npx tsc --noEmit` and `npx eslint` both clean across
every changed/added file. Live-tested in-browser for all four vehicles
(car/airliner/helicopter confirmed well-framed and lit; plane confirmed
safe/non-broken but not dead-center), zero console/runtime errors.

**Files added:** `components/CarInterior.tsx`, `components/
AirlinerCockpit.tsx`, `components/HeliCockpit.tsx`, `components/
PlaneCockpit.tsx`.
**Files changed:** `components/Game.tsx` (`@refresh reset`), `components/
Car.tsx` (mounts `CarInterior`), `components/DrivableAirliner.tsx` (mounts
`AirlinerCockpit`, cockpit eye params), `components/Helicopter.tsx` (mounts
`HeliCockpit`, cockpit eye params), `components/Plane.tsx` (mounts
`PlaneCockpit`, cockpit eye params), `lib/cameraRig.ts`
(`cockpitLookAhead`/`cockpitLookDrop`), `lib/airportTextures.ts` (exported
`tex()` for reuse by the new cockpit gauge textures).

## Next up — by phase

Context: Milestones 14-17 built the whole city (world scale, real physics,
maps, building variety, texture/detail) on top of the fidelity work in
Milestones 1-13. Milestone 18 layered weather, nitro FX, commercial traffic,
and a flyable airport on top of that. Milestone 19 added a security
perimeter. Milestone 20 rebuilt the airport at real scale with drivable
wide-bodies. Milestone 21 closed three of Milestone 20's smaller named gaps.
Milestone 22 was a large user-driven bugfix/feature session (commercial-
vehicle drivability, water boundary, airport location + gate vehicles, the
debris renderer, VENU's exterior, sunny weather). Milestone 23 closed out
Phase A (airport + city draw-call/perf pass). Everything below is what's
left, grouped into 4 phases / 12 tasks, ordered roughly biggest-first within
each phase.

### Phase A — Performance — ✅ done (Milestone 23)

### Phase B — Live verification, real browser — ✅ done (Milestone 26)

All 4 confirmed live: airliner end-to-end, plane/helicopter flight + weather
cycling, ragdoll hit-test (both speed thresholds), and the render-split
artifact closed out for good on real GPU hardware.

### Phase G — Cockpit interiors (1 task, Milestone 26)

15. **Small plane cockpit camera framing** — `components/Plane.tsx`'s
    `applyCameraRig` call is reverted to a known-safe-but-not-ideal
    configuration (prop/cowling/struts read fine, panel only partially
    visible at the bottom edge). The helicopter and airliner both got their
    panel dead-center via the same `cockpitLookAhead`/`cockpitLookDrop`
    fix in `lib/cameraRig.ts`; the plane's version of that same fix instead
    produced a flat, wrongly-lit wash filling the whole frame, not yet
    root-caused (ruled out: near-clip clipping, point-light proximity,
    day/night timing, eye embedded in the seat mesh). Needs a fresh pass
    with `components/PlaneCockpit.tsx`'s seat/panel/canopy coordinates
    re-derived from scratch rather than more numeric nudging.

### Phase C — Visual/content polish (3 tasks)

7. **Club interior update** — `ClubInterior.tsx` wasn't touched to match
   Milestone 22's new premium VENU exterior; still the earlier interior
   build (simplified crowd, no bar/poles/VIP couches — see Milestone 9).
8. **VENU parking lot** — marked bays exist but no actual parked-car meshes.
9. **Sunny-weather reflections** — lens-flare streaks / puddle-style ground
   reflections were discussed in Milestone 22 but not built.

### Phase D — Small named bugs (4 tasks)

10. **`laneBlocked()` doesn't check AI-vs-AI** — only checks real vehicles +
    pedestrians, not other traffic lanes against each other.
11. **`PoliceCar.tsx` missing a `VEHICLE_BODY_GROUPS`-equivalent filter** —
    unlike `Car.tsx`/`Bike.tsx`/`CommercialVehicle.tsx`, its drive rig still
    gets stuck on `VEHICLE_ONLY` curbs/gates.
12. **Stolen jeep/bus/truck keeps its default parked livery colour** —
    `lib/steal.ts` only fixed the *kind* mapping; needs a
    `stolenCommercial` field shaped like the existing `stolenCar` one.
13. **Garage bay side walls/roof have no collider** — by design (visual
    only, so pulling in never gets stuck), but worth a follow-up if a
    player manages to clip through a side wall at speed.

### Phase E — Deferred big feature (1 task)

14. **Felony-stop convoy maneuver** — the boxing-in state machine named and
    explicitly skipped since Milestone 11 (a meaningfully bigger state
    machine than the current straight-follow convoy AI).

### Phase F — FORT NEON follow-ups (7 tasks, 4 shipped 2026-08-04)

Context: a review pass over Milestone 24/25's base (`lib/militaryBase.ts`,
`components/MilitaryBase.tsx`, `components/TankCombat.tsx`, `lib/
tankShell.ts`). None of these were regressions — they were gaps between what
the compound was and what its own set dressing already promised.

- [x] 15. **Tank shells only hit the player's sedan, never any other vehicle
      they're driving.** Fixed: `components/TankCombat.tsx`'s hit-test now
      loops every `VehicleKind` except `tank` itself (`SHELLABLE`, derived
      from `Object.keys(vehicleState)`), same generalization
      `lib/pedestrianHit.ts` already does. The player's sedan keeps the full
      stop/burn/stash/respawn path (`requestCarDestroy`); every other
      player-driven vehicle gets blown out of the seat instead
      (`requestPlayerTeleport` + `setActive("foot")`) since none of the
      other rigs have destroy plumbing yet — no `spawnWreck` there on
      purpose, nothing moves the real body out of the way for a wreck actor
      to stand in for. NPC traffic hit-test untouched. Friendly fire against
      the base's own parked tanks/jets/soldiers still not implemented —
      named as a separate, wider change in the original write-up.

- [x] 16. **The second helipad was empty.** Fixed: `components/
      Helicopter.tsx` is now parameterized over `kind`/`bodyMat` (same shape
      as `PoliceCar.tsx`'s `kind` prop), so `HELIPAD_POS[1]` gets a real
      *drivable* olive-drab gunship (`militaryHeli`/"FORT NEON GUNSHIP" in
      `lib/hudStore.ts`, spawn in `lib/vehicleState.ts`) instead of a second
      parked decoration. Ground floor for both the spawn and the live
      per-frame floor switched from a hardcoded sea-level 0 to `groundYAt()`
      — the previous code would have buried a heli spawned on the platform,
      since the platform sits ~9 units above sea level.

- [x] 17. **Every soldier except the gate patrol was frozen.** Fixed: 4 more
      `PatrolSoldier` routes added — 2 walking the motor-pool lane from
      opposite ends, 1 along the barracks frontage, 1 pacing the jet apron —
      using the same `usePathFollower` keyframe-path infra the gate patrol
      already used. Static `Soldier()` posts (towers, helipad marshal)
      unchanged.

- [x] 18. **The three parked jets were decoration only.** Fixed: new
      `components/DrivableFighterJet.tsx`, parameterized over a new
      `FighterJetId` (`jet1`/`jet2`/`jet3`, same shape as `AirlinerId`) —
      one component covers all three apron slots, same pattern
      `DrivableAirliner.tsx` established. New `FIGHTER_JET_HANDLING` in
      `lib/flightPhysics.ts` (fastest/hardest-turning airframe in the game,
      a clear step above `POLICE_JET_HANDLING`); `groundClearance` matched
      exactly to how `MilitaryBase.tsx` used to park the decorative mesh
      (`1.1 * JET_SCALE`) so a landed jet sits on the apron instead of
      sinking into it. `JET_SCALE` moved from `MilitaryBase.tsx` into
      `lib/militaryBase.ts` so the drivable rig and the (now apron-slab-
      only) `MilitaryBase.tsx` share one definition instead of drifting.
      `components/MilitaryBase.tsx`'s old `ParkedJets` (which rendered the
      jets themselves) became `JetApron` (renders only the ground slab) —
      the jets are real mountable vehicles now, mounted in `Game.tsx`, so
      drawing decorative copies in the same slots would double-render them.
      Got nitro too, same `lib/nitro.ts` rig as every other vehicle.

- [ ] 19. **[Assigned: Akul]** **Nothing reacts to the player firing inside the compound** — the
      gate sign reads RESTRICTED AREA / DEADLY FORCE AUTHORIZED, but
      soldiers and guard towers have no alert state, no return fire, and no
      dispatch. **Not started** — was mid-scoping (a shared alert singleton)
      when this session ended; no file exists for it yet.

- [ ] 20. **[Assigned: Akul]** **The base has no audio identity** — no klaxon, wind, or generator
      hum. The compound is silent apart from engine and tank-fire SFX, which
      makes it feel less distinct than it looks. Same idea as the club's own
      sonic signature. **Not started.**

- [ ] 21. **[Assigned: Akul]** **The gate barrier arm is inert dressing** — deliberate as of
      Milestone 25 (the tank has to be able to drive out, so the gap has no
      collider and the arm is modelled raised). Listed here only so the
      decision is visible rather than looking like an oversight: if the base
      ever wants a real entry beat, the arm is where it goes. **Design call,
      not a bug — leave alone unless that's wanted.**

**Verification (2026-08-04 session):** `npx tsc --noEmit` and `npm run build`
both clean/green after every change; `eslint` clean on every touched file
(one `no-unused-vars` warning on `MilitaryBase.tsx`'s now-stale `JET_APRON`
import, caught and removed same session). **Not live-verified in browser**
this session — no shell was actually fired at a non-sedan vehicle, the
gunship/fighter jets were never mounted and flown, and the new patrol routes
were never watched running. Code-reviewed and type/build-checked only, same
honesty flag Milestone 25 itself used for its own unverified chain.

**Files added:** `components/DrivableFighterJet.tsx`.
**Files changed:** `components/TankCombat.tsx` (generalized hit-test),
`components/Helicopter.tsx` (`kind`/`bodyMat` params, `groundYAt` floor),
`components/MilitaryBase.tsx` (4 new patrol routes, `ParkedJets` →
`JetApron`, exports `OLIVE_HELI_MAT`), `components/Game.tsx` (mounts
`militaryHeli` + 3 `DrivableFighterJet`s), `lib/hudStore.ts`
(`militaryHeli`/`FighterJetId` additions), `lib/vehicleState.ts`
(`militaryHeli`/`jet1`/`jet2`/`jet3` spawns), `lib/flightPhysics.ts`
(`FIGHTER_JET_HANDLING`), `lib/militaryBase.ts` (`JET_SCALE` moved in from
the component file).

## Akul's task list (2026-08-08) — CLOSED 2026-08-08

Items 22-33 below (vehicle physics jerk, enterable buildings, street
redesign, minimap fix, gun/arms store, nitro+drift smoke, in-game phone,
bike model fix, grass/sidewalk fix, speedometer fix, cockpit camera fix,
parachute mechanic) are all done — implemented, typecheck-clean, and pushed
to `main` (`d347936..8a1d3ea`, 11 commits). Full per-item detail lives in
those commit messages; see `git log d347936..8a1d3ea` for the complete
breakdown of what changed and why.

## Abdullah's next task list (2026-08-08) — from voice note, NOT STARTED

19 items, transcribed from a rambling voice note (Hindi/Urdu/Punjabi mix via
Wispr Flow) and interpreted/organized into discrete tasks. Not yet confirmed
item-by-item with Akul the way the previous batch was — do that before
starting, same as the last list's own process note recommends.

**Stars = build complexity/effort, 1 (quick) to 5 (major system).**
**"BLOCKED ON ART" = do not start until Akul supplies the named reference
images** — these are explicitly "show it a real photo, it copies the look"
tasks, same approach the previous list's #23 (enterable buildings) used.

- [ ] 34. ★★★★☆ **Walk-in cinema.** A real interior — auditorium seating,
      a screen with a movie always playing (a looping animated texture is
      enough; no need for actual video decode). Same door/interior pattern
      as VENU (`lib/club.ts`, `components/Club.tsx`/`ClubInterior.tsx`) or
      the generic building system from the last batch
      (`lib/interiors.ts`'s `registerInterior()`, `lib/interiorSpots.ts`,
      `components/EnterableBuildings.tsx`) — the interior needs proper
      auditorium seating though, which the generic building system doesn't
      have; look at `lib/clubSeats.ts` (`LOCAL_SEATS`, `nearestSeat()`,
      `seatAction()`) for the seat-snap pattern to extend. **BLOCKED ON
      ART** — Akul is providing reference pictures for the cinema's look.

- [ ] 35. ★★★☆☆ **GTA5-style phone.** Current phone
      (`components/Phone.tsx`, added this session) is a centred modal —
      Abdullah wants it redesigned to sit fixed in the bottom-right corner
      like GTA5's, with an iOS-style OS: icon grid, app-like menus, a call
      list. Keep the existing wiring (`hud.phoneOpen`/`setPhoneOpen` in
      `lib/hudStore.ts`, KeyP toggle in `components/Game.tsx`) and the
      existing actions (call mechanic via `lib/vehicleSummon.ts`, GPS
      waypoint via `hud.setNavTarget`, weather via `cycleWeather()`) — this
      is a visual/UX redesign of the shell, not new functionality. **BLOCKED
      ON ART** — Akul providing reference pictures for the phone's look.

- [x] 36. ★★★☆☆ **[Done by Akul]** **High-speed car glitch — camera flinch, judder above
      ~100 km/h.** Fixed, root-caused via real repro data, not the
      cameraRig pow()-lerp suspected in the original note (analyzed and
      ruled out — that math is scale-invariant). Instrumented Car.tsx
      temporarily (stripped after), sustained nitro drives up to 294 km/h
      logging speed/grounded/y/x/z per frame: `computedGrounded()` flickers
      false for 2-3 frames at moderate-high speed (confirmed at ~45 and ~33
      m/s, both a few units past a chunk boundary, CELL=100), with
      `movement.y` spiking +0.13..+0.28 in one frame before self-correcting.
      NOT the `lib/marina.ts` "sweep tunnels through a thin collider at
      200+ km/h" mechanism (sweep distance at the glitch was only ~2.2-2.9
      units, an ordinary car-length; 12+ seconds at up to 294 km/h elsewhere
      produced zero glitches) — reads as Rapier's snap-to-ground briefly
      detecting a misaligned ground candidate at a chunk seam. Fix targets
      the actual physical impossibility instead of the seam geometry: a car
      never requests upward Y motion (fallSpeed only accumulates ≤0 via
      GRAVITY_PULL), so any `movement.y` beyond a small ground-snap
      tolerance (clamped to 0.06) is a transient glitch, not real physics.
      Applied to both `Car.tsx` and `Bike.tsx` (identical sweep pattern).
      Live-verified no regression driving back through the same repro zone.

- [ ] 37. ★★★★☆ **Real grass with wind sway — REPLACES this session's
      park sidewalk fix.** Abdullah does not want the light-stone walking
      path this session added to park chunks (`components/City.tsx`'s
      `buildTileTexture()`, `isGrass` branch, `PARK_TILE_TEX`) — he wants
      that path/edge line gone, replaced with real uneven, overgrown grass
      that visibly sways in the wind. This is a bigger scope than a canvas
      texture: likely needs actual grass-blade geometry (instanced, wind-
      displaced via a vertex shader driven by `state.clock.elapsedTime`,
      same idiom `components/SkyCycle.tsx`/other time-driven effects use)
      rather than a flat painted texture. **Assign: Akul.** When this
      lands, delete the `isGrass` path-ring block added in commit
      `e4b0289` (this session) — don't leave both systems fighting each
      other.

- [x] 38. ★★☆☆☆ **[Done by Akul]** **Snow/rain traction loss.** Fixed the real gap: `weatherState` already
      had a distinct SNOW case tuned more punishing than rain (0.3 vs 0.5
      grip) — that part was already fine. `wetGrip` only ever multiplied
      lateral/cornering grip, never acceleration or braking/drag, so
      braking distance was identical dry vs. snow. Added separate
      `accelGrip`/`brakeGrip` curves in `lib/carPhysics.ts` (both monotonic
      in `wetGrip`, both exactly 1/no-op when dry) extending the effect
      into acceleration and every deceleration term. Also tied
      `components/DriftFX.tsx`'s existing slip-triggered smoke to a
      weather-aware boost so the traction loss has a visible cue. `tsc`/
      build clean, verified via direct code diff review — not a fresh
      live playthrough this pass (the original agent's own attempt to
      force weather for an A/B test wasn't captured as a confirmed result).

- [ ] 39. ★★★★☆ **Better cockpit: console/armrest + visible driver
      hands on the wheel.** `components/CarInterior.tsx` already has a
      steering wheel mesh and dashboard — Abdullah wants a visible
      character rig (or at least hand meshes) turning the wheel
      left/right as the player steers, plus console/armrest geometry.
      Live steering input is already available every frame
      (`car.current.steerAng` in `lib/carPhysics.ts`'s `CarState`, or the
      raw `k.left`/`k.right` from `lib/useKeyboard.ts`) — wire a hand
      mesh's rotation off `steerAng` the same way `CarInterior.tsx`
      already wires its steering wheel mesh's rotation, if it does; if
      not, that's the pattern to add. This session's cockpit work
      (`dc32640`) only fixed *visibility gating* (helicopter/truck/jeep/
      bus cockpits showing when they shouldn't, or not existing at all) —
      it didn't touch quality/detail, so this is new scope, not a
      follow-up bug.

- [x] 40. ★★☆☆☆ **[Done by Akul]** **Bike rider renders as a solid black blob, not the
      player.** Fixed. Live-checked in-game first (CINE camera, close angle)
      — confirmed the rider reads as a genuinely flat black silhouette, no
      material distinction. Root cause was NOT missing lighting or an unlit
      material (`BikeRider()`'s meshes already use `MeshStandardMaterial`
      with `castShadow`) — the colors themselves (`#1c1e22`/`#101114`/
      `#26282c`) were just too close to true black for open-air scene
      lighting to produce visible diffuse shading. Also: `CarInterior.tsx`/
      `HeliCockpit.tsx`'s local pointLights exist because those occupants
      sit shaded under a roof — a motorcycle rider sits in open light, so
      that fix doesn't transfer; brightened the base colors instead
      (`#3a3f47`/`#23262c`/`#454a52`, helmet gained a touch of metalness/
      lower roughness for a real specular highlight). Re-verified live —
      rider now shows visible shape/contrast instead of a flat silhouette.

- [x] 41. ★★☆☆☆ **[Done by Akul]** **VENU ticket booth entrance.** Fixed. Added optional `gate?: () => boolean`
      field to `lib/interiors.ts`'s `InteriorEntry` (keeps the registry
      generic instead of hardcoding a venu-id special case), new
      `lib/ticketBooth.ts` mirroring `armory.ts`'s one-shot-flag shape,
      `hud.hasTicket`/`setHasTicket` added, VENU's `registerInterior()` call
      passes the gate. Correct E-chain/hint priority (ticket check before
      door check). `tsc`/build clean, verified via direct code diff review
      — not a fresh live playthrough this pass.

- [ ] 42. ★★★★★ **Player mansion.** A large house the player can enter
      and interact with (sleep on a bed — likely a fast-forward-time or
      save-point action, similar in spirit to `lib/clubSeats.ts`'s seat-
      snap but probably needs its own state, not a reuse of seatedAt),
      fully furnished/detailed like a real house — kitchen, living room,
      bedroom, etc., not a bare room. Biggest single item on this list —
      probably deserves its own dedicated session rather than being
      folded into a batch. **BLOCKED ON ART** — Akul providing a mansion
      reference picture.

- [ ] 43. ★★★☆☆ **Water waves.** `components/Water.tsx`'s water plane
      is currently flat/static — needs a wave effect, most likely a
      vertex-displacement shader driven by `state.clock.elapsedTime` (the
      same per-frame time source `SkyCycle.tsx` and other animated
      systems already read off `useFrame`). Check whether Water.tsx
      already uses a custom `shaderMaterial`/`onBeforeCompile` hook to
      extend, or a plain `meshStandardMaterial` that needs replacing.

- [x] 44. ★★☆☆☆ **[Done by Akul]** **Police boat sirens (light bar only — no audio siren
      exists anywhere in the game for ANY police vehicle, confirmed, out
      of scope).** Fixed. Ported the exact `lightRefs`/flash-flip pattern
      from `PoliceCar.tsx`/`PoliceJeep.tsx` onto `PatrolBoat.tsx`, replacing
      the single static red nav-light sphere — unconditional flash
      regardless of `isActive`, same as the reference. `tsc`/build clean;
      verified via direct code diff review, not a fresh live playthrough
      this pass (see this session's own honesty note on Phase 1's
      verification level).

- [x] 45. ★★★☆☆ **[Done by Akul]** **Sharpen distant roads/white lines — currently read
      blurry far away.** Was a deliberate tradeoff, not an oversight —
      `buildTileTexture()`'s own comment confirmed the unset `minFilter`
      (defaulting to `THREE.LinearMipmapLinearFilter`, trilinear) was
      chosen specifically so distant tiles anti-alias instead of
      shimmering. Chose the middle-ground fix rather than the two extremes:
      set `tex.minFilter = THREE.LinearMipmapNearestFilter` — still
      mipmapped (distant tiles still anti-alias, no shimmer regression) but
      samples a single nearest mip level instead of blending two, which
      keeps thin lane lines legible noticeably farther out. If this still
      shimmers in practice, `anisotropy=16` (already set) is the next lever
      before reaching for `NearestFilter` outright, which would drop mip
      anti-aliasing entirely.

- [ ] 46. ★★★☆☆ **Mansion guards — 2 permanent patrolling guards.**
      Depends on #42 (mansion) existing first. Likely reuses
      `components/Pedestrians.tsx`'s ped rig (or `PersonFigure`) on a
      fixed patrol loop around the mansion's coordinates, rather than the
      random-wander AI regular pedestrians use — check whether
      Pedestrians.tsx supports a "patrol a fixed route" mode already or
      needs one added.

- [ ] 47. ★★★★☆ **Rain puddle reflections.** Puddles that form on the
      road during rain should have a real reflective surface. Gate on
      `weatherState` (rain intensity). Full real-time planar reflection
      (a mirror camera pass) is expensive — consider a cheaper faked
      reflection (a semi-transparent, high-metalness/low-roughness plane
      decal with an environment-map reflection) before reaching for a
      true reflector pass, given this is a small-object-count city scene
      already running a full `EffectComposer` bloom pass
      (`components/Game.tsx`).

- [x] 48. ★★★☆☆ **[Done by Akul]** **Restrict boats to water only — currently drive onto
      roads/land.** Fixed. Root cause was different from the original
      guess: not a collision-group filter issue — boats had ZERO Rapier
      colliders at all. Built a real `clampToWater()` in `lib/marina.ts`
      mirroring `clampFromWater()`'s pier-band logic exactly (not a naive
      x-threshold copy), applied to both `Boat.tsx` and `PatrolBoat.tsx`
      (which had no land restriction whatsoever before). `tsc`/build clean,
      verified via direct code diff review.

- [ ] 49. ★★★☆☆ **[Partially done by Akul — wheel-spin only]** **Bike redesign — new shape, wider body, wheels that
      actually spin.** **Wheel-spin animation: DONE.** Pulled `WHEEL_RADIUS`
      out as a shared named export, correctly derived the spin axis/sign
      given the wheel's existing `rotation=[0,0,Math.PI/2]` pre-rotation
      (verified via a standalone matrix check, not guessed), kept the
      imperative per-frame spin on a separate inner group so React
      re-renders can't clobber it, reverse-direction handled automatically
      by sign. `tsc`/build clean, verified via direct code diff review
      (matrix reasoning re-checked, not just trusted) — not a fresh live
      playthrough this pass.
      **New shape/wider silhouette: still BLOCKED ON ART** — Akul providing
      a new bike reference image, not started.

- [ ] 50. ★★★☆☆ **[Partially done by Akul]** **Cars look like they're floating — elevation/ride-
      height issue.** **Partial — Bike.tsx fixed, PoliceJeep.tsx still
      open.** Code-level audit found the direction contradicted the report:
      `Bike.tsx` (no `RIDE_HEIGHT` concept at all, hardcoded spawn) and
      `PoliceJeep.tsx` (local `RIDE_HEIGHT=0`, wrong for its actual wheel
      geometry) both had their collider BOTTOM sitting above the visual
      wheel bottom — meaning wheels would sink into the ground once the KCC
      settled, not float. Flagged the contradiction rather than guessing;
      Akul confirmed proceeding on the fix anyway since correct collider/
      visual alignment is right regardless of which direction it visually
      reads. **Fixed Bike.tsx**: added `BIKE_RIDE_HEIGHT` (derived from the
      wheel's own geometry constants, same self-documenting pattern as
      `WHEEL_RADIUS`), applied to every spawn/teleport/respawn site and the
      `CuboidCollider`'s position offset — collider bottom now lands exactly
      on the tyre contact patch, same formula `SupercarBody.tsx`'s cars use.
      Live-verified: bike sits flush on the road, no visible gap. **Not yet
      touched: `PoliceJeep.tsx`'s confirmed `RIDE_HEIGHT=0` mismatch**, and
      Car/PoliceCar/CommercialVehicle were already confirmed consistent
      (no fix needed there). Tank doesn't use `groundYAt()` at all — fine on
      its flat platform, separate minor note, not part of this fix.

- [ ] 51. ★★★★☆ **All FORT NEON tanks drivable, not just one.**
      `lib/militaryBase.ts` has "a 3x3 formation of decorative
      ParkedTanks" (per this session's own comment when adding tank
      support) plus one single dedicated drivable spot
      (`vehicleState.tank`, one instance, `components/Tank.tsx`). Abdullah
      wants every tank in that formation mountable and drivable. Same
      "id-based multiple instances of one drivable rig" pattern this
      session's own military-base work already used for
      `DrivableFighterJet`/`DrivableAirliner` (`jet1`/`jet2`/`jet3`,
      `airliner1`/`airliner2`/`airliner3` in `lib/vehicleState.ts` and
      `lib/hudStore.ts`'s `VehicleKind`) — generalize `Tank.tsx` the same
      way those were generalized from a single instance, and make sure
      `components/TankCombat.tsx`'s `SHELLABLE` exclusion list (currently
      excludes the single `"tank"` kind so a tank can't shell itself)
      correctly excludes ALL tank instances once there are several.
      Firing/explosions can reuse the existing `lib/tankShell.ts`
      fireQueue + `TankCombat.tsx` system as-is — that part doesn't need
      new code, just more tanks feeding into it.

- [x] 52. ★★☆☆☆ **[Done by Akul]** **Streetlights: move off intersections, hover over the
      road from the side.** Fixed. Correction to the original note:
      `StreetLamp` had NO rotation prop at all (arm only ever extended in
      local +X) — a real new addition, not "reusable almost as-is."
      Added a `rotY` prop, moved placement from the chunk's shared NW-corner
      intersection to a per-chunk sidewalk band beside the west road edge
      (with explicit reasoning for why the new placement can never
      double-render at a shared corner the way the old one could), and
      increased `LAMP_ARM` from 1.1 to 9 so the head actually clears out
      over the road (`ROAD_W=20`) instead of barely reaching an
      intersection center. `tsc`/build clean, verified via direct code diff
      review — not a fresh deliberate live positioning check this pass
      (lamps were incidentally visible in later Phase 2 screenshots, but
      that wasn't a targeted verification of this fix).

**Process notes:**
- Four items are hard-blocked on Akul supplying reference images before any
  visual work can start: #34 (cinema), #35 (phone), #42 (mansion), #49
  (bike). Confirm those pictures have actually arrived before picking these
  up, same as the "show it a real photo, it copies the look" approach the
  previous batch's #23 used successfully.
- Two items are direct **revisions of this session's own just-shipped
  work**, not new features layered on top: #37 (grass — replaces the park
  path from commit `e4b0289`) and #52 (streetlight placement — repositions
  the lamps from commit `8a1d3ea`). Don't build these as if the old version
  should stay; remove/replace it.
- #46 (mansion guards) is hard-blocked on #42 (mansion) existing first —
  there's nothing to guard yet.
- Communication loop from the previous batch still applies unless Abdullah
  says otherwise: heads-up before pushing, confirmation after.
