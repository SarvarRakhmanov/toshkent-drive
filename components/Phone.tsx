"use client";

import type { CSSProperties } from "react";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { requestCarSummon } from "@/lib/vehicleSummon";
import { cycleWeather } from "@/lib/weatherState";
import { LANDMARKS } from "@/lib/landmarks";

// GTA-style phone overlay (P to open/close, same modal pattern as
// BigMap.tsx's mapOpen/#mapscreen) — three real actions wired onto existing
// or new mechanics, not stubs: summon the player's car (lib/vehicleSummon.ts,
// new — Car.tsx now checks it unconditionally, unlike the club-door
// teleportRequest which only ever fires for the ACTIVE vehicle), set a GPS
// waypoint (hud.setNavTarget — the exact same call BigMap.tsx's own landmark
// buttons already make), and cycle weather (cycleWeather — the same function
// already bound to KeyV in Game.tsx).
export function Phone() {
  const open = useHudStore((s) => s.phoneOpen);
  const setPhoneOpen = useHudStore((s) => s.setPhoneOpen);
  const setNavTarget = useHudStore((s) => s.setNavTarget);
  const showMsg = useHudStore((s) => s.showMsg);
  if (!open) return null;

  const callMechanic = () => {
    const { px, pz, heading } = worldState;
    requestCarSummon(px + Math.sin(heading) * 3, pz + Math.cos(heading) * 3, heading + Math.PI);
    showMsg("MECHANIC: CAR ON ITS WAY");
    setPhoneOpen(false);
  };

  return (
    <div
      id="phonescreen"
      style={{ position: "fixed", inset: 0, zIndex: 21, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(4,6,12,0.72)", backdropFilter: "blur(3px)" }}
      onClick={() => setPhoneOpen(false)}
    >
      <div
        style={{ width: 280, background: "linear-gradient(#181c24,#0d0f14)", border: "1px solid #2a3040", borderRadius: 22, padding: "22px 16px", boxShadow: "0 0 40px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: "center", color: "#8fd6ff", fontWeight: 700, letterSpacing: 2, marginBottom: 14 }}>TOSHKENT MOBILE</div>

        <button type="button" onClick={callMechanic} style={btnStyle}>
          🔧 Call Mechanic
          <span style={hintStyle}>deliver my car here</span>
        </button>

        <div style={{ margin: "10px 0 4px", color: "#6a7280", fontSize: 11, letterSpacing: 1 }}>SET GPS WAYPOINT</div>
        <div data-scroll style={{ maxHeight: 190, overflowY: "auto", touchAction: "pan-y", display: "flex", flexDirection: "column", gap: 4 }}>
          {LANDMARKS.map((l) => (
            <button
              key={l.name}
              type="button"
              onClick={() => {
                setNavTarget(l);
                setPhoneOpen(false);
              }}
              style={{ ...btnStyle, padding: "8px 12px", fontSize: 13, color: l.col }}
            >
              {l.name}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            showMsg("WEATHER: " + cycleWeather().toUpperCase());
            setPhoneOpen(false);
          }}
          style={{ ...btnStyle, marginTop: 10 }}
        >
          ☁️ Change Weather
        </button>

        <button type="button" onClick={() => setPhoneOpen(false)} style={{ ...btnStyle, marginTop: 10, textAlign: "center", color: "#ff6a5f" }}>
          Hang Up
        </button>
      </div>
    </div>
  );
}

const btnStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "#1c2230",
  border: "1px solid #2a3040",
  borderRadius: 10,
  color: "#e6e9ee",
  padding: "10px 12px",
  fontSize: 14,
  cursor: "pointer",
  marginBottom: 4,
};

const hintStyle: CSSProperties = { display: "block", fontSize: 11, color: "#6a7280", marginTop: 2 };
