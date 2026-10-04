"use client";

import type { CSSProperties } from "react";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { requestCarSummon } from "@/lib/vehicleSummon";
import { cycleWeather } from "@/lib/weatherState";
import { LANDMARKS } from "@/lib/landmarks";
import { useMissions, type MissionKind, isNightHour, NIGHT_PAY } from "@/lib/missions";
import { STATIONS, HOUSES, DEALER, pumpSpot, houseSpot, useEconomy } from "@/lib/economy";
import { useCareer, moneyText, UPGRADE_KEYS, UPGRADE_LABEL, UPGRADE_COST, MAX_LEVEL } from "@/lib/career";
import { PLAYER_CARS, usePlayerCarStore } from "@/lib/playerCar";
import { saveGame } from "@/lib/saveGame";

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
  const mission = useMissions((s) => s.m);
  const money = useCareer((s) => s.money);
  const infinite = useCareer((s) => s.infinite);
  const levels = useCareer((s) => s.levels);
  const carIdx = usePlayerCarStore((s) => s.index);
  if (!open) return null;
  const car = PLAYER_CARS[carIdx];
  const lv = { ...{ power: 0, grip: 0, brakes: 0, weight: 0 }, ...levels[car.id] };

  const startJob = (k: MissionKind) => {
    const err = useMissions.getState().start(k);
    if (err) showMsg(err);
    setPhoneOpen(false);
  };
  const buy = (k: (typeof UPGRADE_KEYS)[number]) => {
    const r = useCareer.getState().buy(car.id, k);
    showMsg(r === "ok" ? `${UPGRADE_LABEL[k].toUpperCase()} INSTALLED` : r === "max" ? "ALREADY MAXED" : "NOT ENOUGH MONEY");
  };

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
        data-scroll
        style={{ width: 280, maxHeight: "92vh", overflowY: "auto", touchAction: "pan-y", background: "linear-gradient(#181c24,#0d0f14)", border: "1px solid #2a3040", borderRadius: 22, padding: "22px 16px", boxShadow: "0 0 40px rgba(0,0,0,0.6)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ textAlign: "center", color: "#8fd6ff", fontWeight: 700, letterSpacing: 2, marginBottom: 14 }}>TOSHKENT MOBILE</div>

        <button type="button" onClick={callMechanic} style={btnStyle}>
          🔧 Call Mechanic
          <span style={hintStyle}>deliver my car here</span>
        </button>

        <div style={{ margin: "10px 0 4px", color: "#6a7280", fontSize: 11, letterSpacing: 1 }}>JOBS · <span style={{ color: "#9dff6a" }}>{moneyText(money, infinite)}</span></div>
        {mission ? (
          <button type="button" id="job-cancel" onClick={() => { useMissions.getState().cancel(); setPhoneOpen(false); }} style={{ ...btnStyle, color: "#ff6a5f" }}>
            ✖ Cancel: {mission.title}
          </button>
        ) : (
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" id="job-taxi" onClick={() => startJob("taxi")} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12 }}>🚕 Taxi</button>
            <button type="button" id="job-delivery" onClick={() => startJob("delivery")} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12 }}>📦 Delivery</button>
            <button type="button" id="job-race" onClick={() => startJob("race")} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12 }}>🏁 Race</button>
          </div>
        )}
        {!mission && (
          <button type="button" id="job-night" onClick={() => startJob("night")} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12, opacity: isNightHour() ? 1 : 0.5 }}>
            🌙 Night taxi ×{NIGHT_PAY} pay
            <span style={hintStyle}>{isNightHour() ? "the city's paying double tonight" : "20:00 – 05:00 only"}</span>
          </button>
        )}

        <div style={{ margin: "10px 0 4px", color: "#6a7280", fontSize: 11, letterSpacing: 1 }}>GARAGE · {car.name}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {UPGRADE_KEYS.map((k) => (
            <button key={k} type="button" id={`up-${k}`} onClick={() => buy(k)} style={{ ...btnStyle, padding: "6px 8px", fontSize: 12, marginBottom: 0 }}>
              {UPGRADE_LABEL[k]} {"●".repeat(lv[k])}{"○".repeat(MAX_LEVEL - lv[k])}
              <span style={hintStyle}>{lv[k] >= MAX_LEVEL ? "MAX" : `$${UPGRADE_COST[lv[k] + 1]}`}</span>
            </button>
          ))}
        </div>

        <div style={{ margin: "10px 0 4px", color: "#6a7280", fontSize: 11, letterSpacing: 1 }}>SET GPS WAYPOINT</div>
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" id="gps-gas" onClick={() => {
            const { px, pz } = worldState;
            const s = [...STATIONS].sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz))[0];
            const p = pumpSpot(s);
            setNavTarget({ name: "⛽ " + s.name, x: p.x, z: p.z, col: "#3d8bff" });
            setPhoneOpen(false);
          }} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12 }}>⛽ Gas / repair</button>
          <button type="button" id="gps-dealer" onClick={() => { setNavTarget({ name: "AVTO BOZOR", x: DEALER.x, z: DEALER.z, col: "#00e5ff" }); setPhoneOpen(false); }} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12 }}>🚗 Car dealer</button>
          <button type="button" id="gps-home" onClick={() => {
            const { px, pz } = worldState;
            const e = useEconomy.getState();
            const list = e.home ? HOUSES.filter((h) => h.id === e.home) : [...HOUSES].sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
            const h = list[0]; const p = houseSpot(h);
            setNavTarget({ name: (e.home ? "🏠 " : "FOR SALE: ") + h.name, x: p.x, z: p.z, col: "#9dff6a" });
            setPhoneOpen(false);
          }} style={{ ...btnStyle, textAlign: "center", padding: "8px 4px", fontSize: 12 }}>🏠 Home</button>
        </div>
        <div data-scroll style={{ maxHeight: 120, overflowY: "auto", touchAction: "pan-y", display: "flex", flexDirection: "column", gap: 4 }}>
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

        <button type="button" id="save-game" onClick={() => { saveGame(); showMsg("GAME SAVED"); setPhoneOpen(false); }} style={{ ...btnStyle, marginTop: 4 }}>
          💾 Save Game
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
