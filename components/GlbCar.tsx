"use client";

import { useLayoutEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { asset } from "@/lib/asset";
import { RIDE_HEIGHT } from "@/components/SupercarBody";
import { PLAYER_CARS, usePlayerCarStore, type PlayerCarDef } from "@/lib/playerCar";
import { noTransmission } from "@/components/ReadyGate";
import { coatScene } from "@/lib/weatherCoat";
import { rigWheels, type WheelRig } from "@/lib/wheelRig";

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
const plateMats = new Map<string, THREE.MeshBasicMaterial>();
function plateMaterial(url: string) {
  let m = plateMats.get(url);
  if (!m) {
    const tex = new THREE.TextureLoader().load(asset(url));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // polygonOffset + a 1 cm stand-off from the bumper: no z-fighting at any distance
    m = new THREE.MeshBasicMaterial({ map: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.name = "td-plate";
    plateMats.set(url, m);
  }
  return m;
}

/** Front + rear plates on a prepared car (wrap space: ground y=0, nose +z).
 *  The model's own placeholder plates ("nameplate" material) are hidden; each
 *  plate is raycast onto the body and turned to the surface normal there (so
 *  it follows a slanted tailgate) with a 1.2 cm stand-off: no z-fighting. */
function addPlates(wrap: THREE.Object3D, plate: NonNullable<PlayerCarDef["plate"]>) {
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
  const mat = plateMaterial(plate.url);
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

function preparePlayer(def: PlayerCarDef, scene: THREE.Object3D) {
  const obj = prepare(scene, def.rotY, def.length, def.paint, def.color, false, true);
  obj.name = `td-car:${def.id}`;
  obj.position.y += RIDE_HEIGHT; // plates + wheel rig work with the road at world y=0
  const rig = rigWheels(obj, def.phys?.wheelRadius ?? 0.32);
  if (def.plate) addPlates(obj, def.plate);
  obj.position.y -= RIDE_HEIGHT;
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
    const plate = new THREE.Mesh(PLATE_GEO, plateMaterial(PLAYER_CARS.find((c) => c.plate)!.plate!.url));
    o.add(plate);
    o.visible = false;
    return o;
  }, [gltf, def]);
  return <primitive object={obj} position={[0, -400, 0]} />;
}

// CC-BY low-poly traffic cars (see CREDITS.md)
export const TRAFFIC_MODELS = [
  { url: "/models/traffic/sedan-a.glb", length: 4.5 },
  { url: "/models/traffic/sedan-b.glb", length: 4.5 },
  { url: "/models/traffic/hatch-a.glb", length: 4.1 },
  { url: "/models/traffic/hatch-b.glb", length: 4.1 },
  { url: "/models/traffic/van-a.glb", length: 4.9 },
  { url: "/models/traffic/taxi-a.glb", length: 4.5 },
];

export function TrafficGlbCar({ index, color }: { index: number; color: string }) {
  const def = TRAFFIC_MODELS[Math.abs(index) % TRAFFIC_MODELS.length];
  const gltf = useGLTF(asset(def.url));
  const taxi = def.url.includes("taxi");
  const obj = useMemo(() => prepare(gltf.scene, 0, def.length, undefined, taxi ? "#f2c200" : color, true, false), [gltf, def, color, taxi]);
  return <primitive object={obj} />;
}
