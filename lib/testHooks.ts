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

if (typeof window !== "undefined") {
  (window as unknown as { __td: unknown }).__td = {
    summonCar: (x: number, z: number, h: number) => requestCarSummon(x, z, h),
    traffic: () => trafficPositions.map((t) => ({ x: t.x, z: t.z, h: t.h, police: t.police, stolen: t.stolen, kind: t.kind ?? null })),
    car: () => ({ ...vehicleState.car }),
    load: () => { const s = useLoadStore.getState(); return { phase: s.phase, progress: s.progress, stage: s.stage, readyAt: s.readyAt }; },
    health: () => ({ frameErrors: { ...frameErrors }, physics: { ...physicsHealth } }),
    active: () => useHudStore.getState().active,
    // orbit the chase camera (screenshots of the car's front)
    look: (yaw: number, pitch = 0) => { cameraLook.targetYaw = cameraLook.yaw = yaw; cameraLook.targetPitch = cameraLook.pitch = pitch; },
  };
}
