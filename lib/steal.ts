import { trafficPositions, RESPAWN_DELAY } from "@/components/Traffic";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { requestTeleport } from "@/lib/clubTeleport";

const STEAL_RADIUS2 = 4.5 * 4.5; // same reach as lib/player.ts's mount check

/** The original's "steal a traffic car" branch of toggleVehicle(), which
 * lib/player.ts had to skip: in the original every traffic car IS a vehicle in
 * the same array the player drives, so hijacking one was just re-pointing
 * player.veh. Here traffic is a separate scripted-position component with no
 * drive rig at all, so the takeover is done the other way round — the OWNED
 * vehicle is moved onto the NPC's pose and wears its paint, and the NPC hides
 * and re-enters its lane later as a fresh car (see Traffic.tsx's `stolen`).
 *
 * A black-and-white hands you the POLICE CRUISER rather than the sedan, so
 * stealing one gets you the siren/convoy rig that already exists.
 *
 * Runs LAST in Game.tsx's E chain, so walking up to something you already own
 * always wins over hijacking a passing NPC. */
export function stealTrafficAction(): boolean {
  const hud = useHudStore.getState();
  if (hud.active !== "foot") return false;

  let best = -1;
  let bestD2 = STEAL_RADIUS2;
  trafficPositions.forEach((t, i) => {
    if (t.stolen) return;
    const dx = t.x - worldState.px;
    const dz = t.z - worldState.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = i;
    }
  });
  if (best < 0) return false;

  const slot = trafficPositions[best];
  // policeJeep/police win over kind (neither ever sets kind anyway);
  // otherwise hand over the real jeep/bus/truck rig for a commercial lane,
  // falling back to the sedan for a plain lane — was unconditionally "car",
  // silently reskinning a stolen bus as a sedan.
  const kind: VehicleKind = slot.policeJeep ? "policeJeep" : slot.police ? "policeCar" : slot.kind ?? "car";

  // seed the shared state first: setActive makes the vehicle read as the
  // player's position source that same frame, before its own useFrame has
  // consumed the teleport below
  vehicleState[kind].x = slot.x;
  vehicleState[kind].z = slot.z;
  vehicleState[kind].h = slot.h;
  worldState.px = slot.x;
  worldState.pz = slot.z;
  worldState.heading = slot.h;

  // only the sedan takes on NPC paint via this path (StolenAwareCarMesh is
  // the parked sedan's own mesh, always mounted regardless of active vehicle
  // — setting it for a stolen jeep/bus/truck would repaint the sedan itself
  // the next time the player looks at it)
  hud.setStolenCar(kind === "car" ? { color: slot.color, style: slot.style } : null);
  hud.setActive(kind);
  // consumed next frame by whichever vehicle is now active (Car.tsx/PoliceCar.tsx
  // both poll this) — the same one-shot the club door uses
  requestTeleport(slot.x, slot.z, slot.h);

  slot.stolen = true;
  slot.respawnIn = RESPAWN_DELAY; // must be set here — Traffic.tsx counts DOWN from it
  hud.showMsg("STOLEN: " + useHudStore.getState().vehicleName());
  return true;
}
