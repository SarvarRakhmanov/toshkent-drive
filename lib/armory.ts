import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";

// A single fixed pickup spot, not a registered lib/interiors.ts building —
// "pick up a weapon" is a one-time state flip (hud.hasGun), not a walk-in
// room, so it doesn't need that system's door/teleport machinery. Block-
// center placement (k*100+50 — see lib/interiorSpots.ts's own comment on
// City.tsx's CELL/ROAD_W) clear of every existing landmark/building spot.
export const ARMORY = { x: 650, z: 150 };
export const ARMORY_PICKUP_RADIUS2 = 5 * 5;
export const ARMORY_HINT_RADIUS2 = 9 * 9;

/** Polled on E, same "on foot, in range, one-shot state flip" shape as
 * lib/clubSeats.ts's seatAction() — Game.tsx's E chain calls this alongside
 * the door/seat/boat/mount checks. */
export function armoryPickupAction(): boolean {
  const hud = useHudStore.getState();
  if (hud.active !== "foot" || hud.hasGun) return false;
  const dx = worldState.px - ARMORY.x;
  const dz = worldState.pz - ARMORY.z;
  if (dx * dx + dz * dz >= ARMORY_PICKUP_RADIUS2) return false;
  hud.setHasGun(true);
  hud.showMsg("PICKED UP: PISTOL — F TO FIRE");
  return true;
}

/** Polled every frame by GunStore.tsx to drive the pickup hint — wider
 * radius than the action above, same convention lib/interiors.ts uses. */
export function armoryHintText(): string | null {
  const hud = useHudStore.getState();
  if (hud.active !== "foot" || hud.hasGun) return null;
  const dx = worldState.px - ARMORY.x;
  const dz = worldState.pz - ARMORY.z;
  return dx * dx + dz * dz < ARMORY_HINT_RADIUS2 ? "Press E to pick up weapon" : null;
}
