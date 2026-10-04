"use client";

import { useMemo, type RefObject } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { asset } from "@/lib/asset";
import { RIDE_HEIGHT } from "@/components/SupercarBody";

// v1.8: every police interceptor (player-drivable policeCar, patrol lanes,
// chase units, parked cruisers) is the 2016 Ford Mustang Police Barricade by
// sohyalebret (Sketchfab, CC BY 4.0 — see CREDITS.md), optimized by
// scripts/optimize-models.mjs into a 33k-tri near model and a 6k-tri
// untextured LOD. Local origin = RIDE_HEIGHT above the road like
// SupercarBody, nose along +z. The two flashing halves of the roof light bar
// are the lightRefs materials the callers animate (red / blue).
export const MUSTANG_URL = "/models/police/mustang.glb";
export const MUSTANG_LOW_URL = "/models/police/mustang-low.glb";
const LENGTH = 4.85;

export function MustangPoliceBody({ lightRefs, low = false }: { lightRefs: RefObject<(THREE.MeshBasicMaterial | null)[]>; low?: boolean }) {
  const g = useGLTF(asset(low ? MUSTANG_LOW_URL : MUSTANG_URL));
  const { obj, top, barZ } = useMemo(() => {
    const model = g.scene.clone(true);
    const wrap = new THREE.Group();
    wrap.add(model);
    let box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3());
    const s = LENGTH / Math.max(size.z, 0.01);
    wrap.scale.setScalar(s);
    wrap.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(wrap);
    const c = box.getCenter(new THREE.Vector3());
    wrap.position.set(-c.x, -RIDE_HEIGHT - box.min.y, -c.z);
    wrap.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = !low; m.receiveShadow = !low; } });
    return { obj: wrap, top: box.max.y - box.min.y - RIDE_HEIGHT, barZ: -0.25 };
  }, [g, low]);
  return (
    <group name="mustang-police">
      <primitive object={obj} />
      <mesh position={[-0.28, top - 0.07, barZ]}>
        <boxGeometry args={[0.52, 0.1, 0.24]} />
        <meshBasicMaterial ref={(el) => { if (lightRefs.current) lightRefs.current[0] = el; }} color="#ff2020" />
      </mesh>
      <mesh position={[0.28, top - 0.07, barZ]}>
        <boxGeometry args={[0.52, 0.1, 0.24]} />
        <meshBasicMaterial ref={(el) => { if (lightRefs.current) lightRefs.current[1] = el; }} color="#2040ff" />
      </mesh>
    </group>
  );
}
