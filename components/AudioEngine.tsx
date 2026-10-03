"use client";

import { useFrame } from "@/lib/safeFrame";
import { updateEngineAudio } from "@/lib/audio";
import { engineTelemetry } from "@/lib/vehicleDynamics";
import { ENGINE_PROFILES, profileForVehicle, pseudoRpm } from "@/lib/engineSound";
import { PLAYER_CARS, usePlayerCarStore } from "@/lib/playerCar";
import { useHudStore } from "@/lib/hudStore";

// Drives lib/audio.ts's oscillators from the active vehicle's live telemetry.
// Needs useFrame (three.js's render loop), so this has to live inside
// <Canvas> even though the actual AudioContext it drives has nothing to do
// with WebGL — same reason SkyCycle/City read worldState/skyState in here.
let lastSpeed = 0;

export function AudioEngine() {
  useFrame(() => {
    const s = useHudStore.getState();
    const car = s.active === "car" && engineTelemetry.active;
    // each player car has its own voice (lib/playerCar.ts `sound`); every other
    // vehicle kind maps to a generic profile and a speed-derived pseudo-rpm
    const id = s.active === "car" ? PLAYER_CARS[usePlayerCarStore.getState().index]?.sound ?? "i4turbo" : profileForVehicle(s.active);
    const prev = lastSpeed;
    lastSpeed = s.speedKmh;
    const rpm = car ? engineTelemetry.rpm : pseudoRpm(ENGINE_PROFILES[id], s.speedKmh);
    const thr = car ? engineTelemetry.throttle : s.speedKmh > prev + 0.05 ? 1 : 0.2;
    updateEngineAudio(s.speedKmh, s.active !== "foot", s.active === "car" && s.nitroActive, rpm, thr, id);
  });
  return null;
}
