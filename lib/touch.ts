"use client";

import { create } from "zustand";

// Touch-device detection for the on-screen controls (components/TouchControls.tsx).
// A phone/tablet is: a coarse primary pointer, an iPad pretending to be a Mac,
// or any real touch seen at runtime. ?touch=1 / ?touch=0 force it (testing).
export function detectTouch(): boolean {
  if (typeof window === "undefined") return false;
  const q = /[?&]touch=([01])/.exec(window.location.search);
  if (q) return q[1] === "1";
  if (window.matchMedia?.("(pointer: coarse)").matches) return true;
  // iPadOS Safari reports a desktop Mac UA and (with a trackpad) a fine pointer
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
  return false;
}

function forced(): boolean {
  return typeof window !== "undefined" && /[?&]touch=0/.test(window.location.search);
}

interface TouchState {
  isTouch: boolean;
  setTouch: (v: boolean) => void;
}

export const useTouchStore = create<TouchState>((set) => ({
  isTouch: detectTouch(),
  setTouch: (isTouch) => set({ isTouch }),
}));

function applyClass(on: boolean) {
  document.documentElement.classList.toggle("td-touch", on);
}

let installed = false;
/** Keeps the store + the <html class="td-touch"> flag in sync; idempotent. */
export function installTouchDetection() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  applyClass(useTouchStore.getState().isTouch);
  useTouchStore.subscribe((s) => applyClass(s.isTouch));
  if (forced()) return;
  const seen = (e: Event) => {
    if (e.type === "pointerdown" && (e as PointerEvent).pointerType !== "touch") return;
    if (!useTouchStore.getState().isTouch) useTouchStore.getState().setTouch(true);
  };
  window.addEventListener("touchstart", seen, { passive: true, capture: true });
  window.addEventListener("pointerdown", seen, { passive: true, capture: true });
}
