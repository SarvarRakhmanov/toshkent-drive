"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Billboard, Text } from "@react-three/drei";
import { useHudStore } from "@/lib/hudStore";
import { registerInterior } from "@/lib/interiors";
import { BUILDING_SPOTS, type BuildingSpot } from "@/lib/interiorSpots";

// Phase 2 of lib/interiors.ts (see lib/club.ts for the original single-building
// version this generalizes from): one generic exterior/interior pair, instanced
// once per lib/interiorSpots.ts entry, instead of 12 bespoke files each
// hand-modeling their own building the way VENU (components/Club.tsx) does.
// Same walk-up/press-E/real-interior pattern, plainer set dressing.
for (const b of BUILDING_SPOTS) {
  const doorOut = { x: b.ext.x, z: b.ext.z + b.d / 2 + 2 };
  const doorIn = { x: b.pocket.x, z: b.pocket.z + b.roomD / 2 - 2 };
  registerInterior({
    id: b.id,
    displayName: b.displayName,
    enterMsg: b.displayName,
    exitMsg: "BACK ON THE STREET",
    doorOut,
    doorIn,
    interiorSpawn: { x: b.pocket.x, z: b.pocket.z, h: Math.PI },
    enterRadius2: 22,
    exitRadius2: 14,
    hintEnterRadius2: 40,
    hintExitRadius2: 30,
  });
}

function BuildingExterior({ b }: { b: BuildingSpot }) {
  const doorZ = b.ext.z + b.d / 2 + 0.1;
  return (
    <group position={[b.ext.x, 0, b.ext.z]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[b.w / 2, b.h / 2, b.d / 2]} position={[0, b.h / 2, 0]} />
      </RigidBody>
      <mesh castShadow receiveShadow position={[0, b.h / 2, 0]}>
        <boxGeometry args={[b.w, b.h, b.d]} />
        <meshStandardMaterial color={b.color} roughness={0.6} metalness={0.15} />
      </mesh>
      {/* glass door slot on the south face, matching doorOut's trigger point */}
      <mesh position={[0, 1.8, b.d / 2 + 0.05]}>
        <planeGeometry args={[Math.min(4, b.w * 0.4), 3.4]} />
        <meshStandardMaterial color="#0e1216" metalness={0.6} roughness={0.15} transparent opacity={0.75} />
      </mesh>
      <pointLight color={b.signColor} intensity={2} distance={16} position={[0, b.h * 0.7, doorZ]} />
      <Billboard position={[0, b.h + 1.4, 0]}>
        <Text fontSize={1.1} color={b.signColor} outlineWidth={0.04} outlineColor="#0a0612" anchorX="center" anchorY="middle">
          {b.displayName}
        </Text>
        {b.hospital && (
          <Text position={[0, -1.4, 0]} fontSize={1.6} color="#ff3b3b" outlineWidth={0.05} outlineColor="#0a0612">
            +
          </Text>
        )}
      </Billboard>
    </group>
  );
}

function BuildingInterior({ b }: { b: BuildingSpot }) {
  const active = useHudStore((s) => s.inClub && s.activeBuildingId === b.id);
  if (!active) return null;
  const W = b.roomW;
  const D = b.roomD;
  const H = 4.2;
  const wallColor = b.hospital ? "#f4f6f8" : "#2a2a30";
  const floorColor = b.hospital ? "#dfe6ea" : "#3a3a42";
  return (
    <group position={[b.pocket.x, 0, b.pocket.z]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[W / 2, 0.1, D / 2]} position={[0, -0.1, 0]} />
        <CuboidCollider args={[W / 2, H / 2, 0.2]} position={[0, H / 2, -D / 2]} />
        <CuboidCollider args={[W / 2, H / 2, 0.2]} position={[0, H / 2, D / 2]} />
        <CuboidCollider args={[0.2, H / 2, D / 2]} position={[-W / 2, H / 2, 0]} />
        <CuboidCollider args={[0.2, H / 2, D / 2]} position={[W / 2, H / 2, 0]} />
      </RigidBody>
      <mesh receiveShadow position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={floorColor} roughness={0.85} />
      </mesh>
      <mesh position={[0, H / 2, -D / 2]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} side={2} />
      </mesh>
      <mesh position={[0, H / 2, D / 2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} side={2} />
      </mesh>
      <mesh position={[-W / 2, H / 2, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} side={2} />
      </mesh>
      <mesh position={[W / 2, H / 2, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[D, H]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} side={2} />
      </mesh>
      <pointLight color={b.hospital ? "#ffffff" : b.signColor} intensity={3} distance={D} position={[0, H - 0.3, 0]} />
      <Billboard position={[0, 2.4, -D / 2 + 0.3]}>
        <Text fontSize={0.6} color={b.signColor} outlineWidth={0.02} outlineColor="#0a0612">
          {b.displayName}
        </Text>
      </Billboard>
    </group>
  );
}

export function EnterableBuildings() {
  return (
    <>
      {BUILDING_SPOTS.map((b) => (
        <BuildingExterior key={b.id} b={b} />
      ))}
      {BUILDING_SPOTS.map((b) => (
        <BuildingInterior key={b.id} b={b} />
      ))}
    </>
  );
}
