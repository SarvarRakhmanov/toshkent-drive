"use client";

import { useEffect, useRef } from "react";
import { worldState } from "@/lib/worldState";
import { trafficPositions } from "@/components/Traffic";
import { LANDMARKS } from "@/lib/landmarks";
import { useHudStore } from "@/lib/hudStore";
import { roadRoute } from "@/lib/route";
import { streetName } from "@/lib/streetNames";
import { RAMP_X0, DECK_X1, HWY_Z, HWY_W } from "@/lib/highway";

// Player-centred, player-up street radar. Streets and landmarks are drawn from
// the SAME numbers the city is generated with (City.tsx CELL/ROAD_W): asphalt
// runs along every chunk boundary (world coords ≡ 50 mod 100), blocks/footpaths
// fill the interiors. The old version drew its grid at multiples of 100 (chunk
// CENTRES) — half a block off from the real roads — which is why landmarks
// looked like they sat on the streets.
const CSS = 180; // on-screen size, matches #minimap in globals.css
const DPR = 2; // supersample so labels stay crisp when scaled down to CSS px
const R = CSS * DPR;
const C = R / 2;
const RADIUS_W = 150; // world units from centre to edge (~3 streets each way)
const S = C / RADIUS_W; // world → canvas-px scale
const CELL = 100; // City.tsx CELL
const ROAD_W = 20; // City.tsx ROAD_W
// LAND_EDGE_X (550), not lib/marina.ts's SHORE_X (600) — SHORE_X is the
// drowning/collision boundary, 50 units further out than where City.tsx
// actually stops generating road chunks and components/Water.tsx's plane
// begins. Using SHORE_X here left a 50-unit strip of real water still
// showing fake road grid on the minimap.
const LAND_EDGE_X = 550;

// Pull a landmark toward its block centre so the marker always sits deep on the
// footpath, never on (or hugging) the asphalt. A block's footpath spans ±40 of
// its centre and the road band starts at ±40; clamping to ±20 keeps every pin a
// clear 20 units off the nearest kerb, even for landmarks placed dead on a road
// line in-game (VENU at x=-50, the intersection landmarks, etc.).
const BLOCK_SAFE = 20;
function offRoad(v: number) {
  const bc = Math.round(v / CELL) * CELL;
  return bc + Math.max(-BLOCK_SAFE, Math.min(BLOCK_SAFE, v - bc));
}
const MARKS = LANDMARKS.map((l) => ({ ...l, mx: offRoad(l.x), mz: offRoad(l.z) }));

// keeps a street label right-side-up on screen instead of upside-down,
// whichever way the road happens to be pointing after the map rotates with heading
function uprightAngle(a: number) {
  while (a > Math.PI / 2) a -= Math.PI;
  while (a < -Math.PI / 2) a += Math.PI;
  return a;
}

export function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      const { px, pz, heading } = worldState;
      const nav = useHudStore.getState().navTarget;

      // world → screen for the unrotated overlay (labels/dots): apply the same
      // −heading rotation the world layer uses, but resolve to plain canvas px
      const cos = Math.cos(-heading);
      const sin = Math.sin(-heading);
      const toScreen = (wx: number, wz: number): [number, number] => {
        const dx = wx - px;
        const dz = wz - pz;
        return [C + (dx * cos - dz * sin) * S, C + (dx * sin + dz * cos) * S];
      };

      // ---- ground: concrete blocks ----
      ctx.clearRect(0, 0, R, R);
      ctx.fillStyle = "#444d5a";
      ctx.fillRect(0, 0, R, R);

      // ---- rotated world layer: water, asphalt, lane lines, traffic ----
      // Rotation is `heading - PI`, not `-heading`: the game's own forward
      // vector is (sin h, cos h) (see Player.tsx's movement code), and
      // solving canvas rotate(θ) · (sin h, cos h) = (0, -1) — "whatever's
      // directly ahead of the player renders toward the top of the radar,"
      // the actual point of a player-forward-up minimap — gives θ = h - π,
      // not -h. The old `-h` was off by a constant 180°: confirmed live by
      // opening BigMap.tsx's north-up map while facing a landmark dead-on
      // (framed centre-screen in the HOOD camera) and finding its player
      // arrow pointing exactly away from it, not toward it.
      ctx.save();
      ctx.translate(C, C);
      ctx.rotate(heading - Math.PI);
      ctx.scale(S, S);
      ctx.translate(-px, -pz);
      const reach = RADIUS_W + 60; // draw a little past the rim so nothing pops at the edge

      const first = (base: number) => Math.floor((base - reach - 50) / CELL) * CELL + 50;
      ctx.fillStyle = "#161922";
      for (let x = first(px); x <= px + reach; x += CELL) ctx.fillRect(x - ROAD_W / 2, pz - reach, ROAD_W, 2 * reach);
      for (let z = first(pz); z <= pz + reach; z += CELL) ctx.fillRect(px - reach, z - ROAD_W / 2, 2 * reach, ROAD_W);

      ctx.strokeStyle = "rgba(244,208,92,0.55)";
      ctx.lineWidth = 1.4 / S;
      ctx.setLineDash([6 / S, 7 / S]);
      for (let x = first(px); x <= px + reach; x += CELL) {
        ctx.beginPath();
        ctx.moveTo(x, pz - reach);
        ctx.lineTo(x, pz + reach);
        ctx.stroke();
      }
      for (let z = first(pz); z <= pz + reach; z += CELL) {
        ctx.beginPath();
        ctx.moveTo(px - reach, z);
        ctx.lineTo(px + reach, z);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Painted AFTER the road grid/lane dashes (not before) so it covers
      // whatever those loops drew east of the shoreline instead of the road
      // loops needing their own per-segment SHORE_X clipping — same idea as
      // the street-name loop below skipping labels past SHORE_X, just done
      // by occlusion instead of a skip check.
      if (px + reach >= LAND_EDGE_X) {
        ctx.fillStyle = "#13527e";
        ctx.fillRect(LAND_EDGE_X, pz - reach, 5000, 2 * reach);
      }

      // I-94's sea bridge to FORT NEON (lib/highway.ts) — a fixed-z deck
      // running RAMP_X0..DECK_X1, not part of the CELL grid the loops above
      // draw, so without this it's invisible on the radar (just open water)
      // even though it's a real drivable road. Painted AFTER the water fill
      // (not clipped by it) since the whole point is a road ON TOP of the
      // water, unlike the regular grid which the water is meant to cover.
      if (pz + reach >= HWY_Z - HWY_W && pz - reach <= HWY_Z + HWY_W) {
        ctx.fillStyle = "#22262f";
        ctx.fillRect(RAMP_X0, HWY_Z - HWY_W / 2, DECK_X1 - RAMP_X0, HWY_W);
        ctx.strokeStyle = "rgba(244,208,92,0.5)";
        ctx.lineWidth = 1.2 / S;
        ctx.setLineDash([6 / S, 7 / S]);
        ctx.beginPath();
        ctx.moveTo(RAMP_X0, HWY_Z);
        ctx.lineTo(DECK_X1, HWY_Z);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = "#ff6a4a";
      for (const t of trafficPositions) {
        if (t.stolen) continue; // the player is driving it — it's not traffic any more
        ctx.beginPath();
        ctx.arc(t.x, t.z, 3.4 / S, 0, Math.PI * 2);
        ctx.fill();
      }

      // ---- turn-by-turn route to the active destination, along the roads
      // (not a straight line through blocks) — same road-grid math as the
      // asphalt drawn above, see lib/route.ts ----
      if (nav) {
        const route = roadRoute(px, pz, nav.x, nav.z);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(route[0].x, route[0].z);
        for (let i = 1; i < route.length; i++) ctx.lineTo(route[i].x, route[i].z);
        ctx.strokeStyle = "rgba(10,14,22,0.65)"; // dark halo so the line reads over yellow lane dashes
        ctx.lineWidth = 5.5 / S;
        ctx.stroke();
        ctx.strokeStyle = "#3fa9ff";
        ctx.lineWidth = 3 / S;
        ctx.stroke();
      }
      ctx.restore();

      // ---- street names, GTA5-style: one label per visible road line,
      // curved to follow the street's on-screen direction but always kept
      // right-side-up (never upside-down as the map rotates with heading) ----
      ctx.font = `italic 600 ${7.5 * DPR}px system-ui, Arial, sans-serif`;
      ctx.fillStyle = "rgba(226,230,238,0.8)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const xLineAngle = uprightAngle(Math.atan2(cos, -sin));
      const zLineAngle = uprightAngle(Math.atan2(sin, cos));
      for (let x = first(px); x <= px + reach; x += CELL) {
        if (px + reach >= LAND_EDGE_X && x >= LAND_EDGE_X) continue; // no street signs out in the water
        const [sx, sy] = toScreen(x, pz + 35);
        if (sx < 10 || sx > R - 10 || sy < 10 || sy > R - 10) continue;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(xLineAngle);
        ctx.fillText(streetName(x, "x"), 0, 0);
        ctx.restore();
      }
      for (let z = first(pz); z <= pz + reach; z += CELL) {
        const [sx, sy] = toScreen(px + 35, z);
        if (sx < 10 || sx > R - 10 || sy < 10 || sy > R - 10) continue;
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(zLineAngle);
        ctx.fillText(streetName(z, "z"), 0, 0);
        ctx.restore();
      }

      // ---- landmarks: dots + labels, drawn upright over the rotated map ----
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.font = `700 ${10 * DPR}px system-ui, Arial, sans-serif`;
      ctx.lineJoin = "round";
      const rim = C - 7 * DPR;
      const labelZone = C * 0.72; // only label markers comfortably inside — keeps the rim uncrowded
      for (const m of MARKS) {
        const isNav = !!nav && nav.name === m.name;
        let [sx, sy] = toScreen(m.mx, m.mz);
        const inView = sx >= 6 && sx <= R - 6 && sy >= 6 && sy <= R - 6;
        if (!inView) {
          // off-screen: clamp a small direction dot to the rim (label only the
          // active destination, so the radar doesn't get crowded)
          const ang = Math.atan2(sy - C, sx - C);
          sx = C + Math.cos(ang) * rim;
          sy = C + Math.sin(ang) * rim;
        }
        const rad = (isNav ? 5 : inView ? 4 : 3) * DPR;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = m.col;
        ctx.fill();
        ctx.lineWidth = 1.5 * DPR;
        ctx.strokeStyle = isNav ? "#ffffff" : "rgba(0,0,0,0.55)";
        ctx.stroke();
        // label the active destination always, plus any marker sitting well
        // inside the dial; place it below the dot near the top edge so it never
        // clips, and clamp x so long names stay on-canvas. Skip labels sitting
        // right under the player marker (you're parked on the landmark).
        const dist = Math.hypot(sx - C, sy - C);
        if (dist > 16 * DPR && (isNav || (inView && dist < labelZone))) {
          const half = ctx.measureText(m.name).width / 2 + 3 * DPR;
          const lx = Math.max(half, Math.min(R - half, sx));
          const above = sy - rad - 3 * DPR > 12 * DPR;
          const ly = above ? sy - rad - 3 * DPR : sy + rad + 12 * DPR;
          ctx.textBaseline = above ? "bottom" : "top";
          ctx.lineWidth = 3 * DPR;
          ctx.strokeStyle = "rgba(6,8,14,0.9)";
          ctx.strokeText(m.name, lx, ly);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(m.name, lx, ly);
        }
      }

      // ---- player marker: a body + head glyph reads as "a character," not
      // an arrow — fixed at centre, always facing up (the world rotates
      // around it, per the fix above), head circle toward the top ----
      ctx.save();
      ctx.translate(C, C);
      ctx.lineWidth = 1.5 * DPR;
      ctx.strokeStyle = "rgba(6,8,14,0.9)";
      ctx.fillStyle = "#ffe14a";
      ctx.beginPath();
      ctx.ellipse(0, 3 * DPR, 5 * DPR, 6 * DPR, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -5 * DPR, 3.4 * DPR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    raf.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return <canvas id="minimap" ref={ref} width={R} height={R} />;
}
