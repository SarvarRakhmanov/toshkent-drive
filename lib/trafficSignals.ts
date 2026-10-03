// v1.8: city-wide traffic-signal cycle. Every grid intersection (coordinates
// ≡ 50 mod 100) runs the same two-phase plan, so lane cars
// (components/Traffic.tsx), crossing pedestrians (components/Pedestrians.tsx)
// and the signal heads (components/TrafficSignals.tsx) all agree without any
// per-intersection state.
//
//   0.0–12.0  X-axis green   (cars moving along x)   Z red
//  12.0–14.5  X yellow
//  14.5–15.5  all red
//  15.5–27.5  Z green                                X red
//  27.5–30.0  Z yellow
//  30.0–31.0  all red

export const SIGNAL_CYCLE = 31;
export type Axis = "x" | "z";
/** 0 red, 1 yellow, 2 green */
export type SignalState = 0 | 1 | 2;

export function signalTime(): number {
  return (performance.now() / 1000) % SIGNAL_CYCLE;
}

export function signalFor(axis: Axis, t = signalTime()): SignalState {
  if (axis === "x") return t < 12 ? 2 : t < 14.5 ? 1 : 0;
  return t >= 15.5 && t < 27.5 ? 2 : t >= 27.5 && t < 30 ? 1 : 0;
}

/** Seconds of red left for traffic moving along `axis` (0 if not red). */
export function redLeft(axis: Axis, t = signalTime()): number {
  if (axis === "x") return t >= 14.5 ? SIGNAL_CYCLE - t + 0 : 0; // red 14.5..31 (then green at 0)
  if (t >= 30) return SIGNAL_CYCLE - t + 15.5;
  return t < 15.5 ? 15.5 - t : 0;
}

/** Car centre stop distance before the intersection centre: the painted
 *  zebra sits 11–13.4 m out (City.tsx buildTileTexture), plus half a body. */
export const STOP_LINE = 16.6;

/** Grid intersection centre ahead of `pos` moving in `dir` along an axis. */
export function nextIntersection(pos: number, dir: number): number {
  return dir > 0 ? Math.ceil((pos - 50) / 100) * 100 + 50 : Math.floor((pos - 50) / 100) * 100 + 50;
}
