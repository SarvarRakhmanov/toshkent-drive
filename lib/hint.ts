import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { useHudStore, VEHICLE_NAMES, type VehicleKind } from "@/lib/hudStore";
import { interiorHintText } from "@/lib/interiors";
import { armoryHintText } from "@/lib/armory";
import { ticketHintText } from "@/lib/ticketBooth";
import { trafficPositions } from "@/components/Traffic";
import { mountRadius } from "@/lib/mountRadius";
import { nearestSeat } from "@/lib/clubSeats";

const STEAL_RADIUS2 = 5 * 5; // slightly wider than the 4.5 mount action radius

/** Single source of truth for the #hint line, polled once per frame by
 * Club.tsx (always mounted). Ticket booth takes priority over the club door
 * hint (need the ticket before the VENU gate matters), which in turn takes
 * priority over the vehicle-mount hint, same order as the original's
 * `if(!clubDoorAction()) toggleVehicle()`. */
export function computeHint(): string | null {
  const ticket = ticketHintText();
  if (ticket) return ticket;

  const building = interiorHintText();
  if (building) return building;

  const hud = useHudStore.getState();
  if (hud.active !== "foot") return null;
  if (hud.seatedAt) return "Press E to stand up";
  if (hud.inClub) {
    const seat = nearestSeat();
    if (seat) return "Press E to sit";
  }
  const gun = armoryHintText();
  if (gun) return gun;

  let bestName: string | null = null;
  let bestD2 = Infinity;
  (Object.keys(vehicleState) as VehicleKind[]).forEach((k) => {
    const v = vehicleState[k];
    const dx = v.x - worldState.px;
    const dz = v.z - worldState.pz;
    const d2 = dx * dx + dz * dz;
    // +0.5 over the mount action's own radius (lib/player.ts) so the hint
    // never shows for a spot E can't actually reach yet
    const r2 = (mountRadius(k) + 0.5) ** 2;
    if (d2 < r2 && d2 < bestD2) {
      bestD2 = d2;
      bestName = VEHICLE_NAMES[k];
    }
  });
  if (bestName) return `Press E to drive — ${bestName}`;

  // nothing of his in range — offer the nearest NPC instead, same order as
  // Game.tsx's E chain (own vehicle first, steal as the fallback)
  const t = nearestStealable();
  return t ? `Press E to steal — ${t}` : null;
}

function nearestStealable(): string | null {
  let name: string | null = null;
  let bestD2 = STEAL_RADIUS2;
  for (const t of trafficPositions) {
    if (t.stolen) continue;
    const dx = t.x - worldState.px;
    const dz = t.z - worldState.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      name = t.police ? VEHICLE_NAMES.policeCar : VEHICLE_NAMES.car;
    }
  }
  return name;
}
