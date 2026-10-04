import { create } from "zustand";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { LANDMARKS, type Landmark } from "@/lib/landmarks";
import { useCareer } from "@/lib/career";
import { roadRoute } from "@/lib/route";
import { playSfx } from "@/lib/missionSfx";
import { skyState } from "@/lib/skyState";

// v1.9 missions: TAXI (pick up a fare, drop them off), DELIVERY (collect a
// parcel at one landmark, deliver to another), STREET RACE (checkpoint run
// against the clock). Every target is a point on the road grid, shown with
// the GPS (hud navTarget → minimap / big-map route via lib/route.ts) and a
// light-beam marker (components/Missions.tsx). Payouts go to lib/career.ts.

export type MissionKind = "taxi" | "delivery" | "race" | "night";
/** v1.8 night jobs: 20:00-05:00 only, 1.8x pay (lib/skyState.ts hour) */
export const NIGHT_PAY = 1.8;
export const isNightHour = () => skyState.hour >= 20 || skyState.hour < 5;

export interface Mission {
  kind: MissionKind;
  title: string;
  stage: number; // index into targets
  targets: { x: number; z: number; label: string; radius: number; stop: boolean }[];
  timeLeft: number;
  elapsed: number;
  pay: number;
  raceId?: string;
}

interface MissionState {
  m: Mission | null;
  /** last result line shown in the mission panel for a few seconds */
  result: { text: string; good: boolean; until: number } | null;
  prevNav: Landmark | null;
  start: (kind: MissionKind) => string | null;
  cancel: () => void;
}

const CELL = 100;
const X_MIN = -420, X_MAX = 520, Z_MIN = -350, Z_MAX = 350; // city land, clear of airport fence / shore / bridge
const roadOf = (v: number) => Math.round((v - 50) / CELL) * CELL + 50;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** a point on a road centreline near (x,z), mid-block (never in a junction) */
function roadPoint(x: number, z: number): { x: number; z: number } {
  x = clamp(x, X_MIN, X_MAX);
  z = clamp(z, Z_MIN, Z_MAX);
  if (Math.random() < 0.5) {
    const rz = Math.round(z / CELL) * CELL + (Math.random() < 0.5 ? -22 : 22);
    return { x: roadOf(x) + 6, z: rz }; // kerb side of a N-S street
  }
  const rx = Math.round(x / CELL) * CELL + (Math.random() < 0.5 ? -22 : 22);
  return { x: rx, z: roadOf(z) + 6 };
}

function randomAround(x: number, z: number, rMin: number, rMax: number) {
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
    const p = roadPoint(x + Math.sin(a) * r, z + Math.cos(a) * r);
    const d = Math.hypot(p.x - x, p.z - z);
    if (d >= rMin * 0.8 && Math.abs(p.z) < 360 && !(Math.abs(p.z - -400) < 30)) return p;
  }
  return roadPoint(x + rMin, z);
}

/** driving distance along the grid (one-turn Manhattan route) */
export function routeLen(ax: number, az: number, bx: number, bz: number): number {
  const r = roadRoute(ax, az, bx, bz);
  let s = 0;
  for (let i = 1; i < r.length; i++) s += Math.abs(r[i].x - r[i - 1].x) + Math.abs(r[i].z - r[i - 1].z);
  return s;
}

const NAMES = ["Dilnoza", "Jasur", "Malika", "Bekzod", "Nodira", "Sardor", "Shahzoda", "Otabek", "Gulnora", "Aziz"];
const PARCELS = ["somsa order", "plov kazan", "flower bouquet", "phone repair", "bread from the tandir", "wedding cake"];

function landmarkRoad(l: Landmark) {
  // landmarks sit on blocks or junction centres — pull onto the nearest road, off the junction
  const onX = Math.abs(((l.x - 50) % 100 + 100) % 100) < 1 || Math.abs(((l.x - 50) % 100 + 100) % 100) > 99;
  return onX ? { x: l.x + 6, z: Math.round(l.z / CELL) * CELL + 20 } : { x: roadOf(l.x) + 6, z: Math.round(l.z / CELL) * CELL + 20 };
}

function setNav(name: string, x: number, z: number, col: string) {
  useHudStore.getState().setNavTarget({ name, x, z, col });
}

const KIND_COL: Record<MissionKind, string> = { taxi: "#ffd21f", delivery: "#38e07b", race: "#ff4fd8", night: "#9b7bff" };
export const missionColor = (k: MissionKind) => KIND_COL[k];

export const useMissions = create<MissionState>((set, get) => ({
  m: null,
  result: null,
  prevNav: null,
  start: (kind) => {
    const hud = useHudStore.getState();
    if (hud.active === "foot") return "GET IN A CAR FIRST";
    const px = worldState.px, pz = worldState.pz;
    if (px < X_MIN - 80 || px > X_MAX + 60 || Math.abs(pz) > 420) return "DRIVE BACK INTO THE CITY";
    let m: Mission;
    if (kind === "night" && !isNightHour()) return "NIGHT JOBS START AT 20:00";
    if (kind === "taxi" || kind === "night") {
      const a = randomAround(px, pz, 110, 240);
      const b = randomAround(a.x, a.z, 280, 560);
      const who = NAMES[(Math.random() * NAMES.length) | 0];
      const len = routeLen(a.x, a.z, b.x, b.z);
      m = {
        kind, title: kind === "night" ? `NIGHT TAXI — ${who}` : `TAXI — ${who}`, stage: 0, elapsed: 0,
        targets: [
          { ...a, label: `Pick up ${who}`, radius: 9, stop: true },
          { ...b, label: `Drop ${who} off`, radius: 9, stop: true },
        ],
        timeLeft: routeLen(px, pz, a.x, a.z) / 9 + 25,
        pay: Math.round((40 + len * 0.22) * (kind === "night" ? NIGHT_PAY : 1)),
      };
    } else if (kind === "delivery") {
      const lm = LANDMARKS.filter((l) => l.x > X_MIN && l.x < X_MAX && Math.abs(l.z) < 340);
      const near = [...lm].sort((p, q) => Math.hypot(p.x - px, p.z - pz) - Math.hypot(q.x - px, q.z - pz));
      const from = near[(Math.random() * Math.min(3, near.length)) | 0];
      const far = lm.filter((l) => Math.hypot(l.x - from.x, l.z - from.z) > 220);
      const to = far[(Math.random() * far.length) | 0] ?? near[near.length - 1];
      const a = landmarkRoad(from), b = landmarkRoad(to);
      const item = PARCELS[(Math.random() * PARCELS.length) | 0];
      const len = routeLen(a.x, a.z, b.x, b.z);
      m = {
        kind, title: `DELIVERY — ${item}`, stage: 0, elapsed: 0,
        targets: [
          { ...a, label: `Collect at ${from.name}`, radius: 10, stop: true },
          { ...b, label: `Deliver to ${to.name}`, radius: 10, stop: true },
        ],
        timeLeft: routeLen(px, pz, a.x, a.z) / 9 + 30,
        pay: Math.round(80 + len * 0.3),
      };
    } else {
      // checkpoint run along the grid: 6 junction-to-junction legs
      const pts: { x: number; z: number; label: string; radius: number; stop: boolean }[] = [];
      let x = roadOf(px), z = roadOf(pz);
      let total = Math.abs(x - px) + Math.abs(z - pz);
      let lastAxis = -1;
      for (let i = 0; i < 6; i++) {
        const axis = lastAxis === 0 ? 1 : lastAxis === 1 ? 0 : Math.random() < 0.5 ? 0 : 1;
        lastAxis = axis;
        const steps = (2 + ((Math.random() * 2) | 0)) * CELL * (Math.random() < 0.5 ? -1 : 1);
        let nx = x, nz = z;
        if (axis === 0) nx = clamp(x + steps, roadOf(X_MIN + 50), roadOf(X_MAX - 50));
        else nz = clamp(z + steps, roadOf(Z_MIN + 50), roadOf(Z_MAX - 50));
        if (nx === x && nz === z) { if (axis === 0) nx = x - steps; else nz = z - steps; }
        total += Math.abs(nx - x) + Math.abs(nz - z);
        x = nx; z = nz;
        pts.push({ x, z, label: i === 5 ? "FINISH" : `Checkpoint ${i + 1}/5`, radius: 13, stop: false });
      }
      m = {
        kind, title: "STREET RACE", stage: 0, elapsed: 0, targets: pts,
        timeLeft: total / 17 + 12, pay: Math.round(150 + total * 0.18),
        raceId: `${Math.round(px / CELL)},${Math.round(pz / CELL)}:${pts.length}`,
      };
    }
    const prev = get().m ? get().prevNav : hud.navTarget;
    set({ m, prevNav: prev, result: null });
    const t = m.targets[0];
    setNav(t.label.toUpperCase(), t.x, t.z, KIND_COL[kind]);
    hud.showMsg(`${m.title}: ${t.label.toUpperCase()}`);
    playSfx("start");
    return null;
  },
  cancel: () => {
    const { prevNav } = get();
    set({ m: null, result: { text: "JOB CANCELLED", good: false, until: performance.now() + 3000 } });
    if (prevNav) useHudStore.getState().setNavTarget(prevNav);
  },
}));

/** advance the active mission; called every frame from components/Missions.tsx */
export function stepMissions(dt: number) {
  const st = useMissions.getState();
  const m = st.m;
  if (!m) return;
  const hud = useHudStore.getState();
  m.elapsed += dt;
  m.timeLeft -= dt;
  const t = m.targets[m.stage];
  const d = Math.hypot(worldState.px - t.x, worldState.pz - t.z);
  const slowEnough = !t.stop || hud.speedKmh < 18;
  if (d < t.radius && slowEnough && hud.active !== "foot") {
    m.stage++;
    if (m.stage >= m.targets.length) {
      let pay = m.pay;
      let extra = "";
      if (m.kind === "race" && m.raceId) {
        if (useCareer.getState().setBest(m.raceId, m.elapsed)) extra = " NEW BEST!";
        pay += Math.round(Math.max(0, m.timeLeft) * 6);
      } else if (m.timeLeft > 0) {
        const tip = Math.round(Math.min(0.5, m.timeLeft / 60) * m.pay);
        pay += tip;
        if (tip > 0) extra = ` +$${tip} tip`;
      }
      useCareer.getState().finishJob(pay);
      useMissions.setState({ m: null, result: { text: `JOB DONE  +$${pay}${extra}  (${m.elapsed.toFixed(1)} s)`, good: true, until: performance.now() + 5000 } });
      hud.showMsg(`+$${pay}${extra}`);
      if (st.prevNav) hud.setNavTarget(st.prevNav);
      playSfx("done");
      return;
    }
    const n = m.targets[m.stage];
    if (m.kind === "taxi" || m.kind === "delivery") m.timeLeft = Math.max(m.timeLeft, 0) + routeLen(t.x, t.z, n.x, n.z) / 10 + 15;
    setNav(n.label.toUpperCase(), n.x, n.z, KIND_COL[m.kind]);
    hud.showMsg(n.label.toUpperCase());
    playSfx("check");
  }
  if (m.timeLeft <= 0 && m.kind === "race") {
    useMissions.setState({ m: null, result: { text: "RACE LOST — OUT OF TIME", good: false, until: performance.now() + 4000 } });
    if (st.prevNav) hud.setNavTarget(st.prevNav);
    playSfx("fail");
  }
  // taxi / delivery never fail on time: running late only loses the tip
}
