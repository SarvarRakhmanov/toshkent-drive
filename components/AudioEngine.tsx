"use client";

import { useFrame } from "@react-three/fiber";
import { updateEngineAudio } from "@/lib/audio";
import { useHudStore } from "@/lib/hudStore";

// Drives lib/audio.ts's oscillators from the active vehicle's live telemetry.
// Needs useFrame (three.js's render loop), so this has to live inside
// <Canvas> even though the actual AudioContext it drives has nothing to do
// with WebGL — same reason SkyCycle/City read worldState/skyState in here.
export function AudioEngine() {
  useFrame(() => {
    const s = useHudStore.getState();
    updateEngineAudio(s.speedKmh, s.active !== "foot", s.active === "car" && s.nitroActive);
  });
  return null;
}
