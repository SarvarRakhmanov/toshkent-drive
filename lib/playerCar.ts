import { create } from "zustand";

// Sarvar's own Toshkent Drive cars (from the Grok Build project), used as the
// player car body. rotY turns each model so its nose faces +z (this engine's
// forward); length is the real-world body length in metres.
import type { VehicleSpec } from "@/lib/vehicleDynamics";
import type { EngineProfileId } from "@/lib/engineSound";

export interface PlayerCarDef {
  id: string;
  name: string;
  url: string;
  rotY: number;
  length: number;
  paint?: RegExp; // material-name pattern that takes the paint colour
  color?: string;
  /** Uzbek licence plate (pre-baked by scripts/make-plates.py): texture url and
   *  plate-centre heights above the ground (m); depth is found by raycasting
   *  onto the bumper so the plate sits just off the body surface. */
  plate?: { url?: string; text: string; frontY: number; rearY: number };
  /** Cockpit camera (v1.4): which shared interior (components/CarInterior.tsx)
   *  and the driver's eye in the car's local frame — x = toward the driver's
   *  door (+ = left, LHD), y = metres above the ground, z = forward of the
   *  body centre. */
  cockpit: { interior: "gt" | "classic" | "sedan" | "suv" | "sport"; eye: [number, number, number]; scale?: number };
  /** v1.6 driving physics (lib/vehicleDynamics.ts BASE_SPEC overrides) */
  phys?: Partial<VehicleSpec>;
  /** v1.6 engine voice (lib/engineSound.ts) */
  sound?: EngineProfileId;
}

// v1.6 physics from the real cars (manufacturer data; ½ρCdA from Cd × frontal area):
//   Seltos 1.6 T-GDI 177 hp / 265 Nm @1600-4500, 7DCT, FWD, ~1420 kg, 235/45R18 — 0-100 ≈ 9 s, 200 km/h
//   Lacetti 1.6 (F16D3) 109 hp / 150 Nm @4000, 5MT, FWD, ~1200 kg, 195/55R15 — 0-100 ≈ 11.5 s, 187 km/h
//   BMW M3 E30 (S14 2.3) 195 hp / 230 Nm @4750, Getrag 5MT, RWD, ~1200 kg, 205/55R15 — 0-100 ≈ 6.7 s, 235 km/h
//   Kia K5 2.5 MPI 194 hp / 246 Nm @4000, 8AT, FWD, ~1480 kg, 235/45R18 — 0-100 ≈ 8.6 s, 210 km/h
//   BMW M3 Competition (S58) 510 hp / 650 Nm @2750-5500, 8AT, RWD, ~1730 kg — 0-100 ≈ 3.9 s, 250 km/h limited
//   Chevrolet Cobalt LTZ 1.5 (B15D2) 105 hp / 134 Nm @4000, 6AT, FWD, ~1190 kg, 195/65R15 — 0-100 ≈ 12.5 s, 170 km/h
//   Chevrolet Captiva 2.4 (LE9) 167 hp / 230 Nm @4600, 6AT, AWD, ~1800 kg, 235/60R17 — 0-100 ≈ 11.5 s, 186 km/h
//   Lada VAZ-2103 1.45 (2103 carb) 77 hp / 106 Nm @3400, 4MT, RWD, ~1030 kg, 165/80R13 — 0-100 ≈ 17 s, 152 km/h
export const PLAYER_CARS: PlayerCarDef[] = [
  { id: "seltos", name: "KIA SELTOS", url: "/models/cars/seltos.glb", rotY: Math.PI / 2, length: 4.37, paint: /carpaint/i, color: "#b7c0b0", plate: { text: "01 D 666 FB", frontY: 0.57, rearY: 0.9 }, cockpit: { interior: "suv", eye: [0.37, 1.34, -0.12] }, phys: { wheelRadius: 0.335, mass: 1420, wheelbase: 2.63, track: 1.6, cgHeight: 0.62, frontWeight: 0.61, drive: "fwd", peakTorque: 265, peakRpm: 1600, idleRpm: 750, redline: 6500, gears: [3.64, 2.26, 1.45, 1.03, 0.83, 0.69, 0.58], finalDrive: 4.3, shiftTime: 0.12, mu: 1.15, brakeDecel: 10, dragArea: 0.53 }, sound: "i4turbo" },
  { id: "lacetti", name: "CHEVROLET LACETTI", url: "/models/cars/lacetti.glb", rotY: 0, length: 4.51, plate: { text: "90 O 909 BA", frontY: 0.4, rearY: 0.7 }, cockpit: { interior: "sedan", eye: [0.36, 1.14, -0.22], scale: 1.04 }, phys: { wheelRadius: 0.3, mass: 1200, wheelbase: 2.6, track: 1.48, frontWeight: 0.61, drive: "fwd", peakTorque: 150, peakRpm: 4000, idleRpm: 800, redline: 6400, gears: [3.55, 1.95, 1.28, 0.95, 0.76], finalDrive: 4.18, shiftTime: 0.25, mu: 1.12, brakeDecel: 9.5, dragArea: 0.37 }, sound: "i4small" },
  { id: "m3", name: "BMW M3 E30", url: "/models/cars/bmw-m3.glb", rotY: 0, length: 4.36, paint: /body|paint|carpaint/i, color: "#e8e6e0", cockpit: { interior: "sport", eye: [0.35, 1.09, -0.3] }, phys: { wheelRadius: 0.304, mass: 1200, wheelbase: 2.56, track: 1.42, frontWeight: 0.52, cgHeight: 0.48, drive: "rwd", peakTorque: 230, peakRpm: 4750, idleRpm: 900, redline: 7250, gears: [3.72, 2.4, 1.77, 1.26, 1.0], finalDrive: 3.25, shiftTime: 0.2, mu: 1.25, rearGripBias: 0.96, brakeDecel: 10.5, dragArea: 0.38 }, sound: "i4race" },
  { id: "k5", name: "KIA K5", url: "/models/cars/k5.glb", rotY: 0, length: 4.7, paint: /body|paint|carpaint/i, color: "#1c2126", cockpit: { interior: "sedan", eye: [0.38, 1.14, -0.2] }, phys: { wheelRadius: 0.335, mass: 1480, wheelbase: 2.85, track: 1.6, frontWeight: 0.61, drive: "fwd", peakTorque: 246, peakRpm: 4000, idleRpm: 700, redline: 6600, gears: [4.81, 2.9, 1.86, 1.42, 1.2, 1.0, 0.78, 0.65], finalDrive: 3.2, shiftTime: 0.15, mu: 1.18, brakeDecel: 10, dragArea: 0.36 }, sound: "i4turbo" },
  // "BMW M3 Competition" by VTX (Sketchfab), CC BY-NC-SA 4.0, decimated/compressed (see CREDITS.md)
  { id: "m3c", name: "BMW M3 COMPETITION", url: "/models/cars/bmw-m3-competition.glb", rotY: Math.PI, length: 4.79, cockpit: { interior: "sport", eye: [0.38, 1.1, -0.35], scale: 1.0 }, phys: { mass: 1730, wheelbase: 2.86, frontWeight: 0.53, cgHeight: 0.47, track: 1.6, drive: "rwd", peakTorque: 650, peakRpm: 2750, idleRpm: 800, redline: 7200, gears: [5.0, 3.2, 2.14, 1.72, 1.31, 1.0, 0.82, 0.64], finalDrive: 3.15, wheelRadius: 0.34, shiftTime: 0.1, mu: 1.4, rearGripBias: 0.97, dragArea: 0.45, brakeDecel: 12, limiterKmh: 250 }, sound: "i6turbo" },
  // v1.7b: "Chevrolet Cobalt LTZ" by uzb_rx7, "Chevrolet Captiva" by Alien1974555,
  // "Lada VAZ-2103 Zhiguli" by Black Snow (Sketchfab, CC BY 4.0; see CREDITS.md)
  { id: "cobalt", name: "CHEVROLET COBALT", url: "/models/cars/cobalt.glb", rotY: Math.PI, length: 4.48, plate: { text: "01 R 505 RB", frontY: 0.38, rearY: 0.72 }, cockpit: { interior: "sedan", eye: [0.36, 1.13, -0.2] }, phys: { wheelRadius: 0.317, mass: 1190, wheelbase: 2.62, track: 1.49, frontWeight: 0.62, drive: "fwd", peakTorque: 134, peakRpm: 4000, idleRpm: 750, redline: 6200, gears: [4.45, 2.91, 1.89, 1.45, 1.0, 0.75], finalDrive: 3.53, shiftTime: 0.3, mu: 1.08, brakeDecel: 9.3, dragArea: 0.42 }, sound: "i4eco" },
  { id: "captiva", name: "CHEVROLET CAPTIVA", url: "/models/cars/captiva.glb", rotY: 0, length: 4.67, plate: { text: "01 A 092 CB", frontY: 0.5, rearY: 0.95 }, cockpit: { interior: "suv", eye: [0.38, 1.42, -0.1] }, phys: { wheelRadius: 0.36, mass: 1800, wheelbase: 2.71, track: 1.57, cgHeight: 0.7, frontWeight: 0.58, drive: "awd", peakTorque: 230, peakRpm: 4600, idleRpm: 700, redline: 6300, gears: [4.58, 2.96, 1.91, 1.45, 1.0, 0.75], finalDrive: 3.23, shiftTime: 0.28, mu: 1.1, brakeDecel: 9.5, dragArea: 0.62 }, sound: "i4suv" },
  { id: "lada2103", name: "LADA VAZ-2103", url: "/models/cars/lada2103.glb", rotY: 0, length: 4.12, plate: { text: "01 000 OOO", frontY: 0.42, rearY: 0.62 }, cockpit: { interior: "classic", eye: [0.33, 1.12, -0.25] }, phys: { wheelRadius: 0.29, mass: 1030, wheelbase: 2.42, track: 1.37, cgHeight: 0.56, frontWeight: 0.53, drive: "rwd", peakTorque: 106, peakRpm: 3400, idleRpm: 850, redline: 6000, gears: [3.75, 2.3, 1.49, 1.0], finalDrive: 4.1, shiftTime: 0.45, mu: 0.98, rearGripBias: 0.95, brakeDecel: 8.5, dragArea: 0.54 }, sound: "i4carb" },
];

const KEY = "td_player_car";

function initial(): number {
  if (typeof window === "undefined") return 0;
  const n = Number(localStorage.getItem(KEY));
  return Number.isInteger(n) && n >= 0 && n < PLAYER_CARS.length ? n : 0;
}

interface PlayerCarState {
  index: number;
  next: () => void;
  select: (i: number) => void;
}

export const usePlayerCarStore = create<PlayerCarState>((set, get) => ({
  index: initial(),
  next: () => {
    const index = (get().index + 1) % PLAYER_CARS.length;
    try { localStorage.setItem(KEY, String(index)); } catch { /* private mode */ }
    set({ index });
  },
  select: (i: number) => {
    const index = ((Math.round(i) % PLAYER_CARS.length) + PLAYER_CARS.length) % PLAYER_CARS.length;
    try { localStorage.setItem(KEY, String(index)); } catch { /* private mode */ }
    set({ index });
  },
}));
