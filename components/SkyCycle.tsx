"use client";

import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Sky } from "@react-three/drei";
import { useHudStore } from "@/lib/hudStore";
import { skyState } from "@/lib/skyState";
import { loadSave } from "@/lib/saveGame";
import { worldState } from "@/lib/worldState";

// Exact colors/values from the original index.html's updateDayNight() (~line
// 6993-7040) and its renderer/light setup (~line 3548-3582) — this file had
// drifted from those: a flat AmbientLight instead of the original's sky/
// ground HemisphereLight, no fillLight at all, a sun that never changes
// color, and toneMappingExposure left at the R3F default (1.0) instead of
// the original's always-boosted 1.08-1.26. That gap, not a deliberately
// different look, is why night driving reads near-black — this restores the
// original's actual numbers. (The original derives its dayK/nightK from a
// true sun-elevation angle; this still drives off the existing sine-phase
// dayK/nightK below rather than rebuilding that — same numbers, simpler
// driver, see SUMMARY.md for what's still worth tightening later.)
const DAY = new THREE.Color(0x7ec4f2);
const NIGHT = new THREE.Color(0x05070f);
const SUN_NIGHT = new THREE.Color(0x7d8fc8); // original's moonlight tint
const SUN_DAY = new THREE.Color().setHSL(0.1, 0.5, 0.75); // original's warm daylight tint

export function SkyCycle() {
  const { scene, gl } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const sunTargetRef = useRef<THREE.Object3D>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  // start at night by default — the original's signature look, and the one
  // every screenshot in this migration has been judged against — unless a
  // save says otherwise
  const t = useRef(loadSave()?.dayPhase ?? 0.9); // Toshkent Drive: start mid-morning (~09:30)
  // Toshkent Drive: physically-based (Preetham) daytime sky dome
  const skyRef = useRef<THREE.Mesh>(null);

  // useFrame runs in three.js's render loop, outside React's render cycle —
  // imperatively mutating scene.background/fog here every frame is the
  // documented R3F pattern (see the library's own examples), not the kind of
  // render-impurity react-hooks/immutability is built to catch.
  // eslint-disable-next-line react-hooks/immutability
  useFrame((_, dt) => {
    t.current += dt * 0.015; // one full cycle every ~7 minutes
    skyState.phase = t.current;
    const dayK = (Math.sin(t.current) + 1) / 2;
    const nightK = 1 - dayK;
    skyState.nightK = nightK;
    // clock (matches the original's `(6 + dayT*24) % 24`): map the sine phase
    // directly onto a 24h face rather than running a second, separate timer
    const frac = (((t.current / (2 * Math.PI)) % 1) + 1) % 1;
    skyState.hour = (6 + frac * 24) % 24;
    const clockStr =
      String(Math.floor(skyState.hour)).padStart(2, "0") + ":" + String(Math.floor((skyState.hour % 1) * 60)).padStart(2, "0");
    if (clockStr !== useHudStore.getState().clock) useHudStore.getState().setClock(clockStr);
    const col = NIGHT.clone().lerp(DAY, dayK);
    if (!scene.background || !(scene.background as THREE.Color).equals) {
      // eslint-disable-next-line react-hooks/immutability -- see note above useFrame
      scene.background = col;
    } else {
      (scene.background as THREE.Color).copy(col);
    }
    if (!scene.fog) scene.fog = new THREE.Fog(col, 60, 260);
    (scene.fog as THREE.Fog).color.copy(col);
    if (sunRef.current) {
      sunRef.current.intensity = 0.15 + dayK * 1.1;
      sunRef.current.color.copy(SUN_NIGHT).lerp(SUN_DAY, dayK);
      // shadow camera is a fixed-size box in the light's own local space, so
      // moving light+target together by the same offset every frame carries
      // that box along with the player instead of leaving it stranded at the
      // world origin — an open map is far bigger than any frustum tight
      // enough to keep shadow-map resolution sharp, so it has to follow
      if (sunTargetRef.current) {
        sunRef.current.target = sunTargetRef.current;
        sunTargetRef.current.position.set(worldState.px, 0, worldState.pz);
        const el = Math.max(0.25, Math.sin(t.current));
        sunRef.current.position.set(worldState.px + Math.cos(t.current) * 80, 20 + el * 80, worldState.pz + 35);
      }
    }
    if (skyRef.current) {
      const mat = skyRef.current.material as THREE.ShaderMaterial;
      mat.uniforms.sunPosition.value.set(Math.cos(t.current), Math.sin(t.current) * 0.9 + 0.02, 0.35);
      skyRef.current.visible = dayK > 0.12;
    }
    if (hemiRef.current) hemiRef.current.intensity = 0.18 + dayK * 0.5;
    // brightest at night to compensate for the dark night palette. Base
    // raised from the original's 1.08 to 1.5 (matches Game.tsx's Canvas gl
    // prop, so this per-frame set doesn't immediately undo it) — the ported
    // night palette still read too dark even at the original's own numbers.
    // eslint-disable-next-line react-hooks/immutability -- see note above useFrame
    gl.toneMappingExposure = 1.0 + nightK * 0.68; // Toshkent Drive: lower day exposure now that an HDRI + physical sky light the scene
  });

  return (
    <>
      <Sky ref={skyRef as never} distance={900} turbidity={1.8} rayleigh={0.9} mieCoefficient={0.004} mieDirectionalG={0.8} />
      {/* flat fill so shadowed sides of buildings/the car never go fully
          black — hemi+directional alone leaves anything facing away from
          both lit only by bloom/neon, which reads as patchy darkness rather
          than an evenly (if dimly) lit night city */}
      <ambientLight intensity={0.3} />
      {/* original's hemi: sky-color-from-above / ground-color-from-below,
          reads much richer than a flat ambient */}
      <hemisphereLight ref={hemiRef} color={0xc8e0ff} groundColor={0x3a3020} intensity={0.18} />
      {/* original's fixed-intensity fillLight, never modulated by day/night */}
      <directionalLight color={0x8ab4d8} intensity={0.25} position={[-60, 40, -30]} />
      <directionalLight
        ref={sunRef}
        position={[60, 80, 30]}
        castShadow
        intensity={0.15}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0015}
        shadow-camera-near={10}
        shadow-camera-far={220}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
      />
      <object3D ref={sunTargetRef} />
    </>
  );
}
