import { getAudioCtx } from "@/lib/audio";

// tiny WebAudio blips for mission events (no assets)
export function playSfx(kind: "start" | "check" | "done" | "fail") {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const notes = kind === "start" ? [523, 659] : kind === "check" ? [880] : kind === "done" ? [523, 659, 784, 1047] : [330, 247];
  const t0 = ctx.currentTime;
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.22);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + i * 0.09);
    o.stop(t0 + i * 0.09 + 0.25);
  });
}
