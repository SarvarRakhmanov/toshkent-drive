"use client";

import { useEffect, useRef, useState } from "react";
import { useHudStore } from "@/lib/hudStore";
import { worldState } from "@/lib/worldState";
import { LANDMARKS, type Landmark } from "@/lib/landmarks";
import { streetName } from "@/lib/streetNames";
import { RAMP_X0, DECK_X1, HWY_Z, HWY_W } from "@/lib/highway";

const SIZE = 460;
// World-space bounds covering every landmark with margin — a full map, not a
// player-centred pannable one (the original's #bigmap is player-centred;
// simplified here since the destination list already covers selection).
// Derived from LANDMARKS itself rather than hand-picked: a hardcoded box
// silently orphaned INTERNATIONAL AIRPORT's pin off the left edge the moment
// it was added at x=-750 (the destination list still worked, the dot on the
// map just never rendered), and did the same to FORT NEON's pin at
// (1670,-400) — computing it from the actual landmark set means a landmark
// added anywhere can never fall outside its own map again.
const MARGIN = 90;
const landmarkXs = LANDMARKS.map((l) => l.x);
const landmarkZs = LANDMARKS.map((l) => l.z);
const WX0 = Math.min(...landmarkXs) - MARGIN;
const WX1 = Math.max(...landmarkXs) + MARGIN;
const WZ0 = Math.min(...landmarkZs) - MARGIN;
const WZ1 = Math.max(...landmarkZs) + MARGIN;
const CELL = 100; // City.tsx CELL
const ROAD_W = 20; // City.tsx ROAD_W
// LAND_EDGE_X (550), not lib/marina.ts's SHORE_X (600) — see Minimap.tsx's
// identical comment: SHORE_X is the drowning/collision boundary, 50 units
// past where City.tsx actually stops generating road chunks and
// components/Water.tsx's plane begins.
const LAND_EDGE_X = 550;

// Zoom: 1 = the original fit-everything view (unchanged default), up to 6x
// centred on the PLAYER rather than the map's own centre — since the point
// of zooming in is to see nearby streets/whichever landmark you're closest
// to, not an arbitrary fixed point. No panning: the destination list already
// covers picking a far-off target, zoom is purely "see more local detail."
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
function clampZoom(z: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

// See Minimap.tsx: clamp a landmark to within ±20 of its block centre so the
// marker sits deep on the footpath, a clear 20 units off the nearest kerb —
// never on (or hugging) the drawn asphalt.
const BLOCK_SAFE = 20;
function offRoad(v: number) {
  const bc = Math.round(v / CELL) * CELL;
  return bc + Math.max(-BLOCK_SAFE, Math.min(BLOCK_SAFE, v - bc));
}

// Canvas + zoom controls, split out of BigMap so it can be conditionally
// MOUNTED (not just conditionally visible) — BigMap only ever renders this
// while `open`, so every open is a fresh mount and zoomRef/zoomLabel reset to
// MIN_ZOOM for free via their own initial values. No effect-body setState,
// no ref-read-during-render: both trip this project's React Compiler lint
// (see Milestone 6's SUMMARY.md note on the same class of issue), and this
// sidesteps needing either.
function MapCanvas({ navTarget }: { navTarget: Landmark | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const zoomRef = useRef(MIN_ZOOM);
  const [zoomLabel, setZoomLabel] = useState(MIN_ZOOM);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current = clampZoom(zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      setZoomLabel(zoomRef.current);
    };
    // React's synthetic wheel listener is passive by default (can't
    // preventDefault, so the page behind the modal would scroll while
    // zooming) — a real DOM listener is the only way to opt out of that.
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const draw = () => {
      raf.current = requestAnimationFrame(draw);

      // Recomputed every frame (not once, like the fixed-view original) since
      // player-centred zoom needs to track worldState.px/pz as it changes.
      const zoom = zoomRef.current;
      const baseW = WX1 - WX0;
      const baseH = WZ1 - WZ0;
      const viewW = baseW / zoom;
      const viewH = baseH / zoom;
      const zoomedIn = zoom > 1.001;
      const centerX = zoomedIn ? worldState.px : (WX0 + WX1) / 2;
      const centerZ = zoomedIn ? worldState.pz : (WZ0 + WZ1) / 2;
      const wx0 = centerX - viewW / 2;
      const wx1 = centerX + viewW / 2;
      const wz0 = centerZ - viewH / 2;
      const wz1 = centerZ + viewH / 2;
      const sx = SIZE / viewW;
      const sz = SIZE / viewH;
      const toPx = (x: number, z: number) => [(x - wx0) * sx, (z - wz0) * sz];

      // concrete blocks as the base
      ctx.fillStyle = "#3a424d";
      ctx.fillRect(0, 0, SIZE, SIZE);

      // asphalt streets along every chunk boundary (≡ 50 mod 100)
      ctx.fillStyle = "#161922";
      for (let x = Math.ceil((wx0 - 50) / CELL) * CELL + 50; x < wx1; x += CELL) {
        const [cx] = toPx(x - ROAD_W / 2, 0);
        ctx.fillRect(cx, 0, ROAD_W * sx, SIZE);
      }
      for (let z = Math.ceil((wz0 - 50) / CELL) * CELL + 50; z < wz1; z += CELL) {
        const [, cz] = toPx(0, z - ROAD_W / 2);
        ctx.fillRect(0, cz, SIZE, ROAD_W * sz);
      }
      // dashed lane centre lines
      ctx.strokeStyle = "rgba(244,208,92,0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 6]);
      for (let x = Math.ceil((wx0 - 50) / CELL) * CELL + 50; x < wx1; x += CELL) {
        const [cx] = toPx(x, 0);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, SIZE);
        ctx.stroke();
      }
      for (let z = Math.ceil((wz0 - 50) / CELL) * CELL + 50; z < wz1; z += CELL) {
        const [, cz] = toPx(0, z);
        ctx.beginPath();
        ctx.moveTo(0, cz);
        ctx.lineTo(SIZE, cz);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // water past the shore — painted AFTER the road/dash loops (not
      // before) so it covers whatever those drew east of the shoreline,
      // same fix and same reasoning as Minimap.tsx.
      const [wsx] = toPx(LAND_EDGE_X, 0);
      if (wsx < SIZE) {
        ctx.fillStyle = "#13527e";
        ctx.fillRect(Math.max(0, wsx), 0, SIZE - Math.max(0, wsx), SIZE);
      }

      // I-94's sea bridge to FORT NEON (lib/highway.ts) — a fixed-z deck
      // running RAMP_X0..DECK_X1, not part of the CELL grid the loops above
      // draw, so without this it's invisible on the map (just open water)
      // even though it's a real drivable road. Painted AFTER the water fill
      // (not clipped by it) since the whole point is a road ON TOP of the
      // water, unlike the regular grid which the water is meant to cover.
      {
        const [hx0, hz0] = toPx(RAMP_X0, HWY_Z - HWY_W / 2);
        const [hx1, hz1] = toPx(DECK_X1, HWY_Z + HWY_W / 2);
        ctx.fillStyle = "#22262f";
        ctx.fillRect(hx0, hz0, hx1 - hx0, hz1 - hz0);
        ctx.strokeStyle = "rgba(244,208,92,0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ctx.moveTo(hx0, (hz0 + hz1) / 2);
        ctx.lineTo(hx1, (hz0 + hz1) / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // street names — Minimap.tsx has to rotate its labels upright as the
      // player-centred radar spins with heading; this map is fixed north-up,
      // so every label just sits flat along its road, no angle math needed.
      // Reuses the exact same lib/streetNames.ts function Minimap.tsx does,
      // so a given road always shows the same name on both maps.
      ctx.font = "italic 600 11px system-ui, Arial, sans-serif";
      ctx.fillStyle = "rgba(226,230,238,0.85)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let x = Math.ceil((wx0 - 50) / CELL) * CELL + 50; x < wx1; x += CELL) {
        if (x >= LAND_EDGE_X) continue; // no street signs out in the water
        const [cx] = toPx(x, 0);
        ctx.save();
        ctx.translate(cx, 18);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(streetName(x, "x"), 0, 0);
        ctx.restore();
      }
      for (let z = Math.ceil((wz0 - 50) / CELL) * CELL + 50; z < wz1; z += CELL) {
        const [, cz] = toPx(0, z);
        ctx.fillText(streetName(z, "z"), 42, cz);
      }

      LANDMARKS.forEach((l, i) => {
        const [px, pz] = toPx(offRoad(l.x), offRoad(l.z));
        const r = l === navTarget ? 7 : 5;
        ctx.fillStyle = l.col;
        ctx.beginPath();
        ctx.arc(px, pz, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = l === navTarget ? "#fff" : "rgba(0,0,0,0.55)";
        ctx.stroke();
        // stagger label above/below by index so neighbouring pins (e.g. POLICE
        // HARBOR / EAST MARINA, both on the z=50 road near the water) don't collide
        ctx.font = "bold 12px system-ui, Arial";
        const above = i % 2 === 0;
        const half = ctx.measureText(l.name).width / 2 + 4;
        const lx = Math.max(half, Math.min(SIZE - half, px));
        ctx.textAlign = "center";
        ctx.textBaseline = above ? "bottom" : "top";
        ctx.lineJoin = "round";
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(6,8,14,0.9)";
        const ly = above ? pz - r - 4 : pz + r + 4;
        ctx.strokeText(l.name, lx, ly);
        ctx.fillStyle = "#fff";
        ctx.fillText(l.name, lx, ly);
      });

      // Body + head glyph, not an arrow. This map is fixed north-up (no
      // rotate() on the world at all — world x/z map straight onto screen
      // x/y, see toPx), so the head just needs to sit toward wherever the
      // player is actually facing: offsetting it by the SAME (sin h, cos h)
      // vector Player.tsx's own movement code uses is exact, no rotation
      // matrix or sign to get wrong. The old `ctx.rotate(-worldState.heading)`
      // on a fixed "points up" triangle was off by a constant 180° — verified
      // live: facing a landmark dead-on (centred in the HOOD camera) still
      // showed the arrow pointing away from it, not toward it.
      const [ppx, ppz] = toPx(worldState.px, worldState.pz);
      const fx = Math.sin(worldState.heading);
      const fz = Math.cos(worldState.heading);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "rgba(6,8,14,0.9)";
      ctx.fillStyle = "#ffd76a";
      ctx.beginPath();
      ctx.ellipse(ppx, ppz, 4.5, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ppx + fx * 7, ppz + fz * 7, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [navTarget]);

  return (
    <div id="mapcanvaswrap">
      <canvas id="bigmap" ref={canvasRef} width={SIZE} height={SIZE} />
      <div id="mapzoom">
        <button
          type="button"
          onClick={() => {
            zoomRef.current = clampZoom(zoomRef.current * 1.4);
            setZoomLabel(zoomRef.current);
          }}
        >
          +
        </button>
        <span>{zoomLabel.toFixed(1)}x</span>
        <button
          type="button"
          onClick={() => {
            zoomRef.current = clampZoom(zoomRef.current / 1.4);
            setZoomLabel(zoomRef.current);
          }}
        >
          −
        </button>
      </div>
    </div>
  );
}

export function BigMap() {
  const open = useHudStore((s) => s.mapOpen);
  const setMapOpen = useHudStore((s) => s.setMapOpen);
  const navTarget = useHudStore((s) => s.navTarget);
  const setNavTarget = useHudStore((s) => s.setNavTarget);

  if (!open) return null;

  const dist = (l: Landmark) => Math.round(Math.hypot(l.x - worldState.px, l.z - worldState.pz));

  return (
    <div id="mapscreen" onClick={() => setMapOpen(false)}>
      <div id="mapcard" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2>CITY MAP</h2>
          <MapCanvas navTarget={navTarget} />
        </div>
        <div id="mapright">
          <h2>DESTINATIONS</h2>
          <div id="maplist">
            {[...LANDMARKS]
              .sort((a, b) => dist(a) - dist(b))
              .map((l) => (
                <button key={l.name} type="button" className={l === navTarget ? "active" : ""} onClick={() => setNavTarget(l)}>
                  <span className="dot" style={{ color: l.col, background: l.col }} />
                  <span className="nm">{l.name}</span>
                  <span className="km">{dist(l)}m</span>
                </button>
              ))}
          </div>
          <div id="mapclose" onClick={() => setMapOpen(false)}>
            CLOSE&nbsp;&nbsp;(ESC)
          </div>
        </div>
      </div>
    </div>
  );
}
