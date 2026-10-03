"use client";

import { useRef, useEffect, useMemo, useState, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepCarPhysics, POLICE_HANDLING, type CarState } from "@/lib/carPhysics";
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
import { SupercarBody, RIDE_HEIGHT, type Detail } from "@/components/SupercarBody";
import { clampFromWater, groundYAt } from "@/lib/marina";
import { POLICE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import { QueryFilterFlags, type KinematicCharacterController } from "@dimforge/rapier3d-compat";
import type { VehicleKind } from "@/lib/hudStore";

const GRAVITY_PULL = -12;

// Parked at POLICE HARBOR STATION — a near-copy of Car.tsx (same
// character-controller/gravity/camera boilerplate Bike.tsx already
// duplicates; a fourth+fifth land vehicle is exactly the point where
// SUMMARY.md/Milestone 4 said to pull this into a shared hook instead of
// copying a third time). What's genuinely new here: POLICE_HANDLING (83.3
// m/s top speed) and a flashing red/blue light bar that also *is* this
// build's "siren" — driving this car is what lets Traffic.tsx's convoy
// cars recruit (see Traffic.tsx), matching the original's
// `player.veh.userData.siren.kind==='police'` implicit-siren design (no
// separate siren toggle key, same as the original).
//
// Parameterized over `kind` (default "policeCar") so the two gate-guard
// interceptors parked at the airport (lib/vehicleState.ts's policeCar2/
// policeCar3 — they used to be inert decoration, components/Airport.tsx's
// GateGuardPost) can reuse this exact rig instead of a third copy.
export function PoliceCar({ kind = "policeCar" }: { kind?: VehicleKind } = {}) {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const [save] = useState(() => loadSave()?.vehicles[kind] ?? null);
  const car = useRef<CarState>({ h: save?.h ?? vehicleState[kind].h, speed: 0, vLat: 0, steerAng: 0 });
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

  const carBox = useMemo(() => new THREE.Vector3(1.9, 1.35, 4.8), []);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    const controller = controllerRef.current;
    const collider = colliderRef.current;
    if (!body || !controller || !collider) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === kind;

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
      ? { ...POLICE_HANDLING, accel: POLICE_HANDLING.accel * NITRO_ACCEL_MULT, max: POLICE_HANDLING.max + NITRO_BOOST }
      : POLICE_HANDLING;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz } = stepCarPhysics(
      car.current,
      { forward: isActive && k.forward, back: isActive && k.back, steer, handbrake: isActive && k.handbrake },
      handling,
      d
    );

    fallSpeed.current += GRAVITY_PULL * d;
    // see Car.tsx: EXCLUDE_DYNAMIC lets the cruiser plow through props instead
    // of sliding/stopping on them, while the solver still shoves the prop aside.
    // filterGroups=POLICE_SWEEP_GROUPS on the sweep itself (this call had no
    // 4th argument at all, so it collided with everything): without it a parked
    // cruiser's own zero-input sweep treated an on-foot player who walked into
    // it as an obstacle and depenetrated against them every frame — the visible
    // unprompted jerk/push. POLICE_SWEEP_GROUPS, not Car.tsx/Bike.tsx's
    // VEHICLE_SWEEP_GROUPS: same on-foot-player exclusion, but it keeps the
    // membership bit that leaves the cruiser blocked by VEHICLE_ONLY gates and
    // curbs, which is the behaviour it has always had. See lib/collisionGroups.ts.
    controller.computeColliderMovement(collider, { x: dx, y: fallSpeed.current * d, z: dz }, QueryFilterFlags.EXCLUDE_DYNAMIC, POLICE_SWEEP_GROUPS);
    const grounded = controller.computedGrounded();
    if (grounded) fallSpeed.current = 0;
    const movement = controller.computedMovement();

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
    // hard backstop, independent of the WATER_BOUNDARY collider — see Car.tsx/lib/marina.ts
    clampFromWater(nextPos);

    // Out-of-world recovery: if the ground was not streamed in yet and the body
    // stepped through the gap, put it back on the surface here rather than let
    // gravity integrate it to -65,000. See lib/fallGuard.ts.
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
      // see components/Car.tsx's identical block + lib/pedestrianHit.ts
      const hitSlow = consumePedestrianHitSlowdown();
      if (hitSlow !== null) car.current.speed *= hitSlow;
    }

    vehicleState[kind].x = nextPos.x;
    vehicleState[kind].y = nextPos.y;
    vehicleState[kind].z = nextPos.z;
    vehicleState[kind].h = car.current.h;
    vehicleState[kind].speed = car.current.speed;
    vehicleState[kind].vLat = car.current.vLat;

    // light bar always flashes, active or parked — police cars look "on duty" whether driven or not
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
        save?.x ?? vehicleState[kind].x,
        groundYAt(save?.x ?? vehicleState[kind].x, save?.z ?? vehicleState[kind].z) + RIDE_HEIGHT,
        save?.z ?? vehicleState[kind].z,
      ]}
    >
      {/* Same drop as Car.tsx — collider bottom on the tyre contact patch, not
          on the mesh origin, or snapToGround buries the cruiser 0.305m. */}
      <CuboidCollider
        ref={colliderRef}
        args={[carBox.x / 2, carBox.y / 2, carBox.z / 2]}
        position={[0, carBox.y / 2 - RIDE_HEIGHT, 0]}
      />
      <PoliceCarMesh lightRefs={lightRefs} />
    </RigidBody>
  );
}

// Police interceptor livery on the shared supercar chassis
// (components/SupercarBody.tsx) — a pursuit exotic, not a second copy of the
// bodywork. Split out from the drivable rig above so parked cruisers
// (components/ParkedPoliceJeep.tsx) reuse the exact same model.
export function PoliceCarMesh({
  lightRefs,
  detail = "high",
}: {
  lightRefs: RefObject<(THREE.MeshBasicMaterial | null)[]>;
  detail?: Detail;
}) {
  return (
    <SupercarBody color="#0b0d12" style="hyper" detail={detail}>
      {/* white door panels — the two-tone that reads as "police" instantly */}
      {[1, -1].map((s) => (
        <group key={`liv${s}`}>
          <mesh position={[s * 0.9, -0.55, 0.15]}>
            <boxGeometry args={[0.03, 0.26, 1.5]} />
            <meshStandardMaterial color="#e9edf2" roughness={0.45} />
          </mesh>
          <mesh position={[s * 0.9, -0.55, -1.2]}>
            <boxGeometry args={[0.03, 0.22, 0.7]} />
            <meshStandardMaterial color="#2452ff" roughness={0.45} />
          </mesh>
        </group>
      ))}
      {/* push bar across the nose */}
      <mesh position={[0, -0.66, 2.44]}>
        <boxGeometry args={[1.5, 0.09, 0.07]} />
        <meshStandardMaterial color="#1b1e25" metalness={0.8} roughness={0.35} />
      </mesh>
      {[0.45, -0.45].map((x) => (
        <mesh key={`pb${x}`} position={[x, -0.6, 2.42]}>
          <boxGeometry args={[0.08, 0.3, 0.06]} />
          <meshStandardMaterial color="#1b1e25" metalness={0.8} roughness={0.35} />
        </mesh>
      ))}
      {/* low-profile light bar on the roof — the flashing halves below ARE
          this build's siren, read by Traffic.tsx's convoy recruit check */}
      <mesh position={[-0.3, 0.05, -0.34]}>
        <boxGeometry args={[0.56, 0.09, 0.26]} />
        <meshBasicMaterial ref={(el) => (lightRefs.current[0] = el)} color="#ff2020" />
      </mesh>
      <mesh position={[0.3, 0.05, -0.34]}>
        <boxGeometry args={[0.56, 0.09, 0.26]} />
        <meshBasicMaterial ref={(el) => (lightRefs.current[1] = el)} color="#2040ff" />
      </mesh>
      {/* A-pillar spotlight, ported from makePoliceJeep (index.html ~5723-5736) */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[-0.82, -0.2, 0.62]}>
        <cylinderGeometry args={[0.08, 0.06, 0.1, 12]} />
        <meshStandardMaterial color="#2a2c32" metalness={0.95} roughness={0.28} />
      </mesh>
      <mesh position={[-0.82, -0.2, 0.68]}>
        <circleGeometry args={[0.06, 16]} />
        <meshBasicMaterial color="#e6ecff" />
      </mesh>
    </SupercarBody>
  );
}
