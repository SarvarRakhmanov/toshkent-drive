"use client";

import { useRef, useEffect, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import { VEHICLE_BODY_GROUPS, VEHICLE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepCarPhysics, JEEP_HANDLING, BUS_HANDLING, TRUCK_HANDLING, type CarState, type CarHandling } from "@/lib/carPhysics";
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
import { RIDE_HEIGHT } from "@/components/SupercarBody";
import { CommercialBody, type CommercialKind } from "@/components/CommercialBody";
import { CommercialCockpit } from "@/components/CommercialCockpit";
import { clampFromWater, groundYAt } from "@/lib/marina";
import { QueryFilterFlags, type KinematicCharacterController } from "@dimforge/rapier3d-compat";

const GRAVITY_PULL = -12;

// per-kind physics/collider/camera tuning. Box sizes match Traffic.tsx's own
// colliderBoxFor (same bodies, same extents). Camera numbers: eye height
// climbs jeep -> truck -> bus (bus highest/most upright), chase distance/
// height grow with body length so the camera clears the tail instead of
// clipping into it (same reasoning as DrivableAirliner.tsx's chaseDist=48).
const SPEC: Record<
  CommercialKind,
  {
    handling: CarHandling;
    box: [number, number, number];
    cockpitEyeHeight: number;
    cockpitForward: number;
    chaseDist: number;
    chaseHeight: number;
  }
> = {
  jeep: { handling: JEEP_HANDLING, box: [1.95, 1.5, 3.6], cockpitEyeHeight: 1.5, cockpitForward: -0.3, chaseDist: 10.5, chaseHeight: 4.6 },
  truck: { handling: TRUCK_HANDLING, box: [2.1, 2.0, 5.6], cockpitEyeHeight: 2.0, cockpitForward: -0.2, chaseDist: 13, chaseHeight: 5.5 },
  bus: { handling: BUS_HANDLING, box: [2.2, 2.3, 6.5], cockpitEyeHeight: 2.5, cockpitForward: -0.15, chaseDist: 15, chaseHeight: 6.5 },
};

// Drivable jeep/bus/truck — a near-copy of PoliceCar.tsx's rig (same
// character-controller/gravity/camera boilerplate; a fourth+fifth+sixth land
// vehicle is exactly the point that file's own comment says to eventually
// pull into a shared hook), parametrized over CommercialKind instead of
// tripling the file. Nitro now shared via lib/nitro.ts (used to be the
// sedan's own gimmick only). Still no drowning respawn (PoliceCar.tsx skips
// that too, same reasoning applies).
export function CommercialVehicle({ kind, color }: { kind: CommercialKind; color: string }) {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const keys = useKeyboard();
  const { camera } = useThree();
  const spec = SPEC[kind];

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
      ? { ...spec.handling, accel: spec.handling.accel * NITRO_ACCEL_MULT, max: spec.handling.max + NITRO_BOOST }
      : spec.handling;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz } = stepCarPhysics(
      car.current,
      { forward: isActive && k.forward, back: isActive && k.back, steer, handbrake: isActive && k.handbrake },
      handling,
      d
    );

    fallSpeed.current += GRAVITY_PULL * d;
    // VEHICLE_SWEEP_GROUPS, same as Car.tsx/Bike.tsx: this rig is player-driven, so
    // it should pass VEHICLE_ONLY curbs/gates the way the sedan/bike do
    // rather than get stuck on them the way PoliceCar.tsx's rig does — but
    // still get stopped by WATER_BOUNDARY (Marina.tsx) at the water's edge.
    // VEHICLE_SWEEP_GROUPS (not VEHICLE_BODY_GROUPS) additionally excludes
    // the on-foot player from this query — see lib/collisionGroups.ts for
    // why a parked commercial vehicle's own sweep otherwise pushes itself
    // away from a player who walks into it.
    controller.computeColliderMovement(collider, { x: dx, y: fallSpeed.current * d, z: dz }, QueryFilterFlags.EXCLUDE_DYNAMIC, VEHICLE_SWEEP_GROUPS);
    const grounded = controller.computedGrounded();
    if (grounded) fallSpeed.current = 0;
    const movement = controller.computedMovement();

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
    // hard backstop, independent of the WATER_BOUNDARY collider — see Car.tsx/lib/marina.ts
    clampFromWater(nextPos);

    // Out-of-world recovery — see Car.tsx/lib/fallGuard.ts.
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
      // see Car.tsx's identical block + lib/pedestrianHit.ts
      const hitSlow = consumePedestrianHitSlowdown();
      if (hitSlow !== null) car.current.speed *= hitSlow;
    }

    vehicleState[kind].x = nextPos.x;
    vehicleState[kind].y = nextPos.y;
    vehicleState[kind].z = nextPos.z;
    vehicleState[kind].h = car.current.h;
    vehicleState[kind].speed = car.current.speed;
    vehicleState[kind].vLat = car.current.vLat;

    // amber mirror beacons always flash, driven or parked — same "looks on
    // duty" precedent as PoliceCar.tsx's light bar
    const flashAmber = Math.floor(state.clock.elapsedTime * 5) % 2 === 0;
    if (lightRefs.current[0]) lightRefs.current[0].color.set(flashAmber ? "#ffb000" : "#402d00");
    if (lightRefs.current[1]) lightRefs.current[1].color.set(flashAmber ? "#ffb000" : "#402d00");

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
      cockpitEyeHeight: spec.cockpitEyeHeight,
      cockpitForward: spec.cockpitForward,
      chaseDist: spec.chaseDist,
      chaseHeight: spec.chaseHeight,
    });

    // true ground speed including lateral slide — see Car.tsx's same fix
    useHudStore.getState().setHud(Math.round(Math.hypot(car.current.speed, car.current.vLat) * 3.6), grounded);
  });

  const [bw, bh, bl] = spec.box;

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
      {/* same drop as Car.tsx/Bike.tsx — collider bottom on the tyre contact
          patch, not the mesh origin, or snapToGround buries the chassis */}
      <CuboidCollider
        ref={colliderRef}
        args={[bw / 2, bh / 2, bl / 2]}
        position={[0, bh / 2 - RIDE_HEIGHT, 0]}
        collisionGroups={VEHICLE_BODY_GROUPS}
      />
      <CommercialBody kind={kind} color={color} lightRefs={lightRefs} />
      <CommercialCockpit kind={kind} eyeX={spec.cockpitForward} eyeY={spec.cockpitEyeHeight} />
    </RigidBody>
  );
}
