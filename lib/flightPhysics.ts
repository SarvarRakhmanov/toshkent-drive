// Arcade flight step, shared by Plane.tsx and Helicopter.tsx — same "one step
// function + sibling handling-constant objects" shape as lib/carPhysics.ts's
// DEFAULT_HANDLING/BOAT_HANDLING/BIKE_HANDLING/POLICE_HANDLING, but this is a
// genuinely different model (no tyre grip, a vertical axis, a ground floor)
// so it isn't built on stepCarPhysics.
//
// Differentiation picked for "planes need forward speed to stay up, heli can
// hover": liftMinSpeed/fallAccel. Helicopters set liftMinSpeed=0 so they never
// stall; planes sink (fallAccel) once below liftMinSpeed with no climb/descend
// held, same shape as a real stall but linear, not modeled with any real AoA.

export interface FlightState {
  h: number; // heading yaw, radians (same sin/cos convention as carPhysics: h=0 faces +Z)
  pitch: number; // cosmetic nose up/down, radians — driven off vertical rate, not itself a force
  roll: number; // cosmetic bank, radians — driven off yaw input
  speed: number; // forward m/s
  vy: number; // vertical m/s
}

export interface FlightHandling {
  mode: "plane" | "helicopter";
  maxSpeed: number;
  minSpeed: number; // most negative reverse speed (0 for the plane, small negative for the heli)
  accel: number;
  drag: number;
  turnRate: number; // rad/s of yaw at full A/D input
  climbRate: number; // m/s vertical target while climb/descend is held
  liftMinSpeed: number; // forward speed needed to hold altitude unpowered; 0 = always holds (helicopter)
  fallAccel: number; // m/s^2 sink target when under liftMinSpeed and not climbing/descending
  groundClearance: number; // gear/skid height above y=0 ground when parked/landed
  ceiling: number; // max altitude above ground
}

// ponytail: constants are hand-picked to feel right at car-world scale, not
// derived from anything — first thing to retune once this is actually flown.
export const PLANE_HANDLING: FlightHandling = {
  mode: "plane",
  maxSpeed: 34,
  minSpeed: 0,
  accel: 9,
  drag: 0.15,
  turnRate: 0.9,
  climbRate: 6,
  liftMinSpeed: 9,
  fallAccel: 7,
  groundClearance: 0.95,
  ceiling: 140,
};

export const HELI_HANDLING: FlightHandling = {
  mode: "helicopter",
  maxSpeed: 24,
  minSpeed: -6,
  accel: 10,
  drag: 0.3,
  turnRate: 1.5,
  climbRate: 7,
  liftMinSpeed: 0, // no forward-airspeed stall — a heli can hover at 0 speed
  fallAccel: 2, // but only while under power (see stepFlight's mode==="helicopter" branch) — no throttle held (abandoned or idle) settles instead of hovering forever unpowered
  groundClearance: 0.85, // clears Helicopter.tsx's skids (bottom at local y ~ -0.83)
  ceiling: 120,
};

// The wide-body airliners (components/Airliner.tsx, mounted via
// components/DrivableAirliner.tsx) — same step function, just heavy: slow to
// spin up, slow to turn, and needs a real takeoff roll (liftMinSpeed=26 over
// components/Airport.tsx's 420m runway works out to ~110m of ground roll
// before it lifts off, well inside the strip). ponytail: hand-picked to feel
// heavy against this airport's actual runway length, not derived from
// anything — first thing to retune once it's actually flown.
export const AIRLINER_HANDLING: FlightHandling = {
  mode: "plane",
  maxSpeed: 62,
  minSpeed: 0,
  accel: 4,
  drag: 0.05,
  turnRate: 0.22,
  climbRate: 3.2,
  liftMinSpeed: 26,
  fallAccel: 3,
  groundClearance: 5.4, // must match components/Airliner.tsx's AIRLINER_GROUND_Y
  ceiling: 150,
};

// components/PoliceJet.tsx — the fastest, most agile thing in the sky:
// quicker off the mark and tighter turning than PLANE_HANDLING, higher top
// speed than even the airliner. ponytail: hand-picked to feel fighter-fast
// against this city's scale, not derived from anything real.
export const POLICE_JET_HANDLING: FlightHandling = {
  mode: "plane",
  maxSpeed: 55,
  minSpeed: 0,
  accel: 14,
  drag: 0.1,
  turnRate: 1.3,
  climbRate: 9,
  liftMinSpeed: 14,
  fallAccel: 8,
  groundClearance: 0.75,
  ceiling: 160,
};

// FORT NEON's three apron fighters (components/DrivableFighterJet.tsx) — a
// clear step above POLICE_JET_HANDLING in every direction: fastest top speed,
// hardest acceleration, tightest turn, highest ceiling. ponytail: hand-picked
// to feel like the fastest thing in the game, not derived from anything real.
//
// groundClearance is NOT a taste number — components/FighterJet.tsx's mesh has
// no landing gear (it was authored as a flyover-only airframe), and
// components/MilitaryBase.tsx parks it at local y = 1.1 * JET_SCALE(2.3).
// Matching that exactly is what keeps a landed fighter sitting on the apron
// the same way the parked ones do instead of sinking into it.
export const FIGHTER_JET_HANDLING: FlightHandling = {
  mode: "plane",
  maxSpeed: 78,
  minSpeed: 0,
  accel: 20,
  drag: 0.08,
  turnRate: 1.5,
  climbRate: 12,
  liftMinSpeed: 18,
  fallAccel: 9,
  groundClearance: 2.53,
  ceiling: 190,
};

export interface FlightInput {
  forward: boolean; // throttle up
  back: boolean; // throttle down / reverse
  yaw: number; // -1 (left) .. 1 (right), pre-resolved from A/D like carPhysics's steer
  climb: boolean;
  descend: boolean;
}

/** Mutates `fs` in place, returns the world-space displacement + new absolute
 * altitude for this frame. `groundY` is the ground height under the craft —
 * 0 over open ground, or a building's roof height when landing on one (see
 * lib/buildings.ts's roofHeightAt, called by each of this function's 3
 * callers) — passed through rather than hardcoded so the same floor-clamp
 * below handles rooftop landings for free. */
export function stepFlight(fs: FlightState, input: FlightInput, h: FlightHandling, dt: number, currentY: number, groundY: number): { dx: number; dz: number; y: number } {
  fs.h += input.yaw * h.turnRate * dt;
  const targetRoll = -input.yaw * 0.5;
  fs.roll += (targetRoll - fs.roll) * Math.min(1, dt * 4);

  if (input.forward) fs.speed += h.accel * dt;
  else if (input.back) fs.speed -= h.accel * dt;
  fs.speed -= fs.speed * h.drag * dt;
  fs.speed = clamp(fs.speed, h.minSpeed, h.maxSpeed);

  let targetVy = 0;
  if (input.climb) targetVy = h.climbRate;
  else if (input.descend) targetVy = -h.climbRate;
  // a helicopter has no forward-airspeed stall (liftMinSpeed=0, see above) so
  // it needs its own "no throttle held" check instead of falling into the
  // liftMinSpeed branch below, which for a heli can never be true — this is
  // what makes an abandoned or idle-throttle heli settle instead of hovering
  // in place forever unpowered
  else if (h.mode === "helicopter") {
    if (!input.forward) targetVy = -h.fallAccel;
  } else if (Math.abs(fs.speed) < h.liftMinSpeed) targetVy = -h.fallAccel;
  // runway rotation: a grounded plane past takeoff speed lifts off on its own,
  // same as a real aircraft — without this it just taxis forever and reads as
  // "driving like a car" unless the player also holds climb. Helicopters skip
  // this (mode check): liftMinSpeed=0 means they're always "fast enough", so
  // the same rule would launch them the instant they're mounted, at rest.
  else if (h.mode === "plane" && currentY <= groundY + h.groundClearance + 0.02) targetVy = h.climbRate * 0.6;
  fs.vy += (targetVy - fs.vy) * Math.min(1, dt * 3);

  fs.pitch += ((-fs.vy / h.climbRate) * 0.3 - fs.pitch) * Math.min(1, dt * 4);

  let y = currentY + fs.vy * dt;
  const floor = groundY + h.groundClearance;
  const ceil = groundY + h.ceiling;
  if (y <= floor) {
    y = floor;
    fs.vy = Math.max(fs.vy, 0);
  } else if (y >= ceil) {
    y = ceil;
    fs.vy = Math.min(fs.vy, 0);
  }

  const sh = Math.sin(fs.h);
  const ch = Math.cos(fs.h);
  return { dx: sh * fs.speed * dt, dz: ch * fs.speed * dt, y };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
