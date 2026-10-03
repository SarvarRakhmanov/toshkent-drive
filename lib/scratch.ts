import * as THREE from "three";

// Per-frame scratch math objects. Vehicles used to build their kinematic
// rotation with `new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3…)`
// every frame — ~25 vehicles × 2-6 objects × 60 fps of garbage, which on a
// phone means regular GC pauses (the "random freeze for a moment" stutter).
// tmpQuat() hands out quaternions from a small ring: valid until 32 more are
// requested, i.e. for the expression/statement that uses it (Rapier copies the
// values the moment setNextKinematicRotation is called).
export const AXIS_X = new THREE.Vector3(1, 0, 0);
export const AXIS_Y = new THREE.Vector3(0, 1, 0);
export const AXIS_Z = new THREE.Vector3(0, 0, 1);
const RING = Array.from({ length: 32 }, () => new THREE.Quaternion());
let i = 0;
export function tmpQuat(): THREE.Quaternion {
  i = (i + 1) & 31;
  return RING[i].identity();
}
