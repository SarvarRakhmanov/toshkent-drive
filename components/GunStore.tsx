"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Billboard, Text } from "@react-three/drei";
import { ARMORY } from "@/lib/armory";

const WALL = "#2c2a26";
const SIGN = "#ff5a2a";
const RACK_MAT = "#0e0f11";
const GUN_MAT = "#4a4d54";

// Fixed kiosk at lib/armory.ts's ARMORY spot — not a lib/interiors.ts
// building (nothing to walk into, see lib/armory.ts's own comment), just a
// small structure with a visible weapon rack so "picked up a gun here"
// reads as a real place, plus the collider a real building would have.
export function GunStore() {
  return (
    <group position={[ARMORY.x, 0, ARMORY.z]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[6, 3, 5]} position={[0, 3, 0]} />
      </RigidBody>
      <mesh castShadow receiveShadow position={[0, 3, 0]}>
        <boxGeometry args={[12, 6, 10]} />
        <meshStandardMaterial color={WALL} roughness={0.75} />
      </mesh>
      {/* roll-up shopfront + awning, same "kiosk" language as other small
          storefronts (see lib/interiorSpots.ts's cornerStore/pawnShop) */}
      <mesh position={[0, 1.6, 5.05]}>
        <boxGeometry args={[8, 3.2, 0.1]} />
        <meshStandardMaterial color="#141416" metalness={0.5} roughness={0.3} />
      </mesh>
      <mesh position={[0, 3.6, 5.6]} rotation={[0.35, 0, 0]}>
        <boxGeometry args={[9, 0.15, 2.2]} />
        <meshStandardMaterial color={SIGN} />
      </mesh>
      <pointLight color={SIGN} intensity={2.5} distance={18} position={[0, 4, 6]} />
      <Billboard position={[0, 7.5, 0]}>
        <Text fontSize={1.1} color={SIGN} outlineWidth={0.04} outlineColor="#0a0612">
          ARMORY
        </Text>
      </Billboard>

      {/* weapon rack — a row of angled "rifles" against the back wall,
          visible through the open front, the visual cue this is a gun store */}
      <group position={[0, 1.6, -3.8]}>
        <mesh>
          <boxGeometry args={[7, 3, 0.15]} />
          <meshStandardMaterial color={RACK_MAT} roughness={0.6} />
        </mesh>
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={i} position={[-2.8 + i * 1.1, 0, 0.25]} rotation={[0, 0, 0.12 * (i % 2 === 0 ? 1 : -1)]} castShadow>
            <boxGeometry args={[0.1, 2.2, 0.1]} />
            <meshStandardMaterial color={GUN_MAT} metalness={0.7} roughness={0.35} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
