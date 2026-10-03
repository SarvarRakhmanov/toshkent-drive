export class DriveAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: OscillatorNode | null = null;
  private overtone: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private rumble: AudioBufferSourceNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rasp: OscillatorNode | null = null;
  private raspGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  volume = 0.7;
  muted = false;

  unlock() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      const ctx = new AC();
      this.ctx = ctx;
      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.volume * this.volume;
      master.connect(ctx.destination);
      this.master = master;

      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 240;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      osc.start();
      const over = ctx.createOscillator();
      over.type = "triangle";
      const og = ctx.createGain();
      og.gain.value = 0;
      over.connect(og);
      og.connect(master);
      over.start();
      const rasp = ctx.createOscillator();
      rasp.type = "square";
      const raspFilter = ctx.createBiquadFilter();
      raspFilter.type = "highpass";
      raspFilter.frequency.value = 180;
      const rgain = ctx.createGain();
      rgain.gain.value = 0;
      rasp.connect(raspFilter);
      raspFilter.connect(rgain);
      rgain.connect(master);
      rasp.start();
      this.engine = osc;
      this.overtone = over;
      this.rasp = rasp;
      this.raspGain = rgain;
      this.engineFilter = filter;
      this.engineGain = gain;
      this.windGain = og;

      const noiseLen = ctx.sampleRate * 1;
      const buffer = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let n = 0;
      for (let i = 0; i < noiseLen; i++) {
        n = (n + 0.02 * (Math.random() * 2 - 1)) * 0.98;
        data[i] = n;
      }
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const rg = ctx.createGain();
      rg.gain.value = 0;
      src.connect(rg);
      rg.connect(master);
      src.start();
      this.rumble = src;
      this.rumbleGain = rg;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  setVolume(v: number) {
    this.volume = v;
    if (!this.master || !this.ctx) return;
    const g = this.muted ? 0 : v * v;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.03);
  }

  update(rpm: number, speed: number, engineOn: boolean, skid: number, sport = false) {
    if (!this.ctx || !this.engine || !this.engineGain || !this.engineFilter || !this.rumbleGain || !this.overtone || !this.windGain) return;
    const t = this.ctx.currentTime;
    const kmh = Math.abs(speed) * 3.6;
    const freq = engineOn ? (sport ? 78 + rpm * 0.118 : 42 + rpm * 0.042) : 28;
    this.engine.frequency.setTargetAtTime(Math.max(30, freq), t, sport ? 0.025 : 0.04);
    this.overtone.frequency.setTargetAtTime(Math.max(50, freq * (sport ? 2.51 : 2.02)), t, 0.04);
    this.engineFilter.frequency.setTargetAtTime(engineOn ? (sport ? 420 + rpm * 0.95 + kmh * 4 : 220 + rpm * 0.42) : 90, t, 0.04);
    this.engineGain.gain.setTargetAtTime(engineOn ? (sport ? 0.045 + Math.min(0.11, rpm / 6200) : 0.04 + Math.min(0.07, rpm / 8000)) : 0, t, 0.03);
    this.windGain.gain.setTargetAtTime(engineOn ? 0.006 + Math.min(0.05, Math.abs(speed) * (sport ? 0.0022 : 0.0012)) : 0.004, t, 0.08);
    if (this.rasp && this.raspGain) {
      this.rasp.frequency.setTargetAtTime(Math.max(90, freq * (sport ? 3.05 : 1.5)), t, 0.03);
      this.raspGain.gain.setTargetAtTime(engineOn && sport ? 0.012 + Math.min(0.045, rpm / 14000) : 0, t, 0.04);
    }
    const wet = skid > 0.2 ? 0.02 : 0;
    const roll = engineOn ? Math.min(0.045, Math.abs(speed) * 0.0018) + skid * 0.045 + wet : 0.01;
    this.rumbleGain.gain.setTargetAtTime(roll, t, 0.05);
  }

  horn() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const mk = (freq: number) => {
      const o = this.ctx!.createOscillator();
      o.type = "square";
      o.frequency.value = freq;
      const g = this.ctx!.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.04, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g);
      g.connect(this.master!);
      o.start(t);
      o.stop(t + 0.36);
    };
    mk(392);
    mk(311);
  }

  blip(freq = 180, dur = 0.08, type: OscillatorType = "square", vol = 0.03) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  thud() {
    this.blip(70, 0.18, "sine", 0.06);
    this.blip(140, 0.09, "triangle", 0.03);
  }
}
