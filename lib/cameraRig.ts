import * as THREE from "three";
import { cameraLook } from "@/lib/cameraLook";

// Ported directly from the original's camera block in tick() (camMode 0-3:
// chase/cockpit/hood/cinematic) — same distances, heights, and cinematic
// phase timings. Shared by Car/Bike/Boat so all three vehicles get all four
// modes instead of only the primary vehicle getting the full treatment.
export interface CameraRigArgs {
  camera: THREE.Camera;
  camPos: THREE.Vector3;
  camLook: THREE.Vector3;
  tx: number;
  ty: number;
  tz: number;
  th: number;
  isBike: boolean;
  camMode: 0 | 1 | 2 | 3;
  time: number;
  dt: number;
  speedMs?: number; // m/s, unsigned — drives the speed-FOV widen below; omit (e.g. on foot) for a flat base FOV
  // chase-mode distance/height behind the target, in meters — default 9.5/4.2
  // fits every car-sized vehicle (car/bike/boat/plane/helicopter), but a
  // 58m-long airliner (DrivableAirliner.tsx) needs its own bigger numbers or
  // the camera sits inside the fuselage/tail instead of behind it.
  chaseDist?: number;
  chaseHeight?: number;
  // cockpit-mode (camMode===1, four-wheelers only) eye position — default
  // 1.3/-0.35 fits the sedan; components/CommercialVehicle.tsx passes taller/
  // more-forward numbers per kind so a bus/truck/jeep driver sits where the
  // cab actually puts them instead of at sedan seat height.
  cockpitEyeHeight?: number;
  cockpitForward?: number;
  // camMode===1, four-wheelers-only branch's along-heading eye lean —
  // default 0.15 matches every existing car/bus/truck's small fixed lean
  // (cockpitForward there is a lateral seat offset, not a distance).
  // components/DrivableAirliner.tsx needs a real one: its target position is
  // the fuselage centre, but the flight deck sits ~22m up at the nose, so it
  // passes a big cockpitAhead instead of relying on the fixed lean.
  cockpitAhead?: number;
  // camMode===1&&!isBike's look-AT target distance/drop — default 30/0.9
  // matches every existing car/bus/truck (a shallow, nearly-level glance:
  // atan(0.9/30)~1.7 deg down works when the dash sits close to eye level).
  // A helicopter/small-plane panel sits both close (~0.15-0.3m ahead) AND
  // well below eye level (~0.3-0.4m) — that combination needs a real steep
  // glance down at a near point, which the 30-unit-ahead default can't ever
  // produce (the far target dominates the angle regardless of lookDrop).
  // components/Helicopter.tsx/Plane.tsx pass a small cockpitLookAhead (close
  // to the panel's own distance) instead of overriding lookDrop alone.
  cockpitLookAhead?: number;
  cockpitLookDrop?: number;
}

// Speed-FOV widen, ported from the original's tick() (index.html ~7704-7705):
// camera.fov eases toward a speed-scaled target every frame — the actual
// "feels fast" cue at high speed (wide-angle stretch), not just a UI number.
// True car cockpit gets the punchier curve, everything else (chase/hood/bike)
// the gentler one, cinematic mode is fixed — same as the original's ternary.
function applySpeedFov(camera: THREE.Camera, camMode: 0 | 1 | 2 | 3, isBike: boolean, speedMs: number, dt: number) {
  if (!(camera instanceof THREE.PerspectiveCamera)) return;
  const inCockpit = camMode === 1 && !isBike;
  const wantFov = camMode === 3 ? 55 : inCockpit ? 68 + Math.min(speedMs * 0.22, 14) : 62 + Math.min(speedMs * 0.26, 17);
  const dClamped = Math.min(dt, 0.033);
  camera.fov += (wantFov - camera.fov) * Math.min(1, dClamped * 3.5);
  camera.updateProjectionMatrix();
}

export function applyCameraRig({
  camera,
  camPos,
  camLook,
  tx,
  ty,
  tz,
  th,
  isBike,
  camMode,
  time,
  dt,
  speedMs = 0,
  chaseDist = 9.5,
  chaseHeight = 4.2,
  cockpitEyeHeight = 1.3,
  cockpitForward = -0.35,
  cockpitAhead = 0.15,
  cockpitLookAhead = 30,
  cockpitLookDrop,
}: CameraRigArgs) {
  applySpeedFov(camera, camMode, isBike, speedMs, dt);
  const dx = Math.sin(th);
  const dz = Math.cos(th);

  if (camMode === 0) {
    // chase — the only mode the optional free-look applies to. Both offsets
    // are 0 until the player has clicked in to engage pointer lock, so this
    // is the original behaviour verbatim before that (lib/cameraLook.ts).
    const oa = th + cameraLook.yaw;
    const ox = Math.sin(oa);
    const oz = Math.cos(oa);
    const dist = chaseDist;
    // pitch raises/lowers the camera and pulls it in a little as it climbs, so
    // looking down doesn't leave it hanging out at full chase distance
    const h = ty + chaseHeight + cameraLook.pitch * 5.5;
    const orbit = dist * (1 - Math.max(0, cameraLook.pitch) * 0.25);
    const want = new THREE.Vector3(tx - ox * orbit, h, tz - oz * orbit);
    // tighten the follow while the cursor is leaning the view, so the lean
    // reads as a deliberate camera move rather than the usual lazy drift
    // clamp dt to prevent jitter from frame drops hitting pow() with large values
    const dClamped = Math.min(dt, 0.033);
    const k = 1 - Math.pow(cameraLook.locked ? 0.00002 : 0.0015, dClamped);
    camPos.lerp(want, k);
    camera.position.copy(camPos);
    camLook.lerp(
      new THREE.Vector3(tx + ox * 4, ty + 1.6 - cameraLook.pitch * 1.2, tz + oz * 4),
      1 - Math.pow(cameraLook.locked ? 0.00002 : 0.0005, dClamped),
    );
    camera.lookAt(camLook);
  } else if (camMode === 1 || camMode === 2) {
    // cockpit / hood
    let ex: number, ey: number, ez: number, lookDrop = 2.2;
    if (camMode === 1 && !isBike) {
      ex = tx + Math.cos(th) * cockpitForward + dx * cockpitAhead;
      ez = tz - Math.sin(th) * cockpitForward + dz * cockpitAhead;
      ey = ty + cockpitEyeHeight;
      lookDrop = cockpitLookDrop ?? 0.9;
    } else if (camMode === 1) {
      ex = tx + dx * 0.2;
      ez = tz + dz * 0.2;
      ey = ty + 1.45;
    } else {
      ex = tx + dx * 1.9;
      ez = tz + dz * 1.9;
      ey = ty + 1.25;
    }
    camera.position.set(ex, ey, ez);
    camera.lookAt(ex + dx * cockpitLookAhead, ey - lookDrop, ez + dz * cockpitLookAhead);
    camPos.copy(camera.position);
    camLook.set(ex + dx * cockpitLookAhead, ey - lookDrop, ez + dz * cockpitLookAhead);
  } else {
    // cinematic — auto-cycling angles, same 4 phases/5s timings as the original
    const cT = time % 20;
    const phase = Math.floor(cT / 4);
    const ca = time * 0.18;
    let cx3: number, cy3: number, cz3: number, lx3: number, ly3: number, lz3: number;
    if (phase === 0) {
      cx3 = tx + Math.cos(ca) * 7.5; cy3 = ty + 0.42; cz3 = tz + Math.sin(ca) * 7.5;
      lx3 = tx; ly3 = ty + 0.45; lz3 = tz;
    } else if (phase === 1) {
      cx3 = tx + dx * 7 + dz * 5; cy3 = ty + 2.0; cz3 = tz + dz * 7 - dx * 5;
      lx3 = tx; ly3 = ty + 0.9; lz3 = tz;
    } else if (phase === 2) {
      cx3 = tx - dx * 9; cy3 = ty + 1.3; cz3 = tz - dz * 9;
      lx3 = tx + dx * 4; ly3 = ty + 0.7; lz3 = tz + dz * 4;
    } else if (phase === 3) {
      cx3 = tx + Math.cos(ca * 1.6) * 11; cy3 = ty + 4.5; cz3 = tz + Math.sin(ca * 1.6) * 11;
      lx3 = tx; ly3 = ty + 0.8; lz3 = tz;
    } else {
      cx3 = tx - dz * 6; cy3 = ty + 0.55; cz3 = tz + dx * 6;
      lx3 = tx; ly3 = ty + 0.6; lz3 = tz;
    }
    const dClamped2 = Math.min(dt, 0.033);
    const k2 = 1 - Math.pow(0.004, dClamped2);
    camPos.lerp(new THREE.Vector3(cx3, cy3, cz3), k2);
    camera.position.copy(camPos);
    camLook.lerp(new THREE.Vector3(lx3, ly3, lz3), k2);
    camera.lookAt(camLook);
  }
}
