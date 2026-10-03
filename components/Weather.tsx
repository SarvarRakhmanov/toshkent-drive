"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { weatherState, pickWeather } from "@/lib/weatherState";
import { coatScene, weatherCoatUniforms } from "@/lib/weatherCoat";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { vehicleState } from "@/lib/vehicleState";
import { getSunnyEnvMap } from "@/lib/skyEnv";
if (typeof window !== "undefined") {
  (window as unknown as { __ncdTp: typeof requestPlayerTeleport }).__ncdTp = requestPlayerTeleport;
  (window as unknown as { __ncdVeh: typeof vehicleState }).__ncdVeh = vehicleState;
}

// Rendered after <SkyCycle/> in Game.tsx so this useFrame runs after its
// day/night one each frame: SkyCycle owns scene.fog's base color/near/far off
// day/night, this component blends weather on top of that SAME scene.fog
// object afterward (near/far target + a grey tint), rather than merging into
// SkyCycle — weather is an independent, randomly-timed system layered on a
// clock-driven one, and keeping them in separate files matches how the
// original also kept updateDayNight()/updateWeather() as two functions that
// both just happen to write the same scene.fog.

// original's rainTex: an 8x64 vertical soft gradient billboard (index.html ~3656)
const rainCanvas = document.createElement("canvas");
rainCanvas.width = 8;
rainCanvas.height = 64;
const rg = rainCanvas.getContext("2d")!;
const grad = rg.createLinearGradient(0, 0, 0, 64);
grad.addColorStop(0, "rgba(200,225,255,0)");
grad.addColorStop(0.5, "rgba(200,225,255,.9)");
grad.addColorStop(1, "rgba(200,225,255,0)");
rg.fillStyle = grad;
rg.fillRect(0, 0, 8, 64);
const rainTex = new THREE.CanvasTexture(rainCanvas);

const RAIN_N = 500;
const rainY = new Float32Array(RAIN_N);
// same imperative BufferGeometry-at-module-scope idiom as MizuRestaurant.tsx's
// GABLE_ROOF_GEO — plugged into <points geometry={...}> below rather than JSX
// bufferAttribute children
const rainGeo = (() => {
  const pos = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 55;
    pos[i * 3 + 1] = rainY[i] = Math.random() * 40;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * 55;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
})();

// snow: soft round dot (vs rain's vertical streak), same procedural-canvas-
// texture idiom as rainTex above — ported the visual idea from
// rauschermate/react-weather-effects' SnowEffect, not its full custom GLSL
// shader (that demo's per-flake rotation/distortion/flip is built for a
// static-camera page where snow IS the content; here it's ambient weather
// glimpsed while driving, so the existing rain Points/PointsMaterial pattern
// already covers it for a fraction of the code).
const snowCanvas = document.createElement("canvas");
snowCanvas.width = snowCanvas.height = 32;
const sg = snowCanvas.getContext("2d")!;
const srad = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
srad.addColorStop(0, "rgba(255,255,255,.95)");
srad.addColorStop(1, "rgba(255,255,255,0)");
sg.fillStyle = srad;
sg.fillRect(0, 0, 32, 32);
const snowTex = new THREE.CanvasTexture(snowCanvas);

const SNOW_N = 400;
const snowY = new Float32Array(SNOW_N);
const snowBaseX = new Float32Array(SNOW_N);
const snowBaseZ = new Float32Array(SNOW_N);
const snowPhase = new Float32Array(SNOW_N);
const snowGeo = (() => {
  const pos = new Float32Array(SNOW_N * 3);
  for (let i = 0; i < SNOW_N; i++) {
    pos[i * 3] = snowBaseX[i] = (Math.random() * 2 - 1) * 55;
    pos[i * 3 + 1] = snowY[i] = Math.random() * 40;
    pos[i * 3 + 2] = snowBaseZ[i] = (Math.random() * 2 - 1) * 55;
    snowPhase[i] = Math.random() * Math.PI * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
})();

const cGrey = new THREE.Color(0x8a94a0);
const cWarm = new THREE.Color(0xfff0c8);
const tmpColor = new THREE.Color();

// Same fixed direction as SkyCycle.tsx's sunRef position ([60,80,30],
// normalized) — that light is the sun, so the visible disc has to sit in the
// same spot in the sky or the two would visibly disagree about where the
// light is coming from.
const SUN_DIST = 300;
const SUN_MAG = Math.hypot(60, 80, 30);
const SUN_DIR = new THREE.Vector3(60 / SUN_MAG, 80 / SUN_MAG, 30 / SUN_MAG);

// Bright core fading to a soft warm halo — additive + fog:false (see BEAM in
// SupercarBody.tsx for the same "glow that ignores scene fog" idiom) so it
// still reads as a glowing disc at 300 units out instead of fading to the
// fog color like ordinary geometry would.
const SUN_TEX = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,1)");
  r.addColorStop(0.25, "rgba(255,244,214,0.95)");
  r.addColorStop(0.55, "rgba(255,214,140,0.35)");
  r.addColorStop(1, "rgba(255,214,140,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();

export function Weather() {
  const { scene, gl } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.PointsMaterial>(null);
  const snowPointsRef = useRef<THREE.Points>(null);
  const snowMaterialRef = useRef<THREE.PointsMaterial>(null);
  const clockRef = useRef(0);
  // re-scan periodically (not once) so buildings/props/traffic streamed in
  // after mount (this is a chunk-streamed open world) still get coated
  const coatScanRef = useRef(0);
  const sunGroupRef = useRef<THREE.Group>(null);
  const sunCoreRef = useRef<THREE.Sprite>(null);
  const sunHaloRef = useRef<THREE.Sprite>(null);

  // imperatively mutating scene.fog/background/hemi here every frame is the
  // documented R3F pattern (see SkyCycle.tsx's own useFrame, same rationale)
  // eslint-disable-next-line react-hooks/immutability
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const mat = materialRef.current;
    const pts = pointsRef.current;
    if (!mat || !pts || !scene.fog) return;

    if (useHudStore.getState().inClub) {
      mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0, Math.min(1, dt * 3));
      weatherState.wetGrip = THREE.MathUtils.lerp(weatherState.wetGrip, 1, dt);
      return;
    }

    weatherState.timer -= dt;
    if (weatherState.timer <= 0) {
      const nw = pickWeather();
      if (nw !== weatherState.kind) {
        weatherState.kind = nw;
        useHudStore.getState().showMsg("WEATHER: " + weatherState.kind.toUpperCase());
      }
      weatherState.timer = 100 + Math.random() * 100;
    }

    const isRain = weatherState.kind === "rain";
    const isFog = weatherState.kind === "fog";
    const isOver = weatherState.kind === "overcast";
    const isSnow = weatherState.kind === "snow";
    const isSunny = weatherState.kind === "sunny";

    const tgtNear = isFog ? 18 : isSnow ? 40 : isRain ? 55 : isOver ? 95 : isSunny ? 140 : 110;
    const tgtFar = isFog ? 95 : isSnow ? 150 : isRain ? 210 : isOver ? 320 : isSunny ? 480 : 430;
    const fog = scene.fog as THREE.Fog;
    // eslint-disable-next-line react-hooks/immutability -- see note above useFrame
    fog.near = THREE.MathUtils.lerp(fog.near, tgtNear, Math.min(1, dt * 0.5));
    fog.far = THREE.MathUtils.lerp(fog.far, tgtFar, Math.min(1, dt * 0.5));

    const greyK = isFog ? 0.55 : isSnow ? 0.45 : isRain ? 0.4 : isOver ? 0.3 : 0;
    if (greyK > 0) {
      tmpColor.copy(fog.color).lerp(cGrey, greyK * 0.5);
      fog.color.copy(tmpColor);
      if (scene.background instanceof THREE.Color) scene.background.copy(tmpColor);
      // hemi dimming matches the original's `hemi.intensity*=1-greyK*0.35`,
      // applied after SkyCycle's own per-frame hemi.intensity set — no ref
      // plumbing needed for a light SkyCycle already owns, a scene lookup for
      // the one hemisphere light is cheap and keeps the two files decoupled
      const hemi = scene.getObjectByProperty("type", "HemisphereLight") as THREE.HemisphereLight | undefined;
      if (hemi) hemi.intensity *= 1 - greyK * 0.35;
    }
    // sunny: a warm golden tint instead of grey, and the actual sun light/
    // disc/reflections below — everything the user asked for ("shiny",
    // "reflects on things", "reflects on mirrors")
    if (isSunny) {
      tmpColor.copy(fog.color).lerp(cWarm, 0.14);
      fog.color.copy(tmpColor);
      if (scene.background instanceof THREE.Color) scene.background.copy(tmpColor);
      // the actual sun (SkyCycle.tsx's sunRef, distinguished from its fill
      // light sibling by castShadow — getObjectByProperty can only match one
      // property, so this needs a real traversal): brighter and warmer than
      // a plain clear day
      let sun: THREE.DirectionalLight | undefined;
      scene.traverse((obj) => {
        if (!sun && (obj as THREE.DirectionalLight).isDirectionalLight && (obj as THREE.DirectionalLight).castShadow) {
          sun = obj as THREE.DirectionalLight;
        }
      });
      if (sun) {
        sun.intensity *= 1.35;
        sun.color.lerp(new THREE.Color(0xfff2d0), 0.4);
      }
    }

    const rainTarget = isRain ? 0.55 : 0;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, rainTarget, Math.min(1, dt * 3));
    if (mat.opacity > 0.01) {
      pts.position.set(worldState.px, 0, worldState.pz);
      const posAttr = pts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < RAIN_N; i++) {
        rainY[i] -= dt * 48;
        if (rainY[i] < 0) rainY[i] += 40;
        posAttr.setY(i, rainY[i]);
      }
      posAttr.needsUpdate = true;
    }

    const snowMat = snowMaterialRef.current;
    const snowPts = snowPointsRef.current;
    if (snowMat && snowPts) {
      clockRef.current += dt;
      const t = clockRef.current;
      const snowTarget = isSnow ? 0.6 : 0;
      snowMat.opacity = THREE.MathUtils.lerp(snowMat.opacity, snowTarget, Math.min(1, dt * 3));
      if (snowMat.opacity > 0.01) {
        snowPts.position.set(worldState.px, 0, worldState.pz);
        const posAttr = snowPts.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < SNOW_N; i++) {
          snowY[i] -= dt * 10; // slower fall + sway vs rain's straight-down streak
          if (snowY[i] < 0) snowY[i] += 40;
          posAttr.setX(i, snowBaseX[i] + Math.sin(t * 0.6 + snowPhase[i]) * 1.5);
          posAttr.setY(i, snowY[i]);
          posAttr.setZ(i, snowBaseZ[i] + Math.cos(t * 0.5 + snowPhase[i]) * 1.5);
        }
        posAttr.needsUpdate = true;
      }
    }

    // snow packs the road tighter than rain wets it — lower grip target
    weatherState.wetGrip = THREE.MathUtils.lerp(
      weatherState.wetGrip,
      isRain ? 0.5 : isSnow ? 0.3 : 1,
      Math.min(1, dt * 0.8)
    );

    // ground/car-roof/tree-top/building-top wet & snow-coat shader — slow
    // ramp (~3s) so accumulation reads as gradual, not a hard cut
    weatherCoatUniforms.uSnowAmount.value = THREE.MathUtils.lerp(
      weatherCoatUniforms.uSnowAmount.value,
      isSnow ? 1 : 0,
      Math.min(1, dt * 0.3)
    );
    weatherCoatUniforms.uWetAmount.value = THREE.MathUtils.lerp(
      weatherCoatUniforms.uWetAmount.value,
      isRain ? 1 : 0,
      Math.min(1, dt * 0.3)
    );
    weatherCoatUniforms.uSunnyAmount.value = THREE.MathUtils.lerp(
      weatherCoatUniforms.uSunnyAmount.value,
      isSunny ? 1 : 0,
      Math.min(1, dt * 0.3)
    );
    coatScanRef.current -= dt;
    if (coatScanRef.current <= 0) {
      coatScene(scene);
      coatScanRef.current = 2;
    }

    // real specular reflections (car mirrors/windshields, the sea, chrome
    // trim) via IBL — three.js samples scene.environment automatically on
    // any metalness>0 material, nothing per-material to wire up. Baked once
    // on the first sunny transition (needs a renderer), then just faded via
    // environmentIntensity so it never has to regenerate.
    const sunnyAmt = weatherCoatUniforms.uSunnyAmount.value;
    if (isSunny && !scene.environment) {
      // eslint-disable-next-line react-hooks/immutability -- see note above useFrame
      scene.environment = getSunnyEnvMap(gl);
    }
    if (scene.environment) scene.environmentIntensity = sunnyAmt;

    // the visible sun disc itself — parented to nothing, repositioned off
    // the player each frame (same "follow px/pz, fixed sky offset" trick the
    // rain/snow points above use), opacity following the same ramp so it
    // fades in/out with everything else rather than popping.
    if (sunGroupRef.current) {
      sunGroupRef.current.position.set(
        worldState.px + SUN_DIR.x * SUN_DIST,
        SUN_DIR.y * SUN_DIST,
        worldState.pz + SUN_DIR.z * SUN_DIST
      );
    }
    if (sunCoreRef.current) (sunCoreRef.current.material as THREE.SpriteMaterial).opacity = sunnyAmt;
    if (sunHaloRef.current) (sunHaloRef.current.material as THREE.SpriteMaterial).opacity = sunnyAmt * 0.8;
  });

  return (
    <>
    <group ref={sunGroupRef}>
      <sprite ref={sunHaloRef} scale={[55, 55, 1]}>
        <spriteMaterial map={SUN_TEX ?? undefined} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </sprite>
      <sprite ref={sunCoreRef} scale={[18, 18, 1]}>
        <spriteMaterial map={SUN_TEX ?? undefined} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </sprite>
    </group>
    <points ref={pointsRef} geometry={rainGeo}>
      <pointsMaterial
        ref={materialRef}
        color={0xaad4ff}
        size={0.5}
        map={rainTex}
        transparent
        opacity={0}
        fog={false}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
    <points ref={snowPointsRef} geometry={snowGeo}>
      <pointsMaterial
        ref={snowMaterialRef}
        color={0xffffff}
        size={0.6}
        map={snowTex}
        transparent
        opacity={0}
        fog={false}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
    </>
  );
}
