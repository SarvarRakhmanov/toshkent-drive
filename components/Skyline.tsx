"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { useFrame } from "@/lib/safeFrame";
import { buildSkyline } from "@/lib/skylineGeo";
import { skyState } from "@/lib/skyState";
import { weatherState } from "@/lib/weatherState";

// v1.7: unreachable Tashkent backdrop (lib/skylineGeo.ts). The ring is
// re-centred on the camera every frame (like a skybox), so it can never be
// driven to. Unlit custom shader: vertex colour × daylight, hazed toward the
// fog colour by height (atmospheric perspective), night windows/beacons glow.
// One draw call, ~5k triangles, no textures.

const VERT = /* glsl */ `
attribute vec3 color;
attribute float glow;
varying vec3 vCol;
varying float vGlow;
varying float vY;
void main() {
  vCol = color; vGlow = glow; vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
uniform vec3 uFog;
uniform float uDay;
uniform float uNight;
uniform float uHaze;
varying vec3 vCol;
varying float vGlow;
varying float vY;
void main() {
  vec3 c = vCol * (0.28 + 0.72 * uDay);
  float h = clamp(1.0 - vY / 90.0, 0.0, 1.0);
  c = mix(c, uFog, clamp(uHaze * (0.55 + 0.45 * h), 0.0, 0.95));
  // night: scattered lit windows (hash of the fragment's world-ish position)
  float n = fract(sin(dot(floor(gl_FragCoord.xy / 3.0), vec2(12.9898, 78.233))) * 43758.5453);
  c += vGlow * uNight * step(0.55, n) * vec3(1.0, 0.82, 0.55) * 0.85;
  gl_FragColor = vec4(c, 1.0);
}`;

const mat = new THREE.ShaderMaterial({
  vertexShader: VERT,
  fragmentShader: FRAG,
  uniforms: { uFog: { value: new THREE.Color("#a9c6e0") }, uDay: { value: 1 }, uNight: { value: 0 }, uHaze: { value: 0.35 } },
  fog: false,
  depthWrite: true,
});
mat.name = "td-skyline";

export function Skyline() {
  const { scene, camera } = useThree();
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => buildSkyline(), []);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    m.position.set(camera.position.x, 0, camera.position.z);
    // FogFarSync pulls camera.far in to fog.far+40 (≈150 m on phone LOW), so
    // shrink the ring uniformly to sit just inside the far plane: the angular
    // size is unchanged and it still lies beyond the fog end.
    const far = (camera as THREE.PerspectiveCamera).far || 400;
    m.scale.setScalar(Math.min(1, (far * 0.9) / 400));
    // fog colour is copied in onBeforeRender (below): Weather.tsx greys
    // scene.fog AFTER this frame callback, so copying here hazed the ridge
    // to the un-weathered blue (bright blue mountains in fog/rain)
    const night = skyState.nightK;
    mat.uniforms.uDay.value = 1 - night * 0.85;
    mat.uniforms.uNight.value = night;
    // thicker haze in fog / rain (lib/weatherState.ts)
    mat.uniforms.uHaze.value = 0.32 + (1 - weatherState.wetGrip) * 0.9 + (weatherState.kind === "fog" ? 0.9 : 0);
  });
  const onBeforeRender = () => {
    const f = scene.fog as THREE.Fog | null;
    if (f) mat.uniforms.uFog.value.copy(f.color);
  };
  return <mesh ref={ref} geometry={geo} material={mat} frustumCulled={false} renderOrder={-1} name="td-skyline" onBeforeRender={onBeforeRender} />;
}
