"use client";

import { useEffect, useState } from "react";
import { useMissions, missionColor } from "@/lib/missions";
import { useCareer } from "@/lib/career";
import { useHudStore } from "@/lib/hudStore";

// v1.9: money badge + active-job panel (top-left, under the title/clock)
export function MissionHud() {
  const money = useCareer((s) => s.money);
  const m = useMissions((s) => s.m);
  const result = useMissions((s) => s.result);
  const dist = useHudStore((s) => s.waypointDist);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, []);
  const showResult = result && result.until > now;
  return (
    <div id="missionhud" style={{ position: "fixed", left: 12, top: 138, zIndex: 6, pointerEvents: "none", fontFamily: "inherit", maxWidth: 230 }}>
      <div style={{ display: "inline-block", background: "rgba(10,14,20,0.72)", border: "1px solid #3a4a2a", color: "#9dff6a", fontWeight: 800, borderRadius: 8, padding: "3px 9px", fontSize: 14, letterSpacing: 1 }}>
        ${money.toLocaleString("en-US")}
      </div>
      {m && (
        <div style={{ marginTop: 6, background: "rgba(10,14,20,0.78)", borderLeft: `3px solid ${missionColor(m.kind)}`, borderRadius: 6, padding: "6px 9px", color: "#e6e9ee", fontSize: 12 }}>
          <div style={{ color: missionColor(m.kind), fontWeight: 800, letterSpacing: 1 }}>{m.title}</div>
          <div>{m.targets[m.stage].label} — {Math.round(dist)} m</div>
          <div style={{ color: m.timeLeft < 10 ? "#ff6a5f" : "#9aa3b2" }}>
            {m.kind === "race" ? `TIME ${Math.max(0, m.timeLeft).toFixed(1)} s` : m.timeLeft > 0 ? `TIP TIME ${Math.ceil(m.timeLeft)} s` : "LATE — no tip"} · ${m.pay}
          </div>
          {m.targets[m.stage].stop && <div style={{ color: "#6a7280", fontSize: 11 }}>stop in the beam</div>}
        </div>
      )}
      {!m && showResult && (
        <div style={{ marginTop: 6, background: "rgba(10,14,20,0.78)", borderRadius: 6, padding: "6px 9px", color: result!.good ? "#9dff6a" : "#ff6a5f", fontSize: 12, fontWeight: 700 }}>{result!.text}</div>
      )}
    </div>
  );
}
