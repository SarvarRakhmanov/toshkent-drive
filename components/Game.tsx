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
import { Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { EffectComposer, Bloom, N8AO, SMAA } from "@react-three/postprocessing";
import type { BloomEffect } from "postprocessing";
import { SkyCycle } from "@/components/SkyCycle";
import { skyState } from "@/lib/skyState";
import { Weather } from "@/components/Weather";
import { cycleWeather } from "@/lib/weatherState";
import { City } from "@/components/City";
import { Water } from "@/components/Water";
import { Car } from "@/components/Car";
import { Boat } from "@/components/Boat";
import { Bike } from "@/components/Bike";
import { Traffic } from "@/components/Traffic";
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
import { useGfxStore } from "@/lib/gfx";
import { usePlayerCarStore, PLAYER_CARS } from "@/lib/playerCar";
import { requestCarSummon } from "@/lib/vehicleSummon";
import { worldState } from "@/lib/worldState";
import { asset } from "@/lib/asset";
import { useHudStore, LIGHT_MODES } from "@/lib/hudStore";
import { initAudio, toggleMute, setMuted } from "@/lib/audio";
import { loadSave, saveGame } from "@/lib/saveGame";
import { interiorDoorAction } from "@/lib/interiors";
import { toggleVehicleFoot } from "@/lib/player";
import { boatSwapAction } from "@/lib/boatSwap";
import { seatAction } from "@/lib/clubSeats";
import { armoryPickupAction } from "@/lib/armory";
import { ticketPickupAction } from "@/lib/ticketBooth";
import { stealTrafficAction } from "@/lib/steal";
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
import { Headlights } from "@/components/Headlights";
import { MouseLook } from "@/components/MouseLook";
import { Highway } from "@/components/Highway";
import { MilitaryBase, OLIVE_HELI_MAT } from "@/components/MilitaryBase";
import { Tank } from "@/components/Tank";
import { TankCombat } from "@/components/TankCombat";

const CYCLABLE = new Set(["car", "bike", "boat"]);

// original's exact per-frame rescale (updateDayNight ~line 7016): dim by day
// so daylight isn't blown out, full glow at night for the neon signs
function DynamicBloom() {
  const ref = useRef<BloomEffect>(null);
  useFrame(() => {
    if (ref.current) ref.current.intensity = 0.18 + skyState.nightK * 0.72;
  });
  return <Bloom ref={ref} luminanceThreshold={0.7} luminanceSmoothing={0.2} mipmapBlur />;
}

export default function Game() {
  const quality = useGfxStore((s) => s.quality);
  const high = quality === "high";
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
    return () => {
      clearInterval(interval);
      window.removeEventListener("beforeunload", saveGame);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      initAudio(); // no-ops once already initialized; needs a real user gesture, so first key does it
      const hud = useHudStore.getState();
      if (e.code === "KeyE") {
        // ticket pickup beats door (need the ticket before the VENU gate matters) beats
        // sitting/standing beats gun pickup beats boat-swap beats mount beats stealing an NPC
        if (!ticketPickupAction() && !interiorDoorAction() && !seatAction() && !armoryPickupAction() && !boatSwapAction() && !toggleVehicleFoot()) stealTrafficAction();
      } else if (e.code === "KeyB") {
        hud.toggleActive();
        hud.showMsg("SWITCHED TO: " + hud.vehicleName());
      } else if (e.code === "KeyC") {
        hud.cycleCamMode();
      } else if (e.code === "KeyL") {
        hud.showMsg("HEADLIGHTS: " + LIGHT_MODES[hud.cycleLightMode()]);
      } else if (e.code === "KeyM") {
        hud.showMsg(toggleMute() ? "MUTED" : "UNMUTED");
      } else if (e.code === "KeyV") {
        hud.showMsg("WEATHER: " + cycleWeather().toUpperCase());
      } else if (e.code === "KeyG") {
        hud.setMapOpen(!hud.mapOpen);
      } else if (e.code === "KeyP") {
        hud.setPhoneOpen(!hud.phoneOpen);
      } else if (e.code === "KeyQ") {
        saveGame();
        const g = useGfxStore.getState();
        g.toggle();
        hud.showMsg("GRAPHICS: " + useGfxStore.getState().quality.toUpperCase());
      } else if (e.code === "KeyK") {
        usePlayerCarStore.getState().next();
        hud.showMsg("CAR: " + PLAYER_CARS[usePlayerCarStore.getState().index].name);
      } else if (e.code === "KeyR" && hud.active === "car") {
        // reset / respawn: upright on the nearest road centre-lane, facing along it
        const { px, pz, heading } = worldState;
        const xs = Math.round((px - 50) / 100) * 100 + 50;
        const zs = Math.round((pz - 50) / 100) * 100 + 50;
        const along = (a: number, b: number) => (Math.cos(heading - a) >= Math.cos(heading - b) ? a : b);
        if (Math.abs(px - xs) <= Math.abs(pz - zs)) requestCarSummon(xs + 2.5, pz, along(0, Math.PI));
        else requestCarSummon(px, zs + 2.5, along(Math.PI / 2, -Math.PI / 2));
        hud.showMsg("CAR RESET");
      } else if (e.code === "KeyH") {
        hud.toggleControlsVisible();
      } else if (e.code === "Escape") {
        hud.setMapOpen(false);
        hud.setPhoneOpen(false);
      }
    };
    const onClick = () => initAudio();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onClick, { once: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onClick);
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <Canvas key={quality} shadows={high ? "soft" : false} dpr={high ? [1, 1.5] : 0.85} camera={{ fov: 65, near: 0.1, far: 1000 }} gl={{ toneMappingExposure: 1.5 }}>
        <Suspense fallback={null}>
          <SkyCycle />
          {/* IBL only (background:false leaves SkyCycle's own scene.background/
              fog alone) — gives metal/glass/car-paint materials something to
              actually reflect instead of flat lighting with no environment */}
          <Environment files={asset("/hdri/day_1k.hdr")} background={false} environmentIntensity={0.9} />

          {/* runs after SkyCycle each frame (component render order = useFrame
              registration order) so it blends onto the SAME scene.fog SkyCycle
              already set this frame, rather than fighting it — see Weather.tsx */}
          <Weather />
          {/* outside <Physics> on purpose — lights have no bodies/colliders,
              and this one only reads worldState, which every vehicle writes */}
          <Headlights />
          <MouseLook />
          <AudioEngine />
          {/* one instance per nitro-capable ground vehicle — was car-only,
              so boosting on the bike/police cruiser/jeep/truck/bus/tank
              produced zero smoke or flame at all. halfLen per kind mirrors
              each vehicle's own collider box (see each component's carBox/
              bikeBox/tankBox, or CommercialVehicle.tsx's SPEC for jeep/
              truck/bus). Boats/aircraft still excluded — see NitroFX.tsx. */}
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
          <TankCombat />
          <WaypointTracker />
          {/* fixed step instead of the default "vary" (tied to render frame
              delta) — a variable step feeds a jittery dt into Rapier every
              frame, which reads as inconsistent/jittery driving feel under
              any framerate variance; a fixed step decouples physics from
              render rate (accumulator pattern, standard fixed-timestep fix) */}
          <Physics gravity={[0, -9.81, 0]} timeStep={1 / 60}>
            <City />
            <Water />
            <Car />
            <Boat />
            <Boat kind="boat2" spawn={{ x: 565, z: 40, h: Math.PI / 2 }} />
            <Boat kind="boat3" spawn={{ x: 565, z: 62, h: Math.PI / 2 }} />
            <Bike />
            <PoliceCar />
            {/* the airport's gate-guard jeep (components/Airport.tsx's old
                GateGuardPost) — the two gate interceptors are now just more
                police patrol lanes (components/Traffic.tsx) sharing this
                same PoliceCar's "policeCar" identity like every other police
                lane already does, so no separate owned copy is needed for them */}
            <PoliceJeep />
            <PatrolBoat />
            <Plane />
            <Helicopter />
            {/* FORT NEON's own gunship on the compound's second helipad —
                same rig, olive-drab body, see lib/militaryBase.ts */}
            <Helicopter kind="militaryHeli" bodyMat={OLIVE_HELI_MAT} />
            <PoliceJet />
            {/* every parked wide-body is its own mountable vehicle — walk up
                + E at any gate/bay to fly it (see components/DrivableAirliner.tsx);
                the broken jet in the maintenance hangar is deliberately not
                one of these, it never flies */}
            <DrivableAirliner id="airliner1" liveryColor={LIVERIES[0]} />
            <DrivableAirliner id="airliner2" liveryColor={LIVERIES[1]} />
            <DrivableAirliner id="airliner3" liveryColor={LIVERIES[2]} />
            <DrivableAirliner id="airlinerCargo" liveryColor={LIVERIES[3]} cargo />
            {/* FORT NEON's apron fighters — decoration until now; one
                mountable airframe per lib/militaryBase.ts JET_APRON slot
                (components/MilitaryBase.tsx now draws only the apron slab) */}
            <DrivableFighterJet id="jet1" />
            <DrivableFighterJet id="jet2" />
            <DrivableFighterJet id="jet3" />
            {/* parked commercial traffic, mountable via E like policeCar/
                patrolBoat — see lib/vehicleState.ts for their spawn spots */}
            <CommercialVehicle kind="jeep" color="#4a6a8a" />
            <CommercialVehicle kind="truck" color="#5a5a5a" />
            <CommercialVehicle kind="bus" color="#2a5a3a" />
            <PoliceStation />
            <MizuRestaurant />
            <Marina />
            <Airport />
            <Highway />
            <MilitaryBase />
            <Tank />
            <Props />
            <TashkentLandmarks />
            <Traffic />
            <Pedestrians />
            <Player />
            <Club />
            <ClubInterior />
            <EnterableBuildings />
            <GunStore />
          </Physics>
          {/* threshold matches the original's UnrealBloomPass threshold (.82) — only
              true emissive neon blooms, not the lit ground/facades. Strength is NOT
              fixed in the original either: updateDayNight rescales
              bloomPass.strength=0.18+nightK*0.72 every frame (dim by day, full glow
              at night) — DynamicBloom below ports that same formula. */}
          {high ? (
          <EffectComposer>
            {/* ambient occlusion first (contact/crevice shadowing before
                bloom adds light), SMAA last (smooths the final composited
                edges, not just the raw geometry pass) */}
            <N8AO aoRadius={2} distanceFalloff={1} intensity={3} quality="high" />
            <DynamicBloom />
            <SMAA />
          </EffectComposer>
          ) : null}
        </Suspense>
      </Canvas>
      <HUD />
    </div>
  );
}
