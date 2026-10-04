"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@/lib/safeFrame";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { livePlateMaterial } from "@/lib/plates";
import { asset } from "@/lib/asset";
import { RIDE_HEIGHT } from "@/components/SupercarBody";
import { PLAYER_CARS, usePlayerCarStore, type PlayerCarDef } from "@/lib/playerCar";
import { noTransmission } from "@/components/ReadyGate";
import { coatScene } from "@/lib/weatherCoat";
import { rigWheels, poseWheels, type WheelRig } from "@/lib/wheelRig";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** the active player car's wheel rig (posed by components/Car.tsx) */
export const playerWheels: { rig: WheelRig | null } = { rig: null };

// Toshkent Drive: real GLB car bodies (the player's own cars + CC-BY traffic
// cars from the Grok Build project) dropped into this engine's car rigs.
// Engine convention (components/SupercarBody.tsx): nose toward +z, the
// group's origin sits RIDE_HEIGHT above the tyre contact patch.

function fitCar(model: THREE.Object3D, length: number) {
  model.updateMatrixWorld(true);
  // precise = from the actual vertices: the loader's cached geometry bounds
  // were too small for some models (K5 sat 17 cm, M3 Competition 29 cm in the road)
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 0.01);
  model.scale.multiplyScalar(length / span);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model, true);
  const c = fitted.getCenter(new THREE.Vector3());
  model.position.x -= c.x;
  model.position.z -= c.z;
  model.position.y -= fitted.min.y;
}

function prepare(scene: THREE.Object3D, rotY: number, length: number, paint: RegExp | undefined, color: string | undefined, tintLargest: boolean, shadows: boolean) {
  const model = scene.clone(true);
  // drop cameras/lights shipped inside some Sketchfab exports
  const junk: THREE.Object3D[] = [];
  model.traverse((o) => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) junk.push(o);
  });
  junk.forEach((o) => o.removeFromParent());
  noTransmission(model);
  const wrap = new THREE.Group();
  model.rotation.y = rotY;
  wrap.add(model);
  fitCar(wrap, length);
  let biggest: THREE.Mesh | null = null;
  let bigVol = 0;
  wrap.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((m) => {
      const std = m as THREE.MeshStandardMaterial;
      if (paint && color && paint.test(std.name || "")) {
        const c = std.clone() as THREE.MeshPhysicalMaterial;
        c.color?.set(color);
        if ("clearcoat" in c) {
          c.clearcoat = 1;
          c.clearcoatRoughness = 0.08;
        }
        c.metalness = Math.max(c.metalness ?? 0, 0.55);
        c.roughness = Math.min(c.roughness ?? 1, 0.35);
        return c;
      }
      if (std.isMeshStandardMaterial) std.envMapIntensity = 1.2;
      return m;
    });
    mesh.material = next.length === 1 ? next[0] : next;
    if (tintLargest) {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const s = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
      const v = s.x * s.y * s.z;
      if (v > bigVol) {
        bigVol = v;
        biggest = mesh;
      }
    }
  });
  if (tintLargest && biggest && color) {
    const mesh = biggest as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const tinted = mats.map((m, i) => {
      const c = (m as THREE.MeshStandardMaterial).clone();
      if (i === 0) {
        c.color?.set(color);
        c.metalness = 0.5;
        c.roughness = 0.35;
      }
      return c;
    });
    mesh.material = tinted.length === 1 ? tinted[0] : tinted;
  }
  // fitCar already lifted the wrap so the lowest vertex (tyre) touches y=0;
  // ADD the ride-height offset instead of overwriting that lift (the old "="
  // sank any model whose origin isn't at tyre level: K5 17 cm, M3 Comp. 29 cm)
  wrap.position.y -= RIDE_HEIGHT;
  // weather-coat shader patch right away: otherwise the car first compiles an
  // uncoated program and recompiles ~2 s later when Weather's scan coats it
  coatScene(wrap);
  return wrap;
}

// ── licence plates ───────────────────────────────────────────────────────────
// One shared 0.52 x 0.11 m plane + one unlit material per plate texture.
// Created synchronously (the texture fills in when its 15 KB PNG arrives), so
// the shader program is identical before/after load and compiles at boot.
const PLATE_GEO = new THREE.PlaneGeometry(0.52, 0.11);

/** Front + rear plates on a prepared car (wrap space: ground y=0, nose +z).
 *  The model's own placeholder plates ("nameplate" material) are hidden; each
 *  plate is raycast onto the body and turned to the surface normal there (so
 *  it follows a slanted tailgate) with a 1.2 cm stand-off: no z-fighting. */
function addPlates(wrap: THREE.Object3D, plate: NonNullable<PlayerCarDef["plate"]>, carId: string) {
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const meshes: THREE.Object3D[] = [];
  wrap.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    if (/nameplate|licen[cs]e|number ?plate/i.test(mat.name || "")) { m.visible = false; return; }
    if (mat.transparent && mat.opacity < 0.9) return; // skip glass/lenses
    meshes.push(m);
  });
  const ray = new THREE.Raycaster();
  const mat = livePlateMaterial(carId, plate.text); // v1.7b: runtime-drawn, editable in the menu
  const n = new THREE.Vector3();
  for (const side of [1, -1] as const) {
    const y = side > 0 ? plate.frontY : plate.rearY;
    const edge = side > 0 ? box.max.z : box.min.z;
    ray.far = 2.5;
    // centre ray for the surface normal; edge rays so a body that bulges out
    // at the sides never swallows part of the plate (outermost hit wins)
    let hit: THREE.Intersection | undefined;
    let outer = -Infinity;
    for (const x of [0, -0.25, 0.25, 0]) {
      ray.set(new THREE.Vector3(x, y, edge + side), new THREE.Vector3(0, 0, -side));
      const h = ray.intersectObjects(meshes, false)[0];
      if (!h) continue;
      if (x === 0 && !hit) hit = h;
      outer = Math.max(outer, h.point.z * side);
    }
    n.set(0, 0, side);
    if (hit?.face) {
      n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      n.x = 0; // keep the plate square to the car; only follow the pitch
      if (n.lengthSq() < 1e-6 || n.z * side < 0.5) n.set(0, 0, side);
      n.normalize();
    }
    const p = new THREE.Vector3(0, y, Number.isFinite(outer) ? outer * side : edge);
    // tilted plate: its top/bottom edges reach 5.5 cm * tan(tilt) further in
    const tilt = Math.sqrt(Math.max(0, 1 - n.z * n.z)) / Math.max(0.5, Math.abs(n.z));
    p.addScaledVector(n, 0.012 + 0.055 * tilt);
    const m = new THREE.Mesh(PLATE_GEO, mat);
    m.name = "td-plate";
    // p/n are world-space (wrap is an unrotated root here); store in wrap space
    wrap.add(m);
    m.position.copy(wrap.worldToLocal(p.clone()));
    m.lookAt(p.clone().add(n)); // lookAt takes a world target; front (+z) faces out
  }
}

// ── merge the static body ────────────────────────────────────────────────────
// A Sketchfab car is 50–70 separate meshes, each with its own (often
// identical) material: the Seltos alone was 68 of phone LOW's 140-call budget.
// Every non-moving mesh is baked into car-local space (de-quantised to float)
// and merged per material *look* (type, colours, maps, PBR factors, blending).
// Wheels (wheel-rig groups) and plates stay separate and keep animating.
function matKey(m: THREE.Material): string {
  const s = m as THREE.MeshPhysicalMaterial;
  const id = (t: THREE.Texture | null | undefined) => (t ? t.uuid : "-");
  return [m.type, s.color?.getHexString(), id(s.map), id(s.normalMap), id(s.roughnessMap), id(s.metalnessMap), id(s.aoMap), id(s.emissiveMap), id(s.alphaMap),
    s.emissive?.getHexString(), s.metalness?.toFixed(2), s.roughness?.toFixed(2), s.clearcoat?.toFixed(2), s.envMapIntensity?.toFixed(2),
    m.transparent, m.opacity.toFixed(2), m.side, m.alphaTest, m.depthWrite, m.blending, s.vertexColors].join("|");
}

function toFloatGeo(src: THREE.BufferGeometry, keep: string[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of keep) {
    const a = src.getAttribute(name);
    const n = a.count, k = a.itemSize;
    const out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = a.getComponent(i, j);
    g.setAttribute(name, new THREE.BufferAttribute(out, k));
  }
  if (src.index) g.setIndex(Array.from(src.index.array as ArrayLike<number>));
  return g;
}

function mergeStaticBody(obj: THREE.Object3D, rig: WheelRig | null) {
  const moving = new Set<THREE.Object3D>();
  rig?.wheels.forEach((w) => { moving.add(w.steer); moving.add(w.spin); });
  obj.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const groups = new Map<string, THREE.Mesh[]>();
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || m.name === "td-plate" || !m.visible) return;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh || m.morphTargetInfluences || (m as THREE.InstancedMesh).isInstancedMesh) return;
    for (let p = m.parent; p && p !== obj; p = p.parent) if (moving.has(p) || !p.visible) return;
    const k = matKey(m.material);
    const list = groups.get(k) ?? [];
    list.push(m);
    groups.set(k, list);
  });
  const mtx = new THREE.Matrix4();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const names = ["position", "normal", "uv"].filter((a) => list.every((m) => m.geometry.getAttribute(a)));
    if (!names.includes("position")) continue;
    const allIndexed = list.every((m) => m.geometry.index);
    const geos = list.map((m) => {
      let g = toFloatGeo(m.geometry, names);
      if (!allIndexed && g.index) g = g.toNonIndexed();
      mtx.multiplyMatrices(inv, m.matrixWorld);
      g.applyMatrix4(mtx);
      if (mtx.determinant() < 0) {
        // mirrored node: flip winding so faces stay front-facing
        if (g.index) { const ix = g.index.array as Uint32Array | number[]; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
        else for (const n of names) { const a = g.getAttribute(n) as THREE.BufferAttribute; const k = a.itemSize, arr = a.array as Float32Array; for (let i = 0; i < a.count; i += 3) for (let j = 0; j < k; j++) { const t = arr[(i + 1) * k + j]; arr[(i + 1) * k + j] = arr[(i + 2) * k + j]; arr[(i + 2) * k + j] = t; } }
      }
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.name = `merged:${(list[0].material as THREE.Material).name || "mat"}`;
    mesh.castShadow = list[0].castShadow;
    mesh.receiveShadow = list[0].receiveShadow;
    mesh.renderOrder = list[0].renderOrder;
    list.forEach((m) => m.removeFromParent());
    obj.add(mesh);
  }
}

function preparePlayer(def: PlayerCarDef, scene: THREE.Object3D) {
  const obj = prepare(scene, def.rotY, def.length, def.paint, def.color, false, true);
  obj.name = `td-car:${def.id}`;
  obj.position.y += RIDE_HEIGHT; // plates + wheel rig work with the road at world y=0
  const rig = rigWheels(obj, def.phys?.wheelRadius ?? 0.32);
  if (def.plate) addPlates(obj, def.plate, def.id);
  obj.position.y -= RIDE_HEIGHT;
  mergeStaticBody(obj, rig);
  obj.userData.wheelRig = rig;
  if (typeof window !== "undefined") {
    const w = window as unknown as { __tdWheels?: Record<string, unknown> };
    (w.__tdWheels ??= {})[def.id] = rig ? { radius: +rig.radius.toFixed(3), wheels: rig.wheels.map((x) => ({ p: x.steer.position.toArray().map((v) => +v.toFixed(2)), r: +x.radius.toFixed(3), parts: x.spin.children.length + x.steer.children.length - 1 })) } : null;
  }
  return obj;
}

/** The player's own car (Kia Seltos by default, K cycles the garage). */
export function PlayerGlbCar() {
  const index = usePlayerCarStore((s) => s.index);
  const def = PLAYER_CARS[index];
  const gltf = useGLTF(asset(def.url));
  const obj = useMemo(() => preparePlayer(def, gltf.scene), [gltf, def]);
  useLayoutEffect(() => {
    playerWheels.rig = (obj.userData.wheelRig as WheelRig | null) ?? null;
    (window as unknown as { __tdWheelPose?: () => unknown }).__tdWheelPose = () => playerWheels.rig?.wheels.map((w) => ({ steer: +w.steer.rotation.y.toFixed(3), spin: +w.spin.rotation.x.toFixed(3) })) ?? null;
    return () => { if (playerWheels.rig === obj.userData.wheelRig) playerWheels.rig = null; };
  }, [obj]);
  return <primitive object={obj} />;
}

/** Hidden copies of assets that may first appear mid-game (the BMW M3
 *  Competition from the K garage, the plate material) so the boot shader
 *  precompile in ReadyGate covers them; never drawn (visible=false). */
export function PrewarmAssets() {
  const def = PLAYER_CARS.find((c) => c.id === "m3c")!;
  const gltf = useGLTF(asset(def.url));
  const obj = useMemo(() => {
    const o = preparePlayer(def, gltf.scene);
    const pc = PLAYER_CARS.find((c) => c.plate)!;
    const plate = new THREE.Mesh(PLATE_GEO, livePlateMaterial(pc.id, pc.plate!.text));
    o.add(plate);
    o.visible = false;
    return o;
  }, [gltf, def]);
  return <primitive object={obj} position={[0, -400, 0]} />;
}

// CC-BY low-poly traffic cars (see CREDITS.md)
export const TRAFFIC_MODELS = [
  // v1.7b: five of the six original NPC models are authored nose-along-X, so
  // with rotY 0 they drove SIDEWAYS (crab-walking down the lane). rotY now
  // turns each nose onto +z (checked with scripts/nose-check.mjs + a side-view
  // contact sheet, shots/v1.7b-npc-models.png)
  { url: "/models/traffic/sedan-a.glb", length: 4.5, rotY: -Math.PI / 2 },
  { url: "/models/traffic/sedan-b.glb", length: 4.5, rotY: 0 },
  { url: "/models/traffic/hatch-a.glb", length: 4.1, rotY: -Math.PI / 2 },
  { url: "/models/traffic/hatch-b.glb", length: 4.1, rotY: Math.PI / 2 },
  { url: "/models/traffic/van-a.glb", length: 4.9, rotY: -Math.PI / 2 },
  { url: "/models/traffic/taxi-a.glb", length: 4.5, rotY: -Math.PI / 2 },
  // v1.7b NPC LODs of the player Cobalt / Captiva / 2103 (≈6–9k tris, 256 px,
  // palette-baked colours, so no tint)
  { url: "/models/traffic/cobalt.glb", length: 4.48, rotY: Math.PI, noTint: true },
  { url: "/models/traffic/captiva.glb", length: 4.67, rotY: 0, noTint: true },
  { url: "/models/traffic/lada2103.glb", length: 4.12, rotY: 0, noTint: true },
] as { url: string; length: number; rotY?: number; noTint?: boolean }[];

const _tp = new THREE.Vector3();
const NEAR_RIG2 = 38 * 38;

/** NPC car. Far: one merged static body (1–3 draw calls). Within ~38 m of
 *  the camera (v1.7b) a second copy with rigged wheels is swapped in so the
 *  wheels visibly roll forward at the car's lane speed (+8 calls, only for
 *  the one or two cars that close). `speed` is the signed forward m/s. */
export function TrafficGlbCar({ index, color, speed }: { index: number; color: string; speed?: { current: number } }) {
  const def = TRAFFIC_MODELS[Math.abs(index) % TRAFFIC_MODELS.length];
  const gltf = useGLTF(asset(def.url));
  const taxi = def.url.includes("taxi");
  const tint = taxi ? "#f2c200" : color;
  const obj = useMemo(() => {
    const o = prepare(gltf.scene, def.rotY ?? 0, def.length, undefined, tint, !def.noTint, false);
    // v2.1 perf: NPC cars have no wheel rig, so the whole body is static —
    // merge per material look (a queue of 6 at a red light was ~50 calls)
    mergeStaticBody(o, null);
    o.name = `td-npc:${def.url.split("/").pop()}`;
    return o;
  }, [gltf, def, tint]);
  const near = useRef<{ o: THREE.Object3D; rig: WheelRig | null } | null>(null);
  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g || !g.parent?.visible) return;
    g.getWorldPosition(_tp);
    const close = _tp.distanceToSquared(camera.position) < NEAR_RIG2;
    if (close && !near.current) {
      const o = prepare(gltf.scene, def.rotY ?? 0, def.length, undefined, tint, !def.noTint, false);
      o.position.y += RIDE_HEIGHT;
      const rig = rigWheels(o, 0.31);
      o.position.y -= RIDE_HEIGHT;
      mergeStaticBody(o, rig);
      o.name = `td-npc-near:${def.url.split("/").pop()}`;
      near.current = { o, rig };
      g.add(o);
      const w = window as unknown as { __tdNpcRigs?: Record<string, unknown> };
      (w.__tdNpcRigs ??= {})[o.name] = rig ? rig.wheels.length : 0;
    }
    if (near.current) {
      const useNear = close && !!near.current.rig;
      near.current.o.visible = useNear;
      obj.visible = !useNear;
      if (useNear) {
        poseWheels(near.current.rig!, speed?.current ?? 0, 0, Math.min(dt, 0.05), false, 0);
        const w = window as unknown as { __tdNpcSpin?: Record<string, number> };
        (w.__tdNpcSpin ??= {})[near.current.o.name] = near.current.rig!.wheels[0].spin.rotation.x;
      }
    }
  });
  return <group ref={group}><primitive object={obj} /></group>;
}
