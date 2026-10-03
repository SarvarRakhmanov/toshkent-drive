"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { vehicleState } from "@/lib/vehicleState";

// Reads whichever vehicle's live state off the same shared singletons
// AudioEngine.tsx uses (hudStore.nitroActive + vehicleState[vehicleKey]).
// Originally player-car only (index.html's specialAcc/lotSpecials idle-puff
// system is explicitly for OTHER parked cars, not the player — still not
// ported here) — every other nitro-capable ground vehicle (bike/policeCar/
// policeJeep/jeep/truck/bus/tank) boosted with zero visual effect at all,
// which is its own "not realistic" bug. Parametrized over vehicleKey/halfLen
// instead, one instance per vehicle (see Game.tsx), each with its own
// independent puff/flame ref state since that all lives in this component's
// own useRefs. Boats/aircraft still excluded — different exhaust language,
// same original scoping call.

// Wispy puff texture — several overlapping soft blobs instead of one perfect
// radial gradient, so a puff reads as an irregular cloud wisp rather than a
// uniform disc once it's scaled up over its lifetime. Same canvas-texture
// idiom as the original's exhaustTex (index.html ~6280), just with more
// baked-in shape detail.
const PUFF_TEX = (() => {
  if (typeof document === "undefined") return null; // SSR
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const blobs = [
    [32, 32, 30, 0.7],
    [20, 24, 16, 0.55],
    [44, 26, 15, 0.5],
    [26, 42, 17, 0.55],
    [40, 40, 14, 0.45],
  ] as const;
  for (const [bx, by, br, alpha] of blobs) {
    const r = g.createRadialGradient(bx, by, br * 0.1, bx, by, br);
    r.addColorStop(0, `rgba(58,60,68,${alpha})`);
    r.addColorStop(1, "rgba(58,60,68,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
})();

// Scaled up from the original 24 — a richer, denser trail now that puffs
// also vary in tint and spin instead of being 24 copies of one grey disc.
const PUFF_COUNT = 36;

type Puff = { life: number; max: number; vx: number; vy: number; vz: number; rot: number; rotSpeed: number };

const EXHAUST_OFFSET = 0.5; // original's exhaustWorld(v, 0.5) for nitro puffs
const BACKFIRE_OFFSET = 0.4; // original's exhaustWorld(v, 0.4) for the release pop

export function NitroFX({ vehicleKey, halfLen }: { vehicleKey: VehicleKind; halfLen: number }) {
  const puffRefs = useRef<(THREE.Sprite | null)[]>([]);
  // mutable per-frame simulation state, same "kept in a ref, never re-renders"
  // idiom as Car.tsx's car/nitroFuel/fallSpeed refs — not useMemo/useState,
  // this is aged and rewritten every frame, not derived render output
  const puffsRef = useRef<Puff[]>(
    Array.from({ length: PUFF_COUNT }, () => ({ life: 0, max: 1.3, vx: 0, vy: 0, vz: 0, rot: 0, rotSpeed: 0 }))
  );
  const spawnAcc = useRef(0);
  const wasActive = useRef(false);

  const rigRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const flameRefs = useRef<(THREE.Group | null)[]>([]);

  function spawn(x: number, y: number, z: number) {
    for (let i = 0; i < PUFF_COUNT; i++) {
      const p = puffsRef.current[i];
      if (p.life > 0) continue;
      p.max = 2.2;
      p.life = p.max;
      p.vx = (Math.random() - 0.5) * 0.5;
      p.vz = (Math.random() - 0.5) * 0.5;
      p.vy = 0.35 + Math.random() * 0.45;
      p.rot = Math.random() * Math.PI * 2;
      p.rotSpeed = (Math.random() - 0.5) * 1.6;
      const s = puffRefs.current[i];
      if (s) {
        s.visible = true;
        s.position.set(x, y, z);
        s.scale.set(0.35, 0.35, 1);
        s.material.rotation = p.rot;
        // tint variance — light exhaust vapour to darker soot, not 36 copies
        // of one uniform grey disc
        const tone = 0.55 + Math.random() * 0.55;
        s.material.color.setRGB(tone, tone, tone * 1.04);
      }
      return;
    }
  }

  useFrame((_state, dt) => {
    const hud = useHudStore.getState();
    // active === vehicleKey gate matches AudioEngine.tsx's exact same guard
    // against hudStore.nitroActive going stale after the player exits.
    const active = hud.active === vehicleKey && hud.nitroActive;
    const car = vehicleState[vehicleKey];

    for (let i = 0; i < PUFF_COUNT; i++) {
      const p = puffsRef.current[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      const s = puffRefs.current[i];
      if (p.life <= 0) {
        if (s) {
          s.visible = false;
          (s.material as THREE.SpriteMaterial).opacity = 0;
        }
        continue;
      }
      if (s) {
        s.position.x += p.vx * dt;
        s.position.y += p.vy * dt;
        s.position.z += p.vz * dt;
        p.vy *= Math.pow(0.7, dt);
        const t = 1 - p.life / p.max;
        const sc = 0.35 + t * 1.8;
        s.scale.set(sc, sc, 1);
        p.rot += p.rotSpeed * dt;
        s.material.rotation = p.rot;
        (s.material as THREE.SpriteMaterial).opacity = (p.life / p.max) * 0.5;
      }
    }

    const zBack = -halfLen - 0.5;
    if (active) {
      if (rigRef.current) {
        rigRef.current.visible = true;
        rigRef.current.position.set(car.x, 0, car.z);
        rigRef.current.rotation.y = car.h;
      }
      flameRefs.current.forEach((grp, i) => {
        if (!grp) return;
        grp.position.set(i === 0 ? -0.34 : 0.34, 0.36, zBack);
        const fl = 0.75 + Math.random() * 0.8;
        grp.scale.set(0.85 + Math.random() * 0.25, 0.85 + Math.random() * 0.25, fl);
      });
      if (lightRef.current) {
        lightRef.current.position.set(0, 0.4, zBack);
        lightRef.current.intensity = 1.6 + Math.random() * 0.9;
      }
      // one puff roughly every 0.04s while boosting, same cadence as the original
      spawnAcc.current += dt;
      while (spawnAcc.current > 0.04) {
        spawnAcc.current -= 0.04;
        const zB = -halfLen - EXHAUST_OFFSET;
        const ex = Math.random() < 0.5 ? -0.34 : 0.34;
        spawn(car.x + Math.sin(car.h) * zB + Math.cos(car.h) * ex, 0.4, car.z + Math.cos(car.h) * zB - Math.sin(car.h) * ex);
      }
    } else {
      if (rigRef.current) rigRef.current.visible = false;
      if (wasActive.current) {
        // one extra puff on release — mirrors the original's exhaustBackfire "pop"
        const zB = -halfLen - BACKFIRE_OFFSET;
        spawn(car.x + Math.sin(car.h) * zB, 0.4, car.z + Math.cos(car.h) * zB);
      }
    }
    wasActive.current = active;
  });

  return (
    <>
      {Array.from({ length: PUFF_COUNT }).map((_, i) => (
        <sprite
          key={i}
          ref={(el) => {
            puffRefs.current[i] = el;
          }}
          visible={false}
        >
          <spriteMaterial map={PUFF_TEX ?? undefined} transparent opacity={0} depthWrite={false} fog={false} toneMapped={false} />
        </sprite>
      ))}
      <group ref={rigRef} visible={false}>
        {[0, 1].map((i) => (
          <group
            key={i}
            ref={(el) => {
              flameRefs.current[i] = el;
            }}
          >
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.35]}>
              <coneGeometry args={[0.22, 1.6, 14]} />
              <meshBasicMaterial color="#ff5a12" transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.2]}>
              <coneGeometry args={[0.15, 1.15, 14]} />
              <meshBasicMaterial color="#ffb020" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.05]}>
              <coneGeometry args={[0.085, 0.75, 14]} />
              <meshBasicMaterial color="#aee0ff" transparent opacity={0.98} blending={THREE.AdditiveBlending} depthWrite={false} fog={false} toneMapped={false} />
            </mesh>
          </group>
        ))}
        <pointLight ref={lightRef} color="#ff7a2a" intensity={0} distance={13} decay={2} />
      </group>
    </>
  );
}
