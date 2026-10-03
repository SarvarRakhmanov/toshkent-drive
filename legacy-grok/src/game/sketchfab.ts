import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { dropJunk, loadModel, placeCar, placeProp } from "./assets";
import { ROADS, WORLD, intersections, type Building } from "./layout";
import { plateTexture } from "./textures";

export type SfItem = {
  id: string;
  role: string;
  file: string;
  uid: string;
  author: string;
  license: string;
  url: string;
};

export type SfManifest = {
  buildings: SfItem[];
  cars: SfItem[];
  peds: SfItem[];
  roads: SfItem[];
  props: SfItem[];
  sky?: SfItem[];
};

let pending: Promise<SfManifest | null> | null = null;

export function loadManifest(): Promise<SfManifest | null> {
  if (!pending) {
    pending = fetch("/models/sketchfab/manifest.json")
      .then((r) => (r.ok ? (r.json() as Promise<SfManifest>) : null))
      .catch(() => null);
  }
  return pending;
}

/** District pools. Neighbors inside a district still refuse a shared uid. */
const DISTRICT: Record<Building["tile"], string[]> = {
  center: ["apt-a", "corner-a", "shop-a", "house-a"],
  north: ["house-b", "shop-b", "corner-b"],
  south: ["house-a", "shop-b", "apt-b"],
  east: ["apt-b", "corner-b", "shop-a"],
  west: ["corner-a", "house-b", "apt-a"],
};

export function pickBuilding(list: SfItem[], building: Building, forbidden: string[]) {
  const ids = DISTRICT[building.tile] ?? [];
  let pool = list.filter((item) => ids.includes(item.id));
  if (pool.length < 2) pool = list;
  if (!pool.length) return null;
  const h = Math.abs(Math.round(building.x * 3 + building.z * 7));
  for (let k = 0; k < pool.length; k++) {
    const item = pool[(h + k) % pool.length]!;
    if (!forbidden.includes(item.uid)) return item;
  }
  return pool[h % pool.length]!;
}

export function hashId(id: number) {
  return (Math.imul(id, 1103515245) + 12345) >>> 0;
}

/** Ped pool index. The previous spawn id never lands on the same model. */
export function pedIndex(id: number, count: number) {
  if (count <= 1) return 0;
  let idx = hashId(id) % count;
  const prev = hashId(id - 1) % count;
  if (idx === prev) idx = (idx + 1) % count;
  return idx;
}

function meshGeometries(src: THREE.Object3D): { geos: THREE.BufferGeometry[]; material: THREE.Material | null } {
  const geos: THREE.BufferGeometry[] = [];
  let material: THREE.Material | null = null;
  const meshes: THREE.Mesh[] = [];
  src.updateWorldMatrix(true, true);
  src.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
  });
  for (const mesh of meshes) {
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    geos.push(geo);
    if (!material) {
      const raw = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      material = raw ?? null;
    }
  }
  return { geos, material };
}

function safeMerge(geos: THREE.BufferGeometry[]) {
  if (geos.length === 1) return geos[0]!;
  try {
    return mergeGeometries(geos, false) ?? geos[0]!;
  } catch {
    return geos[0]!;
  }
}

/** Longest horizontal axis becomes Z. Bottom sits on y=0. Unit size in X, Y, Z. */
function unitGeometry(src: THREE.Object3D) {
  const { geos, material } = meshGeometries(src);
  if (!geos.length || !material) return null;
  const geo = safeMerge(geos);
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -box.min.y, -center.z);
  const alongZ = size.z >= size.x;
  if (!alongZ) geo.rotateY(Math.PI / 2);
  const sx = Math.max(alongZ ? size.x : size.z, 0.001);
  const sy = Math.max(size.y, 0.001);
  const sz = Math.max(alongZ ? size.z : size.x, 0.001);
  geo.scale(1 / sx, 1 / sy, 1 / sz);
  const mat = material.clone();
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -1;
  mat.polygonOffsetUnits = -2;
  return { geo, material: mat };
}

/** Uniform scale so the piece is `height` meters tall, proportions kept. */
function fittedGeometry(src: THREE.Object3D) {
  const { geos, material } = meshGeometries(src);
  if (!geos.length || !material) return null;
  const geo = safeMerge(geos);
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return null;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const h = Math.max(size.y, 0.001);
  geo.translate(-center.x, -box.min.y, -center.z);
  geo.scale(1 / h, 1 / h, 1 / h);
  return { geo, material: material.clone() };
}

function instanceAlong(
  parent: THREE.Object3D,
  src: THREE.Object3D,
  length: number,
  widthFor: (roadW: number) => number,
  height: number,
  edge: number,
  material?: THREE.Material,
) {
  const prepared = unitGeometry(src);
  if (!prepared) return;
  const spots: { x: number; z: number; yaw: number; width: number; y: number }[] = [];
  for (const road of ROADS) {
    const alongX = road.w >= road.d;
    const span = alongX ? Math.min(road.w, WORLD - 40) : Math.min(road.d, WORLD - 40);
    const roadWidth = alongX ? road.d : road.w;
    const n = Math.max(1, Math.floor(span / length));
    const across = Math.sign(edge) * (roadWidth / 2 + (Math.abs(edge) > 1 ? 1.6 : Math.abs(edge) > 0 ? 0.2 : 0));
    for (let i = 0; i < n; i++) {
      const t = -span / 2 + length / 2 + i * length;
      spots.push({
        x: alongX ? road.x + t : road.x + across,
        z: alongX ? road.z + across : road.z + t,
        yaw: alongX ? Math.PI / 2 : 0,
        width: widthFor(roadWidth),
        y: alongX ? 0.02 : 0.028,
      });
    }
  }
  if (!spots.length) return;
  const mat = material ?? prepared.material;
  const inst = new THREE.InstancedMesh(prepared.geo, mat, spots.length);
  inst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  spots.forEach((spot, i) => {
    dummy.position.set(spot.x, spot.y, spot.z);
    dummy.rotation.set(0, spot.yaw, 0);
    dummy.scale.set(spot.width, height, length);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
}

function namedPiece(root: THREE.Object3D, accept: RegExp, reject?: RegExp) {
  const hits: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const name = `${obj.name} ${obj.parent?.name ?? ""}`;
    if (!accept.test(name)) return;
    if (reject && reject.test(name)) return;
    let mesh = false;
    obj.traverse((n) => {
      if ((n as THREE.Mesh).isMesh) mesh = true;
    });
    if (mesh) hits.push(obj);
  });
  return hits[0] ?? null;
}

export async function dressStreets(parent: THREE.Object3D) {
  const manifest = await loadManifest();
  if (!manifest?.roads.length) return;
  const byRole = new Map(manifest.roads.map((item) => [item.role, item]));
  const load = async (role: string) => {
    const item = byRole.get(role);
    if (!item) return null;
    const src = await loadModel(item.file);
    if (!src) return null;
    const clone = src.clone(true);
    dropJunk(clone);
    return clone;
  };
  const asphalt = await load("asphalt");
  const curbSrc = await load("curb");
  const walkSrc = await load("sidewalk");
  const crossSrc = await load("crosswalk");
  const holeSrc = await load("manhole");
  const asphaltMat = new THREE.MeshStandardMaterial({ color: "#07090c", roughness: 0.95, metalness: 0.02 });
  asphaltMat.polygonOffset = true;
  asphaltMat.polygonOffsetFactor = -2;
  asphaltMat.polygonOffsetUnits = -2;
  const asphaltPiece = asphalt ? namedPiece(asphalt, /asphalt/i) ?? asphalt : null;
  if (asphaltPiece) instanceAlong(parent, asphaltPiece, 8, (w) => w * 0.92, 0.035, 0, asphaltMat);
  const curb = curbSrc ? namedPiece(curbSrc, /straight/i, /corner|transition/i) ?? curbSrc : null;
  if (curb) {
    instanceAlong(parent, curb, 8, () => 0.42, 0.16, 1);
    instanceAlong(parent, curb, 8, () => 0.42, 0.16, -1);
  }
  const walk = walkSrc ? namedPiece(walkSrc, /bord|sidewalk|walk/i) ?? walkSrc : null;
  if (walk) {
    instanceAlong(parent, walk, 8, () => 2.2, 0.07, 2);
    instanceAlong(parent, walk, 8, () => 2.2, 0.07, -2);
  }
  if (crossSrc) {
    const prepared = unitGeometry(crossSrc);
    if (prepared) {
      const spots = intersections();
      const inst = new THREE.InstancedMesh(prepared.geo, prepared.material, spots.length);
      const dummy = new THREE.Object3D();
      spots.forEach((spot, i) => {
        dummy.position.set(spot.x, 0.05, spot.z);
        dummy.rotation.set(0, i % 2 ? Math.PI / 2 : 0, 0);
        dummy.scale.set(10, 0.03, 10);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      });
      inst.instanceMatrix.needsUpdate = true;
      parent.add(inst);
    }
  }
  const hole = holeSrc ? namedPiece(holeSrc, /circle|cover|hole/i) ?? holeSrc : null;
  if (hole) {
    const prepared = unitGeometry(hole);
    if (prepared) {
      const spots: { x: number; z: number }[] = [];
      for (const road of ROADS) {
        const alongX = road.w >= road.d;
        const span = alongX ? Math.min(road.w, WORLD - 40) : Math.min(road.d, WORLD - 40);
        for (let t = -span / 2 + 16; t < span / 2; t += 32) {
          spots.push({ x: alongX ? road.x + t : road.x, z: alongX ? road.z : road.z + t });
        }
      }
      if (spots.length) {
        const inst = new THREE.InstancedMesh(prepared.geo, prepared.material, spots.length);
        const dummy = new THREE.Object3D();
        spots.forEach((spot, i) => {
          dummy.position.set(spot.x, 0.06, spot.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(0.85, 0.025, 0.85);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        });
        inst.instanceMatrix.needsUpdate = true;
        parent.add(inst);
      }
    }
  }
}

export function separatedChildren(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  let best: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const kids = obj.children.filter((child) => {
      let has = false;
      child.traverse((n) => {
        if ((n as THREE.Mesh).isMesh) has = true;
      });
      return has;
    });
    if (kids.length < 2 || kids.length > 16 || kids.length <= best.length) return;
    const centers = kids.map((kid) => new THREE.Box3().setFromObject(kid).getCenter(new THREE.Vector3()));
    let sep = 0;
    for (let i = 1; i < centers.length; i++) sep = Math.max(sep, centers[0]!.distanceTo(centers[i]!));
    const span = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    if (sep > Math.max(0.15, Math.min(span.x, span.z) * 0.15)) best = kids;
  });
  return best;
}

export async function pedSources(): Promise<THREE.Object3D[]> {
  const manifest = await loadManifest();
  const pool: THREE.Object3D[] = [];
  if (!manifest?.peds.length) return pool;
  const groups: THREE.Object3D[][] = [];
  for (const item of manifest.peds) {
    if (item.id === "mira" || item.id === "man") continue;
    const src = await loadModel(item.file);
    if (!src) continue;
    dropJunk(src);
    const parts = separatedChildren(src);
    groups.push(parts.length >= 2 ? parts : [src]);
  }
  for (const group of groups) {
    if (pool.length >= 8) break;
    pool.push(group[0]!);
  }
  for (const group of groups) {
    for (const extra of group.slice(1)) {
      if (pool.length >= 8) break;
      pool.push(extra);
    }
  }
  return pool;
}

const placed: { x: number; z: number }[] = [];

function tooClose(x: number, z: number) {
  return placed.some((p) => Math.hypot(p.x - x, p.z - z) < 8);
}

export async function dressProp(parent: THREE.Object3D, role: string, x: number, z: number, yaw: number, height: number) {
  if (tooClose(x, z)) return false;
  placed.push({ x, z });
  const manifest = await loadManifest();
  const item = manifest?.props.find((p) => p.role === role);
  if (!item) return false;
  const src = await loadModel(item.file);
  if (!src) return false;
  const piece = role === "sign" ? namedPiece(src, /sign|cube/i) ?? separatedChildren(src)[0] ?? src : src;
  const model = piece.clone(true);
  dropJunk(model);
  placeProp(model, height);
  model.position.x += x;
  model.position.z += z;
  model.rotation.y += yaw;
  parent.add(model);
  return true;
}

export async function dressTrees(parent: THREE.Object3D, spots: { x: number; z: number; k: "plane" | "poplar"; s: number }[], hide: THREE.Object3D[]) {
  const manifest = await loadManifest();
  const item = manifest?.props.find((p) => p.role === "tree");
  if (!item || !spots.length) return;
  const src = await loadModel(item.file);
  if (!src) return;
  const parts = separatedChildren(src).filter((p) => /tree/i.test(p.name) || /tree/i.test(p.parent?.name ?? ""));
  const pieces = (parts.length ? parts : separatedChildren(src)).slice(0, 4);
  const use = pieces.length ? pieces : [src];
  const buckets = use.map(() => [] as typeof spots);
  spots.forEach((spot, i) => buckets[i % use.length]!.push(spot));
  let added = false;
  use.forEach((piece, bi) => {
    const prepared = fittedGeometry(piece);
    const list = buckets[bi]!;
    if (!prepared || !list.length) return;
    const inst = new THREE.InstancedMesh(prepared.geo, prepared.material, list.length);
    const dummy = new THREE.Object3D();
    list.forEach((spot, i) => {
      const h = spot.k === "poplar" ? 7.4 * spot.s : 4.6 * spot.s;
      dummy.position.set(spot.x, 0, spot.z);
      dummy.rotation.set(0, (i % 9) * 0.4, 0);
      dummy.scale.setScalar(h);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    parent.add(inst);
    added = true;
  });
  if (added) for (const obj of hide) obj.visible = false;
}

export async function dressLamps(parent: THREE.Object3D, spots: { x: number; z: number }[], hide: THREE.Object3D[]) {
  const manifest = await loadManifest();
  const item = manifest?.props.find((p) => p.role === "lamp");
  if (!item || !spots.length) return;
  const src = await loadModel(item.file);
  if (!src) return;
  const prepared = fittedGeometry(src);
  if (!prepared) return;
  const inst = new THREE.InstancedMesh(prepared.geo, prepared.material, spots.length);
  const dummy = new THREE.Object3D();
  spots.forEach((spot, i) => {
    dummy.position.set(spot.x, 0, spot.z);
    dummy.rotation.set(0, (i % 2) * Math.PI, 0);
    dummy.scale.setScalar(5.4);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  parent.add(inst);
  for (const obj of hide) obj.visible = false;
}

export async function dressBuildings(parent: THREE.Object3D, items: { building: Building; fallback: THREE.Group }[]) {
  const manifest = await loadManifest();
  if (!manifest?.buildings.length) return;
  const assigned: { x: number; z: number; uid: string }[] = [];
  const jobs: { item: SfItem; building: Building; fallback: THREE.Group }[] = [];
  for (const row of items) {
    const near = assigned.filter((a) => Math.hypot(a.x - row.building.x, a.z - row.building.z) < 42).map((a) => a.uid);
    const item = pickBuilding(manifest.buildings, row.building, near);
    if (!item) continue;
    assigned.push({ x: row.building.x, z: row.building.z, uid: item.uid });
    jobs.push({ item, building: row.building, fallback: row.fallback });
  }
  await Promise.all(
    jobs.map(async ({ item, building, fallback }) => {
      const src = await loadModel(item.file);
      if (!src) return;
      const model = src.clone(true);
      dropJunk(model);
      placeProp(model, building.h);
      model.position.x += building.x;
      model.position.z += building.z;
      model.rotation.y = building.rot;
      parent.add(model);
      fallback.visible = false;
    }),
  );
}

const LENGTH: Record<string, number> = { sedan: 4.4, suv: 4.5, van: 5.1, taxi: 4.4, bus: 6.4 };

export function mountTraffic(parent: THREE.Group, src: THREE.Object3D, kind: string, color: string, plate: string) {
  const model = src.clone(true);
  dropJunk(model);
  model.rotation.y = Math.PI;
  placeCar(model, LENGTH[kind] ?? 4.4);
  tintBody(model, color);
  const wheels: THREE.Object3D[] = [];
  model.traverse((obj) => {
    if (!/wheel|tire|tyre|rim/i.test(obj.name)) return;
    if (/brake|caliper/i.test(obj.name)) return;
    if (obj.parent && /wheel|tire|tyre|rim/i.test(obj.parent.name)) return;
    wheels.push(obj);
  });
  addPlate(model, plate);
  for (const child of [...parent.children]) child.visible = false;
  parent.add(model);
  parent.userData.wheels = wheels;
  parent.userData.body = model;
}

function tintBody(root: THREE.Object3D, color: string) {
  let best: THREE.Mesh | null = null;
  let bestVol = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox?.getSize(new THREE.Vector3());
    if (!size) return;
    const vol = size.x * size.y * size.z;
    if (vol > bestVol) {
      bestVol = vol;
      best = mesh;
    }
  });
  if (!best) return;
  const mesh = best as THREE.Mesh;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const next = mats.map((mat, i) => {
    const copy = mat.clone();
    if (i === 0) {
      const std = copy as THREE.MeshStandardMaterial;
      if (std.color) std.color.set(color);
    }
    return copy;
  });
  mesh.material = next.length === 1 ? next[0]! : next;
}

function addPlate(model: THREE.Object3D, text: string) {
  const pos = model.position.clone();
  const rot = model.rotation.clone();
  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.copy(pos);
  model.rotation.copy(rot);
  const size = box.getSize(new THREE.Vector3());
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(0.52, Math.max(0.42, size.x * 0.22)), 0.12),
    new THREE.MeshStandardMaterial({ map: plateTexture(text), roughness: 0.45, metalness: 0.06, side: THREE.DoubleSide }),
  );
  plate.position.set(0, box.min.y + Math.max(0.42, size.y * 0.38), box.min.z - 0.03);
  model.add(plate);
}

export async function carSource(kind: string, index: number) {
  const manifest = await loadManifest();
  const cars = manifest?.cars ?? [];
  if (!cars.length) return null;
  const role = kind === "taxi" ? "taxi" : kind === "van" || kind === "bus" ? "van" : kind === "suv" ? "hatchback" : "sedan";
  const pool = cars.filter((c) => c.role === role);
  const list = pool.length ? pool : cars;
  const item = list[Math.abs(index) % list.length];
  if (!item) return null;
  return loadModel(item.file);
}

/** CC-BY milky-way skydome. Falls back to the gradient sky if the file is missing. */
export async function loadStarDome(): Promise<THREE.Object3D | null> {
  const manifest = await loadManifest();
  const item = manifest?.sky?.[0];
  if (!item) return null;
  const src = await loadModel(item.file);
  if (!src) return null;
  const dome = src.clone(true);
  dropJunk(dome);
  dome.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const srcMat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const map = srcMat?.emissiveMap || srcMat?.map || null;
    if (map) map.colorSpace = THREE.SRGBColorSpace;
    mesh.material = new THREE.MeshBasicMaterial({
      map: map ?? undefined,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    mesh.frustumCulled = false;
  });
  dome.position.set(0, 0, 0);
  dome.rotation.set(0, 0, 0);
  dome.scale.set(1, 1, 1);
  dome.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(dome);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 0.001);
  const s = 1400 / span;
  dome.scale.setScalar(s);
  dome.position.set(-center.x * s, -center.y * s, -center.z * s);
  const holder = new THREE.Group();
  holder.add(dome);
  return holder;
}
