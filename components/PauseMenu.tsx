"use client";

import { useEffect } from "react";
import { usePauseStore } from "@/lib/pauseStore";
import { useHudStore, CAM_MODES } from "@/lib/hudStore";
import { usePlayerCarStore, PLAYER_CARS } from "@/lib/playerCar";
import { useGfxStore } from "@/lib/gfx";
import { useCreditsStore } from "@/components/CreditsPanel";
import { isMuted } from "@/lib/audio";
import { getAudioCtx } from "@/lib/audio";
import {
  actionSelectCar, actionSelectVehicle, actionCamera, actionMap, actionPhone,
  actionWeather, actionMute, actionGraphics, actionResetCar,
} from "@/lib/actions";
import { PlateEditor } from "@/components/PlateEditor";

// v1.7b: always-visible MENU / pause button on every device (desktop, phone
// browser, APK). Opening it pauses the game (lib/pauseStore.ts) and offers
// the vehicle picker, so choosing a car swaps the vehicle immediately.
const btn: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", padding: "9px 12px", margin: "3px 0", borderRadius: 8,
  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.18)", color: "#eef1f6",
  font: "700 12px/1.2 system-ui, sans-serif", letterSpacing: 0.6, cursor: "pointer",
};
const sel: React.CSSProperties = { ...btn, background: "rgba(255,215,106,0.28)", borderColor: "#ffd76a", color: "#ffe9a8" };

export function PauseMenu() {
  const open = usePauseStore((s) => s.open);
  const setOpen = usePauseStore((s) => s.setOpen);
  const active = useHudStore((s) => s.active);
  const camMode = useHudStore((s) => s.camMode);
  const carIdx = usePlayerCarStore((s) => s.index);
  const quality = useGfxStore((s) => s.quality);

  // silence the engine while paused
  useEffect(() => {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (open) ctx.suspend().catch(() => {});
    else if (!isMuted()) ctx.resume().catch(() => {});
  }, [open]);

  const close = () => setOpen(false);
  const run = (fn: () => void, keep = false) => () => { fn(); if (!keep) close(); };

  return (
    <>
      <button
        id="td-menu-btn"
        type="button"
        aria-label="Menu / pause (Esc)"
        title="Menu / pause (Esc)"
        onClick={() => usePauseStore.getState().toggle()}
        style={{
          position: "fixed", zIndex: 30, left: "var(--sl, 12px)", top: "calc(var(--st, 8px) + 72px)",
          height: 34, minWidth: 34, padding: "0 11px", borderRadius: 9, display: "flex", alignItems: "center", gap: 6,
          background: open ? "rgba(255,215,106,0.55)" : "rgba(12,16,30,0.62)", border: "1.5px solid rgba(255,255,255,0.45)",
          color: open ? "#14161d" : "#fff", font: "800 11px/1 system-ui, sans-serif", letterSpacing: 1, cursor: "pointer",
          touchAction: "manipulation", pointerEvents: "auto",
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          {open ? <path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /> : <path d="M4 6h16v2.4H4zM4 10.8h16v2.4H4zM4 15.6h16V18H4z" fill="currentColor" />}
        </svg>
        {open ? "PAUSED" : "MENU"}
      </button>
      {open && (
        <div
          id="td-pause"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
          style={{ position: "fixed", inset: 0, zIndex: 29, background: "rgba(4,6,12,0.55)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}
        >
          <div data-scroll style={{ width: "min(340px, 92vw)", maxHeight: "86vh", overflowY: "auto", background: "rgba(12,15,24,0.94)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 14, padding: 14, color: "#eef1f6", font: "600 12px/1.3 system-ui, sans-serif" }}>
            <div style={{ fontWeight: 900, letterSpacing: 2, fontSize: 15, marginBottom: 8, color: "#ffd76a" }}>PAUSED</div>
            <button type="button" style={sel} onClick={close}>▶ RESUME</button>
            <div style={{ margin: "10px 0 4px", color: "#9aa3b2", letterSpacing: 1.5, fontSize: 10 }}>CHOOSE VEHICLE</div>
            <div id="td-vehicles">
              {PLAYER_CARS.map((c, i) => (
                <button key={c.id} type="button" data-car={c.id} style={active === "car" && carIdx === i ? sel : btn} onClick={run(() => actionSelectCar(i))}>
                  {c.name}
                </button>
              ))}
              <button type="button" data-car="bike" style={active === "bike" ? sel : btn} onClick={run(() => actionSelectVehicle("bike"))}>MOTORBIKE</button>
              <button type="button" data-car="boat" style={active === "boat" ? sel : btn} onClick={run(() => actionSelectVehicle("boat"))}>BOAT</button>
            </div>
            <div style={{ margin: "10px 0 4px", color: "#9aa3b2", letterSpacing: 1.5, fontSize: 10 }}>SETTINGS</div>
            <PlateEditor />
            <button type="button" style={btn} onClick={run(actionCamera, true)}>CAMERA: {CAM_MODES[camMode]}</button>
            <button type="button" style={btn} onClick={run(actionGraphics, true)}>GRAPHICS: {quality === "high" ? "HIGH" : "LOW"}</button>
            <button type="button" style={btn} onClick={run(actionWeather, true)}>CHANGE WEATHER</button>
            <button type="button" style={btn} onClick={run(actionMute, true)}>SOUND ON / OFF</button>
            <button type="button" style={btn} onClick={run(actionResetCar)}>RESET CAR</button>
            <button type="button" style={btn} onClick={run(actionMap)}>CITY MAP</button>
            <button type="button" style={btn} onClick={run(actionPhone)}>PHONE / GARAGE</button>
            <button type="button" style={btn} onClick={run(() => useCreditsStore.getState().setOpen(true))}>CREDITS</button>
            <div style={{ marginTop: 8, color: "#6f7888", fontSize: 10 }}>Esc opens / closes this menu</div>
          </div>
        </div>
      )}
    </>
  );
}
