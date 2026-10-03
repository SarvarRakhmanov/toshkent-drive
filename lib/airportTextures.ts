// Canvas-baked textures for the international airport (components/Airport.tsx,
// components/Airliner.tsx). Same idiom as components/City.tsx's canvasTex():
// drawn once at module load, shared by every material that wants them, and
// NearestFilter + high anisotropy so panel lines / runway markings stay sharp
// instead of smearing at the shallow angles a chase cam looks at tarmac from.
//
// This module touches `document`, so it must only ever be pulled in from
// client components (the whole game already loads via next/dynamic ssr:false —
// see app/page.tsx).
import * as THREE from "three";

// Exported so components/AirlinerCockpit.tsx can bake its own instrument-face
// textures with this exact convention instead of reinventing it.
export function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.anisotropy = 16;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const v = Math.random();
    g.fillStyle = `rgba(${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${v > 0.5 ? 255 : 0},${alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
}

// Runway asphalt: dark aggregate + the transverse grooving real runways are
// cut with, plus a couple of rubber-deposit smears near the thresholds.
export const RUNWAY_TEX = tex(256, 256, (g) => {
  g.fillStyle = "#22242a";
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 5000, 0.08);
  g.strokeStyle = "rgba(0,0,0,.35)";
  g.lineWidth = 1;
  for (let x = 0; x < 256; x += 6) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  g.fillStyle = "rgba(10,10,12,.35)";
  g.fillRect(0, 90, 256, 26);
});

// Apron/taxiway concrete: big poured slabs with visible expansion joints and
// oil staining — reads as concrete, not the runway's asphalt.
export const CONCRETE_TEX = tex(256, 256, (g) => {
  g.fillStyle = "#4a4d53";
  g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, 6000, 0.07);
  g.strokeStyle = "#33363b";
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  g.fillStyle = "rgba(20,20,24,.25)";
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    g.ellipse(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 12, 3 + Math.random() * 8, 0, 0, Math.PI * 2);
    g.fill();
  }
});

// Shared by all three fuselage skins below: panel seams + rivets at 2x the
// old 512x128 bake so they stay crisp when a player walks right up to the
// hull instead of just driving past at a distance.
function panelsAndRivets(g: CanvasRenderingContext2D, w: number, h: number, seam: string, rivet: string) {
  g.strokeStyle = seam;
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, h);
    g.stroke();
  }
  for (let y = 0; y < h; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.fillStyle = rivet;
  for (let x = 8; x < w; x += 16) for (let y = 0; y < h; y += 32) g.fillRect(x, y, 2, 2);
}

// One cabin window: dark glass, a raised light-grey frame/bezel like a real
// riveted window surround, and a bright reflection lip on the upper pane.
function window(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  g.fillStyle = "#cfd5dc";
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  g.fillStyle = "#0e131c";
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(195,222,248,.5)";
  g.fillRect(x, y, w, Math.max(2, h * 0.28));
}

// Airliner fuselage skin: painted aluminium with riveted panel seams and a
// baked cabin window row. One horizontal strip repeated along the fuselage —
// far cheaper than ~90 window meshes per aircraft, and sharper up close.
export const FUSELAGE_TEX = tex(1024, 256, (g) => {
  g.fillStyle = "#eef2f6";
  g.fillRect(0, 0, 1024, 256);
  panelsAndRivets(g, 1024, 256, "rgba(150,158,170,.55)", "rgba(140,148,160,.5)");
  for (let x = 52; x < 972; x += 32) window(g, x, 112, 16, 18);
  // door outlines
  g.strokeStyle = "rgba(120,128,140,.8)";
  g.lineWidth = 3;
  for (const x of [24, 472, 960]) g.strokeRect(x, 88, 28, 68);
  noise(g, 1024, 256, 6000, 0.05);
});

// Freighter skin: no cabin window row, a main-deck cargo door instead.
export const CARGO_TEX = tex(1024, 256, (g) => {
  g.fillStyle = "#d9dde2";
  g.fillRect(0, 0, 1024, 256);
  panelsAndRivets(g, 1024, 256, "rgba(150,158,170,.6)", "rgba(140,148,160,.5)");
  // cockpit-window-only up front (freighters keep the flight deck glazing)
  for (let x = 52; x < 140; x += 32) window(g, x, 112, 16, 18);
  g.strokeStyle = "#6e7682";
  g.lineWidth = 5;
  g.strokeRect(300, 68, 380, 112); // main-deck cargo door
  g.strokeRect(120, 156, 80, 60); // forward service door
  noise(g, 1024, 256, 6000, 0.05);
});

// Same skin, scorched and stained — the half-broken jet under repair.
export const BURNT_FUSELAGE_TEX = tex(1024, 256, (g) => {
  g.fillStyle = "#c8c6c0";
  g.fillRect(0, 0, 1024, 256);
  panelsAndRivets(g, 1024, 256, "rgba(110,108,104,.6)", "rgba(100,98,94,.4)");
  for (let x = 52; x < 972; x += 32) {
    g.fillStyle = "#0d0f13";
    g.fillRect(x, 112, 16, 18);
  }
  // soot plumes trailing aft
  for (let i = 0; i < 40; i++) {
    const x = 300 + Math.random() * 660;
    g.fillStyle = `rgba(20,18,16,${0.15 + Math.random() * 0.35})`;
    g.beginPath();
    g.ellipse(x, 40 + Math.random() * 180, 20 + Math.random() * 80, 12 + Math.random() * 40, 0, 0, Math.PI * 2);
    g.fill();
  }
  // missing panels, bare frame showing through
  g.fillStyle = "#3a3d44";
  g.fillRect(600, 60, 120, 80);
  g.fillRect(380, 148, 88, 60);
  noise(g, 1024, 256, 9000, 0.09);
});

// Corrugated hangar / cargo-container steel.
export const CORRUGATED_TEX = tex(128, 128, (g) => {
  g.fillStyle = "#9aa0a8";
  g.fillRect(0, 0, 128, 128);
  for (let x = 0; x < 128; x += 8) {
    g.fillStyle = "rgba(255,255,255,.16)";
    g.fillRect(x, 0, 3, 128);
    g.fillStyle = "rgba(0,0,0,.22)";
    g.fillRect(x + 5, 0, 3, 128);
  }
  noise(g, 128, 128, 1200, 0.06);
});

// Terminal curtain wall: mullion grid over dark glass, lit from inside.
export const TERMINAL_GLASS_TEX = tex(256, 256, (g) => {
  g.fillStyle = "#16232f";
  g.fillRect(0, 0, 256, 256);
  for (let y = 8; y < 256; y += 32) {
    for (let x = 6; x < 256; x += 22) {
      g.fillStyle = Math.random() < 0.55 ? "#3d6b8c" : "#20374a";
      g.fillRect(x, y, 17, 26);
    }
  }
  g.strokeStyle = "#aab3bd";
  g.lineWidth = 2;
  for (let y = 0; y < 256; y += 32) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  for (let x = 0; x < 256; x += 22) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
});

export function repeat(t: THREE.Texture, x: number, y: number) {
  const c = t.clone();
  c.needsUpdate = true;
  c.wrapS = c.wrapT = THREE.RepeatWrapping;
  c.repeat.set(x, y);
  return c;
}
