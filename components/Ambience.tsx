"use client";

import { useEffect } from "react";
import { stepAmbience } from "@/lib/ambience";
import { useHudStore } from "@/lib/hudStore";
import { usePauseStore } from "@/lib/pauseStore";
import { worldState } from "@/lib/worldState";

// v1.8: drives lib/ambience.ts 4x a second. Quiet inside the club/interiors,
// up in the sky (planes/helis) and while paused; fades out over open water.
export function Ambience() {
  useEffect(() => {
    const id = setInterval(() => {
      const h = useHudStore.getState();
      let level = 1;
      if (h.inClub || usePauseStore.getState().open) level = 0;
      if (worldState.py > 40) level *= Math.max(0, 1 - (worldState.py - 40) / 160);
      if (worldState.px > 620) level *= 0.35; // sea / marina
      stepAmbience(level);
    }, 250);
    return () => clearInterval(id);
  }, []);
  return null;
}
