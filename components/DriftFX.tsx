"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { vehicleState } from "@/lib/vehicleState";
import { weatherState } from "@/lib/weatherState";

// Tire smoke on a hard slide/handbrake turn — nothing produced any smoke
// during a drift or donut before this (grep for "drift"/"skid" across the
// vehicle components turned up nothing but a comment). Single instance,
// not one per vehicle like NitroFX.tsx — only the one currently-active
// ground vehicle can ever be sliding, so this just follows hud.active and
// reads vLat off whichever vehicleState entry that names, rather than
// needing its own gate+rig per vehicle kind.
const DRIFT_KINDS = new Set<VehicleKind>(["car", "bike", "policeCar", "policeJeep", "jeep", "truck", "bus", "tank"]);
// approximate half-length/half-width per kind, just for placing the puff
// pair behind the rear axle — see each vehicle's own carBox/bikeBox/tankBox
// (NitroFX's mount in Game.tsx uses the same half-lengths for its exhaust)
const DIMS: Record<string, { halfLen: number; halfW: number }> = {
  car: { halfLen: 2.3, halfW: 0.85 },
  bike: { halfLen: 0.95, halfW: 0.05 },
  policeCar: { halfLen: 2.4, halfW: 0.85 },
  policeJeep: { halfLen: 2.2, halfW: 0.9 },
  jeep: { halfLen: 1.8, halfW: 0.9 },
  truck: { halfLen: 2.8, halfW: 1.0 },
  bus: { halfLen: 3.25, halfW: 1.05 },
  tank: { halfLen: 4.76, halfW: 1.4 },
};

// same grey wisp texture idiom as NitroFX.tsx's PUFF_TEX, lighter/dustier tint
const PUFF_TEX = (() => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const blobs = [
    [32, 32, 28, 0.55],
    [22, 26, 15, 0.4],
    [42, 24, 14, 0.4],
    [26, 40, 16, 0.42],
  ] as const;
  for (const [bx, by, br, alpha] of blobs) {
    const r = g.createRadialGradient(bx, by, br * 0.1, bx, by, br);
    r.addColorStop(0, `rgba(200,198,192,${alpha})`);
    r.addColorStop(1, "rgba(200,198,192,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
})();

const PUFF_COUNT = 28;
const SLIP_THRESHOLD = 2.5; // m/s of lateral velocity before it reads as a real slide, not just grip settling

type Puff = { life: number; max: number; vx: number; vy: number; vz: number; rot: number; rotSpeed: number };

export function DriftFX() {
  const puffRefs = useRef<(THREE.Sprite | null)[]>([]);
  const puffsRef = useRef<Puff[]>(
    Array.from({ length: PUFF_COUNT }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, rot: 0, rotSpeed: 0 }))
  );
  const spawnAcc = useRef(0);

  function spawn(x: number, y: number, z: number) {
    for (let i = 0; i < PUFF_COUNT; i++) {
      const p = puffsRef.current[i];
      if (p.life > 0) continue;
      p.max = 1.1;
      p.life = p.max;
      p.vx = (Math.random() - 0.5) * 0.4;
      p.vz = (Math.random() - 0.5) * 0.4;
      p.vy = 0.15 + Math.random() * 0.2;
      p.rot = Math.random() * Math.PI * 2;
      p.rotSpeed = (Math.random() - 0.5) * 1.2;
      const s = puffRefs.current[i];
      if (s) {
        s.visible = true;
        s.position.set(x, y, z);
        s.scale.set(0.3, 0.3, 1);
        s.material.rotation = p.rot;
        const tone = 0.7 + Math.random() * 0.3;
        s.material.color.setRGB(tone, tone, tone);
      }
      return;
    }
  }

  useFrame((_state, dt) => {
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
        const t = 1 - p.life / p.max;
        const sc = 0.3 + t * 1.6;
        s.scale.set(sc, sc, 1);
        p.rot += p.rotSpeed * dt;
        s.material.rotation = p.rot;
        (s.material as THREE.SpriteMaterial).opacity = (p.life / p.max) * 0.4;
      }
    }

    const hud = useHudStore.getState();
    const kind = hud.active;
    if (kind === "foot" || !DRIFT_KINDS.has(kind)) return;
    const v = vehicleState[kind];
    const slip = Math.abs(v.vLat ?? 0);
    // weather-aware boost on top of the existing slip trigger: less traction
    // (carPhysics.ts's wetGrip) should read as looser tires kicking up smoke
    // sooner and more often, giving the rain/snow traction-loss fix above a
    // visible cue. wetGrip is 1 dry (boost=1, no-op) down to 0.5 rain / 0.3
    // snow (weatherState.ts), so this stays a no-op in clear/sunny/overcast/fog.
    const weatherBoost = THREE.MathUtils.clamp(2 - weatherState.wetGrip, 1, 1.7); // 1 dry, ~1.5 rain, ~1.7 snow
    if (slip < SLIP_THRESHOLD / weatherBoost) return;

    const dims = DIMS[kind] ?? { halfLen: 2, halfW: 0.85 };
    const rate = THREE.MathUtils.clamp((0.09 - slip * 0.004) / weatherBoost, 0.02, 0.09);
    spawnAcc.current += dt;
    while (spawnAcc.current > rate) {
      spawnAcc.current -= rate;
      const zB = -dims.halfLen + 0.3; // just ahead of the rear bumper, at the rear wheels
      for (const ex of [-dims.halfW, dims.halfW]) {
        const wx = v.x + Math.sin(v.h) * zB + Math.cos(v.h) * ex;
        const wz = v.z + Math.cos(v.h) * zB - Math.sin(v.h) * ex;
        spawn(wx, (v.y ?? 0) + 0.15, wz);
      }
    }
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
    </>
  );
}
