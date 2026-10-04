"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
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

/** v2.1 perf: bake a static set piece's meshes into one mesh per material.
 *  Hand-built set pieces (Mizu mall + its parked cars) are hundreds of tiny
 *  meshes — the mall alone was ~420 draw calls on phone LOW, 3x the budget,
 *  whenever it was in view. Runs once after the loader finishes (programs are
 *  already compiled; the merged meshes reuse the SAME material objects, so
 *  night/emissive toggles keep working). Originals are hidden, not removed,
 *  so React/R3F still own them. Text, instanced, skinned and multi-material
 *  meshes are left alone. Only for subtrees with no per-frame animation. */
function lookKey(m: THREE.Material): string {
  const s = m as THREE.MeshPhysicalMaterial;
  const id = (t: THREE.Texture | null | undefined) => (t ? t.uuid : "-");
  return [m.type, s.color?.getHexString(), id(s.map), id(s.normalMap), id(s.roughnessMap), id(s.metalnessMap), id(s.aoMap), id(s.emissiveMap), id(s.alphaMap),
    s.emissive?.getHexString(), s.emissiveIntensity?.toFixed(2), s.metalness?.toFixed(2), s.roughness?.toFixed(2), s.clearcoat?.toFixed(2), s.envMapIntensity?.toFixed(2), s.flatShading,
    m.transparent, m.opacity.toFixed(2), m.side, m.alphaTest, m.depthWrite, m.depthTest, m.blending, m.toneMapped, (m as THREE.MeshBasicMaterial).fog, s.vertexColors].join("|");
}

/** byLook: also merge meshes whose (distinct) materials look identical — the
 *  first material of the group is used, so only for subtrees whose materials
 *  aren't animated individually (or whose animated ones look unique). */
export function MergeStatic({ name, children, byLook = false }: { name: string; children: ReactNode; byLook?: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const done = useRef(false);
  const readyAt = useRef(-1);
  useFrame((state) => {
    const root = ref.current;
    if (!root || done.current || !isReady()) return;
    if (readyAt.current < 0) { readyAt.current = state.clock.elapsedTime; return; }
    if (state.clock.elapsedTime - readyAt.current < 1) return; // let late Suspense children mount
    done.current = true;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const groups = new Map<THREE.Material | string, THREE.Mesh[]>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || Array.isArray(m.material) || !m.visible) return;
      if ((m as THREE.SkinnedMesh).isSkinnedMesh || (m as THREE.InstancedMesh).isInstancedMesh || m.morphTargetInfluences) return;
      if ((m.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return; // troika Text
      for (let p = m.parent; p && p !== root; p = p.parent) if (!p.visible || p.userData.noMerge) return;
      const key = byLook ? lookKey(m.material) : m.material;
      const list = groups.get(key) ?? [];
      list.push(m);
      groups.set(key, list);
    });
    const mtx = new THREE.Matrix4();
    let before = 0, after = 0;
    for (const list of groups.values()) {
      const material = list[0].material as THREE.Material;
      before += list.length;
      if (list.length < 2) { after += list.length; continue; }
      const names = ["position", "normal", "uv"].filter((a) => list.every((m) => m.geometry.getAttribute(a)));
      if (!names.includes("position")) { after += list.length; continue; }
      const geos = list.map((m) => {
        const g = new THREE.BufferGeometry();
        const src = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
        for (const n of names) {
          const a = src.getAttribute(n);
          const out = new Float32Array(a.count * a.itemSize);
          for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) out[i * a.itemSize + j] = a.getComponent(i, j);
          g.setAttribute(n, new THREE.BufferAttribute(out, a.itemSize));
        }
        if (src !== m.geometry) src.dispose();
        mtx.multiplyMatrices(inv, m.matrixWorld);
        g.applyMatrix4(mtx);
        if (mtx.determinant() < 0) {
          for (const n of names) {
            const a = g.getAttribute(n) as THREE.BufferAttribute, k = a.itemSize, arr = a.array as Float32Array;
            for (let i = 0; i < a.count; i += 3) for (let j = 0; j < k; j++) { const t = arr[(i + 1) * k + j]; arr[(i + 1) * k + j] = arr[(i + 2) * k + j]; arr[(i + 2) * k + j] = t; }
          }
        }
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) { after += list.length; continue; }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = `merged:${material.name || "mat"}`;
      mesh.castShadow = list.some((m) => m.castShadow);
      mesh.receiveShadow = list.some((m) => m.receiveShadow);
      mesh.renderOrder = list[0].renderOrder;
      list.forEach((m) => { m.visible = false; });
      root.add(mesh);
      after++;
    }
    root.userData.merge = { before, after };
  });
  return <group ref={ref} name={`${name}-merged`}>{children}</group>;
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

// One-way per page load (v1.5): AutoQuality only ever steps DOWN, and changes
// the quality TIER (a canvas remount) at most once; if the player puts HIGH
// back on afterwards it is left alone — no HIGH↔LOW ping-pong.
let tierDropsThisPage = 0;

/** Automatic quality drop: if the frame rate stays under ~30 FPS for ~6 s of
 *  play, HIGH first goes to safe HIGH (lower pixel ratio, no AO — no remount),
 *  then to LOW (once per page); on LOW the pixel ratio steps down (0.85, 0.7).
 *  Disabled with ?autoq=0 (benchmarks). */
export function AutoQuality() {
  const acc = useRef({ t: 0, n: 0, bad: 0, cooldown: 10 });
  const disabled = typeof window !== "undefined" && /[?&]autoq=0/.test(window.location.search);
  useFrame((_, dt) => {
    if (disabled || !isReady() || document.hidden) return;
    const a = acc.current;
    if (a.cooldown > 0) { a.cooldown -= Math.min(dt, 0.25); return; }
    a.t += dt; a.n++;
    if (a.t < 2) return;
    const fps = a.n / a.t;
    a.t = 0; a.n = 0;
    a.bad = fps < 30 ? a.bad + 1 : Math.max(0, a.bad - 1);
    if (a.bad < 3) return;
    a.bad = 0;
    a.cooldown = 10;
    const g = useGfxStore.getState();
    if (g.quality === "high" && !g.safe) {
      g.setSafe(true);
      useHudStore.getState().showMsg("GRAPHICS: HIGH (lighter, auto)");
    } else if (g.quality === "high" && tierDropsThisPage === 0) {
      tierDropsThisPage++;
      saveGame();
      g.setQuality("low");
      useHudStore.getState().showMsg("GRAPHICS: LOW (auto, for smoother play)");
    } else if (g.quality === "low" && g.dprScale > 0.72) {
      g.setDprScale(g.dprScale > 0.9 ? 0.85 : 0.7);
    }
  });
  return null;
}

/** Applies the store's pixel-ratio scale without remounting the Canvas. */
export function DprSync() {
  const setDpr = useThree((s) => s.setDpr);
  const dprScale = useGfxStore((s) => s.dprScale);
  const safe = useGfxStore((s) => s.safe);
  useEffect(() => {
    setDpr(currentProfile().dpr);
  }, [dprScale, safe, setDpr]);
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

/** v1.7b perf: three.js draws every transparent DoubleSide material twice
 *  (back faces, then front faces). Car glass, plates, foliage cards etc. made
 *  that ~20 hidden extra draw calls on phone LOW. Single-pass them (glass is
 *  thin, the sorting difference is invisible at game distances). Re-scans
 *  every 3 s for newly mounted content. */
export function SinglePassTransparent() {
  const next = useRef(0);
  useFrame((state) => {
    if (state.clock.elapsedTime < next.current) return;
    next.current = state.clock.elapsedTime + 3;
    state.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) if (mat && mat.transparent && mat.side === THREE.DoubleSide && !mat.forceSinglePass) mat.forceSinglePass = true;
    });
  }, 0, true);
  return null;
}
