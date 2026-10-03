"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BUILDINGS } from "@/lib/buildings";
import { PersonFigure, PERSON_MODEL_HEIGHT } from "@/components/PersonFigure";

const COUNT = 50;
const TARGET_HEIGHT = 1.8;
const SCALE = TARGET_HEIGHT / PERSON_MODEL_HEIGHT;

const JACKET_COLORS = ["#1c2230", "#2a2e38", "#3a2a4a", "#1f3a5a", "#4a2a2a", "#2f5a4a"];

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(99);
export const SPAWNS = Array.from({ length: COUNT }, () => {
  const b = BUILDINGS[(rand() * BUILDINGS.length) | 0];
  const angle = rand() * Math.PI * 2;
  const dist = Math.max(b.w, b.d) / 2 + 3 + rand() * 6;
  return {
    x: b.x + Math.cos(angle) * dist,
    z: b.z + Math.sin(angle) * dist,
    rotY: rand() * Math.PI * 2,
    phase: rand() * Math.PI * 2,
    speed: 7 + rand() * 2, // slight per-person cadence variety
    color: JACKET_COLORS[(rand() * JACKET_COLORS.length) | 0],
  };
});

// Box-figure + sin-wave walk cycle — the same approach components/Player.tsx
// already uses for the on-foot player, just looping in place instead of
// driven by input. Replaced the Mixamo walking.glb here: its "Walk" clip was
// an exaggerated kick/stride baked into the source export (not something
// decimation could fix — see scripts/optimize-character.mjs, still around
// if a plainer walk export shows up later). This is smoother, ~0 asset
// weight, and reuses a pattern already proven live in this app.
function Walker({ spawn }: { spawn: (typeof SPAWNS)[number] }) {
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime * spawn.speed + spawn.phase;
    const sw = Math.sin(t) * 0.6;
    if (legL.current) legL.current.rotation.x = sw;
    if (legR.current) legR.current.rotation.x = -sw;
    if (armL.current) armL.current.rotation.x = -sw * 0.7;
    if (armR.current) armR.current.rotation.x = sw * 0.7;
  });

  return (
    <group position={[spawn.x, 0, spawn.z]} rotation={[0, spawn.rotY, 0]} scale={SCALE}>
      <PersonFigure legL={legL} legR={legR} armL={armL} armR={armR} jacketColor={spawn.color} />
    </group>
  );
}

export function Crowd() {
  return (
    <>
      {SPAWNS.map((s, i) => (
        <Walker key={i} spawn={s} />
      ))}
    </>
  );
}
