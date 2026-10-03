// Automation hooks for the Playwright tests (scripts/*.cjs). Read-mostly; the
// only "write" is summoning the player's own car, which the in-game phone can
// already do. Not used by the game itself.
import { requestCarSummon } from "@/lib/vehicleSummon";
import { trafficPositions } from "@/components/Traffic";
import { vehicleState } from "@/lib/vehicleState";
import { useLoadStore } from "@/lib/loadState";
import { frameErrors } from "@/lib/safeFrame";
import { physicsHealth } from "@/lib/physicsGuard";
import { useHudStore } from "@/lib/hudStore";
import { cameraLook } from "@/lib/cameraLook";
import { pedestrianPositions, pedDrawStats } from "@/components/Pedestrians";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { worldState } from "@/lib/worldState";

if (typeof window !== "undefined") {
  (window as unknown as { __td: unknown }).__td = {
    summonCar: (x: number, z: number, h: number) => requestCarSummon(x, z, h),
    traffic: () => trafficPositions.map((t) => ({ x: t.x, z: t.z, h: t.h, police: t.police, stolen: t.stolen, kind: t.kind ?? null })),
    car: () => ({ ...vehicleState.car }),
    load: () => { const s = useLoadStore.getState(); return { phase: s.phase, progress: s.progress, stage: s.stage, readyAt: s.readyAt }; },
    health: () => ({ frameErrors: { ...frameErrors }, physics: { ...physicsHealth } }),
    active: () => useHudStore.getState().active,
    // orbit the chase camera (screenshots of the car's front)
    pedStats: () => ({ ...pedDrawStats, total: pedestrianPositions.length }),
    peds: () => pedestrianPositions.map((p) => ({ x: p.x, z: p.z, h: p.h, robot: p.robot })),
    player: () => ({ x: worldState.px, y: worldState.py, z: worldState.pz, h: worldState.heading }),
    // on-foot only: drop the player at x,z facing h (screenshots of the robots)
    tp: (x: number, z: number, h = 0) => requestPlayerTeleport(x, z, h),
    look: (yaw: number, pitch = 0) => { cameraLook.targetYaw = cameraLook.yaw = yaw; cameraLook.targetPitch = cameraLook.pitch = pitch; },
  };
}
