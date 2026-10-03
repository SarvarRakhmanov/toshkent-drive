"use client";

import { type RefObject } from "react";
import * as THREE from "three";

// A boxy 4x4 silhouette — the fleet's third body style alongside the
// interceptor (PoliceCarMesh) and the motorcycle (BikeMesh), since nothing
// jeep-shaped exists on SupercarBody. Static decoration at
// components/PoliceStation.tsx; the airport gate copy (components/Airport.tsx's
// GateGuardPost) is a real drivable rig (components/PoliceJeep.tsx), which is
// what `lightRefs` below is for — undefined-safe so the decorative call site
// doesn't need to pass one.
const BLACK_MAT = new THREE.MeshStandardMaterial({ color: "#0d0f14", roughness: 0.5, metalness: 0.2 });
const WHITE_MAT = new THREE.MeshStandardMaterial({ color: "#e9edf2", roughness: 0.45 });
const CHROME_MAT = new THREE.MeshStandardMaterial({ color: "#2a2c32", metalness: 0.9, roughness: 0.3 });
const TIRE_MAT = new THREE.MeshStandardMaterial({ color: "#161616", roughness: 0.9 });
const GLASS_MAT = new THREE.MeshStandardMaterial({ color: "#0a0c10", roughness: 0.2, metalness: 0.3 });

export function PoliceJeepMesh({
  lightRefs,
}: {
  lightRefs?: RefObject<(THREE.MeshBasicMaterial | null)[]>;
} = {}) {
  return (
    <group position={[0, 0.42, 0]}>
      {/* lower black body + upper white cab — same two-tone cue as the interceptor */}
      <mesh castShadow position={[0, 0, 0]} material={BLACK_MAT}>
        <boxGeometry args={[1.9, 0.85, 4.3]} />
      </mesh>
      <mesh castShadow position={[0, 0.62, -0.2]} material={WHITE_MAT}>
        <boxGeometry args={[1.82, 0.62, 2.6]} />
      </mesh>
      <mesh position={[0, 0.62, -0.2]} material={GLASS_MAT}>
        <boxGeometry args={[1.86, 0.4, 2.68]} />
      </mesh>

      {/* roof light bar — flashes when lightRefs is supplied (drivable rig),
          static red/blue otherwise (decorative parked copy) */}
      <mesh position={[-0.28, 0.98, -0.4]}>
        <boxGeometry args={[0.5, 0.1, 0.28]} />
        <meshBasicMaterial ref={(el) => { if (lightRefs) lightRefs.current[0] = el; }} color="#ff2020" />
      </mesh>
      <mesh position={[0.28, 0.98, -0.4]}>
        <boxGeometry args={[0.5, 0.1, 0.28]} />
        <meshBasicMaterial ref={(el) => { if (lightRefs) lightRefs.current[1] = el; }} color="#2040ff" />
      </mesh>
      {/* roof rack rails */}
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, 0.95, 0.3]} material={CHROME_MAT}>
          <boxGeometry args={[0.06, 0.06, 1.6]} />
        </mesh>
      ))}

      {/* push bar across the nose */}
      <mesh position={[0, -0.1, 2.28]} material={CHROME_MAT}>
        <boxGeometry args={[1.6, 0.12, 0.08]} />
      </mesh>
      {[0.55, -0.55].map((x) => (
        <mesh key={x} position={[x, -0.2, 2.24]} material={CHROME_MAT}>
          <boxGeometry args={[0.09, 0.3, 0.07]} />
        </mesh>
      ))}

      {/* headlights + taillights */}
      {[0.6, -0.6].map((x) => (
        <mesh key={`h${x}`} position={[x, 0, 2.14]}>
          <boxGeometry args={[0.32, 0.2, 0.04]} />
          <meshBasicMaterial color="#eaf2ff" />
        </mesh>
      ))}
      {[0.6, -0.6].map((x) => (
        <mesh key={`t${x}`} position={[x, 0, -2.14]}>
          <boxGeometry args={[0.28, 0.2, 0.04]} />
          <meshBasicMaterial color="#ff2b2b" />
        </mesh>
      ))}

      {/* chunky wheels, higher ride height than the sedan/interceptor */}
      {[
        [0.95, 1.5],
        [0.95, -1.5],
        [-0.95, 1.5],
        [-0.95, -1.5],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} rotation={[0, 0, Math.PI / 2]} position={[x, -0.42, z]} castShadow material={TIRE_MAT}>
          <cylinderGeometry args={[0.42, 0.42, 0.32, 16]} />
        </mesh>
      ))}
    </group>
  );
}
