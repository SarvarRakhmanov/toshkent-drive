import { create } from "zustand";

// Boot sequence shared by the loading screen (DOM) and components/ReadyGate.tsx
// (inside the Canvas). The scene is built and its shaders compiled behind the
// loading screen; the game is only shown once it can actually run smoothly.
export type LoadPhase = "assets" | "building" | "compiling" | "ready";

interface LoadState {
  phase: LoadPhase;
  /** 0..1 */
  progress: number;
  /** How many deferred scene stages are mounted (see components/Deferred.tsx). */
  stage: number;
  /** ms since navigation start when the game became interactive */
  readyAt: number | null;
  set: (p: Partial<Omit<LoadState, "set">>) => void;
}

export const useLoadStore = create<LoadState>((set) => ({
  phase: "assets",
  progress: 0,
  stage: 0,
  readyAt: null,
  set: (p) => set(p),
}));

export const isReady = () => useLoadStore.getState().phase === "ready";
