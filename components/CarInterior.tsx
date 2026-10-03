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

const INTERIORS = {
  gt: "/models/interiors/gt-interior.glb",
  classic: "/models/interiors/sedan-interior.glb",
} as const;
type InteriorKind = keyof typeof INTERIORS;

/** cameraRig args for the current player car's cockpit (local car frame). */
export function cockpitCameraArgs(def: PlayerCarDef) {
  const [x, y, z] = def.cockpit.eye;
  // look-at drop 30 m ahead: the GT cabin's wheel sits lower, so pitch down more to keep wheel + hands in view
  return { cockpitForward: x, cockpitEyeHeight: y - RIDE_HEIGHT, cockpitAhead: z, cockpitLookDrop: def.cockpit.interior === "gt" ? 4.2 : 2.2 };
}

// steering-wheel turns per unit of car.steerAng (lib/carPhysics.ts), capped
// so an arm never sweeps across the windscreen (about 85° each way)
const WHEEL_RATIO = 2.4;
const WHEEL_MAX = 1.5;

// ---- robot arms / hands (shared geometry + materials, built once) ----------
const ARM_MAT = new THREE.MeshStandardMaterial({ color: "#4a525e", metalness: 0.7, roughness: 0.5, emissive: "#101318" });
const JOINT_MAT = new THREE.MeshStandardMaterial({ color: "#e0782a", metalness: 0.4, roughness: 0.45, emissive: "#2a1204" });
const HAND_MAT = new THREE.MeshStandardMaterial({ color: "#3b424c", metalness: 0.8, roughness: 0.35, emissive: "#0e1116" });
const SEG_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0); // unit cylinder from y=0 to y=1
const JOINT_GEO = new THREE.SphereGeometry(1, 12, 8);

/** A stylised robot hand gripping a rim tube that runs along local X: palm
 *  plate on the driver's side, four curled finger segments over the top and
 *  a thumb underneath. Built around the grip point (local origin). */
function makeHand(side: 1 | -1, rim: number): THREE.Group {
  const g = new THREE.Group();
  const t = Math.max(0.018, rim * 0.13); // rim tube radius guess
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.05, 0.03), HAND_MAT);
  palm.position.set(0, -0.005, t + 0.018);
  g.add(palm);
  for (let i = 0; i < 4; i++) {
    const x = -0.03 + i * 0.02;
    // proximal over the top, distal down the far side
    const prox = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.034), HAND_MAT);
    prox.position.set(x, t + 0.012, 0.012);
    prox.rotation.x = -0.35;
    const dist = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.03, 0.015), HAND_MAT);
    dist.position.set(x, t * 0.2, -t - 0.01);
    const knuckle = new THREE.Mesh(JOINT_GEO, JOINT_MAT);
    knuckle.scale.setScalar(0.0085);
    knuckle.position.set(x, t + 0.012, t + 0.02);
    g.add(prox, dist, knuckle);
  }
  const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.04), HAND_MAT);
  thumb.position.set(-side * 0.045, -t - 0.006, 0.01);
  thumb.rotation.y = side * 0.5;
  g.add(thumb);
  // wrist cuff
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.04, 10), JOINT_MAT);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.set(0, -0.012, t + 0.05);
  g.add(cuff);
  return g;
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
  placeSegment(arm.upper, s, _e, 0.022);
  placeSegment(arm.fore, _e, _w, 0.017);
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
        mat.emissive = new THREE.Color("#ffffff");
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
    for (const side of [1, -1] as const) {
      // left hand at 10 o'clock, right hand at 2 o'clock
      const radial = new THREE.Vector3().addScaledVector(upP, Math.cos(Math.PI / 3)).addScaledVector(leftP, side * Math.sin(Math.PI / 3)).normalize();
      const tangent = new THREE.Vector3().crossVectors(radial, axis).normalize();
      const grip = new THREE.Group();
      grip.position.copy(hub).addScaledVector(radial, rim);
      grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tangent, radial, axis));
      grip.add(makeHand(side, rim));
      const wristAnchor = new THREE.Object3D();
      wristAnchor.position.set(0, -0.01, Math.max(0.018, rim * 0.13) + 0.07);
      grip.add(wristAnchor);
      root.add(grip);
      grip.updateMatrixWorld(true);
      wheel.attach(grip);
      const upper = new THREE.Mesh(SEG_GEO, ARM_MAT);
      const fore = new THREE.Mesh(SEG_GEO, ARM_MAT);
      const elbow = new THREE.Mesh(JOINT_GEO, JOINT_MAT);
      elbow.scale.setScalar(0.028);
      const shoulderBall = new THREE.Mesh(JOINT_GEO, JOINT_MAT);
      const shoulder = new THREE.Vector3(side * 0.19, -0.27, -0.12);
      shoulderBall.position.copy(shoulder);
      shoulderBall.scale.setScalar(0.05);
      for (const m of [upper, fore, elbow, shoulderBall]) m.frustumCulled = false;
      root.add(upper, fore, elbow, shoulderBall);
      arms.push({ shoulder, wrist: wristAnchor, upper, fore, elbow, side });
    }
    return { root, wheel, baseQ, arms };
  }, [gltf, kind]);

  const q = useMemo(() => new THREE.Quaternion(), []);
  const zAxis = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  useFrame(() => {
    const g = built.root;
    if (!g.parent?.visible) return;
    q.setFromAxisAngle(zAxis, THREE.MathUtils.clamp(carRef.current.steerAng * WHEEL_RATIO, -WHEEL_MAX, WHEEL_MAX));
    built.wheel.quaternion.copy(built.baseQ).multiply(q);
    g.updateMatrixWorld(true);
    for (const a of built.arms) solveArm(a, g);
  });

  const [x, y, z] = def.cockpit.eye;
  const s = def.cockpit.scale ?? 1;
  return <primitive object={built.root} position={[x, y - RIDE_HEIGHT, z]} scale={s} />;
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
        <PrewarmOtherCabin current={def.cockpit.interior} />
      </Suspense>
    </group>
  );
}

/** keeps the other class's cabin loaded and its materials compiled (hidden) */
function PrewarmOtherCabin({ current }: { current: InteriorKind }) {
  const other: InteriorKind = current === "gt" ? "classic" : "gt";
  const gltf = useGLTF(asset(INTERIORS[other]));
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    o.visible = false;
    return o;
  }, [gltf]);
  return <primitive object={obj} />;
}
