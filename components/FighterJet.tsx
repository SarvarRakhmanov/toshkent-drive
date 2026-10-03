"use client";

import { useRef } from "react";
import * as THREE from "three";
import { usePathFollower, type Key } from "@/components/AirportLife";

// Decorative flyover — FORT NEON's airspace patrol. Not mountable: the ask
// was jets "flying over it," not a second flyable aircraft type on top of
// components/Plane.tsx/Helicopter.tsx/DrivableAirliner.tsx, and a fighter's
// flight envelope (this thing needs to bank hard and fast) doesn't fit
// lib/flightPhysics.ts's arcade-airliner model without its own tuning pass.
// Reuses components/AirportLife.tsx's usePathFollower — same keyframed-path
// + bank/pitch driver the airport's circling airliners use, just a smaller,
// faster, higher loop.

const SKIN_MAT = new THREE.MeshStandardMaterial({ color: "#4a4f56", metalness: 0.6, roughness: 0.35 });
const DARK_MAT = new THREE.MeshStandardMaterial({ color: "#1a1c1f", metalness: 0.5, roughness: 0.5 });
const CANOPY_MAT = new THREE.MeshStandardMaterial({ color: "#0e1a24", metalness: 0.8, roughness: 0.1, transparent: true, opacity: 0.65 });
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: "#ff8a3a" });
const NAV_RED = new THREE.MeshBasicMaterial({ color: "#ff2a2a" });
const NAV_GREEN = new THREE.MeshBasicMaterial({ color: "#25ff62" });

export function FighterJetMesh() {
  return (
    <group>
      {/* fuselage */}
      <mesh rotation={[Math.PI / 2, 0, 0]} material={SKIN_MAT} castShadow>
        <cylinderGeometry args={[0.55, 0.4, 9, 12]} />
      </mesh>
      <mesh position={[0, 0, 5.2]} scale={[1, 0.85, 2.2]} material={SKIN_MAT} castShadow>
        <sphereGeometry args={[0.4, 10, 8]} />
      </mesh>
      <mesh position={[0, 0.28, 3.4]} scale={[0.6, 0.5, 1.4]} material={CANOPY_MAT}>
        <sphereGeometry args={[0.42, 10, 8]} />
      </mesh>
      {/* intakes */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.55, -0.1, 1.5]} material={DARK_MAT}>
          <boxGeometry args={[0.4, 0.4, 1.6]} />
        </mesh>
      ))}
      {/* delta wings */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.5, -0.05, -0.8]} rotation={[0, 0, -s * 0.08]}>
          <mesh position={[s * 2.6, 0, -0.6]} rotation={[0, s * 0.5, 0]} material={SKIN_MAT} castShadow>
            <boxGeometry args={[4.6, 0.12, 2.6]} />
          </mesh>
        </group>
      ))}
      {/* tailplanes */}
      {[-1, 1].map((s) => (
        <mesh key={`t${s}`} position={[s * 0.5, -0.05, -4.0]} rotation={[0, s * 0.3, 0]} material={SKIN_MAT}>
          <boxGeometry args={[1.8, 0.1, 1.1]} />
        </mesh>
      ))}
      {/* twin vertical tails */}
      {[-1, 1].map((s) => (
        <mesh key={`v${s}`} position={[s * 0.5, 1.1, -4.2]} rotation={[0, 0, s * 0.18]} material={DARK_MAT}>
          <boxGeometry args={[0.12, 2.0, 1.6]} />
        </mesh>
      ))}
      {/* engine nozzles + afterburner glow */}
      {[-0.5, 0.5].map((x) => (
        <group key={x}>
          <mesh position={[x, 0, -4.6]} rotation={[Math.PI / 2, 0, 0]} material={DARK_MAT}>
            <cylinderGeometry args={[0.32, 0.4, 1.0, 10]} />
          </mesh>
          <mesh position={[x, 0, -5.3]} material={FLAME_MAT}>
            <coneGeometry args={[0.28, 0.9, 8]} />
          </mesh>
        </group>
      ))}
      <mesh position={[-4.0, 0, -1.4]} material={NAV_RED}>
        <sphereGeometry args={[0.1, 6, 6]} />
      </mesh>
      <mesh position={[4.0, 0, -1.4]} material={NAV_GREEN}>
        <sphereGeometry args={[0.1, 6, 6]} />
      </mesh>
    </group>
  );
}

export function FighterJetPatrol({ keys, offset = 0 }: { keys: Key[]; offset?: number }) {
  const ref = useRef<THREE.Group>(null);
  usePathFollower(keys, ref, { offset, bank: 1.4, pitch: 0.4 });
  return (
    <group ref={ref}>
      <FighterJetMesh />
    </group>
  );
}
