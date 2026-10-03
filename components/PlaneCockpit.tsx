"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { FlightState } from "@/lib/flightPhysics";
import { PLANE_HANDLING } from "@/lib/flightPhysics";

// SKY RUNNER's single-seat interior — mounted inside Plane.tsx's own returned
// group so it inherits the body's kinematic position/rotation for free (no
// separate transform plumbing). Only really seen through cockpit cam
// (camMode===1, see lib/cameraRig.ts's cockpitAhead-driven eye position that
// Plane.tsx passes), but it's real geometry (not conditionally mounted) so it
// also reads correctly, tinted, through the canopy glass in chase/hood views.
//
// Sits inside the fuselage cylinder's canopy bulge (Plane.tsx's fusGeo tapers
// 0.5→0.38 radius nose-to-tail; at the canopy's z≈1.15 that's ~0.47m, so the
// panel's ~0.55m width and the seat both fit with wall clearance to spare).
//
// Gauge faces are canvas textures, same tex()-helper idiom as
// lib/airportTextures.ts (drawn once at module load, not exported there so
// this file keeps its own copy); needles are separate meshes rotated live in
// useFrame off the passed-in flight-state ref, per-frame mutation not React
// state — same as every other per-frame vehicle read in this codebase.

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function ticks(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, count: number) {
  for (let i = 0; i <= count; i++) {
    const a = -2.356 + (i / count) * 4.712; // -135deg..+135deg sweep, matches needleAngle()
    const big = i % 5 === 0;
    g.strokeStyle = big ? "#e7ecf2" : "#8a919c";
    g.lineWidth = big ? 2.2 : 1.1;
    const r1 = big ? r * 0.76 : r * 0.85;
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    g.lineTo(cx + Math.sin(a) * r * 0.94, cy - Math.cos(a) * r * 0.94);
    g.stroke();
  }
}

function gaugeFace(label: string, draw: (g: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void) {
  return tex(128, 128, (g) => {
    const cx = 64, cy = 64, r = 58;
    g.fillStyle = "#12151a";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    draw(g, cx, cy, r);
    g.strokeStyle = "#555b64";
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#c7cdd6";
    g.font = "bold 11px sans-serif";
    g.textAlign = "center";
    g.fillText(label, cx, cy + r * 0.5);
  });
}

// needle sweeps -135deg..+135deg (270deg) as t goes 0..1 — real light-aircraft
// round-dial convention, matches the tick layout above
function needleAngle(t: number) {
  return -2.356 + THREE.MathUtils.clamp(t, 0, 1) * 4.712;
}

const AIRSPEED_TEX = gaugeFace("KM/H", (g, cx, cy, r) => ticks(g, cx, cy, r, 20));
const ALTIMETER_TEX = gaugeFace("ALT m", (g, cx, cy, r) => ticks(g, cx, cy, r, 20));
const RPM_TEX = gaugeFace("RPM x100", (g, cx, cy, r) => ticks(g, cx, cy, r, 20));
const ATTITUDE_BEZEL_TEX = tex(128, 128, (g) => {
  g.fillStyle = "#12151a";
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "#e7ecf2";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(24, 64); g.lineTo(44, 64); // fixed aircraft-symbol wings either side of centre
  g.moveTo(84, 64); g.lineTo(104, 64);
  g.stroke();
  g.fillStyle = "#e7ecf2";
  g.beginPath(); g.arc(64, 64, 3, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#555b64";
  g.lineWidth = 3;
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
});
// rotating horizon disc, oversized vs the bezel opening so panning/banking
// never reveals its edge
const HORIZON_TEX = tex(160, 160, (g) => {
  g.fillStyle = "#2e6fb3";
  g.fillRect(0, 0, 160, 80);
  g.fillStyle = "#6b4a2e";
  g.fillRect(0, 80, 160, 80);
  g.strokeStyle = "#f2f4f7";
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 80); g.lineTo(160, 80); g.stroke();
  g.strokeStyle = "rgba(242,244,247,.6)";
  g.lineWidth = 1.5;
  for (const dy of [-24, -12, 12, 24]) {
    g.beginPath(); g.moveTo(70, 80 + dy); g.lineTo(90, 80 + dy); g.stroke();
  }
});
const HEADING_CARD_TEX = tex(128, 128, (g) => {
  g.fillStyle = "#12151a";
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  ticks(g, 64, 64, 58, 36);
  g.fillStyle = "#e7ecf2";
  g.font = "bold 13px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  const dirs: [string, number][] = [["N", 0], ["E", Math.PI / 2], ["S", Math.PI], ["W", -Math.PI / 2]];
  for (const [ch, a] of dirs) g.fillText(ch, 64 + Math.sin(a) * 42, 64 - Math.cos(a) * 42);
  g.strokeStyle = "#555b64";
  g.lineWidth = 3;
  g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.stroke();
});

const FRAME_MAT = new THREE.MeshStandardMaterial({ color: "#23262d", metalness: 0.7, roughness: 0.4 });
const PANEL_MAT = new THREE.MeshStandardMaterial({ color: "#1a1c21", metalness: 0.3, roughness: 0.7 });
const SEAT_MAT = new THREE.MeshStandardMaterial({ color: "#3a3630", roughness: 0.85 });
const STICK_MAT = new THREE.MeshStandardMaterial({ color: "#15171b", metalness: 0.6, roughness: 0.35 });
const GRIP_MAT = new THREE.MeshStandardMaterial({ color: "#0d0e11", roughness: 0.9 });
const BEZEL_MAT = new THREE.MeshStandardMaterial({ color: "#0a0b0d", metalness: 0.4, roughness: 0.6 });
const NEEDLE_MAT = new THREE.MeshStandardMaterial({ color: "#e2483a", roughness: 0.5 });
const LEVER_MAT = new THREE.MeshStandardMaterial({ color: "#3d4148", metalness: 0.5, roughness: 0.4 });
const KNOB_RED_MAT = new THREE.MeshStandardMaterial({ color: "#c23b2e", roughness: 0.6 });
const FACE_GEO = new THREE.CircleGeometry(0.052, 20);
const NEEDLE_GEO = new THREE.BoxGeometry(0.006, 0.044, 0.003).translate(0, 0.02, 0);

interface GaugeProps {
  x: number;
  y: number;
  texture: THREE.Texture;
  needleRef?: React.RefObject<THREE.Group | null>;
}

function Gauge({ x, y, texture, needleRef }: GaugeProps) {
  return (
    <group position={[x, y, 0]}>
      <mesh material={BEZEL_MAT}>
        <cylinderGeometry args={[0.058, 0.058, 0.018, 16]} />
      </mesh>
      <mesh position={[0, 0, 0.01]}>
        <primitive object={FACE_GEO} attach="geometry" />
        <meshStandardMaterial map={texture} roughness={0.6} side={THREE.DoubleSide} />
      </mesh>
      {needleRef && (
        <group ref={needleRef} position={[0, 0, 0.013]}>
          <mesh geometry={NEEDLE_GEO} material={NEEDLE_MAT} />
        </group>
      )}
    </group>
  );
}

// attitude indicator gets its own body: a rotating/panning horizon disc
// recessed behind the fixed aircraft-symbol bezel, instead of a needle
function AttitudeGauge({ x, y, discRef }: { x: number; y: number; discRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group position={[x, y, 0]}>
      <mesh material={BEZEL_MAT}>
        <cylinderGeometry args={[0.058, 0.058, 0.018, 16]} />
      </mesh>
      <group ref={discRef} position={[0, 0, 0.006]}>
        <mesh>
          <circleGeometry args={[0.075, 20]} />
          <meshStandardMaterial map={HORIZON_TEX} roughness={0.6} side={THREE.DoubleSide} />
        </mesh>
      </group>
      <mesh position={[0, 0, 0.013]}>
        <ringGeometry args={[0.046, 0.052, 20]} />
        <meshStandardMaterial map={ATTITUDE_BEZEL_TEX} roughness={0.6} side={THREE.DoubleSide} transparent />
      </mesh>
    </group>
  );
}

interface PlaneCockpitProps {
  fsRef: React.RefObject<FlightState>;
  altRef: React.RefObject<{ x: number; z: number; y: number }>;
}

export function PlaneCockpit({ fsRef, altRef }: PlaneCockpitProps) {
  const stickPivot = useRef<THREE.Group>(null);
  const airspeedNeedle = useRef<THREE.Group>(null);
  const altimeterNeedle = useRef<THREE.Group>(null);
  const rpmNeedle = useRef<THREE.Group>(null);
  const headingCard = useRef<THREE.Group>(null);
  const attitudeDisc = useRef<THREE.Group>(null);
  const throttleLever = useRef<THREE.Group>(null);

  useFrame(() => {
    const fs = fsRef.current;
    const alt = altRef.current;
    if (!fs || !alt) return;

    // stick: pitch input pulls it fore/aft (rotation.x), roll input leans it
    // side to side (rotation.z) — a visible, direct readout of fs.current's
    // live values, on top of whatever the whole cockpit inherits from the
    // aircraft body's own rotation as a parent transform.
    if (stickPivot.current) {
      stickPivot.current.rotation.x = fs.pitch * 1.8;
      stickPivot.current.rotation.z = -fs.roll * 0.9;
    }

    const speedKmh = Math.abs(fs.speed) * 3.6;
    if (airspeedNeedle.current) airspeedNeedle.current.rotation.z = -needleAngle(speedKmh / (PLANE_HANDLING.maxSpeed * 3.6));
    if (altimeterNeedle.current) altimeterNeedle.current.rotation.z = -needleAngle((alt.y % 100) / 100);
    // idle baseline + speed-scaled — no separate throttle value stored on
    // FlightState, forward airspeed is the cleanest available proxy for RPM
    const rpmT = 0.28 + (Math.abs(fs.speed) / PLANE_HANDLING.maxSpeed) * 0.68;
    if (rpmNeedle.current) rpmNeedle.current.rotation.z = -needleAngle(rpmT);
    if (headingCard.current) headingCard.current.rotation.z = fs.h;
    if (attitudeDisc.current) {
      attitudeDisc.current.rotation.z = -fs.roll;
      attitudeDisc.current.position.y = THREE.MathUtils.clamp(-fs.pitch * 0.15, -0.03, 0.03);
    }
    if (throttleLever.current) throttleLever.current.rotation.x = -0.15 - (Math.abs(fs.speed) / PLANE_HANDLING.maxSpeed) * 0.9;
  });

  return (
    <group>
      {/* small cabin under the canopy, out of direct sun — without a local
          fill the panel reads as a black silhouette against the windshield.
          Same fix as components/CarInterior.tsx's dome light. */}
      <pointLight position={[0, 0.75, 0.5]} intensity={1.4} distance={2.2} decay={2} color="#fff4e0" />
      {/* seat: base + tilted backrest + headrest, centred single seat */}
      <group position={[0, -0.15, 0.85]}>
        <mesh material={SEAT_MAT} castShadow>
          <boxGeometry args={[0.34, 0.08, 0.34]} />
        </mesh>
        <mesh position={[0, 0.2, -0.15]} rotation={[-0.15, 0, 0]} material={SEAT_MAT} castShadow>
          <boxGeometry args={[0.32, 0.42, 0.08]} />
        </mesh>
        <mesh position={[0, 0.44, -0.22]} rotation={[-0.15, 0, 0]} material={SEAT_MAT}>
          <boxGeometry args={[0.22, 0.12, 0.08]} />
        </mesh>
      </group>

      {/* cabin floor */}
      <mesh position={[0, -0.28, 1.0]} material={PANEL_MAT}>
        <boxGeometry args={[0.7, 0.03, 1.0]} />
      </mesh>

      {/* centre control stick — pivot at floor, grip tilts via useFrame */}
      <group position={[0, -0.2, 1.05]} ref={stickPivot}>
        <mesh position={[0, 0.13, 0]} material={STICK_MAT}>
          <cylinderGeometry args={[0.014, 0.018, 0.26, 8]} />
        </mesh>
        <mesh position={[0, 0.27, 0]} material={GRIP_MAT}>
          <cylinderGeometry args={[0.028, 0.024, 0.09, 8]} />
        </mesh>
        <mesh position={[0, 0.3, 0.03]} rotation={[Math.PI / 2, 0, 0]} material={GRIP_MAT}>
          <boxGeometry args={[0.05, 0.02, 0.02]} />
        </mesh>
      </group>

      {/* instrument panel: airspeed / attitude / altimeter / heading / RPM,
          five round gauges in a single row — period-correct for a small
          single-engine prop plane (an airliner-style six-pack is overkill here) */}
      <group position={[0, 0.14, 1.32]} rotation={[-0.12, 0, 0]}>
        <mesh material={PANEL_MAT} castShadow>
          <boxGeometry args={[0.58, 0.24, 0.05]} />
        </mesh>
        <Gauge x={-0.22} y={0} texture={AIRSPEED_TEX} needleRef={airspeedNeedle} />
        <AttitudeGauge x={-0.11} y={0} discRef={attitudeDisc} />
        <Gauge x={0} y={0} texture={ALTIMETER_TEX} needleRef={altimeterNeedle} />
        <group ref={headingCard}>
          <Gauge x={0.11} y={0} texture={HEADING_CARD_TEX} />
        </group>
        <Gauge x={0.22} y={0} texture={RPM_TEX} needleRef={rpmNeedle} />
      </group>

      {/* throttle quadrant: throttle (live, tied to fs.current.speed),
          mixture + carb heat static at their correctly-parked positions —
          a 3-lever quadrant is period-correct for this aircraft class */}
      <group position={[0.34, -0.02, 1.12]} rotation={[0, 0, -Math.PI / 2]}>
        <mesh material={LEVER_MAT}>
          <boxGeometry args={[0.14, 0.02, 0.09]} />
        </mesh>
        <group position={[-0.045, 0.01, 0]} ref={throttleLever}>
          <mesh position={[0, 0.05, 0]} material={LEVER_MAT}>
            <cylinderGeometry args={[0.006, 0.006, 0.1, 6]} />
          </mesh>
          <mesh position={[0, 0.1, 0]} material={KNOB_RED_MAT}>
            <sphereGeometry args={[0.014, 8, 6]} />
          </mesh>
        </group>
        <group position={[0, 0.01, 0]} rotation={[0, 0, -0.75]}>
          <mesh position={[0, 0.05, 0]} material={LEVER_MAT}>
            <cylinderGeometry args={[0.006, 0.006, 0.1, 6]} />
          </mesh>
          <mesh position={[0, 0.1, 0]} material={LEVER_MAT}>
            <sphereGeometry args={[0.013, 8, 6]} />
          </mesh>
        </group>
        <group position={[0.045, 0.01, 0]} rotation={[0, 0, 0.9]}>
          <mesh position={[0, 0.05, 0]} material={LEVER_MAT}>
            <cylinderGeometry args={[0.006, 0.006, 0.1, 6]} />
          </mesh>
          <mesh position={[0, 0.1, 0]} material={LEVER_MAT}>
            <sphereGeometry args={[0.013, 8, 6]} />
          </mesh>
        </group>
      </group>

      {/* windshield/canopy framing: centre post + two side A-pillars + a sill
          trim ring where the canopy bubble meets the fuselage tube, so the
          view reads as sitting inside a framed cabin, not open air */}
      <mesh position={[0, 0.5, 1.55]} material={FRAME_MAT} castShadow>
        <boxGeometry args={[0.02, 0.5, 0.03]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.34, 0.45, 0.95]} rotation={[0, 0, s * 0.55]} material={FRAME_MAT} castShadow>
          <boxGeometry args={[0.02, 0.55, 0.03]} />
        </mesh>
      ))}
      <mesh position={[0, 0.16, 1.15]} rotation={[-0.1, 0, 0]} material={FRAME_MAT}>
        <boxGeometry args={[0.86, 0.03, 0.04]} />
      </mesh>
    </group>
  );
}
