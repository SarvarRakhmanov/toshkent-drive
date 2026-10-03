"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import { useProgress } from "@react-three/drei";
import { useFrame } from "@/lib/safeFrame";
import { useLoadStore } from "@/lib/loadState";
import { coatScene } from "@/lib/weatherCoat";
import type * as THREE from "three";

/** three's compile() only walks *visible* objects, so anything hidden at boot
 *  (crash debris/sparks, distance-culled NPCs and chunks, FX pools) would
 *  compile its shader synchronously the first time it shows up — e.g. right at
 *  the moment of a crash, which stalled weak GPUs for seconds. Temporarily
 *  reveal every hidden non-light object for the compile pass. Lights stay as
 *  they are so the light-count part of the program keys is unchanged. */
/** Belt and braces for scripts/optimize-models.mjs: any material that still
 *  has transmission would trigger three's extra transmission render pass (a
 *  second full set of shader programs + every opaque draw again). */
export function noTransmission(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      const p = mat as THREE.MeshPhysicalMaterial;
      if (p.transmission > 0) {
        p.opacity = Math.min(p.opacity, 1 - 0.65 * p.transmission);
        p.transmission = 0;
        p.transparent = true;
      }
    }
  });
}

function withAllVisible<T>(scene: THREE.Object3D, fn: () => T): T {
  const flipped: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible && !(o as THREE.Light).isLight) { o.visible = true; flipped.push(o); }
  });
  try { return fn(); } finally { for (const o of flipped) o.visible = false; }
}

/** Drives the boot: mount deferred stages one at a time (every few frames),
 *  wait for every loader (GLBs/textures/HDR) to finish, pre-compile all shaders
 *  with renderer.compileAsync (KHR_parallel_shader_compile where available) so
 *  nothing compiles mid-drive, render a couple of warm-up frames, then reveal. */
export function ReadyGate({ stages }: { stages: number }) {
  const { gl, scene, camera } = useThree();
  const frames = useRef(0);
  const sinceStage = useRef(0);
  const compiling = useRef(false);
  const warm = useRef(-1);
  const startedAt = useRef(performance.now());

  useEffect(() => {
    useLoadStore.getState().set({ phase: "building", stage: 0, progress: 0.05, readyAt: null });
  }, []);

  useFrame(() => {
    const st = useLoadStore.getState();
    if (st.phase === "ready") return;
    frames.current++;
    sinceStage.current++;
    const { active, progress } = useProgress.getState();
    if (st.stage < stages) {
      // next stage once the previous one has had 2 frames to commit
      if (sinceStage.current >= 2) {
        sinceStage.current = 0;
        st.set({ stage: st.stage + 1, progress: 0.05 + 0.55 * ((st.stage + 1) / stages) * (active ? 0.5 + progress / 200 : 1) });
      }
      return;
    }
    const timedOut = performance.now() - startedAt.current > 45000; // never trap the player on the loader
    if ((active || sinceStage.current < 4) && !timedOut) {
      st.set({ progress: Math.max(st.progress, 0.6 + 0.25 * (progress / 100)) });
      return;
    }
    if (!compiling.current && warm.current < 0) {
      compiling.current = true;
      st.set({ phase: "compiling", progress: 0.88 });
      noTransmission(scene);
      coatScene(scene); // weather-coat shader patch must land BEFORE the compile, not 2 s later
      const done = () => { compiling.current = false; warm.current = 0; };
      try {
        // compileAsync only helps (and only stays quiet) with KHR_parallel_shader_compile;
        // without it, a plain synchronous compile behind the loader is the same work
        const parallel = gl.extensions.has("KHR_parallel_shader_compile");
        // compileAsync kicks off every program synchronously inside the call, so
        // restoring visibility right after it returns is safe
        const p = withAllVisible(scene, () =>
          parallel ? (gl as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<unknown> }).compileAsync?.(scene, camera) : undefined);
        if (p && typeof p.then === "function") p.then(done, done);
        else { withAllVisible(scene, () => gl.compile(scene, camera)); done(); }
      } catch { done(); }
      return;
    }
    if (warm.current >= 0 && ++warm.current > 3) {
      st.set({ phase: "ready", progress: 1, readyAt: Math.round(performance.now()) });
    }
  });
  return null;
}
