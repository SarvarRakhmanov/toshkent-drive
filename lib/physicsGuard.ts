"use client";

import { RigidBody, World, KinematicCharacterController } from "@dimforge/rapier3d-compat";

// Crash-freeze guard for Rapier. A single NaN/Infinity handed to Rapier (a
// kinematic target, an impulse, a character-controller result) poisons the
// body's AABB, and a non-finite AABB in the broad phase can make world.step()
// throw every frame or spin — which is exactly the "hit a car at 100+ km/h,
// two seconds later the game freezes for good" report. Every write into Rapier
// is filtered here once, at the prototype, so all ~40 vehicle/prop/NPC
// call sites are covered without touching each one.
const LIMIT = 50000; // nothing legit in the world is further than this from the origin
const MAX_LINVEL = 120; // m/s — a cap on what we ever ask Rapier to do
const MAX_IMPULSE = 2000;

export const physicsHealth = { rejected: 0, stepErrors: 0, consecutiveStepErrors: 0, lastError: "" };

type V = { x: number; y: number; z: number };
type Q = V & { w: number };
const finiteV = (v: V | null | undefined) =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) &&
  Math.abs(v.x) < LIMIT && Math.abs(v.y) < LIMIT && Math.abs(v.z) < LIMIT;
const finiteQ = (q: Q | null | undefined) =>
  !!q && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w) &&
  q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w > 1e-8;
const capV = (v: V, max: number): V => {
  const l = Math.hypot(v.x, v.y, v.z);
  return l > max ? { x: (v.x / l) * max, y: (v.y / l) * max, z: (v.z / l) * max } : v;
};

let installed = false;
let warned = false;
function reject(what: string) {
  physicsHealth.rejected++;
  if (!warned) {
    warned = true;
    console.warn(`[toshkent-drive] blocked a non-finite physics write (${what}); further ones are counted silently`);
  }
}

export function installPhysicsGuard() {
  if (installed) return;
  installed = true;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const RB = RigidBody.prototype as any;
  const wrapV = (name: string, cap?: number) => {
    const orig = RB[name];
    if (typeof orig !== "function") return;
    RB[name] = function (v: V, ...rest: unknown[]) {
      if (!finiteV(v)) return reject(name);
      return orig.call(this, cap ? capV(v, cap) : v, ...rest);
    };
  };
  const wrapQ = (name: string) => {
    const orig = RB[name];
    if (typeof orig !== "function") return;
    RB[name] = function (q: Q, ...rest: unknown[]) {
      if (!finiteQ(q)) return reject(name);
      return orig.call(this, q, ...rest);
    };
  };
  wrapV("setTranslation");
  wrapV("setNextKinematicTranslation");
  wrapV("setLinvel", MAX_LINVEL);
  wrapV("setAngvel", 60);
  wrapV("applyImpulse", MAX_IMPULSE);
  wrapV("applyTorqueImpulse", MAX_IMPULSE);
  wrapV("addForce", MAX_IMPULSE * 10);
  wrapQ("setRotation");
  wrapQ("setNextKinematicRotation");

  const KCC = KinematicCharacterController.prototype as any;
  const origMove = KCC.computeColliderMovement;
  KCC.computeColliderMovement = function (collider: unknown, desired: V, ...rest: unknown[]) {
    if (!finiteV(desired)) { reject("computeColliderMovement"); desired = { x: 0, y: 0, z: 0 }; }
    return origMove.call(this, collider, desired, ...rest);
  };
  const origComputed = KCC.computedMovement;
  KCC.computedMovement = function () {
    const m = origComputed.call(this) as V;
    if (!finiteV(m)) { reject("computedMovement"); return { x: 0, y: 0, z: 0 }; }
    return m;
  };

  const W = World.prototype as any;
  const origStep = W.step;
  W.step = function (...args: unknown[]) {
    // dt cap for the physics too: a long hitch never becomes one giant step
    if (!(this.timestep > 0)) this.timestep = 1 / 60;
    else if (this.timestep > 0.1) this.timestep = 0.1;
    try {
      origStep.apply(this, args);
      physicsHealth.consecutiveStepErrors = 0;
    } catch (e) {
      physicsHealth.stepErrors++;
      physicsHealth.consecutiveStepErrors++;
      physicsHealth.lastError = String((e as Error)?.message ?? e);
      if (physicsHealth.stepErrors === 1) console.warn("[toshkent-drive] physics step failed (recovering):", e);
    }
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

if (typeof window !== "undefined") {
  installPhysicsGuard();
  (window as unknown as { __tdPhysics: typeof physicsHealth }).__tdPhysics = physicsHealth;
}
