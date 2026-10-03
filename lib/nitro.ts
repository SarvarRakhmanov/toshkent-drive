// Shared nitro fuel/lock bookkeeping, factored out of Car.tsx (the only
// vehicle that originally had this) so every other drivable vehicle can get
// the same SHIFT+forward boost without re-deriving the fuel-drain/relock math
// per file. Same constants Car.tsx always used — this is a lossless extract,
// not a retune.
//
// Sound stays off on purpose: components/AudioEngine.tsx's NITRO_MUTED_FOR_TEST
// flag mutes the nitro roar everywhere (it reads as pure noise at high RPM,
// Akul's call) — that flag is untouched by this file and still gates every
// vehicle's nitro audio, muted or not.

export const NITRO_MAX = 10; // seconds of fuel — same numbers as the original's NITRO_MAX/NITRO_BOOST
export const NITRO_BOOST = 41.7; // +150 km/h over a vehicle's normal top speed while boosting
export const NITRO_ACCEL_MULT = 2.7;

export interface NitroFuelState {
  fuel: number;
  locked: boolean; // true from empty tank until a full recharge — blocks re-triggering on a half-full tank
}

export function initNitroFuel(): NitroFuelState {
  return { fuel: NITRO_MAX, locked: false };
}

/** Mutates `state` in place (drains/refills fuel, updates the lock), returns whether the boost is actually live this frame. */
export function stepNitroFuel(state: NitroFuelState, want: boolean, dt: number): boolean {
  if (state.fuel <= 0) state.locked = true;
  else if (state.fuel >= NITRO_MAX) state.locked = false;
  const on = want && !state.locked && state.fuel > 0;
  state.fuel = on ? Math.max(0, state.fuel - dt) : Math.min(NITRO_MAX, state.fuel + dt * 0.5);
  return on;
}
