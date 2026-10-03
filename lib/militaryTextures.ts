// Canvas-baked camo texture for FORT NEON (components/MilitaryBase.tsx) —
// same idiom as lib/airportTextures.ts's tex()/noise(): drawn once at module
// load, NearestFilter + high anisotropy, RepeatWrapping so one small tile
// covers the whole compound ground plane without smearing.
import * as THREE from "three";

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
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

// Classic 4-tone woodland blotch camo: olive base, irregular brown/khaki/black
// blobs drawn as overlapping ellipses (cheap, reads correctly at driving
// distance — no need for a real Perlin-noise camo generator here).
const CAMO_COLORS = ["#5a5c34", "#3a3a1f", "#7a6a3a", "#1c1c14"];
export const CAMO_TEX = tex(256, 256, (g) => {
  g.fillStyle = CAMO_COLORS[0];
  g.fillRect(0, 0, 256, 256);
  const rand = mulberry32(0x9e3779b9);
  for (let i = 0; i < 46; i++) {
    g.fillStyle = CAMO_COLORS[1 + Math.floor(rand() * 3)];
    const x = rand() * 256;
    const y = rand() * 256;
    const rx = 14 + rand() * 30;
    const ry = 8 + rand() * 18;
    g.save();
    g.translate(x, y);
    g.rotate(rand() * Math.PI);
    g.beginPath();
    g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
});

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function repeat(t: THREE.Texture, u: number, v: number): THREE.Texture {
  const c = t.clone();
  c.repeat.set(u, v);
  c.needsUpdate = true;
  return c;
}
