import * as THREE from "three";
import { dropJunk, loadGltf, loadModel } from "./assets";
import type { Collider } from "./world";
import type { Pt } from "./layout";

export type MapId = "amir" | "grid" | "neon" | "block";

export type CityMap = {
  id: Exclude<MapId, "amir">;
  name: string;
  blurb: string;
  group: THREE.Group;
  spawn: { x: number; z: number; yaw: number };
  colliders: Collider[];
  loop: Pt[];
  sidewalk: Pt[];
  bounds: THREE.Box3;
  billboards: THREE.MeshStandardMaterial[];
  mixer: THREE.AnimationMixer | null;
  groundY: (x: number, z: number) => number | null;
  update: (dt: number, low: boolean) => void;
  dispose: () => void;
};

const META: Record<Exclude<MapId, "amir">, { name: string; blurb: string; url: string; scale: number }> = {
  grid: {
    name: "Grid",
    blurb: "Open road network. Grass lots are filled, asphalt stays clear.",
    url: "/models/maps/grid.glb",
    scale: 1,
  },
  neon: {
    name: "Neon",
    blurb: "Wet avenue, mirrored into a circuit. Billboards glow.",
    url: "/models/maps/neon.glb",
    scale: 4,
  },
  block: {
    name: "Block",
    blurb: "Brick streets, tiled three by three. Clips keep playing.",
    url: "/models/maps/block.glb",
    scale: 1,
  },
};

const ADS = ["NIGHT DRIVE", "01 TOSHKENT", "HOTEL", "APTEKA"];

function adTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#12081c";
  g.fillRect(0, 0, 512, 256);
  g.fillStyle = "#ff4d8d";
  g.fillRect(0, 0, 512, 8);
  g.fillStyle = "#f4ecdc";
  g.font = "700 64px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function seat(root: THREE.Object3D, scale: number) {
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(root);
}

function calmRoads(root: THREE.Object3D) {
  let layer = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const name = `${mesh.name} ${mesh.parent?.name ?? ""}`;
    const overlay = /lane|cross|mark|line|stripe|arrow|decal|sidewalk/i.test(name);
    const road = /road|asphalt|street|lane|pavement|cross|sidewalk/i.test(name);
    const ground = /plane|ground|grass|terrain/i.test(name);
    if (!road && !ground) return;
    const bias = ground ? 3 : overlay ? -4 - (layer % 3) : -1 - (layer % 3);
    layer++;
    const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
    for (const mat of mats) {
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = bias;
      mat.polygonOffsetUnits = bias;
      if (overlay) mat.depthWrite = false;
      mat.needsUpdate = true;
    }
  });
}

type Field = {
  groundY: (x: number, z: number) => number | null;
  colliders: Collider[];
  spawn: { x: number; z: number };
  loop: Pt[];
  sidewalk: Pt[];
  isRoad: (x: number, z: number) => boolean;
};

/** Mark streets from flat triangles and buildings from tall ones, so boxes never cover the asphalt. */
function rasterCity(group: THREE.Object3D, bounds: THREE.Box3): Field {
  const cell = 5;
  const ox = bounds.min.x;
  const oz = bounds.min.z;
  const nx = Math.max(1, Math.ceil((bounds.max.x - bounds.min.x) / cell));
  const nz = Math.max(1, Math.ceil((bounds.max.z - bounds.min.z) / cell));
  const road = new Float32Array(nx * nz);
  road.fill(Number.POSITIVE_INFINITY);
  const flats = new Uint16Array(nx * nz);
  const walls = new Uint16Array(nx * nz);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const centroid = new THREE.Vector3();

  group.updateMatrixWorld(true);
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const attr = geo?.getAttribute?.("position") as THREE.BufferAttribute | undefined;
    if (!attr) return;
    const index = geo.getIndex();
    const count = index ? index.count : attr.count;
    const matrix = mesh.matrixWorld;
    for (let tri = 0; tri + 2 < count; tri += 3) {
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(tri + k) : tri + k;
        v[k]!.fromBufferAttribute(attr, vi).applyMatrix4(matrix);
      }
      centroid.copy(v[0]!).add(v[1]!).add(v[2]!).multiplyScalar(1 / 3);
      const ix = Math.floor((centroid.x - ox) / cell);
      const iz = Math.floor((centroid.z - oz) / cell);
      if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
      const id = iz * nx + ix;
      const minY = Math.min(v[0]!.y, v[1]!.y, v[2]!.y);
      const maxY = Math.max(v[0]!.y, v[1]!.y, v[2]!.y);
      const e1x = v[1]!.x - v[0]!.x;
      const e1y = v[1]!.y - v[0]!.y;
      const e1z = v[1]!.z - v[0]!.z;
      const e2x = v[2]!.x - v[0]!.x;
      const e2y = v[2]!.y - v[0]!.y;
      const e2z = v[2]!.z - v[0]!.z;
      const ax = Math.abs(e1y * e2z - e1z * e2y);
      const ay = Math.abs(e1z * e2x - e1x * e2z);
      const az = Math.abs(e1x * e2y - e1y * e2x);
      const flat = ay > ax && ay > az && maxY - minY < 0.55 && centroid.y < 2.2;
      if (flat) {
        flats[id] = Math.min(65535, flats[id]! + 1);
        if (centroid.y < road[id]!) road[id] = centroid.y;
      } else if (maxY - minY > 1.7 && maxY > 1.5) {
        walls[id] = Math.min(65535, walls[id]! + 1);
      }
    }
  });

  const blocked = new Uint8Array(nx * nz);
  for (let i = 0; i < road.length; i++) {
    if (walls[i]! > 4 && walls[i]! > flats[i]! * 0.45) {
      blocked[i] = 1;
      road[i] = Number.POSITIVE_INFINITY;
    }
  }

  const at = (x: number, z: number) => {
    const ix = Math.floor((x - ox) / cell);
    const iz = Math.floor((z - oz) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return -1;
    return iz * nx + ix;
  };
  const isRoad = (x: number, z: number) => {
    const id = at(x, z);
    return id >= 0 && road[id]! < 1e8;
  };
  const groundY = (x: number, z: number) => {
    const id = at(x, z);
    if (id < 0) return null;
    const y = road[id]!;
    return y < 1e8 ? y : null;
  };

  const colliders: Collider[] = [];
  for (let iz = 0; iz < nz; iz++) {
    let run = -1;
    for (let ix = 0; ix <= nx; ix++) {
      const on = ix < nx && blocked[iz * nx + ix] === 1;
      if (on && run < 0) run = ix;
      if (!on && run >= 0) {
        colliders.push({
          minX: ox + run * cell + 0.25,
          maxX: ox + ix * cell - 0.25,
          minZ: oz + iz * cell + 0.25,
          maxZ: oz + (iz + 1) * cell - 0.25,
        });
        run = -1;
      }
    }
  }

  const cx = (bounds.min.x + bounds.max.x) / 2;
  const cz = (bounds.min.z + bounds.max.z) / 2;
  let spawn = { x: cx, z: cz };
  let best = Infinity;
  for (let iz = 1; iz < nz - 1; iz++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const id = iz * nx + ix;
      if (!(road[id]! < 1e8)) continue;
      let neighbors = 0;
      if (road[id - 1]! < 1e8) neighbors++;
      if (road[id + 1]! < 1e8) neighbors++;
      if (road[id - nx]! < 1e8) neighbors++;
      if (road[id + nx]! < 1e8) neighbors++;
      if (neighbors < 2) continue;
      const x = ox + (ix + 0.5) * cell;
      const z = oz + (iz + 0.5) * cell;
      const d = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d < best) {
        best = d;
        spawn = { x, z };
      }
    }
  }

  let minX = cx;
  let maxX = cx;
  let minZ = cz;
  let maxZ = cz;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      if (!(road[iz * nx + ix]! < 1e8)) continue;
      const x = ox + (ix + 0.5) * cell;
      const z = oz + (iz + 0.5) * cell;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  const snap = (x: number, z: number): Pt => {
    if (isRoad(x, z)) return { x, z };
    for (let r = 1; r <= 8; r++) {
      for (let a = 0; a < 8; a++) {
        const px = x + Math.cos((a / 8) * Math.PI * 2) * r * cell;
        const pz = z + Math.sin((a / 8) * Math.PI * 2) * r * cell;
        if (isRoad(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: spawn.x, z: spawn.z };
  };
  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const padX = Math.min(cell * 4, spanX * 0.15);
  const padZ = Math.min(cell * 4, spanZ * 0.15);
  const loop = rectLoop(minX + padX, maxX - padX, minZ + padZ, maxZ - padZ).map((p) => snap(p.x, p.z));
  const sidewalk = rectLoop(minX + padX, maxX - padX, minZ + padZ, maxZ - padZ).map((p) => snap(p.x + 6, p.z));
  return { groundY, colliders, spawn, loop, sidewalk, isRoad };
}

function rectLoop(minX: number, maxX: number, minZ: number, maxZ: number): Pt[] {
  const edges: Array<[number, number, number, number]> = [
    [minX, minZ, maxX, minZ],
    [maxX, minZ, maxX, maxZ],
    [maxX, maxZ, minX, maxZ],
    [minX, maxZ, minX, minZ],
  ];
  const pts: Pt[] = [];
  for (const [ax, az, bx, bz] of edges) {
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      pts.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t });
    }
  }
  return pts;
}

function playClips(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  const usable = clips.filter((clip) => !/camera/i.test(clip.name));
  if (!usable.length) return null;
  const mixer = new THREE.AnimationMixer(root);
  for (const clip of usable) mixer.clipAction(clip).play();
  return mixer;
}

function paintAds(root: THREE.Object3D) {
  const billboards: THREE.MeshStandardMaterial[] = [];
  let i = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const name = `${mesh.name} ${mesh.parent?.name ?? ""}`;
    if (!/advert|billboard|neon/i.test(name)) return;
    const tex = adTexture(ADS[i % ADS.length]!);
    i++;
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const mat = source?.clone?.() ?? new THREE.MeshStandardMaterial();
    mat.map = tex;
    mat.emissiveMap = tex;
    mat.emissive = new THREE.Color("#ffffff");
    mat.emissiveIntensity = 0.8;
    mesh.material = mat;
    billboards.push(mat);
  });
  return billboards;
}

async function dressGrass(group: THREE.Group, isRoad: (x: number, z: number) => boolean, colliders: Collider[]) {
  const pack = await loadModel("/models/maps/street-pack.glb");
  if (!pack) return;
  const picks: THREE.Mesh[] = [];
  pack.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || /background|sphere/i.test(mesh.name)) return;
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (max < 1 || max > 600) return;
    picks.push(mesh);
  });
  if (!picks.length) return;
  const box = new THREE.Box3().setFromObject(group);
  for (let n = 0; n < 18; n++) {
    const x = THREE.MathUtils.lerp(box.min.x + 20, box.max.x - 20, ((n * 37) % 100) / 100);
    const z = THREE.MathUtils.lerp(box.min.z + 20, box.max.z - 20, ((n * 53) % 100) / 100);
    if (isRoad(x, z)) continue;
    const src = picks[n % picks.length]!;
    const prop = src.clone(true);
    dropJunk(prop);
    const size = new THREE.Box3().setFromObject(prop).getSize(new THREE.Vector3());
    const h = Math.max(size.y, 0.01);
    prop.scale.multiplyScalar((n % 3 === 0 ? 12 : 6) / h);
    prop.position.set(x, 0, z);
    prop.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(prop);
    prop.position.y -= fitted.min.y;
    group.add(prop);
    const solid = new THREE.Box3().setFromObject(prop);
    colliders.push({
      minX: solid.min.x - 0.3,
      maxX: solid.max.x + 0.3,
      minZ: solid.min.z - 0.3,
      maxZ: solid.max.z + 0.3,
    });
  }
}

export async function loadCityMap(id: Exclude<MapId, "amir">): Promise<CityMap> {
  const meta = META[id];
  const doc = await loadGltf(meta.url);
  if (!doc) throw new Error(`Missing ${meta.url}`);
  const model = doc.scene.clone(true);
  dropJunk(model);
  const clips = doc.animations;
  const owned: THREE.BufferGeometry[] = [];
  const ownedTex: THREE.Texture[] = [];

  let root: THREE.Object3D = model;
  const mixers: THREE.AnimationMixer[] = [];
  if (id === "neon") {
    const holder = new THREE.Group();
    const size = seat(model, meta.scale).getSize(new THREE.Vector3());
    const span = size.x + 0.35;
    for (const x of [-span, 0, span]) {
      const piece = x === 0 ? model : model.clone(true);
      const wrap = new THREE.Group();
      wrap.add(piece);
      wrap.position.x = x;
      holder.add(wrap);
      const mix = playClips(piece, clips);
      if (mix) mixers.push(mix);
    }
    root = holder;
  } else if (id === "block") {
    const size = seat(model, meta.scale).getSize(new THREE.Vector3());
    const pitch = Math.max(size.x, size.z) + 2;
    const holder = new THREE.Group();
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const piece = ix === 0 && iz === 0 ? model : model.clone(true);
        const wrap = new THREE.Group();
        wrap.add(piece);
        wrap.position.set(ix * pitch, 0, iz * pitch);
        if (ix !== 0 && iz === 0) wrap.rotation.y = Math.PI / 2;
        holder.add(wrap);
        const mix = playClips(piece, clips);
        if (mix) mixers.push(mix);
      }
    }
    root = holder;
  } else {
    seat(model, meta.scale);
    const mix = playClips(model, clips);
    if (mix) mixers.push(mix);
  }

  root.userData.mixers = mixers;
  const mixer = mixers[0] ?? null;
  const group = new THREE.Group();
  group.add(root);
  group.updateMatrixWorld(true);
  calmRoads(group);
  const bounds = new THREE.Box3().setFromObject(group);
  const field = rasterCity(group, bounds);
  const colliders = field.colliders;

  if (id === "neon") {
    const pad = 2;
    const walls = [
      [bounds.min.x - pad, (bounds.min.z + bounds.max.z) / 2, 1, bounds.max.z - bounds.min.z],
      [bounds.max.x + pad, (bounds.min.z + bounds.max.z) / 2, 1, bounds.max.z - bounds.min.z],
      [(bounds.min.x + bounds.max.x) / 2, bounds.min.z - pad, bounds.max.x - bounds.min.x, 1],
      [(bounds.min.x + bounds.max.x) / 2, bounds.max.z + pad, bounds.max.x - bounds.min.x, 1],
    ] as const;
    for (const [x, z, w, d] of walls) {
      colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    }
  }

  if (id === "grid") await dressGrass(group, field.isRoad, colliders);

  const billboards = id === "neon" ? paintAds(group) : [];
  for (const mat of billboards) if (mat.map) ownedTex.push(mat.map);

  const spawn = field.spawn;
  const loop = field.loop;
  const sidewalk = field.sidewalk;
  const groundY = field.groundY;

  return {
    id,
    name: meta.name,
    blurb: meta.blurb,
    group,
    spawn: { x: spawn.x, z: spawn.z, yaw: 0 },
    colliders,
    loop,
    sidewalk,
    bounds,
    billboards,
    mixer,
    groundY,
    update: (dt, low) => {
      const mixers = (root.userData.mixers as THREE.AnimationMixer[] | undefined) ?? (mixer ? [mixer] : []);
      for (const mix of mixers) mix.update(dt);
      billboards.forEach((mat, index) => {
        mat.emissiveIntensity = low ? 0.7 : 0.4 + 1.2 * (0.5 + 0.5 * Math.sin(performance.now() / 380 + index));
      });
    },
    dispose: () => {
      group.removeFromParent();
      for (const geo of owned) geo.dispose();
      for (const tex of ownedTex) tex.dispose();
    },
  };
}
