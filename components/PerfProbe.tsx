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
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    gl.info.autoReset = false;
    // world-space bounds of a named object (tests: wheels-on-ground check)
    (window as unknown as { __tdBox: (n: string) => unknown }).__tdBox = (name: string) => {
      let found: THREE.Object3D | undefined;
      scene.traverse((o) => { if (!found && o.name === name && o.visible) found = o; });
      if (!found) return null;
      found.updateWorldMatrix(true, true);
      const b = new THREE.Box3().setFromObject(found, true);
      const p = new THREE.Vector3(); found.parent?.getWorldPosition(p);
      return { min: b.min.toArray(), max: b.max.toArray(), parentY: p.y };
    };
    (window as unknown as { __tdLowest: (n: string) => unknown }).__tdLowest = (name: string) => {
      let root: THREE.Object3D | undefined;
      scene.traverse((o) => { if (!root && o.name === name && o.visible) root = o; });
      if (!root) return null;
      root.updateWorldMatrix(true, true);
      const out: { name: string; skinned: boolean; minY: number; visible: boolean; mat: string }[] = [];
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const b = new THREE.Box3().setFromObject(m, true);
        out.push({ name: m.name, skinned: !!(m as THREE.SkinnedMesh).isSkinnedMesh, minY: +b.min.y.toFixed(3), visible: m.visible, mat: ((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material).name });
      });
      return out.sort((a, b) => a.minY - b.minY).slice(0, 6);
    };
    // perf diagnostics: visible, in-frustum draw objects grouped by their
    // top-level named ancestor (approximate draw-call census)
    (window as unknown as { __tdDraw: (top?: boolean) => unknown }).__tdDraw = (top?: boolean) => {
      const cam = camera;
      const fr = new THREE.Frustum();
      if (cam) fr.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const out: Record<string, number> = {};
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!(m.isMesh || (o as THREE.Points).isPoints)) return;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
        if ((o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).count === 0) return;
        if (cam && m.frustumCulled && m.geometry) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          const sph = m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
          if (!fr.intersectsSphere(sph)) return;
        }
        let topNamed = "", near = o.name;
        for (let p: THREE.Object3D | null = o.parent; p && p !== scene; p = p.parent) { if (p.name) { topNamed = p.name; if (!near) near = p.name; } }
        const k = top ? topNamed || near || o.type : `${topNamed || "-"}/${near || o.type}`;
        out[k] = (out[k] ?? 0) + (Array.isArray(m.material) ? m.material.length : 1);
      });
      return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 40);
    };
    // v1.7b: visible meshes with no named ancestor (stray top-level draws)
    (window as unknown as { __tdOrphans: () => unknown }).__tdOrphans = () => {
      const out: Record<string, number> = {};
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
        for (let p: THREE.Object3D | null = o; p && p !== scene; p = p.parent) if (p.name) return;
        if (m.frustumCulled && m.geometry) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          if (!fr.intersectsSphere(m.geometry.boundingSphere!.clone().applyMatrix4(m.matrixWorld))) return;
        }
        const mat = Array.isArray(m.material) ? m.material[0] : m.material;
        const wp = m.getWorldPosition(new THREE.Vector3());
        let root: THREE.Object3D = o; while (root.parent && root.parent !== scene) root = root.parent;
        const k = `${m.geometry?.type}|${mat?.type}|root@${Math.round(root.position.x)},${Math.round(root.position.z)} kids=${root.children.length}|at ${Math.round(wp.x / 10) * 10},${Math.round(wp.z / 10) * 10}`;
        out[k] = (out[k] ?? 0) + 1;
      });
      return Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 20);
    };
    // per-object census under one named root: visible meshes grouped by the
    // root's direct child index → [mesh count, material names]
    (window as unknown as { __tdDrawIn: (name: string) => unknown }).__tdDrawIn = (name: string) => {
      let root: THREE.Object3D | undefined;
      scene.traverse((o) => { if (!root && o.name === name) root = o; });
      if (!root) return null;
      const res: [number, number, string][] = [];
      root.children.forEach((c, i) => {
        let n = 0; const mats = new Set<string>();
        c.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (!p.visible) return;
          n++; mats.add(((Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material).type + ":" + (m.name || "?"));
        });
        if (n) res.push([i, n, [...mats].slice(0, 12).join(",")]);
      });
      return res;
    };
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
  }, [gl, scene, camera]);
  useFrame(() => {
    const r = gl.info.render;
    last.calls = r.calls; last.triangles = r.triangles; last.points = r.points; last.lines = r.lines;
    last.frames++;
    gl.info.reset();
  }, 0, true); // keeps counting while paused (Game.tsx frame watchdog)
  return null;
}
