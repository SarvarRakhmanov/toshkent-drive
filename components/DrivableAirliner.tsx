"use client";

import { useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepFlight, AIRLINER_HANDLING, type FlightState } from "@/lib/flightPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore, type AirlinerId } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { AirlinerMesh } from "@/components/Airliner";
import { AirlinerCockpit } from "@/components/AirlinerCockpit";
import { roofHeightAt } from "@/lib/buildings";

// Any statically parked wide-body the player can walk up to and fly — same
// mount-by-E, kinematic-position rig as components/Plane.tsx and
// Helicopter.tsx, generalized over `id` so one component drives every gate
// jet plus the cargo freighter (see components/Airport.tsx's ParkedStand /
// cargo-apron call sites, and lib/vehicleState.ts's airliner1/2/3/Cargo
// entries for their parked positions). This is what makes "no matter which
// bay or which side" literally true: every parked airframe on the field
// except the broken one runs through this same component.
//
// The broken jet (components/AirportLife.tsx's BrokenJet) deliberately has
// no counterpart here — no vehicleState entry, no mount trigger, nothing to
// fly. It's the one airframe that stays grounded forever, wing off, under
// repair.
export function DrivableAirliner({ id, liveryColor, cargo }: { id: AirlinerId; liveryColor: string; cargo?: boolean }) {
  const bodyRef = useRef<RapierRigidBody>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const base = vehicleState[id];
  const [save] = useState(() => loadSave()?.vehicles[id] ?? null);
  const fs = useRef<FlightState>({ h: save?.h ?? base.h, pitch: 0, roll: 0, speed: 0, vy: 0 });
  const nitro = useRef(initNitroFuel());
  const pos = useRef({ x: save?.x ?? base.x, z: save?.z ?? base.z, y: AIRLINER_HANDLING.groundClearance });
  const camPos = useRef(
    new THREE.Vector3((save?.x ?? base.x) - 26, AIRLINER_HANDLING.groundClearance + 12, (save?.z ?? base.z) - 26)
  );
  const camLook = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === id;

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
      ? { ...AIRLINER_HANDLING, accel: AIRLINER_HANDLING.accel * NITRO_ACCEL_MULT, maxSpeed: AIRLINER_HANDLING.maxSpeed + NITRO_BOOST }
      : AIRLINER_HANDLING;
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
      // AIRLINER_LEN=58 nose-to-tail — the shared 9.5/4.2 chase default
      // (sized for a ~4.6m car) puts the camera inside the fuselage; clear
      // the ~28m tail with real margin instead.
      chaseDist: 48,
      chaseHeight: 18,
      // cockpit mode (camMode===1): flight deck sits ~21m ahead of the
      // fuselage centre and well above it, nothing like the sedan-shaped
      // default this falls back to otherwise — see the captain Seat/Yoke in
      // AirlinerCockpit.tsx. Seat backrest spans local z~[20.45,20.59],
      // panel sits at z=21.3 — the original 22 put the eye PAST the panel
      // (looking back through/into its own mesh, the flat-grey-wash bug),
      // same root cause as components/Plane.tsx's identical fix. 20.95
      // clears the seat and sits short of the panel.
      cockpitEyeHeight: 1.9,
      cockpitForward: -0.9,
      cockpitAhead: 20.95,
      // shared cameraRig default looks 30 units ahead — miles past this
      // flight deck, producing an almost-level glance that skips the panel
      // entirely. Look AT it instead: a near target + a real downward drop.
      cockpitLookAhead: 0.5,
      cockpitLookDrop: 1.3,
    });

    const grounded = pos.current.y <= groundY + AIRLINER_HANDLING.groundClearance + 0.02;
    useHudStore.getState().setHud(Math.round(Math.abs(fs.current.speed) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[base.x, AIRLINER_HANDLING.groundClearance, base.z]}
    >
      <AirlinerMesh liveryColor={liveryColor} cargo={cargo} />
      <AirlinerCockpit fs={fs} pos={pos} />
    </RigidBody>
  );
}
