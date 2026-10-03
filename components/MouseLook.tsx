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
import { useTouchStore } from "@/lib/touch";

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
      if (touchDrag.id !== null || useTouchStore.getState().isTouch) return; // phones: drag-to-look below
      if (document.pointerLockElement === el || typeof el.requestPointerLock !== "function") return;
      // older Safari returns undefined instead of a Promise
      try {
        const p = el.requestPointerLock() as unknown as Promise<void> | undefined;
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {
        /* pointer lock unsupported */
      }
    };

    // touch free-look: drag one finger on the open scene (not on a button) to
    // look around; let go and the camera eases back behind the vehicle
    const touchDrag: { id: number | null; x: number; y: number } = { id: null, x: 0, y: 0 };
    const TOUCH_GAIN = 1.6;
    const onTouchDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || touchDrag.id !== null) return;
      touchDrag.id = e.pointerId;
      touchDrag.x = e.clientX;
      touchDrag.y = e.clientY;
      cameraLook.locked = true;
    };
    const onTouchMove = (e: PointerEvent) => {
      if (e.pointerId !== touchDrag.id) return;
      const k = useHudStore.getState().lookSensitivity * TOUCH_GAIN;
      const dx = e.clientX - touchDrag.x;
      const dy = e.clientY - touchDrag.y;
      touchDrag.x = e.clientX;
      touchDrag.y = e.clientY;
      cameraLook.targetYaw = wrapAngle(cameraLook.targetYaw - dx * YAW_SENSITIVITY * k);
      cameraLook.targetPitch = Math.max(MAX_PITCH_DOWN, Math.min(MAX_PITCH_UP, cameraLook.targetPitch + dy * PITCH_SENSITIVITY * k));
    };
    const onTouchUp = (e: PointerEvent) => {
      if (e.pointerId !== touchDrag.id) return;
      touchDrag.id = null;
      cameraLook.locked = false;
      cameraLook.targetYaw = 0;
      cameraLook.targetPitch = 0;
    };
    el.addEventListener("pointerdown", onTouchDown);
    window.addEventListener("pointermove", onTouchMove);
    window.addEventListener("pointerup", onTouchUp);
    window.addEventListener("pointercancel", onTouchUp);

    const onLockChange = () => {
      if (touchDrag.id !== null) return;
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
      el.removeEventListener("pointerdown", onTouchDown);
      window.removeEventListener("pointermove", onTouchMove);
      window.removeEventListener("pointerup", onTouchUp);
      window.removeEventListener("pointercancel", onTouchUp);
      document.removeEventListener("pointerlockchange", onLockChange);
      document.removeEventListener("mousemove", onMove);
      if (document.pointerLockElement === el) document.exitPointerLock?.();
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
      document.exitPointerLock?.();
    }
  }, [mapOpen, gl]);

  return null;
}
