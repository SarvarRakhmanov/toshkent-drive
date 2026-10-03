"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { fireQueue } from "@/lib/tankShell";
import { spawnDebris } from "@/lib/debris";
import { vehicleState } from "@/lib/vehicleState";
import { requestCarDestroy } from "@/lib/vehicleDestroy";
import { requestPlayerTeleport } from "@/lib/playerTeleport";
import { groundYAt } from "@/lib/marina";
import { useHudStore, type VehicleKind } from "@/lib/hudStore";
import { trafficPositions, RESPAWN_DELAY } from "@/components/Traffic";

// Drains lib/tankShell.ts's fireQueue: a travelling shell per shot, real hit
// detection against the player's own car and every NPC traffic slot, and the
// aftermath VFX (explosion flash + a burning wreck that sits for a few
// seconds then vanishes). "Damaging a building" is scoped to a debris burst
// + explosion at the impact point (reusing components/Debris.tsx's existing
// pooled fragment system, already mounted in Game.tsx) rather than tracking
// per-building health — procedural chunk buildings have no id/health state
// to attach that to, and simulating structural collapse is a much bigger
// system than "the tank can fire and it looks like it did something."
//
// Same pooled/manually-integrated-physics idiom as components/Debris.tsx/
// NitroFX.tsx — disposable VFX, not real Rapier bodies.

const SHELL_COUNT = 6;
const EXPLOSION_COUNT = 6;
const WRECK_COUNT = 3;

const SHELL_SPEED = 85; // m/s
const SHELL_GRAVITY = -6; // gentle arc, not a ballistic drop
const MAX_RANGE = 140;
const MAX_LIFE = 3;
const HIT_RADIUS2 = 3.4 * 3.4;

// User's own numbers: "burns till it's black... after 2, 3, or maybe 5
// seconds, it disappears" — matches Car.tsx's BURN_DURATION for the
// player's own car; NPC traffic gets the same duration for the visible
// wreck even though the lane's own next-car timer (RESPAWN_DELAY) is longer.
const WRECK_DURATION = 4;

// Every player-owned vehicle is a valid shell target EXCEPT the tank itself —
// it's the thing doing the firing, and its own shell spawns from a barrel tip
// only ~8.5m ahead of the hull (components/Tank.tsx's BARREL_FORWARD), well
// inside HIT_RADIUS of its own centre on the frame after launch.
const SHELLABLE: VehicleKind[] = (Object.keys(vehicleState) as VehicleKind[]).filter((k) => k !== "tank");

const SHELL_MAT = new THREE.MeshBasicMaterial({ color: "#ffd76a" });
const EXPLOSION_MAT = new THREE.MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.85 });
const WRECK_BODY_MAT = new THREE.MeshStandardMaterial({ color: "#0c0c0c", roughness: 0.95 });
const FLAME_MAT = new THREE.MeshBasicMaterial({ color: "#ff7a1a", transparent: true, opacity: 0.9 });
const SMOKE_MAT = new THREE.MeshBasicMaterial({ color: "#3a3a3a", transparent: true, opacity: 0.5 });

interface Shell {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  traveled: number;
}

interface Explosion {
  active: boolean;
  t: number;
  x: number;
  y: number;
  z: number;
}

interface Wreck {
  active: boolean;
  t: number;
  x: number;
  y: number;
  z: number;
  h: number;
}

function makePool<T>(n: number, factory: () => T): T[] {
  return Array.from({ length: n }, factory);
}

export function TankCombat() {
  const shells = useRef<Shell[]>(
    makePool(SHELL_COUNT, () => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, traveled: 0 }))
  );
  const explosions = useRef<Explosion[]>(makePool(EXPLOSION_COUNT, () => ({ active: false, t: 0, x: 0, y: 0, z: 0 })));
  const wrecks = useRef<Wreck[]>(makePool(WRECK_COUNT, () => ({ active: false, t: 0, x: 0, y: 0, z: 0, h: 0 })));

  const shellRefs = useRef<(THREE.Mesh | null)[]>([]);
  const explosionRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wreckRefs = useRef<(THREE.Group | null)[]>([]);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const wreckLights = useRef<(THREE.PointLight | null)[]>([]);

  function spawnExplosion(x: number, y: number, z: number) {
    for (const e of explosions.current) {
      if (!e.active) {
        e.active = true;
        e.t = 0;
        e.x = x;
        e.y = y;
        e.z = z;
        return;
      }
    }
  }

  function spawnWreck(x: number, y: number, z: number, h: number) {
    for (const w of wrecks.current) {
      if (!w.active) {
        w.active = true;
        w.t = 0;
        w.x = x;
        w.y = y;
        w.z = z;
        w.h = h;
        return;
      }
    }
  }

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);

    // drain the fire queue into free shell slots
    while (fireQueue.length > 0) {
      const req = fireQueue.shift()!;
      const s = shells.current.find((c) => !c.active);
      if (!s) break;
      s.active = true;
      s.x = req.x;
      s.y = req.y;
      s.z = req.z;
      s.vx = req.dx * SHELL_SPEED;
      s.vy = 0;
      s.vz = req.dz * SHELL_SPEED;
      s.life = 0;
      s.traveled = 0;
    }

    // advance shells, hit-test, retire
    for (let i = 0; i < SHELL_COUNT; i++) {
      const s = shells.current[i];
      const mesh = shellRefs.current[i];
      if (!s.active) {
        if (mesh) mesh.visible = false;
        continue;
      }
      s.life += d;
      s.vy += SHELL_GRAVITY * d;
      const stepDist = Math.hypot(s.vx, s.vy, s.vz) * d;
      s.x += s.vx * d;
      s.y += s.vy * d;
      s.z += s.vz * d;
      s.traveled += stepDist;

      let hit = false;

      // Player-owned vehicles — including whichever one the player is
      // actually driving. This used to test vehicleState.car and nothing
      // else, so a player in the bike/police car/commercial vehicle/boat/
      // aircraft was immune to a direct hit.
      if (!hit) {
        for (const kind of SHELLABLE) {
          const v = vehicleState[kind];
          const dx = v.x - s.x;
          const dz = v.z - s.z;
          if (dx * dx + dz * dz >= HIT_RADIUS2) continue;
          hit = true;
          if (kind === "car") {
            // the full stop/burn/stash/respawn path: Car.tsx is still the
            // only component that consumes a destroy request (see
            // lib/vehicleDestroy.ts), and because it stashes the real body
            // far below the map, the burning-wreck actor can stand in for it
            // without the two overlapping.
            requestCarDestroy();
            spawnWreck(v.x, v.y ?? 0, v.z, v.h);
          } else if (useHudStore.getState().active === kind) {
            // No destroy plumbing for the other rigs yet, so the consequence
            // is being blown out of the seat rather than losing the vehicle.
            // Deliberately NO spawnWreck here: nothing moves the real body
            // out of the way, so a wreck actor would just render inside the
            // still-intact vehicle. The explosion flash below still fires.
            requestPlayerTeleport(v.x, v.z, v.h, groundYAt(v.x, v.z) + 1);
            useHudStore.getState().setActive("foot");
            useHudStore.getState().showMsg("BLOWN OUT OF THE VEHICLE");
          }
          break;
        }
      }

      // NPC traffic (civilian + police + the new base patrol lanes)
      if (!hit) {
        for (const slot of trafficPositions) {
          if (slot.stolen) continue; // already gone/being driven
          const dx = slot.x - s.x;
          const dz = slot.z - s.z;
          if (dx * dx + dz * dz < HIT_RADIUS2) {
            hit = true;
            slot.stolen = true;
            slot.respawnIn = RESPAWN_DELAY;
            spawnWreck(slot.x, 0, slot.z, slot.h);
            break;
          }
        }
      }

      if (hit) {
        spawnExplosion(s.x, s.y + 0.5, s.z);
        s.active = false;
        continue;
      }

      if (s.life > MAX_LIFE || s.traveled > MAX_RANGE || s.y < -5) {
        // didn't hit a vehicle — reads as a building/ground impact: a real
        // explosion + a debris burst (components/Debris.tsx's existing pool)
        // flying off whatever's actually there, without tracking which
        // specific building mesh got hit (see file-level comment).
        spawnExplosion(s.x, s.y, s.z);
        spawnDebris({ x: s.x, y: Math.max(0.3, s.y), z: s.z, dx: s.vx / SHELL_SPEED, dz: s.vz / SHELL_SPEED, power: 1 });
        s.active = false;
        continue;
      }

      if (mesh) {
        mesh.visible = true;
        mesh.position.set(s.x, s.y, s.z);
      }
    }

    // explosions: quick scale-up + fade
    for (let i = 0; i < EXPLOSION_COUNT; i++) {
      const e = explosions.current[i];
      const mesh = explosionRefs.current[i];
      if (!e.active) {
        if (mesh) mesh.visible = false;
        continue;
      }
      e.t += d;
      const life = 0.5;
      if (e.t > life) {
        e.active = false;
        if (mesh) mesh.visible = false;
        continue;
      }
      if (mesh) {
        mesh.visible = true;
        mesh.position.set(e.x, e.y, e.z);
        const k = e.t / life;
        mesh.scale.setScalar(0.6 + k * 4.5);
        (mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k);
      }
    }

    // burning wrecks: blackened silhouette + flickering flame + fading light,
    // for WRECK_DURATION, then gone
    for (let i = 0; i < WRECK_COUNT; i++) {
      const w = wrecks.current[i];
      const group = wreckRefs.current[i];
      const flame = flameRefs.current[i];
      const light = wreckLights.current[i];
      if (!w.active) {
        if (group) group.visible = false;
        if (light) light.intensity = 0;
        continue;
      }
      w.t += d;
      if (w.t > WRECK_DURATION) {
        w.active = false;
        if (group) group.visible = false;
        if (light) light.intensity = 0;
        continue;
      }
      if (group) {
        group.visible = true;
        group.position.set(w.x, w.y, w.z);
        group.rotation.y = w.h;
      }
      const flicker = 0.75 + Math.sin(state.clock.elapsedTime * 23 + i * 5) * 0.25;
      if (flame) flame.scale.setScalar(flicker);
      if (light) light.intensity = 2.2 * flicker * Math.min(1, (WRECK_DURATION - w.t) / 1.2);
    }
  });

  return (
    <>
      {Array.from({ length: SHELL_COUNT }).map((_, i) => (
        <mesh key={`s${i}`} ref={(el) => (shellRefs.current[i] = el)} visible={false} material={SHELL_MAT}>
          <sphereGeometry args={[0.22, 8, 8]} />
        </mesh>
      ))}
      {Array.from({ length: EXPLOSION_COUNT }).map((_, i) => (
        <mesh key={`x${i}`} ref={(el) => (explosionRefs.current[i] = el)} visible={false} material={EXPLOSION_MAT}>
          <sphereGeometry args={[0.6, 10, 10]} />
        </mesh>
      ))}
      {Array.from({ length: WRECK_COUNT }).map((_, i) => (
        <group key={`w${i}`} ref={(el) => (wreckRefs.current[i] = el)} visible={false}>
          <mesh position={[0, 0.55, 0]} material={WRECK_BODY_MAT} castShadow>
            <boxGeometry args={[1.85, 1.0, 4.4]} />
          </mesh>
          <mesh ref={(el) => (flameRefs.current[i] = el)} position={[0, 1.0, 0]} material={FLAME_MAT}>
            <coneGeometry args={[0.6, 1.4, 8]} />
          </mesh>
          <mesh position={[0, 1.8, 0]} material={SMOKE_MAT}>
            <sphereGeometry args={[0.7, 8, 8]} />
          </mesh>
          <pointLight ref={(el) => (wreckLights.current[i] = el)} position={[0, 1.2, 0]} color="#ff6a20" distance={12} />
        </group>
      ))}
    </>
  );
}
