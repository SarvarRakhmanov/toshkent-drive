"use client";

import type { RefObject } from "react";
import type * as THREE from "three";

// Ground-to-hair-top height of the box figure below, at scale 1 — used by
// callers to scale up to a target real-world height.
export const PERSON_MODEL_HEIGHT = 1.55;

// Shared low-poly box-figure body, used by both the crowd-test scene
// (components/Crowd.tsx) and the real in-game pedestrians
// (components/Pedestrians.tsx). Same rig shape as components/Player.tsx's
// PersonMesh — legL/legR/armL/armR are the meshes themselves, rotated
// directly around their own box centers (matches how the original's
// makePerson()/fig() rig works too), not a hip/shoulder joint group.
export function PersonFigure({
  legL,
  legR,
  armL,
  armR,
  jacketColor,
  pantsColor = "#161b26",
  skinColor = "#d9a066",
  officer = false,
}: {
  legL: RefObject<THREE.Mesh | null>;
  legR: RefObject<THREE.Mesh | null>;
  armL: RefObject<THREE.Mesh | null>;
  armR: RefObject<THREE.Mesh | null>;
  jacketColor: string;
  pantsColor?: string;
  skinColor?: string;
  officer?: boolean;
}) {
  const jacket = <meshLambertMaterial color={jacketColor} />;
  const trouser = <meshLambertMaterial color={pantsColor} />;
  const skin = <meshLambertMaterial color={skinColor} />;
  const shoe = <meshStandardMaterial color="#0a0a0c" roughness={0.25} metalness={0.4} />;

  return (
    <>
      <mesh position={[-0.11, 0.045, 0.04]}>
        <boxGeometry args={[0.17, 0.09, 0.3]} />
        {shoe}
      </mesh>
      <mesh position={[0.11, 0.045, 0.04]}>
        <boxGeometry args={[0.17, 0.09, 0.3]} />
        {shoe}
      </mesh>
      <mesh ref={legL} position={[-0.11, 0.34, 0]}>
        <boxGeometry args={[0.17, 0.5, 0.17]} />
        {trouser}
      </mesh>
      <mesh ref={legR} position={[0.11, 0.34, 0]}>
        <boxGeometry args={[0.17, 0.5, 0.17]} />
        {trouser}
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <boxGeometry args={[0.48, 0.6, 0.28]} />
        {jacket}
      </mesh>
      <mesh ref={armL} position={[-0.32, 0.9, 0]}>
        <boxGeometry args={[0.13, 0.52, 0.13]} />
        {jacket}
      </mesh>
      <mesh ref={armR} position={[0.32, 0.9, 0]}>
        <boxGeometry args={[0.13, 0.52, 0.13]} />
        {jacket}
      </mesh>
      <mesh position={[0, 1.38, 0]}>
        <sphereGeometry args={[0.16, 12, 12]} />
        {skin}
      </mesh>
      {officer ? (
        <mesh position={[0, 1.5, -0.02]}>
          <cylinderGeometry args={[0.172, 0.172, 0.12, 12]} />
          <meshLambertMaterial color="#0d1524" />
        </mesh>
      ) : (
        <mesh position={[0, 1.5, -0.02]}>
          <boxGeometry args={[0.3, 0.1, 0.3]} />
          <meshLambertMaterial color="#201812" />
        </mesh>
      )}
    </>
  );
}
