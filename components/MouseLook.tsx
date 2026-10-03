"use client";

import { useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  cameraLook,
  wrapAngle,
  MAX_PITCH_UP,
  MAX_PITCH_DOWN,
  YAW_SENSITIVITY,
  PITCH_SENSITIVITY,
  EASE,
} from "@/lib/cameraLook";
import { useHudStore } from "@/lib/hudStore";

// True 360° free-look via the Pointer Lock API — see lib/cameraLook.ts for
// why this replaced the earlier position-mapped hover design. Click the
// canvas once to engage; the OS cursor disappears and every further mouse
// move reports a raw delta with no edge, so panning right (or left) never
// runs out of room. Esc, or the browser itself, can release the lock at any
// time — that's a real browser exit, always available, not a bug.
export function MouseLook() {
  const { gl } = useThree();

  useEffect(() => {
    const el = gl.domElement;

    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return;
      // player-tunable multiplier on top of the tuned base constants — see
      // the slider in HUD.tsx / hudStore.lookSensitivity
      const k = useHudStore.getState().lookSensitivity;
      cameraLook.targetYaw = wrapAngle(cameraLook.targetYaw - e.movementX * YAW_SENSITIVITY * k);
      cameraLook.targetPitch = Math.max(
        MAX_PITCH_DOWN,
        Math.min(MAX_PITCH_UP, cameraLook.targetPitch + e.movementY * PITCH_SENSITIVITY * k),
      );
    };

    const onClick = () => {
      // A left-click re-engages the lock any time it's dropped (Esc,
      // alt-tab), not just the very first time — requestPointerLock() is a
      // no-op while already locked, so this is safe to call unconditionally.
      if (useHudStore.getState().mapOpen) return; // clicking the map picks a destination, not the camera
      if (document.pointerLockElement !== el) el.requestPointerLock().catch(() => {});
    };

    const onLockChange = () => {
      cameraLook.locked = document.pointerLockElement === el;
      if (!cameraLook.locked) {
        // released (Esc, alt-tab, map opened) — ease the lean back to centre
        // rather than leaving the camera parked at whatever angle it was at
        cameraLook.targetYaw = 0;
        cameraLook.targetPitch = 0;
      }
    };

    el.addEventListener("click", onClick);
    document.addEventListener("pointerlockchange", onLockChange);
    document.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("click", onClick);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };
  }, [gl]);

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05);
    const k = 1 - Math.pow(EASE, d);
    // shortest-arc ease toward the (possibly just-wrapped) target, so easing
    // from e.g. yaw=3.0 toward target=-3.0 turns the short way through PI
    // rather than spinning all the way back through 0
    const diff = wrapAngle(cameraLook.targetYaw - cameraLook.yaw);
    cameraLook.yaw = wrapAngle(cameraLook.yaw + diff * k);
    cameraLook.pitch += (cameraLook.targetPitch - cameraLook.pitch) * k;
  });

  // The map is a full-screen DOM overlay — the OS cursor has to be visible
  // and free to click landmarks on it, so drop the lock while it's open and
  // let the next canvas click re-engage it once the map closes.
  const mapOpen = useHudStore((s) => s.mapOpen);
  useEffect(() => {
    if (mapOpen && document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }
  }, [mapOpen, gl]);

  return null;
}
