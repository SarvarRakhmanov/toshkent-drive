import { worldState } from "@/lib/worldState";
import { useHudStore } from "@/lib/hudStore";
import { requestTeleport } from "@/lib/clubTeleport";
import { requestPlayerTeleport } from "@/lib/playerTeleport";

// Generic enterable-building machinery — extracted from lib/club.ts (VENU
// was the only building, everything hardcoded to it) so Phase 2's 10-15
// buildings each just register an entry instead of copy-pasting a whole
// clubDoorAction()/clubHintText() pair. One entry active at a time (a player
// can only be inside one building), tracked by hudStore's activeBuildingId;
// hud.inClub stays the plain indoor/outdoor boolean other systems
// (Weather/Headlights/Player) already key off, untouched by this pass.
export interface InteriorEntry {
  id: string;
  displayName: string; // used in hint/toast text: "Press E to enter VENU"
  enterMsg: string;
  exitMsg: string;
  doorOut: { x: number; z: number }; // world-space trigger point outside
  doorIn: { x: number; z: number }; // world-space trigger point inside
  interiorSpawn: { x: number; z: number; h: number }; // teleport target on enter
  enterRadius2: number; // squared distance to trigger entering
  exitRadius2: number; // squared distance to trigger exiting
  hintEnterRadius2: number; // squared distance to show the enter hint (wider than enterRadius2)
  hintExitRadius2: number; // squared distance to show the exit hint
  // optional entry requirement (e.g. VENU's ticket-booth flag, lib/club.ts's
  // registerInterior call + lib/ticketBooth.ts) — checked before letting the
  // player in so the registry stays generic instead of special-casing a
  // building id inline here. gateMsg is shown in place of enterMsg when it blocks.
  gate?: () => boolean;
  gateMsg?: string;
}

const REGISTRY = new Map<string, InteriorEntry>();

export function registerInterior(entry: InteriorEntry) {
  REGISTRY.set(entry.id, entry);
}

// where the player was standing right before entering, restored on exit —
// one slot is enough since only one building can be active at a time
let outPos = { x: 0, z: 0, h: 0 };

// Car/Bike consume lib/clubTeleport's singleton, Player consumes its own
// (lib/playerTeleport) — route to whichever the currently-active mode polls.
function teleport(x: number, z: number, h: number) {
  if (useHudStore.getState().active === "foot") requestPlayerTeleport(x, z, h);
  else requestTeleport(x, z, h);
}

/** Polled on E — generalized from lib/club.ts's original clubDoorAction(). */
export function interiorDoorAction(): boolean {
  const hud = useHudStore.getState();
  if (hud.active !== "foot") return false;

  if (hud.inClub && hud.activeBuildingId) {
    const b = REGISTRY.get(hud.activeBuildingId);
    if (!b) return false;
    const dx = worldState.px - b.doorIn.x;
    const dz = worldState.pz - b.doorIn.z;
    if (dx * dx + dz * dz >= b.exitRadius2) return false;
    hud.setInClub(false);
    hud.setActiveBuildingId(null);
    teleport(outPos.x, outPos.z, outPos.h);
    hud.showMsg(b.exitMsg);
    return true;
  }

  for (const b of REGISTRY.values()) {
    const dx = worldState.px - b.doorOut.x;
    const dz = worldState.pz - b.doorOut.z;
    if (dx * dx + dz * dz < b.enterRadius2) {
      if (b.gate && !b.gate()) {
        hud.showMsg(b.gateMsg ?? "You can't enter yet");
        return true;
      }
      outPos = { x: worldState.px, z: worldState.pz + 1.5, h: worldState.heading };
      hud.setInClub(true);
      hud.setActiveBuildingId(b.id);
      teleport(b.interiorSpawn.x, b.interiorSpawn.z, b.interiorSpawn.h);
      hud.showMsg(b.enterMsg);
      return true;
    }
  }
  return false;
}

/** Polled every frame by the exterior component to drive the door hint —
 * wider radius than the action thresholds above so it shows up before
 * you're close enough to trigger it. */
export function interiorHintText(): string | null {
  const hud = useHudStore.getState();
  if (hud.inClub && hud.activeBuildingId) {
    const b = REGISTRY.get(hud.activeBuildingId);
    if (!b) return null;
    const dx = worldState.px - b.doorIn.x;
    const dz = worldState.pz - b.doorIn.z;
    return dx * dx + dz * dz < b.hintExitRadius2 ? `Press E to exit ${b.displayName}` : null;
  }
  for (const b of REGISTRY.values()) {
    const dx = worldState.px - b.doorOut.x;
    const dz = worldState.pz - b.doorOut.z;
    if (dx * dx + dz * dz < b.hintEnterRadius2) {
      if (b.gate && !b.gate()) return b.gateMsg ?? `${b.displayName}: entry blocked`;
      return `Press E to enter ${b.displayName}`;
    }
  }
  return null;
}
