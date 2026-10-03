"use client";

// On-screen touch controls for phones/tablets (web build and the Android APK).
// Shown only on touch devices (lib/touch.ts). Writes straight into the shared
// input state every vehicle reads (lib/useKeyboard.ts → touchInput), so the
// buttons behave exactly like holding the keys — plus analog steering.
//
// Pointer events with per-pointer tracking + setPointerCapture: every finger
// is independent, so you can steer with the left thumb while holding GAS (and
// NITRO) with the right. preventDefault on pointerdown and on a native
// non-passive touchstart stops iOS Safari from scrolling, zooming, selecting
// text or opening the long-press callout; CSS adds touch-action:none.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { touchInput, clearTouchInput, RELEASE_EVENT, type KeyState } from "@/lib/useKeyboard";
import { useTouchStore } from "@/lib/touch";
import { useHudStore, CAM_MODES } from "@/lib/hudStore";
import { useGfxStore } from "@/lib/gfx";
import {
  actionUse, actionSwitchVehicle, actionCamera, actionLights, actionMute, actionWeather,
  actionMap, actionPhone, actionGraphics, actionNextCar, actionResetCar,
} from "@/lib/actions";
import { isMuted, unlockAudio } from "@/lib/audio";
import { useCreditsStore } from "@/components/CreditsPanel";

type HoldKey = Exclude<keyof KeyState, "left" | "right">;

/** A button that is "held" while at least one finger is on it. */
function HoldButton({ k, className, children }: { k: HoldKey; className: string; children: ReactNode }) {
  const ids = useRef(new Set<number>());
  const [on, setOn] = useState(false);
  useEffect(() => {
    const reset = () => { ids.current.clear(); touchInput[k] = false; setOn(false); };
    window.addEventListener(RELEASE_EVENT, reset);
    return () => {
      window.removeEventListener(RELEASE_EVENT, reset);
      touchInput[k] = false;
    };
  }, [k]);
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* already captured / synthetic */
    }
    ids.current.add(e.pointerId);
    touchInput[k] = true;
    setOn(true);
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ids.current.delete(e.pointerId)) return;
    if (ids.current.size === 0) {
      touchInput[k] = false;
      setOn(false);
    }
  };
  return (
    <div
      className={`tc-btn ${className}${on ? " on" : ""}`}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      role="button"
      aria-pressed={on}
    >
      {children}
    </div>
  );
}

/** A one-shot button: fires on release if the finger was pressed on it. */
function TapButton({ onTap, className = "", title, children }: { onTap: () => void; className?: string; title: string; children: ReactNode }) {
  const pressed = useRef<number | null>(null);
  const [on, setOn] = useState(false);
  return (
    <div
      className={`tc-btn tc-tap ${className}${on ? " on" : ""}`}
      title={title}
      aria-label={title}
      role="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        pressed.current = e.pointerId;
        setOn(true);
      }}
      onPointerUp={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (pressed.current !== e.pointerId) return;
        pressed.current = null;
        setOn(false);
        unlockAudio();
        onTap();
      }}
      onPointerCancel={() => {
        pressed.current = null;
        setOn(false);
      }}
      onPointerLeave={() => {
        pressed.current = null;
        setOn(false);
      }}
    >
      {children}
    </div>
  );
}

// Analog steering pad (looks like two ◀ ▶ buttons). Finger position across
// the pad maps to the steer axis: centre = straight, the middle of either
// half (and beyond) = full lock; slide between them without lifting.
const DEAD = 0.08;
const FULL = 0.5;
function SteerPad() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const [dir, setDir] = useState<"" | "l" | "r">("");
  const apply = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const raw = (r.left + r.width / 2 - clientX) / (r.width / 2); // +1 = left edge
    const m = Math.abs(raw);
    const a = m < DEAD ? 0 : Math.sign(raw) * Math.min(1, (m - DEAD) / (FULL - DEAD));
    touchInput.steerAxis = a;
    touchInput.left = a > 0;
    touchInput.right = a < 0;
    const d = a > 0 ? "l" : a < 0 ? "r" : "";
    setDir((prev) => (prev === d ? prev : d));
  };
  const release = () => {
    active.current = null;
    touchInput.steerAxis = 0;
    touchInput.left = false;
    touchInput.right = false;
    setDir("");
  };
  useEffect(() => {
    window.addEventListener(RELEASE_EVENT, release);
    return () => {
      window.removeEventListener(RELEASE_EVENT, release);
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className={`tc-steer${dir ? " " + dir : ""}`}
      role="group"
      aria-label="Steering"
      onPointerDown={(e) => {
        e.preventDefault();
        if (active.current !== null) return;
        active.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        apply(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.pointerId === active.current) apply(e.clientX);
      }}
      onPointerUp={(e) => {
        if (e.pointerId === active.current) release();
      }}
      onPointerCancel={(e) => {
        if (e.pointerId === active.current) release();
      }}
      onLostPointerCapture={(e) => {
        if (e.pointerId === active.current) release();
      }}
    >
      <div className="tc-half tc-left">◀</div>
      <div className="tc-half tc-right">▶</div>
    </div>
  );
}

// tiny inline icons (Material Design paths, Apache-2.0) — no emoji font needed
const ICONS: Record<string, string> = {
  reset: "M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  car: "M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z",
  camera: "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z",
  light: "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z",
  map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
};
function Icon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="5" cy="12" r="2.2" fill="currentColor" />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" />
      <circle cx="19" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

function SettingsMenu({ onClose }: { onClose: () => void }) {
  const sens = useHudStore((s) => s.lookSensitivity);
  const setSens = useHudStore((s) => s.setLookSensitivity);
  const active = useHudStore((s) => s.active);
  const [muted, setMutedState] = useState(isMuted());
  const item = (label: string, fn: () => void, close = true) => (
    <TapButton
      className="tc-item"
      title={label}
      onTap={() => {
        fn();
        if (close) onClose();
      }}
    >
      {label}
    </TapButton>
  );
  return (
    <div id="tc-menu" onPointerDown={(e) => e.stopPropagation()}>
      {item("ENTER / EXIT (E)", actionUse)}
      {active !== "foot" && item("SWITCH VEHICLE", actionSwitchVehicle)}
      {item("CITY MAP", actionMap)}
      {item("PHONE", actionPhone)}
      {item("WEATHER", actionWeather, false)}
      {item(muted ? "SOUND: OFF" : "SOUND: ON", () => {
        actionMute();
        setMutedState(isMuted());
      }, false)}
      <label className="tc-sens">
        LOOK
        <input
          type="range"
          min={0.4}
          max={2.5}
          step={0.05}
          value={sens}
          onChange={(e) => setSens(parseFloat(e.target.value))}
        />
        <span>{sens.toFixed(1)}x</span>
      </label>
      {item("CREDITS", () => useCreditsStore.getState().setOpen(true))}
      <div className="tc-tip">Drag on the road to look around</div>
    </div>
  );
}

const ROTATE_KEY = "td_rotate_hint_dismissed";
function RotateHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(ROTATE_KEY) === "1";
    } catch {
      /* private mode */
    }
    if (dismissed) return;
    const mq = window.matchMedia("(orientation: portrait)");
    const update = () => setShow(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    const t = setTimeout(() => setShow(false), 9000);
    return () => {
      mq.removeEventListener?.("change", update);
      clearTimeout(t);
    };
  }, []);
  if (!show) return null;
  return (
    <div
      id="tc-rotate"
      onPointerUp={() => {
        setShow(false);
        try {
          sessionStorage.setItem(ROTATE_KEY, "1");
        } catch {
          /* ignore */
        }
      }}
    >
      ⟳ Rotate for a wider view <b>✕</b>
    </div>
  );
}

export function TouchControls() {
  const isTouch = useTouchStore((s) => s.isTouch);
  const mapOpen = useHudStore((s) => s.mapOpen);
  const phoneOpen = useHudStore((s) => s.phoneOpen);
  const hint = useHudStore((s) => s.hint);
  const active = useHudStore((s) => s.active);
  const hasGun = useHudStore((s) => s.hasGun);
  const camMode = useHudStore((s) => s.camMode);
  const quality = useGfxStore((s) => s.quality);
  const [menu, setMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // React registers touchstart as passive, so its preventDefault is a no-op —
  // attach a real non-passive one: kills iOS double-tap zoom, magnifier and
  // the long-press "copy/look up" callout on the buttons (not on the slider)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onStart = (e: TouchEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.closest?.(".tc-sens")) return;
      if (e.cancelable) e.preventDefault();
    };
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("contextmenu", noMenu);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("contextmenu", noMenu);
    };
  }, [isTouch]);

  // any overlay opening (map/phone) releases every held control
  useEffect(() => {
    if (mapOpen || phoneOpen) clearTouchInput();
  }, [mapOpen, phoneOpen]);

  if (!isTouch) return null;
  const onFoot = active === "foot";
  const showFire = active === "tank" || (onFoot && hasGun);

  return (
    <div id="tc" ref={rootRef} className={mapOpen || phoneOpen ? "tc-hidden" : ""}>
      <div id="tc-top">
        <TapButton title="Reset car (R)" onTap={actionResetCar}>
          <Icon name="reset" />
        </TapButton>
        <TapButton title="Change car (K)" onTap={actionNextCar}>
          <Icon name="car" />
        </TapButton>
        <TapButton title={`Camera: ${CAM_MODES[camMode]} (C)`} onTap={actionCamera}>
          <Icon name="camera" />
        </TapButton>
        <TapButton title={`Graphics: ${quality} (Q)`} onTap={actionGraphics} className="tc-gfx">
          {quality === "high" ? "HI" : "LO"}
        </TapButton>
        <TapButton title="Headlights (L)" onTap={actionLights}>
          <Icon name="light" />
        </TapButton>
        <TapButton title="More" onTap={() => setMenu((m) => !m)} className={menu ? "sel" : ""}>
          <MoreIcon />
        </TapButton>
      </div>
      {menu && <SettingsMenu onClose={() => setMenu(false)} />}

      <SteerPad />
      <HoldButton k="forward" className="tc-gas">
        GAS
      </HoldButton>
      <HoldButton k="back" className="tc-brake">
        BRAKE
      </HoldButton>
      <HoldButton k="handbrake" className="tc-small tc-hb">
        {onFoot ? "JUMP" : "HB"}
      </HoldButton>
      {showFire ? (
        <HoldButton k="fire" className="tc-small tc-nitro tc-fire">
          FIRE
        </HoldButton>
      ) : (
        !onFoot && (
          <HoldButton k="boost" className="tc-small tc-nitro">
            N₂O
          </HoldButton>
        )
      )}
      {(hint || onFoot) && (
        <TapButton title="Use / enter / exit (E)" onTap={actionUse} className="tc-small tc-use">
          E
        </TapButton>
      )}
      <RotateHint />
    </div>
  );
}
