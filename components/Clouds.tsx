"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame } from "@/lib/safeFrame";
import { skyState } from "@/lib/skyState";
import { weatherState } from "@/lib/weatherState";

// v2.0: a layer of 3D low-poly cumulus — clusters of flattened icosahedron
// puffs merged into ONE mesh (1 draw call, ~4.5k tris). Like the skyline
// (components/Skyline.tsx) it rides with the camera and is scaled to sit
// inside the (fog-synced) far plane; the puffs drift with the wind by
// wrapping each cloud's centre inside a tile in the vertex shader. Coverage,
// darkness and tint follow weather (lib/weatherState.ts) and the day/night
// cycle (skyState.nightK).

const TILE = 1000; // world-ish metres before the far-plane scale
const N_CLOUDS = 60;
const LAYER_Y = 72;

function buildClouds(): THREE.BufferGeometry {
  let s = 4242;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts: THREE.BufferGeometry[] = [];
  for (let c = 0; c < N_CLOUDS; c++) {
    const cx = (rnd() - 0.5) * TILE, cz = (rnd() - 0.5) * TILE;
    const cy = LAYER_Y + rnd() * 22;
    const size = 14 + rnd() * 22;
    const puffs = 3 + ((rnd() * 4) | 0);
    const seed = rnd();
    for (let p = 0; p < puffs; p++) {
      const r = size * (0.45 + rnd() * 0.45);
      const g = new THREE.IcosahedronGeometry(1, 0); // detail 0 is already non-indexed
      // smooth "puffy" shading: spherical normals instead of the flat facets
      // detail-0 polyhedra get (applyMatrix4 in scale() keeps them right)
      g.setAttribute("normal", g.getAttribute("position").clone());
      g.scale(r * (1.1 + rnd() * 0.5), r * (0.45 + rnd() * 0.25), r * (0.9 + rnd() * 0.4));
      g.rotateY(rnd() * Math.PI);
      g.translate(cx + (rnd() - 0.5) * size * 1.6, cy + (rnd() - 0.2) * size * 0.25, cz + (rnd() - 0.5) * size);
      const n = g.getAttribute("position").count;
      const center = new Float32Array(n * 3), rand = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        center[i * 3] = cx; center[i * 3 + 1] = cy; center[i * 3 + 2] = cz;
        rand[i] = seed;
      }
      g.setAttribute("aCenter", new THREE.BufferAttribute(center, 3));
      g.setAttribute("aRand", new THREE.BufferAttribute(rand, 1));
      parts.push(g);
    }
  }
  return mergeGeometries(parts)!;
}

const VERT = /* glsl */ `
attribute vec3 aCenter;
attribute float aRand;
uniform vec2 uOffset;
uniform float uCover;
uniform float uTile;
varying vec3 vN;
varying float vFade;
varying float vH;
void main() {
  vec3 local = position - aCenter;
  vec2 c = mod(aCenter.xz + uOffset + uTile * 0.5, uTile) - uTile * 0.5;
  // grow / shrink with coverage: clouds whose seed is under the cover fraction
  float grow = smoothstep(aRand - 0.08, aRand + 0.02, uCover);
  vec3 p = vec3(c.x, aCenter.y, c.y) + local * grow;
  float edge = length(c) / (uTile * 0.5);
  vFade = (1.0 - smoothstep(0.8, 0.99, edge)) * step(0.01, grow);
  vN = normal;
  vH = clamp(local.y / 14.0 * 0.5 + 0.5, 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uLit;
uniform vec3 uShade;
uniform float uAlpha;
varying vec3 vN;
varying float vFade;
varying float vH;
void main() {
  if (vFade < 0.01) discard;
  float l = clamp(dot(normalize(vN), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  vec3 c = mix(uShade, uLit, clamp(0.3 + l * 0.55 + vH * 0.3, 0.0, 1.0));
  gl_FragColor = vec4(c, uAlpha * vFade);
}`;

const mat = new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: FRAG,
  uniforms: {
    uOffset: { value: new THREE.Vector2() },
    uCover: { value: 0.5 },
    uTile: { value: TILE },
    uSunDir: { value: new THREE.Vector3(60, 80, 30).normalize() },
    uLit: { value: new THREE.Color("#ffffff") },
    uShade: { value: new THREE.Color("#b9c4d3") },
    uAlpha: { value: 0.92 },
  },
  transparent: true,
  depthWrite: false,
  fog: false,
});
mat.name = "td-clouds";

// per-weather look: coverage 0..1, lit/shade colours, opacity
const LOOK: Record<string, { cover: number; lit: string; shade: string; alpha: number }> = {
  clear: { cover: 0.42, lit: "#ffffff", shade: "#b7c3d4", alpha: 0.9 },
  sunny: { cover: 0.2, lit: "#ffffff", shade: "#c8d2e0", alpha: 0.88 },
  overcast: { cover: 1.0, lit: "#d9dde3", shade: "#8b939e", alpha: 0.96 },
  rain: { cover: 1.0, lit: "#a7adb6", shade: "#5d636c", alpha: 0.98 },
  fog: { cover: 0.85, lit: "#d4d8dd", shade: "#aab0b8", alpha: 0.4 },
  snow: { cover: 1.0, lit: "#e9edf2", shade: "#a2aab5", alpha: 0.95 },
};
const tLit = new THREE.Color(), tShade = new THREE.Color();
const NIGHT_LIT = new THREE.Color("#3a4152"), NIGHT_SHADE = new THREE.Color("#141822");
const DUSK = new THREE.Color("#ffb37a");
const state = { cover: 0.42, ox: 0, oz: 0 };

const cloudMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
cloudMesh.name = "td-clouds";
cloudMesh.frustumCulled = false;
cloudMesh.renderOrder = -1;

export function Clouds() {
  const { camera } = useThree();
  const geo = useMemo(() => buildClouds(), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const look = LOOK[weatherState.kind] ?? LOOK.clear;
    state.cover += (look.cover - state.cover) * Math.min(1, dt * 0.08);
    const w = weatherState.wind;
    state.ox += w.x * dt * 2.2; // high-altitude wind runs faster than at street level
    state.oz += w.z * dt * 2.2;
    const far = (camera as THREE.PerspectiveCamera).far || 400;
    const k = Math.min(1, (far * 0.92) / Math.hypot(TILE * 0.5, LAYER_Y + 22));
    cloudMesh.scale.setScalar(k);
    cloudMesh.position.set(camera.position.x, 0, camera.position.z);
    mat.uniforms.uOffset.value.set(state.ox - camera.position.x / k, state.oz - camera.position.z / k);
    mat.uniforms.uCover.value = state.cover;
    mat.uniforms.uAlpha.value = look.alpha;
    // dawn / dusk warm tint, night darkening
    const h = skyState.hour;
    const dusk = Math.max(0, 1 - Math.min(Math.abs(h - 6.5), Math.abs(h - 19)) / 1.6);
    tLit.set(look.lit).lerp(DUSK, dusk * 0.55).lerp(NIGHT_LIT, skyState.nightK * 0.9);
    tShade.set(look.shade).lerp(NIGHT_SHADE, skyState.nightK * 0.9);
    mat.uniforms.uLit.value.copy(tLit);
    mat.uniforms.uShade.value.copy(tShade);
  });
  useEffect(() => {
    cloudMesh.geometry = geo;
  }, [geo]);
  return <primitive object={cloudMesh} />;
}
