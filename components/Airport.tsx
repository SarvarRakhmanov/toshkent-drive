"use client";

import { useRef, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { HeliMesh } from "@/components/Helicopter";
import { LIVERIES } from "@/components/Airliner";
import { BrokenJet, WorkVehicle, MovingAirliner, circuitKeys, taxiKeys, WorkVehicleMesh, type Key } from "@/components/AirportLife";
import { RUNWAY_TEX, CONCRETE_TEX, CORRUGATED_TEX, TERMINAL_GLASS_TEX, repeat } from "@/lib/airportTextures";
import { VEHICLE_ONLY } from "@/lib/collisionGroups";

// INTERNATIONAL AIRPORT — the map's biggest landmark by a wide margin: a
// 480x480m walled airfield (see components/City.tsx's AIRPORT_CHUNKS, which
// clears the whole 5x5 chunk block around centre chunk (-8,1) / world
// (-750,100), and lib/landmarks.ts's entry). Moved 450m further west (was
// -300) so it reads as a proper cross-town trip from VENU instead of "right
// next door" — see lib/vehicleState.ts and components/Traffic.tsx for the
// other airport-relative coordinates that had to move by the same amount.
//
// Same idiom as components/MizuRestaurant.tsx: module-scope shared materials,
// one <group position={[AX,0,AZ]}> wrapper so every constant below is
// airport-local, and one <RigidBody type="fixed" colliders={false}> with an
// explicit CuboidCollider per solid piece.
//
// Split across three files:
//   - this file: the field itself (runway + lighting, taxiways, aprons,
//     terminal, control tower, hangars, cargo yard, fuel farm, fence/gate)
//     plus the statically parked aircraft;
//   - components/Airliner.tsx: the wide-body jet model, at real scale (58m
//     long, 56m span) so it towers over the 1.8m ground crew;
//   - components/AirportLife.tsx: everything that moves — airliners flying the
//     full taxi/takeoff/circuit/landing loop, ground crew, security patrols,
//     baggage/fuel/stair/pushback vehicles, and the one wrecked airframe under
//     repair (the only aircraft here that never flies).
//
// The player's own flyable aircraft (components/Plane.tsx, Helicopter.tsx) are
// siblings in Game.tsx and park on this field via lib/vehicleState.ts.
const AX = -750;
const AZ = 100;

// ---------------------------------------------------------- materials ------
const RUNWAY_MAT = new THREE.MeshStandardMaterial({ map: repeat(RUNWAY_TEX, 42, 5), roughness: 1 });
const TAXI_MAT = new THREE.MeshStandardMaterial({ map: repeat(CONCRETE_TEX, 30, 2), roughness: 0.98 });
const APRON_MAT = new THREE.MeshStandardMaterial({ map: repeat(CONCRETE_TEX, 34, 14), roughness: 0.95 });
const GRASS_MAT = new THREE.MeshStandardMaterial({ color: "#2f4a2c", roughness: 1 });
const LINE_MAT = new THREE.MeshBasicMaterial({ color: "#eceade" });
const YELLOW_LINE_MAT = new THREE.MeshBasicMaterial({ color: "#f4c430" });
const RED_MAT = new THREE.MeshBasicMaterial({ color: "#e2371f" });
const TERM_WALL_MAT = new THREE.MeshStandardMaterial({ color: "#c4c9d0", roughness: 0.55, metalness: 0.2 });
const TERM_GLASS_MAT = new THREE.MeshStandardMaterial({
  map: repeat(TERMINAL_GLASS_TEX, 12, 1),
  roughness: 0.12,
  metalness: 0.5,
  emissiveMap: repeat(TERMINAL_GLASS_TEX, 12, 1),
  emissive: new THREE.Color("#8fc4e8"),
  emissiveIntensity: 0.35,
});
const ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#2a2f36", roughness: 0.5, metalness: 0.35 });
const TOWER_GLASS_MAT = new THREE.MeshStandardMaterial({
  color: "#16242f",
  roughness: 0.06,
  metalness: 0.7,
  transparent: true,
  opacity: 0.55,
  emissive: new THREE.Color("#39708c"),
  emissiveIntensity: 0.45,
});
const HANGAR_WALL_MAT = new THREE.MeshStandardMaterial({ map: repeat(CORRUGATED_TEX, 14, 4), metalness: 0.55, roughness: 0.5 });
const HANGAR_ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#5a5f66", roughness: 0.45, metalness: 0.55 });
const HANGAR_DOOR_MAT = new THREE.MeshStandardMaterial({ map: repeat(CORRUGATED_TEX, 10, 3), color: "#7a8088", metalness: 0.5, roughness: 0.55 });
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#14161a", roughness: 0.5, metalness: 0.4 });
const STEEL_MAT = new THREE.MeshStandardMaterial({ color: "#828993", metalness: 0.75, roughness: 0.35 });
const SIGN_BOARD_MAT = new THREE.MeshStandardMaterial({ color: "#111114", roughness: 0.7 });
const WINDSOCK_POLE_MAT = new THREE.MeshStandardMaterial({ color: "#c7ccd2", metalness: 0.6, roughness: 0.35 });
const WINDSOCK_FABRIC_MAT = new THREE.MeshStandardMaterial({ color: "#ff6a1a", roughness: 0.85 });
const BEACON_MAT = new THREE.MeshBasicMaterial({ color: "#ffffff" });
const FENCE_POST_MAT = new THREE.MeshStandardMaterial({ color: "#4a4d52", metalness: 0.4, roughness: 0.6 });
const FENCE_PANEL_MAT = new THREE.MeshStandardMaterial({
  color: "#8a8f96",
  transparent: true,
  opacity: 0.32,
  roughness: 0.85,
  side: THREE.DoubleSide,
});
const GATE_PILLAR_MAT = new THREE.MeshStandardMaterial({ color: "#2c2e33", roughness: 0.6, metalness: 0.3 });
const GATE_SIGN_MAT = new THREE.MeshStandardMaterial({ color: "#151619", roughness: 0.7 });
const CONTAINER_MATS = ["#b8452f", "#2f6bb8", "#2f8a5c", "#c9a227", "#6b4fa0"].map(
  (color) => new THREE.MeshStandardMaterial({ map: repeat(CORRUGATED_TEX, 3, 1), color, metalness: 0.4, roughness: 0.6 })
);
const TANK_MAT = new THREE.MeshStandardMaterial({ color: "#d6dae0", metalness: 0.6, roughness: 0.4 });

// Cargo container positions, bucketed by which of the 5 CONTAINER_MATS each
// one uses — precomputed once (same loop CargoYard used to build individual
// <mesh> elements from) so each bucket becomes one InstancedMesh instead of
// ~32 separate box draw calls.
const CARGO_CONTAINER_GEO = new THREE.BoxGeometry(12, 3, 6.4);
const CARGO_CONTAINER_POS_BY_MAT: [number, number, number][][] = (() => {
  const buckets: [number, number, number][][] = CONTAINER_MATS.map(() => []);
  let i = 0;
  for (let x = -20; x <= 20; x += 13) {
    for (let z = -46; z <= -20; z += 8) {
      const stack = 1 + ((i * 7) % 3);
      for (let s = 0; s < stack; s++) {
        buckets[(i + s) % CONTAINER_MATS.length].push([x, 1.6 + s * 3.1, z]);
      }
      i++;
    }
  }
  return buckets;
})();

// runway/taxiway light materials — MeshBasic so they read as emitters at any
// time of day and pick up the scene bloom (see Game.tsx's DynamicBloom)
const LIGHT_WHITE = new THREE.MeshBasicMaterial({ color: "#fff6e0" });
const LIGHT_GREEN = new THREE.MeshBasicMaterial({ color: "#22ff6a" });
const LIGHT_RED = new THREE.MeshBasicMaterial({ color: "#ff2a2a" });
const LIGHT_BLUE = new THREE.MeshBasicMaterial({ color: "#3aa8ff" });

// ---------------------------------------------------------- dimensions -----
const RUNWAY_LEN = 420;
const RUNWAY_W = 50;
const RUNWAY_Z = -165;
const RUNWAY_X0 = -RUNWAY_LEN / 2;
const RUNWAY_X1 = RUNWAY_LEN / 2;

const TAXI_Z = -105; // parallel taxiway centreline
const TAXI_W = 26;
const CONNECTOR_XS = [-190, 0, 190];

const APRON_W = 470;
const APRON_D = 200;
const APRON_CZ = 5;

// terminal — one long pier building facing the apron (its -Z face)
const TW = 300,
  TD = 46,
  TH = 22,
  TX = 0,
  TZ = 150;

// control tower — freestanding, tall enough to read from across the map
const TOWER_X = 190,
  TOWER_Z = 178,
  TOWER_H = 52,
  TOWER_R = 5;

// two maintenance hangars, east side
const HW = 74,
  HD = 62,
  HH = 30;
const HANGARS: [number, number][] = [
  [195, 95],
  [195, 15],
];

// gate stands: aircraft park nose-in toward the terminal
const GATE_XS = [-70, 0, 70];
const GATE_Z = 65;
// the two stands worked by the aircraft actually flying the circuit
const CIRCUIT_GATE_XS = [-140, 140];

const CARGO_X = -195,
  CARGO_Z = 10;

const HELIPAD_X = -200;
const HELIPAD_ZS = [90, 132, 174, 216];

// ------------------------------------------------- static light layout -----
// Runway/taxiway light fields are all fixed-position emissive spheres —
// precomputed once here (deterministic given the dimensions above) so each
// colour renders as one InstancedMesh instead of one <mesh> per bulb. This
// was ~80 draw calls (44 white edge + 14 threshold + 22 taxiway blue) for
// static geometry that never moves.
function rangeX(step: number): number[] {
  const xs: number[] = [];
  for (let x = RUNWAY_X0; x <= RUNWAY_X1; x += step) xs.push(x);
  return xs;
}

const RUNWAY_EDGE_Z = RUNWAY_W / 2 + 2.5;
const RUNWAY_WHITE_LIGHT_POS: [number, number, number][] = rangeX(20).flatMap(
  (x) => [
    [x, 0.45, RUNWAY_EDGE_Z],
    [x, 0.45, -RUNWAY_EDGE_Z],
  ] as [number, number, number][]
);
const THRESHOLD_ZS = [-18, -12, -6, 0, 6, 12, 18];
const RUNWAY_GREEN_LIGHT_POS: [number, number, number][] = THRESHOLD_ZS.map((z) => [RUNWAY_X0 - 1.5, 0.4, z]);
const RUNWAY_RED_LIGHT_POS: [number, number, number][] = THRESHOLD_ZS.map((z) => [RUNWAY_X1 + 1.5, 0.4, z]);
const TAXI_BLUE_LIGHT_POS: [number, number, number][] = rangeX(40).flatMap(
  (x) => [
    [x, 0.4, TAXI_Z + TAXI_W / 2 + 1.5],
    [x, 0.4, TAXI_Z - TAXI_W / 2 - 1.5],
  ] as [number, number, number][]
);

const LIGHT_SPHERE_042_GEO = new THREE.SphereGeometry(0.42, 6, 6);
const LIGHT_SPHERE_038_GEO = new THREE.SphereGeometry(0.38, 6, 6);

// Approach-lighting "rabbit": 5 bars x 5 lights, sequenced by recolouring
// per-instance rather than swapping 5 shared materials across 25 meshes —
// one InstancedMesh, one draw call, `setColorAt` per frame instead.
const APPROACH_BAR_COUNT = 5;
const APPROACH_LIGHTS_PER_BAR = 5;
const APPROACH_LIGHT_GEO = new THREE.SphereGeometry(0.4, 6, 6);
const APPROACH_LIGHT_MAT = new THREE.MeshBasicMaterial({ color: "#ffffff", vertexColors: true });
const APPROACH_ON_COLOR = new THREE.Color("#ffffff");
const APPROACH_OFF_COLOR = new THREE.Color("#1a1a1c");
const APPROACH_LIGHT_POS: [number, number, number][] = Array.from({ length: APPROACH_BAR_COUNT }, (_, bar) =>
  [-6, -3, 0, 3, 6].map((z) => [RUNWAY_X0 - 8 - bar * 6, 0.5, z] as [number, number, number])
).flat();

// Generic static-position InstancedMesh: sets every instance's matrix once
// on mount (nothing here ever moves), used for the light fields above and
// for CargoYard's containers.
function InstancedStatic({
  positions,
  geometry,
  mat,
  castShadow = false,
}: {
  positions: [number, number, number][];
  geometry: THREE.BufferGeometry;
  mat: THREE.Material;
  castShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    positions.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [positions]);
  if (positions.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, mat, positions.length]} castShadow={castShadow} />;
}

// ---- perimeter fence + gate ----
// The gate is centred on GATE_CZ = -50 (local) = world z 50, which is a real
// road centreline (z ≡ 50 mod 100, see components/City.tsx's chunk grid). A
// car driving the city grid arrives at the gate on its own instead of having
// to find a 28m opening buried mid-block — the whole reason the airport read
// as "sealed, no way in" before. It's also wide (60m) so it's unmissable on
// foot. Cars still can't drive through it: a VEHICLE_ONLY collider spans the
// gap (see PerimeterFence), so a car reaching the gate has to U-turn while a
// pedestrian walks straight in.
const FENCE_H = 4.2;
const POST_SPACING = 10;
const FENCE_X = 240;
const FENCE_Z = 240;
const GATE_CZ = -50; // world z 50 — on the road grid
const GATE_HALF = 30; // 60m opening
const GATE_Z0 = GATE_CZ - GATE_HALF;
const GATE_Z1 = GATE_CZ + GATE_HALF;
const GATE_POST_X = 214;

function Stripe({
  x,
  z,
  w,
  d,
  mat = LINE_MAT,
  y = 0.06,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  mat?: THREE.Material;
  y?: number;
}) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, y, z]} material={mat}>
      <planeGeometry args={[w, d]} />
    </mesh>
  );
}

function RunwayMarkings() {
  const centreline = [];
  for (let x = RUNWAY_X0 + 25; x < RUNWAY_X1 - 20; x += 30) centreline.push(x);
  const pianoZ = [-18, -12, -6, 0, 6, 12, 18];
  const tdz = [60, 90, 120]; // touchdown-zone bar groups, both ends
  return (
    <group position={[0, 0, RUNWAY_Z]}>
      {centreline.map((x) => (
        <Stripe key={x} x={x} z={0} w={18} d={1.2} />
      ))}
      {[RUNWAY_W / 2 - 1.2, -RUNWAY_W / 2 + 1.2].map((z) => (
        <Stripe key={z} x={0} z={z} w={RUNWAY_LEN - 6} d={0.9} />
      ))}
      {/* threshold "piano keys" at both ends */}
      {[RUNWAY_X0 + 12, RUNWAY_X1 - 12].map((x) =>
        pianoZ.map((z) => <Stripe key={`${x}:${z}`} x={x} z={z} w={20} d={2.6} />)
      )}
      {/* touchdown-zone markings */}
      {tdz.map((d) =>
        [-1, 1].map((s) =>
          [1, -1].map((sz) => (
            <Stripe key={`${d}:${s}:${sz}`} x={s * (RUNWAY_X1 - d)} z={sz * 5} w={14} d={2} />
          ))
        )
      )}
      {/* runway designators */}
      <Text
        position={[RUNWAY_X0 + 34, 0.07, 0]}
        rotation={[-Math.PI / 2, 0, Math.PI / 2]}
        fontSize={11}
        color="#eceade"
        anchorX="center"
        anchorY="middle"
      >
        09
      </Text>
      <Text
        position={[RUNWAY_X1 - 34, 0.07, 0]}
        rotation={[-Math.PI / 2, 0, -Math.PI / 2]}
        fontSize={11}
        color="#eceade"
        anchorX="center"
        anchorY="middle"
      >
        27
      </Text>
    </group>
  );
}

// Runway lighting: white edge lights at 20m spacing, green threshold bar at
// the 09 end, red end bar at the 27 end, plus a 4-light PAPI abeam the
// touchdown zone. Plain emissive spheres — no real lights (44 point lights
// would cost more than the whole rest of the airport put together), the bloom
// pass is what makes them glow at night.
function RunwayLights() {
  return (
    <group position={[0, 0, RUNWAY_Z]}>
      <InstancedStatic positions={RUNWAY_WHITE_LIGHT_POS} geometry={LIGHT_SPHERE_042_GEO} mat={LIGHT_WHITE} />
      <InstancedStatic positions={RUNWAY_GREEN_LIGHT_POS} geometry={LIGHT_SPHERE_042_GEO} mat={LIGHT_GREEN} />
      <InstancedStatic positions={RUNWAY_RED_LIGHT_POS} geometry={LIGHT_SPHERE_042_GEO} mat={LIGHT_RED} />
      {/* PAPI: two white, two red — only 4, left as plain meshes */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={`p${i}`} position={[RUNWAY_X0 + 100, 0.9, -RUNWAY_EDGE_Z - 8 - i * 3]} material={i < 2 ? LIGHT_WHITE : LIGHT_RED}>
          <boxGeometry args={[1.6, 0.8, 1.4]} />
        </mesh>
      ))}
    </group>
  );
}

// Sequenced approach lighting ("the rabbit") off the 09 threshold: five bars
// strobing inbound, one every ~0.13s. One InstancedMesh (APPROACH_LIGHT_GEO/
// _MAT/_POS, module scope) recoloured per-instance via setColorAt instead of
// swapping 5 shared materials across 25 separate meshes.
function ApproachLights() {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    APPROACH_LIGHT_POS.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, APPROACH_OFF_COLOR);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, []);
  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const step = Math.floor(state.clock.elapsedTime / 0.13) % 9;
    for (let bar = 0; bar < APPROACH_BAR_COUNT; bar++) {
      const color = step === bar ? APPROACH_ON_COLOR : APPROACH_OFF_COLOR;
      for (let j = 0; j < APPROACH_LIGHTS_PER_BAR; j++) mesh.setColorAt(bar * APPROACH_LIGHTS_PER_BAR + j, color);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return (
    <group position={[0, 0, RUNWAY_Z]}>
      <instancedMesh ref={ref} args={[APPROACH_LIGHT_GEO, APPROACH_LIGHT_MAT, APPROACH_LIGHT_POS.length]} />
    </group>
  );
}

function TaxiwayMarkings() {
  return (
    <group>
      {/* taxiway centreline + blue edge lights */}
      <Stripe x={0} z={TAXI_Z} w={RUNWAY_LEN} d={0.8} mat={YELLOW_LINE_MAT} y={0.07} />
      <InstancedStatic positions={TAXI_BLUE_LIGHT_POS} geometry={LIGHT_SPHERE_038_GEO} mat={LIGHT_BLUE} />
      {/* connector centrelines + hold-short bars */}
      {CONNECTOR_XS.map((x) => (
        <group key={x}>
          <Stripe x={x} z={(RUNWAY_Z + TAXI_Z) / 2} w={0.8} d={TAXI_Z - RUNWAY_Z} mat={YELLOW_LINE_MAT} y={0.07} />
          {[-2, -0.8, 0.8, 2].map((d) => (
            <Stripe key={d} x={x + d} z={RUNWAY_Z + 34} w={0.5} d={TAXI_W} mat={YELLOW_LINE_MAT} y={0.07} />
          ))}
        </group>
      ))}
      {/* apron lead-in lines into each stand */}
      {[...GATE_XS, ...CIRCUIT_GATE_XS].map((x) => (
        <Stripe key={`lead${x}`} x={x} z={GATE_Z - 40} w={0.9} d={110} mat={YELLOW_LINE_MAT} y={0.07} />
      ))}
    </group>
  );
}

function Helipads() {
  return (
    <group>
      {HELIPAD_ZS.map((z) => (
        <group key={z} position={[HELIPAD_X, 0.06, z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} material={TAXI_MAT}>
            <circleGeometry args={[14, 28]} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={LINE_MAT}>
            <ringGeometry args={[11.4, 12.4, 40]} />
          </mesh>
          <Text position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={7} color="#e8e8de" anchorX="center" anchorY="middle">
            H
          </Text>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <mesh
              key={i}
              position={[Math.cos((i * Math.PI) / 3) * 13.6, 0.3, Math.sin((i * Math.PI) / 3) * 13.6]}
              material={LIGHT_GREEN}
            >
              <sphereGeometry args={[0.35, 6, 6]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// Parked helicopter — HeliMesh (components/Helicopter.tsx) with a slow idling
// rotor, scaled up to match the field's real-world scale.
function ParkedHeli({ x, z, h, scale = 2.2 }: { x: number; z: number; h: number; scale?: number }) {
  const rotor = useRef<THREE.Group>(null);
  const tail = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (rotor.current) rotor.current.rotation.y += dt * 1.2;
    if (tail.current) tail.current.rotation.x += dt * 2.4;
  });
  return (
    // HeliMesh's own skids bottom out at local y ~ -0.83 (see
    // lib/flightPhysics.ts's HELI_HANDLING.groundClearance comment) — scale
    // that by the same factor as the group so the skids land on y=0 instead
    // of hovering.
    <group position={[x, 0.83 * scale, z]} rotation={[0, h, 0]} scale={scale}>
      <HeliMesh rotorRef={rotor} tailRotorRef={tail} />
    </group>
  );
}

function Windsock({ x, z }: { x: number; z: number }) {
  const sockRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (sockRef.current) sockRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 1.3) * 0.15;
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 4.4, 0]} material={WINDSOCK_POLE_MAT} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 8.8, 8]} />
      </mesh>
      <mesh ref={sockRef} position={[0, 8.3, 0]} material={WINDSOCK_FABRIC_MAT}>
        <coneGeometry args={[0.7, 2.8, 10, 1, true]} />
      </mesh>
    </group>
  );
}

function ControlTowerBeacon() {
  useFrame((state) => {
    const on = Math.floor(state.clock.elapsedTime * 2) % 2 === 0;
    BEACON_MAT.color.set(on ? "#ffffff" : "#1a4d2a");
  });
  return (
    <mesh position={[TOWER_X, TOWER_H + 7.5, TOWER_Z]} material={BEACON_MAT}>
      <sphereGeometry args={[0.8, 10, 10]} />
    </mesh>
  );
}

// Freestanding control tower: shaft, cantilevered glass cab, roof mast.
function ControlTower() {
  return (
    <group position={[TOWER_X, 0, TOWER_Z]}>
      <mesh castShadow receiveShadow position={[0, TOWER_H / 2, 0]} material={TERM_WALL_MAT}>
        <cylinderGeometry args={[TOWER_R, TOWER_R * 1.35, TOWER_H, 16]} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[0, 8 + i * 7, 0]} material={TRIM_MAT}>
          <cylinderGeometry args={[TOWER_R + 0.25, TOWER_R + 0.25, 0.5, 16]} />
        </mesh>
      ))}
      <mesh castShadow position={[0, TOWER_H + 3, 0]} material={TOWER_GLASS_MAT}>
        <cylinderGeometry args={[TOWER_R * 2.1, TOWER_R * 1.7, 6, 16]} />
      </mesh>
      <mesh position={[0, TOWER_H + 6.3, 0]} material={ROOF_MAT}>
        <cylinderGeometry args={[TOWER_R * 2.3, TOWER_R * 2.3, 0.7, 16]} />
      </mesh>
      {/* radar sweep on the roof */}
      <RadarDish />
    </group>
  );
}

function RadarDish() {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.8;
  });
  return (
    <group ref={ref} position={[0, TOWER_H + 9, 0]}>
      <mesh rotation={[0.5, 0, 0]} material={STEEL_MAT}>
        <boxGeometry args={[7, 0.25, 1.8]} />
      </mesh>
      <mesh material={STEEL_MAT}>
        <cylinderGeometry args={[0.3, 0.3, 2.4, 8]} />
      </mesh>
    </group>
  );
}

// Jet bridge: a raised walkway tube from the terminal face out to a stand.
function JetBridge({ x }: { x: number }) {
  const z0 = TZ - TD / 2; // terminal apron face
  const z1 = GATE_Z + 26; // aircraft door
  const len = z0 - z1;
  return (
    <group position={[x, 0, (z0 + z1) / 2]}>
      <mesh position={[0, 8.5, 0]} material={TERM_WALL_MAT} castShadow>
        <boxGeometry args={[4.4, 4.2, len]} />
      </mesh>
      <mesh position={[0, 8.5, 0]} material={TOWER_GLASS_MAT}>
        <boxGeometry args={[4.5, 2.0, len - 2]} />
      </mesh>
      {/* rotunda + support legs */}
      <mesh position={[0, 5.5, -len / 2 + 2]} material={STEEL_MAT}>
        <cylinderGeometry args={[1.6, 1.8, 11, 12]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 1.6, 3.2, -len / 2 + 4]} rotation={[0, 0, s * 0.18]} material={STEEL_MAT}>
          <cylinderGeometry args={[0.35, 0.35, 6.4, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function Terminal() {
  const glassH = TH * 0.62;
  return (
    <group position={[TX, 0, TZ]}>
      <mesh castShadow receiveShadow position={[0, TH / 2, 0]} material={TERM_WALL_MAT}>
        <boxGeometry args={[TW, TH, TD]} />
      </mesh>
      {/* curved-ish roof slab overhanging the apron face */}
      <mesh position={[0, TH + 0.7, -1.5]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[TW + 4, 1.4, TD + 7]} />
      </mesh>
      {/* full-height curtain wall facing the apron (local -Z) */}
      <mesh position={[0, glassH / 2 + 1.5, -TD / 2 - 0.06]} material={TERM_GLASS_MAT}>
        <boxGeometry args={[TW - 8, glassH, 0.12]} />
      </mesh>
      {/* landside face + entrance canopy */}
      <mesh position={[0, glassH / 2 + 1.5, TD / 2 + 0.06]} material={TERM_GLASS_MAT}>
        <boxGeometry args={[TW - 30, glassH * 0.7, 0.12]} />
      </mesh>
      <mesh position={[0, 7.5, TD / 2 + 7]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[90, 0.6, 14]} />
      </mesh>
      {[-40, -14, 14, 40].map((x) => (
        <mesh key={x} position={[x, 3.75, TD / 2 + 12]} material={STEEL_MAT}>
          <cylinderGeometry args={[0.32, 0.32, 7.5, 10]} />
        </mesh>
      ))}
      <mesh position={[0, TH * 0.78, -TD / 2 - 0.2]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[70, 5, 0.3]} />
      </mesh>
      <Text position={[0, TH * 0.78, -TD / 2 - 0.4]} rotation={[0, Math.PI, 0]} fontSize={3.4} color="#8fd6ff" anchorX="center" anchorY="middle">
        INTERNATIONAL AIRPORT
      </Text>
      <mesh position={[0, TH * 0.78, TD / 2 + 0.2]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[70, 5, 0.3]} />
      </mesh>
      <Text position={[0, TH * 0.78, TD / 2 + 0.4]} fontSize={3.4} color="#8fd6ff" anchorX="center" anchorY="middle">
        TERMINAL 1 — DEPARTURES
      </Text>
      {/* gate numbers over the curtain wall */}
      {GATE_XS.map((x, i) => (
        <Text
          key={x}
          position={[x, 5.5, -TD / 2 - 0.4]}
          rotation={[0, Math.PI, 0]}
          fontSize={2.2}
          color="#f4c430"
          anchorX="center"
          anchorY="middle"
        >
          {`GATE ${i + 2}`}
        </Text>
      ))}
    </group>
  );
}

function Hangar({ x, z, open = false }: { x: number; z: number; open?: boolean }) {
  const wallH = HH * 0.66;
  const roofRise = HH - wallH;
  const panelLen = Math.sqrt((HW / 2) ** 2 + roofRise ** 2);
  const panelAngle = Math.atan2(roofRise, HW / 2);
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow receiveShadow position={[0, wallH / 2, 0]} material={HANGAR_WALL_MAT}>
        <boxGeometry args={[HW, wallH, HD]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh
          key={s}
          castShadow
          position={[(s * HW) / 4, wallH + roofRise / 2, 0]}
          rotation={[0, 0, -s * panelAngle]}
          material={HANGAR_ROOF_MAT}
        >
          <boxGeometry args={[panelLen, 0.5, HD + 1.5]} />
        </mesh>
      ))}
      {/* sliding door leaves on the apron face (local -Z) — the open hangar
          leaves a gap wide enough to taxi a jet through */}
      {(open ? [-1] : [-1, 1]).map((s) => (
        <mesh key={s} position={[(s * HW) / 4, wallH * 0.5, -HD / 2 - 0.2]} material={HANGAR_DOOR_MAT} castShadow>
          <boxGeometry args={[HW / 2 - 0.6, wallH, 0.5]} />
        </mesh>
      ))}
      <mesh position={[0, wallH + 0.6, -HD / 2 - 0.4]} material={SIGN_BOARD_MAT}>
        <boxGeometry args={[26, 3.2, 0.3]} />
      </mesh>
      <Text position={[0, wallH + 0.6, -HD / 2 - 0.6]} rotation={[0, Math.PI, 0]} fontSize={2.1} color="#e8e8de" anchorX="center" anchorY="middle">
        {open ? "MAINTENANCE" : "HANGAR"}
      </Text>
      {/* roof-edge obstruction lights */}
      {[-HW / 2, HW / 2].map((dx) =>
        [-HD / 2, HD / 2].map((dz) => (
          <mesh key={`${dx}:${dz}`} position={[dx, HH + 0.4, dz]} material={LIGHT_RED}>
            <sphereGeometry args={[0.45, 6, 6]} />
          </mesh>
        ))
      )}
    </group>
  );
}

// Apron floodlight mast — tall pole, head of emissive lamps. Cosmetic only
// (no real lights: the scene already has sun/moon + bloom, and 8 more shadow-
// casting lights would be the single most expensive thing on the map).
function FloodMast({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 14, 0]} material={STEEL_MAT} castShadow>
        <cylinderGeometry args={[0.4, 0.7, 28, 8]} />
      </mesh>
      <mesh position={[0, 28.4, 0]} material={TRIM_MAT}>
        <boxGeometry args={[7, 0.6, 2.4]} />
      </mesh>
      {[-2.4, -0.8, 0.8, 2.4].map((dx) => (
        <mesh key={dx} position={[dx, 28.0, 0]} material={LIGHT_WHITE}>
          <boxGeometry args={[1.3, 0.5, 1.9]} />
        </mesh>
      ))}
      <mesh position={[0, 29.2, 0]} material={LIGHT_RED}>
        <sphereGeometry args={[0.35, 6, 6]} />
      </mesh>
    </group>
  );
}

function CargoYard() {
  return (
    <group position={[CARGO_X, 0, CARGO_Z]}>
      {CONTAINER_MATS.map((mat, idx) => (
        <InstancedStatic key={idx} positions={CARGO_CONTAINER_POS_BY_MAT[idx]} geometry={CARGO_CONTAINER_GEO} mat={mat} castShadow />
      ))}
      {/* cargo shed */}
      <mesh position={[0, 9, 46]} material={HANGAR_WALL_MAT} castShadow receiveShadow>
        <boxGeometry args={[70, 18, 34]} />
      </mesh>
      <mesh position={[0, 18.4, 46]} material={HANGAR_ROOF_MAT}>
        <boxGeometry args={[72, 1, 36]} />
      </mesh>
      <Text position={[0, 13, 28.8]} rotation={[0, Math.PI, 0]} fontSize={3} color="#f4c430" anchorX="center" anchorY="middle">
        AIR CARGO
      </Text>
      {/* loading dock rollers */}
      {[-24, -8, 8, 24].map((x) => (
        <mesh key={x} position={[x, 1.4, 27.5]} material={TRIM_MAT}>
          <boxGeometry args={[10, 2.8, 3]} />
        </mesh>
      ))}
    </group>
  );
}

function FuelFarm() {
  return (
    <group position={[-205, 0, -60]}>
      {[0, 1, 2].map((i) => (
        <group key={i} position={[0, 0, i * 30]}>
          <mesh position={[0, 7, 0]} material={TANK_MAT} castShadow>
            <cylinderGeometry args={[10, 10, 14, 20]} />
          </mesh>
          <mesh position={[0, 14.4, 0]} material={TANK_MAT}>
            <sphereGeometry args={[10, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, 15.6, 0]} material={LIGHT_RED}>
            <sphereGeometry args={[0.4, 6, 6]} />
          </mesh>
          <Text position={[0, 8, -10.2]} rotation={[0, Math.PI, 0]} fontSize={2.4} color="#c1272d" anchorX="center" anchorY="middle">
            JET A-1
          </Text>
        </group>
      ))}
      {/* pipework */}
      <mesh position={[12, 1.2, 30]} rotation={[Math.PI / 2, 0, 0]} material={STEEL_MAT}>
        <cylinderGeometry args={[0.6, 0.6, 74, 10]} />
      </mesh>
    </group>
  );
}

function FenceWallX({ z, x0, x1 }: { z: number; x0: number; x1: number }) {
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  const postCount = Math.max(2, Math.round(len / POST_SPACING) + 1);
  return (
    <group>
      <mesh position={[mid, FENCE_H / 2, z]} material={FENCE_PANEL_MAT}>
        <boxGeometry args={[len, FENCE_H, 0.06]} />
      </mesh>
      {/* barbed-wire topping — one thin angled rail, reads as razor wire at
          distance without modelling coils */}
      <mesh position={[mid, FENCE_H + 0.45, z + 0.2]} rotation={[0.5, 0, 0]} material={FENCE_POST_MAT}>
        <boxGeometry args={[len, 0.05, 0.9]} />
      </mesh>
      {Array.from({ length: postCount }, (_, i) => {
        const x = x0 + (len * i) / (postCount - 1);
        return (
          <mesh key={i} position={[x, FENCE_H / 2, z]} material={FENCE_POST_MAT}>
            <cylinderGeometry args={[0.12, 0.14, FENCE_H, 6]} />
          </mesh>
        );
      })}
    </group>
  );
}

function FenceWallZ({ x, z0, z1 }: { x: number; z0: number; z1: number }) {
  const len = z1 - z0;
  const mid = (z0 + z1) / 2;
  const postCount = Math.max(2, Math.round(len / POST_SPACING) + 1);
  return (
    <group>
      <mesh position={[x, FENCE_H / 2, mid]} material={FENCE_PANEL_MAT}>
        <boxGeometry args={[0.06, FENCE_H, len]} />
      </mesh>
      <mesh position={[x + 0.2, FENCE_H + 0.45, mid]} rotation={[0, 0, 0.5]} material={FENCE_POST_MAT}>
        <boxGeometry args={[0.9, 0.05, len]} />
      </mesh>
      {Array.from({ length: postCount }, (_, i) => {
        const z = z0 + (len * i) / (postCount - 1);
        return (
          <mesh key={i} position={[x, FENCE_H / 2, z]} material={FENCE_POST_MAT}>
            <cylinderGeometry args={[0.12, 0.14, FENCE_H, 6]} />
          </mesh>
        );
      })}
    </group>
  );
}

function PerimeterFence() {
  return (
    <group>
      <FenceWallX z={-FENCE_Z} x0={-FENCE_X} x1={FENCE_X} />
      <FenceWallX z={FENCE_Z} x0={-FENCE_X} x1={FENCE_X} />
      <FenceWallZ x={-FENCE_X} z0={-FENCE_Z} z1={FENCE_Z} />
      <FenceWallZ x={FENCE_X} z0={-FENCE_Z} z1={GATE_Z0} />
      <FenceWallZ x={FENCE_X} z0={GATE_Z1} z1={FENCE_Z} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[FENCE_X, FENCE_H / 2, 0.1]} position={[0, FENCE_H / 2, -FENCE_Z]} />
        <CuboidCollider args={[FENCE_X, FENCE_H / 2, 0.1]} position={[0, FENCE_H / 2, FENCE_Z]} />
        <CuboidCollider args={[0.1, FENCE_H / 2, FENCE_Z]} position={[-FENCE_X, FENCE_H / 2, 0]} />
        <CuboidCollider
          args={[0.1, FENCE_H / 2, (GATE_Z0 + FENCE_Z) / 2]}
          position={[FENCE_X, FENCE_H / 2, (-FENCE_Z + GATE_Z0) / 2]}
        />
        <CuboidCollider
          args={[0.1, FENCE_H / 2, (FENCE_Z - GATE_Z1) / 2]}
          position={[FENCE_X, FENCE_H / 2, (GATE_Z1 + FENCE_Z) / 2]}
        />
        {/* the gate gap itself: no vehicle drives through it — VEHICLE_ONLY
            (see lib/collisionGroups.ts) blocks Car/Bike/Traffic/PoliceCar
            same as it always has here, but is invisible to the player's own
            collider, so it's still open on foot. This is the whole fix for
            "cars going inside the airport": the field is walk-in only, reach
            any parked aircraft by mounting it the same way as
            components/Plane.tsx always has — walk up + E. A car that drives
            up to this gate has nowhere to go but turn around. */}
        <CuboidCollider
          args={[0.15, FENCE_H / 2, (GATE_Z1 - GATE_Z0) / 2]}
          position={[FENCE_X, FENCE_H / 2, (GATE_Z0 + GATE_Z1) / 2]}
          collisionGroups={VEHICLE_ONLY}
        />
      </RigidBody>
    </group>
  );
}

function Gate() {
  const pillarH = FENCE_H + 2.6;
  return (
    <group position={[FENCE_X, 0, 0]}>
      {[GATE_Z0, GATE_Z1].map((z) => (
        <mesh key={z} castShadow position={[0, pillarH / 2, z]} material={GATE_PILLAR_MAT}>
          <boxGeometry args={[1.4, pillarH, 1.4]} />
        </mesh>
      ))}
      <mesh position={[0, pillarH + 0.1, 0]} material={GATE_SIGN_MAT}>
        <boxGeometry args={[1.0, 2.2, GATE_Z1 - GATE_Z0 + 1.4]} />
      </mesh>
      <Text
        position={[-0.6, pillarH + 0.1, 0]}
        rotation={[0, -Math.PI / 2, 0]}
        fontSize={1.5}
        color="#ff6a3a"
        anchorX="center"
        anchorY="middle"
      >
        AIRPORT SECURITY — AUTHORIZED VEHICLES ONLY
      </Text>
      {/* guard cabin + barrier arms */}
      <mesh position={[-6, 2.2, GATE_Z1 + 4]} material={TERM_WALL_MAT} castShadow>
        <boxGeometry args={[5, 4.4, 5]} />
      </mesh>
      <mesh position={[-6, 3.2, GATE_Z1 + 1.4]} material={TOWER_GLASS_MAT}>
        <boxGeometry args={[4.4, 2.0, 0.15]} />
      </mesh>
      {[GATE_Z0 + 6, GATE_Z1 - 6].map((z) => (
        <mesh key={z} position={[-2, 2.4, z]} rotation={[0, 0, 0]} material={RED_MAT}>
          <boxGeometry args={[0.25, 0.25, 11]} />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.7, pillarH / 2, 0.7]} position={[0, pillarH / 2, GATE_Z0]} />
        <CuboidCollider args={[0.7, pillarH / 2, 0.7]} position={[0, pillarH / 2, GATE_Z1]} />
        <CuboidCollider args={[2.5, 2.2, 2.5]} position={[-6, 2.2, GATE_Z1 + 4]} />
      </RigidBody>
    </group>
  );
}

// The three gate-guard vehicles that used to be rendered here as inert
// decoration (two PoliceCarMesh interceptors + one PoliceJeepMesh) are now
// real drivable vehicles instead — components/PoliceCar.tsx (kind=
// "policeCar2"/"policeCar3") and components/PoliceJeep.tsx, mounted as
// siblings in Game.tsx and parked at these exact same GATE_POST_X/GATE_CZ
// positions (see lib/vehicleState.ts). Nothing left to render here.

// Ground equipment at a gate stand — stairs, a baggage train, a fuel bowser,
// a pushback tractor. The airliner itself is NOT rendered here: it's a
// mountable vehicle (components/DrivableAirliner.tsx, positioned by
// lib/vehicleState.ts's airliner1/2/3, siblings of this in Game.tsx) so it
// parks, taxis, takes off and can be walked up to and flown from this exact
// spot without a second, un-flyable copy sitting on top of it. No ground
// crew posted here on purpose — see components/Airport.tsx's Airport()
// doc comment on why the field's human population is limited to the
// maintenance-bay repair team.
function ParkedStand({ x }: { x: number }) {
  return (
    <group position={[x, 0, GATE_Z]}>
      <group position={[7, 0, 18]} rotation={[0, -Math.PI / 2, 0]}>
        <WorkVehicleMesh kind="stairs" />
      </group>
      <group position={[-14, 0, 4]} rotation={[0, Math.PI / 2, 0]}>
        <WorkVehicleMesh kind="baggage" />
      </group>
      <group position={[16, 0, -6]} rotation={[0, -0.4, 0]}>
        <WorkVehicleMesh kind="fuel" />
      </group>
      <group position={[-8, 0, -22]} rotation={[0, 0.3, 0]}>
        <WorkVehicleMesh kind="pushback" />
      </group>
      {/* wheel chocks + cones around the stand */}
      {[
        [-20, 12],
        [20, 12],
        [-24, -14],
        [24, -14],
        [0, 30],
      ].map(([cx, cz]) => (
        <mesh key={`${cx}:${cz}`} position={[cx, 0.55, cz]} material={WINDSOCK_FABRIC_MAT}>
          <coneGeometry args={[0.5, 1.1, 8]} />
        </mesh>
      ))}
    </group>
  );
}

// Ground-vehicle service loops — apron-local circuits that keep traffic
// crossing between the terminal, the cargo yard and the hangars.
const VEHICLE_LOOPS: { kind: "tug" | "baggage" | "fuel" | "catering" | "pushback"; keys: Key[]; offset: number }[] = [
  {
    kind: "baggage",
    offset: 0,
    keys: [
      { t: 0, x: -120, y: 0, z: 100 },
      { t: 18, x: 60, y: 0, z: 100 },
      { t: 30, x: 120, y: 0, z: 60 },
      { t: 44, x: 120, y: 0, z: -40 },
      { t: 58, x: -40, y: 0, z: -60 },
      { t: 74, x: -150, y: 0, z: -20 },
      { t: 88, x: -150, y: 0, z: 70 },
      { t: 100, x: -120, y: 0, z: 100 },
    ],
  },
  {
    kind: "fuel",
    offset: 12,
    keys: [
      { t: 0, x: -190, y: 0, z: -40 },
      { t: 16, x: -100, y: 0, z: -30 },
      { t: 30, x: -20, y: 0, z: 30 },
      { t: 46, x: 90, y: 0, z: 40 },
      { t: 62, x: 160, y: 0, z: -10 },
      { t: 78, x: 40, y: 0, z: -70 },
      { t: 94, x: -190, y: 0, z: -40 },
    ],
  },
  {
    kind: "catering",
    offset: 30,
    keys: [
      { t: 0, x: 150, y: 0, z: 110 },
      { t: 16, x: 40, y: 0, z: 100 },
      { t: 30, x: -60, y: 0, z: 95 },
      { t: 46, x: -170, y: 0, z: 60 },
      { t: 62, x: -60, y: 0, z: 20 },
      { t: 78, x: 90, y: 0, z: 20 },
      { t: 92, x: 150, y: 0, z: 110 },
    ],
  },
  {
    kind: "tug",
    offset: 7,
    keys: [
      { t: 0, x: 170, y: 0, z: 60 },
      { t: 14, x: 170, y: 0, z: -30 },
      { t: 26, x: 90, y: 0, z: -75 },
      { t: 40, x: -60, y: 0, z: -80 },
      { t: 54, x: -160, y: 0, z: -50 },
      { t: 68, x: -60, y: 0, z: -10 },
      { t: 82, x: 120, y: 0, z: 30 },
      { t: 96, x: 170, y: 0, z: 60 },
    ],
  },
  {
    kind: "pushback",
    offset: 22,
    keys: [
      { t: 0, x: -30, y: 0, z: 110 },
      { t: 18, x: -140, y: 0, z: 105 },
      { t: 34, x: -190, y: 0, z: 60 },
      { t: 50, x: -140, y: 0, z: 0 },
      { t: 66, x: 0, y: 0, z: 30 },
      { t: 84, x: -30, y: 0, z: 110 },
    ],
  },
];

// No ambient foot traffic on the field — no guard patrols, no terminal
// crowd, no ground crew at the stands (see ParkedStand's own doc comment).
// The only humans anywhere on this compound are the repair team in the
// maintenance hangar (components/AirportLife.tsx's BrokenJet), because
// that's a fixed working scene, not loose NPCs a car can plausibly run into
// mid-taxi.
export function Airport() {
  return (
    <group position={[AX, 0, AZ]}>
      {/* airfield grass bed under everything, so the compound doesn't read as
          city asphalt with markings painted on it */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow material={GRASS_MAT}>
        <planeGeometry args={[FENCE_X * 2, FENCE_Z * 2]} />
      </mesh>

      {/* runway + blast pads */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, RUNWAY_Z]} receiveShadow material={RUNWAY_MAT}>
        <planeGeometry args={[RUNWAY_LEN, RUNWAY_W]} />
      </mesh>
      {[RUNWAY_X0 - 15, RUNWAY_X1 + 15].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.018, RUNWAY_Z]} receiveShadow material={TAXI_MAT}>
          <planeGeometry args={[30, RUNWAY_W]} />
        </mesh>
      ))}
      {/* parallel taxiway + connectors */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, TAXI_Z]} receiveShadow material={TAXI_MAT}>
        <planeGeometry args={[RUNWAY_LEN, TAXI_W]} />
      </mesh>
      {CONNECTOR_XS.map((x) => (
        <mesh
          key={x}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[x, 0.02, (RUNWAY_Z + TAXI_Z) / 2]}
          receiveShadow
          material={TAXI_MAT}
        >
          <planeGeometry args={[TAXI_W, TAXI_Z - RUNWAY_Z]} />
        </mesh>
      ))}
      {/* apron */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, APRON_CZ]} receiveShadow material={APRON_MAT}>
        <planeGeometry args={[APRON_W, APRON_D]} />
      </mesh>
      {/* apron-to-taxiway link */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, -97]} receiveShadow material={TAXI_MAT}>
        <planeGeometry args={[APRON_W, 30]} />
      </mesh>
      {/* landside road from the gate to the terminal forecourt */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[110, 0.025, 0]} receiveShadow material={TAXI_MAT}>
        <planeGeometry args={[260, 22]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 195]} receiveShadow material={TAXI_MAT}>
        <planeGeometry args={[380, 26]} />
      </mesh>

      <RunwayMarkings />
      <RunwayLights />
      <ApproachLights />
      <TaxiwayMarkings />
      <Helipads />
      <Windsock x={-40} z={-200} />
      <Windsock x={150} z={-200} />
      <ControlTowerBeacon />

      {/* solid volumes — one collider per building, aircraft fuselages get a
          box each so a 58m jet isn't something you drive straight through */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[TW / 2, TH / 2, TD / 2]} position={[TX, TH / 2, TZ]} />
        <CuboidCollider args={[TOWER_R * 1.4, TOWER_H / 2, TOWER_R * 1.4]} position={[TOWER_X, TOWER_H / 2, TOWER_Z]} />
        {HANGARS.map(([hx, hz]) => (
          <CuboidCollider key={`${hx}:${hz}`} args={[HW / 2, HH / 2, HD / 2]} position={[hx, HH / 2, hz]} />
        ))}
        <CuboidCollider args={[35, 9, 17]} position={[CARGO_X, 9, CARGO_Z + 46]} />
        {GATE_XS.map((x) => (
          <CuboidCollider key={`gc${x}`} args={[3.2, 4, 29]} position={[x, 4, GATE_Z]} />
        ))}
        {[0, 1, 2].map((i) => (
          <CuboidCollider key={`ft${i}`} args={[10, 7, 10]} position={[-205, 7, -60 + i * 30]} />
        ))}
      </RigidBody>

      <Terminal />
      {GATE_XS.map((x) => (
        <JetBridge key={x} x={x} />
      ))}
      <ControlTower />
      {HANGARS.map(([hx, hz], i) => (
        <Hangar key={`${hx}:${hz}`} x={hx} z={hz} open={i === 1} />
      ))}
      <CargoYard />
      <FuelFarm />

      {[-200, -70, 60, 190].map((x) => (
        <FloodMast key={x} x={x} z={122} />
      ))}
      {[-120, 40].map((x) => (
        <FloodMast key={`s${x}`} x={x} z={-88} />
      ))}

      {/* ground equipment at the terminal stands — the jets themselves are
          <DrivableAirliner> siblings in Game.tsx, parked at these exact
          world coordinates via lib/vehicleState.ts */}
      {GATE_XS.map((x) => (
        <ParkedStand key={x} x={x} />
      ))}

      {/* cargo-apron ground equipment — the freighter itself is a
          <DrivableAirliner id="airlinerCargo"> sibling in Game.tsx */}
      <group position={[CARGO_X + 30, 0, CARGO_Z - 96]} rotation={[0, 0.6, 0]}>
        <WorkVehicleMesh kind="catering" />
      </group>

      {/* aircraft flying the full circuit + freighters taxiing the field */}
      {CIRCUIT_GATE_XS.map((x, i) => (
        <MovingAirliner key={x} keys={circuitKeys(x)} offset={i * 118} liveryColor={LIVERIES[(i + 3) % LIVERIES.length]} />
      ))}
      <MovingAirliner keys={taxiKeys(-40, -50, 150, -50)} offset={40} liveryColor="#0d7fa8" cargo />
      <MovingAirliner keys={taxiKeys(120, 95, -110, 30)} offset={95} liveryColor="#e0a51c" />

      {/* the one aircraft that never flies: half-wrecked, wing off, crew all
          over it — in the open maintenance hangar's bay */}
      <BrokenJet x={150} z={-30} />

      {/* parked helicopters (the northernmost pad is the player's, kept clear
          for components/Helicopter.tsx — see lib/vehicleState.ts) */}
      <ParkedHeli x={HELIPAD_X} z={HELIPAD_ZS[1]} h={0.4} />
      <ParkedHeli x={HELIPAD_X} z={HELIPAD_ZS[2]} h={-1.1} />
      <ParkedHeli x={HELIPAD_X} z={HELIPAD_ZS[3]} h={2.2} />

      {VEHICLE_LOOPS.map((v, i) => (
        <WorkVehicle key={i} kind={v.kind} keys={v.keys} offset={v.offset} />
      ))}

      <PerimeterFence />
      <Gate />
    </group>
  );
}
