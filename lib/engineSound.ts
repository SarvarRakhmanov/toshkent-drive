// v1.6 per-vehicle engine voices — procedural synthesis (no audio files, ~0 KB).
// Each profile describes the engine's firing order as audio: a 4-stroke engine
// fires cylinders/2 times per crank revolution, so the fundamental is
// rpm/60 * cyl/2 Hz. Layers (all from one shared rig in lib/audio.ts):
//   fire  — sawtooth at the firing frequency (the "body" of the note)
//   sub   — square at half firing frequency (cross-plane V8 / diesel lope)
//   whine — sine at a high order (turbo / high-rev intake / gear whine)
//   noise — band-passed noise (diesel clatter, intake roar), scaled by throttle
// The low-pass opens with rpm and throttle, which is most of what makes a
// revving engine sound "on load" vs coasting.

export type EngineProfileId = "i4small" | "i4eco" | "i4suv" | "i4carb" | "i4turbo" | "i4race" | "i6turbo" | "v8" | "v6" | "diesel" | "tankDiesel" | "bike" | "boat" | "turbine" | "rotor";

export interface EngineProfile {
  cyl: number; // cylinders (sets firing order)
  idle: number; // rpm
  redline: number; // rpm (for vehicles without a gearbox model: pseudo-rpm from speed)
  fire: number; // layer gains 0..1
  sub: number;
  whine: number;
  whineOrder: number; // multiple of the firing frequency
  noise: number;
  noiseHz: number; // band-pass centre
  cutoff: number; // low-pass at idle, Hz
  cutoffRev: number; // extra Hz at redline, full throttle
  volume: number; // master gain at redline (~0.06 = old rig)
  /** pseudo gearbox for vehicles without one: number of "gears" over topKmh */
  gears?: number;
  topKmh?: number;
}

export const ENGINE_PROFILES: Record<EngineProfileId, EngineProfile> = {
  // Chevrolet Lacetti 1.6 — small, buzzy, not much bass
  i4small: { cyl: 4, idle: 800, redline: 6400, fire: 0.75, sub: 0.15, whine: 0.04, whineOrder: 4, noise: 0.18, noiseHz: 900, cutoff: 380, cutoffRev: 1400, volume: 0.052 },
  // Chevrolet Cobalt 1.5 (B15D2, made in Asaka) — thin, slightly droning economy four
  i4eco: { cyl: 4, idle: 750, redline: 6200, fire: 0.7, sub: 0.12, whine: 0.06, whineOrder: 6, noise: 0.2, noiseHz: 1000, cutoff: 360, cutoffRev: 1250, volume: 0.05 },
  // Chevrolet Captiva 2.4 (LE9) — bigger, deeper four with an auto-box hum
  i4suv: { cyl: 4, idle: 700, redline: 6300, fire: 0.75, sub: 0.38, whine: 0.07, whineOrder: 8, noise: 0.15, noiseHz: 750, cutoff: 300, cutoffRev: 1150, volume: 0.058 },
  // Lada VAZ-2103 1.45 carburettor four — loud, uneven, lots of intake/exhaust rasp
  i4carb: { cyl: 4, idle: 850, redline: 6000, fire: 0.95, sub: 0.3, whine: 0.02, whineOrder: 3, noise: 0.42, noiseHz: 650, cutoff: 330, cutoffRev: 1600, volume: 0.062 },
  // Kia Seltos / K5 1.6T–2.5 — smooth four with turbo whistle
  i4turbo: { cyl: 4, idle: 750, redline: 6600, fire: 0.7, sub: 0.25, whine: 0.12, whineOrder: 9, noise: 0.14, noiseHz: 1200, cutoff: 340, cutoffRev: 1300, volume: 0.055 },
  // BMW E30 M3 (S14 2.3 high-rev four) — rasp, sharp intake, screams to 7200
  i4race: { cyl: 4, idle: 950, redline: 7200, fire: 1, sub: 0.2, whine: 0.08, whineOrder: 3, noise: 0.3, noiseHz: 1600, cutoff: 520, cutoffRev: 2600, volume: 0.062 },
  // BMW M3 Competition (S58 twin-turbo straight six) — dense, smooth, turbo hiss
  i6turbo: { cyl: 6, idle: 800, redline: 7200, fire: 0.95, sub: 0.35, whine: 0.14, whineOrder: 7, noise: 0.22, noiseHz: 1400, cutoff: 460, cutoffRev: 2300, volume: 0.066 },
  // GT / police V8 — deep cross-plane burble (strong half-order)
  v8: { cyl: 8, idle: 700, redline: 6500, fire: 0.8, sub: 0.75, whine: 0.03, whineOrder: 4, noise: 0.16, noiseHz: 700, cutoff: 300, cutoffRev: 1500, volume: 0.068, gears: 5, topKmh: 230 },
  v6: { cyl: 6, idle: 750, redline: 6000, fire: 0.8, sub: 0.45, whine: 0.05, whineOrder: 5, noise: 0.15, noiseHz: 800, cutoff: 320, cutoffRev: 1300, volume: 0.06, gears: 5, topKmh: 180 },
  // bus / truck turbo diesel — low rev, clattery
  diesel: { cyl: 6, idle: 600, redline: 2600, fire: 0.85, sub: 0.6, whine: 0.1, whineOrder: 11, noise: 0.45, noiseHz: 520, cutoff: 240, cutoffRev: 700, volume: 0.07, gears: 6, topKmh: 110 },
  // tank — huge slow diesel rumble + track clatter noise
  tankDiesel: { cyl: 12, idle: 550, redline: 2400, fire: 0.9, sub: 0.9, whine: 0.18, whineOrder: 6, noise: 0.55, noiseHz: 380, cutoff: 200, cutoffRev: 600, volume: 0.075, gears: 4, topKmh: 70 },
  bike: { cyl: 2, idle: 1100, redline: 9500, fire: 1, sub: 0.35, whine: 0.05, whineOrder: 4, noise: 0.25, noiseHz: 1500, cutoff: 600, cutoffRev: 2600, volume: 0.06, gears: 6, topKmh: 200 },
  boat: { cyl: 8, idle: 650, redline: 5200, fire: 0.7, sub: 0.6, whine: 0.04, whineOrder: 5, noise: 0.5, noiseHz: 420, cutoff: 260, cutoffRev: 900, volume: 0.06, gears: 1, topKmh: 110 },
  // jets / airliners — no firing note, all whine + roar
  turbine: { cyl: 2, idle: 3000, redline: 9000, fire: 0.08, sub: 0.05, whine: 0.5, whineOrder: 12, noise: 0.9, noiseHz: 900, cutoff: 900, cutoffRev: 2500, volume: 0.055, gears: 1, topKmh: 900 },
  // helicopters — rotor thump (low sub) + turbine whine
  rotor: { cyl: 2, idle: 1600, redline: 2000, fire: 0.3, sub: 1, whine: 0.35, whineOrder: 20, noise: 0.45, noiseHz: 700, cutoff: 260, cutoffRev: 500, volume: 0.06, gears: 1, topKmh: 300 },
};

/** profile for non-player-car vehicle kinds (lib/hudStore.ts VehicleKind) */
export function profileForVehicle(kind: string): EngineProfileId {
  if (kind === "tank") return "tankDiesel";
  if (kind === "bus" || kind === "truck") return "diesel";
  if (kind === "bike") return "bike";
  if (kind === "jeep" || kind === "policeJeep") return "v6";
  if (kind === "policeCar") return "v8";
  if (kind.startsWith("boat") || kind === "patrolBoat") return "boat";
  if (kind === "helicopter" || kind === "militaryHeli") return "rotor";
  if (kind === "car") return "i4turbo";
  return "turbine"; // planes, airliners, fighter jets
}

/** speed -> pseudo rpm for vehicles without the gearbox model (saw-tooth through gears) */
export function pseudoRpm(p: EngineProfile, speedKmh: number): number {
  const gears = p.gears ?? 5;
  const top = p.topKmh ?? 200;
  const x = Math.min(1, Math.abs(speedKmh) / top) * gears;
  const g = Math.min(gears - 1, Math.floor(x));
  const inGear = x - g; // 0..1 inside the current gear
  const lo = g === 0 ? 0 : 0.55;
  return p.idle + (p.redline - p.idle) * (lo + (1 - lo) * inGear) * (gears === 1 ? 1 : 0.92);
}
