"use client";

import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepFlight, HELI_HANDLING, type FlightState } from "@/lib/flightPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { roofHeightAt } from "@/lib/buildings";
import { groundYAt } from "@/lib/marina";
import { HeliCockpit } from "@/components/HeliCockpit";

// Parked on REGIONAL AIRPORT's helipad (components/Airport.tsx), mounted by
// walking up + E — near-identical rig to Plane.tsx, sharing lib/flightPhysics.ts
// with HELI_HANDLING instead of PLANE_HANDLING (liftMinSpeed 0, so unlike the
// plane this one holds altitude with zero forward speed — true hover). Same
// control scheme as the plane: W/S throttle, A/D yaw, SPACE climb, SHIFT descend.
//
// Parameterized over `kind`/`bodyMat` (same shape as components/PoliceCar.tsx's
// own `kind` prop and components/Boat.tsx's `kind`/`spawn`) so FORT NEON's
// second helipad — the one lib/militaryBase.ts always defined but nothing ever
// filled — gets a real drivable olive-drab chopper out of this same rig
// instead of a second copy of the file.
export function Helicopter({
  kind = "helicopter",
  bodyMat,
}: { kind?: VehicleKind; bodyMat?: THREE.Material } = {}) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const rotorRef = useRef<THREE.Group>(null);
  const tailRotorRef = useRef<THREE.Group>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const [save] = useState(() => loadSave()?.vehicles[kind] ?? null);
  const fs = useRef<FlightState>({ h: save?.h ?? vehicleState[kind].h, pitch: 0, roll: 0, speed: 0, vy: 0 });
  const nitro = useRef(initNitroFuel());
  // spawn height is measured off the real ground under the pad, not sea level
  // — FORT NEON's helipads sit on its own elevated platform (lib/marina.ts's
  // groundYAt resolves the bridge deck and the base platform; a bare
  // groundClearance would bury this chopper ~9 units under the pad).
  const spawnX = save?.x ?? vehicleState[kind].x;
  const spawnZ = save?.z ?? vehicleState[kind].z;
  const spawnY = groundYAt(spawnX, spawnZ) + HELI_HANDLING.groundClearance;
  const pos = useRef({ x: spawnX, z: spawnZ, y: spawnY });
  const camPos = useRef(new THREE.Vector3(spawnX - 8, spawnY + 5, spawnZ - 8));
  const camLook = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === kind;

    const k = keys.current;
    const yaw = isActive ? (k.right ? 1 : 0) - (k.left ? 1 : 0) : 0;
    // see Plane.tsx's identical comment: only respect a roof as the floor
    // once already close to it, so drifting under a building at low altitude
    // doesn't snap the heli straight up onto its roof.
    // The non-roof floor is groundYAt, not a flat 0 — over FORT NEON's
    // platform or I-94's deck the real ground is well above sea level, and a
    // hardcoded 0 would let the chopper descend straight through it.
    const roof = roofHeightAt(pos.current.x, pos.current.z);
    const groundY = pos.current.y >= roof - 5 ? roof : groundYAt(pos.current.x, pos.current.z);
    // nitro: SHIFT+forward, same rig as Plane.tsx (lib/nitro.ts) — SHIFT also
    // means "descend" here, same double-duty tradeoff.
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? { ...HELI_HANDLING, accel: HELI_HANDLING.accel * NITRO_ACCEL_MULT, maxSpeed: HELI_HANDLING.maxSpeed + NITRO_BOOST }
      : HELI_HANDLING;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz, y } = stepFlight(
      fs.current,
      { forward: isActive && k.forward, back: isActive && k.back, yaw, climb: isActive && k.handbrake, descend: isActive && k.boost },
      handling,
      d,
      pos.current.y,
      groundY
    );
    pos.current.x += dx;
    pos.current.z += dz;
    pos.current.y = y;

    body.setNextKinematicTranslation({ x: pos.current.x, y: pos.current.y, z: pos.current.z });
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), fs.current.h)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fs.current.pitch))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), fs.current.roll));
    body.setNextKinematicRotation(q);

    // main + tail rotor spin — always turning while airborne or active, idle
    // slower on the ground (engine-running look), cosmetic only
    const spinning = isActive || pos.current.y > groundY + HELI_HANDLING.groundClearance + 0.05;
    const rotorSpeed = spinning ? 14 : 0;
    if (rotorRef.current) rotorRef.current.rotation.y += rotorSpeed * d;
    if (tailRotorRef.current) tailRotorRef.current.rotation.x += rotorSpeed * 1.6 * d;

    vehicleState[kind].x = pos.current.x;
    vehicleState[kind].z = pos.current.z;
    vehicleState[kind].h = fs.current.h;
    vehicleState[kind].y = pos.current.y;

    if (!isActive) return;
    worldState.px = pos.current.x;
    worldState.pz = pos.current.z;
    worldState.heading = fs.current.h;

    applyCameraRig({
      camera,
      camPos: camPos.current,
      camLook: camLook.current,
      tx: pos.current.x,
      ty: pos.current.y,
      tz: pos.current.z,
      th: fs.current.h,
      isBike: false,
      camMode: useHudStore.getState().camMode,
      time: state.clock.elapsedTime,
      dt: d,
      speedMs: Math.abs(fs.current.speed),
      // heli has no driver's-side offset like a car — cockpitForward is a
      // LOCAL X offset (see lib/cameraRig.ts's camMode===1 branch), 0 keeps
      // the eye centered under HeliCockpit.tsx's own centered instrument
      // panel/cyclic layout instead of the sedan-tuned -0.35 default.
      // The glass canopy bubble itself (components/Helicopter.tsx's HeliMesh,
      // the actual cabin the pilot sits in) is a sphere at local y=0.22,
      // z=0.75, scale [1,0.75,1.15], radius 0.62 — i.e. y spans roughly
      // [-0.25, 0.69], z spans [0.04, 1.46]. 0.32/0.3 put the eye down inside
      // the SOLID LOWER HULL sphere below it (y=-0.15, half-height 0.64), so
      // the "cockpit" view was actually the inside of the painted fuselage
      // shell, not the glass bubble — hence the big flat dome filling frame.
      // Panel sits at z=0.5/y=0.06 inside the bubble; eye now sits properly
      // inside the glass, above and a bit behind the panel.
      // eye pulled back near the cyclic base (z=0.12) instead of almost on
      // top of the panel (z=0.5) — 0.35 left only ~0.12m to the panel's
      // front face, inside spitting distance of the camera's near=0.1 clip
      // plane. 0.05 gives a real, readable eye-to-panel gap.
      // seated pilot eye: well above and behind the cyclic's grip (base at
      // y=-0.5/z=0.12, ~0.56 tall, so grip sits near y=0.06) so the stick
      // reads as a foreground control in the lower frame instead of filling
      // it — a real pilot looks OVER the cyclic at the panel, doesn't stare
      // straight into it from arm's length.
      cockpitEyeHeight: 0.5,
      cockpitForward: 0,
      cockpitAhead: -0.02,
      // shared cameraRig default looks 30 units ahead — miles past this tiny
      // cabin, producing an almost-level glance that skips straight over a
      // panel this close/low. Look AT the panel instead: a near target + a
      // real downward drop.
      cockpitLookAhead: 0.55,
      cockpitLookDrop: 0.42,
    });

    const grounded = pos.current.y <= groundY + HELI_HANDLING.groundClearance + 0.02;
    useHudStore.getState().setHud(Math.round(Math.abs(fs.current.speed) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[spawnX, spawnY, spawnZ]}
    >
      <HeliMesh rotorRef={rotorRef} tailRotorRef={tailRotorRef} bodyMat={bodyMat} />
      <HeliCockpit kind={kind} fs={fs} pos={pos} />
    </RigidBody>
  );
}

const BODY_MAT = new THREE.MeshStandardMaterial({ color: "#c7451f", metalness: 0.45, roughness: 0.32 });
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#1e2126", metalness: 0.75, roughness: 0.32 });
const CHROME_MAT = new THREE.MeshStandardMaterial({ color: "#c2c7d0", metalness: 0.95, roughness: 0.2 });
// glass cockpit bubble — same idiom as SupercarBody.tsx's GLASS
const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: "#16212e",
  metalness: 0.9,
  roughness: 0.05,
  transparent: true,
  opacity: 0.55,
});
const BLADE_MAT = new THREE.MeshStandardMaterial({ color: "#26292e", metalness: 0.6, roughness: 0.35 });
const SKID_MAT = new THREE.MeshStandardMaterial({ color: "#101216", roughness: 0.7, metalness: 0.2 });

export function HeliMesh({
  rotorRef,
  tailRotorRef,
  bodyMat = BODY_MAT,
}: {
  rotorRef: React.RefObject<THREE.Group | null>;
  tailRotorRef: React.RefObject<THREE.Group | null>;
  // olive-drab override for FORT NEON's parked choppers (components/
  // MilitaryBase.tsx) — every other caller keeps the civilian orange-red default
  bodyMat?: THREE.Material;
}) {
  return (
    <group>
      {/* cabin: lower painted shell + upper glass bubble */}
      <mesh position={[0, -0.15, 0.3]} scale={[1.15, 0.85, 1.7]} material={bodyMat} castShadow>
        <sphereGeometry args={[0.75, 14, 12]} />
      </mesh>
      <mesh position={[0, 0.22, 0.75]} scale={[1.0, 0.75, 1.15]} material={GLASS_MAT} castShadow>
        <sphereGeometry args={[0.62, 14, 12]} />
      </mesh>

      {/* tail boom + fin */}
      <mesh position={[0, 0.1, -1.9]} rotation={[Math.PI / 2, 0, 0]} material={TRIM_MAT} castShadow>
        <cylinderGeometry args={[0.16, 0.08, 3.0, 12]} />
      </mesh>
      <mesh position={[0, 0.42, -3.35]} material={bodyMat} castShadow>
        <boxGeometry args={[0.06, 0.55, 0.5]} />
      </mesh>

      {/* tail rotor */}
      <group ref={tailRotorRef} position={[0.12, 0.42, -3.4]}>
        {[0, Math.PI / 2].map((a) => (
          <mesh key={a} rotation={[a, 0, 0]} material={BLADE_MAT}>
            <boxGeometry args={[0.03, 0.55, 0.08]} />
          </mesh>
        ))}
      </group>

      {/* main rotor mast + 2 long blades */}
      <mesh position={[0, 0.85, 0]} material={CHROME_MAT} castShadow>
        <cylinderGeometry args={[0.05, 0.06, 0.5, 10]} />
      </mesh>
      <group ref={rotorRef} position={[0, 1.12, 0]}>
        <mesh material={CHROME_MAT}>
          <cylinderGeometry args={[0.09, 0.09, 0.12, 10]} />
        </mesh>
        {[0, Math.PI / 2].map((a) => (
          <mesh key={a} rotation={[0, a, 0]} material={BLADE_MAT}>
            <boxGeometry args={[4.6, 0.05, 0.16]} />
          </mesh>
        ))}
      </group>

      {/* skids: two parallel bars + struts */}
      {[1, -1].map((s) => (
        <group key={s}>
          <mesh position={[s * 0.6, -0.78, 0.2]} rotation={[Math.PI / 2, 0, 0]} material={SKID_MAT} castShadow>
            <cylinderGeometry args={[0.05, 0.05, 2.4, 8]} />
          </mesh>
          {[0.7, -0.5].map((z) => (
            <mesh key={z} position={[s * 0.6, -0.45, z]} material={TRIM_MAT}>
              <boxGeometry args={[0.05, 0.5, 0.05]} />
            </mesh>
          ))}
        </group>
      ))}

      {/* nav lights: red/green, port/starboard */}
      <mesh position={[-0.85, -0.1, 0.1]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshBasicMaterial color="#ff2020" />
      </mesh>
      <mesh position={[0.85, -0.1, 0.1]}>
        <sphereGeometry args={[0.05, 6, 6]} />
        <meshBasicMaterial color="#20ff60" />
      </mesh>
    </group>
  );
}
