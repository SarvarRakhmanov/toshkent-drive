"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { HELI_HANDLING, type FlightState } from "@/lib/flightPhysics";

// Cockpit interior for the drivable Helicopter (components/Helicopter.tsx),
// visible from camMode===1 (cockpit cam). Mounted as a sibling of HeliMesh
// inside Helicopter.tsx's own RigidBody, never inside HeliMesh itself —
// HeliMesh is also reused for the decorative parked choppers on
// components/Airport.tsx and components/MilitaryBase.tsx's aprons, which have
// no pilot and don't need any of this geometry.
//
// Eye position: lib/cameraRig.ts's camMode===1 branch resolves the world eye
// point as tx + dz*cockpitForward + dx*0.15 (etc) — working through the
// trig, that's local (x, z) = (cockpitForward, 0.15) off the vehicle origin,
// y = cockpitEyeHeight above it. Helicopter.tsx passes cockpitForward=0 (eye
// centered) and cockpitEyeHeight=0.32 for this rig, so every mesh below is
// laid out around local (0, 0.32, 0.15) as "where the pilot's head is".
//
// Own useFrame (separate from Helicopter.tsx's) mutates a handful of local
// refs per frame — cyclic tilt off fs.pitch/roll, collective angle off
// fs.vy, gauge needles off fs/pos — same "ref + useFrame, no React state"
// idiom as the rest of the vehicle rig.

const GAUGE_R = 0.085;
const SWEEP = (Math.PI * 4) / 3; // 240°, standard round-gauge needle travel
const START = -SWEEP / 2;

// module-level shared materials, same idiom as Helicopter.tsx's own
// BODY_MAT/TRIM_MAT/etc — kept local to this file (not imported from
// Helicopter.tsx) to avoid a circular import between the two.
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#1e2126", metalness: 0.75, roughness: 0.32 });
const CHROME_MAT = new THREE.MeshStandardMaterial({ color: "#c2c7d0", metalness: 0.95, roughness: 0.2 });
const GRIP_MAT = new THREE.MeshStandardMaterial({ color: "#181a1d", roughness: 0.85, metalness: 0.05 });
const BEZEL_MAT = new THREE.MeshStandardMaterial({ color: "#2a2d33", metalness: 0.3, roughness: 0.6 });
const BEZEL_MAT_OLIVE = new THREE.MeshStandardMaterial({ color: "#33361f", metalness: 0.25, roughness: 0.65 });
const PANEL_MAT = new THREE.MeshStandardMaterial({ color: "#1c1f24", metalness: 0.25, roughness: 0.7 });
const PANEL_MAT_OLIVE = new THREE.MeshStandardMaterial({ color: "#2c2f1f", metalness: 0.2, roughness: 0.75 });
const NEEDLE_MAT = new THREE.MeshBasicMaterial({ color: "#ff5a36" });
const REF_BAR_MAT = new THREE.MeshBasicMaterial({ color: "#ffcc00" });
const TICK_MAT = new THREE.MeshBasicMaterial({ color: "#e8ecf0" });

// needle geometry, pivoted at its base (translated up by half its own
// length) so a parent group's rotation.z swings the tip like a real needle
const NEEDLE_GEOM = new THREE.BoxGeometry(0.006, 0.065, 0.003);
NEEDLE_GEOM.translate(0, 0.0325, 0);

// gauge face textures — same canvas-bake-once-at-module-load idiom as
// lib/airportTextures.ts's tex()/noise(), NearestFilter to match this game's
// flat/low-poly look instead of photoreal antialiased dial art. This module
// touches `document` so, like lib/airportTextures.ts, it must only ever be
// pulled in client-side (the whole game already loads ssr:false).
function tex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

// generic numeric dial: dark face, 240° tick sweep, a handful of numbers,
// and a label — covers altimeter/airspeed/VSI/rotor-RPM, only the numbers
// and label differ per gauge.
function dialFace(s: number, label: string, numbers: string[]) {
  return tex(s, (g) => {
    const cx = s / 2, cy = s / 2, r = s / 2 - 2;
    g.fillStyle = "#0c0f13";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#cfd6de";
    g.lineWidth = Math.max(1, s / 64);
    const n = numbers.length - 1;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = START + t * SWEEP - Math.PI / 2;
      const x1 = cx + Math.cos(a) * r * 0.92, y1 = cy + Math.sin(a) * r * 0.92;
      const x2 = cx + Math.cos(a) * r * 0.78, y2 = cy + Math.sin(a) * r * 0.78;
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
    }
    g.fillStyle = "#e8ecf0";
    g.textAlign = "center";
    g.font = `${Math.round(s * 0.13)}px monospace`;
    numbers.forEach((num, i) => {
      const t = i / n;
      const a = START + t * SWEEP - Math.PI / 2;
      g.fillText(num, cx + Math.cos(a) * r * 0.58, cy + Math.sin(a) * r * 0.58 + 4);
    });
    g.font = `${Math.round(s * 0.11)}px monospace`;
    g.fillText(label, cx, cy + r * 0.4);
    g.fillStyle = "#3a3f47";
    g.beginPath();
    g.arc(cx, cy, r * 0.06, 0, Math.PI * 2);
    g.fill();
  });
}

const ALT_TEX = dialFace(128, "ALT M", ["0", "30", "60", "90", "120"]); // matches HELI_HANDLING.ceiling
const SPD_TEX = dialFace(128, "SPD KM/H", ["0", "20", "40", "60", "80"]); // maxSpeed 24m/s * 3.6
const VSI_TEX = dialFace(128, "VSI M/S", ["-7", "-3.5", "0", "3.5", "7"]); // ± HELI_HANDLING.climbRate
const RPM_TEX = dialFace(128, "ROTOR %", ["0", "25", "50", "75", "100"]);

// artificial-horizon moving ball: half sky / half ground + a horizon line
// and a couple of pitch-ladder rungs, baked once — the "instrument" motion
// is the disc rotating/translating in front of it (below), not this texture.
const SKY_GROUND_TEX = tex(128, (g, s) => {
  g.fillStyle = "#2f6fb0";
  g.fillRect(0, 0, s, s / 2);
  g.fillStyle = "#7a5230";
  g.fillRect(0, s / 2, s, s / 2);
  g.strokeStyle = "#e8ecf0";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, s / 2);
  g.lineTo(s, s / 2);
  g.stroke();
  g.strokeStyle = "rgba(232,236,240,.6)";
  g.lineWidth = 1;
  [-2, -1, 1, 2].forEach((i) => {
    const y = s / 2 - i * s * 0.09;
    g.beginPath();
    g.moveTo(s * 0.4, y);
    g.lineTo(s * 0.6, y);
    g.stroke();
  });
});

// one numeric dial: bezel ring + baked face + a needle pivoted on a ref, set
// each frame by the parent's own useFrame below
function Gauge({
  position,
  faceTex,
  pivotRef,
}: {
  position: [number, number, number];
  faceTex: THREE.Texture;
  pivotRef: React.RefObject<THREE.Group | null>;
}) {
  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      <mesh material={BEZEL_MAT}>
        <ringGeometry args={[GAUGE_R, GAUGE_R + 0.016, 24]} />
      </mesh>
      <mesh position={[0, 0, 0.006]}>
        <circleGeometry args={[GAUGE_R, 20]} />
        <meshBasicMaterial map={faceTex} />
      </mesh>
      <group ref={pivotRef} position={[0, 0, 0.012]}>
        <mesh geometry={NEEDLE_GEOM} material={NEEDLE_MAT} />
      </group>
    </group>
  );
}

// artificial horizon: same bezel-ring idea, but the "face" is a moving
// sky/ground disc (rotated by roll, translated by pitch each frame) behind a
// fixed yellow aircraft-reference bar, with 5 static roll-index ticks around
// the rim instead of a baked ring texture (cheaper, no extra ring UV bake).
function ArtificialHorizon({ position, discRef }: { position: [number, number, number]; discRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group position={position} rotation={[0, Math.PI, 0]}>
      <group ref={discRef} position={[0, 0, 0.01]}>
        <mesh>
          <circleGeometry args={[GAUGE_R + 0.06, 20]} />
          <meshBasicMaterial map={SKY_GROUND_TEX} />
        </mesh>
      </group>
      <mesh position={[0, 0, 0.016]} material={REF_BAR_MAT}>
        <boxGeometry args={[GAUGE_R * 1.15, 0.006, 0.002]} />
      </mesh>
      <mesh material={BEZEL_MAT}>
        <ringGeometry args={[GAUGE_R, GAUGE_R + 0.016, 24]} />
      </mesh>
      {[-60, -30, 0, 30, 60].map((deg) => {
        const a = ((deg - 90) * Math.PI) / 180;
        return (
          <mesh
            key={deg}
            position={[Math.cos(a) * (GAUGE_R + 0.02), Math.sin(a) * (GAUGE_R + 0.02), 0.02]}
            rotation={[0, 0, a + Math.PI / 2]}
            material={TICK_MAT}
          >
            <boxGeometry args={[0.004, 0.014, 0.003]} />
          </mesh>
        );
      })}
    </group>
  );
}

// straight strut between two local points — cylinder aligned + sized to
// span a-to-b, used for the bubble-canopy A-pillars/windshield bow. Static
// geometry computed at mount, not per-frame.
function Strut({ a, b, r = 0.02, mat = TRIM_MAT }: { a: [number, number, number]; b: [number, number, number]; r?: number; mat?: THREE.Material }) {
  const start = new THREE.Vector3(...a);
  const end = new THREE.Vector3(...b);
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const dir = end.clone().sub(start);
  const len = dir.length();
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return (
    <mesh position={mid.toArray()} quaternion={quat} material={mat} castShadow>
      <cylinderGeometry args={[r, r, len, 8]} />
    </mesh>
  );
}

export function HeliCockpit({
  kind,
  fs,
  pos,
}: {
  kind: VehicleKind;
  fs: React.RefObject<FlightState>;
  pos: React.RefObject<{ x: number; y: number; z: number }>;
}) {
  const olive = kind === "militaryHeli";
  const panelMat = olive ? PANEL_MAT_OLIVE : PANEL_MAT;

  const cyclicRef = useRef<THREE.Group>(null);
  const collectiveRef = useRef<THREE.Group>(null);
  const altPivot = useRef<THREE.Group>(null);
  const spdPivot = useRef<THREE.Group>(null);
  const vsiPivot = useRef<THREE.Group>(null);
  const rpmPivot = useRef<THREE.Group>(null);
  const ahDisc = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);

  useFrame(() => {
    const f = fs.current;
    const p = pos.current;
    const s = useHudStore.getState();
    const active = s.active === kind;
    // this file's own header comment claims "visible from camMode===1" but
    // nothing ever enforced it — Helicopter.tsx mounts this unconditionally,
    // so the whole dashboard/cyclic/gauge rig rendered in every camera mode,
    // including CHASE (visible sitting inside the cabin from outside). Same
    // gate CarInterior.tsx uses for the car's own cockpit.
    if (rootRef.current) rootRef.current.visible = active && s.camMode === 1;
    if (!active) return;

    // cyclic: tilts with the aircraft's live pitch/roll (fs.pitch/fs.roll,
    // stepped each frame by lib/flightPhysics.ts's stepFlight) — scaled up a
    // bit so the small cosmetic body tilt still reads as visible stick
    // motion, clamped so it never buries the grip past its own gaiter.
    if (cyclicRef.current) {
      cyclicRef.current.rotation.x = THREE.MathUtils.clamp(-f.pitch * 1.6, -0.45, 0.45);
      cyclicRef.current.rotation.z = THREE.MathUtils.clamp(f.roll * 1.6, -0.45, 0.45);
    }
    // collective: raised angle tracks vertical speed (fs.vy) around its
    // resting -0.15rad lean — climbing lifts it, descending drops it.
    if (collectiveRef.current) {
      collectiveRef.current.rotation.x = THREE.MathUtils.clamp(-f.vy / HELI_HANDLING.climbRate, -1, 1) * 0.35 - 0.15;
    }

    const needle = (ref: React.RefObject<THREE.Group | null>, norm: number) => {
      if (ref.current) ref.current.rotation.z = -(START + THREE.MathUtils.clamp(norm, 0, 1) * SWEEP);
    };
    needle(altPivot, p.y / HELI_HANDLING.ceiling);
    needle(spdPivot, (Math.abs(f.speed) * 3.6) / 80);
    needle(vsiPivot, (f.vy + HELI_HANDLING.climbRate) / (HELI_HANDLING.climbRate * 2));
    needle(rpmPivot, active ? 0.95 : 0.05);

    if (ahDisc.current) {
      ahDisc.current.rotation.z = f.roll;
      ahDisc.current.position.y = THREE.MathUtils.clamp(f.pitch * 0.3, -0.03, 0.03);
    }
  });

  return (
    <group ref={rootRef}>
      {/* under the canopy roof/frame, out of direct sun — without a local
          fill the panel reads as a black silhouette against the sky. Same
          fix as components/CarInterior.tsx's dome light. */}
      <pointLight position={[0, 0.85, 0.3]} intensity={1.3} distance={2} decay={2} color="#fff4e0" />
      {/* instrument panel + 5 gauges, facing the pilot at local (0, 0.32, 0.15) */}
      <mesh position={[0, 0.06, 0.5]} material={panelMat} castShadow>
        <boxGeometry args={[0.62, 0.32, 0.06]} />
      </mesh>
      <Gauge position={[-0.24, 0.16, 0.52]} faceTex={SPD_TEX} pivotRef={spdPivot} />
      <ArtificialHorizon position={[0, 0.16, 0.52]} discRef={ahDisc} />
      <Gauge position={[0.24, 0.16, 0.52]} faceTex={ALT_TEX} pivotRef={altPivot} />
      <Gauge position={[-0.13, -0.02, 0.52]} faceTex={VSI_TEX} pivotRef={vsiPivot} />
      <Gauge position={[0.13, -0.02, 0.52]} faceTex={RPM_TEX} pivotRef={rpmPivot} />

      {/* cyclic — single vertical stick + grip, between the pilot's knees */}
      <group ref={cyclicRef} position={[0, -0.5, 0.12]}>
        <mesh position={[0, -0.02, 0]} material={TRIM_MAT}>
          <cylinderGeometry args={[0.09, 0.11, 0.06, 10]} />
        </mesh>
        <mesh position={[0, 0.2, 0]} material={CHROME_MAT} castShadow>
          <cylinderGeometry args={[0.014, 0.02, 0.4, 8]} />
        </mesh>
        <mesh position={[0, 0.42, 0]} material={GRIP_MAT} castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.13, 8]} />
        </mesh>
      </group>

      {/* collective — lever to the pilot's left, twist-grip throttle at the end */}
      <group ref={collectiveRef} position={[0.42, -0.55, -0.05]} rotation={[0, 0, -1.0]}>
        <mesh position={[0, 0.28, 0]} material={TRIM_MAT} castShadow>
          <cylinderGeometry args={[0.02, 0.024, 0.56, 8]} />
        </mesh>
        <mesh position={[0, 0.58, 0]} rotation={[Math.PI / 2, 0, 0]} material={GRIP_MAT} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.16, 10]} />
        </mesh>
        <mesh position={[0, 0.58, 0]} rotation={[Math.PI / 2, 0, 0]} material={CHROME_MAT}>
          <torusGeometry args={[0.052, 0.008, 6, 12]} />
        </mesh>
      </group>

      {/* anti-torque pedals, floor level */}
      {[-0.13, 0.13].map((x) => (
        <mesh key={x} position={[x, -0.62, 0.38]} rotation={[-0.35, 0, 0]} material={TRIM_MAT} castShadow>
          <boxGeometry args={[0.12, 0.02, 0.16]} />
        </mesh>
      ))}

      {/* bubble-canopy framing: windshield bow (2-segment arc), a pair of
          A-pillars converging at its apex, and a seam ring where the glass
          bubble meets the cabin shell — reads as sitting inside a framed
          canopy instead of floating in open glass. The centered windshield
          bow doubles as the "two-seat" divider bonus (cheap: same strut). */}
      <Strut a={[0, 0.05, 1.3]} b={[0, 0.62, 0.85]} r={0.022} />
      <Strut a={[0, 0.62, 0.85]} b={[0, 0.28, 0.1]} r={0.022} />
      {[1, -1].map((s) => (
        <Strut key={s} a={[s * 0.5, 0.0, 0.65]} b={[s * 0.12, 0.6, 0.85]} r={0.018} />
      ))}
      <mesh position={[0, 0.04, 0.5]} rotation={[Math.PI / 2, 0, 0]} material={olive ? BEZEL_MAT_OLIVE : BEZEL_MAT} castShadow>
        <torusGeometry args={[0.72, 0.02, 8, 20]} />
      </mesh>
    </group>
  );
}
