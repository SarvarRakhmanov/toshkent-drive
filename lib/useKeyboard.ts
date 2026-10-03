"use client";

import { useRef } from "react";

export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  boost: boolean;
  // tank main gun (components/Tank.tsx) — every other vehicle just ignores
  // this field, same as they already ignore `boost` unless they're the car
  fire: boolean;
}

/** Merged input: keyboard OR on-screen touch controls, plus an optional analog steer axis. */
export interface InputState extends KeyState {
  /** analog steering from the touch pad, -1..1 (+1 = full left, same sign as left key); 0 = none */
  readonly steerAxis: number;
}

const CODE_MAP: Record<string, keyof KeyState> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  Space: "handbrake",
  ShiftLeft: "boost",
  ShiftRight: "boost",
  KeyF: "fire",
};

const blank = (): KeyState => ({ forward: false, back: false, left: false, right: false, handbrake: false, boost: false, fire: false });

// One page-wide input state shared by every vehicle (they used to each attach
// their own keydown/keyup listeners; only one is ever driven at a time anyway).
const keyboard: KeyState = blank();
/** Written by components/TouchControls.tsx. */
export const touchInput: KeyState & { steerAxis: number } = { ...blank(), steerAxis: 0 };

export const RELEASE_EVENT = "td-release-input";

export function clearTouchInput() {
  Object.assign(touchInput, blank(), { steerAxis: 0 });
}

const merged: InputState = {
  get forward() { return keyboard.forward || touchInput.forward; },
  get back() { return keyboard.back || touchInput.back; },
  get left() { return keyboard.left || touchInput.left; },
  get right() { return keyboard.right || touchInput.right; },
  get handbrake() { return keyboard.handbrake || touchInput.handbrake; },
  get boost() { return keyboard.boost || touchInput.boost; },
  get fire() { return keyboard.fire || touchInput.fire; },
  get steerAxis() { return keyboard.left || keyboard.right ? 0 : touchInput.steerAxis; },
};

function isTextField(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  if (el.tagName === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return type !== "range" && type !== "checkbox" && type !== "button";
  }
  return false;
}

let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (isTextField(e.target)) return;
    // a HUD button keeps focus after a click; Space/Enter would then "click" it
    // again instead of only driving — drop that focus on the first key
    const t = e.target as HTMLElement | null;
    if (t && t.tagName === "BUTTON") t.blur();
    const k = CODE_MAP[e.code];
    if (k) {
      keyboard[k] = true;
      // keep Space/arrows from scrolling the page or nudging a focused slider
      if (k === "handbrake" || e.code.startsWith("Arrow")) e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = CODE_MAP[e.code];
    if (k) keyboard[k] = false;
  });
  // a key released while the tab/window was unfocused never sends keyup —
  // without this the car keeps accelerating (or steering) on its own
  const releaseAll = () => {
    Object.assign(keyboard, blank());
    clearTouchInput();
    // touch widgets track which finger holds them; a finger lifted while the
    // app was in the background never sends pointerup, so tell them to forget
    // (otherwise GAS stayed held / the steering pad ignored every new touch)
    window.dispatchEvent(new Event(RELEASE_EVENT));
  };
  window.addEventListener("blur", releaseAll);
  window.addEventListener("pagehide", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) releaseAll();
  });
}

/** Live input state (keyboard + touch) in a ref — read inside useFrame, never triggers a re-render. */
export function useKeyboard() {
  install();
  return useRef<InputState>(merged);
}
