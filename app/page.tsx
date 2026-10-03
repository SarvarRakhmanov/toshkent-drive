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
      <span style={{ color: "#ffd76a", letterSpacing: "0.12em", fontWeight: 700, fontSize: "clamp(22px, 6vw, 40px)" }}>TOSHKENT DRIVE</span>
    </div>
  ),
});

export default function Home() {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => setHasMounted(true), []);
  if (!hasMounted) return null;
  return <Game />;
}
