import type { VehicleKind } from "@/lib/hudStore";

// Every vehicle's live x/z/h, always kept up to date (not just the active
// one) — same shared-mutable-singleton pattern as skyState/worldState, so
// saveGame.ts can snapshot all three without any vehicle needing to know
// about persistence itself.
// `y` is optional and only meaningful for plane/helicopter — Plane.tsx and
// Helicopter.tsx are the only components that write it (see their own
// per-frame vehicleState writes). Every other vehicle stays close enough to
// ground/water level that lib/player.ts's mount-range scan treats a missing
// `y` as 0, which is correct for all of them.
// `speed`/`vLat` are optional too, only written by the 5 carPhysics.ts-driven
// vehicles (Car/Bike/PoliceCar/Boat/PatrolBoat — see each one's own per-frame
// write next to x/z/h). lib/player.ts reads them at dismount to hand the
// player a bail-out velocity instead of a dead stop; flight vehicles don't
// write them, so dismounting a plane/helicopter/jet/airliner correctly
// inherits none.
export const vehicleState: Record<VehicleKind, { x: number; z: number; h: number; y?: number; speed?: number; vLat?: number }> = {
  car: { x: 0, z: 0, h: 0 },
  bike: { x: -20, z: 0, h: 0 },
  boat: { x: 595, z: 0, h: Math.PI }, // in the water off EAST MARINA, matches Boat.tsx's own default
  // moored beside the dock (LAND_EDGE_X=550, pier centreline z=50 — see
  // lib/marina.ts) so the marina reads as a proper little boat lot: walk down
  // the pier and there are three hulls to pick from, not just one out at sea.
  boat2: { x: 565, z: 40, h: Math.PI / 2 },
  boat3: { x: 565, z: 62, h: Math.PI / 2 },
  // parked in POLICE HARBOR STATION's fleet bay — see components/PoliceStation.tsx
  // (PX/PZ 490/90, bays run behind the building) and lib/landmarks.ts's POLICE HARBOR
  policeCar: { x: 482, z: 75, h: 0 },
  // the airport's security jeep (components/Airport.tsx's old GateGuardPost,
  // GATE_POST_X=214/GATE_CZ=-50 local + AX/AZ -750/100) — a fallback spawn
  // only; in practice it's almost always re-targeted by stealing the patrol
  // lane copy (components/Traffic.tsx's policeJeep lane) instead.
  policeJeep: { x: -536, z: 70, h: Math.PI / 2 },
  patrolBoat: { x: 592, z: 62, h: Math.PI / 2 },
  // parked on INTERNATIONAL AIRPORT's apron / south helipad — see
  // lib/landmarks.ts (AX/AZ -750/100, moved 450m further west so the airport
  // isn't sitting right next to VENU) and components/Airport.tsx's local
  // layout: the plane sits on open apron clear of the stands and the service-
  // vehicle loops, the helicopter on HELIPAD_ZS[0], the one pad Airport.tsx
  // deliberately leaves empty for it.
  plane: { x: -780, z: 40, h: Math.PI },
  helicopter: { x: -950, z: 190, h: 0 },
  // FORT NEON's gunship, on the compound's SECOND helipad — world coords =
  // BASE_X/BASE_Z (1670/-400, lib/militaryBase.ts) + HELIPAD_POS[1]'s own
  // local (20/70). components/MilitaryBase.tsx parks its decorative
  // ParkedChopper on HELIPAD_POS[0], so this is the pad that was always
  // marked and always empty.
  militaryHeli: { x: 1690, z: -330, h: Math.PI },
  // same apron as the prop plane, offset well clear of it and of the
  // x:-970..-540 z:100 patrol lane (components/Traffic.tsx)
  policeJet: { x: -810, z: 75, h: Math.PI },
  // the three gate-parked wide-bodies — world coords = airport AX/AZ (-750/100)
  // + components/Airport.tsx's own GATE_XS=[-70,0,70]/GATE_Z=65 local offsets,
  // h=0 so the mounted rig's heading matches the parked (unrotated) visual
  // components/DrivableAirliner.tsx renders in its place. Nose-in toward the
  // terminal, same as a real gate — yaw turns in place fine at zero speed
  // (see lib/flightPhysics.ts's stepFlight), so taxiing out just means
  // pivoting toward the taxiway before throttling forward, no reverse needed.
  airliner1: { x: -820, z: 165, h: 0 },
  airliner2: { x: -750, z: 165, h: 0 },
  airliner3: { x: -680, z: 165, h: 0 },
  // freighter on the cargo apron — AX/AZ + Airport.tsx's CARGO_X/CARGO_Z(-195/10)
  // + the freighter's own local offset (+4/-78) and Math.PI/2 rotation
  airlinerCargo: { x: -941, z: 32, h: Math.PI / 2 },
  // parked commercial traffic (components/CommercialVehicle.tsx) — near AUTO
  // YARD (lib/landmarks.ts, x:-48 z:20) for the jeep/truck, near MIZU 21
  // (x:100 z:0) for the bus, all clear of the sedan/bike/police spawns above
  jeep: { x: -65, z: 5, h: 0 },
  truck: { x: -30, z: 45, h: Math.PI },
  bus: { x: 130, z: 15, h: Math.PI / 2 },
  // FORT NEON's mountable tank — its own dedicated spot down the motor-pool
  // lane, past the 3x3 formation of decorative ParkedTanks (see
  // lib/militaryBase.ts's BASE_X/BASE_Z=1670/-400 + local TANK_SPAWN)
  tank: { x: 1670, z: -400, h: 0 },
  // FORT NEON's three apron fighters — world coords = BASE_X/BASE_Z
  // (1670/-400) + lib/militaryBase.ts's own JET_APRON local offsets, headings
  // copied from the same table so a mounted jet starts pointing exactly where
  // the parked one was.
  jet1: { x: 1845, z: -480, h: Math.PI / 2 },
  jet2: { x: 1845, z: -400, h: Math.PI / 2 },
  jet3: { x: 1845, z: -320, h: -Math.PI / 2 },
};
