"use client";

import { create } from "zustand";

// v1.7b: the always-visible MENU button (components/PauseMenu.tsx). While the
// menu is open the game is paused: every safeFrame callback is skipped
// (lib/safeFrame.ts reads pauseState without subscribing) and <Physics> is
// paused (components/Game.tsx).
export const pauseState = { paused: false };

interface PauseStore {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export const usePauseStore = create<PauseStore>((set, get) => ({
  open: false,
  setOpen: (v) => { pauseState.paused = v; set({ open: v }); },
  toggle: () => get().setOpen(!get().open),
}));
