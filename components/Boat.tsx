"use client";

import { useRef, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepCarPhysics, BOAT_HANDLING, type CarState } from "@/lib/carPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { WATER_LEVEL } from "@/components/Water";
import { pierPush, clampToWater, LAND_EDGE_X } from "@/lib/marina";
import { BoatMirrors } from "@/components/BoatMirrors";

// A hull has no floor to snap to, so unlike Car.tsx this doesn't use Rapier's
// KinematicCharacterController at all — no per-frame collider queries, so none
// of the reentrancy trap documented in SUMMARY.md applies here. Position is
// just the same ported arcade math (this time with BOAT_HANDLING) integrated
// directly, plus a sine bob for the "floating" feel. It's still a Rapier
// kinematic RigidBody (not a bare mesh) so it's ready to collide with a dock
// or another boat once that's ported — see SUMMARY.md, Next up.
//
// Parameterized over `kind`/`spawn` so Game.tsx can mount three of these (the
// original single sea sprite plus two more moored at EAST MARINA's dock,
// lib/vehicleState.ts's boat2/boat3) instead of duplicating this whole file —
// a "boat lot" you can walk down and pick a hull from, not just one boat out
// at sea. Defaults match the original single-boat spawn exactly.
export function Boat({
  kind = "boat",
  spawn = { x: 595, z: 0, h: Math.PI },
}: {
  kind?: VehicleKind;
  spawn?: { x: number; z: number; h: number };
} = {}) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  // A save with x on dry land (e.g. an old/corrupted entry from before the
  // boat's default spawn matched the water) would otherwise beach the hull
  // right at the player's spawn — reject it and fall back to the dock instead
  // of trusting it blindly, same call the drowning respawn below makes.
  const [save] = useState(() => {
    const s = loadSave()?.vehicles[kind] ?? null;
    return s && s.x >= LAND_EDGE_X ? s : null;
  });
  const boat = useRef<CarState>({ h: save?.h ?? spawn.h, speed: 0, vLat: 0, steerAng: 0 });
  const nitro = useRef(initNitroFuel());
  const pos = useRef({ x: save?.x ?? spawn.x, z: save?.z ?? spawn.z });
  const camPos = useRef(new THREE.Vector3(30, 5, -10));
  const camLook = useRef(new THREE.Vector3());

  const hullSize = useMemo(() => new THREE.Vector3(2.2, 1, 5), []);

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === kind;

    const k = keys.current;
    const steer = isActive ? (k.left ? 1 : 0) - (k.right ? 1 : 0) : 0;
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? { ...BOAT_HANDLING, accel: BOAT_HANDLING.accel * NITRO_ACCEL_MULT, max: BOAT_HANDLING.max + NITRO_BOOST }
      : BOAT_HANDLING;
    if (isActive) useHudStore.getState().setNitro(nitro.current.fuel / NITRO_MAX, nitroOn);

    const { dx, dz } = stepCarPhysics(
      boat.current,
      {
        forward: isActive && k.forward,
        back: isActive && k.back,
        steer,
        handbrake: false,
      },
      handling,
      d
    );

    pos.current.x += dx;
    pos.current.z += dz;
    // keep boat in water — mirror-image backstop of clampFromWater (which stops
    // LAND vehicles crossing onto water); see lib/marina.ts's clampToWater for
    // why this is more than a raw x-threshold (the PIER_Z-band exemption).
    clampToWater(pos.current, 5);
    // hull-only dock collision — Boat.tsx never queries Rapier colliders (see
    // the class comment above), so the dock's solid RigidBody (Marina.tsx)
    // doesn't stop it; ported pierPush() does, same as the original
    const pushed = pierPush(pos.current.x, pos.current.z, 2.0);
    pos.current.x = pushed.x;
    pos.current.z = pushed.z;
    const bob = Math.sin(state.clock.elapsedTime * 1.7 + pos.current.x * 0.05) * 0.07;
    const y = WATER_LEVEL + bob;

    body.setNextKinematicTranslation({ x: pos.current.x, y, z: pos.current.z });
    const heel = clamp(boat.current.vLat / 9, -1, 1) * 0.16;
    const q = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), boat.current.h)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -heel));
    body.setNextKinematicRotation(q);

    vehicleState[kind].x = pos.current.x;
    vehicleState[kind].z = pos.current.z;
    vehicleState[kind].h = boat.current.h;
    vehicleState[kind].speed = boat.current.speed;
    vehicleState[kind].vLat = boat.current.vLat;

    if (!isActive) return;
    worldState.px = pos.current.x;
    worldState.pz = pos.current.z;
    worldState.heading = boat.current.h;

    applyCameraRig({
      camera,
      camPos: camPos.current,
      camLook: camLook.current,
      tx: pos.current.x,
      ty: y,
      tz: pos.current.z,
      th: boat.current.h,
      isBike: false,
      camMode: useHudStore.getState().camMode,
      time: state.clock.elapsedTime,
      dt: d,
      speedMs: Math.abs(boat.current.speed),
    });

    // true ground speed including lateral slide — a hull carries far more
    // sideways momentum through a turn than a tyred vehicle (BOAT_HANDLING's
    // low grip, see carPhysics.ts), so this under-read the worst of any
    // vehicle. See Car.tsx's same fix.
    useHudStore.getState().setHud(Math.round(Math.hypot(boat.current.speed, boat.current.vLat) * 3.6), true);
  });

  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[save?.x ?? spawn.x, WATER_LEVEL, save?.z ?? spawn.z]}>
      <mesh castShadow>
        <boxGeometry args={[hullSize.x, hullSize.y, hullSize.z]} />
        <meshStandardMaterial color="#e8e2d0" metalness={0.35} roughness={0.34} />
      </mesh>
      <mesh position={[0, hullSize.y / 2 + 0.4, -0.6]}>
        <boxGeometry args={[hullSize.x * 0.7, 0.8, 1.6]} />
        <meshStandardMaterial color="#f2f0ea" roughness={0.5} />
      </mesh>
      {/* windscreen — the boat-specific glassMat (index.html line 5492), distinct from the
          car glassMat: no envMap on this one in the original, so nothing to wire up */}
      <mesh position={[0, hullSize.y / 2 + 0.75, 0.25]} rotation={[-0.22, 0, 0]}>
        <boxGeometry args={[hullSize.x * 0.75, 0.5, 0.08]} />
        <meshStandardMaterial color="#0a1a26" metalness={0.9} roughness={0.08} transparent opacity={0.55} />
      </mesh>
      <BoatMirrors y={hullSize.y / 2 + 0.95} z={0.7} />
      {/* bow nav light — emissive, trips the bloom pass */}
      <mesh position={[0, hullSize.y / 2 + 0.3, hullSize.z / 2 - 0.3]}>
        <sphereGeometry args={[0.11, 8, 8]} />
        <meshBasicMaterial color="#ff4d4d" />
      </mesh>
    </RigidBody>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
