"use client";

import { useState } from "react";
import { usePlayerCarStore, PLAYER_CARS } from "@/lib/playerCar";
import { usePlates, parsePlate } from "@/lib/plates";

// v1.7b: custom Uzbek plate for the current car (pause menu → SETTINGS).
export function PlateEditor() {
  const idx = usePlayerCarStore((s) => s.index);
  const car = PLAYER_CARS[idx];
  const custom = usePlates((s) => s.custom[car.id]);
  const current = custom ?? car.plate?.text ?? "";
  const [val, setVal] = useState(current);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [forCar, setForCar] = useState(car.id);
  if (forCar !== car.id) { setForCar(car.id); setVal(current); setMsg(null); }
  if (!car.plate) return <div style={{ color: "#6f7888", fontSize: 10, margin: "4px 0" }}>{car.name}: no licence plate on this model</div>;
  const save = () => {
    const p = parsePlate(val);
    if (!p.ok) { setMsg({ ok: false, text: p.error }); return; }
    usePlates.getState().set(car.id, p.plate);
    setVal(p.plate);
    setMsg({ ok: true, text: `Saved for ${car.name}` });
  };
  return (
    <div id="td-plate-editor" style={{ margin: "3px 0 6px", padding: 8, borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)", background: "rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 10, color: "#9aa3b2", letterSpacing: 1, marginBottom: 4 }}>PLATE · {car.name}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          id="td-plate-input"
          value={val}
          maxLength={14}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setVal(e.target.value.toUpperCase()); setMsg(null); }}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") save(); }}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder="01 A 777 AA"
          style={{ flex: 1, minWidth: 0, padding: "7px 8px", borderRadius: 6, border: "1px solid #3b4252", background: "#fff", color: "#000", font: "800 15px/1 'Roboto Condensed', 'Arial Narrow', sans-serif", letterSpacing: 1 }}
        />
        <button id="td-plate-save" type="button" onClick={save} style={{ padding: "0 12px", borderRadius: 6, border: "1px solid #ffd76a", background: "rgba(255,215,106,0.3)", color: "#ffe9a8", font: "800 11px/1 system-ui, sans-serif", cursor: "pointer" }}>SET</button>
      </div>
      <div style={{ fontSize: 10, marginTop: 4, color: msg ? (msg.ok ? "#9dff6a" : "#ff8a7f") : "#6f7888" }}>
        {msg ? msg.text : "01 A 777 AA (personal) or 01 777 AAA (company), region 01–95"}
      </div>
      {custom && (
        <button type="button" onClick={() => { usePlates.getState().set(car.id, null); setVal(car.plate!.text); setMsg({ ok: true, text: "Back to the default plate" }); }} style={{ marginTop: 4, background: "none", border: "none", color: "#9aa3b2", fontSize: 10, textDecoration: "underline", cursor: "pointer", padding: 0 }}>reset to default</button>
      )}
    </div>
  );
}
