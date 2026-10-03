"use client";

import type { ReactNode } from "react";
import { useLoadStore } from "@/lib/loadState";

/** Mounts its children only once the boot sequence reaches `stage` — spreads
 *  the scene build over many frames (behind the loading screen) instead of
 *  creating thousands of objects/colliders in one frame. */
export function Deferred({ stage, children }: { stage: number; children: ReactNode }) {
  const cur = useLoadStore((s) => s.stage);
  return cur >= stage ? <>{children}</> : null;
}
