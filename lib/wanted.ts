import { create } from "zustand";
import { useHudStore } from "@/lib/hudStore";
import { useCareer } from "@/lib/career";

// v1.8 wanted level (0-5 stars). Crimes: running a red light, crashing into a
// car, hitting a pedestrian/robot. Police chase units (components/PoliceChase.tsx)
// spawn per star; getting caught (BUSTED) or escaping both cost a fine —
// caught pays the full fine on the spot, escaping gets a smaller camera fine.
export type Crime = "red" | "crash" | "ped";
const CRIME_STARS: Record<Crime, number> = { red: 1, crash: 1, ped: 2 };
const CRIME_TEXT: Record<Crime, string> = { red: "RAN A RED LIGHT", crash: "HIT A CAR", ped: "HIT A PEDESTRIAN" };
export const BUST_FINE_PER_STAR = 150;
export const ESCAPE_FINE_PER_STAR = 50;
export const MAX_STARS = 5;

// vehicles the police never chase you in (you ARE the police / out of reach)
const IMMUNE = new Set(["policeCar", "policeJeep", "patrolBoat", "policeJet"]);

interface WantedState {
  level: number;
  reason: string;
  /** seconds without a unit close — ESCAPED at ESCAPE_SECS */
  evade: number;
  /** seconds a unit has been right next to a (nearly) stopped player — BUSTED at BUST_SECS */
  bust: number;
  fines: number;
  report: (c: Crime) => void;
  clear: (how: "busted" | "escaped") => number;
}
export const ESCAPE_SECS = 15;
export const BUST_SECS = 2.5;
const lastCrime: Record<Crime, number> = { red: -1e9, crash: -1e9, ped: -1e9 };

export const useWanted = create<WantedState>((set, get) => ({
  level: 0, reason: "", evade: 0, bust: 0, fines: 0,
  report: (c) => {
    const active = useHudStore.getState().active;
    if (IMMUNE.has(active)) return;
    const now = performance.now();
    if (now - lastCrime[c] < 4000) return; // one count per incident
    lastCrime[c] = now;
    const level = Math.min(MAX_STARS, get().level + CRIME_STARS[c]);
    set({ level, reason: CRIME_TEXT[c], evade: 0 });
    useHudStore.getState().showMsg(`WANTED ${"★".repeat(level)} — ${CRIME_TEXT[c]}`);
  },
  clear: (how) => {
    const lv = get().level;
    if (!lv) return 0;
    const fine = lv * (how === "busted" ? BUST_FINE_PER_STAR : ESCAPE_FINE_PER_STAR);
    const paid = Math.min(fine, useCareer.getState().money);
    useCareer.getState().addMoney(-paid);
    set({ level: 0, reason: "", evade: 0, bust: 0, fines: get().fines + paid });
    useHudStore.getState().showMsg(how === "busted" ? `BUSTED! FINE $${fine}` : `ESCAPED — CAMERA FINE $${fine}`);
    return fine;
  },
}));
