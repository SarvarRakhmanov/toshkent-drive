// Canvas-baked textures for VENU's interior (components/ClubInterior.tsx) —
// same tex()/procedural-canvas idiom as lib/airportTextures.ts, drawn once at
// module load and shared by every material that wants them.
import * as THREE from "three";

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Neon 4-colour checker instead of a flat emissive white — ClubInterior.tsx
// still animates hue/intensity on top of this per frame, this just gives the
// floor actual pattern to shift underneath that animation.
const FLOOR_COLORS = ["#ff2f8a", "#2fe9ff", "#ffd12f", "#8a2fff"];
export const FLOOR_TEX = tex(64, 64, (g) => {
  const cell = 16;
  for (let y = 0; y < 64; y += cell) {
    for (let x = 0; x < 64; x += cell) {
      const i = ((x / cell + y / cell) % FLOOR_COLORS.length + FLOOR_COLORS.length) % FLOOR_COLORS.length;
      g.fillStyle = FLOOR_COLORS[i];
      g.fillRect(x, y, cell, cell);
    }
  }
});
FLOOR_TEX.repeat.set(7, 7); // set once here rather than a `map-repeat` JSX prop on the one material that uses it

// Three simple flat-graphic wall posters — no photo assets, just bold shapes
// in the club's neon palette (starburst / equalizer bars / silhouette).
export const POSTER_STARBURST = tex(128, 192, (g) => {
  g.fillStyle = "#12081c";
  g.fillRect(0, 0, 128, 192);
  g.strokeStyle = "#ff3fd6";
  g.lineWidth = 3;
  const cx = 64, cy = 90;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 70, cy + Math.sin(a) * 70);
    g.stroke();
  }
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.arc(cx, cy, 22, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#12081c";
  g.font = "bold 20px sans-serif";
  g.textAlign = "center";
  g.fillText("VENU", cx, cy + 7);
});

export const POSTER_EQUALIZER = tex(128, 192, (g) => {
  g.fillStyle = "#0a1830";
  g.fillRect(0, 0, 128, 192);
  const bars = 9;
  for (let i = 0; i < bars; i++) {
    const h = 30 + Math.abs(Math.sin(i * 1.7)) * 130;
    g.fillStyle = i % 2 === 0 ? "#2fe9ff" : "#ff3fd6";
    g.fillRect(10 + i * 13, 176 - h, 9, h);
  }
});

export const POSTER_SILHOUETTE = tex(128, 192, (g) => {
  const grad = g.createLinearGradient(0, 0, 0, 192);
  grad.addColorStop(0, "#3a0a4a");
  grad.addColorStop(1, "#0d0416");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 192);
  g.fillStyle = "#0d0416";
  g.beginPath();
  g.ellipse(64, 60, 14, 18, 0, 0, Math.PI * 2); // head
  g.fill();
  g.beginPath();
  g.moveTo(46, 76);
  g.quadraticCurveTo(64, 130, 40, 190); // dress silhouette, one side
  g.lineTo(88, 190);
  g.quadraticCurveTo(64, 130, 82, 76);
  g.closePath();
  g.fill();
  g.strokeStyle = "#ffd12f";
  g.lineWidth = 2;
  g.strokeRect(6, 6, 116, 180);
});

export const POSTERS = [POSTER_STARBURST, POSTER_EQUALIZER, POSTER_SILHOUETTE];

// Shared with the exterior (components/Club.tsx) so the interior's walls
// read as the same premium black-panel/warm-wood material instead of
// re-baking a second, subtly different copy — moved here (2026-08-05) so
// ClubInterior.tsx can reuse them for wall-parity with the Milestone-22
// exterior redesign that landed a day after the interior's own last pass.
function tex2(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, wrapT = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  if (wrapT) t.wrapT = THREE.RepeatWrapping;
  return t;
}

export const CLUB_WOOD_TEX = tex2(128, 32, (g) => {
  for (let x = 0; x < 128; x += 8) {
    const warm = 0.75 + Math.random() * 0.35;
    g.fillStyle = `rgba(${Math.round(255 * warm)},${Math.round(140 * warm)},${Math.round(40 * warm)},1)`;
    g.fillRect(x, 0, 6, 32);
  }
  g.globalAlpha = 0.12;
  for (let i = 0; i < 40; i++) {
    g.fillStyle = Math.random() < 0.5 ? "#000000" : "#ffffff";
    g.fillRect(0, Math.random() * 32, 128, 1);
  }
});

export const CLUB_PANEL_TEX = tex2(128, 128, (g) => {
  g.fillStyle = "#0b0b0e";
  g.fillRect(0, 0, 128, 128);
  g.globalAlpha = 0.06;
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = Math.random() < 0.5 ? "#ffffff" : "#000000";
    g.beginPath();
    const x = Math.random() * 128;
    g.moveTo(x, 0);
    g.lineTo(x + (Math.random() - 0.5) * 10, 128);
    g.stroke();
  }
});
CLUB_PANEL_TEX.repeat.set(4, 2);

// Folded velvet-curtain stripe — alternating dark/lit red ridges, tiled
// along a curtain panel's width so it reads as fabric folds instead of a
// flat red fill. Same "bake a strip, tile it" idiom as CLUB_WOOD_TEX.
export const CLUB_CURTAIN_TEX = tex2(64, 32, (g) => {
  for (let x = 0; x < 64; x += 4) {
    const fold = 0.55 + 0.45 * Math.abs(Math.sin((x / 64) * Math.PI * 10));
    g.fillStyle = `rgba(${Math.round(150 * fold)},${Math.round(8 * fold)},${Math.round(20 * fold)},1)`;
    g.fillRect(x, 0, 4, 32);
  }
});
CLUB_CURTAIN_TEX.repeat.set(3, 1);

// Tufted chesterfield-leather diamond pattern — dark navy leather with a
// grid of stitched diamond seams and a soft highlight per button, tiled
// across a sofa's cushion faces.
export const CLUB_CHESTERFIELD_TEX = tex2(128, 128, (g) => {
  g.fillStyle = "#0d1220";
  g.fillRect(0, 0, 128, 128);
  const cell = 32;
  g.strokeStyle = "rgba(0,0,0,0.55)";
  g.lineWidth = 2;
  for (let y = 0; y <= 128; y += cell) {
    for (let x = -cell; x <= 128; x += cell) {
      g.beginPath();
      g.moveTo(x, y - cell / 2);
      g.lineTo(x + cell / 2, y);
      g.lineTo(x, y + cell / 2);
      g.lineTo(x - cell / 2, y);
      g.closePath();
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
});
CLUB_CHESTERFIELD_TEX.repeat.set(2, 1);

// Polished marble slab — soft grey base with faint diagonal veining, for the
// VIP lounge's round coffee tables.
export const CLUB_MARBLE_TEX = tex2(
  128,
  128,
  (g) => {
    g.fillStyle = "#c8c6c2";
    g.fillRect(0, 0, 128, 128);
    g.globalAlpha = 0.3;
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = Math.random() < 0.5 ? "#8a8884" : "#e8e6e0";
      g.lineWidth = 1 + Math.random();
      g.beginPath();
      const x0 = Math.random() * 128;
      g.moveTo(x0, 0);
      g.bezierCurveTo(x0 + 30, 40, x0 - 30, 90, x0 + (Math.random() - 0.5) * 40, 128);
      g.stroke();
    }
  },
  false
);
