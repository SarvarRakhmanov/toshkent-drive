"use client";

import { useEffect, useState } from "react";
import { useLoadStore } from "@/lib/loadState";

const LABEL: Record<string, string> = {
  assets: "Loading assets…",
  building: "Building the city…",
  compiling: "Preparing graphics…",
  ready: "Ready",
};

/** Full-screen cover shown until the scene is built and shaders are compiled.
 *  Fades out (no pop-in of a half-built city at 5 FPS). */
export function LoadingScreen() {
  const phase = useLoadStore((s) => s.phase);
  const progress = useLoadStore((s) => s.progress);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (phase !== "ready") { setGone(false); return; }
    const t = setTimeout(() => setGone(true), 450);
    return () => clearTimeout(t);
  }, [phase]);
  if (gone) return null;
  return (
    <div id="td-loading" className={phase === "ready" ? "td-loading-out" : ""} role="status" aria-live="polite">
      <div className="td-loading-title">TOSHKENT DRIVE</div>
      <div className="td-loading-bar"><div style={{ transform: `scaleX(${Math.max(0.03, progress)})` }} /></div>
      <div className="td-loading-label">{LABEL[phase]}</div>
    </div>
  );
}
