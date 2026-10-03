"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@/lib/safeFrame";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";

// First real dynamic (non-kinematic) bodies in the game — every mover
// (Car/Bike/PoliceCar/Player) is a kinematic body driven by hand-rolled
// arcade math (lib/carPhysics.ts); these props/debris are plain Rapier
// dynamics, so a kinematic body's collider shoves them via the normal
// contact solver on contact (that push doesn't go through the character
// controller, so it needs no special wiring — it's just how a kinematic
// body colliding with a dynamic one behaves). Car/Bike/PoliceCar's
// `computeColliderMovement` calls pass QueryFilterFlags.EXCLUDE_DYNAMIC so
// the obstacle SWEEP ignores these (driving doesn't slide/stop on a crate),
// while that solver push still happens every physics step regardless.

type PropKind = "barrel" | "crate" | "barrier";
interface PropSpec {
  x: number;
  z: number;
  kind: PropKind;
}

// A handful of fixed spawn points in the spawn block (City.tsx's (0,0) chunk —
// exempt from random buildings, so guaranteed clear ground) rather than a
// per-chunk procedural system: no mount/unmount churn as the player roams, and
// a knocked-over crate stays knocked over instead of resetting when you loop
// back through. The one thing a fixed top-level pool needs that a per-chunk
// one wouldn't: chunk (0,0)'s ground collider unmounts once the player drives
// ~200+ units away (City.tsx's VIEW=2 streaming radius), so a resting prop
// would otherwise fall forever — handled below by the y<-2 recycle.
const PROP_SPECS: PropSpec[] = [
  { x: 20, z: 42, kind: "barrel" },
  { x: 8, z: 42, kind: "barrel" },
  { x: -20, z: -42, kind: "barrel" },
  { x: 15, z: -15, kind: "crate" },
  { x: -15, z: 15, kind: "crate" },
  { x: 25, z: 5, kind: "crate" },

  // two construction zones along the main lanes (Traffic.tsx's LANES) — off
  // the fixed patrol centreline, on the shoulder, so they read as roadwork
  // the player has to notice/steer around rather than blocking the AI's path
  { x: 46, z: 28, kind: "barrier" },
  { x: 42, z: 28, kind: "crate" },
  { x: -46, z: -38, kind: "barrier" },
  { x: -42, z: -38, kind: "barrel" },
];

// tuned so a tap sends it rolling, not jittering or flying off-map — mass is
// explicit (not density) so these numbers stay meaningful regardless of shape
const PROP_TUNING: Record<PropKind, { mass: number; restitution: number; friction: number }> = {
  barrel: { mass: 12, restitution: 0.2, friction: 0.6 },
  crate: { mass: 8, restitution: 0.1, friction: 0.7 },
  barrier: { mass: 6, restitution: 0.1, friction: 0.8 },
};

function BarrelMesh() {
  return (
    <mesh castShadow receiveShadow>
      <cylinderGeometry args={[0.3, 0.3, 0.9, 14]} />
      <meshStandardMaterial color="#3a6b3a" roughness={0.5} metalness={0.2} />
    </mesh>
  );
}
function CrateMesh() {
  return (
    <mesh castShadow receiveShadow>
      <boxGeometry args={[0.5, 0.5, 0.5]} />
      <meshStandardMaterial color="#8a6a3a" roughness={0.8} />
    </mesh>
  );
}
// construction barricade — orange board with two white stripes, same read as
// the cone/barrel/crate: one prop, one glance, no separate warning sign needed
function BarrierMesh() {
  return (
    <group>
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.1, 0.5, 0.12]} />
        <meshStandardMaterial color="#e8631c" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.13, 0.065]}>
        <boxGeometry args={[0.9, 0.1, 0.01]} />
        <meshStandardMaterial color="#f2f0ea" roughness={0.5} />
      </mesh>
      <mesh position={[0, -0.13, 0.065]}>
        <boxGeometry args={[0.9, 0.1, 0.01]} />
        <meshStandardMaterial color="#f2f0ea" roughness={0.5} />
      </mesh>
    </group>
  );
}

function Prop({ spec }: { spec: PropSpec }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const home = useMemo(
    () =>
      new THREE.Vector3(
        spec.x,
        spec.kind === "barrel" ? 0.45 : 0.25,
        spec.z,
      ),
    [spec],
  );
  const tuning = PROP_TUNING[spec.kind];

  useFrame(() => {
    const body = bodyRef.current;
    if (!body) return;
    // fell through the world (its chunk's ground unmounted while far from the
    // player, or it got knocked off an edge) — put it back home, at rest
    // or got squeezed between two kinematic cars (infinite mass on both
    // sides) and the solver launched it — reset instead of letting a
    // runaway/NaN velocity reach the broad phase
    const t = body.translation();
    const v = body.linvel();
    const bad = !Number.isFinite(t.x + t.y + t.z + v.x + v.y + v.z) || v.x * v.x + v.y * v.y + v.z * v.z > 60 * 60 || Math.abs(t.x - home.x) > 300 || Math.abs(t.z - home.z) > 300;
    if (t.y < -2 || bad) {
      body.setTranslation(home, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    }
  });

  const colliders = spec.kind === "barrel" ? "hull" : "cuboid";

  return (
    <RigidBody
      ref={bodyRef}
      type="dynamic"
      position={home}
      colliders={colliders}
      mass={tuning.mass}
      restitution={tuning.restitution}
      friction={tuning.friction}
    >
      {spec.kind === "barrel" && <BarrelMesh />}
      {spec.kind === "crate" && <CrateMesh />}
      {spec.kind === "barrier" && <BarrierMesh />}
    </RigidBody>
  );
}

// (The old DebrisPool — 12 dynamic Rapier boxes parked on top of each other
// at y=-50 and teleported into every crash — is gone: a crash between the
// player's kinematic car and a kinematic traffic car squeezed those fragments
// between two infinite-mass bodies, the solver blew their velocities up to
// NaN and the physics world locked up ~2 s after the hit. components/Debris.tsx
// already draws the same burst as pooled, physics-free VFX.)

export function Props() {
  return (
    <>
      {PROP_SPECS.map((spec, i) => (
        <Prop key={i} spec={spec} />
      ))}
    </>
  );
}
