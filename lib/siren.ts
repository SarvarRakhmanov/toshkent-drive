import { getAudioCtx } from "@/lib/audio";

// v1.8 police siren: two detuned oscillators swept by an LFO (US "wail"),
// volume set every frame from the nearest chase unit's distance.
let nodes: { gain: GainNode; stop: () => void } | null = null;

export function setSirenVolume(v: number) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (v <= 0.001) {
    if (nodes) { nodes.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.2); }
    return;
  }
  if (!nodes) {
    const gain = ctx.createGain(); gain.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 2400;
    const o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = 900;
    const o2 = ctx.createOscillator(); o2.type = "square"; o2.frequency.value = 905;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.32;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 420;
    lfo.connect(lfoGain); lfoGain.connect(o1.frequency); lfoGain.connect(o2.frequency);
    const mix = ctx.createGain(); mix.gain.value = 0.18;
    o1.connect(mix); o2.connect(mix); mix.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
    o1.start(); o2.start(); lfo.start();
    nodes = { gain, stop: () => { o1.stop(); o2.stop(); lfo.stop(); } };
  }
  nodes.gain.gain.setTargetAtTime(Math.min(0.5, v), ctx.currentTime, 0.1);
}
