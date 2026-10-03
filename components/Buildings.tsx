"use client";

import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";
import { BUILDINGS } from "@/lib/buildings";

// 500 static boxes, one InstancedMesh — cheap to draw, no per-building React overhead.
export function Buildings() {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    BUILDINGS.forEach((b, i) => {
      m.compose(
        new THREE.Vector3(b.x, b.h / 2, b.z),
        new THREE.Quaternion(),
        new THREE.Vector3(b.w, b.h, b.d),
      );
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, BUILDINGS.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#3a4050" roughness={0.7} />
    </instancedMesh>
  );
}
