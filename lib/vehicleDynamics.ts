// Vehicle dynamics for the player's own cars (v1.6, stage 2) — our own math,
// no third-party physics code. Replaces the arcade "grip bleeds lateral
// velocity" model of lib/carPhysics.ts for components/Car.tsx only; Rapier's
// kinematic character controller still owns collisions, exactly as before.
//
//   • planar two-axle (bicycle) model in the car frame: vx forward, vy left,
//     yaw rate r (+ = turning left = heading h increasing, the same sign
//     convention as carPhysics' steer/vLat)
//   • tyres: simplified Pacejka "magic formula" lateral force per axle on the
//     slip angle, longitudinal drive / brake force, friction circle (combined
//     slip) — power oversteer on RWD, handbrake slides, wheelspin
//   • weight transfer: longitudinal (braking dives the nose, adds front grip)
//     and lateral (roll, per-wheel load sensitivity) from per-wheel springs
//   • per-wheel suspension: spring + damper on a ground ray (groundYAt) at each
//     wheel → heave / pitch / roll for the visual body
//   • engine: torque curve over RPM, automatic gearbox with shift time, rev
//     limiter, reverse; RPM drives the engine sound (lib/audio.ts)
//   • simple damage: hard hits cost power and pull the steering
//
// Everything a later money/upgrade system needs is data: VehicleSpec (per car,
// lib/playerCar.ts `phys`) × Upgrades multipliers → effectiveSpec().

import { weatherState } from "@/lib/weatherState";
import type { CarState } from "@/lib/carPhysics";

export interface VehicleSpec {
  mass: number; // kg
  /** wheelbase (m) and CG position: fraction of the mass on the front axle */
  wheelbase: number;
  frontWeight: number;
  cgHeight: number; // m
  track: number; // m, left-right wheel distance
  drive: "fwd" | "rwd" | "awd";
  // engine / gearbox
  peakTorque: number; // Nm
  peakRpm: number; // rpm of peak torque
  idleRpm: number;
  redline: number;
  gears: number[]; // forward ratios
  reverseRatio: number;
  finalDrive: number;
  wheelRadius: number; // m
  shiftTime: number; // s without drive torque
  // tyres
  mu: number; // peak friction coefficient
  tireB: number; // magic-formula stiffness factor (per rad)
  tireC: number; // shape factor
  rearGripBias: number; // × rear lateral grip (<1 = looser rear)
  handbrakeGrip: number; // × rear lateral grip with the handbrake pulled
  brakeDecel: number; // m/s² at full brake on dry tarmac (capped by grip)
  steerLock: number; // rad at the front wheels, standstill
  // body
  dragArea: number; // ½ρ·Cd·A (N per (m/s)²)
  /** electronic top-speed limiter, km/h (0 = none) */
  limiterKmh?: number;
  rollResist: number; // N per (m/s)
  springK: number; // N/m per wheel
  damperC: number; // N·s/m per wheel
  antiRollFront: number; // 0..1 share of roll stiffness on the front axle
}

/** Multipliers a garage/upgrade system can buy (all 1 = stock). */
export interface Upgrades { power: number; grip: number; brakes: number; weight: number; }
export const STOCK: Upgrades = { power: 1, grip: 1, brakes: 1, weight: 1 };

export const BASE_SPEC: VehicleSpec = {
  mass: 1350, wheelbase: 2.65, frontWeight: 0.58, cgHeight: 0.52, track: 1.55, drive: "fwd",
  peakTorque: 380, peakRpm: 4200, idleRpm: 850, redline: 6800,
  gears: [3.4, 2.1, 1.5, 1.15, 0.92, 0.76], reverseRatio: 3.3, finalDrive: 3.9, wheelRadius: 0.32, shiftTime: 0.18,
  mu: 1.35, tireB: 9, tireC: 1.45, rearGripBias: 1.0, handbrakeGrip: 0.45, brakeDecel: 10.5, steerLock: 0.6,
  dragArea: 0.42, rollResist: 5, springK: 52000, damperC: 5200, antiRollFront: 0.6,
};

export function effectiveSpec(over: Partial<VehicleSpec> | undefined, up: Upgrades = STOCK): VehicleSpec {
  const s = { ...BASE_SPEC, ...(over ?? {}) };
  return { ...s, peakTorque: s.peakTorque * up.power, mu: s.mu * up.grip, brakeDecel: s.brakeDecel * up.brakes, mass: s.mass * up.weight };
}

export interface DynState {
  r: number; // yaw rate rad/s
  gear: number; // 1..n, -1 reverse, 0 neutral (shifting)
  shiftT: number; // remaining shift time
  rpm: number;
  throttle: number;
  ax: number; // filtered body accelerations (m/s²) for weight transfer
  ay: number;
  heave: number; pitch: number; roll: number; // suspension body pose (m, rad)
  vHeave: number; vPitch: number; vRoll: number;
  wheelLoad: [number, number, number, number]; // FL FR RL RR (N)
  slipRear: number; // rear slip angle (rad), for drift FX
  wheelspin: number; // 0..1
  damage: number; // 0..1
  pull: number; // ±1 steering pull side from damage
  delta: number; // front road-wheel angle (rad, + = left), for the visual wheels
}

export function newDynState(): DynState {
  return { r: 0, gear: 1, shiftT: 0, rpm: 850, throttle: 0, ax: 0, ay: 0, heave: 0, pitch: 0, roll: 0, vHeave: 0, vPitch: 0, vRoll: 0, wheelLoad: [0, 0, 0, 0], slipRear: 0, wheelspin: 0, damage: 0, pull: 1, delta: 0 };
}

/** Live telemetry for audio / HUD (the active player car writes it). */
export const engineTelemetry = { rpm: 850, redline: 6800, gear: 1, throttle: 0, active: false, damage: 0 };

export interface DynInput {
  throttle: number; // 0..1 (forward key)
  /** v1.8: dry tank — no drive torque either way */
  noPower?: boolean;
  brake: number; // 0..1 (back key)
  steer: number; // -1..1, + = left (already ramped: CarState.steerAng)
  handbrake: boolean;
  nitro: boolean;
  /** parked / nobody driving: no drive, parking brake on both axles */
  park?: boolean;
}

const G = 9.81;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function torqueAt(s: VehicleSpec, rpm: number) {
  if (rpm >= s.redline) return 0; // limiter
  const lo = s.idleRpm;
  if (rpm <= s.peakRpm) return s.peakTorque * (0.62 + 0.38 * clamp((rpm - lo) / (s.peakRpm - lo), 0, 1));
  const k = (rpm - s.peakRpm) / (s.redline - s.peakRpm);
  return s.peakTorque * (1 - 0.42 * k * k);
}

/** magic formula, normalised: -1..1 of the available grip */
const mf = (B: number, C: number, alpha: number) => Math.sin(C * Math.atan(B * alpha));

/**
 * One frame of driving. Mutates `car` (h, speed = vx, vLat = vy) and `dyn`,
 * returns the world-space displacement for the character controller.
 * groundAt(x, z) is the suspension's ground ray.
 */
export function stepDynamics(car: CarState, dyn: DynState, s: VehicleSpec, inp: DynInput, dt: number, px: number, pz: number, groundAt: (x: number, z: number) => number) {
  const n = Math.max(1, Math.min(8, Math.ceil(dt / 0.0084)));
  const h = dt / n;
  let dx = 0, dz = 0;
  for (let i = 0; i < n; i++) {
    const d = substep(car, dyn, s, inp, h);
    dx += d.dx; dz += d.dz;
  }
  suspension(car, dyn, s, dt, px, pz, groundAt);
  if (!inp.park) {
  engineTelemetry.rpm = dyn.rpm; engineTelemetry.redline = s.redline; engineTelemetry.gear = dyn.gear;
  engineTelemetry.throttle = dyn.throttle; engineTelemetry.damage = dyn.damage;
  }
  return { dx, dz };
}

function substep(car: CarState, dyn: DynState, s: VehicleSpec, inp: DynInput, dt: number) {
  const m = s.mass;
  const L = s.wheelbase;
  const a = L * (1 - s.frontWeight); // CG -> front axle
  const b = L * s.frontWeight; // CG -> rear axle
  const Iz = m * a * b * 1.05; // yaw inertia
  const wet = weatherState.wetGrip;
  const mu = s.mu * (0.45 + 0.55 * wet);
  let vx = car.speed, vy = car.vLat, r = dyn.r;
  const speed = Math.hypot(vx, vy);

  // ---- steering: lock shrinks with speed (keeps 200 km/h sane), damage pull
  const lock = s.steerLock / (1 + Math.abs(vx) * 0.045);
  const delta = clamp(inp.steer * lock + dyn.damage * 0.025 * dyn.pull, -s.steerLock, s.steerLock);
  dyn.delta = delta;

  // ---- axle loads with longitudinal weight transfer
  const dFz = (m * dyn.ax * s.cgHeight) / L;
  const Fzf = Math.max(m * G * s.frontWeight - dFz, m * G * 0.12);
  const Fzr = Math.max(m * G * (1 - s.frontWeight) + dFz, m * G * 0.12);
  // lateral transfer (roll) costs axle grip through tyre load sensitivity
  const latF = (m * Math.abs(dyn.ay) * s.cgHeight) / s.track;
  const sens = (Fz: number, tr: number) => {
    const l = Math.min(tr, Fz * 0.48);
    const f = (x: number) => x * (1 - 0.1 * (x / 4000));
    return (f(Fz / 2 + l) + f(Fz / 2 - l)) / Math.max(1, f(Fz / 2) * 2); // ≤1
  };
  const gripF = mu * Fzf * sens(Fzf, latF * s.antiRollFront);
  const gripR = mu * Fzr * sens(Fzr, latF * (1 - s.antiRollFront)) * s.rearGripBias;
  dyn.wheelLoad[0] = Fzf / 2 - latF * s.antiRollFront * Math.sign(dyn.ay); dyn.wheelLoad[1] = Fzf / 2 + latF * s.antiRollFront * Math.sign(dyn.ay);
  dyn.wheelLoad[2] = Fzr / 2 - latF * (1 - s.antiRollFront) * Math.sign(dyn.ay); dyn.wheelLoad[3] = Fzr / 2 + latF * (1 - s.antiRollFront) * Math.sign(dyn.ay);

  // ---- gearbox / engine
  const wantReverse = !inp.park && inp.brake > 0 && vx < 0.8 && inp.throttle === 0;
  if (wantReverse && dyn.gear !== -1 && Math.abs(vx) < 0.8) { dyn.gear = -1; dyn.shiftT = s.shiftTime; }
  if (!wantReverse && dyn.gear === -1 && (inp.throttle > 0 || vx > 0.5)) { dyn.gear = 1; dyn.shiftT = s.shiftTime; }
  const ratio = dyn.gear === -1 ? s.reverseRatio : s.gears[Math.max(0, dyn.gear - 1)];
  const wheelRpm = (Math.abs(vx) / s.wheelRadius) * (60 / (2 * Math.PI));
  let rpm = wheelRpm * ratio * s.finalDrive;
  const throttle = inp.noPower ? 0 : dyn.gear === -1 ? inp.brake : inp.throttle;
  // slipping clutch at launch: the engine never drops below a throttle-dependent floor
  rpm = Math.max(rpm, s.idleRpm + throttle * (dyn.gear <= 1 ? 2600 : 600) * (Math.abs(vx) < 8 ? 1 : 0));
  // automatic shifting
  if (dyn.gear > 0 && dyn.shiftT <= 0) {
    if (rpm > s.redline * 0.93 && dyn.gear < s.gears.length) { dyn.gear++; dyn.shiftT = s.shiftTime; }
    else if (dyn.gear > 1) {
      const lower = wheelRpm * s.gears[dyn.gear - 2] * s.finalDrive;
      if (dyn.wheelspin < 0.3 && Math.abs(vy) < 3 && lower < s.redline * (throttle > 0.5 ? 0.78 : 0.62) && rpm < s.peakRpm * 0.82) { dyn.gear--; dyn.shiftT = s.shiftTime * 0.8; }
    }
  }
  dyn.shiftT = Math.max(0, dyn.shiftT - dt);
  dyn.rpm += (Math.min(rpm, s.redline + 150) - dyn.rpm) * clamp(dt * 18, 0, 1);
  dyn.throttle = throttle;
  const power = 1 - 0.45 * dyn.damage;
  let Fdrive = dyn.shiftT > 0 ? 0 : (torqueAt(s, dyn.rpm) * ratio * s.finalDrive * 0.88 * throttle * power) / s.wheelRadius;
  if (dyn.gear === -1) { Fdrive = -Fdrive; if (vx < -9) Fdrive = 0; }
  if (s.limiterKmh && vx * 3.6 > s.limiterKmh && !inp.nitro) Fdrive = Math.min(Fdrive, 0);
  if (inp.nitro && !inp.noPower && dyn.gear > 0) Fdrive += m * 11; // NOS: extra thrust, raises the drag-limited top speed too

  // ---- brakes (back key while rolling forward), handbrake on the rear
  let FbF = 0, FbR = 0;
  if (inp.brake > 0 && dyn.gear !== -1 && vx > 0.3) {
    const Fb = m * s.brakeDecel * inp.brake * (0.4 + 0.6 * wet);
    FbF = Fb * 0.62; FbR = Fb * 0.38;
  }
  if (inp.handbrake) FbR += mu * Fzr * 0.75;
  if (inp.park) { Fdrive = 0; FbF = m * 4; FbR = m * 4; }
  const sgn = Math.sign(vx) || 0;

  // longitudinal force per axle (drive split by layout), capped by grip
  const split = s.drive === "fwd" ? 1 : s.drive === "rwd" ? 0 : 0.4;
  let Fxf = Fdrive * split - FbF * sgn;
  let Fxr = Fdrive * (1 - split) - FbR * sgn;
  const spinF = Math.abs(Fxf) > gripF * 0.98, spinR = Math.abs(Fxr) > gripR * 0.98;
  Fxf = clamp(Fxf, -gripF * 0.98, gripF * 0.98);
  Fxr = clamp(Fxr, -gripR * 0.98, gripR * 0.98);
  dyn.wheelspin += (((spinF && split > 0) || (spinR && split < 1)) && throttle > 0.3 ? 1 : 0 - dyn.wheelspin) * clamp(dt * 6, 0, 1);

  // ---- tyre lateral forces (magic formula on the slip angle, friction circle)
  const vxs = Math.max(Math.abs(vx), 3); // slip angles are meaningless near standstill
  const alphaF = delta * (vx >= 0 ? 1 : -1) - Math.atan2(vy + a * r, vxs);
  const alphaR = -Math.atan2(vy - b * r, vxs);
  const availF = Math.sqrt(Math.max(0, gripF * gripF - Fxf * Fxf));
  let availR = Math.sqrt(Math.max(0, gripR * gripR - Fxr * Fxr));
  if (inp.handbrake) availR *= s.handbrakeGrip;
  // wheelspin on a driven rear axle eats extra side grip (power oversteer)
  if (spinR && split < 1 && throttle > 0.5) availR *= 0.72;
  const Fyf = availF * mf(s.tireB, s.tireC, alphaF);
  const Fyr = availR * mf(s.tireB, s.tireC, alphaR);
  dyn.slipRear = alphaR;

  // ---- resistances
  const Fdrag = s.dragArea * vx * Math.abs(vx) + s.rollResist * vx;

  // ---- equations of motion (car frame)
  const cd = Math.cos(delta), sd = Math.sin(delta);
  const FxBody = Fxf * cd - Fyf * sd + Fxr - Fdrag;
  const FyBody = Fyf * cd + Fxf * sd + Fyr;
  const axB = FxBody / m, ayB = FyBody / m;
  let rDot = (a * (Fyf * cd + Fxf * sd) - b * Fyr) / Iz;
  rDot -= r * (inp.handbrake ? 0.6 : 0.9); // yaw damping (driver aid, keeps drifts catchable)

  vx += (axB + vy * r) * dt;
  vy += (ayB - vx * r) * dt;
  r += rDot * dt;

  // low speed: blend to the kinematic (no-slip) bicycle so parking / pulling
  // away is stable and the car can't spin on the spot
  const kin = clamp(1 - (speed - 1.5) / 4, 0, 1);
  if (kin > 0) {
    const rKin = (vx * Math.tan(delta)) / L;
    r += (rKin - r) * kin;
    vy *= 1 - kin * clamp(dt * 12, 0, 1);
  }
  // brakes / rolling resistance must not reverse the motion on their own
  if (sgn !== 0 && Math.sign(vx) !== sgn && Fdrive * sgn <= 0) vx = 0;
  if (Math.abs(vx) < 0.05 && throttle === 0) vx = 0;

  dyn.ax += (axB - dyn.ax) * clamp(dt * 8, 0, 1);
  dyn.ay += (ayB - dyn.ay) * clamp(dt * 8, 0, 1);
  car.h += r * dt;
  car.speed = vx;
  car.vLat = clamp(vy, -30, 30);
  car.steerAng = car.steerAng; // ramp owned by the caller
  dyn.r = clamp(r, -4, 4);

  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  return { dx: (sh * vx + ch * car.vLat) * dt, dz: (ch * vx - sh * car.vLat) * dt };
}

/** Per-wheel spring/damper on a ground ray → body heave/pitch/roll (visual)
 *  driven by the same load transfer the tyres see. */
function suspension(car: CarState, dyn: DynState, s: VehicleSpec, dt: number, px: number, pz: number, groundAt: (x: number, z: number) => number) {
  const L = s.wheelbase, a = L * (1 - s.frontWeight), b = L * s.frontWeight, w = s.track / 2;
  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  const g0 = groundAt(px, pz);
  // ground offset at each wheel (FL FR RL RR) relative to the body centre
  const wheels: [number, number][] = [[a, w], [a, -w], [-b, w], [-b, -w]];
  let gPitch = 0, gRoll = 0, gHeave = 0;
  for (const [fz, lx] of wheels) {
    const x = px + sh * fz + ch * lx, z = pz + ch * fz - sh * lx;
    const dg = clamp(groundAt(x, z) - g0, -0.3, 0.3);
    gHeave += dg / 4; gPitch += (dg * Math.sign(fz)) / 4; gRoll += (dg * Math.sign(lx)) / 4;
  }
  const m = s.mass;
  const k = s.springK * 4, c = s.damperC * 4;
  const Ip = m * L * L / 12, Ir = m * s.track * s.track / 10;
  const steps = Math.max(1, Math.ceil(dt / 0.008)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    // pitch: braking (ax<0) dives the nose (positive pitch = nose down)
    const Mp = -m * dyn.ax * s.cgHeight;
    const Mr = m * dyn.ay * s.cgHeight; // cornering left (ay>0) rolls the body to the right
    const aPitch = (Mp - k * (L / 2) ** 2 * (dyn.pitch - gPitch * 2 / L) - c * (L / 2) ** 2 * dyn.vPitch) / Ip;
    const aRoll = (Mr - k * w * w * (dyn.roll - gRoll / w) - c * w * w * dyn.vRoll) / Ir;
    const aHeave = (-k * (dyn.heave - gHeave) - c * dyn.vHeave) / m;
    dyn.vPitch += aPitch * h; dyn.vRoll += aRoll * h; dyn.vHeave += aHeave * h;
    dyn.pitch += dyn.vPitch * h; dyn.roll += dyn.vRoll * h; dyn.heave += dyn.vHeave * h;
  }
  dyn.pitch = clamp(dyn.pitch, -0.09, 0.09);
  dyn.roll = clamp(dyn.roll, -0.1, 0.1);
  dyn.heave = clamp(dyn.heave, -0.12, 0.12);
}

/** A hard hit: speed lost in the impact → damage (0..1). Returns the new value. */
export function applyImpact(dyn: DynState, dv: number): number {
  if (dv < 7) return dyn.damage;
  dyn.damage = Math.min(1, dyn.damage + (dv - 6) / 55);
  if (Math.random() < 0.5) dyn.pull = -dyn.pull;
  return dyn.damage;
}

/** Steering-wheel ramp (same feel as lib/carPhysics.ts): a tap gives a
 *  baseline angle, holding winds up to full lock, release self-centres. */
export function rampSteer(car: CarState, steer: number, handbrake: boolean, dt: number) {
  const spd = Math.abs(car.speed);
  const ramp = Math.max(2.6 / (1 + spd * 0.05), 2.6 * 0.55);
  let sa = car.steerAng;
  if (handbrake && steer !== 0) sa += (steer - sa) * clamp(dt * 10, 0, 1);
  else if (steer !== 0) {
    if (steer > 0 && sa < 0.26) sa = 0.26;
    else if (steer < 0 && sa > -0.26) sa = -0.26;
    sa += (steer - sa) * clamp(ramp * dt, 0, 1);
  } else sa *= clamp(1 - 8 * dt, 0, 1);
  car.steerAng = sa;
}
