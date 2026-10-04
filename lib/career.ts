import { create } from "zustand";
import { STOCK, type Upgrades } from "@/lib/vehicleDynamics";
import { useAuthStore } from "@/lib/authStore";

// v1.9 career: money earned from missions (lib/missions.ts) and per-car
// upgrade levels that feed straight into the physics multipliers
// (lib/vehicleDynamics.ts effectiveSpec → components/Car.tsx specCache).
// Saved to localStorage per signed-in account, next to lib/saveGame.ts's own
// world save, on every change (purchases / payouts are rare events).

export type UpgradeKey = keyof Upgrades;
export const UPGRADE_KEYS: UpgradeKey[] = ["power", "grip", "brakes", "weight"];
export const UPGRADE_LABEL: Record<UpgradeKey, string> = { power: "Engine tune", grip: "Tyres", brakes: "Brakes", weight: "Weight reduction" };
/** multiplier per level (index 0 = stock) */
export const UPGRADE_STEPS: Record<UpgradeKey, number[]> = {
  power: [1, 1.08, 1.17, 1.28],
  grip: [1, 1.05, 1.1, 1.16],
  brakes: [1, 1.08, 1.16, 1.25],
  weight: [1, 0.97, 0.94, 0.9],
};
export const MAX_LEVEL = 3;
/** price of buying level n (n = 1..3) */
export const UPGRADE_COST = [0, 400, 950, 2000];

type Levels = Record<UpgradeKey, number>;
const ZERO: Levels = { power: 0, grip: 0, brakes: 0, weight: 0 };

interface CareerData {
  money: number;
  earned: number;
  jobs: number;
  best: Record<string, number>; // race id → best seconds
  levels: Record<string, Levels>; // car id → upgrade levels
  /** v1.8.1 settings toggle: purchases/fines never reduce money (shows ∞) */
  infinite: boolean;
}

interface CareerState extends CareerData {
  /** bumps on any upgrade change so Car.tsx can re-derive its spec */
  rev: number;
  loaded: boolean;
  load: () => void;
  addMoney: (n: number) => void;
  finishJob: (pay: number) => void;
  setBest: (id: string, secs: number) => boolean;
  levelsFor: (carId: string) => Levels;
  upgradesFor: (carId: string) => Upgrades;
  buy: (carId: string, key: UpgradeKey) => "ok" | "max" | "money";
  setInfinite: (on: boolean) => void;
  /** money available to spend (Infinity with the infinite-money toggle) */
  spendable: () => number;
}

/** "$1,234" or "∞" */
export function moneyText(money: number, infinite: boolean): string {
  return infinite ? "$∞" : `$${money.toLocaleString("en-US")}`;
}

function key(): string {
  return `td_career_v1:${useAuthStore.getState().user?.id ?? "guest"}`;
}

function persist(s: CareerData) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key(), JSON.stringify({ money: s.money, earned: s.earned, jobs: s.jobs, best: s.best, levels: s.levels, infinite: s.infinite }));
  } catch {
    /* storage full / private mode */
  }
}

export const useCareer = create<CareerState>((set, get) => ({
  money: 0,
  earned: 0,
  jobs: 0,
  best: {},
  levels: {},
  infinite: false,
  rev: 0,
  loaded: false,
  load: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(key());
      const d = raw ? (JSON.parse(raw) as Partial<CareerData>) : {};
      set({
        money: Math.max(0, Number(d.money) || 0),
        earned: Math.max(0, Number(d.earned) || 0),
        jobs: Math.max(0, Number(d.jobs) || 0),
        best: d.best && typeof d.best === "object" ? d.best : {},
        levels: d.levels && typeof d.levels === "object" ? d.levels : {},
        infinite: d.infinite === true,
        loaded: true,
        rev: get().rev + 1,
      });
    } catch {
      set({ loaded: true });
    }
  },
  addMoney: (n) => {
    if (n < 0 && get().infinite) return; // infinite money: spending is free
    set((s) => ({ money: Math.max(0, Math.round(s.money + n)), earned: s.earned + Math.max(0, Math.round(n)) }));
    persist(get());
  },
  finishJob: (pay) => {
    set((s) => ({ money: s.money + Math.round(pay), earned: s.earned + Math.round(pay), jobs: s.jobs + 1 }));
    persist(get());
  },
  setBest: (id, secs) => {
    const prev = get().best[id];
    if (prev !== undefined && prev <= secs) return false;
    set((s) => ({ best: { ...s.best, [id]: Math.round(secs * 10) / 10 } }));
    persist(get());
    return true;
  },
  levelsFor: (carId) => ({ ...ZERO, ...(get().levels[carId] ?? {}) }),
  upgradesFor: (carId) => {
    const l = get().levelsFor(carId);
    const u = { ...STOCK };
    for (const k of UPGRADE_KEYS) u[k] = UPGRADE_STEPS[k][Math.min(MAX_LEVEL, Math.max(0, l[k] | 0))];
    return u;
  },
  buy: (carId, k) => {
    const l = get().levelsFor(carId);
    if (l[k] >= MAX_LEVEL) return "max";
    const cost = UPGRADE_COST[l[k] + 1];
    if (get().spendable() < cost) return "money";
    set((s) => ({ money: s.infinite ? s.money : s.money - cost, levels: { ...s.levels, [carId]: { ...l, [k]: l[k] + 1 } }, rev: s.rev + 1 }));
    persist(get());
    return "ok";
  },
  setInfinite: (on) => {
    set({ infinite: on });
    persist(get());
  },
  spendable: () => (get().infinite ? Infinity : get().money),
}));
