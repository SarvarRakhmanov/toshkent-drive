import { create } from "zustand";
import { LANDMARKS, type Landmark } from "@/lib/landmarks";
import type { CarStyle } from "@/components/SupercarBody";

// airliner1/2/3 = the three gate-parked wide-bodies (components/Airport.tsx's
// GATE_XS, gates 2/3/4), airlinerCargo = the freighter on the cargo apron.
// The one airframe NOT in this union is the broken jet
// (components/AirportLife.tsx's BrokenJet) — it has no vehicleState entry, no
// mount trigger, nothing to fly, by design (wing off, under repair forever).
export type AirlinerId = "airliner1" | "airliner2" | "airliner3" | "airlinerCargo";
// FORT NEON's three apron fighters (components/DrivableFighterJet.tsx) — same
// "one component parameterized over several parked airframes" shape as
// AirlinerId above, one id per lib/militaryBase.ts JET_APRON slot.
export type FighterJetId = "jet1" | "jet2" | "jet3";
export type VehicleKind = "car" | "boat" | "boat2" | "boat3" | "bike" | "policeCar" | "policeJeep" | "patrolBoat" | "plane" | "helicopter" | "militaryHeli" | "policeJet" | "jeep" | "bus" | "truck" | "tank" | AirlinerId | FighterJetId;
export type ActiveMode = VehicleKind | "foot";
export const CAM_MODES = ["CHASE", "COCKPIT", "HOOD", "CINE"] as const;
export type CamMode = 0 | 1 | 2 | 3;
// headlights, cycled with L — same three states and same order as the
// original's `lightMode` (index.html ~6480): AUTO follows the day/night
// cycle, ON forces them on in daylight, OFF kills them entirely
export const LIGHT_MODES = ["AUTO", "ON", "OFF"] as const;
export type LightMode = 0 | 1 | 2;

// B still only quick-switches the original 3 owned vehicles — policeCar/patrolBoat/
// plane/helicopter/airliner1/airliner2/airliner3/airlinerCargo are parked at the
// station/marina/airport and reached by walking up + E, same as any other
// vehicle (see lib/player.ts's mount scan, which is generic over VehicleKind)
const CYCLE: VehicleKind[] = ["car", "bike", "boat"];
export const VEHICLE_NAMES: Record<VehicleKind, string> = {
  car: "MY CAR",
  bike: "STREET BIKE",
  boat: "SEA SPRITE",
  boat2: "HARBOR SKIFF",
  boat3: "MARINA CRUISER",
  policeCar: "POLICE CRUISER",
  // the airport's security jeep (components/Airport.tsx's old GateGuardPost,
  // now components/PoliceJeep.tsx + a patrol lane in components/Traffic.tsx)
  policeJeep: "GATE SECURITY JEEP",
  patrolBoat: "HARBOR PATROL",
  plane: "SKY RUNNER",
  helicopter: "HARBOR CHOPPER",
  // FORT NEON's own chopper, on the second helipad lib/militaryBase.ts always
  // defined but nothing ever filled (components/MilitaryBase.tsx parks a
  // decorative one on the first)
  militaryHeli: "FORT NEON GUNSHIP",
  policeJet: "SKY MARSHAL",
  // parked/stealable commercial traffic (components/CommercialVehicle.tsx) —
  // mountable via E like policeCar/patrolBoat, not in the B-cycle CYCLE array
  jeep: "OFF-ROAD JEEP",
  bus: "CITY BUS",
  truck: "CARGO TRUCK",
  tank: "M1 ABRAMS",
  airliner1: "AZURE WINGS — GATE 2",
  airliner2: "CRIMSON SKYWAY — GATE 3",
  airliner3: "EMERALD PACIFIC — GATE 4",
  airlinerCargo: "VANGUARD CARGO",
  // FORT NEON's apron fighters — the fastest airframes in the game
  jet1: "FALCON 01",
  jet2: "FALCON 02",
  jet3: "FALCON 03",
};
// hulls — anything that floats, not just the original "boat". Used wherever a
// feature needs to exclude/include boats generically (club door, dock walking).
export const BOAT_KINDS: readonly VehicleKind[] = ["boat", "boat2", "boat3", "patrolBoat"];

let msgTimer: ReturnType<typeof setTimeout> | null = null;

interface HudState {
  speedKmh: number;
  grounded: boolean;
  active: ActiveMode;
  camMode: CamMode;
  lightMode: LightMode;
  hint: string | null;
  msg: string | null;
  nitroFuel: number; // 0..1
  nitroActive: boolean;
  clock: string;
  navTarget: Landmark | null;
  waypointDist: number;
  waypointDeg: number;
  mapOpen: boolean;
  phoneOpen: boolean;
  inClub: boolean;
  // which registered building (lib/buildings.ts) the player is currently
  // inside, or null while outdoors/inClub is false — selects which
  // building's InteriorComponent renders. inClub itself stays the plain
  // indoor/outdoor gate other systems (Weather/Headlights/Player) already key off.
  activeBuildingId: string | null;
  // VIP-lounge seat the player is currently sat in (lib/clubSeats.ts), or
  // null while standing/driving. Player.tsx freezes movement and snaps to
  // this spot every frame while set; E toggles it via seatAction().
  seatedAt: { x: number; y: number; z: number; ry: number } | null;
  // the #controls key-hint panel — H toggles it, matching the original's
  // index.html ~6490 (`p.style.display = p.style.display==='none'?'':'none'`)
  controlsVisible: boolean;
  // paint/roofline the player's sedan is currently wearing after a steal
  // (lib/steal.ts); null = its own factory colour. Consumed by Car.tsx.
  stolenCar: { color: string; style: CarStyle } | null;
  // picked up at the armory (lib/armory.ts, components/GunStore.tsx) — Player.tsx
  // reads this to gate F-key firing on foot, same lib/tankShell.ts fireQueue Tank.tsx uses
  hasGun: boolean;
  // picked up at the VENU ticket booth (lib/ticketBooth.ts) — lib/interiors.ts's
  // VENU registration (lib/club.ts) reads this via its optional `gate` field to
  // block the door until the player has one, same one-shot-flag shape as hasGun
  hasTicket: boolean;
  // multiplier on lib/cameraLook.ts's YAW/PITCH_SENSITIVITY, player-tunable
  // via the HUD slider (components/HUD.tsx). 1 = the tuned default feel.
  lookSensitivity: number;
  setHud: (speedKmh: number, grounded: boolean) => void;
  toggleActive: () => void;
  setActive: (m: ActiveMode) => void;
  setCamMode: (m: CamMode) => void;
  cycleCamMode: () => void;
  setLightMode: (m: LightMode) => void;
  cycleLightMode: () => LightMode;
  setHint: (h: string | null) => void;
  showMsg: (text: string) => void;
  setNitro: (fuel: number, active: boolean) => void;
  setClock: (c: string) => void;
  setWaypoint: (dist: number, deg: number) => void;
  setNavTarget: (l: Landmark) => void;
  setMapOpen: (open: boolean) => void;
  setPhoneOpen: (open: boolean) => void;
  setInClub: (v: boolean) => void;
  setActiveBuildingId: (id: string | null) => void;
  setSeatedAt: (v: { x: number; y: number; z: number; ry: number } | null) => void;
  toggleControlsVisible: () => void;
  setStolenCar: (v: { color: string; style: CarStyle } | null) => void;
  setHasGun: (v: boolean) => void;
  setHasTicket: (v: boolean) => void;
  setLookSensitivity: (v: number) => void;
  vehicleName: () => string;
}

const MIN_LOOK_SENS = 0.4;
const MAX_LOOK_SENS = 2.5;

// Per-frame vehicle telemetry, read by the HUD overlay. Kept out of React state on
// the vehicles themselves (that would re-render the whole scene every frame) — only
// the HUD component subscribes to speed/grounded, so only the HUD re-renders for
// those. `active`/`camMode` change rarely (a key press) so it's fine to read them
// in useFrame from vehicle components too.
export const useHudStore = create<HudState>((set, get) => ({
  speedKmh: 0,
  grounded: true,
  active: "car",
  camMode: 0,
  lightMode: 0,
  hint: null,
  msg: null,
  nitroFuel: 1,
  nitroActive: false,
  clock: "06:00",
  navTarget: LANDMARKS[0], // VENU, matches the original's default navTarget
  waypointDist: 0,
  waypointDeg: 0,
  mapOpen: false,
  phoneOpen: false,
  inClub: false,
  activeBuildingId: null,
  seatedAt: null,
  controlsVisible: false, // collapsed behind the "?" button (H) — the full list covered half a phone screen
  stolenCar: null,
  hasGun: false,
  hasTicket: false,
  lookSensitivity: 1,
  setHud: (speedKmh, grounded) => set({ speedKmh, grounded }),
  // no-ops while on foot — B is this build's own quick-switch between owned
  // vehicles, not a thing while walking (mount via E near a vehicle instead)
  toggleActive: () =>
    set((s) => (s.active === "foot" ? s : { active: CYCLE[(CYCLE.indexOf(s.active) + 1) % CYCLE.length] })),
  setActive: (m) => set({ active: m }),
  setCamMode: (m) => set({ camMode: m }),
  cycleCamMode: () => set((s) => ({ camMode: (((s.camMode + 1) % 4) as CamMode) })),
  setLightMode: (m) => set({ lightMode: m }),
  // returns the new mode so the caller can name it in the on-screen message
  // without a second getState() read
  cycleLightMode: () => {
    const next = (((get().lightMode + 1) % 3) as LightMode);
    set({ lightMode: next });
    return next;
  },
  setHint: (h) => set({ hint: h }),
  showMsg: (text) => {
    set({ msg: text });
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => set({ msg: null }), 2200);
  },
  setNitro: (fuel, active) => set({ nitroFuel: fuel, nitroActive: active }),
  setClock: (c) => set({ clock: c }),
  setWaypoint: (dist, deg) => set({ waypointDist: dist, waypointDeg: deg }),
  setNavTarget: (l) => set({ navTarget: l, mapOpen: false }),
  setMapOpen: (open) => set({ mapOpen: open }),
  setPhoneOpen: (open) => set({ phoneOpen: open }),
  setInClub: (v) => set({ inClub: v }),
  setActiveBuildingId: (id) => set({ activeBuildingId: id }),
  setSeatedAt: (v) => set({ seatedAt: v }),
  toggleControlsVisible: () => set((s) => ({ controlsVisible: !s.controlsVisible })),
  setStolenCar: (v) => set({ stolenCar: v }),
  setHasGun: (v) => set({ hasGun: v }),
  setHasTicket: (v) => set({ hasTicket: v }),
  setLookSensitivity: (v) =>
    set({ lookSensitivity: Math.max(MIN_LOOK_SENS, Math.min(MAX_LOOK_SENS, v)) }),
  vehicleName: () => {
    const a = get().active;
    return a === "foot" ? "ON FOOT" : VEHICLE_NAMES[a];
  },
}));
