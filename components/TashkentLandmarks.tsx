"use client";

import { Suspense, useMemo } from "react";
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

export function TashkentLandmarks() {
  return (
    <>
      {SPOTS.map((s, i) => (
        <Suspense key={i} fallback={null}>
          <Building spot={s} />
        </Suspense>
      ))}
    </>
  );
}
