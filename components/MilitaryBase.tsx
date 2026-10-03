"use client";

import { useRef, type RefObject } from "react";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import {
  BASE_X,
  BASE_Z,
  PLATFORM_Y,
  FENCE_X,
  FENCE_Z,
  WALL_H,
  TOWER_POS,
  GATE_CZ,
  GATE_Z0,
  GATE_Z1,
  WAREHOUSES,
  TANK_FORMATION,
  HELIPAD_POS,
  BARRACKS,
} from "@/lib/militaryBase";
import { CAMO_TEX, repeat } from "@/lib/militaryTextures";
import { PersonFigure } from "@/components/PersonFigure";
import { usePathFollower, type Key } from "@/components/AirportLife";
import { HeliMesh } from "@/components/Helicopter";
import { ParkedTank } from "@/components/Tank";
import { FighterJetPatrol } from "@/components/FighterJet";

// FORT NEON — a fortified military compound at the west end of I-94
// (components/Highway.tsx), the "really, really high security" landmark
// asked for directly: solid perimeter walls (not the airport's chain-link),
// 4 corner guard towers, a single hardened gate, a tank yard, a helipad, and
// posted/patrolling personnel. Same architecture components/Airport.tsx
// established — one anchor <group position={[BASE_X,0,BASE_Z]}>, one
// RigidBody per solid structure — but unlike the airport's walk-in-only gate,
// this one is a real drivable entrance/exit (no VEHICLE_ONLY collider in the
// gap): the tank needs to actually leave the base under its own power.

const WALL_MAT = new THREE.MeshStandardMaterial({ color: "#5a5c54", roughness: 0.9 });
const WALL_CAP_MAT = new THREE.MeshStandardMaterial({ color: "#3a3c36", roughness: 0.85 });
const WIRE_MAT = new THREE.MeshStandardMaterial({ color: "#26281f", roughness: 0.6, metalness: 0.3 });
const TOWER_MAT = new THREE.MeshStandardMaterial({ color: "#4b4d46", roughness: 0.85 });
const ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#2a2c26", roughness: 0.7 });
const HELIPAD_MAT = new THREE.MeshStandardMaterial({ color: "#33352f", roughness: 0.9 });
const GATE_PILLAR_MAT = new THREE.MeshStandardMaterial({ color: "#33352f", roughness: 0.7 });
const BARRIER_ARM_MAT = new THREE.MeshStandardMaterial({ color: "#f4c430", roughness: 0.5 });
const SIGN_MAT = new THREE.MeshStandardMaterial({ color: "#7a1414", roughness: 0.6 });
const SPOTLIGHT_MAT = new THREE.MeshBasicMaterial({ color: "#fff6d8" });
const BARRACKS_MAT = new THREE.MeshStandardMaterial({ color: "#5a5c50", roughness: 0.85 });
const BARRACKS_ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#2a2c26", roughness: 0.7 });
// exported so the drivable gunship on HELIPAD_POS[1] (mounted in
// components/Game.tsx via <Helicopter kind="militaryHeli">) wears the exact
// same livery as the decorative chopper parked on HELIPAD_POS[0]
export const OLIVE_HELI_MAT = new THREE.MeshStandardMaterial({ color: "#4b5320", metalness: 0.35, roughness: 0.5 });
const PYLON_MAT = new THREE.MeshStandardMaterial({ color: "#454742", roughness: 0.85 });
const BOOTH_GLASS_MAT = new THREE.MeshStandardMaterial({ color: "#0e1410", metalness: 0.6, roughness: 0.2, transparent: true, opacity: 0.55 });
// "military texture" — the compound's ground reads as camo netting/paint
// over concrete, not flat grey asphalt like an ordinary city block.
const CAMO_GROUND_MAT = new THREE.MeshStandardMaterial({ map: repeat(CAMO_TEX, 22, 22), roughness: 0.95 });
const WAREHOUSE_MAT = new THREE.MeshStandardMaterial({ map: repeat(CAMO_TEX, 10, 3), roughness: 0.85, metalness: 0.15 });
const WAREHOUSE_ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#33352c", roughness: 0.7 });
const WAREHOUSE_DOOR_MAT = new THREE.MeshStandardMaterial({ color: "#1c1e18", roughness: 0.6, metalness: 0.3 });
const JET_APRON_MAT = new THREE.MeshStandardMaterial({ color: "#3a3c38", roughness: 0.9 });

function WallX({ z, x0, x1 }: { z: number; x0: number; x1: number }) {
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  return (
    <group>
      <mesh position={[mid, WALL_H / 2, z]} material={WALL_MAT} castShadow receiveShadow>
        <boxGeometry args={[len, WALL_H, 1.4]} />
      </mesh>
      <mesh position={[mid, WALL_H + 0.15, z]} material={WALL_CAP_MAT}>
        <boxGeometry args={[len, 0.3, 1.6]} />
      </mesh>
      <mesh position={[mid, WALL_H + 0.55, z]} rotation={[0.4, 0, 0]} material={WIRE_MAT}>
        <boxGeometry args={[len, 0.05, 1.0]} />
      </mesh>
    </group>
  );
}

function WallZ({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const len = z1 - z0;
  const mid = (z0 + z1) / 2;
  return (
    <group>
      <mesh position={[x, WALL_H / 2, mid]} material={WALL_MAT} castShadow receiveShadow>
        <boxGeometry args={[1.4, WALL_H, len]} />
      </mesh>
      <mesh position={[x, WALL_H + 0.15, mid]} material={WALL_CAP_MAT}>
        <boxGeometry args={[1.6, 0.3, len]} />
      </mesh>
      <mesh position={[x, WALL_H + 0.55, mid]} rotation={[0, 0, 0.4]} material={WIRE_MAT}>
        <boxGeometry args={[1.0, 0.05, len]} />
      </mesh>
    </group>
  );
}

function GuardTower({ x, z }: { x: number; z: number }) {
  const deckH = 6.5;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, deckH / 2, 0]} material={TOWER_MAT} castShadow>
        <cylinderGeometry args={[1.3, 1.6, deckH, 8]} />
      </mesh>
      <mesh position={[0, deckH + 0.9, 0]} material={TOWER_MAT} castShadow>
        <cylinderGeometry args={[1.9, 1.9, 1.8, 8]} />
      </mesh>
      <mesh position={[0, deckH + 2.1, 0]} material={ROOF_MAT}>
        <coneGeometry args={[2.2, 1.2, 8]} />
      </mesh>
      <mesh position={[0, deckH + 2.9, 0]} material={SPOTLIGHT_MAT}>
        <sphereGeometry args={[0.2, 8, 8]} />
      </mesh>
      <pointLight position={[0, deckH + 2.9, 0]} color="#fff6d8" intensity={1.4} distance={26} />
      <group position={[0, deckH + 1, 0]} scale={0.9}>
        <PersonFigure legL={NO_ARM} legR={NO_ARM} armL={NO_ARM} armR={NO_ARM} jacketColor="#4b5320" pantsColor="#3a3d2e" skinColor="#8a5a3a" officer />
      </group>
    </group>
  );
}

const NO_ARM: RefObject<THREE.Mesh | null> = { current: null };

function Soldier({ x, z, h = 0 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0, z]} rotation={[0, h, 0]} scale={1.05}>
      <PersonFigure legL={NO_ARM} legR={NO_ARM} armL={NO_ARM} armR={NO_ARM} jacketColor="#4b5320" pantsColor="#3a3d2e" skinColor="#7a5030" officer />
    </group>
  );
}

// A short back-and-forth foot patrol along the gate's inner apron — reuses
// components/AirportLife.tsx's usePathFollower (position/heading only, no
// bank/pitch) the same way components/FighterJet.tsx does for the flyover.
function PatrolSoldier({ keys, offset = 0 }: { keys: Key[]; offset?: number }) {
  const ref = useRef<THREE.Group>(null);
  usePathFollower(keys, ref, { offset });
  return (
    <group ref={ref} scale={1.05}>
      <PersonFigure legL={NO_ARM} legR={NO_ARM} armL={NO_ARM} armR={NO_ARM} jacketColor="#4b5320" pantsColor="#3a3d2e" skinColor="#7a5030" officer />
    </group>
  );
}

function ParkedChopper({ x, z, h }: { x: number; z: number; h: number }) {
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  return (
    <group position={[x, 0.83 * 2.0, z]} rotation={[0, h, 0]} scale={2.0}>
      <HeliMesh rotorRef={rotor} tailRotorRef={tail} bodyMat={OLIVE_HELI_MAT} />
    </group>
  );
}

// One chopper patrols a slow low loop over the base — bank/pitch stays
// gentle, this is a hover-capable aircraft on a lazy circuit, not the
// fighter jet's hard-banking flyover.
function PatrolChopper({ keys }: { keys: Key[] }) {
  const ref = useRef<THREE.Group>(null);
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  usePathFollower(keys, ref, { bank: 0.3, pitch: 0.2 });
  return (
    <group ref={ref} scale={2.0}>
      <HeliMesh rotorRef={rotor} tailRotorRef={tail} bodyMat={OLIVE_HELI_MAT} />
    </group>
  );
}

// Gate sits on the WEST wall — the side facing the bridge/mainland (the
// compound's interior is at local +X from here, the mirror of the airport's
// own east-facing gate whose interior sits at -X).
function Gate() {
  const pillarH = WALL_H + 1.2;
  return (
    <group position={[-FENCE_X, 0, 0]}>
      {[GATE_Z0, GATE_Z1].map((z) => (
        <mesh key={z} position={[0, pillarH / 2, z]} material={GATE_PILLAR_MAT} castShadow>
          <boxGeometry args={[1.6, pillarH, 1.6]} />
        </mesh>
      ))}
      <mesh position={[0, pillarH + 0.15, 0]} material={SIGN_MAT}>
        <boxGeometry args={[1.1, 2.4, GATE_Z1 - GATE_Z0 + 1.6]} />
      </mesh>
      <Text
        position={[0.65, pillarH + 0.15, GATE_CZ]}
        rotation={[0, Math.PI / 2, 0]}
        fontSize={1.35}
        color="#ffe08a"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        RESTRICTED AREA{"\n"}DEADLY FORCE AUTHORIZED
      </Text>
      {/* checkpoint booth just inside the gate */}
      <mesh position={[7, 2.2, GATE_Z1 + 5]} material={TOWER_MAT} castShadow>
        <boxGeometry args={[4.6, 4.4, 4.6]} />
      </mesh>
      <mesh position={[7, 3.3, GATE_Z1 + 2.8]} material={BOOTH_GLASS_MAT}>
        <boxGeometry args={[4.0, 1.8, 0.12]} />
      </mesh>
      <Soldier x={4.2} z={GATE_Z1 + 3.5} h={-Math.PI * 0.6} />
      <Soldier x={-2.4} z={GATE_Z0 - 3} h={Math.PI * 0.4} />
      {/* barrier arm — pure dressing now (raised, no collider of its own):
          the gate is a real drivable opening (see below), the tank and any
          other vehicle needs to actually get in and out through it */}
      <mesh position={[0, 3.6, GATE_CZ]} rotation={[0, 0, Math.PI / 2.1]} material={BARRIER_ARM_MAT}>
        <cylinderGeometry args={[0.07, 0.07, GATE_Z1 - GATE_Z0 - 4, 8]} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.8, pillarH / 2, 0.8]} position={[0, pillarH / 2, GATE_Z0]} />
        <CuboidCollider args={[0.8, pillarH / 2, 0.8]} position={[0, pillarH / 2, GATE_Z1]} />
        <CuboidCollider args={[2.3, 2.2, 2.3]} position={[7, 2.2, GATE_Z1 + 5]} />
        {/* NOTE: the gate gap itself has no VEHICLE_ONLY collider anymore —
            components/Airport.tsx's gate is walk-in-only by design (steal a
            vehicle once inside), but the user asked specifically for tanks
            to be able to drive OUT of FORT NEON, so this gate is a real,
            fully open drivable entrance/exit for every vehicle instead. */}
      </RigidBody>
    </group>
  );
}

function Perimeter() {
  return (
    <group>
      <WallX z={-FENCE_Z} x0={-FENCE_X} x1={FENCE_X} />
      <WallX z={FENCE_Z} x0={-FENCE_X} x1={FENCE_X} />
      <WallZ x={FENCE_X} z0={-FENCE_Z} z1={FENCE_Z} />
      <WallZ x={-FENCE_X} z0={-FENCE_Z} z1={GATE_Z0} />
      <WallZ x={-FENCE_X} z0={GATE_Z1} z1={FENCE_Z} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[FENCE_X, WALL_H / 2, 0.8]} position={[0, WALL_H / 2, -FENCE_Z]} />
        <CuboidCollider args={[FENCE_X, WALL_H / 2, 0.8]} position={[0, WALL_H / 2, FENCE_Z]} />
        <CuboidCollider args={[0.8, WALL_H / 2, FENCE_Z]} position={[FENCE_X, WALL_H / 2, 0]} />
        <CuboidCollider args={[0.8, WALL_H / 2, (GATE_Z0 + FENCE_Z) / 2]} position={[-FENCE_X, WALL_H / 2, (-FENCE_Z + GATE_Z0) / 2]} />
        <CuboidCollider args={[0.8, WALL_H / 2, (FENCE_Z - GATE_Z1) / 2]} position={[-FENCE_X, WALL_H / 2, (GATE_Z1 + FENCE_Z) / 2]} />
      </RigidBody>
      {TOWER_POS.map((t, i) => (
        <GuardTower key={i} x={t.x} z={t.z} />
      ))}
    </group>
  );
}

// The compound sits on its own platform over open water — no natural ground
// out here the way components/Airport.tsx gets for free from its city
// chunk, so this is a real full-footprint RigidBody+CuboidCollider (top
// surface at local y=0, same convention components/City.tsx's own per-chunk
// ground box uses), plus a handful of visual support pylons reaching down to
// the waterline so it reads as a built structure, not a slab floating in air.
function Platform() {
  const pylonH = PLATFORM_Y + 1;
  const pylons: [number, number][] = [
    [-FENCE_X + 20, -FENCE_Z + 20],
    [FENCE_X - 20, -FENCE_Z + 20],
    [-FENCE_X + 20, FENCE_Z - 20],
    [FENCE_X - 20, FENCE_Z - 20],
    [0, -FENCE_Z + 20],
    [0, FENCE_Z - 20],
  ];
  return (
    <group>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[FENCE_X, 0.5, FENCE_Z]} position={[0, -0.5, 0]} />
      </RigidBody>
      <mesh position={[0, -0.5, 0]} receiveShadow material={WALL_CAP_MAT}>
        <boxGeometry args={[FENCE_X * 2, 1, FENCE_Z * 2]} />
      </mesh>
      {pylons.map(([x, z], i) => (
        <mesh key={i} position={[x, -pylonH / 2, z]} material={PYLON_MAT} castShadow>
          <cylinderGeometry args={[5, 6, pylonH, 10]} />
        </mesh>
      ))}
    </group>
  );
}

// A big open-front shed — the door is a flat dark plane on the lane-facing
// wall (no actual opening/collider gap, matching components/Airport.tsx's
// "boxes with better materials" fidelity level rather than a walk-in interior
// nobody asked for here).
function Warehouse({ x, z, w, d, h }: { x: number; z: number; w: number; d: number; h: number }) {
  const faceZ = z < 0 ? d / 2 : -d / 2; // door faces the lane (z=0), whichever side that is
  return (
    <group>
      <mesh position={[x, h / 2, z]} material={WAREHOUSE_MAT} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh position={[x, h + 0.4, z]} material={WAREHOUSE_ROOF_MAT}>
        <boxGeometry args={[w + 3, 0.8, d + 3]} />
      </mesh>
      <mesh position={[x, h * 0.35, z + faceZ]} material={WAREHOUSE_DOOR_MAT}>
        <boxGeometry args={[w * 0.55, h * 0.6, 0.15]} />
      </mesh>
      <Text
        position={[x, h * 0.85, z + faceZ]}
        rotation={[0, faceZ > 0 ? 0 : Math.PI, 0]}
        fontSize={2.4}
        color="#c9cdb8"
        anchorX="center"
        anchorY="middle"
        fontWeight="bold"
      >
        MOTOR POOL
      </Text>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[w / 2, h / 2, d / 2]} position={[x, h / 2, z]} />
      </RigidBody>
    </group>
  );
}

// The motor pool: two warehouses flanking a 3x3 tank formation, all facing
// the gate as if ready to roll out — "parked in a certain way," not scattered.
function MotorPool() {
  return (
    <group>
      {WAREHOUSES.map((w, i) => (
        <Warehouse key={i} x={w.x} z={w.z} w={w.w} d={w.d} h={w.h} />
      ))}
      {TANK_FORMATION.map((s, i) => (
        <ParkedTank key={i} x={s.x} z={s.z} h={s.h} />
      ))}
      <Soldier x={-165} z={-10} h={Math.PI / 2} />
      <Soldier x={-165} z={15} h={-Math.PI / 2} />
    </group>
  );
}

// The jets' apron slab. The jets THEMSELVES are no longer rendered here —
// they're real mountable aircraft now (components/DrivableFighterJet.tsx,
// mounted in components/Game.tsx at world coords derived from JET_APRON), so
// drawing decorative copies in the same slots would double-render each one.
// The slab stays because it's ground dressing, not an airframe.
function JetApron() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[175, 0.02, 0]} receiveShadow material={JET_APRON_MAT}>
      <planeGeometry args={[70, 220]} />
    </mesh>
  );
}

function Helipads() {
  return (
    <group>
      {HELIPAD_POS.map((p, i) => (
        <group key={i} position={[p.x, 0.03, p.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} material={HELIPAD_MAT}>
            <circleGeometry args={[12, 24]} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
            <ringGeometry args={[9.6, 10.4, 32]} />
            <meshBasicMaterial color="#f4c430" />
          </mesh>
          <Text position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={6} color="#f4c430" anchorX="center" anchorY="middle">
            H
          </Text>
        </group>
      ))}
      <ParkedChopper x={HELIPAD_POS[0].x} z={HELIPAD_POS[0].z} h={0.3} />
      <Soldier x={HELIPAD_POS[0].x - 16} z={HELIPAD_POS[0].z} h={Math.PI / 2} />
    </group>
  );
}

function Barracks() {
  return (
    <group>
      {BARRACKS.map((b, i) => (
        <group key={i}>
          <mesh position={[b.x, b.h / 2, b.z]} material={BARRACKS_MAT} castShadow receiveShadow>
            <boxGeometry args={[b.w, b.h, b.d]} />
          </mesh>
          <mesh position={[b.x, b.h + 0.3, b.z]} material={BARRACKS_ROOF_MAT}>
            <boxGeometry args={[b.w + 1.5, 0.6, b.d + 1.5]} />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {BARRACKS.map((b, i) => (
          <CuboidCollider key={i} args={[b.w / 2, b.h / 2, b.d / 2]} position={[b.x, b.h / 2, b.z]} />
        ))}
      </RigidBody>
    </group>
  );
}

// Fighter-jet flyover — a big oval loop high above the whole compound, well
// clear of the guard towers/helipads below (min altitude 140).
const JET_LOOP: Key[] = [
  { t: 0, x: -60, y: 150, z: -260 },
  { t: 8, x: 220, y: 165, z: -160 },
  { t: 16, x: 260, y: 155, z: 60 },
  { t: 24, x: 60, y: 145, z: 240 },
  { t: 32, x: -240, y: 155, z: 160 },
  { t: 40, x: -260, y: 165, z: -60 },
  { t: 48, x: -60, y: 150, z: -260 },
];

// A patrol chopper's slow low loop, well inside the walls
const CHOPPER_LOOP: Key[] = [
  { t: 0, x: -150, y: 45, z: -150 },
  { t: 12, x: 150, y: 50, z: -150 },
  { t: 24, x: 150, y: 45, z: 150 },
  { t: 36, x: -150, y: 50, z: 150 },
  { t: 48, x: -150, y: 45, z: -150 },
];

// Foot patrol on the gate's inner apron, back and forth
const GATE_PATROL: Key[] = [
  { t: 0, x: -FENCE_X + 15, y: 0, z: GATE_Z0 - 8 },
  { t: 6, x: -FENCE_X + 15, y: 0, z: GATE_Z1 + 8 },
  { t: 12, x: -FENCE_X + 15, y: 0, z: GATE_Z0 - 8 },
];

// Motor-pool patrol — walks the open strip between the west warehouse and the
// tank formation. z=-60 threads the gap deliberately: the warehouse footprint
// ends at z=-95 (z -120 centre, depth 50) and the 3x3 formation's outer row
// sits at z=-25, so this lane is clear of both.
const MOTOR_POOL_PATROL: Key[] = [
  { t: 0, x: -160, y: 0, z: -60 },
  { t: 14, x: -30, y: 0, z: -60 },
  { t: 28, x: -160, y: 0, z: -60 },
];

// Barracks frontage — paces the length of both blocks (x 75..125, z ±40) along
// their open side.
const BARRACKS_PATROL: Key[] = [
  { t: 0, x: 70, y: 0, z: 0 },
  { t: 9, x: 132, y: 0, z: 0 },
  { t: 18, x: 70, y: 0, z: 0 },
];

// Apron sentry — paces the line of parked jets at x=175, staying just west of
// the apron slab so they never clip a wing.
const APRON_PATROL: Key[] = [
  { t: 0, x: 140, y: 0, z: -85 },
  { t: 16, x: 140, y: 0, z: 85 },
  { t: 32, x: 140, y: 0, z: -85 },
];

export function MilitaryBase() {
  return (
    <group position={[BASE_X, PLATFORM_Y, BASE_Z]}>
      <Platform />
      {/* compound ground — camo pattern, distinct from ordinary city asphalt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow material={CAMO_GROUND_MAT}>
        <planeGeometry args={[FENCE_X * 2, FENCE_Z * 2]} />
      </mesh>
      <Perimeter />
      <Gate />
      <MotorPool />
      <Helipads />
      <Barracks />
      <JetApron />
      <PatrolChopper keys={CHOPPER_LOOP} />
      {/* Walking patrols. Every other soldier on the base is a static idle
          pose (see Soldier()), so these are what make the compound read as
          staffed rather than staged — two on the motor-pool lane at opposite
          ends of the same route, one per zone elsewhere. */}
      <PatrolSoldier keys={GATE_PATROL} />
      <PatrolSoldier keys={MOTOR_POOL_PATROL} />
      <PatrolSoldier keys={MOTOR_POOL_PATROL} offset={14} />
      <PatrolSoldier keys={BARRACKS_PATROL} />
      <PatrolSoldier keys={APRON_PATROL} />
      <FighterJetPatrol keys={JET_LOOP} />
      <FighterJetPatrol keys={JET_LOOP} offset={24} />
    </group>
  );
}
