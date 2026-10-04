"use client";

import { useEffect, useState } from "react";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { PLAYER_CARS, usePlayerCarStore } from "@/lib/playerCar";
import { useCareer, moneyText } from "@/lib/career";
import { engineTelemetry } from "@/lib/vehicleDynamics";
import {
  STATIONS, HOUSES, DEALER, CAR_PRICE, FUEL_PRICE, FUEL_LABEL, RESCUE_PRICE, RESCUE_LITRES,
  fuelOf, fuelSpec, pumpSpot, houseSpot, repairCost, carRepair, useEconomy,
} from "@/lib/economy";

// v1.8 HUD: fuel gauge + the context panel at a gas station (fuel / repair),
// the AVTO BOZOR dealer (buy cars) and homes (buy / set home). Polls the world
// 4x a second — no per-frame React work.
const btn: React.CSSProperties = { display: "block", width: "100%", margin: "4px 0", padding: "8px 10px", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 9, background: "rgba(255,255,255,0.08)", color: "#eef1f6", font: "700 12px/1.2 system-ui, sans-serif", textAlign: "left", cursor: "pointer", touchAction: "manipulation", pointerEvents: "auto" };

type Ctx = { kind: "none" } | { kind: "gas"; name: string } | { kind: "dealer" } | { kind: "house"; id: string };

export function ServicePanel() {
  const active = useHudStore((s) => s.active);
  const stolen = useHudStore((s) => s.stolenCar);
  const showMsg = useHudStore((s) => s.showMsg);
  const carIdx = usePlayerCarStore((s) => s.index);
  const realMoney = useCareer((s) => s.money);
  const infinite = useCareer((s) => s.infinite);
  const money = infinite ? Infinity : realMoney;
  const econ = useEconomy();
  const [, tick] = useState(0);
  const [ctx, setCtx] = useState<Ctx>({ kind: "none" });
  useEffect(() => {
    if (!useEconomy.getState().loaded) useEconomy.getState().load();
    const id = setInterval(() => {
      tick((t) => t + 1);
      const { px, pz } = worldState;
      const slow = useHudStore.getState().speedKmh < 9;
      let c: Ctx = { kind: "none" };
      if (slow) {
        for (const s of STATIONS) { const p = pumpSpot(s); if (Math.hypot(p.x - px, p.z - pz) < 11) c = { kind: "gas", name: s.name }; }
        for (const h of HOUSES) { const p = houseSpot(h); if (Math.hypot(p.x - px, p.z - pz) < 10) c = { kind: "house", id: h.id }; }
        if (Math.hypot(DEALER.x - px, DEALER.z - pz) < DEALER.radius) c = { kind: "dealer" };
      }
      setCtx((o) => (JSON.stringify(o) === JSON.stringify(c) ? o : c));
    }, 250);
    return () => clearInterval(id);
  }, []);

  const car = PLAYER_CARS[carIdx];
  const inCar = active === "car" && !stolen && !!car;
  const spec = car ? fuelSpec(car.id) : null;
  const litres = car ? fuelOf(car.id) : 0;
  const pct = spec ? litres / spec.tank : 1;
  const dmg = inCar ? engineTelemetry.damage : 0;
  const rc = repairCost(dmg);
  const panel = (title: string, body: React.ReactNode) => (
    <div id="td-service" style={{ position: "fixed", right: "calc(var(--sr, 8px) + 8px)", top: "calc(var(--st, 8px) + 150px)", width: "min(250px, 46vw)", zIndex: 22, background: "rgba(10,14,22,0.9)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 12, padding: 10, color: "#eef1f6", font: "600 12px/1.3 system-ui, sans-serif", pointerEvents: "auto", maxHeight: "60vh", overflowY: "auto" }} onPointerDown={(e) => e.stopPropagation()}>
      <div style={{ fontWeight: 900, letterSpacing: 1, color: "#ffd76a", marginBottom: 4 }}>{title}</div>
      <div style={{ color: "#9dff6a", marginBottom: 4 }}>{moneyText(realMoney, infinite)}</div>
      {body}
    </div>
  );

  let view: React.ReactNode = null;
  if (inCar && litres <= 0.05 && ctx.kind !== "gas") {
    view = panel("OUT OF FUEL", (
      <button type="button" id="td-fuelvan" style={btn} onClick={() => useEconomy.getState().rescue(car.id)}>
        🚚 Call fuel van — {RESCUE_LITRES} L ${money >= RESCUE_PRICE ? RESCUE_PRICE : "free"}
      </button>
    ));
  } else if (ctx.kind === "gas" && inCar && spec) {
    view = panel(`⛽ ${ctx.name}`, (
      <>
        {spec.kinds.map((k) => {
          const need = Math.max(0, spec.tank - litres);
          return (
            <button key={k} type="button" id={`td-fuel-${k}`} style={btn} onClick={() => {
              const r = useEconomy.getState().refuel(car.id, k);
              if (r !== "ok") showMsg(r === "full" ? "TANK IS FULL" : r === "money" ? "NOT ENOUGH MONEY" : "WRONG FUEL");
            }}>
              {FUEL_LABEL[k]} — fill {need.toFixed(0)} L · ${Math.round(need * FUEL_PRICE[k])}
            </button>
          );
        })}
        <button type="button" id="td-repair" style={{ ...btn, opacity: rc ? 1 : 0.5 }} onClick={() => {
          if (!rc) return showMsg("CAR IS IN GOOD SHAPE");
          if (money < rc) return showMsg("NOT ENOUGH MONEY");
          useCareer.getState().addMoney(-rc);
          carRepair.pending = true;
          showMsg(`USTAXONA: REPAIRED −$${rc}`);
        }}>
          🔧 Repair ({Math.round(dmg * 100)}% damage) {rc ? `· $${rc}` : "· OK"}
        </button>
      </>
    ));
  } else if (ctx.kind === "dealer") {
    view = panel("🚗 AVTO BOZOR", (
      <>
        {PLAYER_CARS.filter((c) => CAR_PRICE[c.id]).map((c) => {
          const own = econ.owned.includes(c.id);
          return (
            <button key={c.id} type="button" data-buy={c.id} style={{ ...btn, opacity: own ? 0.55 : 1 }} onClick={() => {
              if (own) return showMsg("YOU OWN IT — PICK IT IN THE MENU");
              const r = useEconomy.getState().buyCar(c.id);
              showMsg(r === "ok" ? `BOUGHT ${c.name}! PICK IT IN THE MENU` : "NOT ENOUGH MONEY");
            }}>
              {c.name} {own ? "· OWNED" : `· $${CAR_PRICE[c.id].toLocaleString("en-US")}`}
            </button>
          );
        })}
      </>
    ));
  } else if (ctx.kind === "house") {
    const h = HOUSES.find((q) => q.id === ctx.id)!;
    const own = econ.houses.includes(h.id);
    view = panel(`🏠 ${h.name}`, own ? (
      <button type="button" id="td-sethome" style={btn} onClick={() => { useEconomy.getState().setHome(h.id); showMsg("HOME SET — 'GO HOME' IN THE MENU"); }}>
        {econ.home === h.id ? "✓ This is your home" : "Make this my home"}
      </button>
    ) : (
      <button type="button" id="td-buyhouse" style={btn} onClick={() => {
        const r = useEconomy.getState().buyHouse(h.id);
        showMsg(r === "ok" ? "NEW HOME! 'GO HOME' IN THE MENU" : "NOT ENOUGH MONEY");
      }}>
        Buy for ${h.price.toLocaleString("en-US")}
      </button>
    ));
  }

  return (
    <>
      {view}
    </>
  );
}

/** v1.8.1: fuel gauge row, drawn inside the NITRO box (components/HUD.tsx) so
 *  it moves with it and can never sit on top of the pedals or the minimap */
export function FuelGauge() {
  const active = useHudStore((s) => s.active);
  const stolen = useHudStore((s) => s.stolenCar);
  const carIdx = usePlayerCarStore((s) => s.index);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((t) => t + 1), 500); return () => clearInterval(id); }, []);
  const car = PLAYER_CARS[carIdx];
  if (active !== "car" || stolen || !car) return null;
  const spec = fuelSpec(car.id);
  const litres = fuelOf(car.id);
  const pct = litres / spec.tank;
  const dmg = engineTelemetry.damage;
  return (
    <div id="td-fuel" style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4, color: pct < 0.15 ? "#ff6a5f" : "#eef1f6", font: "800 10px/1 system-ui, sans-serif", textShadow: "0 1px 3px #000", whiteSpace: "nowrap" }}>
      ⛽
      <div style={{ flex: 1, minWidth: 20, height: 6, borderRadius: 4, background: "rgba(255,255,255,0.2)", overflow: "hidden" }}>
        <div style={{ width: `${Math.round(pct * 100)}%`, height: "100%", background: pct < 0.15 ? "#ff4a3d" : pct < 0.35 ? "#ffc93d" : "#5fdc6a" }} />
      </div>
      {litres.toFixed(0)}L
      {dmg > 0.05 && <span style={{ color: "#ffb36a" }}>🔧{Math.round(dmg * 100)}%</span>}
    </div>
  );
}
