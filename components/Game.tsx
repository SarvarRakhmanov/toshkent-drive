"use client";

// @refresh reset — Fast Refresh's default in-place hot patch tries to diff
// the live Three.js scene graph (materials/textures/objects) against the
// previous one on every edit to this file. THREE.Texture defines a toJSON()
// so it degrades to a console warning ("Unable to serialize Texture"), but a
// plain Object3D/Group doesn't, and its circular parent/children refs throw
// "Converting circular structure to JSON" the moment R3F's HMR bookkeeping
// tries to stringify one — crashing the page on any hot-reloaded edit (this
// file, or any pulled/checked-out change that touches it) while a Canvas is
// mounted. This directive makes React Refresh fully unmount+remount Game on
// every change instead of hot-patching it, which never runs that diff path.
// Full remount is fine here: saveGame's autosave restores state right after.
import "@/lib/consoleFilter";
import "@/lib/physicsGuard";
import "@/lib/testHooks";
import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";
import { Environment } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { usePauseStore } from "@/lib/pauseStore";
import { EffectComposer, Bloom, N8AO, SMAA } from "@react-three/postprocessing";
import type { BloomEffect } from "postprocessing";
import { SkyCycle } from "@/components/SkyCycle";
import { skyState } from "@/lib/skyState";
import { Weather } from "@/components/Weather";
import { City } from "@/components/City";
import { Water } from "@/components/Water";
import { Car } from "@/components/Car";
import { Boat } from "@/components/Boat";
import { Bike } from "@/components/Bike";
import { Traffic } from "@/components/Traffic";
import { TrafficSignals } from "@/components/TrafficSignals";
import { Missions } from "@/components/Missions";
import { Pedestrians } from "@/components/Pedestrians";
import { Player } from "@/components/Player";
import { Club } from "@/components/Club";
import { ClubInterior } from "@/components/ClubInterior";
import { EnterableBuildings } from "@/components/EnterableBuildings";
import { GunStore } from "@/components/GunStore";
import { AudioEngine } from "@/components/AudioEngine";
import { NitroFX } from "@/components/NitroFX";
import { DriftFX } from "@/components/DriftFX";
import { Debris } from "@/components/Debris";
import { WaypointTracker } from "@/components/WaypointTracker";
import { HUD } from "@/components/HUD";
import { PrewarmAssets } from "@/components/GlbCar";
import { useGfxStore, profileFor, markGfxRunning, markGfxStopped, takeBootNotice } from "@/lib/gfx";

// hard cap on canvas remounts per page load (context loss / watchdog)
const MAX_REMOUNTS = 3;
import { LightPool } from "@/components/LightPool";
import { Deferred } from "@/components/Deferred";
import { ReadyGate, BootHold } from "@/components/ReadyGate";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Cull, MergeStatic, FogFarSync, LowEnvironment, AutoQuality, DprSync, PhysicsProbe, SinglePassTransparent } from "@/components/SceneTools";
import { asset } from "@/lib/asset";
import { useHudStore } from "@/lib/hudStore";
import { unlockAudio, setMuted } from "@/lib/audio";
import { useLoadStore } from "@/lib/loadState";
import { renderedFrames } from "@/components/PerfProbe";
import { installTouchDetection } from "@/lib/touch";
import { TouchControls } from "@/components/TouchControls";
import {
  actionUse, actionSwitchVehicle, actionCamera, actionLights, actionMute, actionWeather,
  actionMap, actionPhone, actionGraphics, actionNextCar, actionResetCar,
} from "@/lib/actions";
import { loadSave, saveGame } from "@/lib/saveGame";
import { PoliceCar } from "@/components/PoliceCar";
import { PoliceJeep } from "@/components/PoliceJeep";
import { PatrolBoat } from "@/components/PatrolBoat";
import { PoliceStation } from "@/components/PoliceStation";
import { MizuRestaurant } from "@/components/MizuRestaurant";
import { Marina } from "@/components/Marina";
import { Airport } from "@/components/Airport";
import { Plane } from "@/components/Plane";
import { Helicopter } from "@/components/Helicopter";
import { PoliceJet } from "@/components/PoliceJet";
import { DrivableAirliner } from "@/components/DrivableAirliner";
import { DrivableFighterJet } from "@/components/DrivableFighterJet";
import { CommercialVehicle } from "@/components/CommercialVehicle";
import { LIVERIES } from "@/components/Airliner";
import { Props } from "@/components/Props";
import { TashkentLandmarks } from "@/components/TashkentLandmarks";
import { Skyline } from "@/components/Skyline";
import { isBigCity } from "@/lib/mapChoice";
import { Clouds } from "@/components/Clouds";
import { Headlights } from "@/components/Headlights";
import { MouseLook } from "@/components/MouseLook";
import { Highway } from "@/components/Highway";
import { MilitaryBase, OLIVE_HELI_MAT } from "@/components/MilitaryBase";
import { Tank } from "@/components/Tank";
import { TankCombat } from "@/components/TankCombat";
import { PerfProbe } from "@/components/PerfProbe";

const CYCLABLE = new Set(["car", "bike", "boat"]);
const BOOT_STAGES = 6;

// original's exact per-frame rescale (updateDayNight ~line 7016): dim by day
// so daylight isn't blown out, full glow at night for the neon signs
// memo: the postprocessing wrapper JSON.stringify()s an effect's props on every
// render — with the ref (React 19: a plain prop) pointing at a live BloomEffect
// that throws "Converting circular structure". Never re-render it from Game.
const DynamicBloom = memo(function DynamicBloom() {
  const ref = useRef<BloomEffect>(null);
  useFrame(() => {
    if (ref.current) ref.current.intensity = 0.18 + skyState.nightK * 0.72;
  });
  return <Bloom ref={ref} luminanceThreshold={0.7} luminanceSmoothing={0.2} mipmapBlur />;
});

/** Crash sentinel (lib/gfx.ts): set while rendering, cleared on a clean exit
 *  or after a stable minute; shows the boot-time downgrade message. Its own
 *  component so the load-phase subscription never re-renders Game (a Game
 *  re-render re-renders the postprocessing effects, whose wrapper
 *  JSON.stringify()s their props — Bloom's ref then throws "circular"). */
function CrashSentinel() {
  const phase = useLoadStore((s) => s.phase);
  useEffect(() => {
    if (phase !== "ready") return;
    markGfxRunning();
    const notice = takeBootNotice();
    if (notice) useHudStore.getState().showMsg(notice);
    const stable = window.setTimeout(() => markGfxStopped(true), 60000);
    const bye = () => markGfxStopped(false);
    const back = () => { if (document.visibilityState === "visible") markGfxRunning(); };
    window.addEventListener("pagehide", bye);
    document.addEventListener("visibilitychange", back);
    return () => { window.clearTimeout(stable); window.removeEventListener("pagehide", bye); document.removeEventListener("visibilitychange", back); };
  }, [phase]);
  return null;
}

export default function Game() {
  const paused = usePauseStore((s) => s.open);
  const quality = useGfxStore((s) => s.quality);
  // restore active vehicle/camera/mute once at mount — vehicle *positions*
  // are restored by each vehicle itself (Car/Bike/Boat read loadSave() in
  // their own lazy useState initializer, so there's no load-then-jump)
  useEffect(() => {
    const save = loadSave();
    if (!save) return;
    useHudStore.getState().setCamMode(save.camMode);
    useHudStore.getState().setLightMode(save.lightMode ?? 0);
    useHudStore.getState().setLookSensitivity(save.lookSensitivity ?? 1);
    setMuted(save.muted);
    // don't restore `active` via toggleActive (cycles relative to current, and
    // can only ever reach car/bike/boat — see hudStore.toggleActive's no-op-on-foot
    // guard and its CYCLE array, which policeCar/patrolBoat/foot are deliberately
    // outside of); hudStore's default is "car", so only touch it if the save disagrees
    if (!CYCLABLE.has(save.active)) {
      useHudStore.getState().setActive(save.active);
    } else if (save.active !== "car") {
      while (useHudStore.getState().active !== save.active) useHudStore.getState().toggleActive();
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(saveGame, 3000);
    window.addEventListener("beforeunload", saveGame);
    // iOS Safari never fires beforeunload — pagehide is its reliable "leaving" event
    window.addEventListener("pagehide", saveGame);
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", saveGame);
      window.removeEventListener("pagehide", saveGame);
    };
  }, []);

  useEffect(() => {
    installTouchDetection();
    const onKey = (e: KeyboardEvent) => {
      unlockAudio(); // needs a real user gesture; first key creates the context, later ones resume it
      // holding a key must not machine-gun cycle cars/cameras/graphics
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || (t.tagName === "INPUT" && (t as HTMLInputElement).type === "text"))) return;
      const hud = useHudStore.getState();
      // v1.7b: Esc toggles the pause menu (after closing map/phone first); keys are ignored while paused
      if (e.code === "Escape" && !hud.mapOpen && !hud.phoneOpen) { usePauseStore.getState().toggle(); return; }
      if (usePauseStore.getState().open) return;
      if (e.code === "KeyE") actionUse();
      else if (e.code === "KeyB") actionSwitchVehicle();
      else if (e.code === "KeyC") actionCamera();
      else if (e.code === "KeyL") actionLights();
      else if (e.code === "KeyM") actionMute();
      else if (e.code === "KeyV") actionWeather();
      else if (e.code === "KeyG") actionMap();
      else if (e.code === "KeyP") actionPhone();
      else if (e.code === "KeyQ") actionGraphics();
      else if (e.code === "KeyK") actionNextCar();
      else if (e.code === "KeyR") {
        if (hud.active === "car") actionResetCar();
      } else if (e.code === "KeyH") hud.toggleControlsVisible();
      else if (e.code === "Escape") {
        hud.setMapOpen(false);
        hud.setPhoneOpen(false);
      }
    };
    // iOS only counts touchend/pointerup (not pointerdown) as a user gesture
    // that may start audio, so unlock on all of them, not just the first one
    const onGesture = () => unlockAudio();
    // iOS Safari ignores user-scalable=no: block pinch/double-tap zoom and
    // rubber-band scrolling of the page itself, but let real scroll lists
    // (map destinations, phone) keep scrolling
    const onTouchMove = (e: TouchEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest && el.closest("#maplist, [data-scroll]")) return;
      if (e.cancelable) e.preventDefault();
    };
    const onGestureStart = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("pointerup", onGesture);
    window.addEventListener("touchend", onGesture);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("gesturestart", onGestureStart);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("pointerup", onGesture);
      window.removeEventListener("touchend", onGesture);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("gesturestart", onGestureStart);
    };
  }, []);

  // quality tier (and the auto-quality pixel-ratio step) → one profile object
  const dprScale = useGfxStore((s) => s.dprScale);
  const safe = useGfxStore((s) => s.safe);
  const prof = profileFor(quality, dprScale, safe);
  // a lost WebGL context (iOS/Android under memory pressure) used to leave a
  // frozen canvas forever; remount the Canvas when the browser restores it
  const [ctxKey, setCtxKey] = useState(0);
  const canvasKey = `${quality}:${ctxKey}`;
  // The key of the Canvas that is mounted RIGHT NOW. R3F force-loses the old
  // canvas' context when it unmounts it (quality switch, remount): that
  // "webglcontextlost" must not count — before v1.5 it scheduled another
  // remount, which force-lost that canvas too… an endless reload loop.
  const liveKey = useRef(canvasKey);
  // layout effect: updated in the commit, before R3F's deferred unmount of the old canvas
  useLayoutEffect(() => { liveKey.current = canvasKey; }, [canvasKey]);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  // Crash guard: one real GPU problem (context lost, or the render loop wedged)
  // -> safe HIGH; a second one -> LOW. Never a page reload, and at most
  // MAX_REMOUNTS canvas remounts per page so nothing can loop.
  const gpuTrouble = useRef(0);
  const remounts = useRef(0);
  const recover = useCallback((why: string) => {
    gpuTrouble.current++;
    try { saveGame(); } catch { /* best effort */ }
    const g = useGfxStore.getState();
    const hud = useHudStore.getState();
    console.warn(`[td] ${why} (#${gpuTrouble.current}, quality ${g.quality}${g.safe ? " safe" : ""})`);
    if (remounts.current >= MAX_REMOUNTS) {
      hud.showMsg("GRAPHICS STOPPED — reopen the game");
      return;
    }
    remounts.current++;
    if (g.quality === "high" && !g.safe && gpuTrouble.current === 1) {
      g.setSafe(true);
      hud.showMsg("GRAPHICS: HIGH (safe mode — GPU memory)");
      setCtxKey((k) => k + 1);
    } else if (g.quality === "high") {
      hud.showMsg("GRAPHICS: LOW (GPU ran out of memory)");
      g.setQuality("low"); // new key -> remount
    } else {
      if (g.dprScale > 0.72) g.setDprScale(0.7);
      hud.showMsg("GRAPHICS RESET…");
      setCtxKey((k) => k + 1);
    }
  }, []);

  // Frame watchdog: page visible, game loaded, JS thread alive (this interval
  // runs) but no frame rendered — if the GL context is lost (and the browser
  // never restores it) or nothing has rendered for 30 s, the GL side is wedged
  // (GPU reset on Android emulators…): recover() instead of leaving the player
  // on a frozen picture. Conservative so a merely slow device is never hit. ?wd=0 off.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("wd") === "0") return;
    let lastFrames = renderedFrames();
    let stalled = 0;
    const id = window.setInterval(() => {
      const f = renderedFrames();
      const ready = useLoadStore.getState().phase === "ready";
      if (f !== lastFrames || document.visibilityState !== "visible" || !ready) { stalled = 0; lastFrames = f; return; }
      stalled++;
      const lost = glRef.current?.getContext().isContextLost() ?? false;
      if ((lost && stalled >= 6) || stalled >= 30) {
        stalled = 0;
        recover("render loop stalled — remounting the canvas");
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [recover]);


  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas
        key={canvasKey}
        shadows={prof.shadows === "soft" ? "percentage" : prof.shadows === "basic" ? "basic" : false}
        dpr={prof.dpr}
        camera={{ fov: 65, near: 0.1, far: 400 }}
        gl={{ toneMappingExposure: 1.5, antialias: prof.antialias, powerPreference: "high-performance", stencil: false }}
        style={{ touchAction: "none" }}
        onCreated={({ gl }) => {
          glRef.current = gl;
          // getProgramInfoLog/getShaderInfoLog after every link force a sync
          // wait on the GPU driver (seconds on weak phones); only do it with ?debug
          gl.debug.checkShaderErrors = new URLSearchParams(location.search).has("debug");
          // a throwing render must never take the whole frame loop with it
          const render = gl.render.bind(gl);
          let renderErrs = 0;
          gl.render = (sc, cam) => {
            try { render(sc, cam); } catch (err) {
              if (renderErrs++ < 3) console.warn("[td] render error", err);
            }
          };
          const el = gl.domElement;
          const myKey = canvasKey;
          let restoreTimer = 0;
          el.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            if (liveKey.current !== myKey) return; // our own unmount (forceContextLoss), not a GPU problem
            useHudStore.getState().showMsg("GRAPHICS RESET…");
            // some Android WebViews never fire "restored" — recover anyway
            window.clearTimeout(restoreTimer);
            restoreTimer = window.setTimeout(() => { if (liveKey.current === myKey) recover("WebGL context lost"); }, 3000);
          });
          el.addEventListener("webglcontextrestored", () => {
            window.clearTimeout(restoreTimer);
            if (liveKey.current === myKey) recover("WebGL context lost + restored");
          });
        }}
      >
        <Suspense fallback={null}>
          <PerfProbe />
          <SinglePassTransparent />
          <ReadyGate stages={BOOT_STAGES} />
          <AutoQuality />
          <DprSync />
          <SkyCycle />
          {!isBigCity() && <Skyline />}
          <Clouds />
          <FogFarSync />
          <LightPool count={prof.pointLights} />
          {/* image lighting: HDR on HIGH (own Suspense so the 1.4 MB file never
              blocks the first frame), a tiny generated sky env on LOW */}
          {prof.hdrEnv ? (
            <Suspense fallback={null}>
              <Environment files={asset("/hdri/day_1k.hdr")} background={false} environmentIntensity={0.9} />
            </Suspense>
          ) : (
            <LowEnvironment />
          )}

          {/* runs after SkyCycle each frame (component render order = useFrame
              registration order) so it blends onto the SAME scene.fog SkyCycle
              already set this frame, rather than fighting it — see Weather.tsx */}
          <Weather />
          {/* outside <Physics> on purpose — lights have no bodies/colliders,
              and this one only reads worldState, which every vehicle writes */}
          <Headlights />
          <MouseLook />
          {/* variable step (one Rapier step per rendered frame, dt capped in
              lib/physicsGuard): every mover is a kinematic body driven by
              per-frame arcade math, so a fixed 1/60 accumulator only ever
              dropped or doubled their moves (0 steps on some frames at 90/120 Hz,
              2-4 steps per frame on a slow phone) — stutter plus wasted work */}
          <Physics gravity={[0, -9.81, 0]} timeStep="vary" interpolate={false} paused={paused}>
            <PhysicsProbe />
            {/* stage 0 — what the first frame needs */}
            <group name="City"><City /></group>
            <Water />
            <Car />
            {/* the rest is mounted a stage at a time behind the loading screen
                (components/ReadyGate.tsx), then every shader is pre-compiled */}
            <Deferred stage={1}>
              <group name="Traffic"><Traffic /></group>
              <TrafficSignals />
              <Missions />
              <group name="Pedestrians"><Suspense fallback={<BootHold />}><Pedestrians /></Suspense></group>
              <Player />
            </Deferred>
            <Deferred stage={2}>
              <Boat />
              <Boat kind="boat2" spawn={{ x: 565, z: 40, h: Math.PI / 2 }} />
              <Boat kind="boat3" spawn={{ x: 565, z: 62, h: Math.PI / 2 }} />
              <Bike />
              <PoliceCar />
              {/* the airport's gate-guard jeep (components/Airport.tsx's old
                  GateGuardPost) — the two gate interceptors are police patrol
                  lanes in components/Traffic.tsx */}
              <PoliceJeep />
              <PatrolBoat />
              {/* parked commercial traffic, mountable via E like policeCar/
                  patrolBoat — see lib/vehicleState.ts for their spawn spots */}
              <CommercialVehicle kind="jeep" color="#4a6a8a" />
              <CommercialVehicle kind="truck" color="#5a5a5a" />
              <CommercialVehicle kind="bus" color="#2a5a3a" />
              <Props />
            </Deferred>
            <Deferred stage={3}>
              {!isBigCity() && <group name="Landmarks"><TashkentLandmarks /></group>}
              <group name="Highway"><Highway /></group>
              <Cull name="PoliceStation"><PoliceStation /></Cull>
              <Cull name="Mizu"><MergeStatic name="Mizu" byLook><MizuRestaurant /></MergeStatic></Cull>
              <Cull name="Marina"><Marina /></Cull>
            </Deferred>
            <Deferred stage={4}>
              <Cull name="Airport"><Airport /></Cull>
              <Plane />
              <Helicopter />
              {/* FORT NEON's own gunship on the compound's second helipad —
                  same rig, olive-drab body, see lib/militaryBase.ts */}
              <Helicopter kind="militaryHeli" bodyMat={OLIVE_HELI_MAT} />
              <PoliceJet />
              {/* every parked wide-body is its own mountable vehicle — walk up
                  + E at any gate/bay to fly it (see components/DrivableAirliner.tsx) */}
              <DrivableAirliner id="airliner1" liveryColor={LIVERIES[0]} />
              <DrivableAirliner id="airliner2" liveryColor={LIVERIES[1]} />
              <DrivableAirliner id="airliner3" liveryColor={LIVERIES[2]} />
              <DrivableAirliner id="airlinerCargo" liveryColor={LIVERIES[3]} cargo />
              {/* FORT NEON's apron fighters — one mountable airframe per
                  lib/militaryBase.ts JET_APRON slot */}
              <DrivableFighterJet id="jet1" />
              <DrivableFighterJet id="jet2" />
              <DrivableFighterJet id="jet3" />
            </Deferred>
            <Deferred stage={5}>
              <Cull name="MilitaryBase"><MilitaryBase /></Cull>
              <Tank />
              <Cull name="Club"><Club /></Cull>
              <Cull name="ClubInterior"><ClubInterior /></Cull>
              <group name="EnterableBuildings"><EnterableBuildings /></group>
              <Cull name="GunStore"><GunStore /></Cull>
            </Deferred>
          </Physics>
          <Deferred stage={6}>
            <AudioEngine />
            {/* one instance per nitro-capable ground vehicle. halfLen per kind
                mirrors each vehicle's own collider box. Boats/aircraft
                excluded — see NitroFX.tsx. */}
            <NitroFX vehicleKey="car" halfLen={2.3} />
            <NitroFX vehicleKey="bike" halfLen={0.95} />
            <NitroFX vehicleKey="policeCar" halfLen={2.4} />
            <NitroFX vehicleKey="policeJeep" halfLen={2.2} />
            <NitroFX vehicleKey="jeep" halfLen={1.8} />
            <NitroFX vehicleKey="truck" halfLen={2.8} />
            <NitroFX vehicleKey="bus" halfLen={3.25} />
            <NitroFX vehicleKey="tank" halfLen={4.76} />
            <DriftFX />
            <Debris />
            {/* hidden: lets the boot precompile cover the K-garage BMW M3
                Competition and the licence-plate material */}
            <Suspense fallback={<BootHold />}><PrewarmAssets /></Suspense>
            <TankCombat />
            <WaypointTracker />
          </Deferred>
          {/* threshold matches the original's UnrealBloomPass threshold (.82) — only
              true emissive neon blooms. DynamicBloom ports the original's
              per-frame strength formula. Desktop HIGH only: on phones the
              extra full-screen passes cost more than the whole scene. */}
          {prof.postFX && prof.safe ? (
          // crash-guard safe HIGH: no AO targets at all
          <EffectComposer multisampling={0}>
            <DynamicBloom />
            <SMAA />
          </EffectComposer>
          ) : prof.postFX ? (
          <EffectComposer multisampling={0}>
            {/* ambient occlusion first (contact/crevice shadowing before
                bloom adds light), SMAA last (smooths the final composited
                edges, not just the raw geometry pass). Half-res AO (v1.5):
                a quarter of the AO targets' GPU memory. */}
            <N8AO aoRadius={2} distanceFalloff={1} intensity={3} quality="medium" halfRes />
            <DynamicBloom />
            <SMAA />
          </EffectComposer>
          ) : null}
        </Suspense>
      </Canvas>
      <CrashSentinel />
      <LoadingScreen />
      <HUD />
      <TouchControls />
    </div>
  );
}
