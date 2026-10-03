"use client";

import { useRef, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepFlight, POLICE_JET_HANDLING, type FlightState } from "@/lib/flightPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { roofHeightAt } from "@/lib/buildings";

// Stealth-fighter-styled police interceptor, parked on the same apron as
// Plane.tsx (offset clear of it — see lib/vehicleState.ts). Same mount-by-E,
// kinematic-position rig as Plane.tsx/Helicopter.tsx, just with
// POLICE_JET_HANDLING (fastest, most agile flyer in the game) and a flashing
// light bar — same "driving it IS the siren" convention as PoliceCar.tsx,
// no separate toggle key.
export function PoliceJet() {
  const bodyRef = useRef<RapierRigidBody>(null);
  const keys = useKeyboard();
  const { camera } = useThree();
  const lightRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  const [save] = useState(() => loadSave()?.vehicles.policeJet ?? null);
  const fs = useRef<FlightState>({ h: save?.h ?? vehicleState.policeJet.h, pitch: 0, roll: 0, speed: 0, vy: 0 });
  const nitro = useRef(initNitroFuel());
  const pos = useRef({
    x: save?.x ?? vehicleState.policeJet.x,
    z: save?.z ?? vehicleState.policeJet.z,
    y: POLICE_JET_HANDLING.groundClearance,
  });
  const camPos = useRef(
    new THREE.Vector3((save?.x ?? vehicleState.policeJet.x) - 12, POLICE_JET_HANDLING.groundClearance + 6, (save?.z ?? vehicleState.policeJet.z) - 12)
  );
  const camLook = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === "policeJet";

    const k = keys.current;
    const yaw = isActive ? (k.right ? 1 : 0) - (k.left ? 1 : 0) : 0;
    // see Plane.tsx's identical comment: only respect a roof as the floor
    // once already close to it
    const roof = roofHeightAt(pos.current.x, pos.current.z);
    const groundY = pos.current.y >= roof - 5 ? roof : 0;
    // nitro: SHIFT+forward, same rig as Plane.tsx (lib/nitro.ts)
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? { ...POLICE_JET_HANDLING, accel: POLICE_JET_HANDLING.accel * NITRO_ACCEL_MULT, maxSpeed: POLICE_JET_HANDLING.maxSpeed + NITRO_BOOST }
      : POLICE_JET_HANDLING;
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

    vehicleState.policeJet.x = pos.current.x;
    vehicleState.policeJet.z = pos.current.z;
    vehicleState.policeJet.h = fs.current.h;
    vehicleState.policeJet.y = pos.current.y;

    // light bar always flashes, active or parked — same read as PoliceCar.tsx
    const flashRed = Math.floor(state.clock.elapsedTime * 5) % 2 === 0;
    if (lightRefs.current[0]) lightRefs.current[0].color.set(flashRed ? "#ff2020" : "#160000");
    if (lightRefs.current[1]) lightRefs.current[1].color.set(flashRed ? "#0a1030" : "#2040ff");

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
    });

    const grounded = pos.current.y <= groundY + POLICE_JET_HANDLING.groundClearance + 0.02;
    useHudStore.getState().setHud(Math.round(Math.abs(fs.current.speed) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[vehicleState.policeJet.x, POLICE_JET_HANDLING.groundClearance, vehicleState.policeJet.z]}
    >
      <PoliceJetMesh lightRefs={lightRefs} />
    </RigidBody>
  );
}

const SKIN_MAT = new THREE.MeshStandardMaterial({ color: "#14161b", metalness: 0.35, roughness: 0.55 }); // matte, radar-absorbent read
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#2a2d34", metalness: 0.7, roughness: 0.35 });
const ACCENT_MAT = new THREE.MeshStandardMaterial({ color: "#d4a72c", metalness: 0.5, roughness: 0.4 }); // "SKY" callsign gold trim
const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: "#0d1420",
  metalness: 0.9,
  roughness: 0.08,
  transparent: true,
  opacity: 0.65,
});
const TIRE_MAT = new THREE.MeshStandardMaterial({ color: "#101216", roughness: 0.92 });
const NOZZLE_MAT = new THREE.MeshStandardMaterial({ color: "#3a3d44", metalness: 0.8, roughness: 0.3 });

function PoliceJetMesh({ lightRefs }: { lightRefs: React.RefObject<(THREE.MeshBasicMaterial | null)[]> }) {
  // radialSegments=4 (not the usual 16-20) is what gives the faceted,
  // flat-panelled F-117-style hull instead of a smooth round fuselage —
  // same CylinderGeometry+rotateX fuselage idiom as Plane.tsx, just angular.
  const fusGeo = useMemo(() => new THREE.CylinderGeometry(0.55, 0.42, 5.0, 4).rotateX(Math.PI / 2), []);
  return (
    <group>
      {/* faceted diamond-section fuselage */}
      <mesh position={[0, 0, 0]} geometry={fusGeo} material={SKIN_MAT} castShadow />
      <mesh position={[0, 0, 3.0]} rotation={[Math.PI / 2, 0, 0]} material={SKIN_MAT} castShadow>
        <coneGeometry args={[0.55, 1.7, 4]} />
      </mesh>
      {/* flat-cut tail + twin engine nozzles */}
      {[0.25, -0.25].map((x) => (
        <mesh key={x} position={[x, -0.05, -2.75]} rotation={[Math.PI / 2, 0, 0]} material={NOZZLE_MAT}>
          <cylinderGeometry args={[0.26, 0.32, 0.5, 8]} />
        </mesh>
      ))}

      {/* faceted cockpit canopy — flat angled panes, not a rounded bubble */}
      <mesh position={[0, 0.42, 1.3]} rotation={[0.3, 0, 0]} material={GLASS_MAT} castShadow>
        <boxGeometry args={[0.72, 0.4, 1.6]} />
      </mesh>

      {/* sharply swept delta wings */}
      {[1, -1].map((s) => (
        <group key={s} position={[s * 0.5, -0.1, -0.3]} rotation={[0, s * -0.55, 0]}>
          <mesh position={[s * 1.9, 0, 0]} material={SKIN_MAT} castShadow>
            <boxGeometry args={[3.4, 0.1, 1.9]} />
          </mesh>
          <mesh position={[s * 3.5, 0, 0.55]} rotation={[0, s * 0.3, 0]} material={TRIM_MAT} castShadow>
            <boxGeometry args={[1.3, 0.08, 0.7]} />
          </mesh>
        </group>
      ))}

      {/* canted twin tail fins — the F-117's signature outward-splayed V-tail */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.45, 0.55, -2.3]} rotation={[0, 0, s * 0.55]} material={SKIN_MAT} castShadow>
          <boxGeometry args={[0.08, 1.5, 1.1]} />
        </mesh>
      ))}

      {/* dorsal light bar — the flashing halves ARE this build's siren, same
          "driving it is the siren" convention as PoliceCar.tsx */}
      <mesh position={[0, 0.68, 0.4]}>
        <boxGeometry args={[0.46, 0.08, 0.22]} />
        <meshBasicMaterial ref={(el) => (lightRefs.current[0] = el)} color="#ff2020" />
      </mesh>
      <mesh position={[0, 0.68, 0.65]}>
        <boxGeometry args={[0.46, 0.08, 0.22]} />
        <meshBasicMaterial ref={(el) => (lightRefs.current[1] = el)} color="#2040ff" />
      </mesh>
      {/* gold "SKY" callsign trim stripe */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.56, 0, 0]} material={ACCENT_MAT}>
          <boxGeometry args={[0.03, 0.12, 3.6]} />
        </mesh>
      ))}

      {/* tricycle gear: nose + two main, tyre + strut each */}
      <Gear x={0} z={1.9} attachY={-0.3} />
      <Gear x={0.55} z={-0.8} attachY={-0.4} />
      <Gear x={-0.55} z={-0.8} attachY={-0.4} />
    </group>
  );
}

const TIRE_R = 0.2;

function Gear({ x, z, attachY }: { x: number; z: number; attachY: number }) {
  const tireY = -POLICE_JET_HANDLING.groundClearance + TIRE_R;
  const strutLen = Math.max(0.06, attachY - tireY);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, (attachY + tireY) / 2, 0]} material={TRIM_MAT}>
        <cylinderGeometry args={[0.03, 0.03, strutLen, 6]} />
      </mesh>
      <mesh position={[0, tireY, 0]} rotation={[Math.PI / 2, 0, 0]} material={TIRE_MAT} castShadow>
        <cylinderGeometry args={[TIRE_R, TIRE_R, 0.13, 14]} />
      </mesh>
    </group>
  );
}
