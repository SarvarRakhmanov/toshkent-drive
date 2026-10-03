"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { PoliceCarMesh } from "@/components/PoliceCar";
import { BikeMesh } from "@/components/Bike";
import { PoliceJeepMesh } from "@/components/ParkedPoliceJeep";
import { RIDE_HEIGHT } from "@/components/SupercarBody";

// POLICE HARBOR STATION — modeled on a real modern precinct HQ reference
// photo: charcoal-brick + glass-curtain entrance wing (canted single-slope
// roof, light soffit underside) beside a lower tan-stone signage wing, a
// concrete entry plaza with steps, flagpoles, lamp posts and bollards.
// Positioned at lib/landmarks.ts's POLICE HARBOR coordinate; City.tsx's
// LANDMARK_CHUNKS exemption keeps random buildings off this spot, same
// mechanism as every other landmark. Front still faces +Z (unrotated), same
// as the previous version. (490,90) is a clear chunk interior, not the old
// (450,50) — that sat exactly on a road intersection (see landmarks.ts).
// Traffic.tsx's police convoy lane still patrols the x=450 road nearby;
// that lane doesn't need the building sitting on top of it.
const PX = 490;
const PZ = 90;

const BRICK_MAT = new THREE.MeshStandardMaterial({ color: "#2b2a2c", roughness: 0.85 });
const GLASS_MAT = new THREE.MeshStandardMaterial({ color: "#0c1016", roughness: 0.12, metalness: 0.5 });
const STONE_MAT = new THREE.MeshStandardMaterial({ color: "#b7ab8f", roughness: 0.92 });
const ROOF_DARK_MAT = new THREE.MeshStandardMaterial({ color: "#232428", roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide });
const SOFFIT_MAT = new THREE.MeshStandardMaterial({ color: "#e7e6e0", roughness: 0.7 });
const CONCRETE_MAT = new THREE.MeshStandardMaterial({ color: "#c7c6bd", roughness: 0.95 });
const DOOR_MAT = new THREE.MeshStandardMaterial({ color: "#05070a", roughness: 0.15, metalness: 0.4 });
const POLE_MAT = new THREE.MeshStandardMaterial({ color: "#101114", roughness: 0.5, metalness: 0.4 });
const LAMP_MAT = new THREE.MeshStandardMaterial({ color: "#fff3d8", emissive: new THREE.Color("#ffd9a0"), emissiveIntensity: 0.7 });

// ---- glass entrance wing ----
const GX = -8,
  GZ = -2,
  GW = 20,
  GD = 15,
  GH = 8.4;

// ---- stone signage wing ----
const SX = 12,
  SZ = 0,
  SW = 18,
  SD = 12,
  SH = 5.6;

// window-grid curtain wall — vertical black mullions over one big glass plane,
// cheaper than individual panes and reads right at driving distance
function CurtainWall() {
  const cols = 9;
  const step = GW / cols;
  return (
    <group position={[GX, GH * 0.55, GZ + GD / 2 + 0.04]}>
      <mesh material={GLASS_MAT}>
        <boxGeometry args={[GW - 1, GH * 0.86, 0.1]} />
      </mesh>
      {Array.from({ length: cols + 1 }, (_, i) => (
        <mesh key={i} position={[-GW / 2 + step * i, 0, 0.06]} material={POLE_MAT}>
          <boxGeometry args={[0.08, GH * 0.86, 0.04]} />
        </mesh>
      ))}
      {/* one horizontal mullion splitting the curtain wall into two storeys */}
      <mesh position={[0, GH * 0.86 * 0.15, 0.06]} material={POLE_MAT}>
        <boxGeometry args={[GW - 1, 0.08, 0.04]} />
      </mesh>
    </group>
  );
}

function Flagpole({ x, color }: { x: number; color: string }) {
  return (
    <group position={[x, 0, GZ + GD / 2 + 6.5]}>
      <mesh position={[0, 4.5, 0]} castShadow material={POLE_MAT}>
        <cylinderGeometry args={[0.06, 0.08, 9, 8]} />
      </mesh>
      <mesh position={[0.9, 8.1, 0]} material={new THREE.MeshStandardMaterial({ color, roughness: 0.8, side: THREE.DoubleSide })}>
        <planeGeometry args={[1.8, 1.1]} />
      </mesh>
    </group>
  );
}

function LampPost({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 1.7, 0]} castShadow material={POLE_MAT}>
        <cylinderGeometry args={[0.05, 0.06, 3.4, 8]} />
      </mesh>
      <mesh position={[0, 3.5, 0]} material={POLE_MAT}>
        <boxGeometry args={[0.28, 0.32, 0.28]} />
      </mesh>
      <mesh position={[0, 3.4, 0]} material={LAMP_MAT}>
        <sphereGeometry args={[0.11, 8, 8]} />
      </mesh>
    </group>
  );
}

function Bollard({ x, z }: { x: number; z: number }) {
  return (
    <mesh position={[x, 0.45, z]} castShadow material={CONCRETE_MAT}>
      <cylinderGeometry args={[0.28, 0.3, 0.9, 12]} />
    </mesh>
  );
}

// ---- marked fleet lots, flanking the building's sides (not the middle
// plaza) — same perpendicular-divider-line convention as MizuRestaurant's
// ParkingRow, just laid out along Z instead of X since these lots run
// alongside the building rather than across its front ----
const LOT_LINE_MAT = new THREE.MeshBasicMaterial({ color: "#f0efe6" });
const STALL_W = 3.4;
const STALL_D = 6;
const LOT_Z_START = -3.4;
const LOT_STALLS = 3;

function LotLines({ x }: { x: number }) {
  return (
    <>
      {Array.from({ length: LOT_STALLS + 1 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.04, LOT_Z_START + i * STALL_W]} material={LOT_LINE_MAT}>
          <planeGeometry args={[STALL_D, 0.12]} />
        </mesh>
      ))}
    </>
  );
}

function stallZ(i: number) {
  return LOT_Z_START + STALL_W * (i + 0.5);
}

// nose-in toward the building: left lot faces +X, right lot faces -X
function ParkedCruiser({ x, z, facing }: { x: number; z: number; facing: number }) {
  const lightRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([null, null]);
  return (
    <group position={[x, RIDE_HEIGHT, z]} rotation={[0, facing, 0]}>
      <PoliceCarMesh lightRefs={lightRefs} detail="low" />
    </group>
  );
}

function ParkedBike({ x, z, facing }: { x: number; z: number; facing: number }) {
  return (
    <group position={[x, 1, z]} rotation={[0, facing, 0]}>
      <BikeMesh />
    </group>
  );
}

function ParkedJeep({ x, z, facing }: { x: number; z: number; facing: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, facing, 0]}>
      <PoliceJeepMesh />
    </group>
  );
}

export function PoliceStation() {
  const beaconA = useRef<THREE.PointLight>(null);
  const beaconB = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const flashRed = Math.floor(state.clock.elapsedTime * 5) % 2 === 0;
    if (beaconA.current) beaconA.current.color.set(flashRed ? "#ff1818" : "#100000");
    if (beaconB.current) beaconB.current.color.set(flashRed ? "#0a1030" : "#2452ff");
  });

  return (
    <group position={[PX, 0, PZ]}>
      {/* entry plaza (light concrete, replaces the old dark asphalt pad) + two step tiers */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.02, 12]} receiveShadow material={CONCRETE_MAT}>
        <planeGeometry args={[46, 26]} />
      </mesh>
      {[0.16, 0.32].map((h, i) => (
        <mesh key={i} position={[GX, h / 2, GZ + GD / 2 + 3.4 - i * 0.9]} material={CONCRETE_MAT}>
          <boxGeometry args={[14 - i * 1.6, h, 0.9]} />
        </mesh>
      ))}

      <RigidBody type="fixed" colliders={false}>
        {/* +0.3 on the z half-extent so this fully swallows the brick pier,
            which projects 1.2 forward of the main glass volume */}
        <CuboidCollider args={[GW / 2 + 1.5, GH / 2, GD / 2 + 0.3]} position={[GX - 0.75, GH / 2, GZ]} />
        <CuboidCollider args={[SW / 2, SH / 2, SD / 2]} position={[SX, SH / 2, SZ]} />
      </RigidBody>

      {/* ---------- glass + brick entrance wing ---------- */}
      <mesh castShadow receiveShadow position={[GX, GH / 2, GZ]} material={BRICK_MAT}>
        <boxGeometry args={[GW, GH, GD]} />
      </mesh>
      {/* charcoal brick corner pier, projecting slightly ahead of the glass plane */}
      <mesh castShadow position={[GX - GW / 2 - 0.6, (GH + 1.3) / 2, GZ + 1.2]} material={BRICK_MAT}>
        <boxGeometry args={[2.4, GH + 1.3, GD - 2]} />
      </mesh>
      <CurtainWall />
      {/* canted single-slope roof: dark top, light soffit underside, overhangs the entrance */}
      <mesh position={[GX, GH + 0.25, GZ + 1.5]} rotation={[-0.09, 0, 0]} castShadow material={ROOF_DARK_MAT}>
        <boxGeometry args={[GW + 2.4, 0.35, GD + 4]} />
      </mesh>
      <mesh position={[GX, GH + 0.02, GZ + 1.5]} rotation={[-0.09, 0, 0]} material={SOFFIT_MAT}>
        <boxGeometry args={[GW + 2, 0.06, GD + 3.6]} />
      </mesh>

      {/* entrance doors, centred on the glass wing */}
      <mesh position={[GX, 2.2, GZ + GD / 2 + 0.1]} material={DOOR_MAT}>
        <boxGeometry args={[3.6, 4.4, 0.08]} />
      </mesh>

      {/* flanking beacon poles — flash the same red/blue rig as PoliceCar's light bar */}
      {[-1, 1].map((sgn) => (
        <group key={sgn} position={[GX + sgn * 3.4, 0, GZ + GD / 2 + 1.6]}>
          <mesh position={[0, 2, 0]} castShadow material={POLE_MAT}>
            <cylinderGeometry args={[0.12, 0.15, 4, 8]} />
          </mesh>
          <mesh position={[0, 4.1, 0]}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshBasicMaterial color="#ff1818" />
          </mesh>
          <mesh position={[0, 3.7, 0]}>
            <sphereGeometry args={[0.18, 8, 8]} />
            <meshBasicMaterial color="#2452ff" />
          </mesh>
          <pointLight ref={sgn === -1 ? beaconA : beaconB} position={[0, 3.9, 0]} intensity={1.4} distance={18} />
        </group>
      ))}

      {/* ---------- stone signage wing ---------- */}
      <mesh castShadow receiveShadow position={[SX, SH / 2, SZ]} material={STONE_MAT}>
        <boxGeometry args={[SW, SH, SD]} />
      </mesh>
      <mesh position={[SX, SH + 0.15, SZ]} material={ROOF_DARK_MAT} castShadow>
        <boxGeometry args={[SW + 0.6, 0.3, SD + 0.6]} />
      </mesh>
      <Text position={[SX - 1.5, SH * 0.62, SZ + SD / 2 + 0.06]} fontSize={0.85} color="#1c1e22" anchorX="center" anchorY="middle">
        POLICE HARBOR
      </Text>
      <group position={[SX + 6, SH * 0.62, SZ + SD / 2 + 0.06]}>
        <mesh material={POLE_MAT}>
          <torusGeometry args={[0.9, 0.09, 8, 24]} />
        </mesh>
        <mesh position={[0, 0, -0.02]} material={new THREE.MeshStandardMaterial({ color: "#2452ff", roughness: 0.6 })}>
          <circleGeometry args={[0.82, 24]} />
        </mesh>
      </group>

      {/* flagpoles flanking the plaza approach */}
      <Flagpole x={GX - 3.2} color="#c8262c" />
      <Flagpole x={GX + 3.2} color="#2452ff" />

      {/* lamp posts along the plaza edge */}
      <LampPost x={GX - 8} z={GZ + GD / 2 + 8} />
      <LampPost x={GX} z={GZ + GD / 2 + 10.5} />
      <LampPost x={GX + 8} z={GZ + GD / 2 + 8} />

      {/* concrete bollards along the plaza's outer edge */}
      {Array.from({ length: 5 }, (_, i) => (
        <Bollard key={i} x={GX - 9 + i * 4.5} z={GZ + GD / 2 + 13} />
      ))}

      {/* marked fleet lots on the SIDES of the building, not in the middle of
          the plaza — mirrors the reference brief: cars/bikes/jeeps parked
          flanking the station, each lot's stalls striped with white lines */}
      <LotLines x={-27} />
      <ParkedCruiser x={-27} z={stallZ(0)} facing={Math.PI / 2} />
      <ParkedBike x={-27} z={stallZ(1)} facing={Math.PI / 2} />
      <ParkedCruiser x={-27} z={stallZ(2)} facing={Math.PI / 2} />

      <LotLines x={30} />
      <ParkedCruiser x={30} z={stallZ(0)} facing={-Math.PI / 2} />
      <ParkedJeep x={30} z={stallZ(1)} facing={-Math.PI / 2} />
      <ParkedCruiser x={30} z={stallZ(2)} facing={-Math.PI / 2} />
    </group>
  );
}
