import type { VehicleKind } from "@/lib/hudStore";

// Shared by lib/player.ts (mount action) and lib/hint.ts (on-screen prompt) so
// the two stay in lockstep — a hint that shows before E actually works (or
// vice versa) is worse than no hint. Default 4.5 (the original's
// nearestVehicle(player.x,player.z,4.5)) fits every car/bike/boat/plane/
// helicopter, but a 58m-long airliner (components/DrivableAirliner.tsx) is
// anchored at one x/z point — 4.5m from it is a tiny fraction of the
// fuselage, so approaching from most of the aircraft (a wingtip, the tail,
// the far side) never gets in range at all. Airliners get a much wider
// radius that covers walking up to any part of the airframe.
const AIRLINER_RADIUS = 30;
const DEFAULT_RADIUS = 4.5;

export function mountRadius(kind: VehicleKind): number {
  return kind === "airliner1" || kind === "airliner2" || kind === "airliner3" || kind === "airlinerCargo"
    ? AIRLINER_RADIUS
    : DEFAULT_RADIUS;
}
