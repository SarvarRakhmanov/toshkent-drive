// Procedural engine audio, ported from the original's initAudio()/tick() audio
// block — same oscillator types, frequencies, and filter/gain constants. A
// plain module-level singleton (not React state): Web Audio nodes are
// inherently imperative and only ever need one instance for the whole page,
// same spirit as the original's single `audio` object.

interface AudioRig {
  ctx: AudioContext;
  gain: GainNode;
  osc: OscillatorNode;
  osc2: OscillatorNode;
  nitroGain: GainNode;
  nFilt: BiquadFilterNode;
}

let audio: AudioRig | null = null;
let muted = false;

/** Must be called from a real user gesture (click/keydown) — browsers block audio otherwise. */
export function initAudio() {
  if (audio) return;
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    const osc2 = ctx.createOscillator();
    osc2.type = "square";
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = 420;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filt);
    osc2.connect(filt);
    filt.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc2.start();

    // dedicated NITRO roar voice (bandpassed saw+square swell while boosting)
    const nOsc = ctx.createOscillator();
    nOsc.type = "sawtooth";
    nOsc.frequency.value = 72;
    const nOsc2 = ctx.createOscillator();
    nOsc2.type = "square";
    nOsc2.frequency.value = 46;
    const nFilt = ctx.createBiquadFilter();
    nFilt.type = "bandpass";
    nFilt.frequency.value = 260;
    nFilt.Q.value = 0.8;
    const nitroGain = ctx.createGain();
    nitroGain.gain.value = 0;
    nOsc.connect(nFilt);
    nOsc2.connect(nFilt);
    nFilt.connect(nitroGain);
    nitroGain.connect(ctx.destination);
    nOsc.start();
    nOsc2.start();

    audio = { ctx, gain, osc, osc2, nitroGain, nFilt };
    if (muted) ctx.suspend();
  } catch {
    // Web Audio unavailable — game stays fully playable without sound
  }
}

export function toggleMute() {
  muted = !muted;
  if (audio) {
    if (muted) audio.ctx.suspend();
    else audio.ctx.resume();
  }
  return muted;
}

export function isMuted() {
  return muted;
}

/** Restore mute state from a save — before initAudio() has necessarily run. */
export function setMuted(v: boolean) {
  muted = v;
  if (audio) {
    if (muted) audio.ctx.suspend();
    else audio.ctx.resume();
  }
}

/** Call every frame with the driving vehicle's speed and nitro state.
 * `driving` must be false when the player is on foot (or in anything that
 * doesn't feed this rig) — without it, the engine hum outlives the vehicle:
 * hudStore.speedKmh is only ever written by the ACTIVE vehicle's own useFrame
 * (see e.g. Car.tsx's `if (!isActive) return`), so the moment you bail it
 * freezes at whatever speed you jumped out at instead of decaying, and idle
 * gain (0.02 baseline below, even at 0 speed) means "frozen at 0" still
 * wouldn't have been silent either — this has to be an explicit gate, not
 * just passing 0 for speed. */
export function updateEngineAudio(speedKmh: number, driving: boolean, nitroActive: boolean) {
  if (!audio) return;
  const drv = driving ? speedKmh / 3.6 : 0; // back to m/s, matches the original's Math.abs(v.speed)
  const g = !muted && driving ? clamp(0.02 + drv * 0.0008, 0, 0.06) : 0;
  audio.osc.frequency.setTargetAtTime(48 + drv * 2.4, audio.ctx.currentTime, 0.05);
  audio.osc2.frequency.setTargetAtTime(24 + drv * 1.2, audio.ctx.currentTime, 0.05);
  audio.gain.gain.setTargetAtTime(g, audio.ctx.currentTime, 0.08);

  // TEMP TEST FLAG (2026-07-31, Akul): nitro roar reads as pure noise at high
  // RPM — muted here to test engine-only sound while that gets tuned. Revert
  // (false) once it's fixed; not meant to ship silent.
  const NITRO_MUTED_FOR_TEST = true;
  if (nitroActive && !muted && !NITRO_MUTED_FOR_TEST) {
    audio.nitroGain.gain.setTargetAtTime(0.13, audio.ctx.currentTime, 0.05);
    audio.nFilt.frequency.setTargetAtTime(220 + drv * 9, audio.ctx.currentTime, 0.05);
  } else {
    audio.nitroGain.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.08);
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ---------- club music (VENU) ----------
// Ported near-verbatim from the original's startClubMusic() — same tabla/tap/
// hat/melody/bass schedule, same 130bpm 16-step pattern, same synthesis
// constants. A self-scheduling requestAnimationFrame loop, not a fixed
// interval, so it can look ahead and schedule notes slightly early (the
// original's own technique for glitch-free Web Audio timing).
interface ClubMusic {
  playing: boolean;
  raf: number;
  stop: () => void;
}
let clubMusic: ClubMusic | null = null;

export function startClubMusic() {
  if (clubMusic) return;
  initAudio();
  if (!audio) return;
  const ctx = audio.ctx;
  const master = ctx.createGain();
  master.gain.value = 0.38;
  master.connect(ctx.destination);
  const bpm = 130;
  const beatSec = 60 / bpm;

  function scheduleTabla(t: number) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.38, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.16);
  }
  function scheduleTap(t: number) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.1);
  }
  function scheduleHat(t: number, accent: boolean) {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.06, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
    const n = ctx.createBufferSource();
    n.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.22 : 0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    n.connect(hp);
    hp.connect(g);
    g.connect(master);
    n.start(t);
    n.stop(t + 0.08);
  }
  const melodyNotes = [
    293.66, 329.63, 349.23, 392.0, 440.0, 349.23, 329.63, 293.66, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0,
    493.88, 440.0, 392.0, 349.23, 329.63, 293.66, 349.23, 392.0, 440.0, 392.0, 523.25, 493.88, 440.0, 392.0, 349.23,
    329.63, 293.66, 329.63,
  ];
  let melIdx = 0;
  function scheduleMelody(t: number) {
    const freq = melodyNotes[melIdx % melodyNotes.length];
    melIdx++;
    const mod = ctx.createOscillator();
    mod.type = "sine";
    mod.frequency.value = freq * 3;
    const modG = ctx.createGain();
    modG.gain.value = freq * 1.5;
    const car = ctx.createOscillator();
    car.type = "sine";
    car.frequency.value = freq;
    mod.connect(modG);
    modG.connect(car.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18, t);
    env.gain.setValueAtTime(0.18, t + beatSec * 0.15);
    env.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 0.9);
    car.connect(env);
    env.connect(master);
    mod.start(t);
    car.start(t);
    mod.stop(t + beatSec);
    car.stop(t + beatSec);
  }
  const bassNotes = [146.83, 164.81, 174.61, 196.0, 146.83, 130.81, 146.83, 164.81];
  let bassIdx = 0;
  function scheduleBass(t: number) {
    const freq = bassNotes[bassIdx % bassNotes.length];
    bassIdx++;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + beatSec * 1.8);
    o.connect(f);
    f.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + beatSec * 2);
  }

  let nextBeat = ctx.currentTime + 0.05;
  let beatCount = 0;
  let raf = 0;
  function schedule() {
    if (!clubMusic?.playing) return;
    while (nextBeat < ctx.currentTime + 0.3) {
      const b = beatCount % 16;
      if (b % 4 === 0 || b % 4 === 3) scheduleTabla(nextBeat);
      if (b % 4 === 1 || b % 4 === 2) scheduleTap(nextBeat);
      scheduleHat(nextBeat, b % 4 === 0);
      if (b % 2 === 0) scheduleMelody(nextBeat);
      if (b % 4 === 0) scheduleBass(nextBeat);
      nextBeat += beatSec;
      beatCount++;
    }
    raf = requestAnimationFrame(schedule);
    if (clubMusic) clubMusic.raf = raf;
  }
  clubMusic = {
    playing: true,
    raf: 0,
    stop() {
      this.playing = false;
      cancelAnimationFrame(this.raf);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => master.disconnect(), 2000);
      clubMusic = null;
    },
  };
  schedule();
}

export function stopClubMusic() {
  clubMusic?.stop();
}
