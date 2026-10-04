import { create } from "zustand";

// v1.7.1: which world map is loaded. "toshkent" (default, unchanged) or
// "bigcity" — the same 100 m road grid (so traffic, signals, robots, missions,
// GPS/minimap and safe spawn keep working) but every block interior is filled
// with a real city block sliced from 4 Sketchfab city packs (components/BigCity.tsx).
// Switching saves the game and reloads the page: every chunk, collider and
// landmark is rebuilt from scratch, then the normal safe-spawn check runs.
export type MapId = "toshkent" | "bigcity";
export const MAP_KEY = "td_map";
export const MAP_LABEL: Record<MapId, string> = { toshkent: "TOSHKENT", bigcity: "BIG CITY" };

function initial(): MapId {
  if (typeof window === "undefined") return "toshkent";
  const q = /[?&]map=(toshkent|bigcity)/.exec(window.location.search);
  if (q) return q[1] as MapId;
  try { return localStorage.getItem(MAP_KEY) === "bigcity" ? "bigcity" : "toshkent"; } catch { return "toshkent"; }
}

/** read once per page load — the world is built for one map */
export const CURRENT_MAP: MapId = initial();
export const isBigCity = () => CURRENT_MAP === "bigcity";

interface MapState { map: MapId; switchTo: (m: MapId) => void }
export const useMapStore = create<MapState>(() => ({
  map: CURRENT_MAP,
  switchTo: (m) => {
    if (m === CURRENT_MAP) return;
    try { localStorage.setItem(MAP_KEY, m); } catch { /* private mode */ }
    // the caller saves the game first (see PauseMenu); drop a ?map= override so the choice sticks
    const url = new URL(window.location.href); url.searchParams.delete("map");
    window.location.replace(url.toString());
  },
}));
