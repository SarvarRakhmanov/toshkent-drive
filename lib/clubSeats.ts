import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";
import { CLUB_IN } from "@/lib/club";

// VIP lounge seat spots — two chesterfield-sofa clusters along VENU's -x
// wall (components/ClubInterior.tsx's VipLounge), each with two marked
// cushion positions facing out into the room (ry = +x heading in this
// engine's [sin h, cos h] convention). World coords, not CLUB_IN-local, so
// seatAction can compare directly against worldState.px/pz like every other
// distance check in lib/club.ts.
// Exported so components/ClubInterior.tsx's VipLounge can position the
// actual sofa geometry at these exact local coordinates instead of a second,
// hand-kept copy drifting out of sync with where E actually lets you sit.
export const LOCAL_SEATS = [
  { x: -18.5, z: -6.5 },
  { x: -18.5, z: -3.5 },
  { x: -18.5, z: 3.5 },
  { x: -18.5, z: 6.5 },
];
// y=0.62 puts the player RigidBody (which Player.tsx renders 0.75 below at
// the hip pivot, +0.59 further up) at hip world-height ~0.46 — the
// ChesterfieldSofa's cushion top (components/ClubInterior.tsx) — while the
// bent knee's shin (2x0.25 segments) still reaches the floor.
export const SEATS = LOCAL_SEATS.map((s) => ({ x: CLUB_IN.x + s.x, y: 0.62, z: CLUB_IN.z + s.z, ry: Math.PI / 2 }));

const SEAT_RADIUS2 = 1.8 * 1.8;

export function nearestSeat(): (typeof SEATS)[number] | null {
  let best: (typeof SEATS)[number] | null = null;
  let bestD2 = SEAT_RADIUS2;
  for (const s of SEATS) {
    const dx = s.x - worldState.px;
    const dz = s.z - worldState.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = s;
    }
  }
  return best;
}

/** E while on foot: sit on the nearest lounge seat in range, or stand up if
 * already seated. Slots into Game.tsx's E chain the same way
 * clubDoorAction/boatSwapAction do — returns whether it consumed the press. */
export function seatAction(): boolean {
  const hud = useHudStore.getState();
  if (hud.active !== "foot") return false;
  if (hud.seatedAt) {
    hud.setSeatedAt(null);
    return true;
  }
  if (!hud.inClub) return false;
  const seat = nearestSeat();
  if (!seat) return false;
  hud.setSeatedAt(seat);
  return true;
}
