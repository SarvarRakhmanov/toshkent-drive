"use client";

import { Suspense, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";
import type { CarState } from "@/lib/carPhysics";
import { useHudStore } from "@/lib/hudStore";
import { usePlayerCarStore, PLAYER_CARS, type PlayerCarDef } from "@/lib/playerCar";
import { RIDE_HEIGHT } from "@/components/SupercarBody";
import { BootHold } from "@/components/ReadyGate";
import { asset } from "@/lib/asset";

// Cockpit view (camMode 1) for the player's car — v1.4 rewrite.
//
// Two shared, CC-BY Sketchfab cabins (see CREDITS.md), one per car class,
// baked by scripts/optimize-interiors.mjs into a common frame: metres, the
// driver's EYE at the origin, +Z = nose, +X = driver's door (LHD), with the
// steering wheel split out under a "steering-wheel" pivot whose local +Z is
// the column axis (userData.rimRadius = grip radius):
//   gt      — "Autonomous GT Car Interior" (modern: M3 Competition, K5, Seltos)
//   classic — "Car interior" (XJ220-style analog dash: Lacetti, M3 E30)
// The cabin is placed at the car's own eye point (PlayerCarDef.cockpit, the
// same point lib/cameraRig.ts puts the camera at), rendered only in cockpit
// mode, and the exterior body is hidden meanwhile (its own seats/roof would
// otherwise poke through the cabin and block the view).
//
// The driver is the player's robot: procedural stylised robot hands grip the
// rim at 10 and 2 o'clock (children of the wheel pivot, so they turn with
// it) and two-bone robot arms reach back to fixed shoulders.

// v1.6: per car-type cabins (CC BY, CREDITS.md) — the v1.4 gt/classic cabins
// are kept for reference but no longer used by any car
const INTERIORS = {
  gt: "/models/interiors/gt-interior.glb",
  classic: "/models/interiors/sedan-interior.glb",
  sedan: "/models/interiors/sedan2-interior.glb", // Toyota Corolla E180 cabin
  suv: "/models/interiors/suv-interior.glb", // Skoda Karoq cabin (digital cluster)
} as const;
const IN_USE: InteriorKind[] = ["sedan", "suv"];
// [forward, up] cabin offset (m) relative to the car's eye point
const SEAT_BACK: Record<InteriorKind, [number, number]> = { gt: [0, 0], classic: [0, 0], sedan: [0.08, 0.0], suv: [0.14, -0.02] };
type InteriorKind = keyof typeof INTERIORS;

/** cameraRig args for the current player car's cockpit (local car frame). */
export function cockpitCameraArgs(def: PlayerCarDef) {
  const [x, y, z] = def.cockpit.eye;
  // look-at drop 30 m ahead: the GT cabin's wheel sits lower, so pitch down more to keep wheel + hands in view
  const drop = { gt: 4.2, classic: 2.2, sedan: 2.6, suv: 3.0 }[def.cockpit.interior];
  return { cockpitForward: x, cockpitEyeHeight: y - RIDE_HEIGHT, cockpitAhead: z, cockpitLookDrop: drop };
}

// steering-wheel turns per unit of car.steerAng (lib/carPhysics.ts), capped
// so an arm never sweeps across the windscreen (about 85° each way)
// v1.6: up to ~160° of wheel, with hand-over-hand re-grips past ±75°
const WHEEL_RATIO = 2.8;
const WHEEL_MAX = 2.8;
const REGRIP = (75 * Math.PI) / 180;
const REGRIP_TIME = 0.2;

// ---- driver arms / gloved hands (shared geometry + materials, built once) --
// v1.6: slim human-proportioned driving gloves + jacket sleeves (replaces the
// chunky orange-jointed robot hands)
const ARM_MAT = new THREE.MeshStandardMaterial({ color: "#2b2f36", roughness: 0.85, metalness: 0.0, emissive: "#0b0c0e" }); // jacket sleeve
const JOINT_MAT = ARM_MAT;
const HAND_MAT = new THREE.MeshStandardMaterial({ color: "#1d1e21", roughness: 0.5, metalness: 0.05, emissive: "#08080a" }); // leather glove
const CUFF_MAT = new THREE.MeshStandardMaterial({ color: "#9a3b2a", roughness: 0.6, emissive: "#1a0905" }); // glove strap accent
const SEG_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0); // unit cylinder from y=0 to y=1
const JOINT_GEO = new THREE.SphereGeometry(1, 12, 8);
const FINGER_GEO = new THREE.CapsuleGeometry(1, 1, 3, 8); // scaled per segment
const PALM_GEO = new THREE.SphereGeometry(1, 14, 10);

function capsule(len: number, r: number, mat: THREE.Material) {
  const m = new THREE.Mesh(FINGER_GEO, mat);
  m.scale.set(r, len / 2, r); // capsule: radius 1, body length 1 -> total 3 at scale 1
  return m;
}

/** A gloved hand wrapped around a rim tube that runs along local X (local Y
 *  = outward from the hub, Z = toward the driver): palm on the driver's side
 *  of the rim, four slim fingers curling over the top and round the far
 *  side, thumb along the inside. Built around the grip point (local origin). */
function makeHand(side: 1 | -1, rim: number): THREE.Group {
  const g = new THREE.Group();
  const t = Math.max(0.014, rim * 0.085); // rim tube radius
  const palm = new THREE.Mesh(PALM_GEO, HAND_MAT);
  palm.scale.set(0.043, 0.026, 0.016);
  palm.position.set(0, -0.004, t + 0.014);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.019 * (1 - Math.abs(i - 1.5) * 0.04);
    const len = [0.016, 0.019, 0.018, 0.014][i];
    // proximal: palm edge over the top of the rim
    const p1 = capsule(len, 0.0072, HAND_MAT);
    p1.rotation.x = -1.0;
    p1.position.set(x, t + 0.006, t * 0.7);
    // middle + distal: down the far side and curling back under
    const p2 = capsule(len * 0.85, 0.0066, HAND_MAT);
    p2.rotation.x = 0.2;
    p2.position.set(x, t * 0.25, -t - 0.005);
    const p3 = capsule(len * 0.6, 0.006, HAND_MAT);
    p3.rotation.x = 1.25;
    p3.position.set(x, -t * 0.75, -t * 0.55);
    g.add(p1, p2, p3);
  }
  const thumb = capsule(0.026, 0.0078, HAND_MAT);
  thumb.rotation.set(0.35, 0, side * 1.25);
  thumb.position.set(-side * 0.036, -t * 0.4, t + 0.004);
  g.add(thumb);
  // back of the glove + wrist strap
  const wrist = new THREE.Mesh(SEG_GEO, CUFF_MAT);
  wrist.rotation.x = Math.PI / 2;
  wrist.scale.set(0.022, 0.018, 0.019);
  wrist.position.set(0, -0.012, t + 0.042);
  g.add(wrist);
  for (const m of g.children) m.frustumCulled = false;
  return g;
}

interface Hand {
  grip: THREE.Group;
  home: number; // rest angle on the rim (rad from the top, + = driver's door side)
}
interface HandState {
  attach: number; // grip angle in the wheel's own frame
  from: THREE.Vector3; // re-grip blend start
  fromQ: THREE.Quaternion;
  t: number; // re-grip progress 0..1 (1 = holding)
}
// per-hand mutable grip state, kept outside React's memoised objects
const handStates = new WeakMap<THREE.Object3D, HandState>();
function stateOf(h: Hand): HandState {
  let st = handStates.get(h.grip);
  if (!st) { st = { attach: h.home, from: new THREE.Vector3(), fromQ: new THREE.Quaternion(), t: 1 }; handStates.set(h.grip, st); }
  return st;
}

const _gp = new THREE.Vector3();
const _gq = new THREE.Quaternion();
const _rad = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

/** cabin-space grip pose on the rim at world angle phi */
function gripPose(b: { hub: THREE.Vector3; axis: THREE.Vector3; upP: THREE.Vector3; leftP: THREE.Vector3; rim: number }, phi: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
  _rad.copy(b.upP).multiplyScalar(Math.cos(phi)).addScaledVector(b.leftP, Math.sin(phi)).normalize();
  _tan.crossVectors(_rad, b.axis).normalize();
  pos.copy(b.hub).addScaledVector(_rad, b.rim);
  quat.setFromRotationMatrix(_m4.makeBasis(_tan, _rad, b.axis));
}

interface Arm {
  shoulder: THREE.Vector3; // in cabin (eye) space
  wrist: THREE.Object3D; // anchor on the hand
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  elbow: THREE.Mesh;
  side: 1 | -1;
}

const UPPER_LEN = 0.3;
const FORE_LEN = 0.3;
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function placeSegment(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, r: number) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(_up, _d.multiplyScalar(1 / Math.max(len, 1e-6)));
  mesh.scale.set(r, len, r);
}

/** two-bone IK: shoulder -> elbow -> wrist, elbow bent outward and down */
function solveArm(arm: Arm, cabin: THREE.Object3D) {
  arm.wrist.getWorldPosition(_w);
  cabin.worldToLocal(_w);
  const s = arm.shoulder;
  _d.subVectors(_w, s);
  const dist = Math.min(_d.length(), UPPER_LEN + FORE_LEN - 1e-3);
  _d.normalize();
  const a = (UPPER_LEN * UPPER_LEN - FORE_LEN * FORE_LEN + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, UPPER_LEN * UPPER_LEN - a * a));
  _pole.set(arm.side * 0.8, -1, 0).addScaledVector(_d, -_pole.dot(_d)).normalize();
  _e.copy(s).addScaledVector(_d, a).addScaledVector(_pole, h);
  placeSegment(arm.upper, s, _e, 0.034);
  placeSegment(arm.fore, _e, _w, 0.026);
  arm.elbow.position.copy(_e);
}

function Cabin({ kind, def, carRef }: { kind: InteriorKind; def: PlayerCarDef; carRef: React.RefObject<CarState> }) {
  const gltf = useGLTF(asset(INTERIORS[kind]));
  const built = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false; // always around the camera
    });
    if (kind === "classic") {
      // the source cabin is untextured clay: give it a charcoal trim + black wheel
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const wheel = m.name.includes("steering");
        m.material = new THREE.MeshStandardMaterial({ color: wheel ? "#16171a" : "#3c3d42", roughness: wheel ? 0.6 : 0.85, metalness: 0.05, emissive: wheel ? "#050506" : "#121214", side: THREE.DoubleSide });
      });
    } else {
      // no cabin dome light (a light toggling on/off re-compiles every lit
      // shader) — a faint emissive floor keeps the shaded cabin from going black
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const mat = src.clone();
        // untextured trim glows in its own colour (a white emissive washed
        // dark plastics out to light grey — the "white panels")
        mat.emissive = src.map ? new THREE.Color("#ffffff") : src.color.clone();
        mat.emissiveMap = src.map;
        mat.emissiveIntensity = 0.16;
        m.material = mat;
      });
    }
    const wheel = root.getObjectByName("steering-wheel") ?? new THREE.Group();
    const rim = (wheel.userData.rimRadius as number) || 0.17;
    const baseQ = wheel.quaternion.clone();
    // grips are laid out in cabin space (root is still identity here), then
    // re-parented into the wheel pivot with attach() so they turn with it
    root.updateMatrixWorld(true);
    const hub = wheel.getWorldPosition(new THREE.Vector3());
    const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(wheel.getWorldQuaternion(new THREE.Quaternion())); // toward the driver
    const upP = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const leftP = new THREE.Vector3().crossVectors(upP, axis).normalize(); // in-plane, toward the driver's door (+X)
    if (leftP.x < 0) leftP.negate();
    const arms: Arm[] = [];
    const hands: Hand[] = [];
    for (const side of [1, -1] as const) {
      // left hand at 10 o'clock, right hand at 2 o'clock (angle from the top,
      // + toward the driver's door); the hand is posed every frame from the
      // wheel angle (rides with the rim, re-grips hand-over-hand past ±75°)
      const home = side * (Math.PI / 3);
      const grip = new THREE.Group();
      grip.add(makeHand(side, rim));
      const wristAnchor = new THREE.Object3D();
      wristAnchor.position.set(0, -0.012, Math.max(0.014, rim * 0.085) + 0.06);
      grip.add(wristAnchor);
      root.add(grip);
      hands.push({ grip, home });
      const upper = new THREE.Mesh(SEG_GEO, ARM_MAT);
      const fore = new THREE.Mesh(SEG_GEO, ARM_MAT);
      const elbow = new THREE.Mesh(JOINT_GEO, JOINT_MAT);
      elbow.scale.setScalar(0.034);
      const shoulder = new THREE.Vector3(side * 0.2, -0.3, -0.14);
      for (const m of [upper, fore, elbow]) m.frustumCulled = false;
      root.add(upper, fore, elbow);
      arms.push({ shoulder, wrist: wristAnchor, upper, fore, elbow, side });
    }
    return { root, wheel, baseQ, arms, hands, hub, axis, upP, leftP, rim };
  }, [gltf, kind]);

  const q = useMemo(() => new THREE.Quaternion(), []);
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  useFrame((_, dt) => {
    const g = built.root;
    if (!g.parent?.visible) return;
    const theta = THREE.MathUtils.clamp(carRef.current.steerAng * WHEEL_RATIO, -WHEEL_MAX, WHEEL_MAX);
    q.setFromAxisAngle(zAxis, theta);
    built.wheel.quaternion.copy(built.baseQ).multiply(q);
    for (const h of built.hands) {
      const st = stateOf(h);
      // world rim angle of this hand = where it grabbed (wheel frame) + wheel turn
      let phi = st.attach + theta;
      if (st.t >= 1 && Math.abs(phi - h.home) > REGRIP) {
        // let go and re-grab back at the home position (hand-over-hand)
        st.from.copy(h.grip.position);
        st.fromQ.copy(h.grip.quaternion);
        st.attach = h.home - theta;
        st.t = 0;
        phi = h.home;
      }
      gripPose(built, phi, _gp, _gq);
      if (st.t < 1) {
        st.t = Math.min(1, st.t + dt / REGRIP_TIME);
        const k = st.t * st.t * (3 - 2 * st.t);
        h.grip.position.lerpVectors(st.from, _gp, k).addScaledVector(built.axis, Math.sin(Math.PI * st.t) * 0.06);
        h.grip.quaternion.slerpQuaternions(st.fromQ, _gq, k);
      } else {
        h.grip.position.copy(_gp);
        h.grip.quaternion.copy(_gq);
      }
    }
    g.updateMatrixWorld(true);
    for (const a of built.arms) solveArm(a, g);
  });

  const [x, y, z] = def.cockpit.eye;
  const s = def.cockpit.scale ?? 1;
  // seat travel: slide the cabin forward so the wheel sits a comfortable arm's
  // length away (portrait phones have a narrow horizontal field of view)
  const seat = SEAT_BACK[kind];
  return <primitive object={built.root} position={[x, y - RIDE_HEIGHT + seat[1], z + seat[0]]} scale={s} />;
}
export function CarInterior({ carRef }: { carRef: React.RefObject<CarState> }) {
  const group = useRef<THREE.Group>(null);
  const index = usePlayerCarStore((s) => s.index);
  const def = PLAYER_CARS[index];
  const wasCockpit = useRef(false);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const s = useHudStore.getState();
    const cockpit = s.active === "car" && s.camMode === 1;
    g.visible = cockpit;
    // hide / restore the exterior body (our siblings under the car's RigidBody)
    if (cockpit !== wasCockpit.current && g.parent) {
      for (const c of g.parent.children) if (c !== g) c.visible = !cockpit;
      wasCockpit.current = cockpit;
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* BootHold: both cabins load + compile behind the loading screen */}
      <Suspense fallback={<BootHold />}>
        <Cabin key={def.id} kind={def.cockpit.interior} def={def} carRef={carRef} />
        {IN_USE.filter((k) => k !== def.cockpit.interior).map((k) => <PrewarmCabin key={k} kind={k} />)}
      </Suspense>
    </group>
  );
}

/** keeps the other cabins loaded and their materials compiled (hidden) */
function PrewarmCabin({ kind }: { kind: InteriorKind }) {
  const gltf = useGLTF(asset(INTERIORS[kind]));
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    o.visible = false;
    return o;
  }, [gltf]);
  return <primitive object={obj} />;
}
