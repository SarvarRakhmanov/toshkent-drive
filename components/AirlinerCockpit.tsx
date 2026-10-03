"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { tex } from "@/lib/airportTextures";
import { AIRLINER_HANDLING, type FlightState } from "@/lib/flightPhysics";

// Flight-deck interior, mounted inside components/DrivableAirliner.tsx's own
// <RigidBody> so it moves/rotates with the airframe for free — same "child of
// the kinematic body" trick components/Airliner.tsx's own gear/engines use.
// Sits inside the nose bubble components/Airliner.tsx already builds (the
// tinted COCKPIT_MAT box at local [0, 1.35, 24.2], rotation.x 0.22): this
// component supplies the glass's frame/pillars plus everything behind it.
//
// Convention match: module-level shared materials/geometries (Airliner.tsx's
// SKIN_MAT-style consts), canvas-baked instrument faces via lib/
// airportTextures.ts's tex() (its own FUSELAGE_TEX/RUNWAY_TEX idiom), and
// live values wired through refs mutated in one useFrame — never React state
// — matching how the rest of this codebase animates per-frame.

const PANEL_MAT = new THREE.MeshStandardMaterial({ color: "#1b1d22", roughness: 0.65, metalness: 0.15 });
const GLARESHIELD_MAT = new THREE.MeshStandardMaterial({ color: "#111317", roughness: 0.75 });
const SEAT_MAT = new THREE.MeshStandardMaterial({ color: "#22262c", roughness: 0.85 });
const SEAT_CUSHION_MAT = new THREE.MeshStandardMaterial({ color: "#3a4048", roughness: 0.8 });
const PEDESTAL_MAT = new THREE.MeshStandardMaterial({ color: "#25282e", roughness: 0.6 });
const METAL_MAT = new THREE.MeshStandardMaterial({ color: "#9aa2ad", metalness: 0.75, roughness: 0.3 });
const YOKE_MAT = new THREE.MeshStandardMaterial({ color: "#15171b", roughness: 0.75 });
const SWITCH_MAT = new THREE.MeshStandardMaterial({ color: "#3a3f47", roughness: 0.6 });
const FLOOR_MAT = new THREE.MeshStandardMaterial({ color: "#0f1114", roughness: 0.9 });
const WIPER_MAT = new THREE.MeshStandardMaterial({ color: "#0c0d0f", roughness: 0.5, metalness: 0.4 });
const SIDE_GLASS_MAT = new THREE.MeshStandardMaterial({
  color: "#101a26",
  metalness: 0.7,
  roughness: 0.1,
  transparent: true,
  opacity: 0.65,
});
const SWITCH_ON_MAT = new THREE.MeshBasicMaterial({ color: "#28e07a" });
const SWITCH_WARN_MAT = new THREE.MeshBasicMaterial({ color: "#ff4433" });
const SKY_MAT = new THREE.MeshBasicMaterial({ color: "#3f86d6" });
const GROUND_MAT = new THREE.MeshBasicMaterial({ color: "#6b4a2c" });
const BUG_MAT = new THREE.MeshBasicMaterial({ color: "#ffb020" });
const NEEDLE_MAT = new THREE.MeshBasicMaterial({ color: "#f2f5f8" });
const THROTTLE_GRIP_MAT = new THREE.MeshStandardMaterial({ color: "#17181b", roughness: 0.7 });

// Instrument-face textures, baked once at module load — same idiom as
// lib/airportTextures.ts's own RUNWAY_TEX/FUSELAGE_TEX (tex() drawn once,
// shared by every material that wants it).
const PFD_BG_TEX = tex(128, 128, (g) => {
  g.fillStyle = "#04070c";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(255,255,255,.12)";
  g.lineWidth = 1;
  for (let i = 16; i < 128; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  g.strokeStyle = "#8fb8e0";
  g.lineWidth = 2;
  g.strokeRect(2, 2, 124, 124);
});

const SPEED_TAPE_MAX = 240; // km/h, generous headroom over AIRLINER_HANDLING.maxSpeed*3.6 (~223)
const ALT_TAPE_MAX = AIRLINER_HANDLING.ceiling; // 150m — matches this airframe's ceiling exactly

function tapeTex(max: number, step: number, label: number) {
  return tex(48, 256, (g) => {
    g.fillStyle = "#04070c";
    g.fillRect(0, 0, 48, 256);
    g.strokeStyle = "#c9d4de";
    g.fillStyle = "#c9d4de";
    g.font = "10px monospace";
    g.lineWidth = 1;
    for (let v = 0; v <= max; v += step) {
      const y = 256 - (v / max) * 256;
      g.beginPath();
      g.moveTo(v % label === 0 ? 24 : 32, y);
      g.lineTo(48, y);
      g.stroke();
      if (v % label === 0) g.fillText(String(v), 2, y + 3);
    }
    g.strokeStyle = "#5b6470";
    g.strokeRect(0, 0, 48, 256);
  });
}
const SPEED_TAPE_TEX = tapeTex(SPEED_TAPE_MAX, 20, 40);
const ALT_TAPE_TEX = tapeTex(ALT_TAPE_MAX, 10, 30);

const ND_BG_TEX = tex(128, 128, (g) => {
  g.fillStyle = "#03110a";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "#2fae6b";
  g.lineWidth = 1;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(64, 64, 38, 0, Math.PI * 2);
  g.stroke();
  for (let a = 0; a < 360; a += 30) {
    const rad = (a * Math.PI) / 180;
    const x1 = 64 + Math.sin(rad) * 50, y1 = 64 - Math.cos(rad) * 50;
    const x2 = 64 + Math.sin(rad) * 58, y2 = 64 - Math.cos(rad) * 58;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
  g.fillStyle = "#bfe8cf";
  g.font = "10px monospace";
  g.fillText("N", 60, 13);
  g.fillText("E", 119, 68);
  g.fillText("S", 60, 124);
  g.fillText("W", 5, 68);
});

const PFD_MAT = new THREE.MeshBasicMaterial({ map: PFD_BG_TEX });
const SPEED_TAPE_MAT = new THREE.MeshBasicMaterial({ map: SPEED_TAPE_TEX });
const ALT_TAPE_MAT = new THREE.MeshBasicMaterial({ map: ALT_TAPE_TEX });
const ND_MAT = new THREE.MeshBasicMaterial({ map: ND_BG_TEX });

// Overhead switch/circuit-breaker panel — mostly decorative rows of small
// switch meshes above the glareshield, a handful lit as if live.
const SWITCH_ROWS = 4;
const SWITCH_COLS = 9;
function OverheadPanel() {
  const items: { x: number; row: number }[] = [];
  for (let r = 0; r < SWITCH_ROWS; r++) for (let c = 0; c < SWITCH_COLS; c++) items.push({ x: (c - (SWITCH_COLS - 1) / 2) * 0.24, row: r });
  return (
    <group position={[0, 2.55, 21.6]} rotation={[0.55, 0, 0]}>
      <mesh material={PANEL_MAT}>
        <boxGeometry args={[2.4, 0.9, 0.12]} />
      </mesh>
      {items.map(({ x, row }, i) => {
        const y = 0.32 - row * 0.22;
        const lit = (i * 7) % 11 === 0;
        return (
          <group key={i} position={[x, y, 0.08]}>
            <mesh material={SWITCH_MAT}>
              <boxGeometry args={[0.1, 0.06, 0.05]} />
            </mesh>
            {lit && (
              <mesh position={[0, 0, 0.03]} material={i % 3 === 0 ? SWITCH_WARN_MAT : SWITCH_ON_MAT}>
                <boxGeometry args={[0.03, 0.03, 0.01]} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function Seat({ x }: { x: number }) {
  return (
    <group position={[x, 0.15, 20.8]}>
      <mesh position={[0, -0.15, 0]} material={SEAT_MAT} castShadow>
        <boxGeometry args={[0.62, 0.14, 0.62]} />
      </mesh>
      <mesh position={[0, 0.05, 0]} material={SEAT_CUSHION_MAT}>
        <boxGeometry args={[0.56, 0.1, 0.56]} />
      </mesh>
      <mesh position={[0, 0.55, -0.28]} rotation={[-0.15, 0, 0]} material={SEAT_MAT} castShadow>
        <boxGeometry args={[0.56, 1.0, 0.14]} />
      </mesh>
      <mesh position={[0, 1.1, -0.36]} rotation={[-0.15, 0, 0]} material={SEAT_CUSHION_MAT}>
        <boxGeometry args={[0.5, 0.3, 0.14]} />
      </mesh>
      {[1, -1].map((s) => (
        <mesh key={s} position={[s * 0.34, 0.15, -0.05]} material={SEAT_MAT}>
          <boxGeometry args={[0.06, 0.08, 0.4]} />
        </mesh>
      ))}
      {/* rail/pedestal the seat rides on */}
      <mesh position={[0, -0.35, 0]} material={METAL_MAT}>
        <boxGeometry args={[0.5, 0.16, 0.5]} />
      </mesh>
    </group>
  );
}

function Screen({ x, y, z, w, h, mat }: { x: number; y: number; z: number; w: number; h: number; mat: THREE.Material }) {
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 0, -0.02]} material={PANEL_MAT}>
        <boxGeometry args={[w + 0.05, h + 0.05, 0.04]} />
      </mesh>
      <mesh rotation={[0, Math.PI, 0]} material={mat}>
        <planeGeometry args={[w, h]} />
      </mesh>
    </group>
  );
}

function ThrottleQuadrant({ throttleRef }: { throttleRef: React.RefObject<THREE.Group | null> }) {
  const leverLen = 0.32;
  return (
    <group position={[0, 0.55, 21.3]}>
      <mesh material={PEDESTAL_MAT}>
        <boxGeometry args={[0.55, 0.7, 1.6]} />
      </mesh>
      <group ref={throttleRef} position={[0, 0.35, 0]}>
        {[-0.14, 0, 0.14].map((x, i) => (
          <group key={i} position={[x, 0, 0.2 - i * 0.02]}>
            <mesh position={[0, leverLen / 2, 0]} material={METAL_MAT}>
              <boxGeometry args={[0.04, leverLen, 0.03]} />
            </mesh>
            <mesh position={[0, leverLen, 0]} material={THROTTLE_GRIP_MAT}>
              <boxGeometry args={[0.09, 0.08, 0.06]} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

// One horn-and-column control column — a proper airliner yoke, not a car
// wheel: a vertical column topped with a wide flat crossbar and two forward-
// canted horn grips. columnRef tilts fore/aft (pitch), wheelRef rolls about
// the column axis (bank) — both driven per-frame from fs.current.
function Yoke({ x, columnRef, wheelRef }: { x: number; columnRef: React.RefObject<THREE.Group | null>; wheelRef: React.RefObject<THREE.Group | null> }) {
  return (
    <group position={[x, 0.35, 21.55]}>
      <group ref={columnRef}>
        <mesh position={[0, 0.28, 0]} material={YOKE_MAT}>
          <cylinderGeometry args={[0.035, 0.045, 0.56, 10]} />
        </mesh>
        <group ref={wheelRef} position={[0, 0.56, 0]}>
          <mesh material={YOKE_MAT}>
            <boxGeometry args={[0.4, 0.05, 0.05]} />
          </mesh>
          {[1, -1].map((s) => (
            <mesh key={s} position={[s * 0.2, 0.09, 0.06]} rotation={[0.9, 0, 0]} material={YOKE_MAT}>
              <boxGeometry args={[0.05, 0.2, 0.05]} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

function WindshieldFraming() {
  // pillars/sill sit right at the edges of components/Airliner.tsx's own
  // tinted glass box (local [0, 1.35, 24.2], rotation.x 0.22, size
  // [4.0, 1.5, 3.2]) so they read as its frame.
  return (
    <group position={[0, 1.35, 24.2]} rotation={[0.22, 0, 0]}>
      {[0, -2.0, 2.0].map((x) => (
        <mesh key={x} position={[x, 0, 0]} material={METAL_MAT}>
          <boxGeometry args={[0.12, 1.55, 0.14]} />
        </mesh>
      ))}
      <mesh position={[0, -0.72, 0]} material={METAL_MAT}>
        <boxGeometry args={[4.1, 0.14, 0.16]} />
      </mesh>
      {/* wipers, resting at the base of each pane */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 1.0, -0.68, 0.35]} rotation={[0, 0, s * -0.4]}>
          <mesh position={[0, 0.22, 0]} material={WIPER_MAT}>
            <boxGeometry args={[0.03, 0.44, 0.02]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function SideWindow({ side }: { side: 1 | -1 }) {
  return (
    <group position={[side * 2.95, 1.25, 20.2]} rotation={[0, side * 0.55, 0]}>
      <mesh material={METAL_MAT}>
        <boxGeometry args={[0.08, 0.85, 1.1]} />
      </mesh>
      <mesh position={[side * 0.05, 0, 0]} material={SIDE_GLASS_MAT}>
        <boxGeometry args={[0.03, 0.7, 0.95]} />
      </mesh>
      {/* A-pillar down to the windshield frame */}
      <mesh position={[side * -0.6, 0.1, -1.1]} rotation={[0, side * -0.3, 0]} material={METAL_MAT}>
        <boxGeometry args={[0.1, 0.12, 1.4]} />
      </mesh>
    </group>
  );
}

export function AirlinerCockpit({
  fs,
  pos,
}: {
  fs: React.RefObject<FlightState>;
  pos: React.RefObject<{ x: number; y: number; z: number }>;
}) {
  const columnCapt = useRef<THREE.Group>(null);
  const wheelCapt = useRef<THREE.Group>(null);
  const columnFo = useRef<THREE.Group>(null);
  const wheelFo = useRef<THREE.Group>(null);
  const attitudeBall = useRef<THREE.Group>(null);
  const speedBug = useRef<THREE.Mesh>(null);
  const altBug = useRef<THREE.Mesh>(null);
  const ndNeedle = useRef<THREE.Mesh>(null);
  const throttleGroup = useRef<THREE.Group>(null);

  useFrame(() => {
    const f = fs.current;
    if (!f) return;
    const pitchTilt = THREE.MathUtils.clamp(f.pitch * 2.2, -0.5, 0.5);
    const rollTilt = THREE.MathUtils.clamp(f.roll * 1.8, -0.9, 0.9);
    for (const col of [columnCapt.current, columnFo.current]) if (col) col.rotation.x = pitchTilt;
    for (const wheel of [wheelCapt.current, wheelFo.current]) if (wheel) wheel.rotation.z = -rollTilt;

    if (attitudeBall.current) {
      attitudeBall.current.rotation.z = -f.roll;
      attitudeBall.current.rotation.x = THREE.MathUtils.clamp(f.pitch, -0.6, 0.6);
    }

    const speedKmh = Math.abs(f.speed) * 3.6;
    if (speedBug.current) {
      const t = THREE.MathUtils.clamp(speedKmh / SPEED_TAPE_MAX, 0, 1);
      speedBug.current.position.y = -0.55 + t * 1.1;
    }
    const alt = pos.current.y;
    if (altBug.current) {
      const t = THREE.MathUtils.clamp(alt / ALT_TAPE_MAX, 0, 1);
      altBug.current.position.y = -0.55 + t * 1.1;
    }
    if (ndNeedle.current) ndNeedle.current.rotation.z = f.h;

    const throttleNorm = THREE.MathUtils.clamp(Math.abs(f.speed) / AIRLINER_HANDLING.maxSpeed, 0, 1);
    if (throttleGroup.current) throttleGroup.current.rotation.x = -0.15 + throttleNorm * 0.75;
  });

  return (
    <group>
      {/* flight deck sits deep in the fuselage, out of direct sun — without a
          local fill the panel/yokes read as a black silhouette against the
          windshield. Same fix as components/CarInterior.tsx's dome light. */}
      <pointLight position={[0, 0, 21]} intensity={3} distance={6} decay={2} color="#fff4e0" />
      <mesh position={[0, -1.1, 20]} material={FLOOR_MAT} receiveShadow>
        <boxGeometry args={[4.6, 0.1, 4]} />
      </mesh>

      <Seat x={-0.9} />
      <Seat x={0.9} />

      <Yoke x={-0.9} columnRef={columnCapt} wheelRef={wheelCapt} />
      <Yoke x={0.9} columnRef={columnFo} wheelRef={wheelFo} />

      <ThrottleQuadrant throttleRef={throttleGroup} />

      {/* main instrument panel + glareshield */}
      <mesh position={[0, 1.1, 22.55]} material={PANEL_MAT} castShadow>
        <boxGeometry args={[4.6, 1.0, 0.25]} />
      </mesh>
      <mesh position={[0, 1.75, 22.35]} rotation={[-0.3, 0, 0]} material={GLARESHIELD_MAT}>
        <boxGeometry args={[4.8, 0.15, 0.5]} />
      </mesh>

      {/* captain PFD (speed tape / attitude ball / alt tape) + ND */}
      <Screen x={-2.05} y={1.15} z={22.68} w={0.16} h={0.55} mat={SPEED_TAPE_MAT} />
      <Screen x={-1.7} y={1.15} z={22.68} w={0.5} h={0.55} mat={PFD_MAT} />
      <Screen x={-1.35} y={1.15} z={22.68} w={0.16} h={0.55} mat={ALT_TAPE_MAT} />
      <Screen x={-0.85} y={1.15} z={22.68} w={0.5} h={0.5} mat={ND_MAT} />

      {/* captain attitude ball + bugs, layered in front of the tape/PFD screens */}
      <group position={[-1.7, 1.15, 22.72]}>
        <group ref={attitudeBall}>
          <mesh position={[0, 0.06, 0]} material={SKY_MAT}>
            <circleGeometry args={[0.16, 20, 0, Math.PI]} />
          </mesh>
          <mesh position={[0, -0.06, 0]} rotation={[0, 0, Math.PI]} material={GROUND_MAT}>
            <circleGeometry args={[0.16, 20, 0, Math.PI]} />
          </mesh>
        </group>
        <mesh material={NEEDLE_MAT}>
          <ringGeometry args={[0.17, 0.2, 20]} />
        </mesh>
      </group>
      <mesh ref={speedBug} position={[-2.05, 1.15, 22.73]} material={BUG_MAT}>
        <boxGeometry args={[0.14, 0.03, 0.01]} />
      </mesh>
      <mesh ref={altBug} position={[-1.35, 1.15, 22.73]} material={BUG_MAT}>
        <boxGeometry args={[0.14, 0.03, 0.01]} />
      </mesh>
      <mesh ref={ndNeedle} position={[-0.85, 1.15, 22.73]} material={NEEDLE_MAT}>
        <coneGeometry args={[0.03, 0.14, 4]} />
      </mesh>

      {/* first-officer ND + PFD, mirrored */}
      <Screen x={0.85} y={1.15} z={22.68} w={0.5} h={0.5} mat={ND_MAT} />
      <Screen x={1.35} y={1.15} z={22.68} w={0.16} h={0.55} mat={SPEED_TAPE_MAT} />
      <Screen x={1.7} y={1.15} z={22.68} w={0.5} h={0.55} mat={PFD_MAT} />
      <Screen x={2.05} y={1.15} z={22.68} w={0.16} h={0.55} mat={ALT_TAPE_MAT} />

      <OverheadPanel />
      <WindshieldFraming />
      <SideWindow side={-1} />
      <SideWindow side={1} />
    </group>
  );
}
