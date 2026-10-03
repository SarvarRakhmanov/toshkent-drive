"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

// Canvas/WebGL/Rapier all need the browser — no server render for the game itself.
// Toshkent Drive: no sign-in; everything is local (localStorage save as "guest").
const Game = dynamic(() => import("@/components/Game"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#050814",
        color: "#fff",
        fontFamily: "monospace",
      }}
    >
      Loading Toshkent Drive…
    </div>
  ),
});

export default function Home() {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => setHasMounted(true), []);
  if (!hasMounted) return null;
  return <Game />;
}
