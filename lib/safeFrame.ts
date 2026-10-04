"use client";

import { useRef } from "react";
import { useFrame as useFrameR3F, type RootState } from "@react-three/fiber";
import { pauseState } from "@/lib/pauseStore";

// Drop-in replacement for R3F's useFrame. Every per-frame callback in the game
// goes through here so that:
//  1. one throwing callback (NaN in a vehicle, a disposed body, …) can never
//     abort the rest of the frame — R3F runs every subscriber and then
//     gl.render() in one loop with no try/catch, so a single exception used to
//     skip the render for good and freeze the picture while audio kept going;
//  2. the frame delta is capped (MAX_DT) for every system at once, so a GC or
//     tab-switch hitch can't launch a car across the map;
//  3. errors are reported once per callback instead of 60×/s.
export const MAX_DT = 0.1;
export const frameErrors = { count: 0, last: "" };

type XRFrameArg = Parameters<Parameters<typeof useFrameR3F>[0]>[2];
type Cb = (state: RootState, delta: number, frame?: XRFrameArg) => void;

/** always: keep running while the game is paused (perf probe / watchdog counters) */
export function useFrame(callback: Cb, renderPriority = 0, always = false) {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  const reported = useRef(false);
  return useFrameR3F((state, delta, frame) => {
    if (pauseState.paused && !always) return;
    const d = delta > MAX_DT ? MAX_DT : delta > 0 ? delta : 0;
    try {
      cbRef.current(state, d, frame);
    } catch (e) {
      frameErrors.count++;
      frameErrors.last = String((e as Error)?.message ?? e);
      if (!reported.current) {
        reported.current = true;
        console.warn("[toshkent-drive] frame callback error (recovered):", e);
      }
    }
  }, renderPriority);
}
