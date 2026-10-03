"use client";

import * as THREE from "three";

// Ported from the original's attachMirrors(grp,y,z) (index.html line 5390) — angled
// side mirrors: a dark arm plus a blue-tinted glass disc, mounted at a given y/z on
// the boat's console/cabin. Shared by Boat.tsx and PatrolBoat.tsx so the geometry
// isn't duplicated per hull.
export function BoatMirrors({ y, z }: { y: number; z: number }) {
  return (
    <>
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * 0.6, y, z]} rotation={[0, 0, sx * 0.5]}>
            <cylinderGeometry args={[0.02, 0.02, 0.22, 6]} />
            <meshStandardMaterial color="#1a1a1e" metalness={0.5} roughness={0.5} />
          </mesh>
          <mesh position={[sx * 0.72, y + 0.06, z]} rotation={[0, sx * 0.9, 0]}>
            <circleGeometry args={[0.09, 10]} />
            <meshStandardMaterial color="#1f6fe0" metalness={0.9} roughness={0.12} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </>
  );
}
