"use client";

import { fuelOf, fuelTank, burnRate, persistEcon, carRepair } from "@/lib/economy";
import { useRef, useEffect, useMemo, useState, Suspense } from "react";
import { PlayerGlbCar, playerWheels } from "@/components/GlbCar";
import { useThree } from "@react-three/fiber";
import { useFrame } from "@/lib/safeFrame";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import { VEHICLE_BODY_GROUPS, VEHICLE_SWEEP_GROUPS } from "@/lib/collisionGroups";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import type { CarState } from "@/lib/carPhysics";
import { poseWheels } from "@/lib/wheelRig";
import { stepDynamics, rampSteer, newDynState, effectiveSpec, applyImpact, engineTelemetry, STOCK, type VehicleSpec } from "@/lib/vehicleDynamics";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { fellOutOfWorld } from "@/lib/fallGuard";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { teleportRequest } from "@/lib/clubTeleport";
import { carSummon } from "@/lib/vehicleSummon";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { carDestroyRequest } from "@/lib/vehicleDestroy";
import { checkCrashDebris } from "@/lib/debris";
import { consumePedestrianHitSlowdown } from "@/lib/pedestrianHit";
import { SHORE_X, DROWN_RESPAWN, clampFromWater, isOnBridgeOrBase, groundYAt } from "@/lib/marina";
import { SupercarBody, styleFor, RIDE_HEIGHT, type CarStyle, type Detail } from "@/components/SupercarBody";
import { CarInterior, cockpitCameraArgs } from "@/components/CarInterior";
import { usePlayerCarStore, PLAYER_CARS } from "@/lib/playerCar";
import { useCareer } from "@/lib/career";
import { QueryFilterFlags, type KinematicCharacterController } from "@dimforge/rapier3d-compat";
import { tmpQuat, AXIS_Y } from "@/lib/scratch";
import { isClear, findSafeSpot } from "@/lib/safeSpot";
import { isReady } from "@/lib/loadState";

/** v1.6.1: throttle held with no real movement for this long → reposition */
const STUCK_SECONDS = 3;
export const carSafety = { spawnChecked: false, relocations: 0, unstucks: 0, last: "" };
/** test hook access (lib/testHooks.ts clear()) */
export const carWorldRef: { world: import("@dimforge/rapier3d-compat").World | null } = { world: null };

const GRAVITY_PULL = -12; // m/s^2 fed into the character controller so it stays snapped to the ground
const NITRO_MAX = 10; // seconds of fuel — same numbers as the original's NITRO_MAX/NITRO_BOOST
const NITRO_BOOST = 41.7; // +150 km/h over the car's normal top speed while boosting
const DROWN_LIMIT = 2; // seconds past the shore before respawn — mirrors Player.tsx's on-foot drowning
// A tank shell hit: stop, burn black, vanish, respawn — user's own numbers
// ("2, 3, or maybe 5 seconds"), picked the middle of that range.
const BURN_DURATION = 4;
const CAR_RESPAWN = { x: 0, z: 0, h: 0 }; // same clear spot the game already spawns a fresh car at

export function Car() {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  // one-time impure read (localStorage), same pattern as CarMesh's random color below
  const [save] = useState(() => loadSave()?.vehicles.car ?? null);

  // persistent car state across frames (heading/speed/vLat/steerAng) — mirrors the
  // original game's per-vehicle object, kept in a ref so updating it never re-renders
  const car = useRef<CarState>({ h: save?.h ?? 0, speed: 0, vLat: 0, steerAng: 0 });
  const restFrames = useRef(0);
  const fallSpeed = useRef(0);
  const drownTime = useRef(0);
  const crashCooldown = useRef(0);
  const destroyedUntil = useRef(0); // 0 = alive; else state.clock.elapsedTime this car respawns at
  const nitroFuel = useRef(NITRO_MAX);
  const nitroLocked = useRef(false); // true from empty tank until a full recharge — blocks re-triggering on a half-full tank
  const camPos = useRef(new THREE.Vector3(0, 4, -10));
  const camLook = useRef(new THREE.Vector3());
  // v1.6 driving physics state + the per-car spec (lib/playerCar.ts `phys`)
  const dyn = useRef(newDynState());
  const visBody = useRef<THREE.Group>(null);
  const specCache = useRef<{ index: number; rev: number; spec: VehicleSpec } | null>(null);
  const controllerRef = useRef<KinematicCharacterController | null>(null);
  // v1.6.1 auto-unstuck: game time the throttle has been held without the
  // car actually getting anywhere (t0, 0 = idle), and where that window started
  const stuck = useRef({ t0: 0, x: 0, z: 0 });
  const spawnChecked = useRef(false);

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

  // overall envelope used for the collider — roughly the original's city-sedan
  // spec (len 4.6, wid 1.85); local y=0 is the car's vertical mid-point
  const carBox = useMemo(() => new THREE.Vector3(1.85, 1.3, 4.6), []);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    const controller = controllerRef.current;
    const collider = colliderRef.current;
    if (!body || !controller || !collider) return;
    const d = Math.min(dt, 0.05); // clamp like the original tick() to avoid a tab-switch spike

    const isActive = useHudStore.getState().active === "car";
    carWorldRef.world = world;

    // "call mechanic" phone summon (components/Phone.tsx, lib/vehicleSummon.ts)
    // — unconditional, unlike the club-door teleportRequest below: the whole
    // point is bringing the car to a player who is on foot, i.e. NOT driving
    // it, so gating this on isActive would make it a no-op every time.
    // v1.6.1: put the car on a spot with nothing solid around it (and a
    // clear run-up ahead) — start spawn, reset, mechanic call, auto-unstuck
    const placeAt = (x: number, z: number, h: number, why: string, raw = false) => {
      const p = raw ? { x, z, h } : findSafeSpot(world, x, z, h, collider);
      destroyedUntil.current = 0;
      body.setTranslation({ x: p.x, y: groundYAt(p.x, p.z) + RIDE_HEIGHT, z: p.z }, true);
      body.setNextKinematicTranslation({ x: p.x, y: groundYAt(p.x, p.z) + RIDE_HEIGHT, z: p.z });
      car.current.h = p.h;
      car.current.speed = 0;
      car.current.vLat = 0;
      car.current.steerAng = 0;
      fallSpeed.current = 0;
      restFrames.current = 0;
      vehicleState.car.x = p.x;
      vehicleState.car.z = p.z;
      vehicleState.car.h = p.h;
      if (isActive) { worldState.px = p.x; worldState.pz = p.z; worldState.heading = p.h; }
      stuck.current.t0 = 0;
      carSafety.relocations++;
      carSafety.last = `${why} -> ${p.x.toFixed(1)},${p.z.toFixed(1)}`;
    };

    if (carSummon.pending) {
      carSummon.pending = false;
      dyn.current = newDynState(); // a reset / mechanic call also repairs the car
      placeAt(carSummon.x, carSummon.z, carSummon.h, "summon", carSummon.raw);
      carSummon.raw = false;
      return;
    }

    // start spawn (fresh game or a saved position): once the world is up,
    // make sure the car isn't parked inside / against a collider
    if (!spawnChecked.current && isReady()) {
      spawnChecked.current = true;
      carSafety.spawnChecked = true;
      const t0 = body.translation();
      if (!isClear(world, t0.x, t0.z, car.current.h, 6, collider)) {
        dyn.current = newDynState();
        placeAt(t0.x, t0.z, car.current.h, "spawn");
        return;
      }
    }

    // club door teleport (enter/exit VENU) — see lib/club.ts
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

    // tank-shell destroy (lib/vehicleDestroy.ts, components/TankCombat.tsx):
    // stop, stash out of view, force the player out on foot if they were
    // driving it, then respawn fresh once the burn duration elapses. The
    // burning-wreck visual itself lives in TankCombat.tsx, not here — this
    // component just needs to get the real car out of the way and back.
    if (carDestroyRequest.pending) {
      carDestroyRequest.pending = false;
      destroyedUntil.current = state.clock.elapsedTime + BURN_DURATION;
      car.current.speed = 0;
      car.current.vLat = 0;
      body.setTranslation({ x: vehicleState.car.x, y: -200, z: vehicleState.car.z }, true);
      if (isActive) {
        requestPlayerTeleport(vehicleState.car.x, vehicleState.car.z, car.current.h, groundYAt(vehicleState.car.x, vehicleState.car.z) + 1);
        useHudStore.getState().setActive("foot");
        useHudStore.getState().showMsg("VEHICLE DESTROYED");
      }
      return;
    }
    if (destroyedUntil.current > 0) {
      if (state.clock.elapsedTime < destroyedUntil.current) return;
      destroyedUntil.current = 0;
      body.setTranslation({ x: CAR_RESPAWN.x, y: groundYAt(CAR_RESPAWN.x, CAR_RESPAWN.z) + RIDE_HEIGHT, z: CAR_RESPAWN.z }, true);
      car.current.h = CAR_RESPAWN.h;
      car.current.speed = 0;
      car.current.vLat = 0;
      vehicleState.car.x = CAR_RESPAWN.x;
      vehicleState.car.z = CAR_RESPAWN.z;
      vehicleState.car.h = CAR_RESPAWN.h;
      return;
    }

    // NaN guard: one bad frame must never propagate into the body/camera
    const cs = car.current;
    if (!Number.isFinite(cs.h) || !Number.isFinite(cs.speed) || !Number.isFinite(cs.vLat) || !Number.isFinite(cs.steerAng)) {
      cs.h = Number.isFinite(cs.h) ? cs.h : 0;
      cs.speed = 0; cs.vLat = 0; cs.steerAng = 0;
    }
    if (!Number.isFinite(fallSpeed.current)) fallSpeed.current = 0;

    const k = keys.current;
    // analog touch steering (components/TouchControls.tsx) when the thumb is on
    // the pad, otherwise the plain digital left/right keys
    const steer = isActive ? (k.steerAxis !== 0 ? k.steerAxis : (k.left ? 1 : 0) - (k.right ? 1 : 0)) : 0;

    // nitro: SHIFT+forward burns fuel for extra thrust and a raised top speed —
    // same constants as the original (10s tank, +150km/h, drains 1:1, refills at half rate)
    const wantNitro = isActive && k.forward && k.boost;
    if (nitroFuel.current <= 0) nitroLocked.current = true;
    else if (nitroFuel.current >= NITRO_MAX) nitroLocked.current = false;
    const nitroOn = wantNitro && !nitroLocked.current && nitroFuel.current > 0;
    nitroFuel.current = nitroOn
      ? Math.max(0, nitroFuel.current - d)
      : Math.min(NITRO_MAX, nitroFuel.current + d * 0.5);
    if (isActive) useHudStore.getState().setNitro(nitroFuel.current / NITRO_MAX, nitroOn);

    // v1.6: tyre/suspension/gearbox model (lib/vehicleDynamics.ts)
    const carIdx = usePlayerCarStore.getState().index;
    // v1.9: garage upgrades (lib/career.ts) scale the physics spec; rev bumps on purchase
    const career = useCareer.getState();
    if (!specCache.current || specCache.current.index !== carIdx || specCache.current.rev !== career.rev) {
      const def = PLAYER_CARS[carIdx];
      specCache.current = { index: carIdx, rev: career.rev, spec: effectiveSpec(def?.phys, def ? career.upgradesFor(def.id) : STOCK) };
    }
    const hb = isActive && k.handbrake;
    // v1.8 fuel (lib/economy.ts): a dry tank gives no throttle; stolen cars don't count
    const fuelId = PLAYER_CARS[carIdx]?.id ?? "";
    const metered = isActive && !useHudStore.getState().stolenCar && !!fuelId;
    const hasFuel = !metered || fuelOf(fuelId) > 0;
    if (isActive && carRepair.pending) { carRepair.pending = false; dyn.current.damage = 0; }
    if (isActive && carRepair.set >= 0) { dyn.current.damage = carRepair.set; carRepair.set = -1; }
    rampSteer(car.current, steer, hb, d);
    const bt = body.translation();
    const { dx, dz } = stepDynamics(
      car.current,
      dyn.current,
      specCache.current.spec,
      {
        throttle: isActive && k.forward && hasFuel ? 1 : 0,
        noPower: !hasFuel,
        brake: isActive && k.back ? 1 : 0,
        steer: car.current.steerAng,
        handbrake: hb,
        nitro: nitroOn,
        park: !isActive,
      },
      d,
      bt.x,
      bt.z,
      groundYAt
    );
    if (isActive) engineTelemetry.active = true;
    if (metered && hasFuel) {
      const left = Math.max(0, fuelOf(fuelId) - burnRate(fuelId, dyn.current.throttle, car.current.speed) * d);
      fuelTank[fuelId] = left;
      if (left === 0) useHudStore.getState().showMsg("OUT OF FUEL — CALL THE FUEL VAN");
      persistEcon();
    }
    if (isActive) useHudStore.getState().setEngine(dyn.current.gear, dyn.current.rpm / specCache.current.spec.redline);
    if (visBody.current) {
      visBody.current.rotation.set(dyn.current.pitch, 0, dyn.current.roll);
      visBody.current.position.y = dyn.current.heave * 0.5;
    }
    // v1.6 wheels: roll by v/r, fronts yaw with the road-wheel angle
    if (isActive && playerWheels.rig) poseWheels(playerWheels.rig, car.current.speed, dyn.current.delta, d, hb, dyn.current.wheelspin * 0.8);

    // ground snap: small constant fall fed into the character controller, which
    // clamps it back to zero the instant it detects the floor (see enableSnapToGround)
    // parked & settled: skip the character-controller sweep entirely (every
    // parked vehicle used to shape-cast against the world every frame)
    if (!isActive && Math.abs(car.current.speed) < 0.02 && Math.abs(car.current.vLat) < 0.02 && restFrames.current > 30) return;
    fallSpeed.current = Math.max(-60, fallSpeed.current + GRAVITY_PULL * d);
    // EXCLUDE_DYNAMIC: props (components/Props.tsx) are the only dynamic bodies
    // in the game — skipping them from the sweep means the car's trajectory
    // never slides/stops on a cone, it just plows through while the solver
    // (unaffected by this query filter) still shoves the prop out of the way.
    // filterGroups=VEHICLE_SWEEP_GROUPS on the sweep itself, not just the collider's
    // own collisionGroups tag — see Player.tsx's computeColliderMovement for
    // why the tag alone doesn't make the character-controller query skip
    // VEHICLE_ONLY colliders (airport gate gap, Airport.tsx). The extra
    // vehicle-body bit (vs. plain PLAYER_GROUPS) is what lets WATER_BOUNDARY
    // (Marina.tsx) stop the car at the water's edge without also blocking
    // the on-foot player from walking onto the dock. VEHICLE_SWEEP_GROUPS
    // (not VEHICLE_BODY_GROUPS) additionally excludes the on-foot player from
    // this query — see lib/collisionGroups.ts for why a parked car's own
    // sweep otherwise pushes itself away from a player who walks into it.
    controller.computeColliderMovement(collider, { x: dx, y: fallSpeed.current * d, z: dz }, QueryFilterFlags.EXCLUDE_DYNAMIC, VEHICLE_SWEEP_GROUPS);
    const grounded = controller.computedGrounded();
    if (grounded) fallSpeed.current = 0;
    restFrames.current = !isActive && grounded && Math.abs(car.current.speed) < 0.02 ? restFrames.current + 1 : 0;
    const movement = controller.computedMovement();
    // #36 fix — the actual measured cause of the reported high-speed camera
    // judder: real repro data (sustained nitro runs, ~1000+ sampled frames,
    // logged speed/grounded/y/x/z) showed computedGrounded() flickering false
    // for 2-3 frames at moderate-high speed (confirmed at both ~45 and ~33
    // m/s, in both cases a few units past a chunk boundary — CELL=100 in
    // City.tsx), with movement.y spiking +0.13..+0.28 in a single frame
    // before self-correcting back to ~1.0 two frames later. This is NOT the
    // "sweep tunnels through a thin collider at 200+ km/h" mechanism
    // lib/marina.ts's clampFromWater comment describes (sweep distance at
    // the moment of the glitch was only ~2.2-2.9 units, an ordinary car-
    // length, and driving well past 200 km/h for 12+ seconds elsewhere
    // produced zero glitches) — it reads instead as Rapier's snap-to-ground
    // briefly detecting a higher/misaligned ground candidate right at a
    // chunk seam. The fix targets the actual physical impossibility rather
    // than the seam geometry itself (which would need per-chunk collider
    // work to track down exactly): this game NEVER requests upward Y motion
    // for a car — fallSpeed only ever accumulates <=0 via GRAVITY_PULL, so
    // the sweep's own y input above is always <=0. Any resulting
    // movement.y beyond a small ground-snap tolerance is therefore
    // necessarily a transient KCC glitch, not legitimate physics — clamping
    // it here fixes the visible pop at its source instead of trying to
    // paper over it in the chase-cam lerp.
    if (movement.y > 0.06) movement.y = 0.06;
    const preHitSpeed = Math.abs(car.current.speed);
    // hard hit: the sweep ate most of the move (wall, building, traffic car) —
    // bleed the speed off instead of ramming the obstacle at full speed every
    // frame (which kept two kinematic bodies pressed into each other)
    {
      const want = Math.hypot(dx, dz);
      const got = Math.hypot(movement.x, movement.z);
      if (want > 0.02 && got < want * 0.5) {
        car.current.speed *= Math.max(0.15, got / want);
        car.current.vLat *= 0.5;
        dyn.current.r *= 0.3;
        // simple damage: speed lost in the hit (lib/vehicleDynamics.ts applyImpact)
        if (isActive) {
          const before = dyn.current.damage;
          const after = applyImpact(dyn.current, preHitSpeed - Math.abs(car.current.speed));
          if (Math.floor(after * 10) > Math.floor(before * 10)) useHudStore.getState().showMsg(`DAMAGE ${Math.round(after * 100)}%`);
        }
      }
    }

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };
    // hard backstop, independent of the WATER_BOUNDARY collider — see
    // lib/marina.ts's clampFromWater for why the collider alone isn't
    // trusted at nitro speed.
    clampFromWater(nextPos);

    // drowning safety net: the shore wall (Marina.tsx) keeps this unreachable
    // in normal play, but respawn at POLICE HARBOR instead of leaving the car
    // falling forever if it ever ends up past the coastline. Exempt I-94's
    // bridge/FORT NEON's platform (lib/marina.ts's isOnBridgeOrBase) — both
    // real, elevated structures well past SHORE_X that this x-only check
    // can't otherwise tell apart from open water.
    if (nextPos.x >= SHORE_X && !isOnBridgeOrBase(nextPos)) {
      drownTime.current += d;
      if (drownTime.current > DROWN_LIMIT) {
        drownTime.current = 0;
        body.setTranslation({ x: DROWN_RESPAWN.x, y: RIDE_HEIGHT, z: DROWN_RESPAWN.z }, true);
        car.current.h = DROWN_RESPAWN.h;
        car.current.speed = 0;
        car.current.vLat = 0;
        fallSpeed.current = 0;
        vehicleState.car.x = DROWN_RESPAWN.x;
        vehicleState.car.z = DROWN_RESPAWN.z;
        vehicleState.car.h = DROWN_RESPAWN.h;
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
      body.setTranslation({ x: nextPos.x, y: RIDE_HEIGHT, z: nextPos.z }, true);
      fallSpeed.current = 0;
      car.current.speed = 0;
      return;
    }


    // v1.6.1 auto-unstuck: GAS (or reverse) held for STUCK_SECONDS of game
    // time while the car is crawling (<0.6 m/s, e.g. the sweep keeps eating
    // the move) and has gone < 0.75 m — then hop/reposition to a clear spot
    if (isActive && hasFuel && (k.forward || k.back) && !k.handbrake && Math.abs(car.current.speed) < 0.6) {
      const sk = stuck.current;
      if (sk.t0 === 0 || Math.hypot(nextPos.x - sk.x, nextPos.z - sk.z) > 0.75) { sk.t0 = 1e-6; sk.x = nextPos.x; sk.z = nextPos.z; }
      else if ((sk.t0 += d) > STUCK_SECONDS) {
        carSafety.unstucks++;
        const dmg = dyn.current.damage;
        dyn.current = newDynState();
        dyn.current.damage = Math.min(dmg, 0.5);
        // first try a short hop forward/back of where it is, else the nearest clear spot
        const dir = k.back && !k.forward ? -1 : 1;
        placeAt(nextPos.x + Math.sin(car.current.h) * 3 * dir, nextPos.z + Math.cos(car.current.h) * 3 * dir, car.current.h, "unstuck");
        useHudStore.getState().showMsg("UNSTUCK");
        return;
      }
    } else stuck.current.t0 = 0;

    body.setNextKinematicTranslation(nextPos);

    if (isActive) {
      checkCrashDebris(crashCooldown, d, { x: dx, z: dz }, { x: movement.x, z: movement.z }, preHitSpeed, nextPos, car.current.h);
      // Pedestrians.tsx set this the instant it ragdolled someone under THIS
      // car this frame — only the active vehicle can have caused it, since
      // the hit-test runs against worldState (the active vehicle's own
      // position). See lib/pedestrianHit.ts for why this can't just be a
      // direct call between the two components.
      const hitSlow = consumePedestrianHitSlowdown();
      if (hitSlow !== null) car.current.speed *= hitSlow;
    }

    const q = tmpQuat().setFromAxisAngle(AXIS_Y, car.current.h);
    body.setNextKinematicRotation(q);

    vehicleState.car.x = nextPos.x;
    vehicleState.car.y = nextPos.y;
    vehicleState.car.z = nextPos.z;
    vehicleState.car.h = car.current.h;
    vehicleState.car.speed = car.current.speed;
    vehicleState.car.vLat = car.current.vLat;

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
      // cockpit eye = the current car's driver seat (lib/playerCar.ts cockpit.eye)
      ...cockpitCameraArgs(PLAYER_CARS[usePlayerCarStore.getState().index]),
    });

    // true ground speed, not just the forward component — Math.abs(speed)
    // alone under-reads during a drift/powerslide, where a real chunk of the
    // car's motion is sideways (vLat) rather than forward. See carPhysics.ts.
    useHudStore.getState().setHud(Math.round(Math.hypot(car.current.speed, car.current.vLat) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[save?.x ?? 0, groundYAt(save?.x ?? 0, save?.z ?? 0) + RIDE_HEIGHT, save?.z ?? 0]}
    >
      {/* Dropped so the collider's BOTTOM face lands on the tyre contact patch
          rather than on the mesh origin. Centred, snapToGround parked the
          chassis at half the box height (0.65) and buried the car 0.33m. */}
      {/* VEHICLE_BODY_GROUPS (not the default collide-with-everything) so this,
          the player's own car, passes through VEHICLE_ONLY colliders like
          the airport gate gap (Airport.tsx) that stop Traffic/PoliceCar —
          same trick Player.tsx uses on foot — while still getting stopped by
          WATER_BOUNDARY (Marina.tsx) at the water's edge, which the plain
          PLAYER_GROUPS bit Player.tsx uses does NOT carry. */}
      <CuboidCollider
        ref={colliderRef}
        args={[carBox.x / 2, carBox.y / 2, carBox.z / 2]}
        position={[0, carBox.y / 2 - RIDE_HEIGHT, 0]}
        collisionGroups={VEHICLE_BODY_GROUPS}
      />
      {/* keyed on the stolen paint so the mesh remounts when you take over a
          traffic car — CarMesh pins colour/style at mount (useState), so a
          prop change alone would not repaint an already-mounted body */}
      {/* suspension pose (pitch / roll / heave) from lib/vehicleDynamics.ts */}
      <group ref={visBody}>
        <StolenAwareCarMesh />
      </group>
      {/* cockpit interior (dash/wheel/gauges) — only ever visible in camMode
          1, gated per-frame inside CarInterior itself; see cameraRig.ts's
          camMode===1 branch for the eye position this is anchored to */}
      <CarInterior carRef={car} />
    </RigidBody>
  );
}

// Supercar paint options — deep metallics plus a few loud hero colours, the
// palette an exotic actually ships in, not the grey/navy fleet the old sedan
// silhouette used.
const SEDAN_COLORS = [
  "#d81f26", // rosso
  "#f2b100", // giallo
  "#1d5fd8", // blu
  "#16171b", // nero
  "#e8eaee", // bianco
  "#1f9e6e", // verde
  "#f26a1b", // arancio
  "#7b2ff2", // viola
  "#8f959f", // grigio
];

// The player's sedan wears whatever it was last stolen as (lib/steal.ts), so
// the car you drive away in looks like the one you walked up to. Held in the
// HUD store rather than a mutable singleton because a repaint is one of the
// few things here that legitimately wants a re-render — and it's isolated in
// this leaf so a steal never re-renders the drive rig above it.
function StolenAwareCarMesh() {
  const stolen = useHudStore((s) => s.stolenCar);
  // Headlights.tsx deliberately drives the shared HEADLIGHT/TAILLIGHT/BEAM
  // materials off the day/night cycle only, not the player's L toggle — an
  // NPC three streets away shouldn't go dark because he flicked it. But that
  // means the player's OWN lamp fixtures/ground pool were always using those
  // same shared materials regardless of lightMode, so setting L to OFF killed
  // the actual SpotLight beam but left the lamp meshes glowing at night. lit
  // here swaps this one car over to the static "off" materials when OFF.
  const lit = useHudStore((s) => s.lightMode) !== 2;
  return (
    // Toshkent Drive: the player always drives one of their own GLB cars;
    // the procedural supercar only shows while the model streams in.
    <Suspense fallback={<CarMesh key={stolen ? `${stolen.color}:${stolen.style}` : "own"} color={stolen?.color} style={stolen?.style} lit={lit} />}>
      <PlayerGlbCar />
    </Suspense>
  );
}

// The whole silhouette now lives in components/SupercarBody.tsx (shared with
// PoliceCar.tsx); this just picks paint + roofline for one instance.
export function CarMesh({
  color,
  style,
  detail = "high",
  lit = true,
}: { color?: string; style?: CarStyle; detail?: Detail; lit?: boolean } = {}) {
  // random-once-at-mount, not a memo: neither value changes after mount for
  // any given instance, and useState's lazy initializer is the sanctioned
  // place for a one-time impure value (Math.random) — a plain useMemo
  // re-running is not guaranteed not to happen more than once.
  // Both fall back to a roll only when the caller doesn't pin them; Traffic.tsx
  // and the stolen-car path below both pin, so their cars are stable.
  const [bodyColor] = useState(() => color ?? SEDAN_COLORS[Math.floor(Math.random() * SEDAN_COLORS.length)]);
  const [ownStyle] = useState(() => styleFor(Math.random() * 300));
  return <SupercarBody color={color ?? bodyColor} style={style ?? ownStyle} detail={detail} lit={lit} />;
}
