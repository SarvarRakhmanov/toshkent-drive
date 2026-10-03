import { create } from "zustand";

// Sarvar's own Toshkent Drive cars (from the Grok Build project), used as the
// player car body. rotY turns each model so its nose faces +z (this engine's
// forward); length is the real-world body length in metres.
export interface PlayerCarDef {
  id: string;
  name: string;
  url: string;
  rotY: number;
  length: number;
  paint?: RegExp; // material-name pattern that takes the paint colour
  color?: string;
}

export const PLAYER_CARS: PlayerCarDef[] = [
  { id: "seltos", name: "KIA SELTOS", url: "/models/cars/seltos.glb", rotY: Math.PI / 2, length: 4.37, paint: /carpaint/i, color: "#b7c0b0" },
  { id: "lacetti", name: "CHEVROLET LACETTI", url: "/models/cars/lacetti.glb", rotY: 0, length: 4.51 },
  { id: "m3", name: "BMW M3 E30", url: "/models/cars/bmw-m3.glb", rotY: 0, length: 4.36, paint: /body|paint|carpaint/i, color: "#e8e6e0" },
  { id: "k5", name: "KIA K5", url: "/models/cars/k5.glb", rotY: 0, length: 4.7, paint: /body|paint|carpaint/i, color: "#1c2126" },
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
}

export const usePlayerCarStore = create<PlayerCarState>((set, get) => ({
  index: initial(),
  next: () => {
    const index = (get().index + 1) % PLAYER_CARS.length;
    try { localStorage.setItem(KEY, String(index)); } catch { /* private mode */ }
    set({ index });
  },
}));
