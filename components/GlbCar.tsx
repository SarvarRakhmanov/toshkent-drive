"use client";

import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { asset } from "@/lib/asset";
import { RIDE_HEIGHT } from "@/components/SupercarBody";
import { PLAYER_CARS, usePlayerCarStore } from "@/lib/playerCar";
import { noTransmission } from "@/components/ReadyGate";

// Toshkent Drive: real GLB car bodies (the player's own cars + CC-BY traffic
// cars from the Grok Build project) dropped into this engine's car rigs.
// Engine convention (components/SupercarBody.tsx): nose toward +z, the
// group's origin sits RIDE_HEIGHT above the tyre contact patch.

function fitCar(model: THREE.Object3D, length: number) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 0.01);
  model.scale.multiplyScalar(length / span);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const c = fitted.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= fitted.min.y;
}

function prepare(scene: THREE.Object3D, rotY: number, length: number, paint: RegExp | undefined, color: string | undefined, tintLargest: boolean, shadows: boolean) {
  const model = scene.clone(true);
  // drop cameras/lights shipped inside some Sketchfab exports
  const junk: THREE.Object3D[] = [];
  model.traverse((o) => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) junk.push(o);
  });
  junk.forEach((o) => o.removeFromParent());
  noTransmission(model);
  const wrap = new THREE.Group();
  model.rotation.y = rotY;
  wrap.add(model);
  fitCar(wrap, length);
  let biggest: THREE.Mesh | null = null;
  let bigVol = 0;
  wrap.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      if (paint && color && paint.test(std.name || "")) {
        const c = std.clone() as THREE.MeshPhysicalMaterial;
        c.color?.set(color);
        if ("clearcoat" in c) {
          c.clearcoat = 1;
          c.clearcoatRoughness = 0.08;
        }
        c.metalness = Math.max(c.metalness ?? 0, 0.55);
        c.roughness = Math.min(c.roughness ?? 1, 0.35);
        return c;
      }
      if (std.isMeshStandardMaterial) std.envMapIntensity = 1.2;
      return m;
    });
    mesh.material = next.length === 1 ? next[0] : next;
    if (tintLargest) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const s = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      const v = s.x * s.y * s.z;
      if (v > bigVol) {
        bigVol = v;
        biggest = mesh;
      }
    }
  });
  if (tintLargest && biggest && color) {
    const mesh = biggest as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tinted = mats.map((m, i) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      if (i === 0) {
        c.color?.set(color);
        c.metalness = 0.5;
        c.roughness = 0.35;
      }
      return c;
    });
    mesh.material = tinted.length === 1 ? tinted[0] : tinted;
  }
  wrap.position.y = -RIDE_HEIGHT;
  return wrap;
}

/** The player's own car (Kia Seltos by default, K cycles the garage). */
export function PlayerGlbCar() {
  const index = usePlayerCarStore((s) => s.index);
  const def = PLAYER_CARS[index];
  const gltf = useGLTF(asset(def.url));
  const obj = useMemo(() => prepare(gltf.scene, def.rotY, def.length, def.paint, def.color, false, true), [gltf, def]);
  return <primitive object={obj} />;
}

// CC-BY low-poly traffic cars (see CREDITS.md)
export const TRAFFIC_MODELS = [
  { url: "/models/traffic/sedan-a.glb", length: 4.5 },
  { url: "/models/traffic/sedan-b.glb", length: 4.5 },
  { url: "/models/traffic/hatch-a.glb", length: 4.1 },
  { url: "/models/traffic/hatch-b.glb", length: 4.1 },
  { url: "/models/traffic/van-a.glb", length: 4.9 },
  { url: "/models/traffic/taxi-a.glb", length: 4.5 },
];

export function TrafficGlbCar({ index, color }: { index: number; color: string }) {
  const def = TRAFFIC_MODELS[Math.abs(index) % TRAFFIC_MODELS.length];
  const gltf = useGLTF(asset(def.url));
  const taxi = def.url.includes("taxi");
  const obj = useMemo(() => prepare(gltf.scene, 0, def.length, undefined, taxi ? "#f2c200" : color, true, false), [gltf, def, color, taxi]);
  return <primitive object={obj} />;
}
