"use client";

import { useFrame } from "@react-three/fiber";
import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";

// Same distance/bearing formula as the original's waypoint-arrow block: the
// arrow's rotation is the target's angle relative to the player's own
// heading (not compass north), so it always points the right way on screen
// regardless of which way the player/camera is facing.
export function WaypointTracker() {
  useFrame(() => {
    const hud = useHudStore.getState();
    const target = hud.navTarget;
    if (!target) return;
    const cdx = target.x - worldState.px;
    const cdz = target.z - worldState.pz;
    const dist = Math.hypot(cdx, cdz);
    const ph = worldState.heading;
    const along = cdx * Math.sin(ph) + cdz * Math.cos(ph);
    const side = cdx * Math.cos(ph) - cdz * Math.sin(ph);
    const deg = (Math.atan2(side, along) * 180) / Math.PI - 90;
    hud.setWaypoint(dist, deg);
  });
  return null;
}
