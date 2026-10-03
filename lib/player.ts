import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { mountRadius } from "@/lib/mountRadius";

/** Ported from the original's toggleVehicle(): mount the nearest vehicle in
 * range when on foot, or dismount the current one back to on-foot. The
 * original's "steal a traffic car" branch lives in lib/steal.ts instead —
 * traffic here isn't drivable, so hijacking one works the other way round.
 *
 * Returns false only when on foot with nothing OWNED in range, which is what
 * lets Game.tsx fall through to the steal attempt. */
export function toggleVehicleFoot(): boolean {
  const hud = useHudStore.getState();
  if (hud.active === "foot") {
    let best: VehicleKind | null = null;
    let bestD2 = Infinity;
    (Object.keys(vehicleState) as VehicleKind[]).forEach((k) => {
      const v = vehicleState[k];
      const dx = v.x - worldState.px;
      const dz = v.z - worldState.pz;
      // real 3D distance, not just ground-plane — without the y term, a
      // plane or helicopter passing overhead reads as "in range, press E"
      // from directly underneath on the ground. `v.y` is only ever set by
      // Plane.tsx/Helicopter.tsx; every other vehicle stays near enough to
      // ground/water level that treating a missing `y` as 0 is correct.
      const dy = (v.y ?? 0) - worldState.py;
      const d2 = dx * dx + dy * dy + dz * dz;
      const r2 = mountRadius(k) ** 2;
      if (d2 < r2 && d2 < bestD2) {
        bestD2 = d2;
        best = k;
      }
    });
    if (!best) return false;
    hud.setActive(best);
    hud.showMsg("DRIVE: " + useHudStore.getState().vehicleName());
    return true;
  } else {
    const v = vehicleState[hud.active as VehicleKind];
    const sx = v.x + Math.cos(v.h) * 2.4;
    const sz = v.z - Math.sin(v.h) * 2.4;
    // Bail-out momentum: only carPhysics.ts-driven vehicles (car/bike/
    // policeCar/boat/patrolBoat) write speed/vLat, so dismounting a plane/
    // helicopter/jet/airliner falls through to 0/0 — a dead stop, same as
    // before this existed, which is correct until flight ejection is its
    // own feature. World-space conversion matches carPhysics.ts's own
    // dir=[sin h, cos h] convention exactly (same rotation, undivided by dt).
    const vx = Math.sin(v.h) * (v.speed ?? 0) + Math.cos(v.h) * (v.vLat ?? 0);
    const vz = Math.cos(v.h) * (v.speed ?? 0) - Math.sin(v.h) * (v.vLat ?? 0);
    // stand relative to the vehicle's own real elevation (v.y — every land
    // vehicle now writes its actual y every frame, not just Plane/Helicopter),
    // not a hardcoded ground-level 1: dismounting on FORT NEON's platform (or
    // anywhere else off sea level) used to always spawn the player at world
    // y=1, well under the platform surface, and gravity took it from there
    // straight into the water below.
    requestPlayerTeleport(sx, sz, v.h, (v.y ?? 0) + 1, vx, vz);
    hud.setActive("foot");
    hud.showMsg("ON FOOT");
    return true;
  }
}
