"use client";

import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@/lib/safeFrame";
import { useGfxStore } from "@/lib/gfx";
import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import * as THREE from "three";
import { asset } from "@/lib/asset";

// Toshkent Drive: CC-BY buildings carried over from the Grok Build project
// (see CREDITS.md), parked in two chunks that lib/landmarks.ts keeps clear of
// procedural buildings ("TASHKENT CITY" and "CHILONZOR").
interface Spot {
  url: string;
  x: number;
  z: number;
  height: number;
  maxFoot: number; // max footprint edge (m) so it never spills onto the road
  rotY?: number;
}

const SPOTS: Spot[] = [
  // Tashkent City business district
  { url: "/models/buildings/building-office.glb", x: -112, z: -14, height: 78, maxFoot: 34 },
  { url: "/models/buildings/building-office.glb", x: -78, z: 20, height: 56, maxFoot: 30, rotY: Math.PI / 2 },
  { url: "/models/buildings/corner-a.glb", x: -80, z: -24, height: 16, maxFoot: 24 },
  // Chilonzor-style panel blocks
  { url: "/models/buildings/apt-a.glb", x: -16, z: 100, height: 27, maxFoot: 36, rotY: Math.PI / 2 },
  { url: "/models/buildings/apt-b.glb", x: 22, z: 88, height: 38, maxFoot: 28 },
  { url: "/models/buildings/shop-a.glb", x: 22, z: 122, height: 8, maxFoot: 18 },
];

function Building({ spot }: { spot: Spot }) {
  const gltf = useGLTF(asset(spot.url));
  const { obj, half } = useMemo(() => {
    const model = gltf.scene.clone(true);
    model.rotation.y = spot.rotY ?? 0;
    const wrap = new THREE.Group();
    wrap.add(model);
    wrap.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(wrap);
    let size = box.getSize(new THREE.Vector3());
    let s = spot.height / Math.max(size.y, 0.01);
    const foot = Math.max(size.x, size.z) * s;
    if (foot > spot.maxFoot) s *= spot.maxFoot / foot;
    wrap.scale.setScalar(s);
    wrap.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(wrap);
    const c = box.getCenter(new THREE.Vector3());
    wrap.position.set(-c.x, -box.min.y, -c.z);
    size = box.getSize(new THREE.Vector3());
    wrap.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    return { obj: wrap, half: size.clone().multiplyScalar(0.5) };
  }, [gltf, spot]);
  return (
    <RigidBody type="fixed" colliders={false} position={[spot.x, 0, spot.z]}>
      <CuboidCollider args={[half.x, half.y, half.z]} position={[0, half.y, 0]} />
      <primitive object={obj} />
    </RigidBody>
  );
}

// v1.7b real Tashkent landmarks (Sketchfab, CC BY / CC BY-NC — CREDITS.md),
// decimated + meshopt (scripts/optimize-models.mjs). Each sits on a block
// that City.tsx keeps clear (lib/landmarks.ts names it on the minimap).
// Distance LOD: the full model only near the camera, a tiny untextured far
// model (towers) or nothing beyond; phone LOW uses shorter ranges and the
// 2-call NBU variant.
interface RealSpot {
  name: string;
  url: string;
  far?: string; // far LOD url
  low?: string; // LOW-quality replacement for the near model
  x: number;
  z: number;
  height: number;
  maxFoot: number;
  rotY?: number;
  collide?: number; // collider footprint fraction (towers: legs only)
}

const REAL: RealSpot[] = [
  // AMIR TEMUR XIYOBONI label sits on the (150,150) crossroads; the square is block (2,2)
  { name: "amir-temur", url: "/models/landmarks/temur.glb", low: "/models/landmarks/temur-low.glb", x: 200, z: 200, height: 13, maxFoot: 40 },
  { name: "tv-tower", url: "/models/landmarks/tv-tower.glb", low: "/models/landmarks/tv-tower-low.glb", far: "/models/landmarks/tv-tower-far.glb", x: 200, z: -100, height: 375, maxFoot: 80, collide: 0.35 },
  { name: "oliy-majlis", url: "/models/landmarks/oliy-majlis.glb", low: "/models/landmarks/oliy-majlis-low.glb", x: -100, z: -100, height: 40, maxFoot: 74 },
  { name: "circus", url: "/models/landmarks/circus.glb", x: 300, z: 100, height: 28, maxFoot: 66 },
  { name: "nbu", url: "/models/landmarks/nbu.glb", low: "/models/landmarks/nbu-low.glb", x: 100, z: 200, height: 70, maxFoot: 72 },
  { name: "nest-one", url: "/models/landmarks/nest-one.glb", low: "/models/landmarks/nest-one-low.glb", far: "/models/landmarks/nest-one-far.glb", x: -200, z: 0, height: 220, maxFoot: 70, collide: 0.8 },
];

function fitModel(scene: THREE.Object3D, spot: { rotY?: number; height: number; maxFoot: number }, shadows: boolean) {
  const model = scene.clone(true);
  model.rotation.y = spot.rotY ?? 0;
  const wrap = new THREE.Group();
  wrap.add(model);
  wrap.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(wrap);
  let size = box.getSize(new THREE.Vector3());
  let s = spot.height / Math.max(size.y, 0.01);
  const foot = Math.max(size.x, size.z) * s;
  if (foot > spot.maxFoot) s *= spot.maxFoot / foot;
  wrap.scale.setScalar(s);
  wrap.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(wrap);
  const c = box.getCenter(new THREE.Vector3());
  wrap.position.set(-c.x, -box.min.y, -c.z);
  size = box.getSize(new THREE.Vector3());
  wrap.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.castShadow = shadows; m.receiveShadow = shadows; }
  });
  return { obj: wrap, size };
}

function useFitted(url: string, spot: RealSpot, shadows: boolean) {
  const gltf = useGLTF(asset(url));
  return useMemo(() => fitModel(gltf.scene, spot, shadows), [gltf, spot, shadows]);
}

function FarModel({ spot, groupRef }: { spot: RealSpot; groupRef: React.RefObject<THREE.Group | null> }) {
  const { obj } = useFitted(spot.far!, spot, false);
  return <group ref={groupRef}><primitive object={obj} /></group>;
}

function RealLandmark({ spot }: { spot: RealSpot }) {
  const quality = useGfxStore((s) => s.quality);
  const low = quality === "low";
  const { obj, size } = useFitted(low && spot.low ? spot.low : spot.url, spot, !low);
  const near = useRef<THREE.Group>(null);
  const far = useRef<THREE.Group | null>(null);
  const nearDist = low ? 170 : 300;
  const maxDist = low ? 260 : 420;
  const tick = useRef(0);
  useFrame(({ camera }) => {
    if ((tick.current = (tick.current + 1) % 6) !== 0) return;
    const d = Math.hypot(camera.position.x - spot.x, camera.position.z - spot.z) - Math.max(size.x, size.z) / 2;
    if (near.current) near.current.visible = d < nearDist;
    if (far.current) far.current.visible = d >= nearDist;
    if (!spot.far && near.current) near.current.visible = d < maxDist;
    if (near.current && typeof window !== "undefined") {
      const w = window as unknown as { __tdLm?: Record<string, unknown> };
      const bb = new THREE.Box3().setFromObject(near.current);
      (w.__tdLm ??= {})[spot.name] = { d: Math.round(d), near: near.current.visible, far: far.current?.visible ?? null, min: bb.min.toArray().map(Math.round), max: bb.max.toArray().map(Math.round) };
    }
  });
  const k = spot.collide ?? 1;
  const half = size.clone().multiplyScalar(0.5);
  return (
    <RigidBody type="fixed" colliders={false} position={[spot.x, 0, spot.z]}>
      <CuboidCollider args={[half.x * k, half.y, half.z * k]} position={[0, half.y, 0]} />
      <group ref={near} name={`td-landmark:${spot.name}`}><primitive object={obj} /></group>
      {spot.far && (
        <Suspense fallback={null}>
          <FarModel spot={spot} groupRef={far} />
        </Suspense>
      )}
    </RigidBody>
  );
}

export function TashkentLandmarks() {
  return (
    <>
      {SPOTS.map((s, i) => (
        <Suspense key={i} fallback={null}>
          <Building spot={s} />
        </Suspense>
      ))}
      {REAL.map((s) => (
        <Suspense key={s.name} fallback={null}>
          <RealLandmark spot={s} />
        </Suspense>
      ))}
    </>
  );
}
