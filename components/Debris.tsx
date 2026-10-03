"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { debrisQueue } from "@/lib/debris";

// Drains lib/debris.ts's debrisQueue and fires a handful of tumbling
// fragments per burst — this was the missing half of the crash-debris
// system: Car.tsx/PoliceCar.tsx/CommercialVehicle.tsx/components/Traffic.tsx
// have all been calling spawnDebris()/checkCrashDebris() since Milestone 2,
// but nothing ever read debrisQueue back out, so every "crash" was silent.
// Same pooled/manually-integrated-physics idiom as components/NitroFX.tsx's
// puffs (and Pedestrians.tsx's ragdoll) rather than real Rapier bodies —
// disposable one-shot VFX, not something the physics world needs to know about.

const FRAGMENT_COUNT = 28;
const GRAVITY = -18;
const MAT = new THREE.MeshStandardMaterial({ color: "#3a3a3e", roughness: 0.7, metalness: 0.3 });
const SPARK_MAT = new THREE.MeshBasicMaterial({ color: "#ffb020" });

interface Fragment {
  life: number;
  max: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  spin: number;
  size: number;
}

export function Debris() {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([]);
  const fragsRef = useRef<Fragment[]>(
    Array.from({ length: FRAGMENT_COUNT }, () => ({
      life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, spin: 0, size: 0.18,
    }))
  );

  useFrame((_state, dt) => {
    const d = Math.min(dt, 0.05);

    // drain the queue — a handful of fragments per burst, more for a harder hit
    while (debrisQueue.length > 0) {
      const b = debrisQueue.shift()!;
      const count = 3 + Math.round(b.power * 4);
      for (let n = 0; n < count; n++) {
        // find a free slot; if the pool's full just drop the rest of this burst
        let f: Fragment | null = null;
        for (const cand of fragsRef.current) {
          if (cand.life <= 0) {
            f = cand;
            break;
          }
        }
        if (!f) break;
        const spread = 0.9;
        const outX = b.dx + (Math.random() - 0.5) * spread;
        const outZ = b.dz + (Math.random() - 0.5) * spread;
        const speed = (2 + Math.random() * 3) * (0.5 + b.power);
        f.life = f.max = 0.7 + Math.random() * 0.6;
        f.x = b.x;
        f.y = b.y;
        f.z = b.z;
        f.vx = outX * speed;
        f.vy = 1.5 + Math.random() * 3 * b.power;
        f.vz = outZ * speed;
        f.rx = Math.random() * Math.PI;
        f.ry = Math.random() * Math.PI;
        f.rz = Math.random() * Math.PI;
        f.spin = (Math.random() - 0.5) * 14;
        f.size = 0.12 + Math.random() * 0.16;
      }
    }

    for (let i = 0; i < FRAGMENT_COUNT; i++) {
      const f = fragsRef.current[i];
      const mesh = meshRefs.current[i];
      if (f.life <= 0) {
        if (mesh) mesh.visible = false;
        continue;
      }
      f.life -= d;
      f.vy += GRAVITY * d;
      f.x += f.vx * d;
      f.y += f.vy * d;
      f.z += f.vz * d;
      if (f.y < 0.05) {
        f.y = 0.05;
        f.vy *= -0.3; // one soft bounce off the tarmac
        f.vx *= 0.7;
        f.vz *= 0.7;
      }
      f.rx += f.spin * d;
      f.ry += f.spin * 0.7 * d;
      if (mesh) {
        mesh.visible = true;
        mesh.position.set(f.x, f.y, f.z);
        mesh.rotation.set(f.rx, f.ry, f.rz);
        const t = f.life / f.max;
        mesh.scale.setScalar(f.size * t);
      }
    }
  });

  return (
    <>
      {Array.from({ length: FRAGMENT_COUNT }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          visible={false}
          material={i % 3 === 0 ? SPARK_MAT : MAT}
        >
          <boxGeometry args={[1, 1, 1]} />
        </mesh>
      ))}
    </>
  );
}
