"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepCarPhysics, JEEP_HANDLING, type CarState } from "@/lib/carPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { fellOutOfWorld } from "@/lib/fallGuard";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { teleportRequest } from "@/lib/clubTeleport";
import { checkCrashDebris } from "@/lib/debris";
import { consumePedestrianHitSlowdown } from "@/lib/pedestrianHit";
import { clampFromWater, groundYAt } from "@/lib/marina";
import { POLICE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import { PoliceJeepMesh } from "@/components/ParkedPoliceJeep";
import { QueryFilterFlags, type KinematicCharacterController } from "@dimforge/rapier3d-compat";

const GRAVITY_PULL = -12;
// PoliceJeepMesh's own root sits AT ground level already (its wheels bottom
// out at local y=0 — see ParkedPoliceJeep.tsx's <group position={[0,0.42,0]}>
// wrapping wheels at y=-0.42), unlike SupercarBody's RIDE_HEIGHT=0.98. No
// drop needed here.
const RIDE_HEIGHT = 0;

// The airport's gate-guard jeep (components/Airport.tsx's GateGuardPost),
// made a real drivable rig instead of the inert decoration it used to be —
// near-copy of PoliceCar.tsx (character controller/gravity/camera/crash
// debris boilerplate), swapping in JEEP_HANDLING (a security 4x4, not a
// pursuit interceptor) and PoliceJeepMesh for the body.
export function PoliceJeep() {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const [save] = useState(() => loadSave()?.vehicles.policeJeep ?? null);
  const car = useRef<CarState>({ h: save?.h ?? vehicleState.policeJeep.h, speed: 0, vLat: 0, steerAng: 0 });
  const nitro = useRef(initNitroFuel());
  const fallSpeed = useRef(0);
  const crashCooldown = useRef(0);
  const camPos = useRef(new THREE.Vector3(0, 4, -10));
  const camLook = useRef(new THREE.Vector3());
  const controllerRef = useRef<KinematicCharacterController | null>(null);
  const lightRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([]);

  useEffect(() => {
    const controller = world.createCharacterController(0.02);
    controller.enableAutostep(0.3, 0.1, true);
    controller.enableSnapToGround(0.4);
    controller.setSlideEnabled(true);
    controller.setMaxSlopeClimbAngle((60 * Math.PI) / 180);
    controllerRef.current = controller;
    return () => {
      world.removeCharacterController(controller);
      controllerRef.current = null;
    };
  }, [world]);

  const carBox = useMemo(() => new THREE.Vector3(1.95, 1.4, 4.4), []);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    const controller = controllerRef.current;
    const collider = colliderRef.current;
    if (!body || !controller || !collider) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === "policeJeep";

    if (isActive && teleportRequest.pending) {
      teleportRequest.pending = false;
      body.setTranslation({ x: teleportRequest.x, y: RIDE_HEIGHT, z: teleportRequest.z }, true);
      car.current.h = teleportRequest.h;
      car.current.speed = 0;
      car.current.vLat = 0;
      worldState.px = teleportRequest.x;
      worldState.pz = teleportRequest.z;
      worldState.heading = teleportRequest.h;
      return;
    }

    const k = keys.current;
    const steer = isActive ? (k.left ? 1 : 0) - (k.right ? 1 : 0) : 0;
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? { ...JEEP_HANDLING, accel: JEEP_HANDLING.accel * NITRO_ACCEL_MULT, max: JEEP_HANDLING.max + NITRO_BOOST }
      : JEEP_HANDLING;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz } = stepCarPhysics(
      car.current,
      { forward: isActive && k.forward, back: isActive && k.back, steer, handbrake: isActive && k.handbrake },
      handling,
      d
    );

    fallSpeed.current += GRAVITY_PULL * d;
    // filterGroups=POLICE_SWEEP_GROUPS — this call had no 4th argument at all,
    // so like PoliceCar.tsx before its own fix, a parked jeep's zero-input
    // sweep treated an on-foot player who walked into it (this is the airport
    // gate guard's post, right where players walk through) as an obstacle and
    // depenetrated against them every frame — the visible unprompted jerk.
    // See lib/collisionGroups.ts.
    controller.computeColliderMovement(collider, { x: dx, y: fallSpeed.current * d, z: dz }, QueryFilterFlags.EXCLUDE_DYNAMIC, POLICE_SWEEP_GROUPS);
    const grounded = controller.computedGrounded();
    if (grounded) fallSpeed.current = 0;
    const movement = controller.computedMovement();

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
    // hard backstop, independent of the WATER_BOUNDARY collider — see Car.tsx/lib/marina.ts
    clampFromWater(nextPos);

    if (fellOutOfWorld(nextPos.y, nextPos.x)) {
      body.setTranslation({ x: nextPos.x, y: RIDE_HEIGHT, z: nextPos.z }, true);
      fallSpeed.current = 0;
      car.current.speed = 0;
      return;
    }

    body.setNextKinematicTranslation(nextPos);
    body.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.current.h));

    if (isActive) {
      checkCrashDebris(crashCooldown, d, { x: dx, z: dz }, { x: movement.x, z: movement.z }, Math.abs(car.current.speed), nextPos, car.current.h);
      const hitSlow = consumePedestrianHitSlowdown();
      if (hitSlow !== null) car.current.speed *= hitSlow;
    }

    vehicleState.policeJeep.x = nextPos.x;
    vehicleState.policeJeep.y = nextPos.y;
    vehicleState.policeJeep.z = nextPos.z;
    vehicleState.policeJeep.h = car.current.h;
    vehicleState.policeJeep.speed = car.current.speed;
    vehicleState.policeJeep.vLat = car.current.vLat;

    // light bar always flashes, active or parked — same call as PoliceCar.tsx
    const flashRed = Math.floor(state.clock.elapsedTime * 5) % 2 === 0;
    if (lightRefs.current[0]) lightRefs.current[0].color.set(flashRed ? "#ff2020" : "#160000");
    if (lightRefs.current[1]) lightRefs.current[1].color.set(flashRed ? "#0a1030" : "#2040ff");

    if (!isActive) return;
    worldState.px = nextPos.x;
    worldState.pz = nextPos.z;
    worldState.heading = car.current.h;

    applyCameraRig({
      camera,
      camPos: camPos.current,
      camLook: camLook.current,
      tx: nextPos.x,
      ty: nextPos.y,
      tz: nextPos.z,
      th: car.current.h,
      isBike: false,
      camMode: useHudStore.getState().camMode,
      time: state.clock.elapsedTime,
      dt: d,
      speedMs: Math.abs(car.current.speed),
      cockpitEyeHeight: 1.5,
      cockpitForward: -0.3,
      chaseDist: 10.5,
      chaseHeight: 4.6,
    });

    // true ground speed including lateral slide — see Car.tsx's same fix
    useHudStore.getState().setHud(Math.round(Math.hypot(car.current.speed, car.current.vLat) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[
        save?.x ?? vehicleState.policeJeep.x,
        groundYAt(save?.x ?? vehicleState.policeJeep.x, save?.z ?? vehicleState.policeJeep.z) + RIDE_HEIGHT,
        save?.z ?? vehicleState.policeJeep.z,
      ]}
    >
      <CuboidCollider ref={colliderRef} args={[carBox.x / 2, carBox.y / 2, carBox.z / 2]} position={[0, carBox.y / 2, 0]} />
      <PoliceJeepMesh lightRefs={lightRefs} />
    </RigidBody>
  );
}
