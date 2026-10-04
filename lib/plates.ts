"use client";

import * as THREE from "three";
import { create } from "zustand";

// v1.7b: Uzbek licence plates drawn at runtime (same look as
// scripts/make-plates.py: white plate, black border, 2-digit region box on
// the left, flag + "UZ" block on the right) so the player can type a custom
// plate per car in the menu (components/PlateEditor.tsx) and see it live.
// Two real formats:
//   personal      "01 A 777 AA"  region · letter · 3 digits · 2 letters
//   legal entity  "01 777 AAA"   region · 3 digits · 3 letters

export type PlateKind = "personal" | "legal";
const PERSONAL = /^(\d{2})([A-Z])(\d{3})([A-Z]{2})$/;
const LEGAL = /^(\d{2})(\d{3})([A-Z]{3})$/;

/** normalise + validate user input; returns the canonical spaced plate or an error */
export function parsePlate(input: string): { ok: true; plate: string; kind: PlateKind; region: string; main: string } | { ok: false; error: string } {
  const raw = input.toUpperCase().replace(/[\s\-–_.]+/g, "");
  if (!raw) return { ok: false, error: "Type a plate, e.g. 01 A 777 AA" };
  if (/[^0-9A-Z]/.test(raw)) return { ok: false, error: "Only Latin capital letters A–Z and digits" };
  let m = raw.match(PERSONAL);
  let kind: PlateKind = "personal";
  if (!m) { m = raw.match(LEGAL); kind = "legal"; }
  if (!m) return { ok: false, error: "Format: 01 A 777 AA (personal) or 01 777 AAA (company)" };
  const region = m[1];
  const r = Number(region);
  if (r < 1 || r > 95) return { ok: false, error: "Region code must be 01–95" };
  const main = kind === "personal" ? `${m[2]} ${m[3]} ${m[4]}` : `${m[2]} ${m[3]}`;
  return { ok: true, plate: `${region} ${main}`, kind, region, main };
}

const KEY = "td_plates";
function loadPlates(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try { const o = JSON.parse(localStorage.getItem(KEY) || "{}"); return o && typeof o === "object" ? o : {}; } catch { return {}; }
}

interface PlateStore {
  custom: Record<string, string>;
  set: (carId: string, plate: string | null) => void;
}
export const usePlates = create<PlateStore>((set, get) => ({
  custom: loadPlates(),
  set: (carId, plate) => {
    const custom = { ...get().custom };
    if (plate) custom[carId] = plate; else delete custom[carId];
    try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* private mode */ }
    set({ custom });
    const e = entries.get(carId);
    if (e) drawPlate(e.canvas, plate ?? e.fallback, e.tex);
  },
}));

const W = 512, H = 108;
function flag(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  const band = h / 3;
  c.fillStyle = "#1eb3e6"; c.fillRect(x, y, w, band);
  c.fillStyle = "#ffffff"; c.fillRect(x, y + band, w, band);
  c.fillStyle = "#1eb53a"; c.fillRect(x, y + 2 * band, w, band);
  c.fillStyle = "#ce1126"; c.fillRect(x, y + band - 1, w, 2); c.fillRect(x, y + 2 * band - 1, w, 2);
  const cr = band * 0.36, cx = x + w * 0.2, cy = y + band / 2;
  c.fillStyle = "#ffffff"; c.beginPath(); c.arc(cx, cy, cr, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#1eb3e6"; c.beginPath(); c.arc(cx + cr * 0.45, cy, cr, 0, Math.PI * 2); c.fill();
  c.strokeStyle = "#000"; c.lineWidth = 1.5; c.strokeRect(x, y, w, h);
}
function fitText(c: CanvasRenderingContext2D, txt: string, cx: number, cy: number, maxW: number, px: number) {
  c.font = `700 ${px}px "Roboto Condensed", "Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif`;
  const w = c.measureText(txt).width;
  const sx = Math.min(1, maxW / Math.max(1, w));
  c.save(); c.translate(cx, cy); c.scale(sx, 1); c.fillText(txt, 0, 0); c.restore();
}
export function drawPlate(canvas: HTMLCanvasElement, plate: string, tex?: THREE.Texture) {
  const p = parsePlate(plate);
  const region = p.ok ? p.region : "01", main = p.ok ? p.main : plate;
  const c = canvas.getContext("2d")!;
  c.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
  c.strokeStyle = "#000"; c.lineWidth = 5;
  c.beginPath(); c.roundRect(2.5, 2.5, W - 5, H - 5, 10); c.stroke();
  c.lineWidth = 4; c.beginPath(); c.moveTo(82, 5); c.lineTo(82, H - 5); c.stroke();
  c.fillStyle = "#000"; c.textAlign = "center"; c.textBaseline = "middle";
  fitText(c, region, 43, H / 2 + 3, 68, 70);
  const fx0 = W - 62;
  flag(c, fx0 + 8, 18, 44, 30);
  c.fillStyle = "#000"; fitText(c, "UZ", fx0 + 28, 76, 50, 34);
  fitText(c, main, (88 + fx0 - 2) / 2, H / 2 + 4, fx0 - 2 - 88 - 10, 84);
  if (tex) tex.needsUpdate = true;
}

const entries = new Map<string, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial; fallback: string }>();
/** one shared live material per car id (front + rear plate) */
export function livePlateMaterial(carId: string, fallback: string): THREE.MeshBasicMaterial {
  let e = entries.get(carId);
  if (!e) {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 108;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // polygonOffset + a 1 cm stand-off from the bumper: no z-fighting at any distance
    const mat = new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.name = "td-plate";
    e = { canvas, tex, mat, fallback };
    entries.set(carId, e);
    drawPlate(canvas, usePlates.getState().custom[carId] ?? fallback, tex);
    // the condensed web font may arrive after the first draw
    document.fonts?.ready.then(() => drawPlate(canvas, usePlates.getState().custom[carId] ?? fallback, tex)).catch(() => {});
  }
  return e.mat;
}
