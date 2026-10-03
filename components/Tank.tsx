"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepCarPhysics, TANK_HANDLING, type CarState } from "@/lib/carPhysics";
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
import { clampFromWater } from "@/lib/marina";
import { PLATFORM_Y } from "@/lib/militaryBase";
import { POLICE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import { requestFire } from "@/lib/tankShell";
import { QueryFilterFlags, type KinematicCharacterController } from "@dimforge/rapier3d-compat";

// FORT NEON's mountable tank (lib/militaryBase.ts's tank yard) — same
// kinematic-body/character-controller drive rig every other land vehicle
// uses (components/PoliceJeep.tsx is the closest template), swapping in
// TANK_HANDLING (lib/carPhysics.ts: slow, heavy, near-zero slide) and
// TankMesh below for the body. Turret + barrel are fixed forward, no
// independent-aim mechanic — the ask was "drive a tank," not "operate a
// turret," and that's a materially bigger control scheme to bolt on.

const HULL_MAT = new THREE.MeshStandardMaterial({ color: "#4b5320", roughness: 0.85, metalness: 0.15 });
const TRACK_MAT = new THREE.MeshStandardMaterial({ color: "#1c1e1a", roughness: 0.9 });
const WHEEL_MAT = new THREE.MeshStandardMaterial({ color: "#2a2b26", roughness: 0.8, metalness: 0.2 });
const BARREL_MAT = new THREE.MeshStandardMaterial({ color: "#3a3d2e", roughness: 0.6, metalness: 0.4 });
const HATCH_MAT = new THREE.MeshStandardMaterial({ color: "#3a3d2e", roughness: 0.7, metalness: 0.3 });
const GLASS_MAT = new THREE.MeshStandardMaterial({ color: "#0e1410", metalness: 0.7, roughness: 0.2 });
const LIGHT_WHITE = new THREE.MeshBasicMaterial({ color: "#fff6d8" });
const LIGHT_RED = new THREE.MeshBasicMaterial({ color: "#ff2020" });

// User ask: "make these tanks bigger." TankMesh itself stays authored at 1x
// (unscaled internal dimensions); callers (Tank()'s visual group, ParkedTank)
// apply this scale, matching how components/Airport.tsx's ParkedHeli scales
// HeliMesh via its own wrapping group rather than baking a scale into the
// shared mesh component.
export const TANK_SCALE = 1.7;

// The tank yard sits on FORT NEON's own elevated platform (lib/militaryBase.ts's
// PLATFORM_Y — there's no ground at world y=0 out here, it's open water), so
// the tank's ride height is measured from the platform surface, not sea level.
export const TANK_GROUND_Y = PLATFORM_Y + 0.55 * TANK_SCALE;

export function TankMesh() {
  return (
    <group>
      {/* tracks */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 1.55, -0.15, 0]}>
          <mesh material={TRACK_MAT} castShadow>
            <boxGeometry args={[0.75, 0.7, 5.6]} />
          </mesh>
          {[-2.1, -1.05, 0, 1.05, 2.1].map((z) => (
            <mesh key={z} position={[0, -0.05, z]} rotation={[0, 0, Math.PI / 2]} material={WHEEL_MAT}>
              <cylinderGeometry args={[0.36, 0.36, 0.78, 10]} />
            </mesh>
          ))}
        </group>
      ))}
      {/* hull */}
      <mesh position={[0, 0.35, 0]} material={HULL_MAT} castShadow receiveShadow>
        <boxGeometry args={[2.9, 0.7, 5.4]} />
      </mesh>
      <mesh position={[0, 0.72, 1.6]} rotation={[0.25, 0, 0]} material={HULL_MAT} castShadow>
        <boxGeometry args={[2.7, 0.55, 1.6]} />
      </mesh>
      <mesh position={[0, 0.85, 2.55]} material={GLASS_MAT}>
        <boxGeometry args={[1.6, 0.22, 0.15]} />
      </mesh>
      {/* turret + barrel */}
      <group position={[0, 1.1, -0.3]}>
        <mesh material={HULL_MAT} castShadow>
          <cylinderGeometry args={[1.15, 1.3, 0.85, 12]} />
        </mesh>
        <mesh position={[0, 0.5, 0]} material={HATCH_MAT}>
          <cylinderGeometry args={[0.4, 0.4, 0.12, 12]} />
        </mesh>
        <mesh position={[0, 0.25, 3.0]} rotation={[Math.PI / 2, 0, 0]} material={BARREL_MAT} castShadow>
          <cylinderGeometry args={[0.11, 0.13, 4.4, 10]} />
        </mesh>
        <mesh position={[0, 0.55, -0.9]} material={HULL_MAT}>
          <boxGeometry args={[0.1, 0.9, 0.1]} />
        </mesh>
      </group>
      {/* headlights / taillights */}
      {[-1, 1].map((s) => (
        <mesh key={`h${s}`} position={[s * 1.1, 0.4, 2.75]} material={LIGHT_WHITE}>
          <boxGeometry args={[0.22, 0.18, 0.08]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`t${s}`} position={[s * 1.1, 0.35, -2.75]} material={LIGHT_RED}>
          <boxGeometry args={[0.22, 0.16, 0.08]} />
        </mesh>
      ))}
    </group>
  );
}

const GRAVITY_PULL = -12;
const FIRE_COOLDOWN = 0.8; // seconds between shots
// Barrel-tip offset in the tank's own local frame (forward/up from hull
// centre) — approximated off TankMesh's turret/barrel geometry at TANK_SCALE,
// not pixel-exact, doesn't need to be for where a shell starts from.
const BARREL_FORWARD = 8.5;
const BARREL_UP = 2.3;

export function Tank() {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const [save] = useState(() => loadSave()?.vehicles.tank ?? null);
  const car = useRef<CarState>({ h: save?.h ?? vehicleState.tank.h, speed: 0, vLat: 0, steerAng: 0 });
  const nitro = useRef(initNitroFuel());
  const fallSpeed = useRef(0);
  const crashCooldown = useRef(0);
  const fireCooldown = useRef(0);
  const camPos = useRef(new THREE.Vector3(0, 4, -10));
  const camLook = useRef(new THREE.Vector3());
  const controllerRef = useRef<KinematicCharacterController | null>(null);

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

  const tankBox = useMemo(() => new THREE.Vector3(3.4, 1.2, 5.6).multiplyScalar(TANK_SCALE), []);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    const controller = controllerRef.current;
    const collider = colliderRef.current;
    if (!body || !controller || !collider) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === "tank";

    if (isActive && teleportRequest.pending) {
      teleportRequest.pending = false;
      body.setTranslation({ x: teleportRequest.x, y: TANK_GROUND_Y, z: teleportRequest.z }, true);
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
      ? { ...TANK_HANDLING, accel: TANK_HANDLING.accel * NITRO_ACCEL_MULT, max: TANK_HANDLING.max + NITRO_BOOST }
      : TANK_HANDLING;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz } = stepCarPhysics(
      car.current,
      { forward: isActive && k.forward, back: isActive && k.back, steer, handbrake: isActive && k.handbrake },
      handling,
      d
    );

    fallSpeed.current += GRAVITY_PULL * d;
    // filterGroups=POLICE_SWEEP_GROUPS — same fix as PoliceCar.tsx/PoliceJeep.tsx:
    // this call had no 4th argument, so a parked tank's zero-input sweep
    // treated an on-foot player who walked into it as an obstacle and
    // depenetrated against them every frame. See lib/collisionGroups.ts.
    controller.computeColliderMovement(collider, { x: dx, y: fallSpeed.current * d, z: dz }, QueryFilterFlags.EXCLUDE_DYNAMIC, POLICE_SWEEP_GROUPS);
    const grounded = controller.computedGrounded();
    if (grounded) fallSpeed.current = 0;
    const movement = controller.computedMovement();

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
    clampFromWater(nextPos);

    if (fellOutOfWorld(nextPos.y, nextPos.x)) {
      body.setTranslation({ x: nextPos.x, y: TANK_GROUND_Y, z: nextPos.z }, true);
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

      fireCooldown.current = Math.max(0, fireCooldown.current - d);
      if (k.fire && fireCooldown.current <= 0) {
        fireCooldown.current = FIRE_COOLDOWN;
        const fdx = Math.sin(car.current.h);
        const fdz = Math.cos(car.current.h);
        requestFire(nextPos.x + fdx * BARREL_FORWARD, nextPos.y + BARREL_UP, nextPos.z + fdz * BARREL_FORWARD, fdx, fdz);
      }
    }

    vehicleState.tank.x = nextPos.x;
    vehicleState.tank.y = nextPos.y;
    vehicleState.tank.z = nextPos.z;
    vehicleState.tank.h = car.current.h;
    vehicleState.tank.speed = car.current.speed;
    vehicleState.tank.vLat = car.current.vLat;

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
      cockpitEyeHeight: 1.6,
      cockpitForward: -0.1,
      chaseDist: 11.5,
      chaseHeight: 5.0,
    });

    // true ground speed including lateral slide — see Car.tsx's same fix
    useHudStore.getState().setHud(Math.round(Math.hypot(car.current.speed, car.current.vLat) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[save?.x ?? vehicleState.tank.x, TANK_GROUND_Y, save?.z ?? vehicleState.tank.z]}
    >
      <CuboidCollider ref={colliderRef} args={[tankBox.x / 2, tankBox.y / 2, tankBox.z / 2]} position={[0, tankBox.y / 2, 0]} />
      <group scale={TANK_SCALE}>
        <TankMesh />
      </group>
    </RigidBody>
  );
}

// Static parked tank for the tank yard — no drive rig, no collider (matches
// components/Airport.tsx's ParkedHeli/decorative-fleet convention: dressing,
// not an obstacle a player can get stuck on). Rendered inside
// components/MilitaryBase.tsx's own <group> (already offset by PLATFORM_Y),
// so unlike the drivable Tank() below (world-space spawn) this only needs
// the local hull-above-tracks ride height, not the platform offset too.
export function ParkedTank({ x, z, h = 0 }: { x: number; z: number; h?: number }) {
  return (
    <group position={[x, 0.55 * TANK_SCALE, z]} rotation={[0, h, 0]} scale={TANK_SCALE}>
      <TankMesh />
    </group>
  );
}
