import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { useHudStore, BOAT_KINDS, type VehicleKind } from "@/lib/hudStore";

const SWAP_RADIUS2 = 6 * 6;

/** Ported from the original's nearBoatToBoard/E-to-swap: if you're already in
 * a boat and alongside another hull, E swaps straight into it instead of the
 * normal dismount-to-foot. Four hulls now moor at EAST MARINA (boat, boat2,
 * boat3, patrolBoat), so this picks the NEAREST other one in range rather
 * than assuming there's only ever one alternative — same nearest-of-the-rest
 * scan lib/player.ts's mount check already uses. */
export function boatSwapAction(): boolean {
  const hud = useHudStore.getState();
  if (!(BOAT_KINDS as readonly string[]).includes(hud.active)) return false;
  let best: VehicleKind | null = null;
  let bestD2 = SWAP_RADIUS2;
  for (const k of BOAT_KINDS) {
    if (k === hud.active) continue;
    const v = vehicleState[k];
    const dx = v.x - worldState.px;
    const dz = v.z - worldState.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = k;
    }
  }
  if (!best) return false;
  hud.setActive(best);
  hud.showMsg("SWITCHED TO: " + useHudStore.getState().vehicleName());
  return true;
}
