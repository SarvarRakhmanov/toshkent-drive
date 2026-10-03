import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  Camera,
  Cloud,
  CloudRain,
  Fuel,
  Gauge,
  Lightbulb,
  Lock,
  Pause,
  Play,
  Settings,
  Sun,
  Volume2,
  Wrench,
} from "lucide-react";
import { CATALOG } from "@/game/vehicles";
import { POIS } from "@/game/layout";
import { DriveSim, type Snapshot } from "@/game/sim";

type Panel = "none" | "garage" | "missions" | "settings" | "credits" | "maps";

const PAINTS = [
  { name: "Sage silver", hex: "#b7c0b0" },
  { name: "Pearl", hex: "#e7e4dc" },
  { name: "Graphite", hex: "#3e454c" },
  { name: "Ink", hex: "#1c2126" },
  { name: "Ceramic red", hex: "#8e2f2a" },
  { name: "Neptune", hex: "#2f4f62" },
];

const MISSIONS = [
  { id: "free", name: "Free drive", detail: "Leave the bay and explore the square." },
  { id: "hotel", name: "City drive", detail: "Reach Hotel Uzbekistan." },
  { id: "park", name: "Parking", detail: "Pull out, then stop in the marked bay." },
  { id: "majlis", name: "Boulevard", detail: "Drive north to Oliy Majlis." },
  { id: "tower", name: "Clean run", detail: "Reach the tower without a collision." },
  { id: "express", name: "Express", detail: "Hotel Uzbekistan in under a minute and a half." },
  { id: "fuel", name: "Fill up", detail: "Stop at Yoqilg'i with a full tank. Press F." },
  { id: "servis", name: "Service", detail: "Stop at Servis with the body repaired. Press G." },
  { id: "night", name: "Night run", detail: "Reach the tower after sunset." },
  { id: "rain", name: "Rain run", detail: "Set rain, then reach Oliy Majlis." },
];

function clock(h: number) {
  const hh = Math.floor(h) % 24;
  const mm = Math.floor((h % 1) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function DriveApp() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<DriveSim | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const [err, setErr] = useState("");
  const [coarse, setCoarse] = useState(false);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let sim: DriveSim | null = null;
    let dead = false;
    try {
      sim = new DriveSim(canvas, setSnap);
      if (!dead) {
        simRef.current = sim;
      }
    } catch (e) {
      if (!dead) setErr(e instanceof Error ? e.message : "WebGL failed to start.");
    }
    const ro = new ResizeObserver(() => simRef.current?.resize());
    ro.observe(canvas);
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    const onResize = () => setNarrow(window.innerWidth < 820);
    onResize();
    window.addEventListener("resize", onResize);
    const onOri = (e: DeviceOrientationEvent) => {
      const s = simRef.current;
      if (!s || s.save.settings.control !== "tilt") return;
      const g = e.gamma ?? 0;
      s.setTouch({ steer: Math.max(-1, Math.min(1, -g / 28)) });
    };
    window.addEventListener("deviceorientation", onOri);
    return () => {
      dead = true;
      ro.disconnect();
      window.removeEventListener("deviceorientation", onOri);
      window.removeEventListener("resize", onResize);
      sim?.dispose();
      simRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (snap?.phase === "play" && miniRef.current) simRef.current?.setMini(miniRef.current);
  }, [snap?.phase]);

  const sim = simRef.current;
  const showTouch =
    !!sim && (sim.save.settings.showTouch === "on" || (sim.save.settings.showTouch === "auto" && (coarse || narrow)));

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-ink text-cream">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" />
      {err ? (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <p className="max-w-md rounded-lg bg-panel p-6 text-center">{err}</p>
        </div>
      ) : null}

      {!snap ? (
        <div className="absolute inset-x-0 bottom-0 p-3 md:inset-y-0 md:left-0 md:w-64">
          <div className="rounded-lg border border-line bg-panel/95 p-3">
            <p className="font-display text-xl text-gold">Toshkent</p>
            <p className="mt-1 text-xs text-muted">Building Amir Temur…</p>
          </div>
        </div>
      ) : null}

      {snap && snap.phase !== "play" ? (
        <div className="absolute inset-x-0 bottom-0 z-10 max-h-[70%] overflow-y-auto p-2 md:inset-y-0 md:left-0 md:max-h-none md:w-64">
          <div className="rounded-lg border border-line bg-panel/90 p-3 shadow-lg backdrop-blur">
            <p className="text-[10px] tracking-widest text-tile">41.3114° N · 69.2797° E</p>
            <h1 className="font-display text-2xl leading-none text-cream">Toshkent</h1>
            <p className="text-xs text-gold">Amir Temur xiyoboni</p>
            <p className="mt-2 text-xs leading-snug text-muted">
              Plate <span className="text-cream">01 D 666 FB</span> on the Seltos, <span className="text-cream">90 O 909 BA</span> on the Lacetti.
            </p>
            {snap.phase === "pause" ? (
              <button className="mt-2 flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-tile px-3 text-sm font-semibold text-ink" onClick={() => { simRef.current?.resume(); setPanel("none"); }}>
                <Play className="size-3.5" /> Resume
              </button>
            ) : (
              <button className="mt-2 flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-tile px-3 text-sm font-semibold text-ink" onClick={() => simRef.current?.start()}>
                <Play className="size-3.5" /> Start
              </button>
            )}
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Ghost onClick={() => setPanel(panel === "garage" ? "none" : "garage")}>Garage</Ghost>
              <Ghost onClick={() => setPanel(panel === "missions" ? "none" : "missions")}>Missions</Ghost>
              <Ghost onClick={() => setPanel(panel === "settings" ? "none" : "settings")}>Settings</Ghost>
              <Ghost onClick={() => setPanel(panel === "maps" ? "none" : "maps")}>Maps</Ghost>
              <Ghost onClick={() => setPanel(panel === "credits" ? "none" : "credits")}>Credits</Ghost>
            </div>
            {snap.phase === "pause" ? (
              <button className="mt-1.5 min-h-9 w-full rounded-lg border border-line text-xs text-muted" onClick={() => simRef.current?.respawn()}>
                Return to the parking bay
              </button>
            ) : null}
            <p className="mt-2 text-[10px] leading-snug text-muted">WASD · A left, D right · C camera · Esc pause</p>
            {panel === "garage" && sim ? <Garage sim={sim} /> : null}
            {panel === "missions" && sim ? <Missions sim={sim} done={sim.save.missions} /> : null}
            {panel === "settings" && sim ? <SettingsPanel sim={sim} onChange={() => setSnap((s) => (s ? { ...s } : s))} /> : null}
            {panel === "maps" && sim ? <MapsPanel sim={sim} note={snap.mapNote} onChange={() => setSnap((s) => (s ? { ...s } : s))} /> : null}
            {panel === "credits" ? <Credits /> : null}
          </div>
        </div>
      ) : null}

      {snap?.phase === "play" ? (
        <>
          <div className="pointer-events-none absolute inset-0 z-10">
            <div className="absolute top-3 left-3">
              <canvas ref={miniRef} width={220} height={220} className="h-28 w-28 rounded-lg border border-white/10 bg-ink/70 shadow-lg backdrop-blur md:h-40 md:w-40" />
            </div>
            <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
              <button className="pointer-events-auto flex size-12 items-center justify-center rounded-full border border-white/10 bg-ink/70 backdrop-blur" onClick={() => { simRef.current?.pause(); setPanel("none"); }} aria-label="Pause">
                <Pause className="size-5" />
              </button>
              <p className="rounded-full bg-ink/70 px-3 py-1 text-xs backdrop-blur">{clock(snap.hour)} · {snap.weather}</p>
              <p className="rounded-full bg-ink/70 px-3 py-1 text-xs text-gold backdrop-blur">{snap.unlimited ? "∞ so'm" : `${snap.money} so'm`}</p>
              {snap.violations > 0 ? <p className="rounded-full bg-ink/70 px-3 py-1 text-xs text-rust backdrop-blur">Fines {snap.violations}</p> : null}
            </div>
            <div className="absolute inset-x-0 bottom-24 flex justify-center px-3 md:bottom-5">
              <div className="flex items-end gap-3 rounded-2xl border border-white/10 bg-ink/75 px-4 py-3 shadow-xl backdrop-blur">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-6xl leading-none tabular-nums">{Math.round(snap.speed)}</span>
                    <span className="text-xs tracking-widest text-muted">KM/H</span>
                  </div>
                  <div className="mt-1 h-1 w-36 overflow-hidden rounded-full bg-white/10">
                    <div className="h-1 bg-gold" style={{ width: `${Math.min(100, (snap.rpm / 6500) * 100)}%` }} />
                  </div>
                </div>
                <div className="mb-1 flex flex-col items-center gap-1">
                  <span className="rounded-md bg-gold px-2.5 py-1 text-lg font-semibold text-ink">{snap.gear}</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted">{snap.driveMode}</span>
                </div>
                <div className="mb-1 hidden min-w-36 text-right sm:block">
                  <p className="text-sm font-semibold">{snap.nav}</p>
                  <p className="text-[11px] text-gold">{snap.vehicle}</p>
                  {snap.prompt ? <p className="text-[11px] text-cream">{snap.prompt}</p> : null}
                  {snap.toast ? <p className="text-[11px] text-good">{snap.toast}</p> : null}
                </div>
                <div className="mb-1 flex flex-col gap-1">
                  <Meter icon={<Fuel className="size-3.5" />} value={snap.fuel} />
                  <Meter icon={<Wrench className="size-3.5" />} value={1 - snap.damage / 100} />
                </div>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-44 flex justify-center px-4 sm:hidden">
              <div className="rounded-lg bg-ink/80 px-3 py-1 text-center text-xs">
                <p className="font-semibold">{snap.nav}</p>
                {snap.toast ? <p className="text-good">{snap.toast}</p> : null}
              </div>
            </div>
          </div>
          {showTouch && sim ? <Touch sim={sim} mode={sim.save.settings.control} /> : null}
          <div className="absolute right-3 bottom-48 z-20 flex flex-col gap-2 md:bottom-28">
            <Round label="Horn" onClick={() => simRef.current?.horn()}>H</Round>
            <Round label="Lights" onClick={() => simRef.current?.toggleLights()}><Lightbulb className="size-4" /></Round>
            <Round label="Camera" onClick={() => simRef.current?.cycleCam()}><Camera className="size-4" /></Round>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Ghost({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button className="min-h-8 rounded-md border border-line bg-panel-2 px-2 text-xs" onClick={onClick}>
      {children}
    </button>
  );
}

function Round({ children, onClick, label }: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button className="flex size-12 items-center justify-center rounded-lg border border-line bg-panel/90 text-sm" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}

function Meter({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/30 px-2 py-1">
      {icon}
      <div className="h-1.5 w-16 rounded-full bg-line">
        <div className="h-1.5 rounded-full bg-tile" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
    </div>
  );
}

function Garage({ sim }: { sim: DriveSim }) {
  const save = sim.save;
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl">Garage</h2>
        <span className="text-sm text-gold">{save.settings.unlimited ? "∞ so'm" : `${save.money} so'm`}</span>
      </div>
      {CATALOG.map((car) => {
        const open = save.unlocked.includes(car.id);
        const on = save.vehicle === car.id;
        return (
          <button
            key={car.id}
            className={`w-full rounded-lg border p-3 text-left ${on ? "border-tile bg-panel-2" : "border-line"}`}
            onClick={() => (open ? sim.selectVehicle(car.id) : sim.tryUnlock(car.id))}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">{car.name}</span>
              {open ? <span className="text-xs text-good">{on ? "Driving" : "Unlocked"}</span> : <span className="flex items-center gap-1 text-xs text-muted"><Lock className="size-3" /> {car.price}</span>}
            </div>
            <p className="mt-1 text-xs text-muted">{car.blurb}</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted">
              <span>0–100 feel {car.accel.toFixed(1)}</span>
              <span>Top {car.top} km/h</span>
              <span>Mass {car.mass} kg</span>
              <span>Brake {car.brake.toFixed(1)}</span>
            </div>
          </button>
        );
      })}
      <p className="text-xs text-muted">Paint</p>
      <div className="flex flex-wrap gap-2">
        {PAINTS.map((p) => (
          <button key={p.hex} className="size-11 rounded-lg border border-line" style={{ background: p.hex }} aria-label={p.name} onClick={() => sim.setPaint(p.hex)} />
        ))}
      </div>
      <label className="block text-xs text-muted">
        Window tint
        <input className="mt-1 w-full" type="range" min={0.28} max={0.7} step={0.02} defaultValue={save.tint} onChange={(e) => sim.setTint(Number(e.target.value))} />
      </label>
      <p className="text-xs text-muted">
        {save.vehicle === "lacetti" ? "Lacetti plate 90 O 909 BA" : save.vehicle === "seltos" ? "Seltos plate 01 D 666 FB" : "Plate 01 A 100 AA"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["engine", "brakes", "tires", "suspension"] as const).map((k) => (
          <button key={k} className="min-h-11 rounded-lg border border-line px-2 text-xs" onClick={() => sim.upgrade(k)}>
            {k} {save.upgrades[k]}/3 · {450 * (save.upgrades[k] + 1)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["eco", "normal", "sport"] as const).map((m) => (
          <button key={m} className="min-h-11 rounded-lg border border-line text-sm capitalize" onClick={() => sim.setDriveMode(m)}>{m}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <Ghost onClick={() => sim.repair()}>Repair</Ghost>
        <Ghost onClick={() => sim.refuel()}>Refuel</Ghost>
      </div>
    </div>
  );
}

function Missions({ sim, done }: { sim: DriveSim; done: string[] }) {
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      <h2 className="font-display text-xl">Missions</h2>
      {MISSIONS.map((m) => (
        <button key={m.id} className="w-full rounded-lg border border-line p-3 text-left" onClick={() => sim.setMission(m.id)}>
          <div className="flex justify-between">
            <span className="font-semibold">{m.name}</span>
            {done.includes(m.id) ? <span className="text-xs text-good">Done</span> : null}
          </div>
          <p className="text-xs text-muted">{m.detail}</p>
        </button>
      ))}
      <p className="pt-2 text-xs text-muted">Navigate</p>
      <div className="flex flex-wrap gap-2">
        {POIS.map((p) => (
          <button key={p.id} className="min-h-11 rounded-lg border border-line px-3 text-xs" onClick={() => sim.setDest(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function MapsPanel({ sim, note, onChange }: { sim: DriveSim; note: string; onChange: () => void }) {
  const rows: { id: "amir" | "grid" | "neon" | "block"; name: string; blurb: string }[] = [
    { id: "amir", name: "Amir Temur", blurb: "The square, the hotel, and Sayilgoh. Default." },
    { id: "grid", name: "Grid", blurb: "Open roads, curves, an overpass. Grass lots filled." },
    { id: "neon", name: "Neon", blurb: "Wet avenue mirrored into a circuit. Billboards glow." },
    { id: "block", name: "Block", blurb: "Brick streets in a 3×3 district. Clips play." },
  ];
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      <h2 className="font-display text-xl">Maps</h2>
      {rows.map((row) => {
        const on = sim.save.settings.map === row.id;
        return (
          <button
            key={row.id}
            className={`min-h-11 w-full rounded-lg border p-3 text-left ${on ? "border-tile bg-panel-2" : "border-line"}`}
            onClick={() => {
              sim.setMap(row.id);
              onChange();
            }}
          >
            <span className="font-semibold">{row.name}</span>
            <span className="mt-1 block text-xs text-muted">{row.blurb}</span>
          </button>
        );
      })}
      <p className="text-xs text-gold">{note}</p>
    </div>
  );
}

function SettingsPanel({ sim, onChange }: { sim: DriveSim; onChange: () => void }) {
  const s = sim.save.settings;
  const set = (partial: Parameters<DriveSim["applySettings"]>[0]) => {
    sim.applySettings(partial);
    onChange();
  };
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm">
      <h2 className="flex items-center gap-2 font-display text-xl"><Settings className="size-4" /> Settings</h2>
      <label className="block text-muted">
        Graphics
        <select className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-cream" value={s.quality} onChange={(e) => set({ quality: e.target.value as typeof s.quality, autoGfx: false })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="ultra">Ultra</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-muted">
        <input type="checkbox" checked={s.autoGfx} onChange={(e) => set({ autoGfx: e.target.checked })} /> Auto quality
      </label>
      <label className="block text-muted">
        Traffic
        <select className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-cream" value={s.density} onChange={(e) => set({ density: e.target.value as typeof s.density })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setWeather("sun"); onChange(); }}><Sun className="inline size-4" /> Sun</button>
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setWeather("cloud"); onChange(); }}><Cloud className="inline size-4" /> Cloud</button>
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setWeather("rain"); onChange(); }}><CloudRain className="inline size-4" /> Rain</button>
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setWeather("fog"); onChange(); }}>Fog</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setHour(7.5); onChange(); }}>Morning</button>
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setHour(13); onChange(); }}>Day</button>
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setHour(18.7); onChange(); }}>Sunset</button>
        <button className="min-h-11 rounded-lg border border-line px-3" onClick={() => { sim.setHour(21.5); onChange(); }}>Night</button>
      </div>
      <label className="flex items-center gap-2 text-muted">
        <input type="checkbox" checked={s.autoTime} onChange={(e) => { sim.setAutoTime(e.target.checked); onChange(); }} /> 24-hour cycle
      </label>
      <label className="flex items-center gap-2 text-muted">
        <input type="checkbox" checked={s.manual} onChange={(e) => set({ manual: e.target.checked })} /> Manual gears (Shift / Ctrl)
      </label>
      <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={s.assists.abs} onChange={(e) => set({ assists: { ...s.assists, abs: e.target.checked } })} /> ABS</label>
      <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={s.assists.tcs} onChange={(e) => set({ assists: { ...s.assists, tcs: e.target.checked } })} /> Traction control</label>
      <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={s.assists.esp} onChange={(e) => set({ assists: { ...s.assists, esp: e.target.checked } })} /> Stability</label>
      <label className="block text-muted">
        <Volume2 className="inline size-4" /> Volume
        <input className="mt-1 w-full" type="range" min={0} max={1} step={0.05} value={s.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
      </label>
      <label className="block text-muted">
        Steering
        <select className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-cream" value={s.control} onChange={(e) => set({ control: e.target.value as typeof s.control })}>
          <option value="buttons">Buttons</option>
          <option value="wheel">Wheel</option>
          <option value="tilt">Tilt</option>
        </select>
      </label>
      <label className="block text-muted">
        On-screen controls
        <select className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-2 text-cream" value={s.showTouch} onChange={(e) => set({ showTouch: e.target.value as typeof s.showTouch })}>
          <option value="auto">Auto</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </label>
      <button
        className={`min-h-11 w-full rounded-lg border px-3 font-semibold ${s.unlimited ? "border-gold bg-gold/15 text-gold" : "border-line text-cream"}`}
        onClick={() => set({ unlimited: !s.unlimited })}
      >
        {s.unlimited ? "Unlimited money: on" : "Unlimited money"}
      </button>
      <p className="flex items-center gap-2 text-xs text-muted"><Gauge className="size-3.5" /> Low frame rate drops quality and trims traffic.</p>
    </div>
  );
}

function Credits() {
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4 text-xs leading-relaxed text-muted">
      <h2 className="font-display text-xl text-cream">Credits</h2>
      <p>District layout is original, anchored on Amir Temur Square (41.31143 N, 69.27966 E). Hotel Uzbekistan sits east of the gardens, Sayilgoh to the west. Oliy Majlis and the TV tower are compressed into this first 520 m tile so they can be driven to. Not an OSM tile renderer.</p>
      <p>The player Kia Seltos is the 3D model you supplied (Mexico Seltos PE). The driver is “man sitting” by Ace-of_spades on Sketchfab, CC BY 4.0 (https://sketchfab.com/3d-models/man-sitting-b46bceb164b74346897c7a62691a1d5c). Chevrolet Lacetti is “Lacetti” by uzb_rx7 on Sketchfab, CC BY 4.0 (https://sketchfab.com/3d-models/lacetti-d3c32dfa9aea435b838a907394e4f0d2). Seltos plate 01 D 666 FB and Lacetti plate 90 O 909 BA are fictional and are not real Uzbek registrations.</p>
      <p>Traffic, buildings, and pedestrians are original low-poly geometry. Only the player Seltos uses the model you supplied.</p>
    </div>
  );
}

function Touch({ sim, mode }: { sim: DriveSim; mode: string }) {
  const hold = (partial: Partial<DriveSim["touch"]>, clear: Partial<DriveSim["touch"]>) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      sim.setTouch(partial);
    },
    onPointerUp: () => sim.setTouch(clear),
    onPointerCancel: () => sim.setTouch(clear),
  });
  return (
    <div className="absolute inset-x-0 bottom-3 z-20 flex items-end justify-between px-3">
      {mode === "wheel" ? (
        <div
          className="flex size-28 items-center justify-center rounded-full border border-line bg-panel/80 text-xs text-muted"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            const origin = e.clientX;
            const move = (ev: globalThis.PointerEvent) =>
              sim.setTouch({ steer: Math.max(-1, Math.min(1, (ev.clientX - origin) / 70)) });
            const up = () => {
              sim.setTouch({ steer: 0 });
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        >
          Wheel
        </div>
      ) : mode === "tilt" ? (
        <button
          className="min-h-14 rounded-lg border border-line bg-panel/90 px-4"
          onClick={() => {
            const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
            if (D.requestPermission) void D.requestPermission();
          }}
        >
          Enable tilt
        </button>
      ) : (
        <div className="flex gap-2">
          <button className="size-16 rounded-lg border border-line bg-panel/90 text-lg" {...hold({ steer: 1 }, { steer: 0 })}>A</button>
          <button className="size-16 rounded-lg border border-line bg-panel/90 text-lg" {...hold({ steer: -1 }, { steer: 0 })}>D</button>
        </div>
      )}
      <div className="flex gap-2">
        <button className="h-16 w-20 rounded-lg bg-rust/90 font-semibold text-cream" {...hold({ brake: 1 }, { brake: 0 })}>Brake</button>
        <button className="h-16 w-20 rounded-lg bg-tile font-semibold text-ink" {...hold({ throttle: 1 }, { throttle: 0 })}>Gas</button>
      </div>
    </div>
  );
}
