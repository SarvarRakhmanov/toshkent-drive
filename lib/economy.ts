import { create } from "zustand";
import { useAuthStore } from "@/lib/authStore";
import { useCareer } from "@/lib/career";
import { useHudStore } from "@/lib/hudStore";
import { PLAYER_CARS, usePlayerCarStore } from "@/lib/playerCar";

// v1.8 economy: fuel per car, gas stations (refuel + repair), the AVTO BOZOR
// car dealer and buyable homes. Everything lives on the sidewalk band (34-40 m
// from a chunk centre) next to a kerb lane, so it works on both maps — the
// Toshkent procedural blocks and the Big City blocks both stop at ±34 m.
// Saved per account to localStorage next to lib/career.ts.

export type FuelKind = "petrol" | "metan";
export interface FuelSpec { tank: number; kinds: FuelKind[] }
// litres; METAN (CNG) conversions are everywhere in Tashkent on the Chevrolets
const FUEL: Record<string, FuelSpec> = {
  seltos: { tank: 50, kinds: ["petrol"] },
  lacetti: { tank: 60, kinds: ["petrol", "metan"] },
  m3: { tank: 55, kinds: ["petrol"] },
  k5: { tank: 60, kinds: ["petrol"] },
  m3c: { tank: 59, kinds: ["petrol"] },
  cobalt: { tank: 46, kinds: ["petrol", "metan"] },
  captiva: { tank: 65, kinds: ["petrol"] },
  lada2103: { tank: 39, kinds: ["petrol", "metan"] },
};
export const fuelSpec = (id: string): FuelSpec => FUEL[id] ?? { tank: 50, kinds: ["petrol"] };
export const FUEL_PRICE: Record<FuelKind, number> = { petrol: 0.8, metan: 0.4 }; // $ per litre / m³
export const FUEL_LABEL: Record<FuelKind, string> = { petrol: "AI-92", metan: "METAN" };
/** fuel-van rescue anywhere when the tank is dry */
export const RESCUE_LITRES = 10;
export const RESCUE_PRICE = 40;

/** litres in each car's tank — mutated every frame by Car.tsx (no React churn) */
export const fuelTank: Record<string, number> = {};
export const fuelOf = (id: string) => fuelTank[id] ?? fuelSpec(id).tank;

/** litres/second for a throttle 0..1 at speed m/s */
export function burnRate(id: string, throttle: number, speed: number): number {
  const def = PLAYER_CARS.find((c) => c.id === id);
  const k = Math.sqrt((def?.phys?.peakTorque ?? 180) / 180);
  return (0.0012 + throttle * (0.018 + 0.016 * Math.min(1, Math.abs(speed) / 40))) * k;
}

// ---- places ---------------------------------------------------------------
export interface Station { id: string; name: string; x: number; z: number; side: 1 | -1 }
/** pumps on the sidewalk at chunk centre + side·37; the car stops in the kerb lane at side·44 */
const st = (ci: number, cj: number, side: 1 | -1, name: string): Station => ({ id: `gas${ci}_${cj}`, name, x: ci * 100 + side * 37, z: cj * 100, side });
export const STATIONS: Station[] = [
  st(-1, 2, 1, "UZNEFTEPRODUKT CHILONZOR"),
  st(3, -2, 1, "UZNEFTEPRODUKT MINOR"),
  st(-4, -1, -1, "UZNEFTEPRODUKT SERGELI"),
  st(2, 3, -1, "UZNEFTEPRODUKT YUNUSOBOD"),
  st(-3, 3, 1, "UZNEFTEPRODUKT OLMAZOR"),
  st(4, 0, -1, "UZNEFTEPRODUKT BEKTEMIR"),
];
export const pumpSpot = (s: Station) => ({ x: s.x + s.side * 7, z: s.z });

export interface House { id: string; name: string; price: number; x: number; z: number; side: 1 | -1 }
const hs = (id: string, name: string, price: number, ci: number, cj: number, side: 1 | -1, dz = 0): House => ({ id, name, price, x: ci * 100 + side * 37, z: cj * 100 + dz, side });
export const HOUSES: House[] = [
  hs("chilonzor", "CHILONZOR KVARTIRA", 2000, 1, 3, -1, 18),
  hs("yunusobod", "YUNUSOBOD HOVLI", 5000, -2, -3, 1, -18),
  hs("city", "TASHKENT CITY PENTHOUSE", 12000, -1, 1, -1, 18),
];
export const houseSpot = (h: House) => ({ x: h.x + h.side * 7, z: h.z });

/** AVTO BOZOR car dealer (lib/landmarks.ts) — the kerb beside it */
export const DEALER = { x: -44, z: 20, radius: 26 };
/** v1.7 cars are sold at the dealer; the original line-up is owned from the start */
export const CAR_PRICE: Record<string, number> = { lada2103: 600, cobalt: 1500, captiva: 3000 };
export const REPAIR_BASE = 20, REPAIR_PER = 600; // $ for 0 → 100 % damage

// ---- store ----------------------------------------------------------------
interface EconState {
  owned: string[];
  houses: string[];
  home: string | null;
  loaded: boolean;
  load: () => void;
  isOwned: (carId: string) => boolean;
  buyCar: (carId: string) => "ok" | "money" | "owned";
  buyHouse: (id: string) => "ok" | "money" | "owned";
  setHome: (id: string) => void;
  refuel: (carId: string, kind: FuelKind) => "ok" | "money" | "full" | "kind";
  rescue: (carId: string) => number;
}
const key = () => `td_econ_v1:${useAuthStore.getState().user?.id ?? "guest"}`;
let saveT = 0;
export function persistEcon(force = false) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (!force && now - saveT < 4000) return;
  saveT = now;
  const s = useEconomy.getState();
  try { localStorage.setItem(key(), JSON.stringify({ owned: s.owned, houses: s.houses, home: s.home, fuel: fuelTank })); } catch { /* full / private */ }
}
const pay = (n: number) => {
  const c = useCareer.getState();
  if (c.money < n) return false;
  c.addMoney(-n);
  return true;
};

export const useEconomy = create<EconState>((set, get) => ({
  owned: [], houses: [], home: null, loaded: false,
  load: () => {
    let d: { owned?: string[]; houses?: string[]; home?: string | null; fuel?: Record<string, number> } | null = null;
    try { d = JSON.parse(localStorage.getItem(key()) || "null"); } catch { d = null; }
    const owned = new Set(PLAYER_CARS.filter((c) => !CAR_PRICE[c.id]).map((c) => c.id));
    for (const id of d?.owned ?? []) owned.add(id);
    // grandfather: a v1.7 car someone was already driving stays theirs
    if (!d) { const cur = PLAYER_CARS[usePlayerCarStore.getState().index]; if (cur) owned.add(cur.id); }
    for (const [id, l] of Object.entries(d?.fuel ?? {})) if (Number.isFinite(l)) fuelTank[id] = Math.max(0, Math.min(fuelSpec(id).tank, l));
    set({ owned: [...owned], houses: d?.houses ?? [], home: d?.home ?? null, loaded: true });
    persistEcon(true);
  },
  isOwned: (id) => get().owned.includes(id),
  buyCar: (id) => {
    if (get().owned.includes(id)) return "owned";
    if (!pay(CAR_PRICE[id] ?? 0)) return "money";
    set({ owned: [...get().owned, id] });
    persistEcon(true);
    return "ok";
  },
  buyHouse: (id) => {
    const h = HOUSES.find((q) => q.id === id);
    if (!h || get().houses.includes(id)) return "owned";
    if (!pay(h.price)) return "money";
    set({ houses: [...get().houses, id], home: id });
    persistEcon(true);
    return "ok";
  },
  setHome: (id) => { set({ home: id }); persistEcon(true); },
  refuel: (id, kind) => {
    const sp = fuelSpec(id);
    if (!sp.kinds.includes(kind)) return "kind";
    const need = sp.tank - fuelOf(id);
    if (need < 0.5) return "full";
    const money = useCareer.getState().money;
    const litres = Math.min(need, money / FUEL_PRICE[kind]);
    if (litres < 0.5) return "money";
    const cost = Math.max(1, Math.round(litres * FUEL_PRICE[kind]));
    useCareer.getState().addMoney(-Math.min(cost, money));
    fuelTank[id] = fuelOf(id) + litres;
    persistEcon(true);
    useHudStore.getState().showMsg(`${FUEL_LABEL[kind]}: +${litres.toFixed(0)} L  −$${cost}`);
    return "ok";
  },
  // fuel van: $40 for 10 L — free when broke, so nobody is ever stranded
  rescue: (id) => {
    const c = useCareer.getState();
    const cost = Math.min(RESCUE_PRICE, c.money);
    c.addMoney(-cost);
    fuelTank[id] = Math.min(fuelSpec(id).tank, fuelOf(id) + RESCUE_LITRES);
    persistEcon(true);
    useHudStore.getState().showMsg(`FUEL VAN: +${RESCUE_LITRES} L  −$${cost}`);
    return cost;
  },
}));

/** one-shot repair request, consumed by Car.tsx (which owns the damage state) */
export const carRepair = { pending: false };
export const repairCost = (damage: number) => (damage < 0.02 ? 0 : Math.round(REPAIR_BASE + damage * REPAIR_PER));
