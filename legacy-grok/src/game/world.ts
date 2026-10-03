import * as THREE from "three";
import {
  handBuildings,
  lampSpots,
  outerBuildings,
  signSpots,
  treeSpots,
  WORLD,
  type Building,
  type TileId,
  intersections,
} from "./layout";
import { dressBuildings, dressLamps, dressProp, dressStreets, dressTrees } from "./sketchfab";
import { facade, flagTexture, makeGround, signTexture } from "./textures";

export type Collider = { minX: number; maxX: number; minZ: number; maxZ: number };

export type WorldHandles = {
  ground: THREE.Mesh;
  glowMats: THREE.MeshStandardMaterial[];
  lampMat: THREE.MeshStandardMaterial;
  signal: { ns: THREE.Mesh[]; ew: THREE.Mesh[] };
  tiles: Record<TileId, { group: THREE.Group; colliders: Collider[]; built: boolean }>;
  always: THREE.Group;
  buildTile: (id: TileId) => void;
  disposeTile: (id: TileId) => void;
};

const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);

function addBox(
  parent: THREE.Object3D,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
) {
  const m = new THREE.Mesh(box, mat);
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function buildingMat(style: string, w: number, h: number) {
  const src = facade(style);
  const map = src.map.clone();
  const glowMap = src.glow.clone();
  map.colorSpace = THREE.SRGBColorSpace;
  glowMap.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  glowMap.wrapS = glowMap.wrapT = THREE.RepeatWrapping;
  const rx = Math.max(1, w / 12);
  const ry = Math.max(1, h / 10);
  map.repeat.set(rx, ry);
  glowMap.repeat.set(rx, ry);
  const mat = new THREE.MeshStandardMaterial({
    map,
    emissiveMap: glowMap,
    emissive: new THREE.Color("#ffb15a"),
    emissiveIntensity: 0,
    roughness: 0.86,
    metalness: 0.04,
  });
  return mat;
}

function addBuilding(parent: THREE.Object3D, b: Building, glow: THREE.MeshStandardMaterial[], cols: Collider[]) {
  const fallback = new THREE.Group();
  parent.add(fallback);
  const mat = buildingMat(b.style, b.w, b.h);
  glow.push(mat);
  const mesh = addBox(fallback, mat, b.x, b.h / 2, b.z, b.w, b.h, b.d);
  mesh.rotation.y = b.rot;
  const roof = new THREE.MeshStandardMaterial({ color: "#6e675e", roughness: 0.9 });
  addBox(fallback, roof, b.x, b.h + 0.15, b.z, b.w * 1.02, 0.3, b.d * 1.02);
  if (b.style === "shop") {
    const names = ["NON", "OSH", "APTEKA", "TELEFON"];
    const label = names[Math.abs(Math.round(b.z)) % names.length]!;
    const cloth = new THREE.MeshStandardMaterial({ color: label === "NON" ? "#c4513a" : label === "OSH" ? "#1e8f7b" : label === "APTEKA" ? "#2f6d3a" : "#2c3e50", roughness: 0.7 });
    addBox(fallback, cloth, b.x - b.w / 2 - 0.4, b.h * 0.45, b.z, 1.1, 0.12, b.d * 0.72);
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 96;
    const g = c.getContext("2d")!;
    g.fillStyle = "#1a120c";
    g.fillRect(0, 0, 256, 96);
    g.fillStyle = "#f4ecdc";
    g.font = "700 42px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 128, 48);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.7, 0.7), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    board.position.set(b.x - b.w / 2 - 0.08, b.h * 0.62, b.z);
    board.rotation.y = -Math.PI / 2;
    fallback.add(board);
  }
  cols.push({
    minX: b.x - b.w / 2,
    maxX: b.x + b.w / 2,
    minZ: b.z - b.d / 2,
    maxZ: b.z + b.d / 2,
  });
  return { building: b, fallback };
}

function buildHotel(parent: THREE.Object3D, glow: THREE.MeshStandardMaterial[], cols: Collider[]) {
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#1c6f78",
    metalness: 0.35,
    roughness: 0.12,
    clearcoat: 0.6,
    transparent: true,
    opacity: 0.92,
  });
  glow.push(glass as unknown as THREE.MeshStandardMaterial);
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.22;
    const x = 118 + Math.cos(a) * 6;
    const z = Math.sin(a) * 36;
    addBox(parent, glass, x, 22, z, 10, 44, 14);
    cols.push({ minX: x - 6, maxX: x + 6, minZ: z - 8, maxZ: z + 8 });
  }
  const signC = document.createElement("canvas");
  signC.width = 512;
  signC.height = 96;
  const sg = signC.getContext("2d")!;
  sg.fillStyle = "#1a120c";
  sg.fillRect(0, 0, 512, 96);
  sg.fillStyle = "#f0d48a";
  sg.font = "700 42px sans-serif";
  sg.textAlign = "center";
  sg.textBaseline = "middle";
  sg.fillText("HOTEL UZBEKISTAN", 256, 50);
  const tex = new THREE.CanvasTexture(signC);
  tex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissiveMap: tex,
    emissive: "#ffd27a",
    emissiveIntensity: 0.2,
    roughness: 0.5,
  });
  glow.push(signMat);
  const sign = addBox(parent, signMat, 112, 46.2, 0, 0.4, 2.2, 22);
  sign.rotation.y = Math.PI / 2;
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.7 }));
  flag.position.set(128, 48, 18);
  parent.add(flag);
}

function buildMajlis(parent: THREE.Object3D, glow: THREE.MeshStandardMaterial[], cols: Collider[]) {
  const stone = new THREE.MeshStandardMaterial({ color: "#e7e0d4", roughness: 0.8 });
  const gold = new THREE.MeshStandardMaterial({ color: "#c6a15a", metalness: 0.4, roughness: 0.45 });
  addBox(parent, stone, 0, 4, -214, 54, 8, 22);
  cols.push({ minX: -28, maxX: 28, minZ: -226, maxZ: -202 });
  const colMat = new THREE.MeshStandardMaterial({ color: "#f4efe6", roughness: 0.6 });
  for (let i = -4; i <= 4; i++) {
    const c = new THREE.Mesh(cyl, colMat);
    c.position.set(i * 5.2, 6, -204);
    c.scale.set(0.45, 8, 0.45);
    parent.add(c);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#2f7ea8", roughness: 0.35, metalness: 0.2 }));
  dome.position.set(0, 8.2, -214);
  parent.add(dome);
  const signC = document.createElement("canvas");
  signC.width = 512;
  signC.height = 80;
  const g = signC.getContext("2d")!;
  g.fillStyle = "#10261c";
  g.fillRect(0, 0, 512, 80);
  g.fillStyle = "#f4ecdc";
  g.font = "700 40px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("OLIY MAJLIS", 256, 42);
  const tex = new THREE.CanvasTexture(signC);
  tex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: "#d4b06a", emissiveIntensity: 0.15, roughness: 0.6 });
  glow.push(signMat);
  addBox(parent, signMat, 0, 9.2, -202.6, 16, 2.2, 0.3);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 2.1), new THREE.MeshStandardMaterial({ map: flagTexture(), side: THREE.DoubleSide, roughness: 0.7 }));
  flag.position.set(8, 16, -214);
  parent.add(flag);
  const pole = new THREE.Mesh(cyl, gold);
  pole.position.set(6, 12, -214);
  pole.scale.set(0.08, 12, 0.08);
  parent.add(pole);
}

function buildTower(parent: THREE.Object3D, cols: Collider[]) {
  const stone = new THREE.MeshStandardMaterial({ color: "#d5d0c6", roughness: 0.7 });
  const shaft = new THREE.Mesh(cyl, new THREE.MeshStandardMaterial({ color: "#1e8f7b", roughness: 0.45, metalness: 0.2 }));
  shaft.position.set(214, 42, -214);
  shaft.scale.set(1.6, 70, 1.6);
  parent.add(shaft);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(4.2, 18, 12), stone);
  cap.position.set(214, 72, -214);
  parent.add(cap);
  const spire = new THREE.Mesh(cyl, stone);
  spire.position.set(214, 86, -214);
  spire.scale.set(0.15, 20, 0.15);
  parent.add(spire);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(cyl, stone);
    leg.position.set(214 + Math.cos(a) * 7, 8, -214 + Math.sin(a) * 7);
    leg.scale.set(0.45, 16, 0.45);
    leg.lookAt(214, 20, -214);
    parent.add(leg);
  }
  cols.push({ minX: 210, maxX: 218, minZ: -218, maxZ: -210 });
}

function buildGas(parent: THREE.Object3D, glow: THREE.MeshStandardMaterial[]) {
  const wall = new THREE.MeshStandardMaterial({ color: "#f2efe8", roughness: 0.6 });
  const canopy = new THREE.MeshStandardMaterial({ color: "#c4513a", roughness: 0.5, emissive: "#c4513a", emissiveIntensity: 0.05 });
  glow.push(canopy);
  addBox(parent, wall, -210, 3, -108, 12, 6, 8);
  addBox(parent, canopy, -196, 4.6, -108, 16, 0.35, 12);
  for (const x of [-200, -192]) {
    addBox(parent, wall, x, 2.2, -108, 0.35, 4.2, 0.35);
    addBox(parent, new THREE.MeshStandardMaterial({ color: "#2a2e32", roughness: 0.5 }), x, 1.1, -104.5, 0.7, 1.4, 0.5);
  }
}

function buildMonument(parent: THREE.Object3D, cols: Collider[]) {
  const stone = new THREE.MeshStandardMaterial({ color: "#d9d1c3", roughness: 0.78 });
  const bronze = new THREE.MeshStandardMaterial({ color: "#8a6239", metalness: 0.55, roughness: 0.38 });
  addBox(parent, stone, 0, 1.6, 0, 7.2, 3.2, 4.6);
  addBox(parent, stone, 0, 3.5, 0, 5.4, 0.7, 3.4);
  const body = new THREE.Mesh(box, bronze);
  body.position.set(0, 5.1, 0);
  body.scale.set(1.1, 0.9, 2.4);
  parent.add(body);
  const head = new THREE.Mesh(box, bronze);
  head.position.set(0, 5.7, -1.15);
  head.scale.set(0.45, 0.7, 0.7);
  head.rotation.x = -0.5;
  parent.add(head);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), bronze);
  nose.position.set(0, 6.15, -1.45);
  parent.add(nose);
  for (const x of [-0.35, 0.35]) {
    const arm = new THREE.Mesh(box, bronze);
    arm.position.set(x, 4.15, 0.55);
    arm.scale.set(0.18, 1.3, 0.18);
    parent.add(arm);
    const arm2 = arm.clone();
    arm2.position.z = -0.45;
    parent.add(arm2);
  }
  const torso = new THREE.Mesh(box, bronze);
  torso.position.set(0, 6.15, -0.1);
  torso.scale.set(0.55, 0.9, 0.4);
  parent.add(torso);
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), bronze);
  top.position.set(0, 6.75, -0.1);
  parent.add(top);
  const plaque = document.createElement("canvas");
  plaque.width = 256;
  plaque.height = 64;
  const g = plaque.getContext("2d")!;
  g.fillStyle = "#d9d1c3";
  g.fillRect(0, 0, 256, 64);
  g.fillStyle = "#3a2a1c";
  g.font = "700 28px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("AMIR TEMUR", 128, 34);
  const pm = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(plaque), roughness: 0.7 });
  pm.map!.colorSpace = THREE.SRGBColorSpace;
  const p = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7), pm);
  p.position.set(0, 2.2, 2.32);
  parent.add(p);
  cols.push({ minX: -3.8, maxX: 3.8, minZ: -2.6, maxZ: 2.6 });
  const basin = new THREE.MeshStandardMaterial({ color: "#cfc6b8", roughness: 0.75 });
  const water = new THREE.MeshStandardMaterial({ color: "#2f6f86", metalness: 0.2, roughness: 0.18 });
  addBox(parent, basin, 0, 0.35, -8.5, 7.2, 0.7, 7.2);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 20), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0, 0.72, -8.5);
  parent.add(pool);
}

function buildSigns(parent: THREE.Object3D) {
  const poleMat = new THREE.MeshStandardMaterial({ color: "#8d9390", metalness: 0.4, roughness: 0.45 });
  for (const s of signSpots()) {
    const pole = new THREE.Mesh(cyl, poleMat);
    pole.position.set(s.x, 1.6, s.z);
    pole.scale.set(0.06, 3.2, 0.06);
    parent.add(pole);
    const mat = new THREE.MeshStandardMaterial({ map: signTexture(s.text, s.kind), roughness: 0.55, metalness: 0.05 });
    const w = s.kind === "speed" || s.kind === "stop" ? 1.15 : 2.1;
    const h = s.kind === "speed" || s.kind === "stop" ? 1.15 : 1.15;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    board.position.set(s.x, 3.15, s.z);
    board.rotation.y = s.yaw;
    parent.add(board);
    void dressProp(parent, "sign", s.x, s.z, s.yaw, 3.1).then((ok) => {
      if (ok) pole.visible = false;
    });
  }
}

function buildSignals(parent: THREE.Object3D) {
  const dark = new THREE.MeshStandardMaterial({ color: "#1c1f22", roughness: 0.5, metalness: 0.3 });
  const off = new THREE.MeshStandardMaterial({ color: "#2a2a2a", emissive: "#111", emissiveIntensity: 0.2 });
  const redOn = new THREE.MeshStandardMaterial({ color: "#ff2a2a", emissive: "#ff1a1a", emissiveIntensity: 1.4 });
  const yelOn = new THREE.MeshStandardMaterial({ color: "#ffcc33", emissive: "#ffbb22", emissiveIntensity: 1.3 });
  const grnOn = new THREE.MeshStandardMaterial({ color: "#37d26a", emissive: "#22ee66", emissiveIntensity: 1.3 });
  const ns: THREE.Mesh[] = [];
  const ew: THREE.Mesh[] = [];
  const bulbGeo = new THREE.SphereGeometry(0.16, 10, 8);
  for (const p of intersections()) {
    const pole = new THREE.Mesh(cyl, dark);
    pole.position.set(p.x + 12, 2.6, p.z + 12);
    pole.scale.set(0.08, 5.2, 0.08);
    parent.add(pole);
    const head = new THREE.Mesh(box, dark);
    head.position.set(p.x + 12, 5.1, p.z + 11.2);
    head.scale.set(0.38, 1.15, 0.38);
    parent.add(head);
    const cols = [redOn, yelOn, grnOn];
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bulbGeo, off);
      b.position.set(p.x + 12, 5.45 - i * 0.34, p.z + 10.95);
      b.userData.role = i;
      b.userData.axis = "ns";
      parent.add(b);
      ns.push(b);
    }
    const head2 = head.clone();
    head2.position.set(p.x + 11.2, 5.1, p.z + 12);
    parent.add(head2);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(bulbGeo, off);
      b.position.set(p.x + 10.95, 5.45 - i * 0.34, p.z + 12);
      b.userData.role = i;
      b.userData.axis = "ew";
      parent.add(b);
      ew.push(b);
    }
    void cols;
  }
  return {
    ns,
    ew,
    mats: { off, redOn, yelOn, grnOn },
  };
}

function label(parent: THREE.Object3D, text: string, x: number, y: number, z: number, yaw = 0) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const g = c.getContext("2d")!;
  g.fillStyle = "#142018";
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = "#f4ecdc";
  g.font = "700 40px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 50);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  mesh.position.set(x, y, z);
  mesh.rotation.y = yaw;
  parent.add(mesh);
}

function buildMinor(parent: THREE.Object3D) {
  const stone = new THREE.MeshStandardMaterial({ color: "#d9d3c6", roughness: 0.8 });
  const blue = new THREE.MeshStandardMaterial({ color: "#1d4e89", roughness: 0.45, metalness: 0.1 });
  addBox(parent, stone, 200, 0.4, 40, 10, 0.8, 8);
  addBox(parent, stone, 200, 0.9, 44, 6, 0.25, 2);
  addBox(parent, stone, 200, 1.3, 46, 4.5, 0.25, 2);
  const m = label(parent, "M", 200, 3.2, 36);
  void m;
  addBox(parent, blue, 200, 2.4, 36.2, 1.6, 1.6, 0.2);
}

function buildMustaqillik(parent: THREE.Object3D) {
  const stone = new THREE.MeshStandardMaterial({ color: "#efe8dc", roughness: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: "#c6a15a", metalness: 0.45, roughness: 0.4 });
  addBox(parent, stone, -8, 4, -310, 1.4, 8, 1.4);
  addBox(parent, stone, 8, 4, -310, 1.4, 8, 1.4);
  addBox(parent, gold, 0, 8.4, -310, 18, 0.6, 1.6);
  const water = new THREE.Mesh(new THREE.CircleGeometry(6, 20), new THREE.MeshStandardMaterial({ color: "#3d7d92", roughness: 0.2, metalness: 0.15 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.08, -296);
  parent.add(water);
  label(parent, "MUSTAQILLIK", 0, 6.2, -308.8);
}

function buildChorsu(parent: THREE.Object3D) {
  const brick = new THREE.MeshStandardMaterial({ color: "#8d5a45", roughness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: "#c4513a", roughness: 0.75, side: THREE.DoubleSide });
  addBox(parent, brick, -6, 3, 260, 1.2, 6, 1.2);
  addBox(parent, brick, 6, 3, 260, 1.2, 6, 1.2);
  addBox(parent, brick, 0, 6.2, 260, 14, 0.5, 1.4);
  const awning = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), cloth);
  awning.position.set(8, 3.2, 268);
  awning.rotation.x = 0.4;
  parent.add(awning);
  addBox(parent, new THREE.MeshStandardMaterial({ color: "#e6d3a2", roughness: 0.8 }), 10, 0.7, 270, 2.2, 1.2, 1.4);
  addBox(parent, new THREE.MeshStandardMaterial({ color: "#d8c4a0", roughness: 0.8 }), 14, 0.6, 272, 1.6, 1, 1.2);
  label(parent, "CHORSU", 0, 5.2, 259.2);
}

function buildCanal(parent: THREE.Object3D) {
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 160),
    new THREE.MeshStandardMaterial({ color: "#1c3d48", metalness: 0.35, roughness: 0.22 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(-400, 0.05, 20);
  parent.add(water);
  const bank = new THREE.MeshStandardMaterial({ color: "#8d8678", roughness: 0.9 });
  addBox(parent, bank, -392, 0.25, 20, 1.2, 0.5, 160);
  addBox(parent, bank, -408, 0.25, 20, 1.2, 0.5, 160);
}

function buildOsh(parent: THREE.Object3D) {
  const wall = new THREE.MeshStandardMaterial({ color: "#e4d3b0", roughness: 0.85 });
  const cloth = new THREE.MeshStandardMaterial({ color: "#1e8f7b", roughness: 0.7 });
  addBox(parent, wall, -176, 2.2, -148, 8, 4.4, 6);
  addBox(parent, cloth, -176, 4.6, -144.6, 8.4, 0.15, 2.4);
  label(parent, "OSHXONA", -176, 3.4, -144.8, 0);
}

export function createWorld(scene: THREE.Scene): WorldHandles & {
  signalMats: { off: THREE.Material; redOn: THREE.Material; yelOn: THREE.Material; grnOn: THREE.Material };
} {
  const glowMats: THREE.MeshStandardMaterial[] = [];
  const groundTex = makeGround();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD, WORLD),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.92, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const always = new THREE.Group();
  scene.add(always);
  buildSigns(always);
  const signals = buildSignals(always);
  buildMonument(always, []);
  const centerCols: Collider[] = [{ minX: -3.8, maxX: 3.8, minZ: -2.6, maxZ: 2.6 }];

  const lampMat = new THREE.MeshStandardMaterial({
    color: "#f6e2b5",
    emissive: "#ffd28a",
    emissiveIntensity: 0,
    roughness: 0.4,
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: "#5c6562", metalness: 0.35, roughness: 0.5 });
  const lamps = lampSpots();
  const poles = new THREE.InstancedMesh(cyl, poleMat, lamps.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 8), lampMat, lamps.length);
  const dummy = new THREE.Object3D();
  lamps.forEach((l, i) => {
    dummy.position.set(l.x, 2.7, l.z);
    dummy.scale.set(0.07, 5.4, 0.07);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(l.x, 5.5, l.z);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  });
  always.add(poles, heads);
  void dressLamps(always, lamps, [poles, heads]);
  void dressStreets(always);

  const trees = treeSpots();
  const byTile: Record<TileId, { buildings: Building[]; trees: typeof trees }> = {
    center: { buildings: handBuildings(), trees: [] },
    north: { buildings: [], trees: [] },
    south: { buildings: [], trees: [] },
    east: { buildings: [], trees: [] },
    west: { buildings: [], trees: [] },
  };
  for (const b of outerBuildings()) byTile[b.tile].buildings.push(b);
  for (const t of trees) byTile[t.tile].trees.push(t);

  const tiles = {} as WorldHandles["tiles"];
  (Object.keys(byTile) as TileId[]).forEach((id) => {
    tiles[id] = { group: new THREE.Group(), colliders: id === "center" ? centerCols : [], built: false };
  });

  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 1, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b5344", roughness: 0.9 });
  const leafMatA = new THREE.MeshStandardMaterial({ color: "#2f6d3a", roughness: 0.85 });
  const leafMatB = new THREE.MeshStandardMaterial({ color: "#3e7a44", roughness: 0.85 });
  const leafGeo = new THREE.IcosahedronGeometry(1, 0);
  const cone = new THREE.ConeGeometry(0.7, 2.4, 7);

  function fillTile(id: TileId) {
    const tile = tiles[id];
    const data = byTile[id];
    const g = tile.group;
    if (id === "center") {
      buildHotel(g, glowMats, tile.colliders);
    }
    if (id === "north") {
      buildMajlis(g, glowMats, tile.colliders);
      buildMustaqillik(g);
    }
    if (id === "east") {
      buildTower(g, tile.colliders);
      buildMinor(g);
    }
    if (id === "west") {
      buildGas(g, glowMats);
      buildCanal(g);
      buildOsh(g);
    }
    if (id === "south") buildChorsu(g);
    const queue = data.buildings.map((b) => addBuilding(g, b, glowMats, tile.colliders));
    void dressBuildings(g, queue);
    if (data.trees.length) {
      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, data.trees.length);
      const broad = data.trees.filter((t) => t.k === "plane").length;
      const poplars = data.trees.length - broad;
      const leaves = broad ? new THREE.InstancedMesh(leafGeo, leafMatA, broad) : null;
      const pops = poplars ? new THREE.InstancedMesh(cone, leafMatB, poplars) : null;
      const d = new THREE.Object3D();
      let bi = 0;
      let pi = 0;
      data.trees.forEach((t, i) => {
        const h = t.k === "poplar" ? 7.5 * t.s : 4.2 * t.s;
        d.position.set(t.x, h / 2, t.z);
        d.scale.set(t.s, h, t.s);
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        trunks.setMatrixAt(i, d.matrix);
        tile.colliders.push({ minX: t.x - 0.45, maxX: t.x + 0.45, minZ: t.z - 0.45, maxZ: t.z + 0.45 });
        if (t.k === "plane" && leaves) {
          d.position.set(t.x, h + 1.1 * t.s, t.z);
          d.scale.set(1.7 * t.s, 1.25 * t.s, 1.7 * t.s);
          d.updateMatrix();
          leaves.setMatrixAt(bi++, d.matrix);
        } else if (pops) {
          d.position.set(t.x, h + 0.6, t.z);
          d.scale.set(t.s, t.s, t.s);
          d.updateMatrix();
          pops.setMatrixAt(pi++, d.matrix);
        }
      });
      g.add(trunks);
      if (leaves) g.add(leaves);
      if (pops) g.add(pops);
      const hide: THREE.Object3D[] = [trunks];
      if (leaves) hide.push(leaves);
      if (pops) hide.push(pops);
      void dressTrees(g, data.trees, hide);
    }
    if (id === "center") {
      const benchMat = new THREE.MeshStandardMaterial({ color: "#6a4b32", roughness: 0.8 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        const x = Math.cos(a) * 20;
        const z = Math.sin(a) * 20;
        const bench = addBox(g, benchMat, x, 0.4, z, 1.4, 0.12, 0.45);
        void dressProp(g, "bench", x, z, a + Math.PI / 2, 0.9).then((ok) => {
          if (ok) bench.visible = false;
        });
      }
      const bin = new THREE.MeshStandardMaterial({ color: "#2f6d62", roughness: 0.6 });
      for (const p of [
        [22, 8],
        [-18, 14],
        [8, -22],
      ] as const) {
        const mesh = addBox(g, bin, p[0], 0.45, p[1], 0.45, 0.9, 0.45);
        void dressProp(g, "bin", p[0], p[1], 0, 1.05).then((ok) => {
          if (ok) mesh.visible = false;
        });
      }
      const shelter = new THREE.MeshStandardMaterial({ color: "#d9d3c7", roughness: 0.55 });
      const glass = new THREE.MeshStandardMaterial({
        color: "#9fd0c6",
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
      });
      addBox(g, shelter, 92, 2.3, 24, 3.2, 0.12, 1.4);
      addBox(g, glass, 92, 1.2, 24.5, 3, 1.8, 0.08);
      addBox(g, shelter, -92, 2.3, -18, 3.2, 0.12, 1.4);
      const canopy = new THREE.MeshStandardMaterial({ color: "#c4513a", roughness: 0.45, metalness: 0.1 });
      glowMats.push(canopy);
      addBox(g, canopy, -8, 3.4, 124, 10, 0.18, 7);
      addBox(g, shelter, -12.6, 1.7, 124, 0.25, 3.3, 0.25);
      addBox(g, shelter, -3.4, 1.7, 124, 0.25, 3.3, 0.25);
      const ads = ["OLTIN BOZOR", "MILLIY TAOM", "APTEKA", "UZTELECOM"];
      ads.forEach((label, i) => {
        const c = document.createElement("canvas");
        c.width = 512;
        c.height = 160;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = i % 2 ? "#1a3a32" : "#6b1d28";
        ctx.fillRect(0, 0, 512, 160);
        ctx.fillStyle = "#f4ecdc";
        ctx.font = "700 54px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 256, 80);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffd7a1", emissiveMap: tex, emissiveIntensity: 0.15, roughness: 0.6 });
        glowMats.push(mat);
        const board = addBox(g, mat, -108, 4.2, -36 + i * 18, 0.2, 1.6, 4.2);
        board.rotation.y = Math.PI / 2;
      });
    }
    tile.built = true;
  }

  function buildTile(id: TileId) {
    const tile = tiles[id];
    if (!tile.built) fillTile(id);
    if (!tile.group.parent) scene.add(tile.group);
  }

  function disposeTile(id: TileId) {
    const tile = tiles[id];
    if (tile.group.parent) scene.remove(tile.group);
  }

  buildTile("center");

  return {
    ground,
    glowMats,
    lampMat,
    signal: { ns: signals.ns, ew: signals.ew },
    signalMats: signals.mats,
    tiles,
    always,
    buildTile,
    disposeTile,
  };
}
