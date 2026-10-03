"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import type { CommercialKind } from "@/components/CommercialBody";

// Jeep/truck/bus had cockpitEyeHeight/cockpitForward tuned in
// CommercialVehicle.tsx's SPEC (so COCKPIT mode moves the camera to a
// plausible driver's-eye point per vehicle), but no interior geometry was
// ever built to put in front of it — unlike Car.tsx's CarInterior.tsx or
// Helicopter.tsx's HeliCockpit.tsx. COCKPIT mode on any commercial vehicle
// put the camera at that bare point with nothing around it: either inside
// CommercialBody's solid, single-sided body mesh (its back faces aren't
// drawn, so the camera saw straight through the vehicle to the world behind
// it) or floating just past the windshield with no dash/wheel at all. One
// shared minimal rig — not each vehicle's own bespoke dashboard, the way
// CarInterior.tsx is — parametrized by SPEC's own eye numbers, same
// "child of the kinematic RigidBody, gated on active+camMode" pattern as
// every other cockpit in the game.
const DASH_MAT = new THREE.MeshStandardMaterial({ color: "#1c1e22", roughness: 0.8 });
const WHEEL_MAT = new THREE.MeshStandardMaterial({ color: "#141518", roughness: 0.6 });
const RIM_MAT = new THREE.MeshStandardMaterial({ color: "#8a8f98", metalness: 0.7, roughness: 0.3 });

// cockpitAhead's default (lib/cameraRig.ts) — CommercialVehicle.tsx never
// overrides it, so the eye's local z is this same 0.15 for every kind.
const EYE_Z = 0.15;

export function CommercialCockpit({
  kind,
  eyeX,
  eyeY,
}: {
  kind: CommercialKind;
  eyeX: number;
  eyeY: number;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const activeKind: VehicleKind = kind;

  useFrame(() => {
    const s = useHudStore.getState();
    if (rootRef.current) rootRef.current.visible = s.active === activeKind && s.camMode === 1;
  });

  const wheelZ = EYE_Z + 0.55;
  const dashZ = EYE_Z + 0.85;

  return (
    <group ref={rootRef} position={[0, eyeY, 0]}>
      <pointLight position={[0, 0.5, 0.3]} intensity={1.1} distance={2} decay={2} color="#fff4e0" />
      <mesh position={[eyeX, -0.35, dashZ]} material={DASH_MAT} castShadow>
        <boxGeometry args={[0.9, 0.3, 0.14]} />
      </mesh>
      <group position={[eyeX, -0.15, wheelZ]} rotation={[0.35, 0, 0]}>
        <mesh material={WHEEL_MAT}>
          <torusGeometry args={[0.19, 0.024, 10, 20]} />
        </mesh>
        <mesh material={RIM_MAT}>
          <cylinderGeometry args={[0.035, 0.035, 0.05, 10]} />
        </mesh>
      </group>
    </group>
  );
}
