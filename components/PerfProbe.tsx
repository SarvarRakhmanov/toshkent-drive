"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useFrame } from "@/lib/safeFrame";
import * as THREE from "three";

// Lightweight perf probe: window.__tdPerf() returns the previous frame's
// renderer.info (accumulated over every render pass of that frame) plus a
// scene census. Costs one integer copy per frame; the census only runs on call.
const last = { calls: 0, triangles: 0, points: 0, lines: 0, frames: 0 };
/** Rendered-frame counter (read by the frame watchdog in Game.tsx). */
export const renderedFrames = () => last.frames;

export function PerfProbe() {
  const { gl, scene } = useThree();
  useEffect(() => {
    gl.info.autoReset = false;
    (window as unknown as { __tdPrograms: () => unknown }).__tdPrograms = () =>
      (gl.info.programs ?? []).map((p) => ({ id: p.id, name: p.name, key: (p as unknown as { cacheKey: string }).cacheKey }));
    (window as unknown as { __tdPerf: () => unknown }).__tdPerf = () => {
      let meshes = 0, visibleMeshes = 0, instanced = 0, instances = 0, lights = 0, shadowLights = 0, castShadow = 0;
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          meshes++;
          let vis = true;
          for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
          if (vis) visibleMeshes++;
          if (m.castShadow) castShadow++;
          if ((o as THREE.InstancedMesh).isInstancedMesh) { instanced++; instances += (o as THREE.InstancedMesh).count; }
        }
        if ((o as THREE.Light).isLight) {
          lights++;
          if ((o as THREE.Light).castShadow) shadowLights++;
        }
      });
      const sm = gl.shadowMap;
      return {
        ...last,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        programs: gl.info.programs?.length ?? 0,
        programList: (gl.info.programs ?? []).map((p) => `${p.name}#${p.id}`),
        meshes, visibleMeshes, instanced, instances, lights, shadowLights, castShadow,
        shadows: sm.enabled ? sm.type : "off",
        pixelRatio: gl.getPixelRatio(),
        size: [gl.domElement.width, gl.domElement.height],
        heapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576)
          : null,
      };
    };
  }, [gl, scene]);
  useFrame(() => {
    const r = gl.info.render;
    last.calls = r.calls; last.triangles = r.triangles; last.points = r.points; last.lines = r.lines;
    last.frames++;
    gl.info.reset();
  });
  return null;
}
