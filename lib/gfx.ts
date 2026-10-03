import { create } from "zustand";
import { detectTouch } from "@/lib/touch";

// Toshkent Drive: one switch between a "high" look (soft shadows, N8AO
// ambient occlusion, bloom, SMAA, HDR image lighting) and a "low" one
// (no post-processing, no shadows, lower pixel ratio, shorter fog/draw
// distance, fewer lights/traffic) for weak laptops/phones.
export type Quality = "high" | "low";
const KEY = "td_gfx_quality";

/** Phone/tablet (touch-first) or a small screen — decided once per page load. */
export const IS_MOBILE: boolean =
  typeof window !== "undefined" &&
  (detectTouch() || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(window.innerWidth, window.innerHeight) < 600);

function initial(): Quality {
  if (typeof window === "undefined") return "high";
  const q = /[?&]q=(high|low)/.exec(window.location.search);
  if (q) return q[1] as Quality;
  const saved = localStorage.getItem(KEY);
  if (saved === "high" || saved === "low") return saved;
  // phones/tablets start on LOW (no shadows/post-processing, reduced pixel ratio)
  return IS_MOBILE ? "low" : "high";
}

/** Everything that differs between the tiers, in one place. */
export interface GfxProfile {
  quality: Quality;
  mobile: boolean;
  /** Canvas dpr: [min, max] for R3F (clamped to the device ratio). */
  dpr: [number, number];
  shadows: false | "soft" | "basic";
  shadowMapSize: number;
  postFX: boolean;
  antialias: boolean;
  /** HDR environment map (1.4 MB) vs. a tiny generated room environment. */
  hdrEnv: boolean;
  /** Multiplier on every fog near/far distance — the camera far plane follows fog.far. */
  fogScale: number;
  /** Max real point lights in the scene; the rest are pooled (lib/lightPool). */
  pointLights: number;
  /** Fraction of the optional traffic lanes that run. */
  trafficExtra: boolean;
  /** Draw distance for NPC traffic/pedestrian meshes. */
  npcDrawDist: number;
}

export function profileFor(quality: Quality, dprScale = 1): GfxProfile {
  const mobile = IS_MOBILE;
  const devDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  if (quality === "high") {
    const max = (mobile ? 1.25 : 1.5) * dprScale;
    return {
      quality, mobile,
      dpr: [Math.min(1, devDpr, max), Math.min(devDpr, max)],
      shadows: mobile ? "basic" : "soft",
      shadowMapSize: mobile ? 1024 : 2048,
      postFX: !mobile,
      antialias: mobile, // desktop gets SMAA in the composer instead of MSAA
      hdrEnv: true,
      fogScale: 1,
      pointLights: mobile ? 4 : 8,
      trafficExtra: true,
      npcDrawDist: 320,
    };
  }
  const r = Math.min(devDpr, 1) * dprScale;
  return {
    quality, mobile,
    dpr: [r, r],
    shadows: false,
    shadowMapSize: 512,
    postFX: false,
    antialias: false,
    hdrEnv: false,
    fogScale: 0.42,
    pointLights: 2,
    trafficExtra: !mobile,
    npcDrawDist: 170,
  };
}

interface GfxState {
  quality: Quality;
  /** Extra pixel-ratio multiplier the auto-quality monitor lowers on slow devices. */
  dprScale: number;
  setQuality: (q: Quality) => void;
  setDprScale: (s: number) => void;
  toggle: () => void;
}

export const useGfxStore = create<GfxState>((set, get) => ({
  quality: initial(),
  dprScale: 1,
  setQuality: (quality) => {
    try { localStorage.setItem(KEY, quality); } catch { /* private mode */ }
    set({ quality, dprScale: 1 });
  },
  setDprScale: (dprScale) => set({ dprScale }),
  toggle: () => get().setQuality(get().quality === "high" ? "low" : "high"),
}));

/** Non-reactive read for per-frame code. */
export function currentProfile(): GfxProfile {
  const s = useGfxStore.getState();
  return profileFor(s.quality, s.dprScale);
}
