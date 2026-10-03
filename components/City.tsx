"use client";

import { asset } from "@/lib/asset";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@/lib/safeFrame";
import { RigidBody, CylinderCollider } from "@react-three/rapier";
import { Instances, Instance } from "@react-three/drei";
import * as THREE from "three";
import { skyState } from "@/lib/skyState";
import { worldState } from "@/lib/worldState";
import { loadSave } from "@/lib/saveGame";
import { LANDMARKS } from "@/lib/landmarks";
import { CLUB_IN } from "@/lib/club";
import { HIGHWAY_CHUNKS } from "@/lib/highway";
import { isReady } from "@/lib/loadState";

// Real chunk-streamed city (Milestone 5), replacing the placeholder 7-box
// arena from Phase 1. Same constants and the same seeded-PRNG-per-chunk
// approach as the original's buildChunk()/ensureChunks() — CELL/ROAD_W/mulberry32
// are the identical numbers/algorithm, just re-typed in TS. Chunks are plain
// React state (a list of "ci,cj" keys); mounting/unmounting a <Chunk> is how
// Rapier RigidBodies get created/freed — no manual scene.add/remove bookkeeping
// needed the way the original's raw three.js version required.
//
// Milestone 11 (visual parity — real facades/roads/parks): ported the
// original's *technique*, not its exact code — baked canvas textures built
// ONCE at module scope and shared across every instance (materials for
// buildings, one tile texture for the ground), same trick the original uses
// for its facadeMats/glassTowerMats and its single repeating street tile.
// Cut vs. the original, deliberately (see SUMMARY.md Milestone 11): no
// per-building UV rescaling (original stretches its stone-facade texture to
// fit each building's exact size; here every building of a given material
// shares one fixed texture repeat — cheap, occasionally a little
// stretched/squashed on very large facades), no macro-district zoning
// (downtown/industrial/residential glass-chance bias), no building tiers/
// AC units/antennas, no bark/leaf textures on trees (flat-shaded cone/sphere-
// equivalent — cylinder trunk + sphere crown — instead), no fountains/
// benches/sports fields inside park chunks, no tree collision (visual
// dressing only, not obstacles).
const CELL = 100;
const ROAD_W = 20;
const VIEW = 2; // chunk radius kept alive around the player
const SHORE_CI = 6; // chunks at/after this ci are open water (Water.tsx covers it) — matches SHORE_X=600

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- shared canvas-texture builders (called a fixed handful of times
// at module load, never per-instance — see the original's own canvasTex()) ----------
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// baked window-grid + "lit at night" glow map, shared by every stone/concrete
// facade material (tinted per-material via `color`, same texture underneath —
// the original's per-wall-color facadeTexPair() bakes the tint INTO the
// texture instead; sharing one neutral texture and tinting via material color
// is cheaper and looks the same after the multiply).
function buildFacadeTextures() {
  const size = 256,
    rows = 10,
    cols = 7;
  const lit = Array.from({ length: rows * cols }, () => Math.random() < 0.5);
  const cw = size / cols,
    rh = size / rows;
  const grid = canvasTex(size, (g) => {
    g.fillStyle = "#d6d6d6";
    g.fillRect(0, 0, size, size);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.12,
          y = r * rh + rh * 0.15,
          w = cw * 0.76,
          h = rh * 0.6;
        g.fillStyle = "#2a2e36";
        g.fillRect(x - 2, y - 2, w + 4, h + 4);
        g.fillStyle = "#7f92a6";
        g.fillRect(x, y, w, h);
      }
    }
  });
  const glow = canvasTex(size, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!lit[r * cols + c]) continue;
        const x = c * cw + cw * 0.12,
          y = r * rh + rh * 0.15,
          w = cw * 0.76,
          h = rh * 0.6;
        g.fillStyle = "#ffdb8a";
        g.fillRect(x, y, w, h);
      }
    }
  });
  for (const t of [grid, glow]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 4);
  }
  return [grid, glow] as const;
}

// glass curtain-wall: mullion grid + a random scatter of lit panes, same
// fixed repeat(3,6) the original uses for its glassTowerMats (the original
// doesn't rescale UVs per-building for glass either — this one matches it
// exactly, not just approximates it).
function buildGlassTextures() {
  const size = 256,
    pane = 16;
  const grid = canvasTex(size, (g) => {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, "#6f9cc4");
    grad.addColorStop(1, "#243c50");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.strokeStyle = "rgba(10,16,24,.85)";
    g.lineWidth = 2;
    for (let i = 0; i <= size; i += pane) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, size);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(size, i);
      g.stroke();
    }
  });
  const glow = canvasTex(size, (g) => {
    g.fillStyle = "#000";
    g.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += pane) {
      for (let x = 0; x < size; x += pane) {
        if (Math.random() < 0.35) {
          g.fillStyle = "#ffd27a";
          g.fillRect(x + 2, y + 2, pane - 4, pane - 4);
        }
      }
    }
  });
  for (const t of [grid, glow]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(3, 6);
  }
  return [grid, glow] as const;
}

// one shared ground tile per chunk (asphalt road ring + concrete/grass
// interior + curb + dashed lane lines + corner crosswalks), baked once and
// reused by every chunk's ground plane — the same "one repeating street
// texture" trick the original's tileTex uses for its entire infinite ground,
// just one tile = one chunk instead of one tile repeated 16x16 under a giant
// plane (equivalent result, simpler to slot into per-chunk streaming).
function buildTileTexture(interiorFill: string, isGrass = false) {
  const size = 1536; // 4x the original 384 — NearestFilter below needs enough texels that blockiness stays sub-pixel at normal driving distance, not just "not blurry"
  // rounded to whole pixels — canvas antialiases shapes drawn at fractional
  // coordinates, which is what made road edges/curbs/lane lines/crosswalk
  // corners look soft ("dirty"); every line/rect in this texture routes
  // through px(), so this one snap sharpens all of it.
  const px = (u: number) => Math.round((u / 100) * size);
  const tex = canvasTex(size, (g) => {
    g.fillStyle = interiorFill;
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * size, Math.random() * size, 3, 3);
    }
    if (isGrass) {
      // blade-of-grass fleck variation — light/dark green speckle instead of
      // concrete dust, same density as the dust loop above
      for (let i = 0; i < 260; i++) {
        const light = Math.random() < 0.5;
        g.fillStyle = light ? "rgba(210,255,190,.08)" : "rgba(10,30,5,.12)";
        g.fillRect(Math.random() * size, Math.random() * size, 2, 5);
      }
      // a real walking path (light stone ring inside the green) — the old
      // code ran the SAME near-black, low-opacity concrete-joint lines below
      // on every tile including this one, but rgba(18,20,24,.3) over dark
      // green is invisible: no path/sidewalk ever actually read inside a
      // park, it just looked like a flat green blob. This is the sidewalk
      // grass chunks were missing. Radius 30 sits inside `half`=34 (Chunk's
      // buildable interior) and clear of the park's own tree ring (see
      // Chunk's isPark trees below, now kept inside r=24 for this reason).
      g.strokeStyle = "#b8b8a8";
      g.lineWidth = px(4);
      g.beginPath();
      g.arc(px(50), px(50), px(30), 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "rgba(120,120,105,.5)";
      g.lineWidth = px(0.35);
      g.beginPath();
      g.arc(px(50), px(50), px(30), 0, Math.PI * 2);
      g.stroke();
    } else {
      // sidewalk slab joints (expansion lines across the concrete interior —
      // ported from the original's tileTex, index.html ~3706-3709)
      g.strokeStyle = "rgba(18,20,24,.3)";
      g.lineWidth = 0.7;
      for (let u = 15; u <= 85; u += 5) {
        g.beginPath();
        g.moveTo(px(u), 0);
        g.lineTo(px(u), size);
        g.stroke();
        g.beginPath();
        g.moveTo(0, px(u));
        g.lineTo(size, px(u));
        g.stroke();
      }
    }
    const roadW = px(10);
    // asphalt road strips — patched blotches, aggregate speckle, wheel-path
    // polish, oil drip stains, hairline cracks (ported from the original's
    // road() helper, index.html ~3712-3731)
    const road = (x: number, y: number, w: number, h: number, horiz: boolean) => {
      g.fillStyle = "#23252a";
      g.fillRect(x, y, w, h);
      for (let i = 0; i < Math.max(6, ((w * h) / 1600) | 0); i++) {
        const bx = x + Math.random() * w,
          by = y + Math.random() * h,
          r = 3.75 + Math.random() * 11.25,
          dk = Math.random() < 0.6;
        const rad = g.createRadialGradient(bx, by, 1, bx, by, r);
        rad.addColorStop(0, `rgba(${dk ? 12 : 64},${dk ? 13 : 66},${dk ? 16 : 70},.22)`);
        rad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = rad;
        g.fillRect(x, y, w, h);
      }
      const n = ((w * h) / 22) | 0;
      for (let i = 0; i < n; i++) {
        const v = (26 + Math.random() * 74) | 0;
        g.fillStyle = `rgba(${v},${v},${v + 3},${0.3 + Math.random() * 0.45})`;
        g.fillRect(x + Math.random() * w, y + Math.random() * h, 1.5, 1.5);
      }
      g.fillStyle = "rgba(6,7,10,.26)";
      if (horiz) {
        g.fillRect(x, y + h * 0.26, w, h * 0.16);
        g.fillRect(x, y + h * 0.56, w, h * 0.16);
      } else {
        g.fillRect(x + w * 0.26, y, w * 0.16, h);
        g.fillRect(x + w * 0.56, y, w * 0.16, h);
      }
      for (let i = 0; i < 4; i++) {
        const ox = x + Math.random() * w,
          oy = y + Math.random() * h,
          r = 1.9 + Math.random() * 4.5;
        const rad = g.createRadialGradient(ox, oy, 1, ox, oy, r);
        rad.addColorStop(0, "rgba(0,0,0,.32)");
        rad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = rad;
        g.fillRect(ox - r, oy - r, r * 2, r * 2);
      }
      g.strokeStyle = "rgba(8,8,10,.5)";
      g.lineWidth = 0.5;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        let cx = x + Math.random() * w,
          cy = y + Math.random() * h;
        g.moveTo(cx, cy);
        for (let s = 0; s < 5; s++) {
          cx += (Math.random() - 0.5) * 15;
          cy += (Math.random() - 0.5) * 15;
          g.lineTo(cx, cy);
        }
        g.stroke();
      }
    };
    road(0, 0, roadW, size, false);
    road(size - roadW, 0, roadW, size, false);
    road(0, 0, size, roadW, true);
    road(0, size - roadW, size, roadW, true);
    // curb — a texture stripe, not raised geometry (the original's curb()
    // helper is the same: baked into the tile, no separate 3D mesh)
    g.fillStyle = "rgba(200,204,210,.5)";
    g.fillRect(roadW - 2, 0, 2, size);
    g.fillRect(size - roadW, 0, 2, size);
    g.fillRect(0, roadW - 2, size, 2);
    g.fillRect(0, size - roadW, size, 2);
    // dashed yellow centerline at the chunk edges (where this tile meets its
    // neighbour's — both draw the same pattern so it lines up seamlessly)
    g.strokeStyle = "rgba(206,172,64,.85)";
    g.lineWidth = px(0.5);
    g.setLineDash([px(4), px(4)]);
    for (const e of [0, size]) {
      g.beginPath();
      g.moveTo(e, 0);
      g.lineTo(e, size);
      g.stroke();
      g.beginPath();
      g.moveTo(0, e);
      g.lineTo(size, e);
      g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = "rgba(224,226,230,.6)";
    g.lineWidth = px(0.35);
    for (const o of [8.5, 91.5]) {
      g.beginPath();
      g.moveTo(px(o), 0);
      g.lineTo(px(o), size);
      g.stroke();
      g.beginPath();
      g.moveTo(0, px(o));
      g.lineTo(size, px(o));
      g.stroke();
    }
    // crosswalk zebra bars at the four corners
    g.fillStyle = "rgba(226,228,232,.6)";
    for (const ex of [0, 100]) {
      for (const ez of [0, 100]) {
        for (let u = -6; u <= 6; u += 2.4) {
          const sx = ex + u,
            sz = ez + (ez === 0 ? 11 : -13.4);
          if (sx >= 0 && sx <= 100) g.fillRect(px(sx - 0.7), px(sz), px(1.4), px(2.4));
          const hx = ex + (ex === 0 ? 11 : -13.4),
            hz = ez + u;
          if (hz >= 0 && hz <= 100) g.fillRect(px(hx), px(hz - 0.7), px(2.4), px(1.4));
        }
      }
    }
    // manhole covers (ported from the original's manhole() helper,
    // index.html ~3777-3781) — 2 per tile, not the original's 4: this tile
    // is one chunk, not a 16x16-tiled giant plane, so 4 would crowd it
    const manhole = (u: number, v: number, r: number) => {
      g.fillStyle = "#1a1c21";
      g.beginPath();
      g.arc(px(u), px(v), px(r), 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#43464d";
      g.lineWidth = 0.9;
      g.beginPath();
      g.arc(px(u), px(v), px(r), 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "rgba(92,96,102,.5)";
      g.lineWidth = 0.45;
      g.beginPath();
      g.arc(px(u), px(v), px(r * 0.68), 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = "rgba(70,74,80,.4)";
      g.lineWidth = 0.5;
      for (let a = 0; a < 8; a++) {
        const an = (a * Math.PI) / 4;
        g.beginPath();
        g.moveTo(px(u) + Math.cos(an) * px(r * 0.3), px(v) + Math.sin(an) * px(r * 0.3));
        g.lineTo(px(u) + Math.cos(an) * px(r * 0.62), px(v) + Math.sin(an) * px(r * 0.62));
        g.stroke();
      }
    };
    manhole(4.5, 38, 0.72);
    manhole(63, 95.5, 0.72);
  });
  // the real source of the blur: THREE.CanvasTexture defaults to LinearFilter,
  // which bilinear-blends every line/edge whenever a texel is magnified — and
  // the player is almost always close enough for that to happen. Nearest keeps
  // every edge a hard pixel boundary; minFilter stays mipmapped so distant
  // tiles still anti-alias instead of shimmering.
  tex.magFilter = THREE.NearestFilter;
  // ground planes are viewed at a shallow, near-edge-on angle from the chase
  // cam — anisotropic filtering is what keeps that in-focus instead of
  // smearing into mush at distance, on top of the per-texel sharpness above
  tex.anisotropy = 16;
  // minFilter was previously left at THREE's default (LinearMipmapLinearFilter
  // — trilinear, blends the two nearest mip levels together every frame),
  // deliberately chosen so distant tiles anti-alias instead of shimmering —
  // but at road-line scale (thin dashed/solid stripes a few pixels wide in
  // the source texture) that blend is what reads as "blurry" at distance,
  // per Abdullah's #45. LinearMipmapNearestFilter is the middle ground: still
  // mipmapped (so distant tiles still anti-alias, no shimmer regression) but
  // samples from a single nearest mip level instead of blending two, which
  // keeps thin lines legible noticeably farther out. If this still shimmers
  // in practice, the anisotropy=16 above is the next lever before reaching
  // for NearestFilter outright (which would drop mip anti-aliasing entirely).
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  return tex;
}

const [FACADE_GRID_TEX, FACADE_GLOW_TEX] = buildFacadeTextures();
const [GLASS_GRID_TEX, GLASS_GLOW_TEX] = buildGlassTextures();
const CITY_TILE_TEX = buildTileTexture("#82868d"); // concrete sidewalk
const PARK_TILE_TEX = buildTileTexture("#3f6b2f", true); // park grass

// grey/tan stone-facade tints + the original's literal glassTowerMats blue
// hex values, each paired with the ONE shared grid/glow texture above.
const FACADE_TINTS = ["#b8b2a4", "#8c9098", "#9a5f48", "#7c8ea0", "#c2b79c", "#5a5e68", "#a89a86", "#6e7a86"];
const GLASS_TINTS = ["#8fb0c8", "#9aa8c4", "#7fa8be", "#a2bcd0"];
const ROOF_MAT = new THREE.MeshStandardMaterial({ color: "#15161c", roughness: 0.9 });
const FACADE_MATS = FACADE_TINTS.map(
  (color) =>
    new THREE.MeshStandardMaterial({
      map: FACADE_GRID_TEX,
      color,
      roughness: 0.82,
      metalness: 0.05,
      emissive: new THREE.Color("#ffffff"),
      emissiveMap: FACADE_GLOW_TEX,
      emissiveIntensity: 0,
    }),
);
const GLASS_MATS = GLASS_TINTS.map(
  (color) =>
    new THREE.MeshStandardMaterial({
      map: GLASS_GRID_TEX,
      color,
      roughness: 0.08,
      metalness: 1,
      envMapIntensity: 0.7,
      emissive: new THREE.Color("#ffffff"),
      emissiveMap: GLASS_GLOW_TEX,
      emissiveIntensity: 0,
    }),
);

// shared tree geometry/materials — real photographed bark + leaf textures
// (CC0, polyhaven.com/a/jacaranda_tree) on cheap geometry: a textured
// cylinder trunk and alpha-cut leaf-card billboards for the crown, instead
// of a flat-colored sphere. The full photoscanned tree mesh is 200MB+ of
// geometry — fine for a one-off render, not for something instanced across
// a whole city and loaded on a phone — so this borrows just the textures.
const treeTexLoader = new THREE.TextureLoader();
function treeTex(file: string, srgb = false) {
  const t = treeTexLoader.load(asset(`/textures/tree/${file}`));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const LEAF_DIFF = treeTex("leaves_diff.jpg", true);
const LEAF_ALPHA = treeTex("leaves_alpha.png");
const LEAF_NOR = treeTex("leaves_nor.jpg");
const TRUNK_DIFF = treeTex("trunk_diff.jpg", true);
const TRUNK_NOR = treeTex("trunk_nor.jpg");
const TRUNK_ARM = treeTex("trunk_arm.jpg"); // packed AO(r)/roughness(g)/metalness(b)

const TRUNK_GEO = new THREE.CylinderGeometry(0.15, 0.21, 1, 10);
// aoMap reads the second UV channel — this geometry only has one, so the ao
// pass would silently no-op without a uv2 to read
TRUNK_GEO.setAttribute("uv2", TRUNK_GEO.attributes.uv);
// unit leaf card — lobes below place 3 of these per clump, fanned around Y,
// as a cheap "billboard cross" impostor instead of one flat card
const LEAF_GEO = new THREE.PlaneGeometry(2, 2);
// re-anchored to its base (default cylinder geometry is centred, which left
// half of each branch's length going nowhere instead of reaching the canopy —
// this makes position={x,y,z} the branch's ROOT, so scale.y=length always
// reaches exactly `length` units from that point regardless of rotation)
const BRANCH_GEO = new THREE.CylinderGeometry(0.03, 0.055, 1, 5).translate(0, 0.5, 0);
const TRUNK_MAT = new THREE.MeshStandardMaterial({
  map: TRUNK_DIFF,
  normalMap: TRUNK_NOR,
  aoMap: TRUNK_ARM,
  roughnessMap: TRUNK_ARM,
  roughness: 1,
});
const BRANCH_MAT = new THREE.MeshStandardMaterial({ color: "#4a3620", roughness: 1 });
// subtle near-white tints (real photo detail already carries the color, unlike
// the old flat spheres which needed saturated color to read as foliage at
// all) so neighbouring lobes still read as separate clumps, not one texture
// tiled flat. alphaTest (not `transparent`) treats cards as opaque with a
// hard cutout — correct instanced-foliage choice, avoids the sorting
// glitches full alpha blending gets with many overlapping cards.
const CROWN_MATS = [0xffffff, 0xeee7bd, 0xcfe0c4].map(
  (tint) =>
    new THREE.MeshStandardMaterial({
      map: LEAF_DIFF,
      alphaMap: LEAF_ALPHA,
      normalMap: LEAF_NOR,
      color: tint,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.85,
    })
);

// deterministic 0..1 jitter from world position — trees have no per-instance
// RNG plumbed through (only x/z/h/r/matIdx), so foliage-clump placement hashes
// off the tree's own coordinates instead: stable across re-renders, no new
// state, no new prop.
function hash2(a: number, b: number) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// ---------- building variety: zoned archetypes instead of one uniform box ----------
// A flat city of identical scaled boxes reads as generic — real streets mix a
// downtown core of towers/offices with residential blocks of small houses and
// a commercial scatter of shopfronts. DISTRICT groups chunks into 3x3-chunk
// (300x300 unit) neighbourhoods sharing one zone, so it reads as actual
// districts you drive between, not per-chunk noise.
type Zone = "downtown" | "office" | "residential" | "commercial";
const DISTRICT_CELLS = 5; // 5x5 chunks (500x500 units) per district — big enough to read as a real neighbourhood/office park you drive through, not a single block
function zoneFor(ci: number, cj: number): Zone {
  const di = Math.floor(ci / DISTRICT_CELLS);
  const dj = Math.floor(cj / DISTRICT_CELLS);
  if (Math.hypot(di, dj) < 1.1) return "downtown"; // ring of districts around spawn
  const r = mulberry32(((di * 92821) ^ (dj * 68917) ^ 0x9e3779b9) >>> 0)();
  if (r < 0.28) return "office";
  if (r < 0.72) return "residential";
  return "commercial";
}

type BuildingKind = "tower" | "office" | "shop" | "house" | "hut" | "apartment" | "highrise" | "townhouse";
interface BuildingSpec {
  kind: BuildingKind;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  matIdx: number; // indexes GLASS_MATS (tower) or FACADE_MATS (office/apartment); ignored by shop/house/hut
  colorIdx: number; // indexes RESIDENTIAL_MATS (house/hut) or SIGN_MATS (shop)
  // house/hut only: shared per-block anchor (the block's cx/cz, same for
  // every house in that block's grid) that door/window/feature choices hash
  // off instead of each house's own x/z — so a row of houses reads as one
  // repeated template (a real colony phase), not each door/window/chimney
  // independently randomised. Defaults to x/z for non-house kinds (unused).
  groupX: number;
  groupZ: number;
}

// unit-sized shared geometries reused across every building the same way
// TRUNK_GEO/LEAF_GEO are shared across every tree — scaled per-instance,
// never rebuilt per-instance
const UNIT_BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const HIP_ROOF_GEO = new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4); // 4-sided pyramid, edges aligned to a box's faces
const ANTENNA_GEO = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);

// wide paint palette — includes a deliberate black and a deliberate red so
// "some houses red, some black" isn't left to chance thinning-out of a small set
const RESIDENTIAL_MATS = [
  "#c9a06a",
  "#d9c9a3",
  "#8a9a7a",
  "#a3798a",
  "#7a8a9a",
  "#c9b38a",
  "#b33a3a", // red
  "#e8e4da", // white
  "#2a2a2e", // black
  "#3a5a6a", // navy
].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
const ROOF_HOUSE_MATS = ["#7a3b2e", "#5a4a3a", "#4a3a2a", "#3a3f45"].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
);
const SIGN_TINTS = ["#ff3fd6", "#2fe9ff", "#ffb23f", "#3fff8f"];
const SIGN_MATS = SIGN_TINTS.map((color) => new THREE.MeshBasicMaterial({ color }));
const AC_UNIT_MAT = new THREE.MeshStandardMaterial({ color: "#4a4e58", roughness: 0.6, metalness: 0.3 });
const ANTENNA_MAT = new THREE.MeshStandardMaterial({ color: "#2a2d34", roughness: 0.5, metalness: 0.6 });
// dark glossy glass double-door + a thin canopy overhang — every tower/
// office/apartment gets a real ground-floor entrance instead of a facade
// that just runs straight to the ground with no way in
const ENTRANCE_MAT = new THREE.MeshStandardMaterial({ color: "#0d1218", roughness: 0.15, metalness: 0.5 });
function Entrance({ x, z, d, w }: { x: number; z: number; d: number; w: number }) {
  const doorW = Math.min(3, w * 0.28);
  const doorH = 2.6;
  const frontZ = z + d / 2;
  return (
    <group>
      <mesh position={[x, doorH / 2, frontZ + 0.04]} material={ENTRANCE_MAT}>
        <boxGeometry args={[doorW, doorH, 0.08]} />
      </mesh>
      <mesh position={[x, doorH + 0.15, frontZ + 0.5]} material={ROOF_MAT} castShadow>
        <boxGeometry args={[doorW * 1.4, 0.15, 1]} />
      </mesh>
    </group>
  );
}
const DOOR_MATS = ["#4a3323", "#6b2f2a", "#2a2e38", "#8a6a3a"].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
// lit like every other window in the city — emissiveIntensity driven by
// skyState.nightK in the same useFrame loop as FACADE_MATS/GLASS_MATS below
const WINDOW_MATS = ["#dce8f0", "#e8dcc0", "#c8dce8"].map(
  (color) =>
    new THREE.MeshStandardMaterial({
      color: "#2a2e38",
      roughness: 0.3,
      metalness: 0.2,
      emissive: new THREE.Color(color),
      emissiveIntensity: 0,
    }),
);
// muted concrete/cream tones — mid-rise apartment blocks, not house paint
const APARTMENT_MATS = ["#b8b2a4", "#9a9488", "#c2b7a2", "#8c8a86"].map(
  (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
);
const BALCONY_MAT = new THREE.MeshStandardMaterial({ color: "#6a6a62", roughness: 0.75 });

// Per-zone archetype weights + size ranges — this is what actually makes a
// district read as downtown/office/residential/commercial rather than the
// zone only tinting one shared box shape.
const ZONE_MIX: Record<Zone, { kind: BuildingKind; w: [number, number] }[]> = {
  downtown: [
    { kind: "tower", w: [0, 0.5] },
    { kind: "office", w: [0.5, 0.75] },
    { kind: "highrise", w: [0.75, 1] }, // mixed-use residential high-rise in the skyline
  ],
  office: [
    { kind: "office", w: [0, 0.6] },
    { kind: "tower", w: [0.6, 0.9] },
    { kind: "highrise", w: [0.9, 1] },
  ],
  residential: [
    { kind: "house", w: [0, 0.7] },
    { kind: "hut", w: [0.7, 1] },
  ],
  commercial: [
    { kind: "shop", w: [0, 0.8] },
    { kind: "house", w: [0.8, 1] },
  ],
};
function pickKind(zone: Zone, r: number): BuildingKind {
  const mix = ZONE_MIX[zone];
  const found = mix.find((m) => r >= m.w[0] && r < m.w[1]);
  return (found ?? mix[0]).kind;
}

// One tree's canopy = 5 offset foliage lobes (not 1 sphere) so the silhouette
// has real gaps and clumps instead of reading as a flat green ball, plus 2
// bare branch stubs bridging trunk to canopy for visible structure — the
// "add detail without a fancy leaf texture" version of what the file header
// originally cut for cost. Still just 8 shared-geometry mesh instances/tree.
const LOBES = [
  { dx: 0, dy: 0.15, dz: 0, s: 0.62 },
  { dx: 0.42, dy: -0.05, dz: 0.1, s: 0.46 },
  { dx: -0.38, dy: 0.02, dz: -0.22, s: 0.44 },
  { dx: 0.05, dy: -0.12, dz: 0.4, s: 0.4 },
  { dx: -0.15, dy: -0.08, dz: -0.4, s: 0.42 },
] as const;

// which chunk each landmark sits in, so buildChunk (well, Chunk) forces it clear —
// same idea as the original's landmarkChunks map
const LANDMARK_CHUNKS = new Set(LANDMARKS.map((l) => `${Math.round(l.x / CELL)},${Math.round(l.z / CELL)}`));
// CLUB_IN sits far south, outside any real landmark chunk — exempt it too so
// no random building/park spawns inside/around the club interior room
const CLUB_IN_CHUNK = `${Math.round(CLUB_IN.x / CELL)},${Math.round(CLUB_IN.z / CELL)}`;
// INTERNATIONAL AIRPORT is a 480x480m walled airfield (real-scale runway,
// terminal, hangars, cargo yard — see components/Airport.tsx's FENCE_X/FENCE_Z
// = 240 around world (-750,100)), far too big for one chunk. Clears the whole
// 5x5 chunk block around its centre chunk ((-8,1), see lib/landmarks.ts) —
// exactly the chunks the perimeter fence touches — so the airfield reads as
// its own isolated compound rather than random buildings poking through the
// fence line and skyscrapers standing in the middle of the runway.
const AIRPORT_CENTER_CHUNK = { ci: Math.round(-750 / CELL), cj: Math.round(100 / CELL) };
// exported so components/Pedestrians.tsx can steer its spawn/rehome picks off
// this same footprint — the airport is sealed to vehicles at its one gate
// (components/Airport.tsx's PerimeterFence) but foot traffic isn't blocked by
// that collider, so without this a rehoming civilian can walk onto the field
// same as the player can
export const AIRPORT_CHUNKS = new Set<string>();
const AIRPORT_CHUNK_RADIUS = 2; // 240m fence half-extent / 100m CELL, rounded up
for (let di = -AIRPORT_CHUNK_RADIUS; di <= AIRPORT_CHUNK_RADIUS; di++) {
  for (let dj = -AIRPORT_CHUNK_RADIUS; dj <= AIRPORT_CHUNK_RADIUS; dj++) {
    AIRPORT_CHUNKS.add(`${AIRPORT_CENTER_CHUNK.ci + di},${AIRPORT_CENTER_CHUNK.cj + dj}`);
  }
}

// New chunks needed this many at a time per frame, once a boundary crossing
// queues them — see the ADD_PER_FRAME note in City() below.
const ADD_PER_FRAME = 1; // one chunk (≈250 meshes + colliders) per frame keeps boundary crossings hitch-free on phones

export function City() {
  const [chunks, setChunks] = useState<string[]>(() => initialChunks());
  const last = useRef({ ci: 999, cj: 999 });
  const pendingAdd = useRef<string[]>([]);
  const pendingRemove = useRef<string[]>([]);

  useFrame(() => {
    const ci = Math.round(worldState.px / CELL);
    const cj = Math.round(worldState.pz / CELL);
    if (ci !== last.current.ci || cj !== last.current.cj) {
      last.current = { ci, cj };
      const next = new Set<string>();
      for (let di = -VIEW; di <= VIEW; di++) {
        for (let dj = -VIEW; dj <= VIEW; dj++) {
          next.add(`${ci + di},${cj + dj}`);
        }
      }
      // queue BOTH newly-needed chunks and now-stale ones instead of mounting/
      // unmounting the whole ~5-chunk changed ring in one commit — crossing a
      // boundary at speed used to mount (and, on a diagonal crossing, drop up
      // to 9 chunks') worth of RigidBodies/colliders/InstancedMesh GPU buffers
      // in a single frame, a real stutter (car/camera visibly pausing then
      // snapping) that gets worse the faster you're going, since each hitch
      // covers more distance. Removal used to be assumed "cheap enough" to do
      // all at once — it isn't once colliders and per-chunk InstancedMesh
      // buffers (components/City.tsx's Trees) need disposing — so it's
      // throttled the same ADD_PER_FRAME-at-a-time way additions already are.
      // Spreading both over a few frames doesn't change what's ever on screen
      // (same final chunk set, same draw distance, just briefly a superset of
      // it while the queues drain) — just how it arrives.
      // peek at the latest committed-or-pending chunk list via the functional
      // form (guaranteed fresh even if another setChunks landed this same
      // tick — see the dedupe note below) without actually changing it yet;
      // the throttled batches below are what mutate `chunks` from here on
      setChunks((cur) => {
        pendingRemove.current = cur.filter((k) => !next.has(k));
        pendingAdd.current = Array.from(next).filter((k) => !cur.includes(k));
        return cur;
      });
    }
    if (pendingRemove.current.length > 0) {
      const dropBatch = pendingRemove.current.splice(0, ADD_PER_FRAME);
      setChunks((cur) => cur.filter((k) => !dropBatch.includes(k)));
    }
    if (pendingAdd.current.length > 0) {
      const batch = pendingAdd.current.splice(0, ADD_PER_FRAME);
      // dedupe defensively at merge time: useFrame runs outside React's
      // batched-event context, so this and the removal setChunks call above
      // aren't guaranteed to see each other's result before render.
      setChunks((cur) => Array.from(new Set([...cur, ...batch])));
    }
  });

  // night-window glow, updated on the shared materials ONCE per frame — same
  // spot the original does it (`for(const m of facadeMats) m.emissiveIntensity=...`),
  // cost is O(materials), not O(buildings on screen)
  useFrame(() => {
    const k = skyState.nightK;
    for (const m of FACADE_MATS) m.emissiveIntensity = k * 1.1;
    for (const m of GLASS_MATS) m.emissiveIntensity = k * 0.9;
    for (const m of WINDOW_MATS) m.emissiveIntensity = k * 1.4;
  });

  return (
    <>
      {chunks.map((key) => {
        const [ci, cj] = key.split(",").map(Number);
        if (ci >= SHORE_CI) return null; // open water — Water.tsx already covers this area
        return (
          <ChunkCull key={key} ci={ci} cj={cj}>
            <Chunk ci={ci} cj={cj} />
          </ChunkCull>
        );
      })}
    </>
  );
}

// Hides a whole chunk (its ~200-300 meshes) once it's entirely beyond the
// camera's far plane (= fog end, see SceneTools' FogFarSync) — saves the
// renderer walking and frustum-testing every mesh in the far ring.
function ChunkCull({ ci, cj, children }: { ci: number; cj: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const tick = useRef((ci * 7 + cj * 3) & 7); // stagger the checks across frames
  useFrame((state) => {
    const g = ref.current;
    if (!g || (tick.current++ & 7) !== 0) return;
    if (!isReady()) { g.visible = true; return; }
    const half = CELL / 2;
    const dx = Math.max(0, Math.abs(state.camera.position.x - ci * CELL) - half);
    const dz = Math.max(0, Math.abs(state.camera.position.z - cj * CELL) - half);
    const far = (state.camera as THREE.PerspectiveCamera).far;
    g.visible = dx * dx + dz * dz < (far + 15) * (far + 15);
  });
  return <group ref={ref}>{children}</group>;
}

// The ring that exists on the very first React commit, BEFORE the streamer in
// City()'s useFrame has run even once.
//
// This used to be hardcoded around the world origin, which was a real bug: every
// vehicle restores to its own SAVED position, so a save anywhere outside chunks
// (-2..2, -2..2) spawned the car over a hole. It would start falling on frame 1
// and only survive if the streamer (ADD_PER_FRAME chunks per frame) got the
// ground under it before it dropped past the 1-unit-thick ground box — a race a
// backgrounded or slow tab loses, after which the ground is above the car and
// it falls forever. Centring the ring on the spawn point means the ground is
// there before the first physics step, so there is no race to lose.
function initialChunks() {
  const save = loadSave();
  const spawn = save && save.active !== "foot" ? save.vehicles?.[save.active] : null;
  const ci0 = spawn ? Math.round(spawn.x / CELL) : 0;
  const cj0 = spawn ? Math.round(spawn.z / CELL) : 0;
  const out: string[] = [];
  for (let di = -VIEW; di <= VIEW; di++) {
    for (let dj = -VIEW; dj <= VIEW; dj++) out.push(`${ci0 + di},${cj0 + dj}`);
  }
  return out;
}

// footprint/height ranges per archetype — this, plus the per-zone kind mix
// above, is what actually reads as "district" rather than the zone only
// re-tinting one shared box
const KIND_RANGES: Record<BuildingKind, { w: [number, number]; d: [number, number]; h: [number, number] }> = {
  tower: { w: [7, 12], d: [7, 12], h: [26, 48] },
  office: { w: [10, 16], d: [10, 16], h: [9, 22] },
  shop: { w: [8, 14], d: [5, 9], h: [3.5, 5.5] },
  house: { w: [6, 9], d: [6, 9], h: [3, 4.5] },
  hut: { w: [4, 6], d: [4, 6], h: [2, 3] },
  apartment: { w: [14, 20], d: [10, 14], h: [9, 15] }, // h = floors(3-5) * 3-unit storey, see ApartmentBuilding
  highrise: { w: [12, 18], d: [12, 18], h: [30, 55] }, // h = floors(10-18) * 3-unit storey, see ApartmentBuilding
  townhouse: { w: [15, 21], d: [7, 10], h: [4.5, 6.5] }, // whole 3-unit row footprint, see TownhouseBuilding
};

type TreeDesc = { x: number; z: number; h: number; r: number; matIdx: number };

const LAMP_POLE_MAT = new THREE.MeshStandardMaterial({ color: "#26282c", metalness: 0.6, roughness: 0.4 });
const LAMP_HEAD_MAT = new THREE.MeshStandardMaterial({ color: "#1c1a10", emissive: "#ffb060", emissiveIntensity: 2.2, roughness: 0.5 });
const LAMP_HEIGHT = 5.2;
// Was 1.1 — sized for reaching just barely into an intersection from a
// corner. Lamps now stand on the sidewalk just outside the road edge and
// the arm has to actually clear the paved surface (ROAD_W=20, so the road
// spans +/-10 off its centerline) to hang over it, not just poke at it.
const LAMP_ARM = 9;

// ponytail: always-on, no day/night dimmer — Club.tsx's own VENU sign
// lights are likewise always on regardless of time of day, same simplification.
// Upgrade path if it ever matters: scale LAMP_HEAD_MAT.emissiveIntensity and
// the PointLight's intensity off SkyCycle.tsx's own night factor.
// rotY aims the arm+head+light sub-group (the pole itself never needs to
// rotate — it's a vertical cylinder, rotationally symmetric). 0 = arm
// extends in local +X; callers rotate it to aim the head out over whichever
// road edge the pole is planted beside.
function StreetLamp({ x, z, rotY = 0 }: { x: number; z: number; rotY?: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh material={LAMP_POLE_MAT} castShadow>
        <cylinderGeometry args={[0.06, 0.08, LAMP_HEIGHT, 8]} />
      </mesh>
      <group position={[0, LAMP_HEIGHT / 2, 0]} rotation={[0, rotY, 0]}>
        <mesh position={[LAMP_ARM / 2, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={LAMP_POLE_MAT}>
          <cylinderGeometry args={[0.045, 0.045, LAMP_ARM, 6]} />
        </mesh>
        <mesh position={[LAMP_ARM, -0.12, 0]} material={LAMP_HEAD_MAT}>
          <sphereGeometry args={[0.22, 10, 8]} />
        </mesh>
        <pointLight position={[LAMP_ARM, -0.12, 0]} color="#ffb060" intensity={1.6} distance={14} decay={2} />
      </group>
    </group>
  );
}

function Chunk({ ci, cj }: { ci: number; cj: number }) {
  const cx = ci * CELL;
  const cz = cj * CELL;
  // keep the spawn block and any landmark's block clear of random buildings/
  // parks, like the original's showroom/club/landmarkChunks exemptions
  const isExempt =
    (ci === 0 && cj === 0) ||
    LANDMARK_CHUNKS.has(`${ci},${cj}`) ||
    `${ci},${cj}` === CLUB_IN_CHUNK ||
    AIRPORT_CHUNKS.has(`${ci},${cj}`) ||
    HIGHWAY_CHUNKS.has(`${ci},${cj}`);

  const content = useMemo(() => {
    if (isExempt)
      return {
        buildings: [] as BuildingSpec[],
        trees: [] as TreeDesc[],
        isPark: false,
        lamp: null as { x: number; z: number; rotY: number } | null,
      };
    const rand = mulberry32(((ci * 73856093) ^ (cj * 19349663) ^ 0x5bd1e995) >>> 0);
    const isPark = rand() < 0.13; // matches the original's isPark chance exactly
    const margin = ROAD_W / 2 + 6;
    const half = CELL / 2 - margin; // 34 — half-width of the buildable block interior, road stays clear outside this
    const zone = zoneFor(ci, cj);

    const buildings: BuildingSpec[] = [];
    const spawnOne = (kind: BuildingKind, x: number, z: number) => {
      const range = KIND_RANGES[kind];
      const w = range.w[0] + rand() * (range.w[1] - range.w[0]);
      const d = range.d[0] + rand() * (range.d[1] - range.d[0]);
      const h = range.h[0] + rand() * (range.h[1] - range.h[0]);
      const matIdx = kind === "tower" ? Math.floor(rand() * GLASS_MATS.length) : Math.floor(rand() * FACADE_MATS.length);
      const colorIdx = kind === "shop" ? Math.floor(rand() * SIGN_MATS.length) : Math.floor(rand() * RESIDENTIAL_MATS.length);
      buildings.push({ kind, x, z, w, d, h, matIdx, colorIdx, groupX: x, groupZ: z });
    };

    if (!isPark) {
      if (zone === "residential") {
        const roll = rand();
        if (roll < 0.35) {
          // apartment-block sub-zone: 1-2 mid-rise buildings
          const count = rand() < 0.5 ? 1 : 2;
          for (let i = 0; i < count; i++) {
            const reach = half - KIND_RANGES.apartment.w[1] / 2;
            spawnOne("apartment", cx + (i === 0 ? -1 : 1) * reach * 0.45 * (count - 1), cz + (rand() * 2 - 1) * reach * 0.5);
          }
        } else if (roll < 0.55) {
          // townhouse sub-zone: one attached 3-unit row, roughly centred
          const reach = half - KIND_RANGES.townhouse.d[1] / 2;
          spawnOne("townhouse", cx, cz + (rand() * 2 - 1) * reach * 0.4);
        } else {
          // uniform house-row sub-zone: ONE template (kind/size/colour) picked
          // ONCE and repeated across the block's 2x2 grid — a real colony
          // phase (one design built 4x), not 4 independently random houses.
          // groupX/groupZ=the block centre so door/window/chimney/porch
          // choices (hashed in HouseBuilding) match across the whole row too.
          const kind = rand() < 0.75 ? "house" : "hut";
          const range = KIND_RANGES[kind];
          const w = range.w[0] + rand() * (range.w[1] - range.w[0]);
          const d = range.d[0] + rand() * (range.d[1] - range.d[0]);
          const h = range.h[0] + rand() * (range.h[1] - range.h[0]);
          const colorIdx = Math.floor(rand() * RESIDENTIAL_MATS.length);
          const cellHalf = half / 2;
          for (const gx of [-1, 1]) {
            for (const gz of [-1, 1]) {
              if (rand() < 0.12) continue; // occasional empty lot, not a solid wall of houses
              const jitter = cellHalf * 0.2; // small — rows should look aligned, not scattered
              const bx = cx + gx * cellHalf + (rand() * 2 - 1) * jitter;
              const bz = cz + gz * cellHalf + (rand() * 2 - 1) * jitter;
              buildings.push({ kind, x: bx, z: bz, w, d, h, matIdx: 0, colorIdx, groupX: cx, groupZ: cz });
            }
          }
        }
      } else if (zone === "commercial") {
        // a storefront row along one edge of the block, shopfronts facing the street
        const rowZ = cz + half * 0.55;
        for (let i = 0; i < 3; i++) {
          if (rand() < 0.15) continue;
          spawnOne("shop", cx + (i - 1) * half * 0.66, rowZ);
        }
      } else {
        // downtown/office: kept sparse — towers/offices need the room a packed
        // grid of small buildings doesn't, a real downtown block has 1-3 of them
        const count = rand() < 0.15 ? 1 : rand() < 0.6 ? 2 : 3;
        for (let i = 0; i < count; i++) {
          const kind = pickKind(zone, rand());
          const reach = half - Math.max(KIND_RANGES[kind].w[1], KIND_RANGES[kind].d[1]) / 2;
          spawnOne(kind, cx + (rand() * 2 - 1) * reach, cz + (rand() * 2 - 1) * reach);
        }
      }
    }

    const trees: TreeDesc[] = [];
    // 3 streetside trees, one of the 4 chunk edges each — same layout as the
    // original's per-chunk street trees
    for (let i = 0; i < 3; i++) {
      const side = Math.floor(rand() * 4);
      const u = (rand() * 2 - 1) * half;
      // was a hardcoded 38.5 — only 1.5 units clear of the road's inner edge
      // (cx+40, given ROAD_W=20 at the cx+50 chunk boundary), while buildings
      // stay within `half`=34. A tree that close to the road is a real snag a
      // fast/drifting car can clip; reusing the same `half` buildings already
      // respect gives it the same real clearance instead of a separate,
      // tighter number nobody checked against the road width.
      const hs = half;
      const x = cx + (side === 0 ? u : side === 1 ? hs : side === 2 ? u : -hs);
      const z = cz + (side === 0 ? -hs : side === 1 ? u : side === 2 ? hs : -u);
      trees.push({ x, z, h: 2.2 + rand() * 1.4, r: 1.3 + rand() * 0.9, matIdx: Math.floor(rand() * 3) });
    }
    if (isPark) {
      // a ring of extra trees around the park interior, like the original's
      // isPark tree loop — no fountain/benches/sports field (cut, see file
      // header). Radius capped at 24 (was 34, reaching past the park's own
      // walking-path ring at r=30 — see buildTileTexture's isGrass branch)
      // so a tree never spawns standing in the middle of the path.
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2;
        const rr = 8 + rand() * 16;
        trees.push({
          x: cx + Math.cos(a) * rr,
          z: cz + Math.sin(a) * rr,
          h: 2.4 + rand() * 1.6,
          r: 1.4 + rand(),
          matIdx: Math.floor(rand() * 3),
        });
      }
    }

    // one streetlamp per chunk, planted on the sidewalk beside the chunk's
    // west road edge (not at the NW corner intersection like before — that
    // put the pole standing in the middle of a 4-way crossing). The road
    // corridor along this edge is centred on x = cx-CELL/2 and is ROAD_W
    // wide, i.e. it spans cx-60..cx-40; buildings/trees stay clear back to
    // `half`=34, leaving a ~6-unit sidewalk band from cx-40 to cx-34. The
    // pole sits in that band (cx-37) and the arm (rotY=PI, aiming -X) swings
    // out over the road itself so the head hangs above the asphalt, not the
    // sidewalk. z is offset to the chunk's own midpoint along that edge
    // (cz, not cz-CELL/2) specifically so it's never at a shared corner —
    // each chunk computes this off its own cx/cz, so unlike the old corner
    // placement there's nothing here two neighbouring chunks could ever both
    // land on, no separate ownership check needed.
    // Streets otherwise had zero lighting infrastructure at all — pitch
    // black away from headlights/window glow once night fell (see
    // components/SkyCycle.tsx's day/night cycle) — the actual gap behind
    // "current streets need a visual pass."
    const lamp = { x: cx - 37, z: cz, rotY: Math.PI };

    return { buildings, trees, isPark, lamp };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ci, cj]);

  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh receiveShadow position={[cx, -0.5, cz]}>
          <boxGeometry args={[CELL, 1, CELL]} />
          <meshStandardMaterial map={content.isPark ? PARK_TILE_TEX : CITY_TILE_TEX} roughness={0.9} />
        </mesh>
      </RigidBody>
      {content.buildings.map((b, i) => (
        <Building key={i} spec={b} />
      ))}
      <Trees specs={content.trees} />
      {content.lamp && <StreetLamp x={content.lamp.x} z={content.lamp.z} rotY={content.lamp.rotY} />}
    </group>
  );
}

// Dispatches to one of 5 genuinely different archetypes instead of one box
// scaled per-instance — a real street mixes towers, mid-rise offices,
// single-storey shopfronts, and small pitched-roof houses/huts, not one
// silhouette in different sizes. The main body still gets one cuboid
// collider sized to its footprint (roofs/signage/AC units are dressing, same
// "visual-only detail on a solid base" split as the tree crown/branches).
function Building({ spec }: { spec: BuildingSpec }) {
  switch (spec.kind) {
    case "tower":
      return <TowerBuilding spec={spec} />;
    case "office":
      return <OfficeBuilding spec={spec} />;
    case "shop":
      return <ShopBuilding spec={spec} />;
    case "house":
    case "hut":
      return <HouseBuilding spec={spec} />;
    case "apartment":
    case "highrise":
      return <ApartmentBuilding spec={spec} />;
    case "townhouse":
      return <TownhouseBuilding spec={spec} />;
  }
}

// Mid-rise apartment block (or a residential high-rise, same shape taller) —
// repeated identical floors, an even grid of windows + balconies on the front
// and back faces. This is the "colony" look: one uniform template stamped
// tall, not a house scaled up.
// Windows/balconies were one <mesh> each — a floors×cols×2-faces loop, up to
// (18-1)*8*2=272 of each on a tall highrise, per building. Same visual
// density, now 2 draw calls (one InstancedMesh per geometry+material) instead
// of hundreds — the actual "running heavy" cost as the city grew archetypes
// (Milestone 16-17 already flagged this as the next perf-pass target).
function ApartmentBuilding({ spec: { kind, x, z, w, d, h, matIdx } }: { spec: BuildingSpec }) {
  const bodyMat = APARTMENT_MATS[matIdx % APARTMENT_MATS.length];
  const windowMat = WINDOW_MATS[Math.floor(hash2(x, z) * WINDOW_MATS.length)];
  const [minF, maxF] = kind === "highrise" ? [10, 18] : [3, 5];
  const floors = Math.max(minF, Math.min(maxF, Math.round(h / 3)));
  const storey = h / floors;
  const cols = Math.max(3, Math.round(w / 2.4));
  const winW = Math.min(0.7, (w / cols) * 0.45);
  const winH = storey * 0.42;
  const count = (floors - 1) * cols * 2; // both faces

  const windows: [number, number, number][] = [];
  const balconies: [number, number, number][] = [];
  for (const [faceZ, faceSign] of [
    [z + d / 2 + 0.03, 1],
    [z - d / 2 - 0.03, -1],
  ] as const) {
    for (let fi = 0; fi < floors - 1; fi++) {
      const floor = fi + 1; // skip ground floor — entrance/lobby, no windows
      const y = floor * storey + storey * 0.5;
      for (let ci2 = 0; ci2 < cols; ci2++) {
        const cx2 = x + ((ci2 + 0.5) / cols) * w - w / 2;
        windows.push([cx2, y, faceZ]);
        balconies.push([cx2, y - winH * 0.5 - 0.08, faceZ + faceSign * 0.22]);
      }
    }
  }

  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[x, h / 2, z]} material={bodyMat}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </RigidBody>
      <mesh position={[x, h + 0.15, z]} geometry={UNIT_BOX_GEO} material={ROOF_MAT} scale={[w * 1.02, 0.3, d * 1.02]} />
      <Instances geometry={UNIT_BOX_GEO} material={windowMat} limit={count}>
        {windows.map((p, i) => (
          <Instance key={i} position={p} scale={[winW, winH, 0.05]} />
        ))}
      </Instances>
      <Instances geometry={UNIT_BOX_GEO} material={BALCONY_MAT} limit={count} castShadow>
        {balconies.map((p, i) => (
          <Instance key={i} position={p} scale={[winW * 1.5, 0.08, 0.5]} />
        ))}
      </Instances>
      <Entrance x={x} z={z} d={d} w={w} />
      <SideGraffiti x={x} z={z} w={w} d={d} h={h} />
    </group>
  );
}

function TowerBuilding({ spec: { x, z, w, d, h, matIdx } }: { spec: BuildingSpec }) {
  const mat = GLASS_MATS[matIdx];
  const antennaH = h * 0.18;
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[x, h / 2, z]} material={mat}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </RigidBody>
      {/* parapet cap — a slightly wider dark lip reads as a real roofline, not a box that just stops */}
      <mesh position={[x, h + 0.2, z]} geometry={UNIT_BOX_GEO} material={ROOF_MAT} scale={[w * 1.04, 0.4, d * 1.04]} />
      <mesh position={[x, h + antennaH / 2, z]} geometry={ANTENNA_GEO} material={ANTENNA_MAT} scale={[1, antennaH, 1]} />
      <Entrance x={x} z={z} d={d} w={w} />
    </group>
  );
}

function OfficeBuilding({ spec: { x, z, w, d, h, matIdx } }: { spec: BuildingSpec }) {
  const mat = FACADE_MATS[matIdx];
  const acCount = 1 + Math.floor(hash2(x, z) * 2);
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[x, h / 2, z]} material={mat}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </RigidBody>
      <mesh position={[x, h + 0.15, z]} geometry={UNIT_BOX_GEO} material={ROOF_MAT} scale={[w * 1.03, 0.3, d * 1.03]} />
      <Entrance x={x} z={z} d={d} w={w} />
      {Array.from({ length: acCount }, (_, i) => {
        const j = hash2(x * 3 + i, z * 5 + i);
        const ux = (j - 0.5) * w * 0.5;
        const uz = (hash2(x * 7 + i, z * 11 + i) - 0.5) * d * 0.5;
        return (
          <mesh
            key={i}
            position={[x + ux, h + 0.55, z + uz]}
            geometry={UNIT_BOX_GEO}
            material={AC_UNIT_MAT}
            scale={[0.9, 0.7, 0.9]}
          />
        );
      })}
    </group>
  );
}

// Attached 3-unit row (duplex/triplex/townhouse territory) — one shared
// footprint/collider/roofline, but each unit gets its OWN wall colour, door,
// and windows, hashed off that unit's own centre. This is the "every
// building different" ask solved WITHIN one structure, the way a real
// terraced row is one building with several distinct front doors.
function TownhouseBuilding({ spec: { x, z, w, d, h } }: { spec: BuildingSpec }) {
  const units = 3;
  const uw = w / units;
  const doorW = Math.min(0.8, uw * 0.3);
  const doorH = Math.min(1.7, h * 0.35);
  const winW = Math.min(0.6, uw * 0.28);
  const winH = Math.min(0.6, h * 0.22);
  const frontZ = z + d / 2 + 0.03;
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[x, h / 2, z]} material={APARTMENT_MATS[0]}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </RigidBody>
      <mesh position={[x, h + 0.15, z]} geometry={UNIT_BOX_GEO} material={ROOF_MAT} scale={[w * 1.02, 0.3, d * 1.02]} />
      {Array.from({ length: units }, (_, i) => {
        const ux = x - w / 2 + uw * (i + 0.5);
        const bodyMat = RESIDENTIAL_MATS[Math.floor(hash2(ux, z + i * 3.3) * RESIDENTIAL_MATS.length)];
        const doorMat = DOOR_MATS[Math.floor(hash2(ux * 1.3, z * 1.7 + i) * DOOR_MATS.length)];
        const windowMat = WINDOW_MATS[Math.floor(hash2(ux * 2.1, z * 0.9 + i) * WINDOW_MATS.length)];
        return (
          <group key={i}>
            {/* per-unit facade panel — this is what makes each door/colour distinct */}
            <mesh position={[ux, h * 0.55, frontZ - 0.02]} material={bodyMat}>
              <boxGeometry args={[uw * 0.94, h * 0.9, 0.05]} />
            </mesh>
            <mesh position={[ux, doorH / 2, frontZ]} material={doorMat}>
              <boxGeometry args={[doorW, doorH, 0.06]} />
            </mesh>
            {[-1, 1].map((side) => (
              <mesh key={side} position={[ux + side * uw * 0.22, h * 0.68, frontZ]} material={windowMat}>
                <boxGeometry args={[winW, winH, 0.05]} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

// A curated slice of real storefront categories (grocery/pharmacy/bank/gym/
// etc.) rendered as an actual readable sign, not a flat colour block — every
// shop reads as a specific different business at a glance.
// kept short (max 8 letters) on purpose — long names forced either a tiny
// font or a wrapped second line hanging below the board, which is what
// actually looked "weird"; short names always fit on one line at a readable size
// Each shop is one of 3 STRUCTURAL categories, not just a recoloured box —
// the "mirror buildings" look was FACADE_MATS (a dense window-grid texture
// baked for 10+ unit tall towers) tiling into a busy checkerboard on an
// 8-unit shop wall; shops now use the same plain flat-colour materials as
// houses. A garage-type business also gets an actual open bay you can drive
// into (no collider over the front third of the footprint), not a shopfront.
type ShopCategory = "retail" | "cafe" | "garage";
const SHOP_TYPES: { name: string; category: ShopCategory }[] = [
  { name: "MARKET", category: "retail" },
  { name: "PHARMACY", category: "retail" },
  { name: "BAKERY", category: "cafe" },
  { name: "CAFE", category: "cafe" },
  { name: "HARDWARE", category: "retail" },
  { name: "BOOKS", category: "retail" },
  { name: "SALON", category: "retail" },
  { name: "LAUNDRY", category: "retail" },
  { name: "BANK", category: "retail" },
  { name: "DINER", category: "cafe" },
  { name: "ELECTRO", category: "retail" },
  { name: "FLORIST", category: "retail" },
  { name: "GYM", category: "retail" },
  { name: "PIZZA", category: "cafe" },
  { name: "AUTOSHOP", category: "garage" },
  { name: "CARWASH", category: "garage" },
  { name: "PET SHOP", category: "retail" },
  { name: "LIQUOR", category: "retail" },
  { name: "CLINIC", category: "retail" },
  { name: "BARBER", category: "retail" },
];
const GARAGE_MAT = new THREE.MeshStandardMaterial({ color: "#8a8578", roughness: 0.85 });
const GARAGE_INTERIOR_MAT = new THREE.MeshStandardMaterial({ color: "#26241f", roughness: 0.9 });
const TIRE_MAT = new THREE.MeshStandardMaterial({ color: "#141414", roughness: 0.95 });

// Per-name exterior dressing so specific shops (bank/pet shop/garage) read as
// that business at a glance, not just a differently-worded poster on the
// same box — a curated few, not every one of the 20 SHOP_TYPES, since most
// (market/salon/diner/...) already read fine off the poster+category alone.
const MARBLE_MAT = new THREE.MeshStandardMaterial({ color: "#e8e2d0", roughness: 0.25, metalness: 0.1 });
const GOLD_MAT = new THREE.MeshStandardMaterial({ color: "#c9a227", roughness: 0.3, metalness: 0.8 });
function BankDecor({ x, z, w, d, h }: { x: number; z: number; w: number; d: number; h: number }) {
  const frontZ = z + d / 2;
  const colX = w * 0.32;
  return (
    <group>
      {/* wide marble plinth you step up onto, reads as "important building" from the street */}
      <mesh position={[x, 0.15, frontZ + 0.5]} material={MARBLE_MAT} receiveShadow>
        <boxGeometry args={[w * 0.95, 0.3, 1.4]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[x + side * colX, h * 0.42, frontZ + 0.15]} material={MARBLE_MAT} castShadow>
          <cylinderGeometry args={[0.32, 0.36, h * 0.82, 10]} />
        </mesh>
      ))}
      {/* gold trim bar above the entrance */}
      <mesh position={[x, h * 0.85, frontZ + 0.04]} material={GOLD_MAT}>
        <boxGeometry args={[w * 0.9, 0.12, 0.08]} />
      </mesh>
    </group>
  );
}

const DOG_FUR_MATS = ["#c9a06a", "#3a2a1a", "#e8e4da"].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
function Dog({ x, z, rotY, matIdx }: { x: number; z: number; rotY: number; matIdx: number }) {
  const fur = DOG_FUR_MATS[matIdx % DOG_FUR_MATS.length];
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 0.26, 0]} material={fur} castShadow>
        <boxGeometry args={[0.26, 0.24, 0.55]} />
      </mesh>
      <mesh position={[0, 0.36, 0.32]} material={fur} castShadow>
        <boxGeometry args={[0.2, 0.2, 0.2]} />
      </mesh>
      <mesh position={[0, 0.3, 0.42]} material={fur} castShadow>
        <boxGeometry args={[0.1, 0.09, 0.1]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 0.08, 0.46, 0.36]} material={fur}>
          <boxGeometry args={[0.06, 0.08, 0.03]} />
        </mesh>
      ))}
      {[
        [-0.09, -0.2],
        [0.09, -0.2],
        [-0.09, 0.18],
        [0.09, 0.18],
      ].map(([lx, lz], i) => (
        <mesh key={i} position={[lx, 0.09, lz]} material={fur}>
          <boxGeometry args={[0.08, 0.18, 0.08]} />
        </mesh>
      ))}
      <mesh position={[0, 0.3, -0.32]} rotation={[0.6, 0, 0]} material={fur}>
        <boxGeometry args={[0.06, 0.22, 0.06]} />
      </mesh>
    </group>
  );
}
// thin wireframe box reads as chain-link/wire cage bars at driving distance,
// far cheaper than a real lattice of individual bar meshes
const CAGE_WIRE_MAT = new THREE.MeshBasicMaterial({ color: "#3a3d42", wireframe: true });
const CAGE_FLOOR_MAT = new THREE.MeshStandardMaterial({ color: "#5a5248", roughness: 0.95 });
function Cage({ x, z, size }: { x: number; z: number; size: number }) {
  return (
    <group position={[x, size / 2, z]}>
      <mesh material={CAGE_WIRE_MAT}>
        <boxGeometry args={[size, size, size]} />
      </mesh>
      <mesh position={[0, -size / 2 + 0.02, 0]} material={CAGE_FLOOR_MAT}>
        <boxGeometry args={[size * 0.96, 0.04, size * 0.96]} />
      </mesh>
    </group>
  );
}
function PetShopDecor({ x, z, w, d }: { x: number; z: number; w: number; d: number }) {
  const frontZ = z + d / 2;
  return (
    <group>
      <Dog x={x - w * 0.28} z={frontZ + 0.7} rotY={0.4} matIdx={0} />
      <Dog x={x - w * 0.1} z={frontZ + 0.9} rotY={-0.3} matIdx={1} />
      <Cage x={x + w * 0.22} z={frontZ + 0.5} size={0.55} />
      <Cage x={x + w * 0.22 + 0.65} z={frontZ + 0.5} size={0.55} />
    </group>
  );
}

function TireStack({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      {[0.16, 0.44, 0.72].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={TIRE_MAT} castShadow>
          <torusGeometry args={[0.28, 0.13, 8, 16]} />
        </mesh>
      ))}
    </group>
  );
}

// Baked poster texture per shop (name + a simple category icon + a worn
// border), not a flat colour box with 3D text floating in front of it — a
// real shop sign is one printed/painted graphic, not two separate objects.
// Cached by name so two shops that rolled the same business only bake it
// once; canvas work only ever runs client-side (module is "use client").
// A handful of baked spray-paint decals (transparent background, only the
// strokes painted) — real city grit, not every wall being the same clean
// paint job. Generated once at module load, reused everywhere via SideGraffiti.
function makeGraffitiTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const colors = ["#ff3fd6", "#2fe9ff", "#ffb23f", "#3fff8f", "#ff5a3c", "#b06bff"];
  const strokes = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < strokes; i++) {
    g.strokeStyle = colors[Math.floor(Math.random() * colors.length)];
    g.lineWidth = 6 + Math.random() * 14;
    g.lineCap = "round";
    g.beginPath();
    let x = Math.random() * size,
      y = Math.random() * size;
    g.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      x = Math.max(0, Math.min(size, x + (Math.random() - 0.5) * 140));
      y = Math.max(0, Math.min(size, y + (Math.random() - 0.5) * 140));
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // a scrawled tag-like signature along the bottom
  g.strokeStyle = colors[Math.floor(Math.random() * colors.length)];
  g.lineWidth = 4;
  g.beginPath();
  let tx = size * 0.15,
    ty = size * 0.75;
  g.moveTo(tx, ty);
  for (let i = 0; i < 6; i++) {
    tx += size * 0.12;
    ty += (Math.random() - 0.5) * 40;
    g.lineTo(tx, ty);
  }
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const GRAFFITI_TEXTURES = Array.from({ length: 4 }, () => makeGraffitiTexture());

// A random-looking (but position-hashed, so stable across re-renders) tag on
// a building's SIDE wall — houses/apartments/shops only draw detail on their
// front face, so the side is always clean/available for this. ~1 in 4 or 5
// buildings gets one, not every single one.
function SideGraffiti({ x, z, w, d, h, seed = 0 }: { x: number; z: number; w: number; d: number; h: number; seed?: number }) {
  if (hash2(x * 13.7 + seed, z * 9.3) > 0.22) return null;
  const tex = GRAFFITI_TEXTURES[Math.floor(hash2(x * 3.3 + seed, z * 5.1) * GRAFFITI_TEXTURES.length)];
  const side = hash2(x * 4.4 + seed, z * 7.7) < 0.5 ? -1 : 1;
  const size = Math.min(d, h) * 0.5;
  const oz = (hash2(x * 5.5 + seed, z * 8.8) - 0.5) * d * 0.4;
  const oy = Math.min(h * 0.35, size * 0.5 + 0.3);
  return (
    <mesh position={[x + side * (w / 2 + 0.03), oy, z + oz]} rotation={[0, side > 0 ? Math.PI / 2 : -Math.PI / 2, 0]}>
      <planeGeometry args={[size, size * 0.7]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

const posterCache = new Map<string, THREE.CanvasTexture>();
function drawCategoryIcon(g: CanvasRenderingContext2D, category: ShopCategory, cx: number, cy: number, r: number) {
  g.strokeStyle = "#0a0a0c";
  g.fillStyle = "#0a0a0c";
  g.lineWidth = r * 0.16;
  g.lineCap = "round";
  if (category === "garage") {
    // wrench
    g.save();
    g.translate(cx, cy);
    g.rotate(-Math.PI / 4);
    g.beginPath();
    g.moveTo(-r * 0.8, 0);
    g.lineTo(r * 0.5, 0);
    g.stroke();
    g.beginPath();
    g.arc(-r * 0.8, 0, r * 0.32, 0.6, Math.PI * 2 - 0.6);
    g.stroke();
    g.beginPath();
    g.arc(r * 0.65, 0, r * 0.28, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  } else if (category === "cafe") {
    // cup + steam
    g.beginPath();
    g.moveTo(cx - r * 0.5, cy - r * 0.1);
    g.lineTo(cx - r * 0.4, cy + r * 0.6);
    g.lineTo(cx + r * 0.4, cy + r * 0.6);
    g.lineTo(cx + r * 0.5, cy - r * 0.1);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(cx + r * 0.55, cy + r * 0.05, r * 0.22, -0.8, 0.8);
    g.stroke();
    for (const dx of [-0.2, 0.2]) {
      g.beginPath();
      g.moveTo(cx + dx * r, cy - r * 0.3);
      g.quadraticCurveTo(cx + dx * r - r * 0.15, cy - r * 0.6, cx + dx * r, cy - r * 0.85);
      g.stroke();
    }
  } else {
    // retail — a simple shopping bag
    g.beginPath();
    g.moveTo(cx - r * 0.5, cy - r * 0.3);
    g.lineTo(cx - r * 0.6, cy + r * 0.7);
    g.lineTo(cx + r * 0.6, cy + r * 0.7);
    g.lineTo(cx + r * 0.5, cy - r * 0.3);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(cx, cy - r * 0.35, r * 0.3, Math.PI, 0);
    g.stroke();
  }
}
function getPosterTexture(name: string, category: ShopCategory, accent: string): THREE.CanvasTexture {
  const key = `${name}|${category}|${accent}`;
  const cached = posterCache.get(key);
  if (cached) return cached;
  const w = 512,
    h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, accent);
  grad.addColorStop(1, "#0000"); // transparent fade handled below via solid fill first
  g.fillStyle = accent;
  g.fillRect(0, 0, w, h);
  // weathering: soft dark speckle so it reads as a worn painted sign, not a flat vector
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.strokeStyle = "rgba(10,10,12,0.85)";
  g.lineWidth = 10;
  g.strokeRect(5, 5, w - 10, h - 10);
  drawCategoryIcon(g, category, w * 0.16, h * 0.5, h * 0.3);
  g.font = "bold 64px system-ui, Arial, sans-serif";
  g.fillStyle = "#0a0a0c";
  g.textAlign = "center";
  g.textBaseline = "middle";
  let fontSize = 64;
  while (g.measureText(name).width > w * 0.62 && fontSize > 24) {
    fontSize -= 4;
    g.font = `bold ${fontSize}px system-ui, Arial, sans-serif`;
  }
  g.fillText(name, w * 0.6, h * 0.5);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  posterCache.set(key, tex);
  return tex;
}

function ShopSign({
  x,
  y,
  z,
  w,
  colorIdx,
  name,
  category,
}: {
  x: number;
  y: number;
  z: number;
  w: number;
  colorIdx: number;
  name: string;
  category: ShopCategory;
}) {
  const boardW = Math.min(w * 0.8, 8);
  const boardH = boardW * 0.5;
  const tex = useMemo(() => getPosterTexture(name, category, SIGN_TINTS[colorIdx % SIGN_TINTS.length]), [name, category, colorIdx]);
  return (
    <mesh position={[x, y, z]}>
      <planeGeometry args={[boardW, boardH]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

function ShopBuilding({ spec: { x, z, w, d, h, colorIdx } }: { spec: BuildingSpec }) {
  const { name, category } = SHOP_TYPES[Math.floor(hash2(x, z) * SHOP_TYPES.length)];
  const bodyMat = RESIDENTIAL_MATS[colorIdx];
  const signZ = z + d / 2 + 0.09;

  if (category === "garage") {
    // open drive-in bay at the front third — deliberately NOT covered by the
    // collider below, so the car can actually pull in and park, not just look
    // at a painted-on door
    const bayD = d * 0.42;
    const backD = d - bayD;
    const backCz = z - d / 2 + backD / 2;
    const bayCz = z + d / 2 - bayD / 2;
    return (
      <group>
        <RigidBody type="fixed" colliders="cuboid">
          <mesh castShadow receiveShadow position={[x, h / 2, backCz]} material={GARAGE_MAT}>
            <boxGeometry args={[w, h, backD]} />
          </mesh>
        </RigidBody>
        {/* bay side walls + roof — visual only, no collider, so pulling in never gets you stuck */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[x + (side * w) / 2 - side * 0.1, h / 2, bayCz]} material={GARAGE_MAT} castShadow>
            <boxGeometry args={[0.2, h, bayD]} />
          </mesh>
        ))}
        <mesh position={[x, h - 0.1, bayCz]} material={GARAGE_MAT} castShadow>
          <boxGeometry args={[w, 0.2, bayD]} />
        </mesh>
        {/* dark interior back wall of the bay — reads as a real garage you can see into, not a hollow box */}
        <mesh position={[x, h * 0.4, backCz + backD / 2 + 0.05]} material={GARAGE_INTERIOR_MAT}>
          <boxGeometry args={[w * 0.94, h * 0.8, 0.1]} />
        </mesh>
        <ShopSign x={x} y={h + 0.4} z={z + d / 2 + 0.05} w={w} colorIdx={colorIdx} name={name} category={category} />
        <TireStack x={x - w / 2 + 0.5} z={backCz - backD / 2 + 0.5} />
      </group>
    );
  }

  const storefrontH = Math.min(1.8, h * 0.5);
  const glassMat = GLASS_MATS[colorIdx % GLASS_MATS.length];
  const isBank = name === "BANK";
  const isPetShop = name === "PET SHOP";
  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[x, h / 2, z]} material={isBank ? MARBLE_MAT : bodyMat}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </RigidBody>
      {/* ground-floor storefront glass band on the +z face */}
      <mesh position={[x, storefrontH / 2 + 0.1, z + d / 2 + 0.03]} material={glassMat}>
        <boxGeometry args={[w * 0.86, storefrontH, 0.06]} />
      </mesh>
      {category === "cafe" && (
        // striped awning over the storefront — the one thing that visually
        // separates a cafe/bakery/diner from a plain retail front
        <mesh position={[x, storefrontH + 0.9, z + d / 2 + 0.5]} rotation={[-0.35, 0, 0]} material={SIGN_MATS[colorIdx]} castShadow>
          <boxGeometry args={[w * 0.86, 0.08, 1.1]} />
        </mesh>
      )}
      <ShopSign x={x} y={storefrontH + 0.5} z={signZ} w={w} colorIdx={colorIdx} name={name} category={category} />
      <SideGraffiti x={x} z={z} w={w} d={d} h={h} seed={1} />
      {isBank && <BankDecor x={x} z={z} w={w} d={d} h={h} />}
      {isPetShop && <PetShopDecor x={x} z={z} w={w} d={d} />}
    </group>
  );
}

// Every decision below hashes off (x,z) — no new prop, no per-instance RNG
// plumbed through, but two houses at different coordinates reliably land on
// different door/window colours and different chimney/porch presence, so a
// street of houses reads as individually built, not one prefab recoloured.
function HouseBuilding({ spec: { x, z, w, d, h, colorIdx, groupX, groupZ } }: { spec: BuildingSpec }) {
  const bodyMat = RESIDENTIAL_MATS[colorIdx];
  const roofMat = ROOF_HOUSE_MATS[colorIdx % ROOF_HOUSE_MATS.length];
  // hashed off the BLOCK anchor (groupX/groupZ), not this house's own x/z — every
  // house in a uniform row shares the same door/window/chimney/porch choices,
  // reading as one repeated colony template instead of 4 independently
  // randomised houses that happen to be the same colour
  const doorMat = DOOR_MATS[Math.floor(hash2(groupX, groupZ) * DOOR_MATS.length)];
  const windowMat = WINDOW_MATS[Math.floor(hash2(groupX * 1.7, groupZ * 1.3) * WINDOW_MATS.length)];
  const roofH = Math.min(w, d) * 0.55;

  const doorW = Math.min(0.9, w * 0.16);
  const doorH = Math.min(1.8, h * 0.6);
  const winW = Math.min(0.7, w * 0.14);
  const winH = Math.min(0.7, h * 0.32);
  const winY = h * 0.64;
  const frontZ = z + d / 2 + 0.03;

  const hasSideWindows = hash2(groupX * 2.1, groupZ * 3.7) < 0.7;
  const hasChimney = hash2(groupX * 4.9, groupZ * 2.3) < 0.35;
  const hasPorch = hash2(groupX * 6.1, groupZ * 5.3) < 0.3;
  const chimneySide = hash2(groupX * 9.1, groupZ * 7.7) < 0.5 ? -1 : 1;

  return (
    <group>
      <RigidBody type="fixed" colliders="cuboid">
        <mesh castShadow receiveShadow position={[x, h / 2, z]} material={bodyMat}>
          <boxGeometry args={[w, h, d]} />
        </mesh>
      </RigidBody>
      <mesh
        position={[x, h + roofH / 2, z]}
        geometry={HIP_ROOF_GEO}
        material={roofMat}
        scale={[Math.hypot(w, d) * 0.62, roofH, Math.hypot(w, d) * 0.62]}
        castShadow
      />

      {/* door, centred on the front (+z) face */}
      <mesh position={[x, doorH / 2, frontZ]} material={doorMat}>
        <boxGeometry args={[doorW, doorH, 0.06]} />
      </mesh>
      {/* front windows flanking the door */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[x + side * w * 0.28, winY, frontZ]} material={windowMat}>
          <boxGeometry args={[winW, winH, 0.05]} />
        </mesh>
      ))}
      {/* side windows — present on most houses, skipped on some for variety */}
      {hasSideWindows &&
        [-1, 1].map((side) => (
          <mesh key={side} position={[x + (side * w) / 2 + 0.02 * side, winY, z]} rotation={[0, Math.PI / 2, 0]} material={windowMat}>
            <boxGeometry args={[Math.min(winW, d * 0.14), winH, 0.05]} />
          </mesh>
        ))}
      {/* chimney — poking through one slope of the roof, not every house has one */}
      {hasChimney && (
        <mesh
          position={[x + chimneySide * w * 0.22, h + roofH * 0.55, z - d * 0.18]}
          material={ROOF_HOUSE_MATS[(colorIdx + 1) % ROOF_HOUSE_MATS.length]}
          castShadow
        >
          <boxGeometry args={[0.45, roofH * 1.1, 0.45]} />
        </mesh>
      )}
      {/* porch overhang above the door, on 2 thin posts — not every house has one */}
      {hasPorch && (
        <>
          <mesh position={[x, doorH + 0.35, frontZ + 0.55]} material={roofMat} castShadow>
            <boxGeometry args={[w * 0.6, 0.14, 1.1]} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[x + side * w * 0.26, doorH * 0.5, frontZ + 1.05]}
              geometry={ANTENNA_GEO}
              material={ANTENNA_MAT}
              scale={[2, doorH, 2]}
            />
          ))}
        </>
      )}
      <SideGraffiti x={x} z={z} w={w} d={d} h={h} seed={2} />
    </group>
  );
}

// Trunk gets a real collider — a car driving through a tree at speed reads as
// a bug, not "dressing" (originally cut for cost; the crown stays visual-only,
// nobody expects to bounce off leaves). TRUNK_GEO's un-scaled radius is
// 0.15-0.21; the collider uses a flat 0.2 since x/z scale is always 1.
// Renders every tree in one chunk (typically 3-9, up to 9 more on a park
// chunk) as a handful of <Instances> instead of one <Tree> subtree each —
// was up to 8 separate draw calls per tree (trunk + 2 branches + 5 crown
// lobes), ~75-100 trees live at VIEW=2 per the shadow-pass comment below.
// Trunk/branch always share one material each (collapses straight to 2
// <Instances>); crown lobes pick one of 9 CROWN_MATS (matIdx*3+tint), so
// they're bucketed by material — still ≤9 draw calls total for however many
// lobes exist in the chunk, down from 5 per tree.
function Trees({ specs }: { specs: TreeDesc[] }) {
  const branchItems = useMemo(
    () =>
      specs.flatMap((t) =>
        [-1, 1].map((side) => {
          const j = hash2(t.x * 3.1 + side, t.z * 5.7 + side);
          // root sits just below the trunk top (blends into it, not floating
          // above); length is generous enough that, combined with the tilt,
          // the tip reliably lands inside the canopy lobes rather than short
          // of them — root is fixed here (geometry is base-anchored, see
          // BRANCH_GEO), so this can't fall short the way a centred cylinder did
          const len = t.r * (0.95 + j * 0.3);
          return {
            pos: [t.x + side * 0.06, t.h - t.r * 0.12, t.z + side * 0.03] as [number, number, number],
            rot: [0, 0, side * (0.5 + j * 0.25)] as [number, number, number],
            len,
          };
        })
      ),
    [specs]
  );
  const crownItems = useMemo(() => {
    const items: {
      pos: [number, number, number];
      scale: [number, number, number];
      rot: [number, number, number];
      matIdx: number;
    }[] = [];
    // 3 cards per lobe, fanned 60° apart around Y with a slight per-card tilt
    // jitter — a "billboard cross" impostor, so each clump reads as leaf
    // volume from any driving angle instead of a single flat card
    const FAN = [
      [0.15, 0, 0],
      [0.1, Math.PI / 3, 0.05],
      [-0.05, (2 * Math.PI) / 3, -0.1],
    ] as const;
    specs.forEach((t) => {
      const canopyY = t.h + t.r * 0.5;
      LOBES.forEach((lobe, i) => {
        const j = hash2(t.x * 7.13 + i * 1.9, t.z * 4.31 + i * 2.7);
        const tint = (i + t.matIdx) % CROWN_MATS.length; // rotates per tree so trees don't all match
        const s = t.r * lobe.s * (0.85 + j * 0.3);
        const pos: [number, number, number] = [t.x + lobe.dx * t.r * 1.3, canopyY + lobe.dy * t.r, t.z + lobe.dz * t.r * 1.3];
        const scale: [number, number, number] = [s, s * 0.85, s];
        FAN.forEach((rot) => items.push({ pos, scale, rot: rot as unknown as [number, number, number], matIdx: tint }));
      });
    });
    return items;
  }, [specs]);

  if (specs.length === 0) return null;
  return (
    <group>
      {specs.map((t, i) => (
        <RigidBody key={i} type="fixed" colliders={false} position={[t.x, t.h / 2, t.z]}>
          <CylinderCollider args={[t.h / 2, 0.2]} />
        </RigidBody>
      ))}
      <Instances geometry={TRUNK_GEO} material={TRUNK_MAT} limit={specs.length} castShadow>
        {specs.map((t, i) => (
          <Instance key={i} position={[t.x, t.h / 2, t.z]} scale={[1, t.h, 1]} />
        ))}
      </Instances>
      {/* ponytail: branch stubs + crown lobes skip castShadow — shadow-casters
          nobody notices unshadowed at driving distance; trunk still casts
          (visible on the ground). Revert if a tree's own shadow ever needs to
          read on the canopy itself. */}
      <Instances geometry={BRANCH_GEO} material={BRANCH_MAT} limit={branchItems.length}>
        {branchItems.map((b, i) => (
          <Instance key={i} position={b.pos} rotation={b.rot} scale={[1, b.len, 1]} />
        ))}
      </Instances>
      {CROWN_MATS.map((mat, matIdx) => {
        const items = crownItems.filter((c) => c.matIdx === matIdx);
        if (items.length === 0) return null;
        return (
          <Instances key={matIdx} geometry={LEAF_GEO} material={mat} limit={items.length}>
            {items.map((c, i) => (
              <Instance key={i} position={c.pos} scale={c.scale} rotation={c.rot} />
            ))}
          </Instances>
        );
      })}
    </group>
  );
}
