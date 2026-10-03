// Ported verbatim (same constants, same formulas) from the original single-file
// game's hand-rolled arcade car physics (index.html, the player-drive branch of
// tick()). Position integration + collision resolution now happen outside this
// function (Rapier's KinematicCharacterController) — this only owns the "feel":
// steering ramp, engine/drag, and lateral grip. See migration plan Phase 2.

import { weatherState } from "@/lib/weatherState";

export interface CarState {
  h: number; // heading, radians
  speed: number; // forward (longitudinal) velocity, m/s
  vLat: number; // lateral (sideways) velocity, m/s
  steerAng: number; // current steering angle, -1..1
}

export interface CarHandling {
  max: number; // top speed, m/s
  accel: number; // m/s^2
  grip: number;
  turnGain: number;
  steerRamp: number;
  steerMin: number;
  drag: number;
  dragQ: number;
}

export const DEFAULT_HANDLING: CarHandling = {
  max: 40,
  accel: 18,
  grip: 6.5,
  turnGain: 0.78,
  steerRamp: 2.6,
  steerMin: 0.26,
  drag: 0.4,
  dragQ: 0.0016,
};

// Same formulas, boat-shaped constants (original game's BOAT_HANDLING): no tyres,
// so almost no lateral grip — a hull carries its momentum wide through a turn and
// keeps swinging after you let go. Slow to build speed, slow to stop.
export const BOAT_HANDLING: CarHandling = {
  max: 25,
  accel: 10,
  grip: 0.55,
  turnGain: 1.15,
  steerRamp: 2.2,
  steerMin: 0.3,
  drag: 0.22,
  dragQ: 0.0009,
};

// Bikes in the original never get a custom handling object — they fall through
// to the drive loop's isBike default (grip 9 vs a car's 6.5, everything else
// identical to DEFAULT_HANDLING), just with a punchier max/accel.
export const BIKE_HANDLING: CarHandling = {
  max: 60,
  accel: 38,
  grip: 9,
  turnGain: 0.78,
  steerRamp: 2.6,
  steerMin: 0.26,
  drag: 0.4,
  dragQ: 0.0016,
};

// Original's POLICE PURSUIT stats (index.html ~line 6120: "police 83.3 m/s =
// 300 km/h") — same shape as DEFAULT_HANDLING, faster and grippier.
export const POLICE_HANDLING: CarHandling = {
  max: 83.3,
  accel: 26,
  grip: 7.5,
  turnGain: 0.78,
  steerRamp: 2.6,
  steerMin: 0.26,
  drag: 0.4,
  dragQ: 0.0016,
};

// Commercial traffic (components/CommercialVehicle.tsx) — same shape as
// DEFAULT_HANDLING, just heavier and slower to feel like piloting something
// big instead of a sedan. Jeep only a little under the sedan; bus is the
// slowest/heaviest, truck close behind it.
export const JEEP_HANDLING: CarHandling = {
  max: 32,
  accel: 14,
  grip: 5.5,
  turnGain: 0.7,
  steerRamp: 2.4,
  steerMin: 0.28,
  drag: 0.42,
  dragQ: 0.0018,
};

export const TRUCK_HANDLING: CarHandling = {
  max: 26,
  accel: 9,
  grip: 3.8,
  turnGain: 0.58,
  steerRamp: 2.0,
  steerMin: 0.3,
  drag: 0.44,
  dragQ: 0.0019,
};

export const BUS_HANDLING: CarHandling = {
  max: 22,
  accel: 7,
  grip: 3.0,
  turnGain: 0.5,
  steerRamp: 1.8,
  steerMin: 0.32,
  drag: 0.45,
  dragQ: 0.002,
};

// MILITARY BASE's mountable tank (components/Tank.tsx) — same shape as every
// other CarHandling (tracks/tyres both just resolve to forward+lateral
// velocity here), but slower than even the bus, with the highest grip and
// turnGain in the game: real tracked vehicles pivot sharply and don't slide,
// unlike a wheeled vehicle's tyre-grip model. Top speed capped low — this is
// a war machine, not a getaway car.
export const TANK_HANDLING: CarHandling = {
  max: 14,
  accel: 5,
  grip: 12,
  turnGain: 1.4,
  steerRamp: 3.2,
  steerMin: 0.2,
  drag: 0.5,
  dragQ: 0.0022,
};

export interface CarInput {
  forward: boolean;
  back: boolean;
  steer: number; // -1 (left) .. 1 (right), already resolved from left/right keys
  handbrake: boolean;
}

/** Mutates `car` in place, returns the desired world-space displacement this frame. */
export function stepCarPhysics(
  car: CarState,
  input: CarInput,
  h: CarHandling,
  dt: number
): { dx: number; dz: number } {
  const spd0 = Math.abs(car.speed);

  // steering: speed-sensitive authority, ramps toward full lock while held
  // (a tap gives an instant baseline angle; holding winds it up further)
  const ramp = Math.max(h.steerRamp / (1 + spd0 * 0.05), h.steerRamp * 0.55);
  let sa = car.steerAng;
  if (input.handbrake) {
    sa = input.steer;
  } else if (input.steer !== 0) {
    if (input.steer > 0 && sa < h.steerMin) sa = h.steerMin;
    else if (input.steer < 0 && sa > -h.steerMin) sa = -h.steerMin;
    sa += (input.steer - sa) * clamp(ramp * dt, 0, 1);
  } else {
    sa *= clamp(1 - 8 * dt, 0, 1);
  }
  car.steerAng = sa;

  const steerAuth = clamp(spd0 / 6, 0, 1) / (1 + spd0 * 0.03);
  const turn =
    sa * (input.handbrake ? 3.5 : 2.7) * steerAuth * h.turnGain * dt * Math.sign(car.speed || 1);
  car.h += turn;

  // carry momentum: velocity lives in the car frame (forward + lateral); rotating
  // the heading rotates these components too, so the body keeps its old momentum
  // direction until grip drags it round
  let vlong = car.speed;
  let vlat = car.vLat;
  {
    const cT = Math.cos(turn);
    const sT = Math.sin(turn);
    const nl = vlong * cT + vlat * sT;
    const na = -vlong * sT + vlat * cT;
    vlong = nl;
    vlat = na;
  }

  // engine / brakes / drag
  // wetGrip previously only touched lateral grip below, leaving accel and
  // braking/drag identical dry vs. rain/snow — a player mashing the brake in
  // snow stopped exactly as fast as on dry pavement. Two gentler (not raw
  // wetGrip 1:1) curves fix that: accelGrip softens power delivery
  // (wheelspin eating some of the throttle), brakeGrip softens every
  // deceleration term (hard brake, handbrake, and passive drag/rolling
  // resistance — a car coasts further when it can't bite the road). Both are
  // strictly monotonic in wetGrip so snow stays more punishing than rain,
  // matching the existing 0.3/0.5 wetGrip split, and both are exactly 1 (a
  // no-op) whenever wetGrip is 1 — clear/sunny/overcast/fog drive unchanged.
  const accelGrip = 0.5 + 0.5 * weatherState.wetGrip; // 1 dry, ~0.75 rain, ~0.65 snow
  const brakeGrip = 0.4 + 0.6 * weatherState.wetGrip; // 1 dry, ~0.7 rain, ~0.58 snow
  if (input.forward) vlong += (vlong < 0 ? 40 * brakeGrip : h.accel * accelGrip) * dt;
  else if (input.back) vlong -= (vlong > 0 ? 42 * brakeGrip : h.accel * 0.5 * accelGrip) * dt;
  vlong -= vlong * h.drag * brakeGrip * dt;
  vlong -= vlong * Math.abs(vlong) * h.dragQ * brakeGrip * dt;
  if (input.handbrake) vlong -= vlong * 1.8 * brakeGrip * dt;
  vlong = clamp(vlong, -16, h.max);

  // lateral grip: tyres bleed sideways velocity away; handbrake breaks traction.
  // wetGrip is the original's rain penalty (index.html ~line 7258, alongside
  // per-vehicle HANDLING) — shared here so every vehicle type gets it for free.
  const grip = (input.handbrake ? 2.2 : h.grip) * weatherState.wetGrip;
  vlat -= vlat * clamp(grip * dt, 0, 1);
  vlat = clamp(vlat, -16, 16);

  car.speed = vlong;
  car.vLat = vlat;

  const sh = Math.sin(car.h);
  const ch = Math.cos(car.h);
  return {
    dx: (sh * vlong + ch * vlat) * dt,
    dz: (ch * vlong - sh * vlat) * dt,
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
