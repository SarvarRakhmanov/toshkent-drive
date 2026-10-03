"use client";

import { useRef, useMemo, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { stepFlight, PLANE_HANDLING, type FlightState } from "@/lib/flightPhysics";
import { NITRO_MAX, NITRO_BOOST, NITRO_ACCEL_MULT, initNitroFuel, stepNitroFuel } from "@/lib/nitro";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { loadSave } from "@/lib/saveGame";
import { applyCameraRig } from "@/lib/cameraRig";
import { roofHeightAt } from "@/lib/buildings";
import { PlaneCockpit } from "@/components/PlaneCockpit";

// Small prop plane, parked on REGIONAL AIRPORT's apron (components/Airport.tsx)
// and mounted by walking up + E, same as PatrolBoat.tsx — kinematic body,
// direct position integration, no character controller (nothing here ever
// touches the ground collision mesh the way a car does; lib/flightPhysics.ts's
// own ground-clearance floor is what keeps it from clipping through terrain).
//
// Controls while active: W/S throttle up/down, A/D yaw left/right, SPACE
// climb, SHIFT descend — reusing useKeyboard()'s existing forward/back/left/
// right/handbrake/boost fields (no new input plumbing). Needs forward speed
// (PLANE_HANDLING.liftMinSpeed) to hold altitude — drops below that with
// nothing held and it sinks, same as a real stall but linear.
export function Plane() {
  const bodyRef = useRef<RapierRigidBody>(null);
  const propRef = useRef<THREE.Group>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const [save] = useState(() => loadSave()?.vehicles.plane ?? null);
  const fs = useRef<FlightState>({ h: save?.h ?? vehicleState.plane.h, pitch: 0, roll: 0, speed: 0, vy: 0 });
  const nitro = useRef(initNitroFuel());
  const pos = useRef({
    x: save?.x ?? vehicleState.plane.x,
    z: save?.z ?? vehicleState.plane.z,
    y: PLANE_HANDLING.groundClearance,
  });
  const camPos = useRef(
    new THREE.Vector3((save?.x ?? vehicleState.plane.x) - 10, PLANE_HANDLING.groundClearance + 5, (save?.z ?? vehicleState.plane.z) - 10)
  );
  const camLook = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    const body = bodyRef.current;
    if (!body) return;
    const d = Math.min(dt, 0.05);
    const isActive = useHudStore.getState().active === "plane";

    const k = keys.current;
    const yaw = isActive ? (k.right ? 1 : 0) - (k.left ? 1 : 0) : 0;
    // only treat a roof as the floor once already close to it (margin below)
    // — otherwise flying at low altitude past a tall building's footprint
    // would snap the plane straight up onto its roof instead of just passing by
    const roof = roofHeightAt(pos.current.x, pos.current.z);
    const groundY = pos.current.y >= roof - 5 ? roof : 0;
    // nitro: SHIFT+forward, same trigger/fuel rig as every land vehicle
    // (lib/nitro.ts) — SHIFT already doubles as "descend" here, so boosting
    // while diving drains fuel too; not worth a second key just for flight.
    const wantNitro = isActive && k.forward && k.boost;
    const nitroOn = stepNitroFuel(nitro.current, wantNitro, d);
    const handling = nitroOn
      ? { ...PLANE_HANDLING, accel: PLANE_HANDLING.accel * NITRO_ACCEL_MULT, maxSpeed: PLANE_HANDLING.maxSpeed + NITRO_BOOST }
      : PLANE_HANDLING;
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

    // idle windmill + speed-scaled spin — cosmetic, no gameplay effect
    if (propRef.current) propRef.current.rotation.z += (6 + Math.abs(fs.current.speed) * 2.2) * d;

    vehicleState.plane.x = pos.current.x;
    vehicleState.plane.z = pos.current.z;
    vehicleState.plane.h = fs.current.h;
    vehicleState.plane.y = pos.current.y;

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
      // single centred seat (no lateral offset needed) sitting well forward,
      // under the canopy bubble — see components/PlaneCockpit.tsx's own
      // coordinate notes for how these line up with its seat/panel geometry.
      // NOTE: pulling the eye any closer to the panel (z=1.0) than this was
      // tried and made things worse (a flat, wrongly-lit wash filling the
      // whole frame — almost certainly an eye/panel/canopy-glass proximity
      // issue still not fully root-caused). This is the safe, known-good
      // configuration: prop/cowling/struts read correctly through the
      // windshield, panel is partially visible at the bottom edge. A
      // dead-center panel view needs a fresh, focused pass — don't just
      // nudge cockpitAhead further without re-deriving the geometry.
      cockpitForward: 0,
      cockpitEyeHeight: 0.32,
      cockpitAhead: 0.85,
    });

    const grounded = pos.current.y <= groundY + PLANE_HANDLING.groundClearance + 0.02;
    useHudStore.getState().setHud(Math.round(Math.abs(fs.current.speed) * 3.6), grounded);
  });

  return (
    <RigidBody
      ref={bodyRef}
      type="kinematicPosition"
      colliders={false}
      position={[vehicleState.plane.x, PLANE_HANDLING.groundClearance, vehicleState.plane.z]}
    >
      <PlaneMesh propRef={propRef} fsRef={fs} posRef={pos} />
    </RigidBody>
  );
}

const BODY_MAT = new THREE.MeshStandardMaterial({ color: "#e7ecf2", metalness: 0.55, roughness: 0.28 });
const STRIPE_MAT = new THREE.MeshStandardMaterial({ color: "#d8451f", metalness: 0.3, roughness: 0.4 });
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#23262d", metalness: 0.85, roughness: 0.3 });
// glass cockpit canopy — same idiom as SupercarBody.tsx's GLASS: transparent,
// high metalness, low roughness
const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: "#16212e",
  metalness: 0.9,
  roughness: 0.05,
  transparent: true,
  opacity: 0.6,
});
const TIRE_MAT = new THREE.MeshStandardMaterial({ color: "#121316", roughness: 0.92 });
const PROP_MAT = new THREE.MeshStandardMaterial({ color: "#1b1e25", metalness: 0.7, roughness: 0.3 });

function PlaneMesh({
  propRef,
  fsRef,
  posRef,
}: {
  propRef: React.RefObject<THREE.Group | null>;
  fsRef: React.RefObject<FlightState>;
  posRef: React.RefObject<{ x: number; z: number; y: number }>;
}) {
  const fusGeo = useMemo(() => new THREE.CylinderGeometry(0.5, 0.38, 4.6, 14).rotateX(Math.PI / 2), []);
  return (
    <group>
      {/* fuselage + nose/tail taper */}
      <mesh position={[0, 0, 0]} geometry={fusGeo} material={BODY_MAT} castShadow />
      <mesh position={[0, 0, 2.9]} rotation={[Math.PI / 2, 0, 0]} material={BODY_MAT} castShadow>
        <coneGeometry args={[0.5, 1.3, 14]} />
      </mesh>
      <mesh position={[0, 0, -2.95]} rotation={[-Math.PI / 2, 0, 0]} material={TRIM_MAT} castShadow>
        <coneGeometry args={[0.38, 1.1, 12]} />
      </mesh>
      {/* fuselage stripe */}
      <mesh position={[0, 0.02, 0.2]} material={STRIPE_MAT}>
        <boxGeometry args={[0.85, 0.16, 4.4]} />
      </mesh>

      {/* wings, mid-mounted through the fuselage */}
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 2.0, 0.05, 0.15]} material={BODY_MAT} castShadow>
          <boxGeometry args={[3.4, 0.14, 1.05]} />
        </mesh>
      ))}

      {/* tail: horizontal stabilizer + vertical fin */}
      <mesh position={[0, 0.05, -3.15]} material={BODY_MAT} castShadow>
        <boxGeometry args={[1.7, 0.1, 0.6]} />
      </mesh>
      <mesh position={[0, 0.55, -3.15]} material={STRIPE_MAT} castShadow>
        <boxGeometry args={[0.1, 1.0, 0.7]} />
      </mesh>

      {/* cockpit canopy */}
      <mesh position={[0, 0.55, 1.15]} scale={[0.85, 0.7, 1.3]} material={GLASS_MAT} castShadow>
        <sphereGeometry args={[0.42, 12, 10]} />
      </mesh>

      {/* single-seat interior: yoke/stick, instrument panel, seat + window
          framing — components/PlaneCockpit.tsx, only really seen through
          cockpit cam (camMode===1) but real geometry so it reads correctly
          through the tinted canopy from other views too */}
      <PlaneCockpit fsRef={fsRef} altRef={posRef} />

      {/* propeller: hub + two blades, spun in useFrame via propRef */}
      <group ref={propRef} position={[0, 0, 3.6]}>
        <mesh material={PROP_MAT}>
          <cylinderGeometry args={[0.08, 0.08, 0.25, 10]} />
        </mesh>
        {[0, Math.PI / 2].map((a) => (
          <mesh key={a} rotation={[0, 0, a]} material={PROP_MAT}>
            <boxGeometry args={[0.1, 1.5, 0.04]} />
          </mesh>
        ))}
      </group>

      {/* landing gear: nose wheel + two main gear, tyre + strut each. Group
          origin sits PLANE_HANDLING.groundClearance (0.95) above the ground
          when landed, fuselage skin is ~0.5 below that origin, so each strut
          only has to bridge the remaining ~0.45 down to the tyre's contact
          patch at local y = -groundClearance + tireRadius. */}
      <Gear x={0} z={2.1} attachY={-0.42} />
      <Gear x={0.85} z={-0.3} attachY={-0.46} />
      <Gear x={-0.85} z={-0.3} attachY={-0.46} />
    </group>
  );
}

const TIRE_R = 0.22;

function Gear({ x, z, attachY }: { x: number; z: number; attachY: number }) {
  const tireY = -PLANE_HANDLING.groundClearance + TIRE_R;
  const strutLen = Math.max(0.08, attachY - tireY);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, (attachY + tireY) / 2, 0]} material={TRIM_MAT}>
        <cylinderGeometry args={[0.035, 0.035, strutLen, 6]} />
      </mesh>
      <mesh position={[0, tireY, 0]} rotation={[Math.PI / 2, 0, 0]} material={TIRE_MAT} castShadow>
        <cylinderGeometry args={[TIRE_R, TIRE_R, 0.14, 14]} />
      </mesh>
    </group>
  );
}
