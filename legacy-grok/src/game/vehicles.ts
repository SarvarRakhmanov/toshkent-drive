import * as THREE from "three";
import { dropJunk, loadModel, placeCar } from "./assets";
import { dashTexture, plateTexture } from "./textures";

export type VehicleId = "seltos" | "cobalt" | "malibu" | "k5" | "sportage" | "lacetti" | "m3";

export type VehicleSpec = {
  id: VehicleId;
  name: string;
  kind: "suv" | "sedan" | "long" | "fast" | "suv2" | "lacetti" | "m3";
  price: number;
  mass: number;
  accel: number;
  brake: number;
  top: number;
  handling: number;
  blurb: string;
};

export const CATALOG: VehicleSpec[] = [
  {
    id: "seltos",
    name: "Kia Seltos",
    kind: "suv",
    price: 0,
    mass: 1385,
    accel: 7.6,
    brake: 10,
    top: 175,
    handling: 0.76,
    blurb: "2022 Seltos, your model. Standard pace.",
  },
  {
    id: "cobalt",
    name: "Chevrolet Cobalt",
    kind: "sedan",
    price: 1600,
    mass: 1120,
    accel: 7.2,
    brake: 9,
    top: 165,
    handling: 0.7,
    blurb: "The everyday Tashkent sedan.",
  },
  {
    id: "malibu",
    name: "Chevrolet Malibu",
    kind: "long",
    price: 2800,
    mass: 1450,
    accel: 7.6,
    brake: 9.2,
    top: 190,
    handling: 0.66,
    blurb: "Longer cabin, softer ride.",
  },
  {
    id: "k5",
    name: "Kia K5",
    kind: "fast",
    price: 3600,
    mass: 1480,
    accel: 8.8,
    brake: 10.2,
    top: 210,
    handling: 0.78,
    blurb: "Fastback. Quicker through the boulevards.",
  },
  {
    id: "sportage",
    name: "Kia Sportage",
    kind: "suv2",
    price: 4200,
    mass: 1650,
    accel: 7.4,
    brake: 9.4,
    top: 185,
    handling: 0.68,
    blurb: "Taller SUV. More presence, more mass.",
  },
  {
    id: "lacetti",
    name: "Chevrolet Lacetti",
    kind: "lacetti",
    price: 0,
    mass: 1240,
    accel: 6.4,
    brake: 8.6,
    top: 172,
    handling: 0.72,
    blurb: "Compact sedan. The everyday Tashkent Lacetti.",
  },
  {
    id: "m3",
    name: "BMW M3",
    kind: "m3",
    price: 9000,
    mass: 1550,
    accel: 9.4,
    brake: 11.5,
    top: 250,
    handling: 0.9,
    blurb: "E30 M3. Rear-drive, loose if you push it.",
  },
];

export type VehicleMesh = {
  root: THREE.Group;
  chassis: THREE.Group;
  paint: THREE.MeshPhysicalMaterial;
  glass: THREE.MeshPhysicalMaterial;
  wheels: THREE.Object3D[];
  frontPivots: THREE.Object3D[];
  brake: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  head: THREE.MeshStandardMaterial;
  indL: THREE.MeshStandardMaterial;
  indR: THREE.MeshStandardMaterial;
  plate: THREE.Mesh;
  plateMat: THREE.MeshStandardMaterial;
  dashPaint: (kmh: number, gear: string) => void;
  length: number;
  radius: number;
  tickWheels: (dt: number, speed: number, steer: number) => void;
  tickDriver?: (dt: number) => void;
  bodyLights?: {
    head: THREE.MeshStandardMaterial[];
    brake: THREE.MeshStandardMaterial[];
    indL: THREE.MeshStandardMaterial[];
    indR: THREE.MeshStandardMaterial[];
    paint: THREE.MeshStandardMaterial[];
    glass: THREE.MeshStandardMaterial[];
  };
};

const _box = new THREE.BoxGeometry(1, 1, 1);
const _cyl = new THREE.CylinderGeometry(1, 1, 1, 16);

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function createVehicle(kind: VehicleSpec["kind"], paintHex: string, tint: number, plateText: string): VehicleMesh {
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(paintHex),
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 0.85,
    clearcoatRoughness: 0.16,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: "#9eb0bc",
    metalness: 0.1,
    roughness: 0.05,
    transparent: true,
    opacity: THREE.MathUtils.clamp(tint, 0.25, 0.72),
  });
  const black = new THREE.MeshStandardMaterial({ color: "#1a1c1e", roughness: 0.6, metalness: 0.2 });
  const plastic = new THREE.MeshStandardMaterial({ color: "#2a2e32", roughness: 0.78, metalness: 0.05 });
  const chrome = new THREE.MeshStandardMaterial({ color: "#d5d8dc", metalness: 0.9, roughness: 0.22 });
  const head = new THREE.MeshStandardMaterial({ color: "#f4f7ff", emissive: "#dce7ff", emissiveIntensity: 0.15, roughness: 0.3 });
  const brake = new THREE.MeshStandardMaterial({ color: "#3a0c0c", emissive: "#ff2a1a", emissiveIntensity: 0.05, roughness: 0.4 });
  const reverse = new THREE.MeshStandardMaterial({ color: "#e8e8e8", emissive: "#ffffff", emissiveIntensity: 0, roughness: 0.35 });
  const indL = new THREE.MeshStandardMaterial({ color: "#4a3208", emissive: "#ff9a1a", emissiveIntensity: 0, roughness: 0.4 });
  const indR = indL.clone();
  const tire = new THREE.MeshStandardMaterial({ color: "#1b1b1b", roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: "#c5c8cc", metalness: 0.8, roughness: 0.28 });

  const suv = kind === "suv" || kind === "suv2";
  const len = kind === "long" ? 4.85 : kind === "fast" ? 4.7 : kind === "lacetti" ? 4.51 : kind === "m3" ? 4.36 : kind === "sedan" ? 4.3 : kind === "suv2" ? 4.66 : 4.37;
  const wid = suv ? (kind === "suv2" ? 1.9 : 1.8) : kind === "m3" ? 1.68 : 1.76;
  const ride = suv ? 0.36 : kind === "m3" ? 0.26 : 0.3;
  const bodyH = suv ? 0.72 : kind === "m3" ? 0.46 : 0.52;
  const cabinH = suv ? 0.48 : 0.42;
  const cabinZ = kind === "fast" ? 0.15 : suv ? 0.2 : 0.05;
  const cabinLen = kind === "fast" ? 2.15 : suv ? 1.9 : 1.85;

  chassis.add(mesh(_box, paint, 0, ride + 0.22, 0.05, wid * 0.98, 0.28, len * 0.96));
  chassis.add(mesh(_box, paint, 0, ride + bodyH * 0.45, -0.05, wid * 0.96, bodyH * 0.55, len * 0.9));
  chassis.add(mesh(_box, paint, 0, ride + bodyH * 0.72, cabinZ, wid * 0.9, cabinH, cabinLen));
  const hood = mesh(_box, paint, 0, ride + bodyH * 0.58, -len * 0.22, wid * 0.92, suv ? 0.18 : 0.12, len * 0.42);
  hood.rotation.x = suv ? -0.16 : -0.28;
  chassis.add(hood);
  const deck = mesh(_box, paint, 0, ride + bodyH * 0.55, len * 0.28, wid * 0.9, suv ? 0.14 : 0.1, len * 0.28);
  deck.rotation.x = suv ? 0.08 : 0.22;
  chassis.add(deck);
  chassis.add(mesh(_box, black, 0, ride + bodyH * 0.95 + cabinH * 0.45, cabinZ + 0.02, wid * 0.82, 0.06, cabinLen * 0.86));

  chassis.add(mesh(_box, glass, 0, ride + bodyH * 0.78, cabinZ + 0.02, wid * 0.84, cabinH * 0.72, cabinLen * 0.78));
  chassis.add(mesh(_box, glass, 0, ride + bodyH * 0.7, -len * 0.28, wid * 0.78, 0.28, 0.06));
  chassis.add(mesh(_box, glass, 0, ride + bodyH * 0.78, len * 0.28, wid * 0.7, 0.26, 0.05));

  chassis.add(mesh(_box, plastic, 0, ride + 0.28, -len * 0.46, wid * 0.92, 0.22, 0.28));
  chassis.add(mesh(_box, plastic, 0, ride + 0.3, len * 0.46, wid * 0.94, 0.26, 0.22));
  chassis.add(mesh(_box, plastic, -wid * 0.48, ride + 0.32, 0, 0.08, 0.22, len * 0.7));
  chassis.add(mesh(_box, plastic, wid * 0.48, ride + 0.32, 0, 0.08, 0.22, len * 0.7));

  const grille = mesh(_box, black, 0, ride + 0.48, -len * 0.5, wid * 0.62, suv ? 0.32 : 0.22, 0.06);
  chassis.add(grille);
  for (let i = 0; i < 4; i++) {
    chassis.add(mesh(_box, chrome, 0, ride + 0.36 + i * 0.07, -len * 0.505, wid * 0.5, 0.02, 0.03));
  }
  const badge = document.createElement("canvas");
  badge.width = 128;
  badge.height = 64;
  const bg = badge.getContext("2d")!;
  bg.fillStyle = "#111";
  bg.fillRect(0, 0, 128, 64);
  bg.fillStyle = "#f4ecdc";
  bg.font = "700 28px sans-serif";
  bg.textAlign = "center";
  bg.textBaseline = "middle";
  bg.fillText(kind === "m3" ? "BMW" : kind === "lacetti" || kind === "sedan" || kind === "long" ? "GM" : "KIA", 64, 34);
  const badgeTex = new THREE.CanvasTexture(badge);
  badgeTex.colorSpace = THREE.SRGBColorSpace;
  const badgeMat = new THREE.MeshStandardMaterial({ map: badgeTex, roughness: 0.4, metalness: 0.4 });
  const badgeMesh = mesh(new THREE.PlaneGeometry(0.36, 0.16), badgeMat, 0, ride + 0.5, -len * 0.512, 1, 1, 1);
  badgeMesh.rotation.y = Math.PI;
  chassis.add(badgeMesh);

  function word(label: string, w: number, h: number, fg: string, bg: string) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = fg;
    g.font = "700 36px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.35 });
    return mesh(new THREE.PlaneGeometry(w, h), mat, 0, 0, 0, 1, 1, 1);
  }

  if (kind === "suv") {
    chassis.add(mesh(_box, head, -wid * 0.3, ride + 0.52, -len * 0.502, 0.46, 0.055, 0.04));
    chassis.add(mesh(_box, head, wid * 0.3, ride + 0.52, -len * 0.502, 0.46, 0.055, 0.04));
    chassis.add(mesh(_box, chrome, -wid * 0.3, ride + 0.58, -len * 0.5, 0.5, 0.02, 0.03));
    chassis.add(mesh(_box, chrome, wid * 0.3, ride + 0.58, -len * 0.5, 0.5, 0.02, 0.03));
    chassis.add(mesh(_box, indL, -wid * 0.46, ride + 0.34, -len * 0.49, 0.12, 0.07, 0.04));
    chassis.add(mesh(_box, indR, wid * 0.46, ride + 0.34, -len * 0.49, 0.12, 0.07, 0.04));
    chassis.add(mesh(_box, chrome, 0, ride + 0.14, -len * 0.48, wid * 0.62, 0.07, 0.12));

    const barY = ride + bodyH * 0.9;
    chassis.add(mesh(_box, brake, 0, barY, len * 0.502, wid * 0.82, 0.05, 0.04));
    chassis.add(mesh(_box, brake, -wid * 0.44, barY - 0.12, len * 0.498, 0.07, 0.26, 0.035));
    chassis.add(mesh(_box, brake, wid * 0.44, barY - 0.12, len * 0.498, 0.07, 0.26, 0.035));
    const kia = word("KIA", 0.42, 0.1, "#f4f1ea", "#1a1a1a");
    kia.position.set(0, barY, len * 0.526);
    chassis.add(kia);
    const seltos = word("SELTOS", 0.42, 0.08, "#e8e4dc", "#2a2e32");
    seltos.position.set(-wid * 0.28, ride + 0.62, len * 0.524);
    chassis.add(seltos);
    chassis.add(mesh(_box, plastic, 0, ride + 0.22, len * 0.5, wid * 0.9, 0.16, 0.08));
    chassis.add(mesh(_box, chrome, 0, ride + 0.12, len * 0.51, wid * 0.55, 0.06, 0.08));
    chassis.add(mesh(_box, reverse, 0, ride + 0.1, len * 0.54, 0.12, 0.04, 0.03));
    const fin = mesh(_box, black, 0, ride + bodyH + cabinH + 0.14, -0.2, 0.07, 0.1, 0.16,);
    chassis.add(fin);
    chassis.add(mesh(_box, black, -wid * 0.34, ride + bodyH + cabinH + 0.07, 0.05, 0.05, 0.04, cabinLen * 0.85));
    chassis.add(mesh(_box, black, wid * 0.34, ride + bodyH + cabinH + 0.07, 0.05, 0.05, 0.04, cabinLen * 0.85));
    const wiper = mesh(_box, black, 0.15, ride + bodyH * 0.7, len * 0.3, 0.02, 0.02, 0.42);
    wiper.rotation.y = 0.35;
    chassis.add(wiper);
  } else {
    chassis.add(mesh(_box, head, -wid * 0.32, ride + 0.48, -len * 0.5, 0.28, 0.1, 0.05));
    chassis.add(mesh(_box, head, wid * 0.32, ride + 0.48, -len * 0.5, 0.28, 0.1, 0.05));
    chassis.add(mesh(_box, indL, -wid * 0.48, ride + 0.36, -len * 0.48, 0.1, 0.08, 0.05));
    chassis.add(mesh(_box, indR, wid * 0.48, ride + 0.36, -len * 0.48, 0.1, 0.08, 0.05));
    chassis.add(mesh(_box, brake, -wid * 0.32, ride + 0.55, len * 0.5, 0.32, 0.1, 0.04));
    chassis.add(mesh(_box, brake, wid * 0.32, ride + 0.55, len * 0.5, 0.32, 0.1, 0.04));
    chassis.add(mesh(_box, reverse, -wid * 0.42, ride + 0.4, len * 0.5, 0.1, 0.08, 0.03));
    chassis.add(mesh(_box, reverse, wid * 0.42, ride + 0.4, len * 0.5, 0.1, 0.08, 0.03));
    chassis.add(mesh(_box, indL, -wid * 0.48, ride + 0.48, len * 0.49, 0.08, 0.08, 0.04));
    chassis.add(mesh(_box, indR, wid * 0.48, ride + 0.48, len * 0.49, 0.08, 0.08, 0.04));
    if (kind === "lacetti") {
      const name = word("LACETTI", 0.72, 0.1, "#f4f1ea", "#1a1a1a");
      name.position.set(0, ride + 0.68, len * 0.518);
      chassis.add(name);
    }
  }

  chassis.add(mesh(_box, black, -wid * 0.5, ride + 0.7, cabinZ + 0.15, 0.08, 0.12, 0.22));
  chassis.add(mesh(_box, black, wid * 0.5, ride + 0.7, cabinZ + 0.15, 0.08, 0.12, 0.22));

  const plateMat = new THREE.MeshStandardMaterial({
    map: plateTexture(plateText),
    roughness: 0.35,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const plate = mesh(new THREE.PlaneGeometry(0.52, 0.112), plateMat, 0, ride + 0.42, len * 0.512, 1, 1, 1);
  chassis.add(plate);

  const dash = dashTexture();
  const dashMat = new THREE.MeshStandardMaterial({ map: dash.tex, roughness: 0.5, emissive: "#22180e", emissiveIntensity: 0.3 });
  chassis.add(mesh(new THREE.PlaneGeometry(0.42, 0.2), dashMat, -0.36, ride + bodyH * 0.55, -0.35, 1, 1, 1));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.018, 8, 16), black);
  wheel.rotation.y = Math.PI / 2;
  wheel.position.set(-0.36, ride + bodyH * 0.5, -0.55);
  wheel.castShadow = true;
  chassis.add(wheel);
  chassis.add(mesh(_box, plastic, -0.36, ride + 0.28, -0.15, 0.42, 0.08, 0.42));
  chassis.add(mesh(_box, plastic, 0.36, ride + 0.28, -0.15, 0.42, 0.08, 0.42));
  const seat = new THREE.MeshStandardMaterial({ color: "#241c18", roughness: 0.82 });
  chassis.add(mesh(_box, seat, -0.36, ride + 0.46, 0.12, 0.36, 0.32, 0.4));
  chassis.add(mesh(_box, seat, 0.36, ride + 0.46, 0.12, 0.36, 0.32, 0.4));
  chassis.add(mesh(_box, seat, -0.36, ride + 0.62, 0.28, 0.34, 0.28, 0.1));
  chassis.add(mesh(_box, seat, 0.36, ride + 0.62, 0.28, 0.34, 0.28, 0.1));

  const wheels: THREE.Object3D[] = [];
  const frontPivots: THREE.Object3D[] = [];
  const wz = len * 0.31;
  const wx = wid * 0.46;
  const spots: [number, number, boolean][] = [
    [-wx, -wz, true],
    [wx, -wz, true],
    [-wx, wz, false],
    [wx, wz, false],
  ];
  const spokeGeo = new THREE.BoxGeometry(0.04, 0.028, 0.17);
  for (const [x, z, front] of spots) {
    const pivot = new THREE.Group();
    pivot.position.set(x, ride, z);
    const spin = new THREE.Group();
    const tireM = new THREE.Mesh(_cyl, tire);
    tireM.rotation.z = Math.PI / 2;
    tireM.scale.set(0.34, 0.22, 0.34);
    tireM.castShadow = true;
    const rimM = new THREE.Mesh(_cyl, rim);
    rimM.rotation.z = Math.PI / 2;
    rimM.scale.set(0.18, 0.23, 0.18);
    spin.add(tireM, rimM);
    const side = x > 0 ? 0.1 : -0.1;
    for (let s = 0; s < 5; s++) {
      const a = (s / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(spokeGeo, rim);
      spoke.position.set(side, Math.sin(a) * 0.09, Math.cos(a) * 0.09);
      spoke.rotation.x = a;
      spin.add(spoke);
    }
    pivot.add(spin);
    root.add(pivot);
    wheels.push(spin);
    if (front) frontPivots.push(pivot);
  }

  const spotL = new THREE.SpotLight("#fff4dd", 0, 46, 0.55, 0.45, 1.4);
  spotL.position.set(-0.45, ride + 0.55, -len * 0.5);
  const tL = new THREE.Object3D();
  tL.position.set(-0.45, ride + 0.3, -len * 0.5 - 16);
  root.add(spotL, tL);
  spotL.target = tL;
  const spotR = new THREE.SpotLight("#fff4dd", 0, 46, 0.55, 0.45, 1.4);
  spotR.position.set(0.45, ride + 0.55, -len * 0.5);
  const tR = new THREE.Object3D();
  tR.position.set(0.45, ride + 0.3, -len * 0.5 - 16);
  root.add(spotR, tR);
  spotR.target = tR;
  root.userData.spots = [spotL, spotR];
  root.userData.wheel = wheel;

  const vehicle: VehicleMesh = {
    root,
    chassis,
    paint,
    glass,
    wheels,
    frontPivots,
    brake,
    reverse,
    head,
    indL,
    indR,
    plate,
    plateMat,
    dashPaint: dash.paint,
    length: len,
    radius: suv ? 2.15 : 2.05,
    tickWheels: (dt, speed, steer) => {
      for (const w of wheels) w.rotation.x -= (speed / 0.34) * dt;
      for (const p of frontPivots) p.rotation.y = steer * 0.42;
    },
  };
  attachDriver(vehicle);
  return vehicle;
}

export function plateFor(id: string) {
  if (id === "lacetti") return "90 O 909 BA";
  if (id === "seltos") return "01 D 666 FB";
  return "01 A 100 AA";
}

export function applyPlate(vehicle: VehicleMesh, text: string) {
  vehicle.plateMat.map?.dispose();
  vehicle.plateMat.map = plateTexture(text);
  vehicle.plateMat.needsUpdate = true;
  vehicle.plate.visible = true;
}

/** Pull the plate just clear of the rear bumper so the body does not hide it. */
export function fitRearPlate(vehicle: VehicleMesh, model: THREE.Object3D, lift = 0) {
  vehicle.chassis.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(vehicle.chassis.matrixWorld).invert();
  const world = new THREE.Box3().setFromObject(model);
  const local = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const x of [world.min.x, world.max.x]) {
    for (const y of [world.min.y, world.max.y]) {
      for (const z of [world.min.z, world.max.z]) {
        local.expandByPoint(corner.set(x, y, z).applyMatrix4(inv));
      }
    }
  }
  const bumperY = local.min.y + Math.min(0.52, Math.max(0.36, (local.max.y - local.min.y) * 0.32));
  vehicle.plate.position.set(0, bumperY + lift, local.max.z + 0.04);
  vehicle.plate.rotation.set(0, 0, 0);
  vehicle.plate.scale.set(1.2, 1.35, 1);
  vehicle.plate.renderOrder = 4;
  vehicle.plate.visible = true;
  vehicle.plateMat.side = THREE.DoubleSide;
  vehicle.plateMat.polygonOffset = true;
  vehicle.plateMat.polygonOffsetFactor = -4;
  vehicle.plateMat.polygonOffsetUnits = -4;
}

export function specById(id: string) {
  return CATALOG.find((c) => c.id === id) ?? CATALOG[0]!;
}

let seltosLoad: Promise<THREE.Group> | null = null;

function loadSeltosScene() {
  if (!seltosLoad) {
    seltosLoad = import("three/addons/loaders/GLTFLoader.js").then(({ GLTFLoader }) => new GLTFLoader().loadAsync("/models/seltos.glb")).then((gltf) => gltf.scene);
  }
  return seltosLoad;
}

/** Swap the procedural Seltos for the supplied GLB. Nose is −X in the file; the game nose is −Z. */
export function attachSeltosModel(vehicle: VehicleMesh, paintHex: string, tint: number) {
  const token = {};
  vehicle.root.userData.seltosToken = token;
  return loadSeltosScene().then((src) => {
    if (vehicle.root.userData.seltosToken !== token) return;
    const model = src.clone(true);
    model.rotation.y = -Math.PI / 2;
    const heads: THREE.MeshStandardMaterial[] = [];
    const brakes: THREE.MeshStandardMaterial[] = [];
    const indL: THREE.MeshStandardMaterial[] = [];
    const indR: THREE.MeshStandardMaterial[] = [];
    const paints: THREE.MeshStandardMaterial[] = [];
    const glasses: THREE.MeshStandardMaterial[] = [];
    const spins: { obj: THREE.Object3D; base: THREE.Quaternion; front: boolean; angle: number }[] = [];
    model.traverse((obj) => {
      obj.castShadow = false;
      obj.receiveShadow = false;
      const name = obj.name || "";
      if (/(^|\s)tire (FL|FR|RL|RR)$/i.test(name)) {
        spins.push({ obj, base: obj.quaternion.clone(), front: /FL|FR/i.test(name), angle: 0 });
      }
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const mat of mats) {
        const n = mat.name || "";
        if (/carpaint/i.test(n)) {
          mat.color?.set(paintHex);
          paints.push(mat);
        }
        if (/glass/i.test(n)) {
          mat.transparent = true;
          mat.opacity = Math.min(0.38, Math.max(0.16, tint * 0.65));
          mat.depthWrite = false;
          glasses.push(mat);
        }
        if (/turn_signal|turn lamp|turn light/i.test(n)) {
          if (/_R\b| RH|FR/i.test(n) && !/_L/i.test(n)) indR.push(mat);
          else if (/_L\b| LH|FL/i.test(n)) indL.push(mat);
          else {
            indL.push(mat);
            indR.push(mat);
          }
        } else if (/RCL|HMSL|redglass|tail/i.test(n)) brakes.push(mat);
        else if (/Lights_On|headlamp|LOW&HIGH|lamp_off/i.test(n)) heads.push(mat);
      }
    });
    vehicle.bodyLights = { head: heads, brake: brakes, indL, indR, paint: paints, glass: glasses };
    vehicle.tickWheels = (dt, speed, steer) => {
      for (const s of spins) {
        s.angle -= (speed / 0.33) * dt;
        s.obj.quaternion.copy(s.base);
        if (s.front) s.obj.rotateY(steer * 0.5);
        s.obj.rotateZ(s.angle);
      }
    };
    for (const p of vehicle.frontPivots) p.visible = false;
    for (const child of vehicle.chassis.children) {
      if (child !== vehicle.plate && !child.userData.driver) child.visible = false;
    }
    vehicle.chassis.add(model);
    fitRearPlate(vehicle, model);
  });
}

function bindGlbWheels(
  model: THREE.Object3D,
  pattern: RegExp,
  spinAxis: "x" | "z",
) {
  const spins: { obj: THREE.Object3D; base: THREE.Quaternion; front: boolean; angle: number }[] = [];
  model.updateMatrixWorld(true);
  const pos = new THREE.Vector3();
  model.traverse((obj) => {
    if (!pattern.test(obj.name)) return;
    obj.getWorldPosition(pos);
    spins.push({ obj, base: obj.quaternion.clone(), front: pos.z > 0, angle: 0 });
  });
  return (dt: number, speed: number, steer: number) => {
    for (const s of spins) {
      s.angle -= (speed / 0.33) * dt;
      s.obj.quaternion.copy(s.base);
      if (s.front) s.obj.rotateY(steer * 0.45);
      if (spinAxis === "x") s.obj.rotateX(s.angle);
      else s.obj.rotateZ(s.angle);
    }
  };
}

function hideBodyKeepPlate(vehicle: VehicleMesh, model: THREE.Object3D) {
  dropJunk(model);
  for (const p of vehicle.frontPivots) p.visible = false;
  for (const child of vehicle.chassis.children) {
    if (child !== vehicle.plate && !child.userData.driver) child.visible = false;
  }
  vehicle.chassis.add(model);
}

/** E30 faces +Z in the file. Game nose is −Z. */
export function attachM3(vehicle: VehicleMesh, paintHex: string) {
  const token = {};
  vehicle.root.userData.m3Token = token;
  return loadModel("/models/bmw-m3.glb").then((src) => {
    if (!src || vehicle.root.userData.m3Token !== token) return;
    const model = src.clone(true);
    model.traverse((obj) => {
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const mat of mats) {
        if (/body|paint|carpaint/i.test(mat.name) || /BODY/i.test(mesh.name)) mat.color?.set(paintHex);
      }
    });
    const tick = bindGlbWheels(model, /TIRE|RIM/i, "x");
    model.rotation.y = Math.PI;
    placeCar(model, 4.36);
    vehicle.tickWheels = tick;
    hideBodyKeepPlate(vehicle, model);
    fitRearPlate(vehicle, model);
  });
}

export function attachK5(vehicle: VehicleMesh, paintHex: string) {
  const token = {};
  vehicle.root.userData.k5Token = token;
  return loadModel("/models/k5.glb").then((src) => {
    if (!src || vehicle.root.userData.k5Token !== token) return;
    const model = src.clone(true);
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[];
      for (const mat of mats) {
        if (/body|paint|carpaint/i.test(mat.name)) mat.color?.set(paintHex);
      }
    });
    const tick = bindGlbWheels(model, /wheel|tire|rim/i, "x");
    model.rotation.y = Math.PI;
    placeCar(model, 4.7);
    vehicle.tickWheels = tick;
    hideBodyKeepPlate(vehicle, model);
    fitRearPlate(vehicle, model);
  });
}

/** Nose is +Z in the file. Game nose is −Z. Plate stays the shared rear plate. */
export function attachLacetti(vehicle: VehicleMesh) {
  const token = {};
  vehicle.root.userData.lacettiToken = token;
  return loadModel("/models/lacetti.glb").then((src) => {
    if (!src || vehicle.root.userData.lacettiToken !== token) return;
    const model = src.clone(true);
    dropJunk(model);
    const spins = pivotLacettiWheels(model);
    model.rotation.y = Math.PI;
    placeCar(model, 4.51);
    vehicle.tickWheels = (dt, speed, steer) => {
      for (const s of spins) {
        s.angle -= (speed / 0.33) * dt;
        s.pivot.rotation.set(s.angle, s.front ? steer * 0.42 : 0, 0);
      }
    };
    hideBodyKeepPlate(vehicle, model);
    fitRearPlate(vehicle, model, 0.22);
  });
}

function pivotLacettiWheels(model: THREE.Object3D) {
  model.updateMatrixWorld(true);
  const found: { mesh: THREE.Mesh; c: THREE.Vector3 }[] = [];
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !/Sidewall|Tread|_Material5_|_Material7_/.test(mesh.name)) return;
    found.push({ mesh, c: new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()) });
  });
  const buckets = new Map<string, { mesh: THREE.Mesh; c: THREE.Vector3 }[]>();
  for (const item of found) {
    const key = `${item.c.x < 0 ? "l" : "r"}${item.c.z > 0 ? "f" : "b"}`;
    const list = buckets.get(key) ?? [];
    list.push(item);
    buckets.set(key, list);
  }
  const spins: { pivot: THREE.Group; front: boolean; angle: number }[] = [];
  for (const [key, list] of buckets) {
    const center = new THREE.Vector3();
    for (const item of list) center.add(item.c);
    center.multiplyScalar(1 / list.length);
    const pivot = new THREE.Group();
    model.add(pivot);
    pivot.position.copy(model.worldToLocal(center.clone()));
    pivot.updateMatrixWorld(true);
    for (const item of list) pivot.attach(item.mesh);
    spins.push({ pivot, front: key.endsWith("f"), angle: 0 });
  }
  return spins;
}

let driverLoad: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null;

function loadDriver() {
  if (!driverLoad) {
    driverLoad = import("three/addons/loaders/GLTFLoader.js").then(({ GLTFLoader }) => new GLTFLoader().loadAsync("/models/driver-sit.glb"));
  }
  return driverLoad;
}

/** Seated driver from Sketchfab “man sitting” by Ace-of_spades (CC BY 4.0). Left-hand seat, facing the nose (−Z). */
export function attachDriver(vehicle: VehicleMesh) {
  const token = {};
  vehicle.root.userData.driverToken = token;
  return loadDriver().then(async (gltf) => {
    if (vehicle.root.userData.driverToken !== token) return;
    const { clone } = await import("three/addons/utils/SkeletonUtils.js");
    const model = clone(gltf.scene) as THREE.Group;
    model.name = "driver";
    model.userData.driver = true;
    model.traverse((obj) => {
      obj.castShadow = false;
      obj.receiveShadow = false;
      obj.frustumCulled = false;
    });
    // Sketchfab export is about 3.6 m tall. 0.5 puts the head near the window line.
    model.scale.setScalar(0.5);
    model.position.set(-0.34, 0.06, 0.42);
    model.rotation.y = Math.PI;
    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations[0];
    if (clip) {
      const action = mixer.clipAction(clip);
      action.play();
      mixer.update(0.016);
    }
    vehicle.tickDriver = (dt) => mixer.update(dt);
    vehicle.chassis.add(model);
  }).catch((err) => {
    console.error("driver", err);
  });
}
