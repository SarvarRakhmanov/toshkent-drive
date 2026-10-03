"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { HWY_Z, HWY_W, DECK_H, DECK_X0, DECK_X1, RAMP_THICK, RAMP_X0, RAMP_X1 } from "@/lib/highway";

// I-94 sea bridge — one sloped ramp up from solid ground (RAMP_X0→RAMP_X1),
// then a long flat deck (DECK_X0→DECK_X1, ~950m) straight out over open
// water to FORT NEON's platform (components/MilitaryBase.tsx, flush against
// DECK_X1 — no second ramp down, the base's platform sits at the same
// DECK_H). The ramp is a single tilted RigidBody+CuboidCollider (not a
// discrete "step"), so the existing KinematicCharacterController climbs it
// exactly the way it climbs any other sloped/uneven collider — no special-
// cased "is this a ramp" logic needed in Car.tsx/Bike.tsx/etc, same "solid
// geometry, not a height-hack" call components/Marina.tsx's pier deck made
// for a flat surface.

const DECK_MAT = new THREE.MeshStandardMaterial({ color: "#3a3d44", roughness: 0.9 });
const BARRIER_MAT = new THREE.MeshStandardMaterial({ color: "#c9cdd2", roughness: 0.7 });
const PILLAR_MAT = new THREE.MeshStandardMaterial({ color: "#5a5d63", roughness: 0.75 });
const LINE_MAT = new THREE.MeshBasicMaterial({ color: "#f4c430" });
const EDGE_MAT = new THREE.MeshBasicMaterial({ color: "#eceade" });
const SIGN_MAT = new THREE.MeshStandardMaterial({ color: "#1c7a3a", roughness: 0.6 });
const SIGN_POST_MAT = new THREE.MeshStandardMaterial({ color: "#3a3d42", metalness: 0.4, roughness: 0.6 });

// One sloped RigidBody whose TOP SURFACE bridges (xA,0) to (xB,DECK_H) —
// not its centreline. A tilted box's centre and its top face land at
// different heights once you rotate it (the top face is offset from centre
// by RAMP_THICK/2 *perpendicular* to the slope), and the box's own position
// prop places its centre, not its surface. Getting this wrong is exactly
// what happened the first time: placing the centre at (xA+xB)/2, DECK_H/2
// put the actual drivable surface ~RAMP_THICK/2·cosθ (≈0.8 units for a
// RAMP_THICK=1.6 slab) *above* the ground at the low end — a real vertical
// step, not a ramp, and tall enough that the character controller (no
// autostep enabled for Car.tsx — enableSnapToGround(0.4) alone doesn't
// cover a full unit) just walled the car out instead of letting it climb.
// Solving for where the box's centre must sit so its top face passes
// through (xA,0) and (xB,DECK_H) exactly gives the offset terms below.
function Ramp({ xA, xB, z, w }: { xA: number; xB: number; z: number; w: number }) {
  const run = xB - xA;
  const theta = Math.atan2(DECK_H, run);
  const slopeLen = run / Math.cos(theta);
  const cx = (xA + xB) / 2 + (RAMP_THICK / 2) * Math.sin(theta);
  const cy = DECK_H / 2 - (RAMP_THICK / 2) * Math.cos(theta);
  return (
    <RigidBody type="fixed" colliders={false} position={[cx, cy, z]} rotation={[0, 0, theta]}>
      <CuboidCollider args={[slopeLen / 2, RAMP_THICK / 2, w / 2]} />
      <mesh receiveShadow castShadow material={DECK_MAT}>
        <boxGeometry args={[slopeLen, RAMP_THICK, w]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, RAMP_THICK / 2 + 0.4, (s * w) / 2 - s * 0.3]} material={BARRIER_MAT}>
          <boxGeometry args={[slopeLen, 0.8, 0.5]} />
        </mesh>
      ))}
    </RigidBody>
  );
}

function IHighwaySign({ x, z, heading }: { x: number; z: number; heading: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, heading, 0]}>
      <mesh position={[0, 2.2, 0]} material={SIGN_POST_MAT} castShadow>
        <cylinderGeometry args={[0.14, 0.16, 4.4, 8]} />
      </mesh>
      <mesh position={[0, 4.5, 0]} material={SIGN_MAT} castShadow>
        <boxGeometry args={[2.6, 1.8, 0.12]} />
      </mesh>
      <Text position={[0, 4.9, 0.08]} fontSize={0.6} color="#ffffff" anchorX="center" anchorY="middle" fontWeight="bold">
        INTERSTATE
      </Text>
      <Text position={[0, 4.3, 0.08]} fontSize={0.95} color="#ffffff" anchorX="center" anchorY="middle" fontWeight="bold">
        I-94
      </Text>
    </group>
  );
}

function LaneMarkings({ x0, x1, y, z }: { x0: number; x1: number; y: number; z: number }) {
  const dashes: number[] = [];
  for (let x = x0 + 10; x < x1 - 10; x += 16) dashes.push(x);
  return (
    <group>
      {dashes.map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, y + 0.02, z]} material={LINE_MAT}>
          <planeGeometry args={[8, 0.5]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, y + 0.02, z + s * (HWY_W / 2 - 1.5)]} material={EDGE_MAT}>
          <planeGeometry args={[x1 - x0, 0.35]} />
        </mesh>
      ))}
    </group>
  );
}

export function Highway() {
  const pillarXs: number[] = [];
  for (let x = DECK_X0 + 30; x < DECK_X1; x += 60) pillarXs.push(x);

  return (
    <group>
      {/* ramp up from solid ground */}
      <Ramp xA={RAMP_X0} xB={RAMP_X1} z={HWY_Z} w={HWY_W} />
      {/* long flat deck straight out over open water to FORT NEON */}
      <RigidBody type="fixed" colliders={false} position={[(DECK_X0 + DECK_X1) / 2, DECK_H - RAMP_THICK / 2, HWY_Z]}>
        <CuboidCollider args={[(DECK_X1 - DECK_X0) / 2, RAMP_THICK / 2, HWY_W / 2]} />
        <mesh receiveShadow castShadow material={DECK_MAT}>
          <boxGeometry args={[DECK_X1 - DECK_X0, RAMP_THICK, HWY_W]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, RAMP_THICK / 2 + 0.4, (s * HWY_W) / 2 - s * 0.3]} material={BARRIER_MAT}>
            <boxGeometry args={[DECK_X1 - DECK_X0, 0.8, 0.5]} />
          </mesh>
        ))}
      </RigidBody>
      <LaneMarkings x0={DECK_X0} x1={DECK_X1} y={DECK_H} z={HWY_Z} />

      {/* support pillars under the deck, rising from the waterline */}
      {pillarXs.map((x) => (
        <mesh key={x} position={[x, DECK_H / 2, HWY_Z]} material={PILLAR_MAT} castShadow>
          <boxGeometry args={[2.4, DECK_H, 2.4]} />
        </mesh>
      ))}

      {/* I-94 shield signage at the land-side approach and the platform end */}
      <IHighwaySign x={RAMP_X0 - 8} z={HWY_Z - HWY_W / 2 - 4} heading={Math.PI / 2} />
      <IHighwaySign x={DECK_X1 - 12} z={HWY_Z + HWY_W / 2 + 4} heading={-Math.PI / 2} />
    </group>
  );
}
