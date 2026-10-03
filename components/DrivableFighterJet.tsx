"use client";

import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepFlight, FIGHTER_JET_HANDLING, type FlightState } from "@/lib/flightPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore, type FighterJetId } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { roofHeightAt } from "@/lib/buildings";
import { groundYAt } from "@/lib/marina";
import { FighterJetMesh } from "@/components/FighterJet";
import { JET_SCALE } from "@/lib/militaryBase";

// FORT NEON's apron fighters, made real. They used to be pure decoration —
// components/MilitaryBase.tsx rendered three FighterJetMesh at JET_SCALE and
// that was it — which made them the one parked airframe on the map you
// couldn't fly, against components/Plane.tsx / Helicopter.tsx /
// DrivableAirliner.tsx / PoliceJet.tsx all being walk-up-and-E mountable.
//
// Same rig as Plane.tsx (kinematic body, direct position integration, no
// character controller), parameterized over `id` exactly the way
// DrivableAirliner.tsx is parameterized over AirlinerId, so one component
// covers all three apron slots.
//
// Two things here are NOT copied from Plane.tsx, both because this airframe
// lives on FORT NEON's elevated platform rather than on city ground:
//   1. the ground floor is groundYAt(), not a hardcoded 0 — see below;
//   2. the spawn height is measured off that same ground.
export function DrivableFighterJet({ id }: { id: FighterJetId }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const base = vehicleState[id];
  const [save] = useState(() => loadSave()?.vehicles[id] ?? null);
  const fs = useRef<FlightState>({ h: save?.h ?? base.h, pitch: 0, roll: 0, speed: 0, vy: 0 });
  const nitro = useRef(initNitroFuel());

  const spawnX = save?.x ?? base.x;
  const spawnZ = save?.z ?? base.z;
  const spawnY = groundYAt(spawnX, spawnZ) + FIGHTER_JET_HANDLING.groundClearance;
  const pos = useRef({ x: spawnX, z: spawnZ, y: spawnY });
  const camPos = useRef(new THREE.Vector3(spawnX - 16, spawnY + 8, spawnZ - 16));
  const camLook = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === id;

    const k = keys.current;
    const yaw = isActive ? (k.right ? 1 : 0) - (k.left ? 1 : 0) : 0;
    // see Plane.tsx's identical comment: only respect a roof as the floor once
    // already close to it. The non-roof floor is groundYAt rather than a flat
    // 0 because this jet spawns on FORT NEON's platform — sea level is ~9
    // units below the apron it's parked on, so a hardcoded 0 would drop it
    // through the deck the moment it was mounted.
    const roof = roofHeightAt(pos.current.x, pos.current.z);
    const groundY = pos.current.y >= roof - 5 ? roof : groundYAt(pos.current.x, pos.current.z);

    // nitro: SHIFT+forward, same rig as every other vehicle (lib/nitro.ts) —
    // SHIFT already doubles as "descend" here, same tradeoff as Plane.tsx.
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? {
          ...FIGHTER_JET_HANDLING,
          accel: FIGHTER_JET_HANDLING.accel * NITRO_ACCEL_MULT,
          maxSpeed: FIGHTER_JET_HANDLING.maxSpeed + NITRO_BOOST,
        }
      : FIGHTER_JET_HANDLING;
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

    vehicleState[id].x = pos.current.x;
    vehicleState[id].z = pos.current.z;
    vehicleState[id].h = fs.current.h;
    vehicleState[id].y = pos.current.y;

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
      // the mesh is ~9 units nose-to-tail before JET_SCALE, so ~21 after —
      // the shared car-sized chase default would sit inside the fuselage.
      // Same reasoning as DrivableAirliner.tsx's own chaseDist=48.
      chaseDist: 26,
      chaseHeight: 10,
    });

    const grounded = pos.current.y <= groundY + FIGHTER_JET_HANDLING.groundClearance + 0.02;
    useHudStore.getState().setHud(Math.round(Math.abs(fs.current.speed) * 3.6), grounded);
  });

  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[spawnX, spawnY, spawnZ]}>
      <group scale={JET_SCALE}>
        <FighterJetMesh />
      </group>
    </RigidBody>
  );
}
