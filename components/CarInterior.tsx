"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { tex } from "@/lib/airportTextures";
import { DEFAULT_HANDLING, type CarState } from "@/lib/carPhysics";
import { useHudStore } from "@/lib/hudStore";

// Player-car cockpit interior, mounted inside components/Car.tsx's own
// <RigidBody> so it moves/rotates with the chassis for free — same "child of
// the kinematic body" trick components/AirlinerCockpit.tsx already uses for
// the airliner's flight deck (module-level shared materials, canvas-baked
// instrument faces via lib/airportTextures.ts's tex(), live values wired
// through refs mutated in one useFrame — never React state).
//
// Placed only for components/Car.tsx (the player's own sedan) — Traffic.tsx/
// PoliceCar.tsx share components/SupercarBody.tsx directly and never mount
// this, so there is exactly one instance of this geometry live at a time.
//
// Anchored on lib/cameraRig.ts's camMode===1 (four-wheeler) branch:
//   ex = tx + cos(th)*cockpitForward + dx*cockpitAhead
//   ez = tz - sin(th)*cockpitForward + dz*cockpitAhead
//   ey = ty + cockpitEyeHeight
// tx/ty/tz is this RigidBody's own translation and th its heading, so in
// this component's own local frame (x=right, y=up, z=forward/nose — the
// same basis components/SupercarBody.tsx's meshes use) the driver's eye
// sits at local (cockpitForward, cockpitEyeHeight, cockpitAhead) using the
// CURRENT car defaults (1.3 / -0.35 / 0.15) — not importable (cameraRig.ts
// keeps them as inline defaults, and this task doesn't touch that file), so
// they're re-declared here as the placement anchor.
const EYE_X = -0.35;
const EYE_Y = 1.3;
const EYE_Z = 0.15;

const DASH_MAT = new THREE.MeshStandardMaterial({ color: "#1b1d22", roughness: 0.82 });
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: "#0d0f13", metalness: 0.45, roughness: 0.45 });
const LEATHER_MAT = new THREE.MeshStandardMaterial({ color: "#242024", roughness: 0.78 });
const HEADLINER_MAT = new THREE.MeshStandardMaterial({ color: "#2a2c30", roughness: 0.9 });
const CHROME_MAT = new THREE.MeshStandardMaterial({ color: "#c7ccd4", metalness: 0.95, roughness: 0.18 });
const WHEEL_RIM_MAT = new THREE.MeshStandardMaterial({ color: "#18181a", roughness: 0.7 });
const SWITCH_MAT = new THREE.MeshStandardMaterial({ color: "#3a3d44", roughness: 0.55 });
const MIRROR_MAT = new THREE.MeshStandardMaterial({ color: "#dfe6ee", metalness: 0.92, roughness: 0.06 });
const NEEDLE_MAT = new THREE.MeshBasicMaterial({ color: "#ff2b2b" });
const KNOB_MAT = new THREE.MeshStandardMaterial({ color: "#0e0f11", roughness: 0.4, metalness: 0.3 });

// warning-light cluster colours — battery/oil/engine/seatbelt/highbeam/fuel
const WARN_COLORS = ["#ff3b30", "#ff3b30", "#ffb020", "#ff3b30", "#3a8bff", "#ffb020"];
const WARN_MATS = WARN_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: c }));

// Classic 270° automotive gauge sweep: 0 at bottom-left (-135°), max at
// bottom-right (+135°), through the top at mid-scale. Shared by the needle's
// live rotation.z (below) and the tick placement baked into the gauge face
// texture, so the two can never drift out of alignment with each other.
function needleAngle(frac: number) {
  return THREE.MathUtils.degToRad(135 - THREE.MathUtils.clamp(frac, 0, 1) * 270);
}
function needlePoint(cx: number, cy: number, r: number, frac: number): [number, number] {
  const a = needleAngle(frac);
  return [cx - r * Math.sin(a), cy - r * Math.cos(a)];
}

// Gauge face — background, bezel, minor/major ticks, redline arc and the
// unit label — baked once to a canvas, same idiom as lib/airportTextures.ts's
// own tex()-based RUNWAY_TEX/FUSELAGE_TEX. The needle itself is a separate
// rotating mesh (below), not part of this texture.
function gaugeTex(size: number, max: number, majorStep: number, minorStep: number, redlineFrom: number, unit: string) {
  return tex(size, size, (g) => {
    const cx = size / 2, cy = size / 2, R = size / 2 - 6;
    g.fillStyle = "#0e1013";
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "#3a3d44";
    g.lineWidth = 5;
    g.stroke();

    // redline arc, swept in small steps rather than ctx.arc()'s start/end
    // angles so it always tracks needleAngle()'s own winding exactly
    g.beginPath();
    for (let i = 0; i <= 32; i++) {
      const frac = redlineFrom / max + (i / 32) * (1 - redlineFrom / max);
      const [x, y] = needlePoint(cx, cy, R - R * 0.09, frac);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.strokeStyle = "#c81f1f";
    g.lineWidth = R * 0.07;
    g.lineCap = "round";
    g.stroke();

    for (let v = 0; v <= max + 1e-6; v += minorStep) {
      const frac = v / max;
      const major = Math.abs(v % majorStep) < 1e-6;
      const [ix, iy] = needlePoint(cx, cy, R * 0.8, frac);
      const [ox, oy] = needlePoint(cx, cy, major ? R * 0.94 : R * 0.87, frac);
      g.strokeStyle = v >= redlineFrom ? "#ff6a5f" : "#cfd4dc";
      g.lineWidth = major ? 3 : 1.3;
      g.beginPath();
      g.moveTo(ix, iy);
      g.lineTo(ox, oy);
      g.stroke();
      if (major) {
        const [tx2, ty2] = needlePoint(cx, cy, R * 0.65, frac);
        g.fillStyle = "#e6e9ee";
        g.font = `${Math.round(R * 0.15)}px sans-serif`;
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(Math.round(v)), tx2, ty2);
      }
    }
    g.fillStyle = "#8a919c";
    g.font = `${Math.round(R * 0.13)}px sans-serif`;
    g.textAlign = "center";
    g.fillText(unit, cx, cy + R * 0.44);
  });
}

const SPEEDO_MAX = 220; // km/h — generous headroom over DEFAULT_HANDLING.max*3.6 (144) plus nitro
const SPEEDO_TEX = gaugeTex(256, SPEEDO_MAX, 20, 10, 180, "km/h");
const SPEEDO_MAT = new THREE.MeshBasicMaterial({ map: SPEEDO_TEX });
const TACH_MAX = 8; // x1000 rpm — no real engine model here, tach is speed-proportional (see useFrame below)
const TACH_TEX = gaugeTex(256, TACH_MAX, 1, 0.5, 6.5, "x1000 rpm");
const TACH_MAT = new THREE.MeshBasicMaterial({ map: TACH_TEX });

// One speaker grille — concentric rings + scattered perforations, same
// canvas-bake idiom as the gauges above, just simpler.
const GRILLE_TEX = tex(64, 64, (g) => {
  g.fillStyle = "#0c0d10";
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#232529";
  g.lineWidth = 1.4;
  for (let r = 6; r < 30; r += 6) {
    g.beginPath();
    g.arc(32, 32, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let i = 0; i < 50; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 29;
    g.fillStyle = "rgba(0,0,0,.55)";
    g.beginPath();
    g.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r, 1, 0, Math.PI * 2);
    g.fill();
  }
});
const GRILLE_MAT = new THREE.MeshBasicMaterial({ map: GRILLE_TEX });

// One dashboard vent — three angled slats over a dark recess.
function Vent({ x }: { x: number }) {
  return (
    <group position={[x, 1.14, 0.98]}>
      <mesh material={TRIM_MAT}>
        <boxGeometry args={[0.16, 0.07, 0.05]} />
      </mesh>
      {[-0.02, 0, 0.02].map((z) => (
        <mesh key={z} position={[0, 0.005, z]} rotation={[0.5, 0, 0]} material={SWITCH_MAT}>
          <boxGeometry args={[0.13, 0.01, 0.03]} />
        </mesh>
      ))}
    </group>
  );
}

// One instrument dial — face texture + hood + a live needle. frac() reads
// the current 0..1 value each frame; the needle mesh rotates in place, the
// face texture never changes.
function Dial({
  x,
  mat,
  needleRef,
}: {
  x: number;
  mat: THREE.MeshBasicMaterial;
  needleRef: React.RefObject<THREE.Mesh | null>;
}) {
  return (
    <group position={[x, 0, 0]}>
      {/* hood, shading the dial from wash-out */}
      <mesh position={[0, 0.02, -0.03]} material={TRIM_MAT}>
        <boxGeometry args={[0.22, 0.22, 0.06]} />
      </mesh>
      <mesh rotation={[0, Math.PI, 0]} material={mat}>
        <circleGeometry args={[0.095, 28]} />
      </mesh>
      <mesh ref={needleRef} position={[0, 0, 0.005]} material={NEEDLE_MAT}>
        <boxGeometry args={[0.006, 0.075, 0.003]} />
      </mesh>
      <mesh position={[0, 0, 0.008]} material={CHROME_MAT}>
        <cylinderGeometry args={[0.012, 0.012, 0.01, 10]} />
      </mesh>
    </group>
  );
}

const GAUGE_POS: [number, number, number] = [EYE_X, EYE_Y - 0.02, EYE_Z + 0.71];

function GaugeCluster({
  speedNeedle,
  tachNeedle,
}: {
  speedNeedle: React.RefObject<THREE.Mesh | null>;
  tachNeedle: React.RefObject<THREE.Mesh | null>;
}) {
  return (
    <group position={GAUGE_POS} rotation={[-0.25, Math.PI, 0]}>
      <mesh position={[0, 0, -0.02]} material={TRIM_MAT}>
        <boxGeometry args={[0.46, 0.24, 0.04]} />
      </mesh>
      <Dial x={-0.11} mat={SPEEDO_MAT} needleRef={speedNeedle} />
      <Dial x={0.11} mat={TACH_MAT} needleRef={tachNeedle} />
      {/* warning-light cluster, between the two dials */}
      {WARN_MATS.map((m, i) => (
        <mesh key={i} position={[-0.045 + (i % 3) * 0.045, 0.075 - Math.floor(i / 3) * 0.03, 0.001]} material={m}>
          <boxGeometry args={[0.018, 0.012, 0.002]} />
        </mesh>
      ))}
    </group>
  );
}

const WHEEL_POS: [number, number, number] = [EYE_X, EYE_Y - 0.35, EYE_Z + 0.47];
const WHEEL_TILT = 1.15; // column rake — top of the wheel leans away from the driver
const WHEEL_RADIUS = 0.17;
const SPOKE_ANGLES = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

function SteeringWheel({ wheelRef }: { wheelRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group position={WHEEL_POS}>
      {/* steering column, fixed */}
      <mesh position={[0, -0.28, -0.22]} rotation={[WHEEL_TILT, 0, 0]} material={TRIM_MAT}>
        <cylinderGeometry args={[0.035, 0.045, 0.5, 10]} />
      </mesh>
      {/* wheel itself — tilt is baked into this group's static rotation.x;
          rotation.z is the live steering angle, set every frame below. With
          three's default XYZ Euler order the z-spin below applies about the
          already-tilted local Z axis, i.e. the real column axis. */}
      <group ref={wheelRef} rotation={[WHEEL_TILT, 0, 0]}>
        <mesh material={WHEEL_RIM_MAT}>
          <torusGeometry args={[WHEEL_RADIUS, 0.02, 10, 26]} />
        </mesh>
        {SPOKE_ANGLES.map((a) => (
          <mesh key={a} rotation={[0, 0, a]} position={[Math.sin(a) * WHEEL_RADIUS * 0.5, Math.cos(a) * WHEEL_RADIUS * 0.5, 0]} material={CHROME_MAT}>
            <boxGeometry args={[0.03, WHEEL_RADIUS * 0.9, 0.025]} />
          </mesh>
        ))}
        <mesh material={TRIM_MAT}>
          <cylinderGeometry args={[0.04, 0.04, 0.05, 14]} />
        </mesh>
      </group>
    </group>
  );
}

// Centre console — gear shifter, a switch row and two cup holders, running
// back from the dash between the seats.
function CenterConsole() {
  return (
    <group position={[0.05, 0.72, 0.35]}>
      <mesh material={TRIM_MAT}>
        <boxGeometry args={[0.34, 0.14, 0.9]} />
      </mesh>
      {/* gear shifter */}
      <group position={[-0.04, 0.09, 0.18]}>
        <mesh material={CHROME_MAT}>
          <cylinderGeometry args={[0.012, 0.012, 0.16, 8]} />
        </mesh>
        <mesh position={[0, 0.1, 0]} material={KNOB_MAT}>
          <sphereGeometry args={[0.03, 12, 12]} />
        </mesh>
        <mesh position={[0, -0.07, 0]} material={TRIM_MAT}>
          <boxGeometry args={[0.1, 0.02, 0.16]} />
        </mesh>
      </group>
      {/* switch row */}
      {[-0.28, -0.14, 0, 0.14, 0.28].map((z, i) => (
        <mesh key={z} position={[0.08, 0.08, z]} material={i === 2 ? WARN_MATS[0] : SWITCH_MAT}>
          <boxGeometry args={[0.05, 0.02, 0.05]} />
        </mesh>
      ))}
      {/* cup holders */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.1, 0.075, -0.36]} rotation={[Math.PI / 2, 0, 0]} material={TRIM_MAT}>
          <torusGeometry args={[0.045, 0.008, 8, 16]} />
        </mesh>
      ))}
    </group>
  );
}

// A-pillars (windshield-to-header) + a simple roof header/window-frame band,
// so the glasshouse reads as a real cabin from inside rather than open air.
function PillarsAndFrame() {
  return (
    <group>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.6, 1.25, 0.82]} rotation={[0, 0, s * -0.55]} material={TRIM_MAT} castShadow>
          <boxGeometry args={[0.07, 0.85, 0.09]} />
        </mesh>
      ))}
      <mesh position={[0, 1.64, 0.55]} material={TRIM_MAT}>
        <boxGeometry args={[1.55, 0.08, 0.4]} />
      </mesh>
      {/* side window frame, driver door */}
      <mesh position={[-0.86, 1.35, 0.15]} material={TRIM_MAT}>
        <boxGeometry args={[0.04, 0.55, 0.9]} />
      </mesh>
    </group>
  );
}

// Headliner + folded sun visors.
function Headliner() {
  return (
    <group>
      <mesh position={[0, 1.66, 0.35]} material={HEADLINER_MAT}>
        <boxGeometry args={[1.5, 0.03, 1.15]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.4, 1.62, 0.85]} rotation={[0.1, 0, 0]} material={HEADLINER_MAT}>
          <boxGeometry args={[0.34, 0.02, 0.16]} />
        </mesh>
      ))}
    </group>
  );
}

// Driver door card: armrest, window switch, door pull/handle and a speaker
// grille — the side the cockpit camera actually sees.
function DoorPanel() {
  return (
    <group position={[-0.88, 1.0, 0.2]}>
      <mesh material={LEATHER_MAT}>
        <boxGeometry args={[0.05, 0.55, 0.85]} />
      </mesh>
      {/* armrest */}
      <mesh position={[0.02, -0.05, 0.05]} material={TRIM_MAT}>
        <boxGeometry args={[0.08, 0.06, 0.35]} />
      </mesh>
      {/* window switch */}
      <mesh position={[0.028, -0.05, 0.2]} material={SWITCH_MAT}>
        <boxGeometry args={[0.02, 0.015, 0.05]} />
      </mesh>
      {/* door pull/handle */}
      <mesh position={[0.03, 0.08, -0.05]} material={CHROME_MAT}>
        <boxGeometry args={[0.03, 0.03, 0.22]} />
      </mesh>
      {/* speaker grille */}
      <mesh position={[0.026, 0.22, 0.3]} rotation={[0, Math.PI / 2, 0]} material={GRILLE_MAT}>
        <circleGeometry args={[0.09, 20]} />
      </mesh>
    </group>
  );
}

// Rearview mirror — static housing (no render-to-texture reflection, out of
// scope per the task) hung off the header on a stalk.
function RearviewMirror() {
  return (
    <group position={[0, 1.6, 0.72]}>
      <mesh position={[0, -0.06, 0]} material={TRIM_MAT}>
        <cylinderGeometry args={[0.012, 0.012, 0.12, 8]} />
      </mesh>
      <mesh position={[0, -0.13, 0]} material={TRIM_MAT}>
        <boxGeometry args={[0.16, 0.045, 0.02]} />
      </mesh>
      <mesh position={[0, -0.13, 0.011]} material={MIRROR_MAT}>
        <planeGeometry args={[0.14, 0.035]} />
      </mesh>
    </group>
  );
}

export function CarInterior({ carRef }: { carRef: React.RefObject<CarState> }) {
  const group = useRef<THREE.Group>(null);
  const wheelRef = useRef<THREE.Group>(null);
  const speedNeedle = useRef<THREE.Mesh>(null);
  const tachNeedle = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    // only the cockpit camera ever sees this — same isActive gate
    // components/Car.tsx's own useFrame uses, plus camMode===1
    const s = useHudStore.getState();
    const visible = s.active === "car" && s.camMode === 1;
    g.visible = visible;
    if (!visible) return;

    const car = carRef.current;
    if (wheelRef.current) wheelRef.current.rotation.z = car.steerAng * 3.2;

    const kmh = Math.abs(car.speed) * 3.6;
    if (speedNeedle.current) speedNeedle.current.rotation.z = needleAngle(kmh / SPEEDO_MAX);

    // no real RPM model — tach reads proportional to speed against the
    // sedan's own top speed, same simplification the HUD's speedKmh already
    // leans on for anything downstream of stepCarPhysics
    const rpmFrac = 0.12 + Math.min(1, Math.abs(car.speed) / DEFAULT_HANDLING.max) * 0.82;
    if (tachNeedle.current) tachNeedle.current.rotation.z = needleAngle(rpmFrac);
  });

  return (
    <group ref={group}>
      {/* the cabin sits under the roof, out of direct sun — without a local
          fill it reads as a near-black silhouette against the bright exterior.
          Real cars solve this with a dome light + backlit gauges; this is the
          game equivalent, low enough not to wash out the dark trim. */}
      <pointLight position={[0, 1.5, 0.4]} intensity={2.2} distance={3.6} decay={2} color="#fff4e0" />
      <mesh position={[0, 1.1, 0.85]} material={DASH_MAT} castShadow>
        <boxGeometry args={[1.6, 0.2, 0.5]} />
      </mesh>
      <Vent x={-0.55} />
      <Vent x={0.55} />
      <GaugeCluster speedNeedle={speedNeedle} tachNeedle={tachNeedle} />
      <SteeringWheel wheelRef={wheelRef} />
      <CenterConsole />
      <PillarsAndFrame />
      <Headliner />
      <DoorPanel />
      <RearviewMirror />
    </group>
  );
}
