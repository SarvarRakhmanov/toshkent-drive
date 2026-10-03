import * as THREE from "three";
import { PAVED, ROADS, WORLD } from "./layout";

function hash(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function srgb(tex: THREE.CanvasTexture) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function makeGround(): THREE.CanvasTexture {
  const S = 2048;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const g = c.getContext("2d")!;
  const scale = S / WORLD;
  const X = (x: number) => (x / WORLD + 0.5) * S;
  const Y = (z: number) => (z / WORLD + 0.5) * S;

  g.fillStyle = "#5f6d45";
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 12) {
    for (let x = 0; x < S; x += 12) {
      const n = hash(x, y);
      g.fillStyle = n > 0.66 ? "#6d7c4e" : n > 0.33 ? "#586440" : "#748458";
      g.globalAlpha = 0.55;
      g.fillRect(x, y, 12, 12);
    }
  }
  g.globalAlpha = 1;

  const drawRect = (x: number, z: number, w: number, d: number) => {
    g.fillRect(X(x - w / 2), Y(z - d / 2), w * scale, d * scale);
  };

  g.fillStyle = "#c9bba4";
  for (const r of ROADS) drawRect(r.x, r.z, r.w + 16, r.d + 16);
  g.fillStyle = "#b7a890";
  for (const r of ROADS) {
    const horiz = r.w > r.d;
    if (horiz) {
      drawRect(r.x, r.z - r.d / 2 - 3.2, r.w, 1.1);
      drawRect(r.x, r.z + r.d / 2 + 3.2, r.w, 1.1);
    } else {
      drawRect(r.x - r.w / 2 - 3.2, r.z, 1.1, r.d);
      drawRect(r.x + r.w / 2 + 3.2, r.z, 1.1, r.d);
    }
  }

  g.fillStyle = "#3a6a46";
  g.beginPath();
  g.ellipse(X(0), Y(0), 58 * scale, 58 * scale, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#4c7a50";
  g.beginPath();
  g.ellipse(X(0), Y(0), 36 * scale, 36 * scale, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2f5a3c";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.ellipse(X(Math.cos(a) * 46), Y(Math.sin(a) * 46), 4.2 * scale, 4.2 * scale, 0, 0, Math.PI * 2);
    g.fill();
  }

  g.fillStyle = "#d8cbb6";
  g.fillRect(X(-3.4), Y(-58), 6.8 * scale, 116 * scale);
  g.fillRect(X(-58), Y(-3.4), 116 * scale, 6.8 * scale);

  g.fillStyle = "#e6dcc8";
  g.beginPath();
  g.ellipse(X(0), Y(0), 16 * scale, 16 * scale, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#a33d3a";
  g.beginPath();
  g.ellipse(X(0), Y(0), 10.4 * scale, 10.4 * scale, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#e7c85a";
  g.lineWidth = 1.5 * scale;
  g.beginPath();
  g.ellipse(X(0), Y(0), 9.2 * scale, 9.2 * scale, 0, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = "#f3eadc";
  g.beginPath();
  g.ellipse(X(0), Y(0), 5.6 * scale, 5.6 * scale, 0, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = "#cfc3ae";
  drawRect(-118, 0, 16, 92);

  g.fillStyle = "#07090c";
  for (const r of PAVED) drawRect(r.x, r.z, r.w, r.d);
  for (const r of ROADS) {
    const horiz = r.w > r.d;
    for (let i = 0; i < 18; i++) {
      const n = hash(r.x + i * 19, r.z + i * 7);
      g.globalAlpha = 0.35 + n * 0.4;
      g.fillStyle = n > 0.5 ? "#050608" : "#12151a";
      if (horiz) g.fillRect(X(r.x - r.w / 2 + (i * r.w) / 18), Y(r.z - 2 + n * 3), (6 + n * 14) * scale, (1.2 + n) * scale);
      else g.fillRect(X(r.x - 2 + n * 3), Y(r.z - r.d / 2 + (i * r.d) / 18), (1.2 + n) * scale, (6 + n * 14) * scale);
    }
  }
  g.globalAlpha = 1;

  g.strokeStyle = "#f2efe6";
  g.lineWidth = Math.max(1.5, 0.16 * scale);
  g.setLineDash([]);
  for (const r of ROADS) {
    const horiz = r.w > r.d;
    const edge = 0.55;
    if (horiz) {
      g.beginPath();
      g.moveTo(X(r.x - r.w / 2), Y(r.z - r.d / 2 + edge));
      g.lineTo(X(r.x + r.w / 2), Y(r.z - r.d / 2 + edge));
      g.stroke();
      g.beginPath();
      g.moveTo(X(r.x - r.w / 2), Y(r.z + r.d / 2 - edge));
      g.lineTo(X(r.x + r.w / 2), Y(r.z + r.d / 2 - edge));
      g.stroke();
      g.setLineDash([7, 9]);
      for (const off of [-3.5, 0, 3.5]) {
        g.beginPath();
        g.moveTo(X(r.x - r.w / 2), Y(r.z + off));
        g.lineTo(X(r.x + r.w / 2), Y(r.z + off));
        g.stroke();
      }
      g.setLineDash([]);
    } else {
      g.beginPath();
      g.moveTo(X(r.x - r.w / 2 + edge), Y(r.z - r.d / 2));
      g.lineTo(X(r.x - r.w / 2 + edge), Y(r.z + r.d / 2));
      g.stroke();
      g.beginPath();
      g.moveTo(X(r.x + r.w / 2 - edge), Y(r.z - r.d / 2));
      g.lineTo(X(r.x + r.w / 2 - edge), Y(r.z + r.d / 2));
      g.stroke();
      g.setLineDash([7, 9]);
      for (const off of [-3.5, 0, 3.5]) {
        g.beginPath();
        g.moveTo(X(r.x + off), Y(r.z - r.d / 2));
        g.lineTo(X(r.x + off), Y(r.z + r.d / 2));
        g.stroke();
      }
      g.setLineDash([]);
    }
  }

  g.fillStyle = "#d7d2c8";
  for (const r of ROADS) {
    const horiz = r.w > r.d;
    const steps = horiz ? Math.floor(r.w / 42) : Math.floor(r.d / 42);
    for (let i = 1; i < steps; i++) {
      const n = hash(i, r.z + r.x);
      if (n < 0.45) continue;
      if (horiz) {
        g.beginPath();
        g.arc(X(r.x - r.w / 2 + (i * r.w) / steps), Y(r.z + (n - 0.5) * 4), 0.55 * scale, 0, Math.PI * 2);
        g.fill();
      } else {
        g.beginPath();
        g.arc(X(r.x + (n - 0.5) * 4), Y(r.z - r.d / 2 + (i * r.d) / steps), 0.55 * scale, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  g.fillStyle = "#f4f0e6";
  const xs = [-168, -76, 76, 168];
  const zs = [-168, -76, 76, 168];
  for (const ix of xs) {
    for (const iz of zs) {
      for (const side of [-1, 1]) {
        for (let s = 0; s < 6; s++) {
          g.fillRect(X(ix + side * (8 + s * 1.15) - 0.35), Y(iz - 2.2), 0.7 * scale, 4.4 * scale);
          g.fillRect(X(ix - 2.2), Y(iz + side * (8 + s * 1.15) - 0.35), 4.4 * scale, 0.7 * scale);
        }
      }
      g.fillStyle = "#f7f4ec";
      g.beginPath();
      g.moveTo(X(ix), Y(iz - 14));
      g.lineTo(X(ix + 1.1), Y(iz - 10));
      g.lineTo(X(ix - 1.1), Y(iz - 10));
      g.fill();
      g.fillStyle = "#f4f0e6";
    }
  }

  g.strokeStyle = "#8fd0a8";
  g.lineWidth = 0.28 * scale;
  g.strokeRect(X(30 - 2.4), Y(126 - 5), 4.8 * scale, 10 * scale);
  g.strokeStyle = "#efe8d8";
  g.lineWidth = 0.12 * scale;
  for (let i = -1; i <= 1; i++) {
    g.beginPath();
    g.moveTo(X(14 + i * 3.2), Y(108));
    g.lineTo(X(14 + i * 3.2), Y(132));
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return srgb(tex);
}

type Facade = { map: THREE.CanvasTexture; glow: THREE.CanvasTexture };

const facadeCache = new Map<string, Facade>();

function canvasTex(c: HTMLCanvasElement) {
  return srgb(new THREE.CanvasTexture(c));
}

export function facade(style: string): Facade {
  const hit = facadeCache.get(style);
  if (hit) return hit;
  const albedo = document.createElement("canvas");
  const glow = document.createElement("canvas");
  albedo.width = glow.width = 256;
  albedo.height = glow.height = 256;
  const a = albedo.getContext("2d")!;
  const e = glow.getContext("2d")!;
  e.fillStyle = "#000";
  e.fillRect(0, 0, 256, 256);

  const wall =
    style === "soviet"
      ? "#c4b7a2"
      : style === "glass"
        ? "#8ea4b4"
        : style === "hotel"
          ? "#ddd4c6"
          : style === "white"
            ? "#efe8dc"
            : style === "shop"
              ? "#e7d7c0"
              : style === "stone"
                ? "#b7a48c"
                : "#e4d2b4";
  a.fillStyle = wall;
  a.fillRect(0, 0, 256, 256);
  if (style === "plaster" || style === "shop") {
    a.fillStyle = "#1e8f7b";
    a.fillRect(0, 18, 256, 10);
  }
  a.fillStyle = "rgba(0,0,0,0.05)";
  for (let y = 0; y < 256; y += 8) a.fillRect(0, y, 256, 1);

  const win = (x: number, y: number, w: number, h: number, lit: boolean) => {
    a.fillStyle = "#2a3138";
    a.fillRect(x - 1, y - 1, w + 2, h + 2);
    a.fillStyle = lit ? "#f0d7a4" : "#9bb4c6";
    a.fillRect(x, y, w, h);
    a.fillStyle = "rgba(255,255,255,0.18)";
    a.fillRect(x, y, w * 0.35, h);
    if (lit) {
      e.fillStyle = "#fff";
      e.fillRect(x, y, w, h);
    }
  };

  if (style === "glass") {
    for (let y = 16; y < 240; y += 22) {
      for (let x = 10; x < 246; x += 18) win(x, y, 12, 16, hash(x, y) > 0.55);
    }
  } else if (style === "soviet") {
    for (let y = 28; y < 230; y += 28) {
      win(12, y, 232, 12, hash(1, y) > 0.45);
    }
  } else if (style === "hotel") {
    a.fillStyle = "#cfc3ae";
    a.fillRect(0, 0, 256, 256);
    a.fillStyle = "#8d7d68";
    for (let y = 8; y < 248; y += 16) {
      for (let x = 4; x < 252; x += 16) {
        a.beginPath();
        a.arc(x + 6, y + 6, 5.2, 0, Math.PI * 2);
        a.fill();
      }
    }
    a.fillStyle = "#2c241c";
    for (let y = 10; y < 246; y += 16) {
      for (let x = 6; x < 250; x += 16) {
        a.fillRect(x, y, 4, 8);
      }
    }
  } else if (style === "shop") {
    a.fillStyle = "#1e8f7b";
    a.fillRect(8, 150, 240, 18);
    a.fillStyle = "#14222c";
    a.fillRect(16, 176, 224, 64);
    a.fillStyle = "rgba(255,255,255,0.25)";
    a.fillRect(16, 176, 70, 64);
    for (let y = 20; y < 140; y += 28) {
      for (let x = 18; x < 230; x += 36) win(x, y, 22, 18, hash(x, y) > 0.5);
    }
  } else {
    const cols = style === "white" ? 4 : 5;
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lit = hash(c * 3, r * 5 + style.length) > 0.42;
        win(16 + c * (220 / cols), 28 + r * 30, 18, 20, lit);
      }
    }
    a.fillStyle = "#6d5a46";
    a.fillRect(108, 220, 40, 36);
  }

  a.fillStyle = "rgba(90,70,50,0.18)";
  a.fillRect(0, 230, 256, 26);

  const pack = { map: canvasTex(albedo), glow: canvasTex(glow) };
  facadeCache.set(style, pack);
  return pack;
}

export function signTexture(text: string, kind: string) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = kind === "speed" || kind === "stop" ? 256 : 160;
  const g = c.getContext("2d")!;
  if (kind === "stop") {
    g.fillStyle = "#b42318";
    g.beginPath();
    const cx = 128;
    const cy = 128;
    const r = 108;
    for (let i = 0; i < 8; i++) {
      const a = (Math.PI / 8) + (i * Math.PI) / 4;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    g.fillStyle = "#fff";
    g.font = "700 54px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("STOP", 128, 128);
  } else if (kind === "speed") {
    g.fillStyle = "#f4f4f4";
    g.beginPath();
    g.arc(128, 128, 108, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#c0392b";
    g.lineWidth = 14;
    g.stroke();
    g.fillStyle = "#111";
    g.font = "700 84px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 128, 134);
  } else if (kind === "warn") {
    g.fillStyle = "#111";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = "#f5c518";
    g.fillRect(6, 6, 244, 148);
    g.fillStyle = "#111";
    g.font = "700 28px sans-serif";
    g.textAlign = "center";
    const lines = text.split("\n");
    lines.forEach((ln, i) => g.fillText(ln, 128, 70 + (i - (lines.length - 1) / 2) * 34));
  } else if (kind === "park") {
    g.fillStyle = "#0e6b4f";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = "#f4ecdc";
    g.font = "700 36px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("P", 128, 52);
    g.font = "600 28px sans-serif";
    g.fillText(text, 128, 108);
  } else {
    g.fillStyle = "#0e3d73";
    g.fillRect(0, 0, 256, 160);
    g.fillStyle = "#f4ecdc";
    g.fillRect(6, 6, 244, 148);
    g.fillStyle = "#102033";
    g.font = "700 32px sans-serif";
    g.textAlign = "center";
    const lines = text.split("\n");
    lines.forEach((ln, i) => g.fillText(ln, 128, 70 + (i - (lines.length - 1) / 2) * 36));
  }
  return srgb(new THREE.CanvasTexture(c));
}

export function plateTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 520;
  c.height = 112;
  const g = c.getContext("2d")!;
  g.fillStyle = "#f3f3f1";
  g.fillRect(0, 0, 520, 112);
  g.fillStyle = "#163e86";
  g.fillRect(436, 0, 84, 112);
  g.fillStyle = "#0099b5";
  g.fillRect(448, 10, 60, 11);
  g.fillStyle = "#fff";
  g.fillRect(448, 21, 60, 11);
  g.fillStyle = "#1eb53a";
  g.fillRect(448, 32, 60, 11);
  g.fillStyle = "#ce1126";
  g.fillRect(448, 19, 60, 3);
  g.fillRect(448, 30, 60, 3);
  g.fillStyle = "#fff";
  g.font = "700 22px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("UZ", 478, 72);
  g.fillStyle = "#111";
  g.textAlign = "left";
  g.textBaseline = "middle";
  let size = 54;
  g.font = `700 ${size}px sans-serif`;
  while (size > 28 && g.measureText(text).width > 400) {
    size -= 2;
    g.font = `700 ${size}px sans-serif`;
  }
  g.fillText(text, 18, 58);
  g.strokeStyle = "#1a1a1a";
  g.lineWidth = 8;
  g.strokeRect(4, 4, 512, 104);
  const tex = srgb(new THREE.CanvasTexture(c));
  tex.anisotropy = 16;
  return tex;
}

export function flagTexture() {
  const c = document.createElement("canvas");
  c.width = 300;
  c.height = 150;
  const g = c.getContext("2d")!;
  g.fillStyle = "#0099b5";
  g.fillRect(0, 0, 300, 50);
  g.fillStyle = "#fff";
  g.fillRect(0, 50, 300, 50);
  g.fillStyle = "#1eb53a";
  g.fillRect(0, 100, 300, 50);
  g.fillStyle = "#ce1126";
  g.fillRect(0, 47, 300, 6);
  g.fillRect(0, 97, 300, 6);
  g.fillStyle = "#fff";
  g.beginPath();
  g.arc(70, 75, 18, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#0099b5";
  g.beginPath();
  g.arc(78, 75, 16, 0, Math.PI * 2);
  g.fill();
  return srgb(new THREE.CanvasTexture(c));
}

export function dashTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const g = c.getContext("2d")!;
  const tex = srgb(new THREE.CanvasTexture(c));
  const paint = (kmh: number, gear: string) => {
    g.fillStyle = "#121614";
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = "#1e8f7b";
    g.lineWidth = 4;
    g.strokeRect(6, 6, 244, 116);
    g.fillStyle = "#f4ecdc";
    g.font = "700 54px sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    g.fillText(String(Math.round(kmh)), 168, 62);
    g.font = "600 18px sans-serif";
    g.fillText("km/h", 240, 70);
    g.textAlign = "left";
    g.fillStyle = "#d4b06a";
    g.font = "700 28px sans-serif";
    g.fillText(gear, 18, 64);
    tex.needsUpdate = true;
  };
  paint(0, "P");
  return { tex, paint };
}
