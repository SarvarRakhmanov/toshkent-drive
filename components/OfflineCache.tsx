"use client";

import { useEffect } from "react";
import { asset } from "@/lib/asset";

// v1.8: registers public/sw.js (offline cache) on the web build only — the
// Capacitor APK ships its assets inside the app already.
export function OfflineCache() {
  useEffect(() => {
    const w = window as unknown as { Capacitor?: unknown };
    if (w.Capacitor || !("serviceWorker" in navigator)) return;
    const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (local && !/[?&]sw=1/.test(location.search)) return; // dev/test servers: opt in with ?sw=1
    const t = setTimeout(() => {
      navigator.serviceWorker.register(asset("/sw.js"), { scope: asset("/") || "/" }).then(async () => {
        const reg = await navigator.serviceWorker.ready;
        const urls = performance.getEntriesByType("resource").map((r) => r.name);
        reg.active?.postMessage({ type: "td-cache", urls });
      }).catch(() => {});
    }, 4000); // after the first frames — don't compete with the initial load
    return () => clearTimeout(t);
  }, []);
  return null;
}
