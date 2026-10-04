"use client";

import { useState } from "react";
import { useMapStore, MAP_LABEL, type MapId } from "@/lib/mapChoice";
import { saveGame } from "@/lib/saveGame";

// v1.7.1: "Map: Toshkent / Big City" (pause menu + touch settings). Switching
// saves the game and reloads into the other map; Toshkent stays the default.
export function MapPicker({ compact = false }: { compact?: boolean }) {
  const map = useMapStore((s) => s.map);
  const [busy, setBusy] = useState(false);
  const pick = (m: MapId) => {
    if (m === map || busy) return;
    setBusy(true);
    saveGame();
    useMapStore.getState().switchTo(m);
  };
  const b = (m: MapId): React.CSSProperties => ({
    flex: 1, padding: compact ? "7px 6px" : "9px 8px", borderRadius: 8, cursor: "pointer",
    font: "800 11px/1.1 system-ui, sans-serif", letterSpacing: 0.8,
    background: m === map ? "rgba(255,215,106,0.28)" : "rgba(255,255,255,0.08)",
    border: `1px solid ${m === map ? "#ffd76a" : "rgba(255,255,255,0.18)"}`, color: m === map ? "#ffe9a8" : "#eef1f6",
  });
  return (
    <div id="td-map-picker" style={{ margin: "3px 0" }}>
      <div style={{ color: "#9aa3b2", fontSize: 10, letterSpacing: 1.2, margin: "2px 0 4px" }}>MAP{busy ? " — LOADING…" : ""}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {(["toshkent", "bigcity"] as MapId[]).map((m) => (
          <button key={m} type="button" data-map={m} style={b(m)} onClick={() => pick(m)}>{MAP_LABEL[m]}</button>
        ))}
      </div>
    </div>
  );
}
