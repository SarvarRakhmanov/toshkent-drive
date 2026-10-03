"use client";

import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { LAND_EDGE_X, PIER_LEN, PIER_Z } from "@/lib/marina";
import { WATER_BOUNDARY } from "@/lib/collisionGroups";

// EAST MARINA dock — ported from the original's shore/pier block (index.html
// ~line 4493-4523: kerb, bollards, deck, pilings, lamp). The deck gets a real
// RigidBody+CuboidCollider here (unlike the original's height-hack `onPier`
// check) — Car/Bike/Player already climb onto solid geometry fine via their
// KinematicCharacterController's autostep, so a normal collider is a
// straight upgrade, same call Milestone 1 made for the player-car collision
// generally. Boats don't get this collider (Boat.tsx never queries Rapier
// colliders — Milestone 2) — see lib/marina.ts's pierPush() for their side.
export function Marina() {
  return (
    <group>
      {/* kerb along the shore — deliberately NOT a collider, same as the original:
          drive off the edge into the water rather than bouncing off a wall */}
      <mesh position={[LAND_EDGE_X + 0.9, 0.25, PIER_Z]} receiveShadow>
        <boxGeometry args={[2.2, 0.5, 24]} />
        <meshStandardMaterial color="#5a4632" roughness={0.85} />
      </mesh>
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[LAND_EDGE_X - 1.4, 0.35, PIER_Z - 8 + i * 4]} castShadow>
          <cylinderGeometry args={[0.22, 0.26, 0.7, 8]} />
          <meshStandardMaterial color="#2a2d34" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[PIER_LEN / 2, 0.2, 4.5]} position={[LAND_EDGE_X + PIER_LEN / 2, 0.5, PIER_Z]} />
      </RigidBody>

      {/* invisible shore wall — blocks cars/bikes from driving into the water
          anywhere along the coast (pier gap at PIER_Z±4.5 stays open so the
          dock above is still reachable by land). Sits at LAND_EDGE_X, the
          true edge of the last solid city chunk — not further out at
          SHORE_X, or a car free-falls through the ground gap before ever
          reaching the wall (see lib/marina.ts). City.tsx streams chunks
          unbounded in z, so this runs the full length rather than a fixed
          span — no matter how far along the coast you drive, it holds.
          Taller than the controller's 0.3 autostep so it stops rather than
          climbs. Thickened to 2.0 to prevent high-speed clipping. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[2.0, 0.6, 50000]} position={[LAND_EDGE_X - 1, 0.6, PIER_Z - 4.5 - 50000]} />
        <CuboidCollider args={[2.0, 0.6, 50000]} position={[LAND_EDGE_X - 1, 0.6, PIER_Z + 4.5 + 50000]} />
        {/* closes the pier gap for every player-driven vehicle (car/bike/jeep/
            bus/truck — see lib/collisionGroups.ts's VEHICLE_BODY_GROUPS) while
            staying invisible to the on-foot player, who still walks through
            here to reach the dock and board a boat. WATER_BOUNDARY, not
            VEHICLE_ONLY: that tag is deliberately see-through to the
            player's OWN vehicle (it's what lets your car pass the airport
            gate) — reusing it here was the actual hole that let a driven car
            reach open water through this exact gap. */}
        <CuboidCollider args={[2.0, 0.6, 4.5]} position={[LAND_EDGE_X - 1, 0.6, PIER_Z]} collisionGroups={WATER_BOUNDARY} />
      </RigidBody>
      <mesh position={[LAND_EDGE_X + PIER_LEN / 2, 0.5, PIER_Z]} receiveShadow castShadow>
        <boxGeometry args={[PIER_LEN, 0.4, 9]} />
        <meshStandardMaterial color="#6b4a2a" roughness={0.85} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => [-1, 1].map((s) => (
        <mesh key={`${i}-${s}`} position={[LAND_EDGE_X + 4 + i * (PIER_LEN / 6), 0.1, PIER_Z + s * 3.9]}>
          <cylinderGeometry args={[0.3, 0.34, 2.2, 8]} />
          <meshStandardMaterial color="#4a3520" roughness={0.9} />
        </mesh>
      )))}
      <mesh position={[LAND_EDGE_X + PIER_LEN - 2, 2.5, PIER_Z]}>
        <cylinderGeometry args={[0.09, 0.13, 4, 6]} />
        <meshStandardMaterial color="#2a2d34" metalness={0.5} roughness={0.5} />
      </mesh>
      <mesh position={[LAND_EDGE_X + PIER_LEN - 2, 4.6, PIER_Z]}>
        <sphereGeometry args={[0.35, 10, 8]} />
        <meshBasicMaterial color="#ffe6a8" />
      </mesh>
      <pointLight position={[LAND_EDGE_X + PIER_LEN - 2, 4.6, PIER_Z]} color="#ffe6a8" intensity={1.2} distance={20} />
    </group>
  );
}
