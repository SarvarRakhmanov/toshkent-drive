"use client";

import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import * as THREE from "three";
import { useHudStore } from "@/lib/hudStore";
import { CLUB } from "@/lib/club";
import { computeHint } from "@/lib/hint";
import { PersonFigure } from "@/components/PersonFigure";
import { CLUB_WOOD_TEX as WOOD_TEX, CLUB_PANEL_TEX as PANEL_TEX } from "@/lib/clubTextures";

// VENU exterior — direct port of the original's clubGrp (body/trim/sign/door)
// plus a proper premium-club frontage: the building itself grew sideways and
// backward (the reserved footprint north of it, toward the spawn block, was
// already bare road/pavement per lib/club.ts's own comment, so there's room)
// while the FRONT face stays pinned at the same z the door/hint distance
// checks (lib/club.ts's DOOR_OUT) already assume — only the mass behind and
// beside it changed. Always mounted; owns the #hint line (via lib/hint.ts)
// since it's the only thing that needs to poll distance every frame
// regardless of active mode.
const FRONT_Z = 14; // local z of the front face — unchanged from the original 28-deep box's own front (28/2)
const HALF_W = 27; // was 19 — wider building
const DEPTH = 44; // was 28 — deeper building
const HEIGHT = 16; // was 14 — a bit more presence
const BODY_CENTER_Z = FRONT_Z - DEPTH / 2; // keeps the front face fixed while the box grows backward

const NO_ARM: RefObject<THREE.Mesh | null> = { current: null };

function Bouncer({ x }: { x: number }) {
  return (
    <group position={[x, 0, FRONT_Z + 1.4]} scale={1.35}>
      <PersonFigure legL={NO_ARM} legR={NO_ARM} armL={NO_ARM} armR={NO_ARM} jacketColor="#101014" pantsColor="#0c0c10" skinColor="#8a5a3a" />
    </group>
  );
}

// A short run of red-carpet stanchions — two posts + a sagging velvet rope,
// same low-poly cylinder+torus vocabulary the rest of the game already uses
// (e.g. PoliceStation.tsx's bollards).
function RopePost({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.08, 0.1, 1.0, 8]} />
        <meshStandardMaterial color="#caa53a" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[0, 1.05, 0]}>
        <sphereGeometry args={[0.12, 10, 10]} />
        <meshStandardMaterial color="#caa53a" metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
}

const ROPE_TEX = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 8;
  const g = c.getContext("2d")!;
  g.fillStyle = "#7a0f1f";
  g.fillRect(0, 0, 64, 8);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
})();

// A small potted tree/shrub — the greenery softening the base of the
// reference building's hard angular lines. Reused a few times along the steps.
function PottedPlant({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 0.28, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.26, 0.56, 10]} />
        <meshStandardMaterial color="#1c1c20" roughness={0.7} metalness={0.15} />
      </mesh>
      {[[0, 1.05, 0, 0.42], [0.18, 0.85, 0.1, 0.32], [-0.15, 0.9, -0.12, 0.3]].map(([bx, by, bz, r], i) => (
        <mesh key={i} position={[bx, by, bz]} castShadow>
          <sphereGeometry args={[r, 8, 8]} />
          <meshStandardMaterial color={i === 0 ? "#1f5a34" : "#276a3c"} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

// Painted parking-bay stripe — a thin white rectangle laid flat on the lot.
function Stripe({ x, z, len }: { x: number; z: number; len: number }) {
  return (
    <mesh position={[x, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.18, len]} />
      <meshStandardMaterial color="#e8e8ec" roughness={0.8} />
    </mesh>
  );
}

export function Club() {
  useFrame(() => {
    const hud = useHudStore.getState();
    const next = computeHint();
    if (hud.hint !== next) hud.setHint(next);
  });

  // parking lot: north of the carpet, back toward the spawn block — a dozen
  // marked bays along the near edge, close enough to read as "you'd actually
  // park here to go to VENU" without needing decorative parked cars of its own
  const LOT_Z0 = FRONT_Z + 16; // 30 — near edge, past the carpet run
  const LOT_Z1 = FRONT_Z + 30; // 44 — far edge
  const bayXs = [-22, -16.5, -11, -5.5, 5.5, 11, 16.5, 22];

  return (
    <group position={[CLUB.cx, 0, CLUB.cz]}>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[HALF_W, HEIGHT / 2, DEPTH / 2]} position={[0, HEIGHT / 2, BODY_CENTER_Z]} />
      </RigidBody>
      <mesh castShadow receiveShadow position={[0, HEIGHT / 2, BODY_CENTER_Z]}>
        <boxGeometry args={[HALF_W * 2, HEIGHT, DEPTH]} />
        <meshStandardMaterial map={PANEL_TEX ?? undefined} color={PANEL_TEX ? "#ffffff" : "#17121f"} roughness={0.55} metalness={0.25} />
      </mesh>
      <mesh position={[0, HEIGHT + 0.8, BODY_CENTER_Z]}>
        <boxGeometry args={[HALF_W * 2 + 0.4, 0.8, DEPTH + 0.4]} />
        <meshBasicMaterial color="#ff8a2a" />
      </mesh>
      <mesh position={[0, 1, BODY_CENTER_Z]}>
        <boxGeometry args={[HALF_W * 2 + 0.4, 0.8, DEPTH + 0.4]} />
        <meshBasicMaterial color="#ff8a2a" />
      </mesh>

      {/* ---- premium angular frontage: an asymmetric folded-shard roofline
          (two tilted dark planes meeting at a ridge, taller on the left,
          shallower on the right) with a warm amber soffit glow underneath —
          the same "folded matte-black metal, lit from below" language real
          architectural lounges use, in this game's low-poly vocabulary ---- */}
      <mesh position={[-12, 14.5, FRONT_Z + 3]} rotation={[0, 0, -0.375]} castShadow>
        <boxGeometry args={[30, 1, 9]} />
        <meshStandardMaterial map={PANEL_TEX ?? undefined} color={PANEL_TEX ? "#ffffff" : "#0b0b0e"} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[-12, 13.55, FRONT_Z + 6.2]} rotation={[Math.PI / 2 - 0.375, 0, 0]}>
        <planeGeometry args={[29, 3.2]} />
        <meshBasicMaterial map={WOOD_TEX ?? undefined} color={WOOD_TEX ? "#ffffff" : "#ff9a3a"} toneMapped={false} />
      </mesh>
      <mesh position={[15, 7.5, FRONT_Z + 2]} rotation={[0, 0, -0.125]} castShadow>
        <boxGeometry args={[24, 0.8, 7]} />
        <meshStandardMaterial map={PANEL_TEX ?? undefined} color={PANEL_TEX ? "#ffffff" : "#0b0b0e"} metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[15, 6.75, FRONT_Z + 4.6]} rotation={[Math.PI / 2 - 0.125, 0, 0]}>
        <planeGeometry args={[23, 2.4]} />
        <meshBasicMaterial map={WOOD_TEX ?? undefined} color={WOOD_TEX ? "#ffffff" : "#ff9a3a"} toneMapped={false} />
      </mesh>
      {/* the ridge post where the two shards meet */}
      <mesh position={[2, 11, FRONT_Z + 2]} castShadow>
        <boxGeometry args={[1, 20, 1]} />
        <meshStandardMaterial map={PANEL_TEX ?? undefined} color={PANEL_TEX ? "#ffffff" : "#0b0b0e"} metalness={0.65} roughness={0.35} />
      </mesh>
      {/* upward wall-wash accents along the base — ground-level warm point
          lights close enough to the facade to read as uplighting on the
          black panels, the dramatic dusk-lit look the reference photo uses */}
      {[-18, -6, 6, 18].map((x) => (
        <pointLight key={`wash${x}`} position={[x, 0.6, FRONT_Z + 1]} color="#ffb060" intensity={2.2} distance={11} decay={2} />
      ))}

      {/* full-width glass frontage instead of a plain door panel — a warm
          point light just inside sells a lit interior through the tint */}
      <mesh position={[0, 4, FRONT_Z + 0.15]}>
        <planeGeometry args={[30, 7.4]} />
        <meshStandardMaterial color="#0e1216" metalness={0.7} roughness={0.1} transparent opacity={0.72} />
      </mesh>
      {[-13, -7.5, -2.5, 2.5, 7.5, 13].map((x) => (
        <mesh key={`mullion${x}`} position={[x, 4, FRONT_Z + 0.2]}>
          <boxGeometry args={[0.08, 7.4, 0.08]} />
          <meshStandardMaterial color="#1a1a1e" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
      <pointLight color="#ffb060" intensity={3.5} distance={22} position={[0, 4.5, FRONT_Z - 1]} />

      {/* front steps, wide and shallow, descending from the (slightly
          elevated) glass entrance out to the carpet — widest and lowest at
          the bottom, so they read as stairs rather than a floating ledge */}
      {[0, 1, 2].map((i) => (
        <mesh key={`step${i}`} position={[0, 0.5 - i * 0.2, FRONT_Z + 0.6 + i * 0.75]} receiveShadow>
          <boxGeometry args={[14 + i * 2, 0.22, 1.5]} />
          <meshStandardMaterial color="#3a3a40" roughness={0.7} />
        </mesh>
      ))}

      <pointLight color="#ff3fd6" intensity={2} distance={60} position={[-8, 12, FRONT_Z + 6]} />
      <pointLight color="#ff9a3a" intensity={2.5} distance={40} position={[8, 8, FRONT_Z + 5]} />

      {/* two bouncers flanking the door */}
      <Bouncer x={-2.6} />
      <Bouncer x={2.6} />

      {/* potted greenery softening the base, either side of the steps —
          the planters the reference photo lines its entrance with */}
      <PottedPlant x={-9} z={FRONT_Z + 1.2} scale={1.3} />
      <PottedPlant x={9} z={FRONT_Z + 1.2} scale={1.3} />
      <PottedPlant x={-16} z={FRONT_Z + 0.4} scale={1.1} />
      <PottedPlant x={16} z={FRONT_Z + 0.4} scale={1.1} />

      {/* red carpet from the door out to the parking lot, roped off both sides */}
      <mesh position={[0, 0.015, FRONT_Z + 8]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4.4, 16]} />
        <meshStandardMaterial color="#8a0f1f" roughness={0.85} />
      </mesh>
      {[-2.6, 2.6].map((x) =>
        [FRONT_Z + 1, FRONT_Z + 6, FRONT_Z + 11, FRONT_Z + 15.5].map((z) => <RopePost key={`${x}-${z}`} x={x} z={z} />)
      )}
      {[-2.6, 2.6].map((x) => (
        <mesh key={`rope${x}`} position={[x, 1.02, FRONT_Z + 8.25]}>
          <boxGeometry args={[0.06, 0.06, 14.5]} />
          <meshBasicMaterial map={ROPE_TEX ?? undefined} color={ROPE_TEX ? undefined : "#7a0f1f"} />
        </mesh>
      ))}

      {/* parking lot: paved rectangle + painted bay stripes, sitting between
          the carpet and the open road toward spawn */}
      <mesh position={[0, 0.01, (LOT_Z0 + LOT_Z1) / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[52, LOT_Z1 - LOT_Z0]} />
        <meshStandardMaterial color="#26262c" roughness={0.95} />
      </mesh>
      {bayXs.map((x) => (
        <Stripe key={x} x={x} z={(LOT_Z0 + LOT_Z1) / 2} len={LOT_Z1 - LOT_Z0 - 2} />
      ))}
      <mesh position={[0, 0.02, LOT_Z1 - 1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[52, 0.2]} />
        <meshStandardMaterial color="#e8e8ec" roughness={0.8} />
      </mesh>
    </group>
  );
}
