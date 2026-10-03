"use client";

// Robot characters (v1.4) — the on-foot player ("The Big Boss") and the
// pedestrian robots (EveBatStudios "Robot downloads" collection). All CC BY,
// see CREDITS.md. The GLBs are pre-baked by scripts/optimize-robots.mjs into a
// single static pose (skins/animations dropped — none of them are animated
// in-game), so every robot is a handful of plain meshes that can be
// instanced; motion is procedural (bob / sway / lean) on the parent group.

import * as THREE from "three";
import { useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame } from "@/lib/safeFrame";
import { asset } from "@/lib/asset";

export const PLAYER_ROBOT = { url: "/models/robots/big-boss.glb", height: 1.85, yaw: 0 };

// yaw = extra rotation so the model faces local +Z (the game's "forward")
export const NPC_ROBOTS = [
  { id: "militor", url: "/models/robots/npc-militor.glb", height: 1.75, yaw: 0 },
  { id: "mini-bot", url: "/models/robots/npc-mini-bot.glb", height: 1.7, yaw: 0 },
  { id: "checkered-guard", url: "/models/robots/npc-checkered-guard.glb", height: 1.85, yaw: 0 },
  { id: "ww1", url: "/models/robots/npc-ww1.glb", height: 1.8, yaw: Math.PI / 2 },
  { id: "biped", url: "/models/robots/npc-biped.glb", height: 1.8, yaw: 0 },
  { id: "bumstrum", url: "/models/robots/npc-bumstrum.glb", height: 1.9, yaw: 0 },
] as const;

export type RobotPart = { geometry: THREE.BufferGeometry; material: THREE.Material };

const cache = new Map<string, RobotPart[]>();

// Lambert keeps the per-fragment cost at the level of the old box people;
// textures / base colours / emissive carry over from the glTF PBR material.
function cheapMaterial(src: THREE.Material): THREE.Material {
  const s = src as THREE.MeshStandardMaterial;
  const m = new THREE.MeshLambertMaterial({
    color: s.color ? s.color.clone() : new THREE.Color("#888"),
    map: s.map ?? null,
    emissive: s.emissive ? s.emissive.clone() : new THREE.Color(0),
    emissiveMap: s.emissiveMap ?? null,
    transparent: false,
    side: THREE.FrontSide,
  });
  // metal robots read too dark under Lambert (no env reflections): lift a bit
  if ((s.metalness ?? 0) > 0.5) m.color.multiplyScalar(1.25);
  m.name = s.name;
  return m;
}

function toFloat(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  if (!(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && a.array instanceof Float32Array) return a as THREE.BufferAttribute;
  const n = a.count, sz = a.itemSize, out = new Float32Array(n * sz);
  for (let i = 0; i < n; i++) for (let c = 0; c < sz; c++) out[i * sz + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, sz);
}

function sceneBox(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    box.union(m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld));
  });
  return box;
}

/**
 * Flattens a robot GLB into world-baked parts: scaled to `height`, feet on
 * y=0, centred on x/z, rotated by `yaw` so it faces +Z. `ref` (the full-detail
 * scene) supplies the normalisation for a distance LOD, so both LODs line up
 * exactly. Cached per url, so the same parts feed plain and instanced meshes.
 */
export function robotParts(scene: THREE.Object3D, key: string, height: number, yaw: number, cheap: boolean, ref?: THREE.Object3D): RobotPart[] {
  const ck = key + (cheap ? ":c" : ":s");
  const hit = cache.get(ck);
  if (hit) return hit;
  const box = sceneBox(ref ?? scene);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const s = height / size.y;
  const xf = new THREE.Matrix4()
    .makeRotationY(yaw)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  const parts: RobotPart[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) {
      if (k !== "position" && k !== "normal" && k !== "uv") { g.deleteAttribute(k); continue; }
      g.setAttribute(k, toFloat(g.getAttribute(k) as THREE.BufferAttribute)); // meshopt-quantised ints would clamp under applyMatrix4
    }
    g.applyMatrix4(m.matrixWorld);
    g.applyMatrix4(xf);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    parts.push({ geometry: g, material: cheap ? cheapMaterial(mat) : mat });
  });
  cache.set(ck, parts);
  return parts;
}

export function usePlayerRobot(): RobotPart[] {
  const gltf = useGLTF(asset(PLAYER_ROBOT.url));
  return robotParts(gltf.scene, PLAYER_ROBOT.url, PLAYER_ROBOT.height, PLAYER_ROBOT.yaw, false);
}

export const lodUrl = (url: string) => url.replace(".glb", "-lod.glb");

/** [type][lod 0 = near, 1 = far] -> parts */
export function useNpcRobots(): RobotPart[][][] {
  const near = useGLTF(NPC_ROBOTS.map((r) => asset(r.url)));
  const far = useGLTF(NPC_ROBOTS.map((r) => asset(lodUrl(r.url))));
  return NPC_ROBOTS.map((r, i) => [
    robotParts(near[i].scene, r.url, r.height, r.yaw, true),
    robotParts(far[i].scene, lodUrl(r.url), r.height, r.yaw, true, near[i].scene),
  ]);
}

/** Walk state written by components/Player.tsx each frame and read by
 *  PlayerRobotMesh: stride phase (rad), stride amount 0..1, airborne. */
export const playerLimbs = { phase: 0, amt: 0, air: false, sit: false };

type Limb = "body" | "legL" | "legR" | "armL" | "armR";
type LimbPart = { geometry: THREE.BufferGeometry; material: THREE.Material };
type LimbSet = Record<Limb, { pivot: THREE.Vector3; parts: LimbPart[] }>;
const limbCache = new Map<string, LimbSet>();

/**
 * "The Big Boss" ships as ONE rigid mesh (no rig, no animations), so a real
 * procedural walk needs its limbs cut out: triangles are binned by centroid in
 * the normalised body box (feet y=0, faces +Z) into legs (below the hips,
 * split at x=0) and hanging arms (outside the chest, shoulder to fingertip),
 * each with a hip / shoulder pivot. Done once at load; 5 draws instead of 1.
 */
function splitLimbs(parts: RobotPart[], key: string): LimbSet {
  const hit = limbCache.get(key);
  if (hit) return hit;
  const box = new THREE.Box3();
  for (const p of parts) box.union(p.geometry.boundingBox!);
  const H = box.max.y - box.min.y, W = box.max.x - box.min.x, zc = (box.min.z + box.max.z) / 2;
  const u = (x: number) => (x - box.min.x) / W;
  const classify = (x: number, y: number): Limb => {
    const v = y / H, uu = u(x);
    if (v < 0.4) return x > 0 ? "legL" : "legR";
    if (v < 0.55) { if (uu < 0.13) return "armR"; if (uu > 0.84) return "armL"; return "body"; }
    if (v < 0.78) { if (uu < 0.33) return "armR"; if (uu > 0.76) return "armL"; }
    return "body";
  };
  const out = {
    body: { pivot: new THREE.Vector3(0, 0, 0), parts: [] as LimbPart[] },
    legL: { pivot: new THREE.Vector3(W * 0.2, H * 0.45, zc), parts: [] as LimbPart[] },
    legR: { pivot: new THREE.Vector3(-W * 0.2, H * 0.45, zc), parts: [] as LimbPart[] },
    armL: { pivot: new THREE.Vector3(box.min.x + W * 0.8, H * 0.79, zc), parts: [] as LimbPart[] },
    armR: { pivot: new THREE.Vector3(box.min.x + W * 0.2, H * 0.79, zc), parts: [] as LimbPart[] },
  } as LimbSet;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const p of parts) {
    const g = p.geometry.index ? p.geometry.toNonIndexed() : p.geometry;
    const pos = g.getAttribute("position");
    const bins: Record<Limb, number[]> = { body: [], legL: [], legR: [], armL: [], armR: [] };
    for (let t = 0; t < pos.count; t += 3) {
      a.fromBufferAttribute(pos, t); b.fromBufferAttribute(pos, t + 1); c.fromBufferAttribute(pos, t + 2);
      bins[classify((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3)].push(t);
    }
    for (const limb of Object.keys(bins) as Limb[]) {
      const tris = bins[limb];
      if (!tris.length) continue;
      const piv = out[limb].pivot;
      const ng = new THREE.BufferGeometry();
      for (const name of Object.keys(g.attributes)) {
        const src = g.getAttribute(name) as THREE.BufferAttribute, sz = src.itemSize;
        const arr = new Float32Array(tris.length * 3 * sz);
        let o = 0;
        for (const t of tris) for (let k = 0; k < 3; k++) for (let e = 0; e < sz; e++) arr[o++] = src.getComponent(t + k, e);
        ng.setAttribute(name, new THREE.BufferAttribute(arr, sz));
      }
      ng.translate(-piv.x, -piv.y, -piv.z); // pivot at the joint
      ng.computeBoundingBox(); ng.computeBoundingSphere();
      out[limb].parts.push({ geometry: ng, material: p.material });
    }
  }
  limbCache.set(key, out);
  return out;
}

/** The player's robot body with a procedural walk: legs swing from the hips,
 *  arms counter-swing from the shoulders (driven by playerLimbs). */
export function PlayerRobotMesh() {
  const parts = usePlayerRobot();
  const limbs = splitLimbs(parts, PLAYER_ROBOT.url);
  const refs = useRef<Partial<Record<Limb, THREE.Group | null>>>({});
  useFrame(() => {
    const { phase, amt, air, sit } = playerLimbs;
    const sw = air ? 0 : Math.sin(phase) * 0.55 * amt;
    const r = refs.current;
    if (sit) {
      if (r.legL) r.legL.rotation.x = -1.35;
      if (r.legR) r.legR.rotation.x = -1.35;
      if (r.armL) { r.armL.rotation.x = -0.6; r.armL.rotation.z = 0; }
      if (r.armR) { r.armR.rotation.x = -0.6; r.armR.rotation.z = 0; }
      return;
    }
    if (r.legL) r.legL.rotation.x = air ? -0.35 : sw;
    if (r.legR) r.legR.rotation.x = air ? 0.25 : -sw;
    if (r.armL) { r.armL.rotation.x = air ? -0.5 : -sw * 0.8; r.armL.rotation.z = air ? 0.25 : 0; }
    if (r.armR) { r.armR.rotation.x = air ? -0.5 : sw * 0.8; r.armR.rotation.z = air ? -0.25 : 0; }
  });
  return (
    <group>
      {(Object.keys(limbs) as Limb[]).map((k) => (
        <group key={k} position={limbs[k].pivot} ref={(g) => { refs.current[k] = g; }}>
          {limbs[k].parts.map((p, i) => (
            <mesh key={i} geometry={p.geometry} material={p.material} castShadow />
          ))}
        </group>
      ))}
    </group>
  );
}
