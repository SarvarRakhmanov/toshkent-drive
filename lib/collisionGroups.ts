import { interactionGroups } from "@react-three/rapier";

// group 0 = Player on foot (components/Player.tsx), group 1 = "vehicles
// only" world geometry (curbs/gates that block Traffic/PoliceCar but not the
// player's own ride), group 2 = "is a player-driven vehicle body" (Car/Bike/
// CommercialVehicle). VEHICLE_ONLY's filter=[1] only accepts queries whose
// OWN membership includes bit 1 — Traffic/PoliceCar use Rapier's
// membership-in-everything default so they satisfy that and get blocked;
// PLAYER_GROUPS/VEHICLE_BODY_GROUPS below deliberately DON'T carry bit 1, so
// the player (walking OR driving) passes through VEHICLE_ONLY curbs/gates
// (the airport gate gap, Airport.tsx) same as before.
export const PLAYER_GROUPS = interactionGroups([0]);
export const VEHICLE_ONLY = interactionGroups([1], [1]);
// Car.tsx/Bike.tsx/CommercialVehicle.tsx use this instead of PLAYER_GROUPS
// for their own collider tag + sweep filterGroups: same bit-0 membership (so
// they keep the VEHICLE_ONLY passthrough above), PLUS bit 2 so they can be
// singled out from the on-foot player by WATER_BOUNDARY below.
export const VEHICLE_BODY_GROUPS = interactionGroups([0, 2]);
// The marina's pier-gap collider (Marina.tsx) uses this instead of
// VEHICLE_ONLY: filter=[2] only accepts queries carrying the vehicle-body
// bit, so it blocks every player-driven car/bike/jeep/bus/truck (unlike
// VEHICLE_ONLY, which that trick above deliberately lets them through) while
// staying invisible to the on-foot player (membership bit 0 only, no bit 2)
// — you can still walk down the dock to board a boat, no car can float
// through the same gap into the water.
export const WATER_BOUNDARY = interactionGroups([3], [2]);
// Same membership as VEHICLE_BODY_GROUPS, but for the filterGroups argument
// to a vehicle's OWN per-frame computeColliderMovement sweep (Car.tsx/
// Bike.tsx/CommercialVehicle.tsx) — never as a collider's collisionGroups
// tag. A KinematicCharacterController sweep resolves any overlap it finds
// at the START of the query by nudging the QUERYING collider away from it,
// so a parked car's own zero-input sweep still ran every frame and, when
// the on-foot player (PLAYER_GROUPS, membership=bit 0 only) walked into it,
// treated the player as an obstacle to shove itself clear of — that
// depenetration correction was the visible "push." Player.tsx's own sweep
// (filterGroups=PLAYER_GROUPS) is untouched, so a parked car is still solid
// to walk into; only the car itself stops flinching. The filter below is
// every bit except bit 0, so it still catches everything VEHICLE_BODY_GROUPS
// used to (default-group world/traffic colliders via any of their other
// bits, other vehicle bodies via bit 2, WATER_BOUNDARY via bit 3) — just not
// a collider whose membership is bit 0 alone.
const ALL_EXCEPT_ON_FOOT_PLAYER = Array.from({ length: 15 }, (_, i) => i + 1);
export const VEHICLE_SWEEP_GROUPS = interactionGroups([0, 2], ALL_EXCEPT_ON_FOOT_PLAYER);
// PoliceCar.tsx's sweep uses this instead of VEHICLE_SWEEP_GROUPS. Same
// ALL_EXCEPT_ON_FOOT_PLAYER filter, so it fixes the identical parked-vehicle
// flinch described above (the cruiser's zero-input sweep no longer treats a
// player who walks into it as an obstacle to shove itself clear of). The
// difference is membership: bit 1 is KEPT, so the cruiser still satisfies
// VEHICLE_ONLY's filter=[1] and remains blocked by the airport gate gap
// (Airport.tsx) and the VEHICLE_ONLY curbs — exactly the behaviour it had
// before the flinch fix, and what the comment at the top of this file
// describes when it names PoliceCar as something VEHICLE_ONLY blocks.
// Handing the cruiser VEHICLE_SWEEP_GROUPS instead would silently ALSO give
// it Car/Bike's "drive through the gate" passthrough, because a character-
// controller sweep is governed by these filterGroups and not by the
// collider's own collisionGroups tag (see Player.tsx's computeColliderMovement
// comment). That passthrough is a separate, deliberate design decision — if
// the cop car should behave like Car/Bike, swap this for VEHICLE_SWEEP_GROUPS
// there and tag its CuboidCollider with VEHICLE_BODY_GROUPS.
export const POLICE_SWEEP_GROUPS = interactionGroups([0, 1, 2], ALL_EXCEPT_ON_FOOT_PLAYER);
