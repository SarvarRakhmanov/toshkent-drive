"use client";

import { useRef, useState } from "react";
import { RigidBody, CuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";
import { worldState } from "@/lib/worldState";
import { vehicleState } from "@/lib/vehicleState";
import { useHudStore } from "@/lib/hudStore";
import { useGfxStore } from "@/lib/gfx";
import { useWanted, BUST_SECS, ESCAPE_SECS } from "@/lib/wanted";
import { setSirenVolume } from "@/lib/siren";
import { signalFor } from "@/lib/trafficSignals";
import { junctionOk } from "@/components/TrafficSignals";
import { trafficPositions } from "@/components/Traffic";
import { crashHook } from "@/lib/debris";
import { PoliceCarMesh } from "@/components/PoliceCar";
import { RIDE_HEIGHT } from "@/components/SupercarBody";

// v1.8 police chases. Up to 3 Mustang interceptors (one per wanted star)
// spawn ~2 blocks away and hunt the player along the 100 m road grid
// (intersection-to-intersection, Manhattan pursuit), going straight for the
// car in the last 45 m. Stop next to them while a unit is on you -> BUSTED
// (full fine); stay 170 m+ away from every unit for 15 s -> ESCAPED (camera
// fine). Crimes (red lights, crashes, pedestrian hits) are detected here too.
const MAX_UNITS = 3;
const road = (v: number) => Math.round((v - 50) / 100) * 100 + 50;
const GROUND = new Set(["car", "bike", "jeep", "bus", "truck", "tank", "foot"]);

export const chaseUnits = Array.from({ length: MAX_UNITS }, () => ({ on: false, x: 0, z: -9999, h: 0, v: 0, wx: 0, wz: 0, px: 0, pz: 0 }));

function spawnUnit(u: (typeof chaseUnits)[number], k: number) {
  const ix = road(worldState.px), iz = road(worldState.pz);
  const back = -Math.sign(Math.cos(worldState.heading) || 1);
  const opts = [[ix, iz + back * 200], [ix + 200, iz], [ix - 200, iz], [ix, iz - back * 200]];
  const [x, z] = opts[k % opts.length];
  u.on = true; u.x = x; u.z = z; u.v = 0; u.h = Math.atan2(worldState.px - x, worldState.pz - z); u.wx = x; u.wz = z; u.px = x; u.pz = z;
}

function nextWaypoint(u: (typeof chaseUnits)[number]) {
  const tx = road(worldState.px), tz = road(worldState.pz);
  const ix = road(u.x), iz = road(u.z);
  let best: [number, number] = [ix, iz], bestD = Infinity;
  for (const [dx, dz] of [[100, 0], [-100, 0], [0, 100], [0, -100]]) {
    const nx = ix + dx, nz = iz + dz;
    if (nx === u.px && nz === u.pz) continue; // no U-turn back where we came from
    const d = Math.abs(nx - tx) + Math.abs(nz - tz);
    if (d < bestD) { bestD = d; best = [nx, nz]; }
  }
  u.px = ix; u.pz = iz; u.wx = best[0]; u.wz = best[1];
}

function ChaseUnit({ i }: { i: number }) {
  const body = useRef<RapierRigidBody>(null);
  const lightRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([null, null]);
  const low = useGfxStore((s) => s.quality) === "low";
  const g = useRef<THREE.Group>(null);
  const v3 = useRef(new THREE.Vector3());
  const q = useRef(new THREE.Quaternion());
  useFrame((state, dt) => {
    const u = chaseUnits[i];
    const b = body.current; if (!b || !g.current) return;
    g.current.visible = u.on;
    if (!u.on) { v3.current.set(i * 10, -60, -9000); b.setNextKinematicTranslation(v3.current); return; }
    const lv = useWanted.getState().level;
    const px = worldState.px, pz = worldState.pz;
    const dpx = px - u.x, dpz = pz - u.z, dp = Math.hypot(dpx, dpz);
    let tx: number, tz: number, stopAt = 0;
    if (dp < 45) { tx = px; tz = pz; stopAt = 5.5; }
    else {
      if (Math.hypot(u.wx - u.x, u.wz - u.z) < 3) nextWaypoint(u);
      tx = u.wx; tz = u.wz;
    }
    const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz) || 1;
    const vmax = Math.min(38, 22 + lv * 3) * (dp < 45 ? Math.max(dp > stopAt + 0.5 ? 0.15 : 0, Math.min(1, (dp - stopAt) / 10)) : d < 18 ? 0.55 : 1);
    u.v += Math.sign(vmax - u.v) * Math.min(Math.abs(vmax - u.v), (vmax > u.v ? 9 : 18) * dt);
    const step = Math.max(0, Math.min(d - stopAt, u.v * dt));
    const th = Math.atan2(dx, dz);
    let dh = th - u.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    u.h += dh * Math.min(1, dt * 6);
    u.x += (dx / d) * step; u.z += (dz / d) * step;
    // keep right of the road centre line when cruising the grid
    const off = dp < 45 ? 0 : 3;
    v3.current.set(u.x - Math.cos(u.h) * off, RIDE_HEIGHT, u.z + Math.sin(u.h) * off); // right of h = (-cos h, sin h)
    b.setNextKinematicTranslation(v3.current);
    b.setNextKinematicRotation(q.current.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, u.h));
    const red = Math.floor(state.clock.elapsedTime * 6 + i) % 2 === 0;
    if (lightRefs.current[0]) lightRefs.current[0].color.set(red ? "#ff2020" : "#200000");
    if (lightRefs.current[1]) lightRefs.current[1].color.set(red ? "#06081a" : "#2a50ff");
  });
  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[i * 10, -60, -9000]}>
      <CuboidCollider args={[0.95, 0.67, 2.4]} position={[0, 0.67 - RIDE_HEIGHT, 0]} />
      <group ref={g} name="police-chase" visible={false}><PoliceCarMesh lightRefs={lightRefs} detail={low ? "low" : "high"} /></group>
    </RigidBody>
  );
}

export function PoliceChase() {
  const last = useRef({ x: 0, z: 0, inside: false, init: false });
  const [units] = useState(() => Array.from({ length: MAX_UNITS }, (_, i) => i));
  crashHook.fn = (x, z) => {
    for (const t of trafficPositions) if (Math.hypot(t.x - x, t.z - z) < 7.5) { useWanted.getState().report("crash"); return; }
  };
  useFrame((_, dt) => {
    const W = useWanted.getState();
    const active = useHudStore.getState().active;
    const px = worldState.px, pz = worldState.pz;
    // --- crime: red light (entering a signalled junction box on red) ---
    const L = last.current;
    if (!L.init) { L.x = px; L.z = pz; L.init = true; }
    const ix = road(px), iz = road(pz);
    const inside = Math.abs(px - ix) < 10 && Math.abs(pz - iz) < 10;
    const mx = px - L.x, mz = pz - L.z, sp = Math.abs((vehicleState as Record<string, { speed?: number }>)[active]?.speed ?? 0);
    if (inside && !L.inside && active !== "foot" && GROUND.has(active) && sp > 4 && junctionOk(ix, iz)) {
      const axis = Math.abs(mx) > Math.abs(mz) ? "x" : "z";
      if (signalFor(axis) === 0) W.report("red");
    }
    L.inside = inside; L.x = px; L.z = pz;
    // --- chase units ---
    const want = Math.min(MAX_UNITS, W.level);
    for (let k = 0; k < MAX_UNITS; k++) {
      const u = chaseUnits[k];
      if (k < want && !u.on) spawnUnit(u, k);
      if (k >= want && u.on) u.on = false;
    }
    if (!W.level) { setSirenVolume(0); return; }
    let near = Infinity;
    for (const u of chaseUnits) if (u.on) near = Math.min(near, Math.hypot(u.x - px, u.z - pz));
    setSirenVolume(0.45 * Math.max(0, 1 - near / 260));
    const pv = Math.abs((vehicleState as Record<string, { speed?: number }>)[active]?.speed ?? 0);
    const onGround = GROUND.has(active);
    let bust = W.bust, evade = W.evade;
    if (near < 9.5 && (pv < 2.5 || active === "foot")) bust += dt; else bust = Math.max(0, bust - dt);
    if (near > 170 || !onGround) evade += dt * (onGround ? 1 : 2); else evade = Math.max(0, evade - dt * 2);
    if (bust >= BUST_SECS) { W.clear("busted"); for (const u of chaseUnits) u.on = false; return; }
    if (evade >= ESCAPE_SECS) { W.clear("escaped"); for (const u of chaseUnits) u.on = false; return; }
    useWanted.setState({ bust, evade });
  });
  return <group name="PoliceChase">{units.map((i) => <ChaseUnit key={i} i={i} />)}</group>;
}
