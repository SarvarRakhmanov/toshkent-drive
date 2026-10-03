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

// ---- GPU crash guard (v1.5) ------------------------------------------------
// HIGH could lose the WebGL context (GPU memory pressure) or get the whole tab /
// WebView killed and reloaded by the browser. Escalation, never a page reload:
//   1st problem -> "safe HIGH" (pixel ratio <= 1, half-res AO, no extra MSAA)
//   2nd problem -> LOW, with a short message.
// A crash that kills the page is detected on the next boot by a sentinel that
// is set while the game runs and cleared on pagehide / after a stable minute.
const SAFE_KEY = "td_gfx_safe";
const BOOT_KEY = "td_gfx_running";
const CRASH_KEY = "td_gfx_crashes";
let bootNotice = "";
/** Message to show once the game is up (crash-guard downgrade at boot). */
export function takeBootNotice(): string { const m = bootNotice; bootNotice = ""; return m; }

function ls(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } }

/** Called once the canvas renders: from now on an unclean exit counts as a crash. */
export function markGfxRunning() { lsSet(BOOT_KEY, useGfxStore.getState().quality); }
/** Clean exit / proven stable: not a crash. */
export function markGfxStopped(stable: boolean) { lsSet(BOOT_KEY, null); if (stable) lsSet(CRASH_KEY, null); }

function initial(): Quality {
  if (typeof window === "undefined") return "high";
  const q = /[?&]q=(high|low)/.exec(window.location.search);
  if (q) return q[1] as Quality;
  // previous page died while rendering on HIGH (tab/WebView OOM-killed, GPU reset)
  if (ls(BOOT_KEY) === "high") {
    const n = Number(ls(CRASH_KEY) || 0) + 1;
    lsSet(CRASH_KEY, String(n));
    lsSet(BOOT_KEY, null);
    if (n >= 2) {
      lsSet(KEY, "low");
      bootNotice = "GRAPHICS: LOW (HIGH crashed on this device — Q / HI to retry)";
      return "low";
    }
    lsSet(SAFE_KEY, "1");
    bootNotice = "GRAPHICS: HIGH (safe mode after a crash)";
  }
  const saved = localStorage.getItem(KEY);
  if (saved === "high" || saved === "low") return saved;
  // phones/tablets start on LOW (no shadows/post-processing, reduced pixel ratio)
  return IS_MOBILE ? "low" : "high";
}

/** Everything that differs between the tiers, in one place. */
export interface GfxProfile {
  quality: Quality;
  /** Crash-guard "safe HIGH" (lower pixel ratio, no MSAA). */
  safe: boolean;
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

export function profileFor(quality: Quality, dprScale = 1, safe = false): GfxProfile {
  const mobile = IS_MOBILE;
  const devDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  if (quality === "high") {
    // v1.5: capped lower (was 1.5 desktop at full-res AO + 2048 shadows) — every
    // full-screen composer target scales with dpr²
    const max = (safe ? 1 : mobile ? 1.25 : 1.5) * dprScale;
    return {
      quality, mobile, safe,
      dpr: [Math.min(1, devDpr, max), Math.min(devDpr, max)],
      shadows: mobile ? "basic" : "soft",
      shadowMapSize: 1024,
      postFX: !mobile,
      antialias: mobile && !safe, // desktop gets SMAA in the composer instead of MSAA
      hdrEnv: true,
      fogScale: 1,
      pointLights: mobile ? 4 : 8,
      trafficExtra: true,
      npcDrawDist: 320,
    };
  }
  const r = Math.min(devDpr, 1) * dprScale;
  return {
    quality, mobile, safe,
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
  /** Crash-guard safe mode (persisted until the user toggles quality). */
  safe: boolean;
  setSafe: (s: boolean) => void;
  /** Extra pixel-ratio multiplier the auto-quality monitor lowers on slow devices. */
  dprScale: number;
  setQuality: (q: Quality) => void;
  setDprScale: (s: number) => void;
  toggle: () => void;
}

export const useGfxStore = create<GfxState>((set, get) => ({
  quality: initial(),
  safe: typeof window !== "undefined" && ls(SAFE_KEY) === "1",
  setSafe: (safe) => { lsSet(SAFE_KEY, safe ? "1" : null); set({ safe }); },
  dprScale: 1,
  setQuality: (quality) => {
    try { localStorage.setItem(KEY, quality); } catch { /* private mode */ }
    set({ quality, dprScale: 1 });
  },
  setDprScale: (dprScale) => set({ dprScale }),
  // a manual toggle keeps safe mode on (it was earned by a real crash on this device)
  toggle: () => get().setQuality(get().quality === "high" ? "low" : "high"),
}));

/** Non-reactive read for per-frame code. */
export function currentProfile(): GfxProfile {
  const s = useGfxStore.getState();
  return profileFor(s.quality, s.dprScale, s.safe);
}
