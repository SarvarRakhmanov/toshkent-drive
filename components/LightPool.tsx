"use client";

import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";

// Light budget. The game has ~70 decorative point lights (street lamps, neon
// signs, nitro flames, police beacons, cockpit dome lights…). In three.js every
// visible light is a loop iteration in EVERY lit fragment shader, and changing
// the count recompiles every material — on a phone that alone was a few FPS
// and a hitch each time a chunk with a lamp streamed in.
//
// Instead, every PointLight added anywhere in the scene is turned into a
// "virtual" light (kept in the graph so its owner can still animate it, but
// visible=false so the renderer never counts it), and a fixed pool of N real
// lights is moved each frame onto the N virtual lights that matter most to the
// camera. The light count — and therefore every shader — never changes.
const virtualLights = new Set<THREE.PointLight>();
let poolSet: WeakSet<THREE.Object3D> = new WeakSet();
let patched = false;

function capture(o: THREE.Object3D) {
  o.traverse((c) => {
    const l = c as THREE.PointLight;
    if (l.isPointLight && !poolSet.has(l) && !l.userData.keepLight) {
      virtualLights.add(l);
      l.userData.wantVisible = l.visible;
      l.visible = false;
    }
  });
}

function patchAdd() {
  if (patched) return;
  patched = true;
  const origAdd = THREE.Object3D.prototype.add;
  THREE.Object3D.prototype.add = function (this: THREE.Object3D, ...objs: THREE.Object3D[]) {
    const r = origAdd.apply(this, objs);
    for (const o of objs) capture(o);
    return r;
  };
}
// install at import time so lights created during the very first commit are caught
if (typeof window !== "undefined") patchAdd();

const _p = new THREE.Vector3();
const _cam = new THREE.Vector3();

export function LightPool({ count }: { count: number }) {
  const { scene, camera } = useThree();
  const pool = useMemo(() => {
    poolSet = new WeakSet();
    return Array.from({ length: count }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      poolSet.add(l);
      return l;
    });
  }, [count]);

  useEffect(() => {
    capture(scene); // anything that slipped in before the patch
    for (const l of pool) scene.add(l);
    return () => { for (const l of pool) scene.remove(l); };
  }, [scene, pool]);

  // scratch arrays reused every frame (no per-frame allocation)
  const best = useMemo(() => ({ lights: new Array<THREE.PointLight | null>(count).fill(null), score: new Float64Array(count) }), [count]);

  useFrame(() => {
    camera.getWorldPosition(_cam);
    best.lights.fill(null);
    best.score.fill(Infinity);
    for (const l of virtualLights) {
      if (!l.parent) { virtualLights.delete(l); continue; } // unmounted
      // owner hid it (or a parent): honour that
      if (l.intensity <= 0) continue;
      let vis = true;
      for (let p: THREE.Object3D | null = l.parent; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (!vis) continue;
      l.getWorldPosition(_p);
      const d = _p.distanceTo(_cam);
      const reach = l.distance > 0 ? l.distance : 30;
      if (d > reach + 60) continue; // can't light anything near the camera
      // nearer + stronger + wider-reaching lights win
      const score = d / (reach * Math.min(2, 0.5 + l.intensity * 0.5));
      // insertion into the small sorted top-N
      let i = count - 1;
      if (score >= best.score[i]) continue;
      while (i > 0 && best.score[i - 1] > score) { best.score[i] = best.score[i - 1]; best.lights[i] = best.lights[i - 1]; i--; }
      best.score[i] = score; best.lights[i] = l;
    }
    for (let i = 0; i < count; i++) {
      const src = best.lights[i];
      const dst = pool[i];
      if (!src) { dst.intensity = 0; continue; }
      src.getWorldPosition(dst.position);
      dst.color.copy(src.color);
      dst.intensity = src.intensity;
      dst.distance = src.distance;
      dst.decay = src.decay;
    }
  });
  return null;
}
