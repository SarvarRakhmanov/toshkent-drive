"use client";

import { useWanted, MAX_STARS, ESCAPE_SECS } from "@/lib/wanted";

// v1.8: wanted stars under the top bar while the police are after you
export function WantedHud() {
  const level = useWanted((s) => s.level);
  const reason = useWanted((s) => s.reason);
  const evade = useWanted((s) => Math.floor(s.evade));
  if (!level) return null;
  return (
    <div id="td-wanted" style={{ position: "fixed", top: "calc(var(--st, 8px) + 92px)", left: "50%", transform: "translateX(-50%)", zIndex: 21, pointerEvents: "none", textAlign: "center", font: "800 12px/1.2 system-ui, sans-serif", color: "#fff", textShadow: "0 1px 3px #000" }}>
      <div style={{ fontSize: 22, letterSpacing: 3, color: "#ffd23f" }}>
        {"★".repeat(level)}<span style={{ color: "rgba(255,255,255,0.28)" }}>{"★".repeat(MAX_STARS - level)}</span>
      </div>
      <div style={{ letterSpacing: 1 }}>WANTED — {reason}</div>
      <div style={{ fontSize: 10, color: "#cfd6e4" }}>{evade > 0 ? `LOSING THEM… ${ESCAPE_SECS - evade}s` : "STOP = BUSTED (FINE) · ESCAPE = CAMERA FINE"}</div>
    </div>
  );
}
