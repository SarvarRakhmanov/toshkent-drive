"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { getSunnyEnvMap } from "@/lib/skyEnv";
import { useFrame } from "@/lib/safeFrame";
import { isReady } from "@/lib/loadState";
import { useGfxStore, currentProfile } from "@/lib/gfx";
import { useHudStore } from "@/lib/hudStore";
import { saveGame } from "@/lib/saveGame";

const _box = new THREE.Box3();
const _tmp = new THREE.Box3();
const _cam = new THREE.Vector3();

/** Distance cull for a big static set piece (airport, military base, club…):
 *  hides the whole subtree once its bounds are beyond the camera's far plane,
 *  so the renderer doesn't walk/frustum-test thousands of far-away meshes.
 *  Physics is unaffected (colliders don't care about visibility). Bounds are
 *  measured from the meshes themselves, re-measured every few seconds. */
export function Cull({ name, children, margin = 30 }: { name: string; children: ReactNode; margin?: number }) {
  const ref = useRef<THREE.Group>(null);
  const bounds = useRef(new THREE.Box3());
  const nextMeasure = useRef(0);
  const tick = useRef(0);
  useFrame((state) => {
    const g = ref.current;
    if (!g) return;
    if (!isReady()) { g.visible = true; return; } // everything visible while shaders compile
    if (state.clock.elapsedTime > nextMeasure.current) {
      nextMeasure.current = state.clock.elapsedTime + 4;
      _box.makeEmpty();
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        if (!m.geometry.boundingBox) return;
        _tmp.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
        // ignore absurd helper geometry (e.g. 100 km water-boundary strips)
        if (_tmp.max.x - _tmp.min.x < 5000 && _tmp.max.z - _tmp.min.z < 5000) _box.union(_tmp);
      });
      bounds.current.copy(_box);
    }
    if ((tick.current++ & 7) !== 0) return; // visibility check at ~8 Hz
    if (bounds.current.isEmpty()) return;
    state.camera.getWorldPosition(_cam);
    const d = bounds.current.distanceToPoint(_cam);
    g.visible = d < (state.camera as THREE.PerspectiveCamera).far + margin;
  });
  return <group ref={ref} name={name}>{children}</group>;
}

/** Keeps camera.far just beyond the fog's far distance: anything past it is
 *  fully fogged (invisible) anyway, so it shouldn't cost a draw call. Also
 *  scales fog for the quality tier (shorter fog/draw distance on LOW). */
export function FogFarSync() {
  const { camera, scene } = useThree();
  const lastFar = useRef(0);
  useFrame(() => {
    const fog = scene.fog as THREE.Fog | null;
    const cam = camera as THREE.PerspectiveCamera;
    if (!fog || !("far" in fog)) return;
    const far = Math.round(fog.far + 40);
    if (Math.abs(far - lastFar.current) > 4) {
      lastFar.current = far;
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  });
  return null;
}

/** LOW tier image lighting: the tiny procedural sky PMREM from lib/skyEnv
 *  (no 1.4 MB HDR download/decode). Set at boot — not on the first sunny
 *  spell — so turning the env map on never recompiles every material mid-game. */
export function LowEnvironment() {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (!scene.environment) scene.environment = getSunnyEnvMap(gl);
  }, [gl, scene]);
  return null;
}

/** Automatic quality drop: if the frame rate stays under ~30 FPS for ~6 s of
 *  play, HIGH drops to LOW; on LOW the pixel ratio steps down (0.85, 0.7).
 *  Disabled with ?autoq=0 (benchmarks). */
export function AutoQuality() {
  const acc = useRef({ t: 0, n: 0, bad: 0, cooldown: 4 });
  const disabled = typeof window !== "undefined" && /[?&]autoq=0/.test(window.location.search);
  useFrame((_, dt) => {
    if (disabled || !isReady() || document.hidden) return;
    const a = acc.current;
    if (a.cooldown > 0) { a.cooldown -= dt; return; }
    a.t += dt; a.n++;
    if (a.t < 2) return;
    const fps = a.n / a.t;
    a.t = 0; a.n = 0;
    a.bad = fps < 30 ? a.bad + 1 : Math.max(0, a.bad - 1);
    if (a.bad < 3) return;
    a.bad = 0;
    a.cooldown = 8;
    const g = useGfxStore.getState();
    if (g.quality === "high") {
      saveGame();
      g.setQuality("low");
      useHudStore.getState().showMsg("GRAPHICS: LOW (auto, for smoother play)");
    } else if (g.dprScale > 0.72) {
      g.setDprScale(g.dprScale > 0.9 ? 0.85 : 0.7);
    }
  });
  return null;
}

/** Applies the store's pixel-ratio scale without remounting the Canvas. */
export function DprSync() {
  const setDpr = useThree((s) => s.setDpr);
  const dprScale = useGfxStore((s) => s.dprScale);
  useEffect(() => {
    setDpr(currentProfile().dpr);
  }, [dprScale, setDpr]);
  return null;
}

/** Exposes physics stats for the perf probe. */
export function PhysicsProbe() {
  const { world } = useRapier();
  useEffect(() => {
    (window as unknown as { __tdPhysicsStats: () => unknown }).__tdPhysicsStats = () => {
      let bodies = 0, fixed = 0, kinematic = 0, dynamic = 0, colliders = 0;
      world.forEachRigidBody((b) => {
        bodies++;
        if (b.isFixed()) fixed++; else if (b.isKinematic()) kinematic++; else dynamic++;
      });
      world.forEachCollider(() => { colliders++; });
      return { bodies, fixed, kinematic, dynamic, colliders };
    };
  }, [world]);
  return null;
}
