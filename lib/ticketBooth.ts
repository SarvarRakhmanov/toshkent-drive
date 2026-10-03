import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";
import { DOOR_OUT } from "@/lib/club";

// A single fixed pickup spot, not a registered lib/interiors.ts building —
// same reasoning as lib/armory.ts's own comment: "get a ticket" is a
// one-time state flip (hud.hasTicket), not a walk-in room. Positioned a
// short walk west of VENU's own exterior door trigger (lib/club.ts's
// DOOR_OUT) so it's clear of that door's enterRadius2/hintEnterRadius2
// (22/40 sq. units, i.e. within ~6.3 units of the door) without being far
// out of the way.
export const TICKET_BOOTH = { x: DOOR_OUT.x - 15, z: DOOR_OUT.z };
export const TICKET_PICKUP_RADIUS2 = 5 * 5;
export const TICKET_HINT_RADIUS2 = 9 * 9;

/** Polled on E, same "on foot, in range, one-shot state flip" shape as
 * lib/armory.ts's armoryPickupAction() — Game.tsx's E chain calls this
 * ahead of the door/seat/boat/mount checks, since the ticket has to exist
 * before the VENU door's gate (lib/interiors.ts/lib/club.ts) matters. */
export function ticketPickupAction(): boolean {
  const hud = useHudStore.getState();
  if (hud.active !== "foot" || hud.hasTicket) return false;
  const dx = worldState.px - TICKET_BOOTH.x;
  const dz = worldState.pz - TICKET_BOOTH.z;
  if (dx * dx + dz * dz >= TICKET_PICKUP_RADIUS2) return false;
  hud.setHasTicket(true);
  hud.showMsg("PICKED UP: VENU TICKET");
  return true;
}

/** Polled every frame to drive the pickup hint — wider radius than the
 * action above, same convention lib/armory.ts uses. */
export function ticketHintText(): string | null {
  const hud = useHudStore.getState();
  if (hud.active !== "foot" || hud.hasTicket) return null;
  const dx = worldState.px - TICKET_BOOTH.x;
  const dz = worldState.pz - TICKET_BOOTH.z;
  return dx * dx + dz * dz < TICKET_HINT_RADIUS2 ? "Press E to pick up ticket" : null;
}
