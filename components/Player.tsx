"use client";

import { useRef, useEffect, Suspense } from "react";
import { useThree } from "@react-three/fiber";
import { useFrame } from "@/lib/safeFrame";
import { RigidBody, CuboidCollider, useRapier, type RapierRigidBody, type RapierCollider } from "@react-three/rapier";
import { PLAYER_GROUPS } from "@/lib/collisionGroups";
import * as THREE from "three";
import { useKeyboard } from "@/lib/useKeyboard";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { applyCameraRig } from "@/lib/cameraRig";
import { cameraLook } from "@/lib/cameraLook";
import { playerTeleport } from "@/lib/playerTeleport";
import { SHORE_X, isOnBridgeOrBase, groundYAt } from "@/lib/marina";
import { requestFire } from "@/lib/tankShell";
import type { KinematicCharacterController } from "@dimforge/rapier3d-compat";
import { PlayerRobotMesh, playerLimbs } from "@/components/RobotModels";
import { BootHold } from "@/components/ReadyGate";

const DROWN_LIMIT = 2; // seconds in open water before respawn

// Ported from the original's on-foot tick() block: walk 4.5 m/s / sprint 9 m/s
// (SHIFT), accel/decel ramp (30 accelerating, 36 braking), jump vy=7.5 with
// asymmetric gravity (46 while rising and released early for a short hop, 20
// otherwise) — same numbers, just fed through Rapier's
// KinematicCharacterController (same one Car/Bike use) instead of the
// original's own collide()/py ballistic tracking.
//
// Steering is the one deliberate departure: the original used tank controls
// (A/D = `player.h += 2.6*dt`), which under a chase camera locked to that
// heading looked like the world swinging rather than the character turning.
// See the camera-relative block in useFrame.
//
// How fast he snaps to face a new input direction. Much quicker than the
// original's 2.6 rad/s because this is now a turn-to-face, not a steering rate.
const TURN_RATE = 11;
// How fast the chase camera drifts back behind him, and only while he's
// running roughly forward (see alignK below). Holding A or D alone leaves the
// camera where it is, so you watch him turn and run off sideways instead of
// the whole world swinging — which was the complaint with the original's
// tank controls.
const CAM_FOLLOW = 0.22;
const WALK_SPEED = 4.5;
const SPRINT_SPEED = 9;
const JUMP_VY = 7.5;
const GRAV_RISING_RELEASED = -46;
const GRAV_OTHER = -20;
// How fast a vehicle-bailout slide (lib/playerTeleport.ts's vx/vz, set by
// lib/player.ts on dismount) bleeds off — ground friction on a body that
// just hit the pavement running, not a walking-speed decel. At this rate a
// ~20 m/s eject (72 km/h) skids roughly v0/SLIDE_DRAG ≈ 5-6m before stopping.
const SLIDE_DRAG = 3.5;
// Below this eject speed, a dismount (parked/barely-moving vehicle) stays the
// original calm step-out — no tumble for stepping out of a car at walking pace.
const RAGDOLL_MIN_SPEED = 3;
// How long he lies flat after landing before standing back up and handing
// control back — Pedestrians.tsx's own ragdoll uses 4.5s + a full get-up
// check, but that's AI cosmetics; this is the actual player, so it's a beat,
// not a timeout.
const RAGDOLL_LIE_TIME = 0.6;
// Parachute: bailing out of a plane/helicopter (lib/player.ts's dismount,
// teleport.y = the aircraft's own altitude) dropped the player at full
// freefall gravity same as any other fall — no parachute existed anywhere
// (grep for "drift"/"skid"/"parachute" across the vehicle components turned
// up nothing). Auto-opens once falling fast enough this high above the
// ground BENEATH the player (lib/marina.ts's groundYAt, same ground query
// every land vehicle already uses) — a normal JUMP_VY hop never gets
// remotely close to this altitude, so ordinary jumping is untouched.
const CHUTE_OPEN_ALT = 18; // metres above ground
const CHUTE_CLOSE_ALT = 4; // auto-closes this close to the ground — the landing itself handles the rest
const CHUTE_DESCENT_VY = -3.5; // gentle canopy sink rate, vs. freefall's -16 clamp
// Handheld weapon (lib/armory.ts, components/GunStore.tsx) — same
// lib/tankShell.ts fireQueue Tank.tsx's F key already drains, just a
// human-scale muzzle point instead of Tank.tsx's BARREL_FORWARD/BARREL_UP.
const GUN_FIRE_COOLDOWN = 0.35; // seconds between shots — a sidearm, not the tank's 0.8s cannon
const GUN_MUZZLE_FORWARD = 0.6;
const GUN_MUZZLE_UP = 1.35;

const START = { x: -48, z: 20, h: Math.PI }; // near VENU, matches the original's player spawn

interface FootRagdoll {
  air: boolean; // still tumbling; false once landed and lying flat
  lieT: number; // seconds spent lying flat, counts up only once air is false
  spin: number; // rad/s applied to groupRef's rotation.x while air
}

export function Player() {
  const { world } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const groupRef = useRef<THREE.Group>(null);
  // v1.4: the on-foot body is "The Big Boss" robot (components/RobotModels.tsx),
  // one rigid mesh — the walk is procedural: rig bobs / sways / leans.
  const rig = useRef<THREE.Group>(null);
  const keys = useKeyboard();
  const { camera } = useThree();

  const foot = useRef({ h: START.h, speed: 0, vy: 0 });
  // world-space m/s left over from a vehicle bailout, decays via SLIDE_DRAG —
  // see the teleport-consumption block and the movement composition below
  const slide = useRef({ x: 0, z: 0 });
  // set on a hard vehicle bail (see teleport-consumption block below), null
  // the rest of the time — mirrors Pedestrians.tsx's own ragdoll field
  const ragdoll = useRef<FootRagdoll | null>(null);
  const chuteOpen = useRef(false);
  const chuteRef = useRef<THREE.Group>(null);
  const gunCooldown = useRef(0);
  // The chase camera's own yaw, tracked separately from the character's
  // heading so input can be read relative to where the camera is actually
  // looking. Vehicles keep using their own heading directly — this is on-foot
  // only.
  const camYaw = useRef(START.h);
  const walkPhase = useRef(0);
  const spaceWasDown = useRef(false);
  const groundedRef = useRef(true);
  const drownTime = useRef(0);
  const camPos = useRef(new THREE.Vector3(0, 3, -6));
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

  useFrame((state, dt) => {
    const body = bodyRef.current;
    const controller = controllerRef.current;
    const collider = colliderRef.current;
    if (!body || !controller || !collider || !groupRef.current) return;
    const isActive = useHudStore.getState().active === "foot";
    groupRef.current.visible = isActive;

    // vehicle dismount teleport (lib/player.ts) or club-door teleport (lib/club.ts)
    if (playerTeleport.pending) {
      playerTeleport.pending = false;
      body.setTranslation({ x: playerTeleport.x, y: playerTeleport.y, z: playerTeleport.z }, true);
      foot.current.h = playerTeleport.h;
      camYaw.current = playerTeleport.h; // snap, don't let the camera swing in from the old heading
      foot.current.speed = 0;
      slide.current.x = playerTeleport.vx;
      slide.current.z = playerTeleport.vz;
      // Hard bail: launch + tumble, same beat Pedestrians.tsx gives a struck
      // ped, just driven through the player's REAL collision-aware controller
      // (foot.current.vy/gravity) instead of that component's freehand mesh
      // sim — the player already has one, no need for a second physics path.
      const ejectSpeed = Math.hypot(playerTeleport.vx, playerTeleport.vz);
      if (ejectSpeed > RAGDOLL_MIN_SPEED) {
        const hard = ejectSpeed > 16; // ~58 km/h — same "fast" cut Pedestrians.tsx uses
        foot.current.vy = Math.min(10, (hard ? 5.5 : 3.2) + ejectSpeed * 0.15);
        ragdoll.current = { air: true, lieT: 0, spin: (Math.random() * 2 - 1) * (hard ? 10 : 4) };
      } else {
        foot.current.vy = 0;
        ragdoll.current = null;
      }
      groupRef.current.rotation.x = 0; // start upright; tumble accrues from here if ragdolling
      worldState.px = playerTeleport.x;
      worldState.pz = playerTeleport.z;
      worldState.heading = playerTeleport.h;
    }

    // Take the walking collider OUT of the world while riding. It used to stay
    // behind as an invisible obstacle standing wherever you mounted — mostly
    // unnoticed, because you approach a parked car from the side and end up
    // outside its 1.85x4.6 box. lib/steal.ts breaks that assumption: it moves
    // the car so its CENTRE lands on the NPC's, and the natural way to steal is
    // to stand in the lane and let the car brake for you, so the collider ends
    // up INSIDE the car. A character controller that begins a step already
    // penetrating resolves to ~zero movement — the car simply won't drive.
    // Dismount re-enables it, and player.ts's teleport has already placed the
    // body beside the vehicle by then.
    if (collider.isEnabled() !== isActive) collider.setEnabled(isActive);

    if (!isActive) return;
    const d = Math.min(dt, 0.05);
    const k = keys.current;
    const hud = useHudStore.getState();

    // Seated in a VIP lounge spot (lib/clubSeats.ts) — freeze movement/
    // physics entirely and just hold the exact seat pose every frame, same
    // "snap to a fixed transform" idiom as the ragdoll/teleport paths above,
    // just with no motion to integrate. E (seatAction) is the only way out.
    if (hud.seatedAt) {
      const seat = hud.seatedAt;
      foot.current.h = seat.ry;
      camYaw.current = seat.ry;
      foot.current.speed = 0;
      foot.current.vy = 0;
      ragdoll.current = null;
      const nextPos = { x: seat.x, y: seat.y, z: seat.z };
      body.setNextKinematicTranslation(nextPos);
      groupRef.current.rotation.x = 0;
      groupRef.current.rotation.y = seat.ry;
      worldState.px = nextPos.x;
      worldState.pz = nextPos.z;
      worldState.py = nextPos.y;
      worldState.heading = seat.ry;
      // Hip swings the thigh from hanging-down to horizontal-forward; knee
      // rotates the OPPOSITE way in its own (already-rotated) local frame,
      // which cancels the hip's rotation and brings the shin back to
      // hanging straight down from the knee — the actual L-shape a seated
      // pose needs, not achievable by rotating one rigid leg box.
      // sit: legs swing forward at the hips (thighs on the cushion), body
      // lowered so the hips sit on it, lean back a touch
      playerLimbs.sit = true;
      if (rig.current) {
        rig.current.position.set(0, -0.36, -0.1);
        rig.current.rotation.set(-0.12, 0, 0);
      }
      // Deliberately NOT applyCameraRig's chase mode here: chase parks the
      // camera chaseDist (9.5) BEHIND the target along -facing, but VIP
      // sofas sit close against the lounge's back wall (~3.5 units of
      // clearance) — that placed the camera outside the wall, looking back
      // through it at a black backface. A fixed shot from the room side
      // (along +facing, where the sofa always has open floor) can't ever
      // clip a wall no seat is placed facing into.
      const eyeX = seat.x + Math.sin(seat.ry) * 3.2;
      const eyeY = seat.y + 1.5;
      const eyeZ = seat.z + Math.cos(seat.ry) * 3.2;
      const lookY = seat.y + 1.1;
      camera.position.set(eyeX, eyeY, eyeZ);
      camera.lookAt(seat.x, lookY, seat.z);
      camPos.current.set(eyeX, eyeY, eyeZ);
      camLook.current.set(seat.x, lookY, seat.z);
      return;
    }

    // ragdoll tick: tumble while airborne, count the lying-flat stun once
    // landed, hand control back when it expires. Runs BEFORE the input read
    // below so a just-expired ragdoll releases control the same frame.
    if (ragdoll.current) {
      if (ragdoll.current.air) {
        groupRef.current.rotation.x += ragdoll.current.spin * d;
      } else {
        ragdoll.current.lieT += d;
        if (ragdoll.current.lieT > RAGDOLL_LIE_TIME) {
          ragdoll.current = null;
          groupRef.current.rotation.x = 0;
        }
      }
    }
    const ragdollActive = !!ragdoll.current;

    // Camera-relative movement, replacing the original's tank controls (its
    // on-foot block just did `player.h += 2.6*dt` on A/D). Turning in place
    // while the chase camera rigidly tracked that heading meant you only ever
    // saw the character's back, so pressing A/D read as the world swinging
    // rather than him turning. Now WASD names a direction on screen, he turns
    // to face it, and the camera holds still while he does.
    // Forced to 0 while ragdollActive — can't steer a tumble or walk off a
    // stun; hasInput/move naturally fall to false/0 below with no extra checks.
    const ix = ragdollActive ? 0 : (k.right ? 1 : 0) - (k.left ? 1 : 0);
    const iz = ragdollActive ? 0 : (k.forward ? 1 : 0) - (k.back ? 1 : 0);
    // named for the INPUT, not the speed — there's a separate `moving` further
    // down that means "actually travelling", used to drive the walk cycle
    const hasInput = ix !== 0 || iz !== 0;

    // Movement is relative to where the camera is actually pointing, which
    // includes whatever free-look the mouse is applying (lib/cameraLook.ts) —
    // so panning the view and pressing W walks him that way.
    const viewYaw = camYaw.current + cameraLook.yaw;

    if (hasInput) {
      // Screen-space -> world heading. With this build's convention
      // (dir = [sin h, cos h]) the camera's right vector is [-cos h, sin h],
      // which is heading viewYaw - PI/2 — hence the minus on the atan2.
      const desired = viewYaw - Math.atan2(ix, iz);
      // shortest way round, so turning from ~PI to ~-PI doesn't take the long lap
      const diff = Math.atan2(Math.sin(desired - foot.current.h), Math.cos(desired - foot.current.h));
      foot.current.h += clamp(diff, -TURN_RATE * d, TURN_RATE * d);
    }

    // He always walks the way he faces now, so there's no reverse gear on foot
    // — S turns him around instead of backing him up.
    const move = hasInput ? 1 : 0;
    const sprint = k.boost;
    const sp = sprint ? SPRINT_SPEED : WALK_SPEED;
    const moveStep = (move !== 0 ? 30 : 36) * d;
    foot.current.speed += clamp(move * sp - foot.current.speed, -moveStep, moveStep);

    // Camera eases back behind him only in proportion to how forward-ish the
    // input is: running forward re-centres it, strafing left/right doesn't
    // touch it. Without that gate, holding D would rotate the camera, which
    // would rotate what "right" means, and he'd spin on the spot forever.
    //
    // Frozen entirely while pointer lock is engaged, for the same reason:
    // if the base yaw chased him while free-look kept adding to it, holding
    // W mid-pan would walk him in circles. Frozen, he turns once to the
    // panned angle and then runs straight along it.
    const alignK = cameraLook.locked ? 0 : Math.max(0, iz);
    if (alignK > 0) {
      const camDiff = Math.atan2(Math.sin(foot.current.h - camYaw.current), Math.cos(foot.current.h - camYaw.current));
      camYaw.current += camDiff * (1 - Math.pow(CAM_FOLLOW, d)) * alignK;
    }

    // jump: Space edge-triggers, only from the ground; holding it through the
    // rise keeps full gravity (long jump), releasing early steepens it (short hop)
    // Also gated off ragdollActive — can't jump mid-tumble or the instant you land stunned.
    const spaceDown = k.handbrake;
    if (!ragdollActive && spaceDown && !spaceWasDown.current && groundedRef.current) foot.current.vy = JUMP_VY;
    spaceWasDown.current = spaceDown;

    // parachute: auto-deploy once falling fast, this high above the ground
    // directly beneath the player. Clears any in-progress ragdoll tumble —
    // a real jumper stops tumbling and hangs upright the instant the canopy
    // catches air, not mid-spin.
    const posNow = body.translation();
    const heightAG = posNow.y - groundYAt(posNow.x, posNow.z);
    if (!chuteOpen.current && foot.current.vy < -3 && heightAG > CHUTE_OPEN_ALT) {
      chuteOpen.current = true;
      ragdoll.current = null;
      groupRef.current.rotation.x = 0;
    } else if (chuteOpen.current && (groundedRef.current || heightAG < CHUTE_CLOSE_ALT)) {
      chuteOpen.current = false;
    }

    if (chuteOpen.current) {
      // ease toward a gentle canopy sink rate instead of freefall gravity —
      // same "ease toward a target" idiom lib/cameraRig.ts's speed-FOV widen uses
      foot.current.vy += (CHUTE_DESCENT_VY - foot.current.vy) * Math.min(1, 3 * d);
    } else {
      const gravity = foot.current.vy > 0 && !spaceDown ? GRAV_RISING_RELEASED : GRAV_OTHER;
      foot.current.vy = Math.max(foot.current.vy + gravity * d, -16);
    }
    if (chuteRef.current) chuteRef.current.visible = chuteOpen.current;

    // ground friction bleeding off any bail-out slide (see SLIDE_DRAG) — added
    // on top of, not instead of, the WASD walk so pressing a key mid-skid
    // steers rather than overriding; once it decays under a few cm/s this is
    // a no-op and normal walking is indistinguishable from before it existed
    slide.current.x *= Math.max(0, 1 - SLIDE_DRAG * d);
    slide.current.z *= Math.max(0, 1 - SLIDE_DRAG * d);
    if (Math.hypot(slide.current.x, slide.current.z) < 0.05) {
      slide.current.x = 0;
      slide.current.z = 0;
    }

    const dx = Math.sin(foot.current.h) * foot.current.speed * d + slide.current.x * d;
    const dz = Math.cos(foot.current.h) * foot.current.speed * d + slide.current.z * d;
    // filterGroups=PLAYER_GROUPS on the sweep itself: the collider's own
    // collisionGroups tag only governs contact-solving between overlapping
    // bodies, not this manual character-controller query — without passing
    // it here too, the sweep collides with everything regardless of the
    // collider's tag, defeating VEHICLE_ONLY colliders (airport gate gap,
    // Airport.tsx) that are meant to be invisible to the player.
    controller.computeColliderMovement(collider, { x: dx, y: foot.current.vy * d, z: dz }, undefined, PLAYER_GROUPS);
    const grounded = controller.computedGrounded();
    groundedRef.current = grounded;
    // landing out of a ragdoll launch: stop tumbling, snap to lying flat
    // (same convention Pedestrians.tsx uses), start the stun countdown
    if (ragdoll.current?.air && grounded && foot.current.vy <= 0) {
      ragdoll.current.air = false;
      ragdoll.current.lieT = 0;
      groupRef.current.rotation.x = -Math.PI / 2;
    }
    if (grounded && foot.current.vy <= 0) foot.current.vy = 0;
    const movement = controller.computedMovement();

    const t = body.translation();
    const nextPos = { x: t.x + movement.x, y: t.y + movement.y, z: t.z + movement.z };

    // drowning: stuck in open water (no ground under it, see Marina.tsx's shore
    // wall which normally keeps you out) past DROWN_LIMIT respawns you at START,
    // same fix the original applies via its own onFoot water check. Exempt
    // I-94's bridge/FORT NEON's platform (lib/marina.ts's isOnBridgeOrBase) —
    // walking through the base's gate is the intended way in (its own gate
    // gap is VEHICLE_ONLY, foot traffic only), so this check has to be able
    // to tell "standing on the platform" apart from "actually in the water."
    if (nextPos.x >= SHORE_X && !isOnBridgeOrBase(nextPos)) {
      drownTime.current += d;
      if (drownTime.current > DROWN_LIMIT) {
        drownTime.current = 0;
        body.setTranslation({ x: START.x, y: 1, z: START.z }, true);
        foot.current.h = START.h;
        camYaw.current = START.h;
        foot.current.speed = 0;
        foot.current.vy = 0;
        slide.current.x = 0;
        slide.current.z = 0;
        ragdoll.current = null;
        groupRef.current.rotation.x = 0;
        worldState.px = START.x;
        worldState.pz = START.z;
        worldState.heading = START.h;
        return;
      }
    } else {
      drownTime.current = 0;
    }

    body.setNextKinematicTranslation(nextPos);

    groupRef.current.rotation.y = foot.current.h; // group is a child of the RigidBody, which already tracks nextPos — no position update needed here

    worldState.px = nextPos.x;
    worldState.pz = nextPos.z;
    worldState.py = nextPos.y;
    worldState.heading = foot.current.h;

    // handheld weapon — same lib/tankShell.ts fireQueue Tank.tsx's own F key
    // drains, just a human-scale muzzle point. Gated off hud.hasGun (picked
    // up at lib/armory.ts's ARMORY) and ragdollActive (no firing mid-tumble).
    gunCooldown.current = Math.max(0, gunCooldown.current - d);
    if (hud.hasGun && !ragdollActive && k.fire && gunCooldown.current <= 0) {
      gunCooldown.current = GUN_FIRE_COOLDOWN;
      const fdx = Math.sin(foot.current.h);
      const fdz = Math.cos(foot.current.h);
      requestFire(nextPos.x + fdx * GUN_MUZZLE_FORWARD, nextPos.y + GUN_MUZZLE_UP, nextPos.z + fdz * GUN_MUZZLE_FORWARD, fdx, fdz);
    }

    // limb animation — walk cycle, mid-air tuck, or (inClub, standing still) the
    // original's bollywood dance emote
    const moving = Math.abs(foot.current.speed) > 0.15;
    walkPhase.current += d * (moving ? (sprint ? 13 : 8) : 0);
    if (rig.current) {
      const r = rig.current;
      const amt = moving ? clamp(Math.abs(foot.current.speed) / sp, 0, 1) : 0;
      const t = state.clock.elapsedTime;
      playerLimbs.phase = walkPhase.current; playerLimbs.amt = amt; playerLimbs.air = !grounded; playerLimbs.sit = false;
      if (!grounded) {
        r.position.set(0, 0, 0);
        r.rotation.set(0.18, 0, 0);
      } else if (hud.inClub && move === 0) {
        // dance emote: beat-synced bounce + hip twist
        const t2 = t * (130 / 60) * Math.PI * 2;
        r.position.set(0, Math.abs(Math.sin(t2)) * 0.08, 0);
        r.rotation.set(0, Math.sin(t2 * 0.5) * 0.35, Math.sin(t2) * 0.08);
      } else {
        // footstep bob (two per stride), side-to-side roll, forward lean with
        // speed; idle = slow "servo breathing"
        const ph = walkPhase.current;
        r.position.set(Math.sin(ph) * 0.03 * amt, Math.abs(Math.sin(ph)) * 0.07 * amt + (amt === 0 ? Math.sin(t * 1.6) * 0.008 : 0), 0);
        r.rotation.set((sprint ? 0.12 : 0.05) * amt, Math.sin(ph) * 0.05 * amt, Math.sin(ph) * 0.03 * amt);
      }
    }

    applyCameraRig({
      camera,
      camPos: camPos.current,
      camLook: camLook.current,
      tx: nextPos.x,
      ty: nextPos.y,
      tz: nextPos.z,
      // chase orbits the camera's own lagging yaw so a turn is visible; the
      // first-person and cinematic modes still key off where he's actually facing
      th: hud.camMode === 0 ? camYaw.current : foot.current.h,
      isBike: false,
      camMode: hud.camMode,
      time: state.clock.elapsedTime,
      dt: d,
    });
  });

  return (
    <RigidBody ref={bodyRef} type="kinematicPosition" colliders={false} position={[START.x, 1, START.z]}>
      <CuboidCollider ref={colliderRef} args={[0.3, 0.75, 0.3]} collisionGroups={PLAYER_GROUPS} />
      <group ref={groupRef} position={[0, -0.75, 0]}>
        <group ref={rig}>
          {/* BootHold keeps the loading screen up until the robot is in */}
          <Suspense fallback={<BootHold />}>
            <PlayerRobotMesh />
          </Suspense>
        </group>
        <group ref={chuteRef} visible={false}>
          <ParachuteMesh />
        </group>
      </group>
    </RigidBody>
  );
}

const CANOPY_MAT = new THREE.MeshLambertMaterial({ color: "#e8402f", side: THREE.DoubleSide });
const CANOPY_STRIPE_MAT = new THREE.MeshLambertMaterial({ color: "#f4f0e6", side: THREE.DoubleSide });
const RISER_MAT = new THREE.MeshBasicMaterial({ color: "#2a2a2c" });

// Static geometry, no per-frame animation — the parent <group ref={chuteRef}>
// in Player's own JSX owns visibility, toggled off chuteOpen.current every
// frame. Canopy sits above the head (local y~2.1 — HIP_Y=0.59 plus torso/
// head puts the head around y~1.5), risers run down to shoulder height.
function ParachuteMesh() {
  return (
    <group position={[0, 2.6, 0]}>
      {/* dome canopy — alternating coloured gores via 8 wedge segments */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh key={i} rotation={[0, (i / 8) * Math.PI * 2, 0]} material={i % 2 === 0 ? CANOPY_MAT : CANOPY_STRIPE_MAT} castShadow>
          <sphereGeometry args={[1.1, 8, 6, (i / 8) * Math.PI * 2, (Math.PI * 2) / 8, 0, Math.PI / 2]} />
        </mesh>
      ))}
      {/* four risers from the canopy skirt down to the harness at shoulder height */}
      {[
        [0.75, 0],
        [-0.75, 0],
        [0, 0.75],
        [0, -0.75],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x * 0.6, -1.1, z * 0.6]} rotation={[z !== 0 ? Math.PI / 10 : 0, 0, x !== 0 ? -Math.sign(x) * Math.PI / 10 : 0]} material={RISER_MAT}>
          <cylinderGeometry args={[0.015, 0.015, 1.3, 6]} />
        </mesh>
      ))}
    </group>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
