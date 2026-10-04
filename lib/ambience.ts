import { getAudioCtx } from "@/lib/audio";
import { skyState } from "@/lib/skyState";
import { weatherState } from "@/lib/weatherState";

// v1.8 city ambience, all synthesised with Web Audio (no sample files to
// license or download): a low traffic rumble, distant car horns, birds by day,
// crickets at night and rain hiss in wet weather. stepAmbience() is called
// ~4x a second from components/Ambience.tsx; levels glide with setTargetAtTime.
interface Amb { ctx: AudioContext; master: GainNode; rumble: GainNode; rain: GainNode; crickets: GainNode }
let amb: Amb | null = null;
let nextHorn = 0, nextBird = 0;
export const ambienceState = { rumble: 0, rain: 0, crickets: 0, birds: 0, horns: 0, on: false };

function noiseBuffer(ctx: AudioContext, brown: boolean) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return b;
}
function loop(ctx: AudioContext, buf: AudioBuffer) {
  const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s;
}

function build(ctx: AudioContext): Amb {
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const brown = noiseBuffer(ctx, true), white = noiseBuffer(ctx, false);
  // traffic rumble: brown noise, low-passed
  const rumble = ctx.createGain(); rumble.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 220;
  loop(ctx, brown).connect(lp).connect(rumble).connect(master);
  // rain: white noise band 700 Hz - 7 kHz
  const rain = ctx.createGain(); rain.gain.value = 0;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 700;
  const lp2 = ctx.createBiquadFilter(); lp2.type = "lowpass"; lp2.frequency.value = 7000;
  loop(ctx, white).connect(hp).connect(lp2).connect(rain).connect(master);
  // crickets: 4.6 kHz tone, chopped by a 28 Hz square and a 2.3 Hz chirp gate
  const crickets = ctx.createGain(); crickets.gain.value = 0;
  const tone = ctx.createOscillator(); tone.frequency.value = 4600;
  const chop = ctx.createGain(); chop.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.type = "square"; lfo.frequency.value = 28;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.5; lfo.connect(lfoG).connect(chop.gain);
  const gate = ctx.createGain(); gate.gain.value = 0;
  const glfo = ctx.createOscillator(); glfo.type = "square"; glfo.frequency.value = 2.3;
  const glfoG = ctx.createGain(); glfoG.gain.value = 0.5; glfo.connect(glfoG).connect(gate.gain);
  tone.connect(chop).connect(gate).connect(crickets).connect(master);
  tone.start(); lfo.start(); glfo.start();
  return { ctx, master, rumble, rain, crickets };
}

function horn(ctx: AudioContext, out: AudioNode, vol: number) {
  const t = ctx.currentTime, len = 0.18 + Math.random() * 0.45, f = 360 + Math.random() * 160;
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.setValueAtTime(vol, t + len); g.gain.linearRampToValueAtTime(0, t + len + 0.06);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1100; // distant = dull
  for (const m of [1, 1.26]) { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = f * m; o.connect(lp); o.start(t); o.stop(t + len + 0.1); }
  lp.connect(g).connect(out);
}
function bird(ctx: AudioContext, out: AudioNode, vol: number) {
  let t = ctx.currentTime;
  const n = 2 + ((Math.random() * 4) | 0), base = 2600 + Math.random() * 1800;
  for (let i = 0; i < n; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.5), t + 0.07);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.09);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.1);
    t += 0.11 + Math.random() * 0.08;
  }
}

/** level 0..1 = how "outdoors in the city" the player is (0 in the club etc.) */
export function stepAmbience(level: number) {
  const ctx = getAudioCtx();
  if (!ctx || ctx.state !== "running") { if (amb && ctx === null) amb.master.gain.value = 0; ambienceState.on = false; return; }
  if (!amb || amb.ctx !== ctx) amb = build(ctx);
  ambienceState.on = true;
  const t = ctx.currentTime, night = skyState.nightK, w = weatherState.kind;
  const wet = w === "rain" ? 1 : 0;
  ambienceState.rumble = level * (0.09 - 0.045 * night);
  ambienceState.rain = wet * 0.06 * Math.max(0.4, level);
  ambienceState.crickets = level * Math.max(0, night - 0.45) * 0.03 * (wet || w === "snow" ? 0 : 1);
  amb.master.gain.setTargetAtTime(1, t, 0.3);
  amb.rumble.gain.setTargetAtTime(ambienceState.rumble, t, 0.6);
  amb.rain.gain.setTargetAtTime(ambienceState.rain, t, 1.2);
  amb.crickets.gain.setTargetAtTime(ambienceState.crickets, t, 1.5);
  const now = performance.now();
  if (level > 0.2 && now > nextHorn) {
    if (nextHorn) { horn(ctx, amb.master, 0.03 * level * (1 - 0.6 * night)); ambienceState.horns++; }
    nextHorn = now + (night > 0.5 ? 18000 : 7000) + Math.random() * 16000;
  }
  if (level > 0.2 && night < 0.35 && !wet && w !== "snow" && now > nextBird) {
    if (nextBird) { bird(ctx, amb.master, 0.022 * level); ambienceState.birds++; }
    nextBird = now + 2500 + Math.random() * 6000;
  }
}
