"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { debrisQueue, type DebrisBurst } from "@/lib/debris";

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
    if (body.translation().y < -2) {
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

const DEBRIS_POOL_SIZE = 12;
const DEBRIS_LIFETIME = 3; // seconds before a fragment recycles back to its parking spot
const PARK_Y = -50; // hidden well below the world; also naturally sleeps (out of view, no contacts)

interface DebrisSlot {
  body: RapierRigidBody | null;
  age: number; // seconds since last burst; Infinity while parked/idle
}

function DebrisPool() {
  const slots = useRef<DebrisSlot[]>(Array.from({ length: DEBRIS_POOL_SIZE }, () => ({ body: null, age: Infinity })));
  const nextSlot = useRef(0);

  function fireFragments(burst: DebrisBurst) {
    // 4-6 fragments per burst, scaled by impact power; spray back the way the
    // impact came from (away from the wall), not through it
    const count = 4 + Math.round(burst.power * 2);
    for (let i = 0; i < count; i++) {
      const slot = slots.current[nextSlot.current];
      nextSlot.current = (nextSlot.current + 1) % DEBRIS_POOL_SIZE;
      const body = slot.body;
      if (!body) continue;
      const spread = (Math.random() - 0.5) * 0.6;
      const bx = -burst.dx + spread;
      const bz = -burst.dz + spread;
      const len = Math.hypot(bx, bz) || 1;
      body.setTranslation(
        { x: burst.x + (Math.random() - 0.5) * 0.4, y: Math.max(0.3, burst.y), z: burst.z + (Math.random() - 0.5) * 0.4 },
        true,
      );
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const mass = 1;
      body.applyImpulse(
        { x: (bx / len) * burst.power * 6 * mass, y: burst.power * 4 * mass, z: (bz / len) * burst.power * 6 * mass },
        true,
      );
      body.applyTorqueImpulse(
        { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 2 },
        true,
      );
      slot.age = 0;
    }
  }

  useFrame((_, dt) => {
    // drain any bursts queued this frame (Car/Bike/PoliceCar's checkCrashDebris)
    while (debrisQueue.length) {
      const burst = debrisQueue.shift() as DebrisBurst;
      fireFragments(burst);
    }
    // age active fragments, park them once their lifetime is up
    for (const slot of slots.current) {
      if (!slot.body || slot.age === Infinity) continue;
      slot.age += dt;
      if (slot.age > DEBRIS_LIFETIME) {
        slot.body.setTranslation({ x: 0, y: PARK_Y, z: 0 }, true);
        slot.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        slot.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        slot.age = Infinity;
      }
    }
  });

  return (
    <>
      {Array.from({ length: DEBRIS_POOL_SIZE }, (_, i) => (
        <RigidBody
          key={i}
          ref={(el) => {
            slots.current[i].body = el;
          }}
          type="dynamic"
          position={[0, PARK_Y, 0]}
          colliders="cuboid"
          mass={1}
          restitution={0.3}
          friction={0.5}
          linearDamping={0.4}
          angularDamping={0.9}
        >
          <mesh castShadow>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshStandardMaterial color="#6a6a70" roughness={0.7} />
          </mesh>
        </RigidBody>
      ))}
    </>
  );
}

export function Props() {
  return (
    <>
      {PROP_SPECS.map((spec, i) => (
        <Prop key={i} spec={spec} />
      ))}
      <DebrisPool />
    </>
  );
}
