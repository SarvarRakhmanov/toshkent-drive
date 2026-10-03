import { create } from "zustand";

// Toshkent Drive: one switch between a "high" look (soft shadows, N8AO
// ambient occlusion, bloom, SMAA, HDR image lighting) and a "low" one
// (no post-processing, no shadows, lower pixel ratio) for weak laptops/phones.
export type Quality = "high" | "low";
const KEY = "td_gfx_quality";

function initial(): Quality {
  if (typeof window === "undefined") return "high";
  const saved = localStorage.getItem(KEY);
  if (saved === "high" || saved === "low") return saved;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  return coarse ? "low" : "high";
}

interface GfxState {
  quality: Quality;
  setQuality: (q: Quality) => void;
  toggle: () => void;
}

export const useGfxStore = create<GfxState>((set, get) => ({
  quality: initial(),
  setQuality: (quality) => {
    try { localStorage.setItem(KEY, quality); } catch { /* private mode */ }
    set({ quality });
  },
  toggle: () => get().setQuality(get().quality === "high" ? "low" : "high"),
}));
