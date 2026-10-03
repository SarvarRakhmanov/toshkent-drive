// Ported from the original's weather system (index.html ~3645-3693): discrete
// states that cycle over time and blend fog/sky/traction rather than snapping.
// Same plain-mutable-singleton pattern as skyState/worldState — Weather.tsx
// writes this every frame, carPhysics.ts reads wetGrip without subscribing.
export const WEATHER = ["clear", "sunny", "overcast", "rain", "fog", "snow"] as const;
export type Weather = (typeof WEATHER)[number];
// "sunny" is a distinct step up from "clear": long crisp visibility, a
// visible sun disc, boosted sunlight, and real specular reflections via
// scene.environment (Weather.tsx) — "clear" is just plain daylight.
const WEATHER_W = [0.35, 0.22, 0.18, 0.14, 0.06, 0.05];

export const weatherState = {
  kind: "clear" as Weather,
  // first change comes sooner (25-60s) than subsequent ones (100-200s), same
  // as the original's `weatherTimer=25+Math.random()*35` vs the reset below
  timer: 25 + Math.random() * 35,
  wetGrip: 1,
};

export function pickWeather(): Weather {
  const r = Math.random();
  let acc = 0;
  for (let i = 0; i < WEATHER.length; i++) {
    acc += WEATHER_W[i];
    if (r <= acc) return WEATHER[i];
  }
  return "clear";
}

// V key: force-advances to the next weather in array order (matches the
// original's KeyV handler exactly — a deterministic cycle, not a re-roll of
// pickWeather), and resets the timer the same as a natural change would.
export function cycleWeather(): Weather {
  const i = WEATHER.indexOf(weatherState.kind);
  weatherState.kind = WEATHER[(i + 1) % WEATHER.length];
  weatherState.timer = 100 + Math.random() * 100;
  return weatherState.kind;
}
