"use client";

import { useRef, useEffect, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import { VEHICLE_BODY_GROUPS, VEHICLE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepCarPhysics, BIKE_HANDLING, type CarState } from "@/lib/carPhysics";
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
import { SHORE_X, DROWN_RESPAWN, clampFromWater, isOnBridgeOrBase, groundYAt } from "@/lib/marina";
import { QueryFilterFlags, type KinematicCharacterController } from "@dimforge/rapier3d-compat";

const GRAVITY_PULL = -12;
const DROWN_LIMIT = 2; // seconds past the shore before respawn — mirrors Player.tsx's on-foot drowning

// Same ground/collision machinery as Car.tsx (a bike still needs the floor —
// see the original: bikes go through the identical drive-loop physics as
// cars, they just default to a higher lateral grip and lean visually). The
// duplication between this and Car.tsx (character controller setup, gravity
// integration, chase camera) is small enough to leave alone for now; if a
// fourth land vehicle shows up, pull the shared part into a hook.
export function Bike() {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const [save] = useState(() => loadSave()?.vehicles.bike ?? null);
  const bike = useRef<CarState>({ h: save?.h ?? 0, speed: 0, vLat: 0, steerAng: 0 });
  const nitro = useRef(initNitroFuel());
  const fallSpeed = useRef(0);
  const drownTime = useRef(0);
  const crashCooldown = useRef(0);
  const camPos = useRef(new THREE.Vector3(-20, 4, -10));
  const camLook = useRef(new THREE.Vector3());
  const controllerRef = useRef<KinematicCharacterController | null>(null);
  const leanRef = useRef(0);
  const riderRef = useRef<THREE.Group>(null);
  const frontWheelRef = useRef<THREE.Group>(null);
  const rearWheelRef = useRef<THREE.Group>(null);
  const wheelRotRef = useRef(0);

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

  const bikeBox = useMemo(() => new THREE.Vector3(0.7, 0.9, 1.9), []);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    const controller = controllerRef.current;
    const collider = colliderRef.current;
    if (!body || !controller || !collider) return;
    const d = Math.min(dt, 0.05);

    const isActive = useHudStore.getState().active === "bike";
    // same visible-only-while-driving toggle as Player.tsx's own character —
    // an unridden bike (parked, or the player off on foot elsewhere) shouldn't
    // show a rider sitting on it
    if (riderRef.current) riderRef.current.visible = isActive;

    // club door teleport (enter/exit VENU) — see lib/club.ts
    if (isActive && teleportRequest.pending) {
      teleportRequest.pending = false;
      body.setTranslation({ x: teleportRequest.x, y: BIKE_RIDE_HEIGHT, z: teleportRequest.z }, true);
      bike.current.h = teleportRequest.h;
      bike.current.speed = 0;
      bike.current.vLat = 0;
      worldState.px = teleportRequest.x;
      worldState.pz = teleportRequest.z;
      worldState.heading = teleportRequest.h;
      return;
    }

    const k = keys.current;
    const steer = isActive ? (k.left ? 1 : 0) - (k.right ? 1 : 0) : 0;

    // nitro: SHIFT+forward — same rig as Car.tsx, factored into lib/nitro.ts
    // so every vehicle shares the fuel/lock math instead of re-deriving it.
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? { ...BIKE_HANDLING, accel: BIKE_HANDLING.accel * NITRO_ACCEL_MULT, max: BIKE_HANDLING.max + NITRO_BOOST }
      : BIKE_HANDLING;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz } = stepCarPhysics(
      bike.current,
      { forward: isActive && k.forward, back: isActive && k.back, steer, handbrake: isActive && k.handbrake },
      handling,
      d
    );

    fallSpeed.current += GRAVITY_PULL * d;
    // see Car.tsx: EXCLUDE_DYNAMIC lets the bike plow through props instead of
    // sliding/stopping on them, while the solver still shoves the prop aside.
    // filterGroups=VEHICLE_SWEEP_GROUPS on the sweep itself — see Player.tsx's
    // computeColliderMovement for why the collider's own collisionGroups tag
    // alone doesn't make this query skip VEHICLE_ONLY colliders (airport
    // gate gap, Airport.tsx). The extra vehicle-body bit (vs. plain
    // PLAYER_GROUPS) is what WATER_BOUNDARY (Marina.tsx) keys off to stop the
    // bike at the water's edge without also blocking the on-foot player.
    // VEHICLE_SWEEP_GROUPS (not VEHICLE_BODY_GROUPS) additionally excludes
    // the on-foot player from this query — see lib/collisionGroups.ts for
    // why a parked bike's own sweep otherwise pushes itself away from a
    // player who walks into it.
    controller.computeColliderMovement(collider, { x: dx, y: fallSpeed.current * d, z: dz }, QueryFilterFlags.EXCLUDE_DYNAMIC, VEHICLE_SWEEP_GROUPS);
    const grounded = controller.computedGrounded();
    if (grounded) fallSpeed.current = 0;
    const movement = controller.computedMovement();
    // #36 fix, same reasoning as Car.tsx (measured there via real repro data,
    // not re-derived here) — fallSpeed only ever accumulates <=0, so the
    // sweep's requested y is never positive; any resulting movement.y beyond
    // a small ground-snap tolerance is a transient KCC glitch (most likely a
    // chunk-seam snap-to-ground false positive), not real physics.
    if (movement.y > 0.06) movement.y = 0.06;

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
    // hard backstop, independent of the WATER_BOUNDARY collider — see Car.tsx/lib/marina.ts
    clampFromWater(nextPos);

    // drowning safety net — see Car.tsx for why this is unreachable in normal
    // play but still worth a respawn instead of falling forever. Exempt
    // I-94's bridge/FORT NEON's platform, same reason Car.tsx does.
    if (nextPos.x >= SHORE_X && !isOnBridgeOrBase(nextPos)) {
      drownTime.current += d;
      if (drownTime.current > DROWN_LIMIT) {
        drownTime.current = 0;
        body.setTranslation({ x: DROWN_RESPAWN.x, y: BIKE_RIDE_HEIGHT, z: DROWN_RESPAWN.z }, true);
        bike.current.h = DROWN_RESPAWN.h;
        bike.current.speed = 0;
        bike.current.vLat = 0;
        fallSpeed.current = 0;
        vehicleState.bike.x = DROWN_RESPAWN.x;
        vehicleState.bike.z = DROWN_RESPAWN.z;
        vehicleState.bike.h = DROWN_RESPAWN.h;
        if (isActive) {
          worldState.px = DROWN_RESPAWN.x;
          worldState.pz = DROWN_RESPAWN.z;
          worldState.heading = DROWN_RESPAWN.h;
        }
        return;
      }
    } else {
      drownTime.current = 0;
    }


    // Out-of-world recovery: if the ground was not streamed in yet and the body
    // stepped through the gap, put it back on the surface here rather than let
    // gravity integrate it to -65,000. See lib/fallGuard.ts.
    if (fellOutOfWorld(nextPos.y, nextPos.x)) {
      body.setTranslation({ x: nextPos.x, y: BIKE_RIDE_HEIGHT, z: nextPos.z }, true); // matches SupercarBody's RIDE_HEIGHT concept now, see BIKE_RIDE_HEIGHT above
      fallSpeed.current = 0;
      bike.current.speed = 0;
      return;
    }

    body.setNextKinematicTranslation(nextPos);

    if (isActive) {
      checkCrashDebris(crashCooldown, d, { x: dx, z: dz }, { x: movement.x, z: movement.z }, Math.abs(bike.current.speed), nextPos, bike.current.h);
      // see components/Car.tsx's identical block + lib/pedestrianHit.ts
      const hitSlow = consumePedestrianHitSlowdown();
      if (hitSlow !== null) bike.current.speed *= hitSlow;
    }

    // wheel spin — rolls proportional to true forward speed (bike.current.speed,
    // not the ground-speed-with-drift hypot used for the HUD), around each
    // wheel's actual rolling axis. Sign note: Wheel()'s outer group has a fixed
    // rotation=[0,0,Math.PI/2] that reorients the tire cylinder's own axis
    // (local Y) onto the true axle direction — but that same Rz(+90°) maps the
    // inner spin group's +Y axis onto the axle's -X direction (not +X), so a
    // NEGATIVE rotation.y on the inner group is what produces a right-hand-
    // positive rotation about the true +X axle. Verified numerically (not just
    // by hand) with a standalone three.js matrix check: a material point fixed
    // to the tire rim moves toward +Z — the bike's forward axis — as spin goes
    // negative, matching the no-slip rolling condition for forward motion.
    // Negative bike.current.speed (reverse) flips the sign automatically, so
    // the wheels correctly spin backward when reversing.
    wheelRotRef.current += -(bike.current.speed / WHEEL_RADIUS) * d;
    if (frontWheelRef.current) frontWheelRef.current.rotation.y = wheelRotRef.current;
    if (rearWheelRef.current) rearWheelRef.current.rotation.y = wheelRotRef.current;

    // lean into the turn — same formula as the original's isBike branch
    // (rotation.z = -steer * speed-scaled * 0.45), purely visual
    const targetLean = -steer * clamp(Math.abs(bike.current.speed) / 25, 0, 1) * 0.45;
    leanRef.current += (targetLean - leanRef.current) * clamp(d * 10, 0, 1);
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), bike.current.h)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), leanRef.current));
    body.setNextKinematicRotation(q);

    vehicleState.bike.x = nextPos.x;
    vehicleState.bike.y = nextPos.y;
    vehicleState.bike.z = nextPos.z;
    vehicleState.bike.h = bike.current.h;
    vehicleState.bike.speed = bike.current.speed;
    vehicleState.bike.vLat = bike.current.vLat;

    if (!isActive) return;
    worldState.px = nextPos.x;
    worldState.pz = nextPos.z;
    worldState.heading = bike.current.h;

    applyCameraRig({
      camera,
      camPos: camPos.current,
      camLook: camLook.current,
      tx: nextPos.x,
      ty: nextPos.y,
      tz: nextPos.z,
      th: bike.current.h,
      isBike: true,
      camMode: useHudStore.getState().camMode,
      time: state.clock.elapsedTime,
      dt: d,
      speedMs: Math.abs(bike.current.speed),
    });

    // true ground speed including lateral slide — see Car.tsx's same fix
    useHudStore.getState().setHud(Math.round(Math.hypot(bike.current.speed, bike.current.vLat) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[save?.x ?? -20, groundYAt(save?.x ?? -20, save?.z ?? 0) + BIKE_RIDE_HEIGHT, save?.z ?? 0]}
    >
      {/* VEHICLE_BODY_GROUPS so the player's bike passes VEHICLE_ONLY colliders
          (airport gate gap, Airport.tsx) like Car.tsx and Player.tsx do, but
          still gets stopped by WATER_BOUNDARY (Marina.tsx) at the water's edge.
          position.y = bikeBox.y/2 - BIKE_RIDE_HEIGHT puts the collider BOTTOM
          at -BIKE_RIDE_HEIGHT relative to the RigidBody's own translation —
          same formula SupercarBody.tsx's cars use — so it lands exactly on
          the visual tyre contact patch instead of 0.31m above it. */}
      <CuboidCollider
        ref={colliderRef}
        args={[bikeBox.x / 2, bikeBox.y / 2, bikeBox.z / 2]}
        position={[0, bikeBox.y / 2 - BIKE_RIDE_HEIGHT, 0]}
        collisionGroups={VEHICLE_BODY_GROUPS}
      />
      <BikeMesh frontWheelRef={frontWheelRef} rearWheelRef={rearWheelRef} />
      <group ref={riderRef}>
        <BikeRider />
      </group>
    </RigidBody>
  );
}

const BIKE_MAIN_MAT = new THREE.MeshStandardMaterial({ color: "#5c6142", metalness: 0.35, roughness: 0.45 });
const BIKE_PANEL_MAT = new THREE.MeshStandardMaterial({ color: "#2b2d30", metalness: 0.6, roughness: 0.35 });
const BIKE_GOLD_MAT = new THREE.MeshStandardMaterial({ color: "#c9a227", metalness: 0.8, roughness: 0.25 });
const BIKE_SEAT_MAT = new THREE.MeshStandardMaterial({ color: "#17181a", roughness: 0.6 });
const BIKE_TIRE_MAT = new THREE.MeshStandardMaterial({ color: "#141414", roughness: 0.9 });
// was #2a2c32 — a dark grey barely lighter than BIKE_TIRE_MAT's near-black,
// so against in-game lighting the hub disappeared into the tire and the
// whole wheel read as a flat black void with no visible rim ("the tire
// looks open"). Bright brushed chrome, same polished-metal language as
// BIKE_GOLD_MAT's fork tubes, actually reads as a rim against the tire.
const BIKE_HUB_MAT = new THREE.MeshStandardMaterial({ color: "#c4cad2", metalness: 0.9, roughness: 0.25 });

// tire radius (matches the cylinderGeometry args below) — pulled out to a
// named constant so Bike()'s useFrame wheel-spin math (rotation = speed/radius)
// can't silently drift out of sync with the actual mesh.
export const WHEEL_RADIUS = 0.34;
// vertical drop from the bike's own local origin (BikeMesh's group root) down
// to each wheel's axle — used below by BIKE_RIDE_HEIGHT so the ride-height
// fix stays tied to the actual geometry instead of a second hand-copied number.
const WHEEL_Y_OFFSET = 0.42;
// distance from the RigidBody's own translation origin down to the tyre
// contact patch — same concept as SupercarBody.tsx's RIDE_HEIGHT, computed
// from the wheel's own geometry so it can't drift out of sync with it. Was
// previously not used at all: every spawn/teleport/respawn site in this file
// hardcoded a flat "y: 1", and the CuboidCollider below had no y offset —
// with WHEEL_Y_OFFSET+WHEEL_RADIUS=0.76, that left the collider bottom
// sitting 1-(1-0.9/2)=0.45 above ground while the visual tyre bottom sat at
// 1-0.76=0.24 above ground, a real 0.31m mismatch (collider higher than the
// wheels, i.e. the wheels would clip into the ground once the KCC settled
// the collider onto the surface — the opposite direction from "floating").
export const BIKE_RIDE_HEIGHT = WHEEL_Y_OFFSET + WHEEL_RADIUS;

// a wheel + its hub — the rear one gets a much bigger hub disc to read as the
// Verge TS's signature hubless rear end (motor housing fills the wheel
// instead of spokes around a small hub)
function Wheel({ z, hubR, hubThick, spinRef }: { z: number; hubR: number; hubThick: number; spinRef?: React.RefObject<THREE.Group | null> }) {
  return (
    <group position={[0, -WHEEL_Y_OFFSET, z]} rotation={[0, 0, Math.PI / 2]}>
      {/* Inner group carries ONLY the imperative per-frame spin (rotation.y is
          set directly by Bike()'s useFrame via spinRef — never through a JSX
          rotation prop), kept separate from the outer group's declarative
          rotation=[0,0,PI/2] above so a React re-render of BikeMesh can never
          clobber the accumulated spin. Callers that don't pass spinRef (the
          static parked decoration in PoliceStation.tsx) just get an
          always-identity group — a visual no-op. */}
      <group ref={spinRef}>
        <mesh castShadow material={BIKE_TIRE_MAT}>
          <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, 0.1, 20]} />
        </mesh>
        <mesh material={BIKE_HUB_MAT}>
          <cylinderGeometry args={[hubR, hubR, hubThick, 16]} />
        </mesh>
      </group>
    </group>
  );
}

// exported so parked decoration (components/PoliceStation.tsx) can reuse the
// exact same model without a RigidBody/physics rig attached. Redesigned after
// the Verge TS Ultra: angular faceted tank panels, twin stacked headlights,
// gold upside-down fork tubes, a floating tail with no bulky subframe, and
// an oversized rear hub standing in for the real bike's hubless rear motor.
export function BikeMesh({
  frontWheelRef,
  rearWheelRef,
}: {
  frontWheelRef?: React.RefObject<THREE.Group | null>;
  rearWheelRef?: React.RefObject<THREE.Group | null>;
} = {}) {
  return (
    <group>
      {/* main body spine */}
      <mesh castShadow position={[0, 0.08, 0.05]} material={BIKE_MAIN_MAT}>
        <boxGeometry args={[0.24, 0.22, 1.25]} />
      </mesh>
      {/* angular tank-side facets */}
      {[1, -1].map((s) => (
        <mesh key={s} castShadow position={[s * 0.15, 0.22, 0.25]} rotation={[0, 0, s * 0.35]} material={BIKE_PANEL_MAT}>
          <boxGeometry args={[0.05, 0.26, 0.55]} />
        </mesh>
      ))}
      {/* side vent panel */}
      <mesh position={[0.13, 0.05, -0.05]} rotation={[0, 0.2, 0]} material={BIKE_PANEL_MAT}>
        <boxGeometry args={[0.02, 0.16, 0.3]} />
      </mesh>
      {/* floating tail seat — no bulky rear bodywork under it */}
      <mesh position={[0, 0.3, -0.35]} material={BIKE_SEAT_MAT}>
        <boxGeometry args={[0.22, 0.06, 0.5]} />
      </mesh>

      {/* upside-down front fork tubes */}
      {[0.09, -0.09].map((x) => (
        <mesh key={x} castShadow position={[x, -0.15, 0.68]} rotation={[0.15, 0, 0]} material={BIKE_GOLD_MAT}>
          <cylinderGeometry args={[0.025, 0.025, 0.55, 10]} />
        </mesh>
      ))}

      {/* twin stacked headlights */}
      {[0.09, -0.09].map((dy) => (
        <mesh key={dy} position={[0, 0.3 + dy, 0.85]}>
          <sphereGeometry args={[0.055, 10, 10]} />
          <meshBasicMaterial color="#c9f0ff" />
        </mesh>
      ))}
      <mesh position={[0, 0.28, -0.62]}>
        <boxGeometry args={[0.12, 0.05, 0.03]} />
        <meshBasicMaterial color="#ff2b2b" />
      </mesh>

      {/* bar-end mirrors on thin stalks */}
      {[0.16, -0.16].map((x) => (
        <group key={x} position={[x, 0.42, 0.65]}>
          <mesh rotation={[0, 0, Math.PI / 2]} material={BIKE_PANEL_MAT}>
            <cylinderGeometry args={[0.015, 0.015, 0.14, 6]} />
          </mesh>
          <mesh position={[x > 0 ? 0.08 : -0.08, 0.02, 0]} material={BIKE_PANEL_MAT}>
            <boxGeometry args={[0.09, 0.05, 0.03]} />
          </mesh>
        </group>
      ))}

      {/* front hub bumped from 0.12 — that small a disc against the now-
          brighter BIKE_HUB_MAT read as a tiny bright dot lost in a big dark
          tire rather than a rim; a real front wheel's hub/rim is closer to
          half the tire's radius */}
      <Wheel z={0.7} hubR={0.19} hubThick={0.12} spinRef={frontWheelRef} />
      <Wheel z={-0.7} hubR={0.27} hubThick={0.16} spinRef={rearWheelRef} />
    </group>
  );
}

// Was #1c1e22/#101114/#26282c — near-black enough that under open-air scene
// lighting (no local fill light, unlike CarInterior.tsx/HeliCockpit.tsx's
// shaded cabin occupants, which don't need brighter base colors because
// they have their own pointLight) diffuse shading had almost nothing to
// work with, so the rider read as a flat black silhouette rather than a
// lit rider. Brightened enough to pick up real highlight/shadow contrast in
// daylight while staying a plausible dark riding-gear palette, not colorful.
const RIDER_JACKET_MAT = new THREE.MeshStandardMaterial({ color: "#3a3f47", roughness: 0.55 });
const RIDER_HELMET_MAT = new THREE.MeshStandardMaterial({ color: "#23262c", roughness: 0.2, metalness: 0.5 });
const RIDER_LIMB_MAT = new THREE.MeshStandardMaterial({ color: "#454a52", roughness: 0.6 });

// a minimal seated silhouette, not the full walk-cycle rig Pedestrians.tsx
// builds (that's tuned for walking animation, overkill for a fixed seated
// pose) — leaning forward over the tank, arms to the bars, legs to the pegs
function BikeRider() {
  return (
    <group position={[0, 0.33, -0.3]}>
      <mesh castShadow position={[0, 0.28, 0.15]} rotation={[0.35, 0, 0]} material={RIDER_JACKET_MAT}>
        <boxGeometry args={[0.26, 0.4, 0.2]} />
      </mesh>
      <mesh castShadow position={[0, 0.56, 0.32]} material={RIDER_HELMET_MAT}>
        <sphereGeometry args={[0.13, 10, 10]} />
      </mesh>
      {[0.14, -0.14].map((x) => (
        <mesh key={x} castShadow position={[x, 0.32, 0.42]} rotation={[0.9, 0, 0]} material={RIDER_LIMB_MAT}>
          <cylinderGeometry args={[0.045, 0.045, 0.42, 8]} />
        </mesh>
      ))}
      {[0.11, -0.11].map((x) => (
        <mesh key={x} castShadow position={[x, 0.04, 0.02]} rotation={[0.55, 0, 0]} material={RIDER_LIMB_MAT}>
          <cylinderGeometry args={[0.055, 0.055, 0.42, 8]} />
        </mesh>
      ))}
    </group>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
