import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DriveAudio } from "./audio";
import { dropJunk, placeProp } from "./assets";
import {
  PARK_BAY,
  POIS,
  SPAWN,
  TILE_CENTERS,
  WORLD,
  XS,
  ZS,
  avenueLoop,
  avenueReverse,
  boulevardLoop,
  boulevardReverse,
  intersections,
  lampSpots,
  onPaved,
  pathLength,
  ringLoop,
  ringLoopReverse,
  samplePath,
  speedLimit,
  type Pt,
  type TileId,
} from "./layout";
import { loadSave, writeSave, type Quality, type SaveData } from "./save";
import { applyPlate, attachK5, attachLacetti, attachM3, attachSeltosModel, createVehicle, plateFor, specById, type VehicleId, type VehicleMesh, type VehicleSpec } from "./vehicles";
import { createWorld, type Collider } from "./world";
import { loadCityMap, type CityMap } from "./maps";
import { carSource, hashId, loadStarDome, mountTraffic, pedIndex, pedSources } from "./sketchfab";

export type Phase = "menu" | "play" | "pause";
export type CamMode = "chase" | "close" | "hood" | "cabin" | "rear" | "cinema";
export type DriveMode = "eco" | "normal" | "sport";

export type Snapshot = {
  phase: Phase;
  speed: number;
  gear: string;
  engine: boolean;
  fuel: number;
  damage: number;
  indL: boolean;
  indR: boolean;
  lights: boolean;
  nav: string;
  prompt: string;
  hour: number;
  weather: string;
  driveMode: DriveMode;
  mission: string;
  money: number;
  vehicle: string;
  cam: CamMode;
  collisions: number;
  toast: string;
  quality: Quality;
  dest: string;
  rpm: number;
  violations: number;
  unlimited: boolean;
  mapNote: string;
};

type TCar = {
  mesh: THREE.Group;
  path: Pt[];
  cum: number[];
  dist: number;
  speed: number;
  max: number;
  yaw: number;
  lane: number;
  laneTarget: number;
  laneT: number;
  radius: number;
  tx: number;
  tz: number;
  hornBrake: number;
  alive: boolean;
  health: number;
  cool: number;
};

type Ped = {
  mesh: THREE.Group;
  kind: "ring" | "cross" | "map";
  a: number;
  speed: number;
  t: number;
  dir: number;
  wait: number;
  fixed: number;
  from: number;
  to: number;
  across: "x" | "z";
  down: boolean;
  downT: number;
  yawJ: number;
};

const CAMS: CamMode[] = ["chase", "close", "hood", "cabin", "rear", "cinema"];
const TILES: TileId[] = ["center", "north", "south", "east", "west"];

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function detectQuality(): Quality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  if (coarse && mem <= 4) return "low";
  if (coarse || mem <= 4 || cores <= 4) return "medium";
  return "high";
}

function makeTrafficMesh(color: string, kind: "sedan" | "suv" | "taxi" | "bus" | "van") {
  const g = new THREE.Group();
  const body = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 0.45, clearcoatRoughness: 0.28 });
  const glass = new THREE.MeshPhysicalMaterial({ color: "#9eb4c0", metalness: 0.05, roughness: 0.06, transparent: true, opacity: 0.5 });
  const lamp = new THREE.MeshStandardMaterial({ color: "#fff4dd", emissive: "#ffe7b0", emissiveIntensity: 0.35 });
  const tail = new THREE.MeshStandardMaterial({ color: "#5a1010", emissive: "#ff2a1a", emissiveIntensity: 0.25 });
  const long = kind === "bus";
  const suv = kind === "suv" || kind === "van";
  const len = long ? 8.4 : kind === "van" ? 5.1 : suv ? 4.5 : 4.35;
  const wid = long ? 2.25 : suv ? 1.85 : 1.72;
  const h = long ? 2.5 : suv ? 1.65 : 1.38;
  const box = new THREE.Mesh(new THREE.BoxGeometry(wid, h * 0.42, len), body);
  box.position.y = 0.52;
  const cabH = long ? h * 0.48 : h * 0.38;
  const cab = new THREE.Mesh(new THREE.BoxGeometry(wid * 0.9, cabH, long ? len * 0.72 : len * 0.42), glass);
  cab.position.y = 0.52 + h * 0.36;
  cab.position.z = long ? 0.15 : kind === "van" ? 0.15 : -0.12;
  g.add(box, cab);
  const nose = -len / 2;
  const tailZ = len / 2;
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), lamp).translateX(-wid * 0.28).translateY(0.55).translateZ(nose));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.08, 0.05), lamp).translateX(wid * 0.28).translateY(0.55).translateZ(nose));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.04), tail).translateX(-wid * 0.3).translateY(0.58).translateZ(tailZ));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.04), tail).translateX(wid * 0.3).translateY(0.58).translateZ(tailZ));
  if (kind === "taxi") {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.12, 0.22),
      new THREE.MeshStandardMaterial({ color: "#f2c200", emissive: "#f2c200", emissiveIntensity: 0.4 }),
    );
    sign.position.set(0, 0.52 + h * 0.36 + cabH / 2 + 0.08, -0.1);
    g.add(sign);
  }
  g.userData.kind = kind;
  g.userData.len = len;
  return g;
}

function fleetPlate(i: number) {
  const letters = "ABDEFGHJKLMNPRSTUVYZ";
  const n = String(100 + ((Math.abs(i) * 37) % 800)).padStart(3, "0");
  const a = letters[Math.abs(i) % letters.length];
  const b = letters[(Math.abs(i) * 3) % letters.length];
  const c = letters[(Math.abs(i) * 7) % letters.length];
  return `01 ${a} ${n} ${b}${c}`;
}

function makePed(i: number) {
  const g = new THREE.Group();
  const colors = ["#1e8f7b", "#c4513a", "#2c3e50", "#d4b06a", "#eee6d8", "#5c4030", "#6b3fa0", "#1d4e89"];
  const cloth = new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.75 });
  const skin = new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? "#c68642" : i % 3 === 1 ? "#8d5524" : "#e0b089", roughness: 0.7 });
  const scale = 0.9 + (i % 4) * 0.06;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.48, 3, 6), cloth);
  body.position.y = 0.92 * scale;
  body.scale.setScalar(scale);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 8), skin);
  head.position.y = 1.48 * scale;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.32, 2, 5), cloth);
  const legR = legL.clone();
  legL.position.set(-0.08, 0.38, 0);
  legR.position.set(0.08, 0.38, 0);
  g.add(body, head, legL, legR);
  g.userData.legs = [legL, legR];
  return g;
}

export class DriveSim {
  readonly audio = new DriveAudio();
  save: SaveData;
  phase: Phase = "menu";
  x = SPAWN.x;
  z = SPAWN.z;
  yaw = SPAWN.yaw;
  vx = 0;
  vz = 0;
  speed = 0;
  gear: "P" | "R" | "N" | "D" = "P";
  engine = false;
  fuel = 0.78;
  damage = 0;
  steerVisual = 0;
  driveMode: DriveMode = "normal";
  cam: CamMode = "chase";
  lightsOn = false;
  indL = false;
  indR = false;
  hazard = false;
  blink = 0;
  blinkOn = false;
  mission = "free";
  dest = "hotel";
  collisions = 0;
  toast = "";
  toastT = 0;
  money: number;
  private manualGear = 1;
  private keys = new Set<string>();
  private forced: Set<string> | null = null;
  touch = { throttle: 0, brake: 0, steer: 0 };
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.12, 900);
  private timer = new THREE.Timer();
  private acc = 0;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private sky: THREE.Mesh;
  private star: THREE.Object3D | null = null;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.Fog;
  private vehicle: VehicleMesh;
  private spec: VehicleSpec;
  private world: ReturnType<typeof createWorld>;
  private cars: TCar[] = [];
  private peds: Ped[] = [];
  private parked: { mesh: THREE.Group; x: number; z: number; r: number; health: number; cool: number }[] = [];
  private ix = intersections();
  private lightT = 2;
  private nsGo = true;
  private hour: number;
  private weather: SaveData["settings"]["weather"];
  private rain: THREE.Points | null = null;
  private route: { i: number; j: number }[] = [];
  private routeLine: THREE.Line;
  private routeBuf: Float32Array;
  private camPos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private lookTarget = new THREE.Vector3();
  private colNightTop = new THREE.Color("#07101c");
  private colDayTop = new THREE.Color("#6ea0d8");
  private colNightHor = new THREE.Color("#1a2744");
  private colSetHor = new THREE.Color("#f0c39a");
  private colDayHor = new THREE.Color("#d5e4f2");
  private colSunDay = new THREE.Color("#fff6e4");
  private colSunSet = new THREE.Color("#ffb27a");
  private colTmp = new THREE.Color();
  private navTick = 0;
  private cine = 0;
  private hitCd = 0;
  private hudT = 0;
  private saveT = 0;
  private fpsT = 0;
  private fpsN = 0;
  private missionArmed = false;
  private parkHold = 0;
  private missionClock = 0;
  private violations = 0;
  private violCd = 0;
  private shake = 0;
  private lamps = lampSpots();
  private street: THREE.PointLight[] = [];
  private prompt = "";
  private navText = "Pick a destination";
  private mini: HTMLCanvasElement | null = null;
  private onSnap: (s: Snapshot) => void;
  private disposed = false;
  private prevInd = false;
  private sample = { x: 0, z: 0 };
  private paths: { pts: Pt[]; cum: number[] }[] = [];
  private city: CityMap | null = null;
  private mapNote = "Amir Temur ready";
  private carY = 0;
  private offMap = 0;
  private fumes: { mesh: THREE.Group; life: number }[] = [];
  private pedPool: Promise<THREE.Object3D[]> | null = null;

  constructor(canvas: HTMLCanvasElement, onSnap: (s: Snapshot) => void) {
    this.onSnap = onSnap;
    this.save = loadSave();
    if (this.save.settings.autoGfx) this.save.settings.quality = detectQuality();
    this.money = this.save.money;
    this.hour = this.save.settings.hour;
    this.weather = this.save.settings.weather;
    this.spec = specById(this.save.vehicle);
    if (!this.save.unlocked.includes(this.spec.id)) this.spec = specById("seltos");

    const q = this.save.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== "low", powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q !== "low";
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "low" ? 1 : q === "ultra" ? 1.75 : 1.35));
    this.renderer.setSize(canvas.clientWidth || 1280, canvas.clientHeight || 720, false);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.fog = new THREE.Fog("#c5d4e4", 40, 380);
    this.scene.fog = this.fog;
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color("#6ea0d8") },
        hor: { value: new THREE.Color("#d7e6f2") },
        sun: { value: new THREE.Vector3(0.2, 0.8, 0.2) },
      },
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `varying vec3 vW; uniform vec3 top; uniform vec3 hor; uniform vec3 sun; void main(){ vec3 d = normalize(vW); float h = clamp(d.y*0.9+0.08,0.0,1.0); vec3 col = mix(hor, top, pow(h,0.75)); float s = pow(max(dot(d, normalize(sun)),0.0), 90.0); col += vec3(1.0,0.82,0.55)*s; gl_FragColor = vec4(col,1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(700, 20, 12), this.skyMat);
    this.scene.add(this.sky);
    this.mountStars();

    this.hemi = new THREE.HemisphereLight("#d5e6f5", "#6d7a55", 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight("#fff4e0", 2.3);
    this.sun.castShadow = q !== "low";
    this.sun.shadow.mapSize.set(q === "ultra" ? 2048 : 1024, q === "ultra" ? 2048 : 1024);
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 180;
    this.sun.shadow.camera.left = -50;
    this.sun.shadow.camera.right = 50;
    this.sun.shadow.camera.top = 50;
    this.sun.shadow.camera.bottom = -50;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);
    if (q !== "low") {
      for (let i = 0; i < (q === "ultra" ? 10 : 6); i++) {
        const pl = new THREE.PointLight("#ffd7a1", 0, 16, 2);
        this.scene.add(pl);
        this.street.push(pl);
      }
    }

    this.world = createWorld(this.scene);
    this.vehicle = createVehicle(this.spec.kind, this.save.paint, this.save.tint, plateFor(this.spec.id));
    this.vehicle.root.position.set(this.x, this.carY, this.z);
    this.vehicle.root.rotation.y = this.yaw;
    this.scene.add(this.vehicle.root);
    this.mountBody();

    this.routeBuf = new Float32Array(48 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.routeBuf, 3));
    this.routeLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: "#d4b06a" }));
    this.routeLine.visible = false;

    this.buildPaths();
    this.spawnTraffic();
    this.spawnPeds();
    this.spawnParked();
    this.recomputeRoute();

    this.timer.connect(document);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVis);
    window.__controlsTest = {
      getYaw: () => this.yaw,
      getSpeed: () => this.speed,
      setKeys: (codes: string[]) => {
        this.forced = codes.length ? new Set(codes) : null;
      },
      setSteer: (v: number) => {
        this.touch.steer = clamp(v, -1, 1);
      },
      setCam: (c: "chase" | "close" | "hood" | "cabin" | "rear" | "cinema") => {
        this.setCam(c);
      },
      debug: () => ({
        gear: this.gear,
        x: this.x,
        z: this.z,
        speed: this.speed,
        engine: this.engine,
        fuel: this.fuel,
        phase: this.phase,
        paved: onPaved(this.x, this.z),
        driver: !!this.vehicle.chassis.getObjectByName("driver"),
      }),
    };
    this.emit();
  }

  private buildPaths() {
    const list = [
      ringLoop(76, 4.3),
      ringLoopReverse(76, 4.3),
      ringLoop(168, 3.2),
      ringLoopReverse(168, 3.2),
      boulevardLoop(),
      boulevardReverse(),
      avenueLoop(),
      avenueReverse(),
    ];
    this.paths = list.map((pts) => ({ pts, cum: pathLength(pts) }));
  }

  private spawnTraffic() {
    const density = this.save.settings.density;
    const n = density === "low" ? 10 : density === "high" ? 18 : 14;
    const kinds = ["bus", "taxi", "sedan", "suv", "van", "sedan", "taxi", "suv"] as const;
    const colors = ["#1e8f7b", "#f2c200", "#f4f4f2", "#1d232a", "#d9dde2", "#6e1d1d", "#e8e4dc", "#2f4f6f", "#c4513a", "#8aa0b4"];
    for (let i = 0; i < n; i++) {
      const kind = kinds[i % kinds.length]!;
      const path = (kind === "bus" ? this.paths[2 + (i % 2)] : this.paths[i % this.paths.length])!;
      const color = kind === "taxi" ? "#f2c200" : kind === "bus" ? "#1e8f7b" : colors[i % colors.length]!;
      const mesh = makeTrafficMesh(color, kind);
      const dist = (i * path.cum[path.cum.length - 1]!) / n;
      const car: TCar = {
        mesh,
        path: path.pts,
        cum: path.cum,
        dist,
        speed: 7 + (i % 5),
        max: kind === "bus" ? 9 : kind === "van" ? 11 : 12 + (i % 4),
        yaw: 0,
        lane: 0,
        laneTarget: i % 2 ? 1.15 : -1.15,
        laneT: 3 + (i % 5),
        radius: kind === "bus" ? 3.8 : kind === "van" ? 2.4 : 2.1,
        tx: 0,
        tz: -1,
        hornBrake: 0,
        alive: true,
        health: 100,
        cool: 0,
      };
      this.placeCar(car);
      this.scene.add(mesh);
      this.cars.push(car);
      this.dressMesh(mesh, kind, i, color);
    }
  }

  private dressMesh(mesh: THREE.Group, kind: string, index: number, color: string) {
    void carSource(kind, index).then((src) => {
      if (!src || !mesh.parent) return;
      mountTraffic(mesh, src, kind, color, fleetPlate(index));
      this.scar(mesh);
    });
  }

  private scar(mesh: THREE.Group) {
    const stage = (mesh.userData.stage as number | undefined) ?? 100;
    const body = mesh.userData.body as THREE.Object3D | undefined;
    if (!body) return;
    if (stage <= 60 && !mesh.userData.scratched) {
      mesh.userData.scratched = true;
      body.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const std = mat as THREE.MeshStandardMaterial;
          if (std.color) std.color.multiplyScalar(0.62);
          if ("roughness" in std && typeof std.roughness === "number") std.roughness = Math.min(1, std.roughness + 0.3);
        }
      });
    }
    if (stage <= 30 && !mesh.userData.dented) {
      mesh.userData.dented = true;
      body.scale.y *= 0.92;
    }
  }

  private hurtMesh(mesh: THREE.Group, health: number) {
    if (health <= 0) return 0;
    const next = health > 60 ? 60 : health > 30 ? 30 : 0;
    mesh.userData.stage = next;
    this.scar(mesh);
    if (next === 0) {
      this.puff(mesh.position.x, mesh.position.y + 0.7, mesh.position.z);
      this.scene.remove(mesh);
    }
    return next;
  }

  private puff(x: number, y: number, z: number) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: "#2c2c2c", transparent: true, opacity: 0.5, depthWrite: false });
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), mat.clone());
      s.position.set((i - 2) * 0.16, 0.3 + i * 0.12, (i % 2) * 0.08);
      g.add(s);
    }
    g.position.set(x, y, z);
    this.scene.add(g);
    this.fumes.push({ mesh: g, life: 1.5 });
  }

  private stepFumes(dt: number) {
    for (const f of this.fumes) {
      f.life -= dt;
      f.mesh.position.y += dt * 0.7;
      f.mesh.scale.multiplyScalar(1 + dt * 0.4);
      for (const child of f.mesh.children) {
        const m = child as THREE.Mesh;
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = Math.max(0, f.life / 1.5);
      }
      if (f.life <= 0) this.scene.remove(f.mesh);
    }
    if (this.fumes.some((f) => f.life <= 0)) this.fumes = this.fumes.filter((f) => f.life > 0);
  }

  private spawnPeds() {
    for (let i = 0; i < 28; i++) {
      const mesh = makePed(i);
      this.scene.add(mesh);
      this.peds.push({
        mesh,
        kind: "ring",
        a: (i / 28) * Math.PI * 2,
        speed: 0.35 + (i % 5) * 0.06,
        t: 0,
        dir: 1,
        wait: 0,
        fixed: 0,
        from: 0,
        to: 0,
        across: "x",
        down: false,
        downT: 0,
        yawJ: 0,
      });
      this.dressPed(this.peds[this.peds.length - 1]!, i);
    }
    const crossings: Array<Pick<Ped, "across" | "fixed" | "from" | "to">> = [
      { across: "z", fixed: 62, from: 66, to: 88 },
      { across: "z", fixed: -62, from: -88, to: -66 },
      { across: "x", fixed: 62, from: 66, to: 88 },
      { across: "x", fixed: -62, from: -88, to: -66 },
    ];
    crossings.forEach((c, i) => {
      const mesh = makePed(20 + i);
      this.scene.add(mesh);
      this.peds.push({
        mesh,
        kind: "cross",
        a: 0,
        speed: 1.1,
        t: i * 0.2,
        dir: 1,
        wait: 0,
        fixed: c.fixed,
        from: c.from,
        to: c.to,
        across: c.across,
        down: false,
        downT: 0,
        yawJ: 0,
      });
      this.dressPed(this.peds[this.peds.length - 1]!, 20 + i);
    });
  }

  private dressPed(ped: Ped, id: number) {
    if (!this.pedPool) this.pedPool = pedSources();
    void this.pedPool.then((pool) => {
      if (!pool.length || !ped.mesh.parent || ped.mesh.userData.dressed) return;
      const model = pool[pedIndex(id, pool.length)]!.clone(true);
      dropJunk(model);
      placeProp(model, 1.7);
      const h = hashId(id);
      model.scale.multiplyScalar(0.92 + ((h % 17) / 16) * 0.16);
      model.updateMatrixWorld(true);
      const fitted = new THREE.Box3().setFromObject(model);
      const sz = fitted.getSize(new THREE.Vector3());
      if (sz.y > 2.5 || sz.y < 0.9 || sz.x > 3 || sz.z > 3) return;
      ped.yawJ = ((hashId(id ^ 0x9e3779b9) % 17) / 16 - 0.5) * (16 * Math.PI / 180);
      for (const child of ped.mesh.children) child.visible = false;
      ped.mesh.add(model);
      ped.mesh.userData.dressed = true;
    });
  }

  private spawnParked() {
    const spots = [
      { x: 8, z: 112, kind: "sedan", color: "#eceae4" },
      { x: 8, z: 122, kind: "taxi", color: "#f2c200" },
      { x: 28, z: 112, kind: "suv", color: "#1d232a" },
    ];
    spots.forEach((s, i) => {
      const m = makeTrafficMesh(s.color, s.kind === "taxi" ? "taxi" : "sedan");
      m.position.set(s.x, 0, s.z);
      m.rotation.y = 0.05;
      this.scene.add(m);
      this.parked.push({ mesh: m, x: s.x, z: s.z, r: 2.1, health: 100, cool: 0 });
      this.dressMesh(m, s.kind, 40 + i, s.color);
    });
  }

  private placeCar(car: TCar) {
    samplePath(car.path, car.cum, car.dist, this.sample);
    const ahead = { x: 0, z: 0 };
    samplePath(car.path, car.cum, car.dist + 2, ahead);
    const tx = ahead.x - this.sample.x;
    const tz = ahead.z - this.sample.z;
    const len = Math.hypot(tx, tz) || 1;
    car.tx = tx / len;
    car.tz = tz / len;
    const rx = -car.tz;
    const rz = car.tx;
    car.mesh.position.set(this.sample.x + rx * car.lane, 0, this.sample.z + rz * car.lane);
    car.yaw = Math.atan2(-car.tx, -car.tz);
    car.mesh.rotation.y = car.yaw;
  }

  setMini(canvas: HTMLCanvasElement | null) {
    this.mini = canvas;
  }

  resize() {
    const c = this.renderer.domElement;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.audio.unlock();
    this.phase = "play";
    this.engine = true;
    this.gear = "P";
    this.toast = "Engine on. Hold W or the pedal.";
    this.toastT = 2.5;
    this.emit();
  }

  pause() {
    if (this.phase !== "play") return;
    this.phase = "pause";
    this.emit();
  }

  resume() {
    if (this.phase !== "pause") return;
    this.audio.unlock();
    this.phase = "play";
    this.emit();
  }

  setTouch(partial: Partial<DriveSim["touch"]>) {
    Object.assign(this.touch, partial);
  }

  cycleCam() {
    const i = CAMS.indexOf(this.cam);
    this.cam = CAMS[(i + 1) % CAMS.length]!;
    this.emit();
  }

  setCam(c: CamMode) {
    this.cam = c;
    this.emit();
  }

  toggleLights() {
    this.lightsOn = !this.lightsOn;
    this.emit();
  }

  horn() {
    this.audio.unlock();
    this.audio.horn();
    for (const car of this.cars) {
      const d = Math.hypot(car.mesh.position.x - this.x, car.mesh.position.z - this.z);
      if (d < 22) car.hornBrake = 1.1;
    }
  }

  toggleEngine() {
    this.audio.unlock();
    this.engine = !this.engine;
    if (!this.engine) this.gear = "P";
    this.audio.blip(this.engine ? 140 : 70, 0.12, "sine", 0.04);
    this.emit();
  }

  setDriveMode(m: DriveMode) {
    this.driveMode = m;
    this.emit();
  }

  setMission(id: string) {
    this.mission = id;
    this.missionArmed = false;
    this.parkHold = 0;
    this.missionClock = 0;
    this.violations = 0;
    const poi =
      id === "hotel" || id === "express" ? "hotel" :
      id === "tower" || id === "night" ? "tower" :
      id === "majlis" || id === "rain" ? "majlis" :
      id === "park" ? "park" :
      id === "fuel" ? "fuel" :
      id === "servis" ? "servis" :
      this.dest;
    this.dest = poi;
    if (id === "tower") this.collisions = 0;
    this.recomputeRoute();
    this.emit();
  }

  setDest(id: string) {
    this.dest = id;
    this.recomputeRoute();
    this.emit();
  }

  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24;
    this.save.settings.hour = this.hour;
    this.save.settings.autoTime = false;
  }

  setAutoTime(v: boolean) {
    this.save.settings.autoTime = v;
  }

  setWeather(w: SaveData["settings"]["weather"]) {
    this.weather = w;
    this.save.settings.weather = w;
  }

  applySettings(partial: Partial<SaveData["settings"]>) {
    this.save.settings = { ...this.save.settings, ...partial, assists: { ...this.save.settings.assists, ...partial.assists } };
    if (partial.volume !== undefined) this.audio.setVolume(partial.volume);
    if (partial.quality) this.applyQuality();
    if (partial.density) this.respawnCount();
    this.persist();
    this.emit();
  }

  private respawnCount() {
    for (const c of this.cars) this.scene.remove(c.mesh);
    this.cars = [];
    this.spawnTraffic();
  }

  private applyQuality() {
    const q = this.save.settings.quality;
    const size = q === "ultra" ? 2048 : q === "high" ? 1024 : 512;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q === "low" ? 1 : q === "medium" ? 1.15 : q === "ultra" ? 1.6 : 1.35));
    this.renderer.shadowMap.enabled = q !== "low";
    this.sun.castShadow = q !== "low";
    this.sun.shadow.mapSize.set(size, size);
  }

  selectVehicle(id: VehicleId) {
    if (!this.save.unlocked.includes(id)) return false;
    this.save.vehicle = id;
    this.spec = specById(id);
    this.swapCar();
    this.persist();
    this.emit();
    return true;
  }

  tryUnlock(id: VehicleId) {
    const spec = specById(id);
    if (this.save.unlocked.includes(id)) return this.selectVehicle(id);
    if (!this.save.settings.unlimited && this.money < spec.price) {
      this.toast = "Not enough so'm.";
      this.toastT = 2;
      this.emit();
      return false;
    }
    if (!this.save.settings.unlimited) {
      this.money -= spec.price;
      this.save.money = this.money;
    }
    this.save.unlocked.push(id);
    return this.selectVehicle(id);
  }

  setPaint(hex: string) {
    this.save.paint = hex;
    this.vehicle.paint.color.set(hex);
    for (const m of this.vehicle.bodyLights?.paint ?? []) m.color?.set(hex);
    this.persist();
  }

  setTint(v: number) {
    this.save.tint = v;
    const o = clamp(v, 0.25, 0.72);
    this.vehicle.glass.opacity = o;
    for (const m of this.vehicle.bodyLights?.glass ?? []) m.opacity = o;
    this.persist();
  }

  setPlate(_text: string) {
    const clean = plateFor(this.spec.id);
    this.save.plate = clean;
    applyPlate(this.vehicle, clean);
    this.persist();
  }

  upgrade(key: keyof SaveData["upgrades"]) {
    const level = this.save.upgrades[key];
    if (level >= 3) return;
    const cost = 450 * (level + 1);
    if (!this.save.settings.unlimited && this.money < cost) {
      this.toast = "Not enough so'm.";
      this.toastT = 2;
      this.emit();
      return;
    }
    if (!this.save.settings.unlimited) {
      this.money -= cost;
      this.save.money = this.money;
    }
    this.save.upgrades[key] = level + 1;
    this.persist();
    this.emit();
  }

  repair() {
    const cost = Math.round(this.damage * 6);
    if (!this.save.settings.unlimited) {
      this.money = Math.max(0, this.money - Math.min(this.money, cost));
      this.save.money = this.money;
    }
    this.damage = 0;
    this.toast = cost ? "Bodywork repaired." : "Nothing to repair.";
    this.toastT = 2;
    this.persist();
    this.emit();
  }

  refuel() {
    const cost = Math.round((1 - this.fuel) * 50);
    if (!this.save.settings.unlimited) {
      this.money = Math.max(0, this.money - Math.min(this.money, cost));
      this.save.money = this.money;
    }
    this.fuel = 1;
    this.toast = "Tank full.";
    this.toastT = 2;
    this.persist();
    this.emit();
  }

  respawn() {
    const spawn = this.city?.spawn;
    this.x = spawn?.x ?? SPAWN.x;
    this.z = spawn?.z ?? SPAWN.z;
    this.yaw = spawn?.yaw ?? SPAWN.yaw;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    this.gear = "P";
    this.carY = this.city?.groundY(this.x, this.z) ?? 0;
    this.offMap = 0;
    this.vehicle.root.position.set(this.x, this.carY, this.z);
    this.vehicle.root.rotation.y = this.yaw;
  }

  setMap(id: SaveData["settings"]["map"]) {
    this.save.settings.map = id;
    this.persist();
    if (id === "amir") {
      this.clearCity();
      this.showAmir(true);
      this.buildPaths();
      this.respawnCount();
      this.resetPeds(false);
      this.respawn();
      this.mapNote = "Amir Temur ready";
      this.emit();
      return;
    }
    const name = id === "grid" ? "Grid" : id === "neon" ? "Neon" : "Block";
    this.mapNote = `Loading ${name}…`;
    this.emit();
    void loadCityMap(id)
      .then((city) => {
        if (this.save.settings.map !== id) {
          city.dispose();
          return;
        }
        this.clearCity();
        this.showAmir(false);
        this.city = city;
        this.scene.add(city.group);
        this.camera.near = 0.45;
        this.camera.far = 2200;
        this.camera.updateProjectionMatrix();
        this.paths = [{ pts: city.loop, cum: pathLength(city.loop) }];
        this.respawnCount();
        this.resetPeds(true);
        this.respawn();
        this.mapNote = `${name} ready`;
        this.emit();
      })
      .catch(() => {
        this.mapNote = `${name} failed to load`;
        this.save.settings.map = "amir";
        this.showAmir(true);
        this.emit();
      });
  }

  private clearCity() {
    if (!this.city) return;
    this.city.dispose();
    this.city = null;
    this.carY = 0;
    this.offMap = 0;
    this.camera.near = 0.12;
    this.camera.far = 900;
    this.camera.updateProjectionMatrix();
  }

  private showAmir(on: boolean) {
    this.world.ground.visible = on;
    this.world.always.visible = on;
    if (on) this.world.buildTile("center");
    else for (const id of TILES) this.world.disposeTile(id);
  }

  private resetPeds(onCity: boolean) {
    for (const ped of this.peds) this.scene.remove(ped.mesh);
    this.peds = [];
    if (!onCity) {
      this.spawnPeds();
      return;
    }
    const pts = this.city?.sidewalk ?? [];
    const n = Math.min(16, pts.length);
    for (let i = 0; i < n; i++) {
      const mesh = makePed(i + 40);
      const p = pts[Math.floor((i / n) * pts.length)]!;
      mesh.position.set(p.x, 0, p.z);
      this.scene.add(mesh);
      this.peds.push({
        mesh,
        kind: "map",
        a: i / n,
        speed: 0.55 + (i % 3) * 0.15,
        t: 0,
        dir: 1,
        wait: 0,
        fixed: 0,
        from: 0,
        to: 1,
        across: "x",
        down: false,
        downT: 0,
        yawJ: 0,
      });
      this.dressPed(this.peds[this.peds.length - 1]!, i + 40);
    }
  }

  private swapCar() {
    this.scene.remove(this.vehicle.root);
    this.vehicle = createVehicle(this.spec.kind, this.save.paint, this.save.tint, plateFor(this.spec.id));
    this.vehicle.root.position.set(this.x, this.carY, this.z);
    this.vehicle.root.rotation.y = this.yaw;
    this.scene.add(this.vehicle.root);
    this.mountBody();
  }

  private mountBody() {
    applyPlate(this.vehicle, plateFor(this.spec.id));
    if (this.spec.id === "seltos") void attachSeltosModel(this.vehicle, this.save.paint, this.save.tint);
    if (this.spec.id === "m3") void attachM3(this.vehicle, this.save.paint);
    if (this.spec.id === "k5") void attachK5(this.vehicle, this.save.paint);
    if (this.spec.id === "lacetti") void attachLacetti(this.vehicle);
  }

  private persist() {
    this.save.money = this.money;
    this.save.settings.hour = this.hour;
    writeSave(this.save);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.keys.add(e.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    if (this.phase === "menu") return;
    if (e.code === "KeyI") this.toggleEngine();
    if (e.code === "KeyC") this.cycleCam();
    if (e.code === "KeyL") this.toggleLights();
    if (e.code === "KeyH") this.horn();
    if (e.code === "KeyQ") this.indL = !this.indL;
    if (e.code === "KeyE") this.indR = !this.indR;
    if (e.code === "KeyX") this.hazard = !this.hazard;
    if (e.code === "KeyP" && Math.abs(this.speed) < 1) {
      this.gear = this.gear === "P" ? "D" : "P";
    }
    if (e.code === "KeyN") this.gear = "N";
    if (e.code === "Escape") {
      if (this.phase === "play") this.pause();
      else if (this.phase === "pause") this.resume();
    }
    if (this.save.settings.manual) {
      if (e.code === "ShiftLeft" || e.code === "ShiftRight") this.manualGear = Math.min(5, this.manualGear + 1);
      if (e.code === "ControlLeft") this.manualGear = Math.max(1, this.manualGear - 1);
    }
    if (e.code === "KeyG") this.repair();
    if (e.code === "KeyF") this.refuel();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => {
    this.keys.clear();
    this.touch.throttle = 0;
    this.touch.brake = 0;
    this.touch.steer = 0;
  };

  private onVis = () => {
    this.audio.resume();
  };

  private frame = () => {
    if (this.disposed) return;
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    this.acc += dt;
    let steps = 0;
    const h = 1 / 60;
    while (this.acc >= h && steps < 8) {
      this.step(h);
      this.acc -= h;
      steps++;
    }
    this.acc = Math.min(this.acc, h);
    this.animate(dt);
    this.renderer.render(this.scene, this.camera);
    this.drawMini();
    this.hudT += dt;
    if (this.hudT > 0.12) {
      this.hudT = 0;
      this.emit();
    }
    this.fpsT += dt;
    this.fpsN++;
    if (this.fpsT > 2.5 && this.save.settings.autoGfx) {
      const fps = this.fpsN / this.fpsT;
      const order: Quality[] = ["low", "medium", "high", "ultra"];
      const idx = order.indexOf(this.save.settings.quality);
      if (fps < 28 && idx > 0) {
        this.save.settings.quality = order[idx - 1]!;
        this.applyQuality();
        if (this.cars.length > 8) {
          const drop = this.cars.pop();
          if (drop) this.scene.remove(drop.mesh);
        }
      }
      this.fpsT = 0;
      this.fpsN = 0;
    }
  };

  private step(dt: number) {
    if (this.phase !== "pause") {
      if (this.save.settings.autoTime) this.hour = (this.hour + dt / 40) % 24;
      this.stepTraffic(dt);
      this.stepPeds(dt);
      this.lightT += dt;
    }
    if (this.phase === "play") {
      this.stepPlayer(dt);
      this.navTick += dt;
      if (this.navTick > 1.2) {
        this.navTick = 0;
        this.recomputeRoute();
      }
    }
    this.stream();
    if (this.phase === "play") {
      this.saveT += dt;
      if (this.saveT > 8) {
        this.saveT = 0;
        this.persist();
      }
    }
  }

  private stepPlayer(dt: number) {
    const keys = this.forced ?? this.keys;
    const throttleKey = (keys.has("KeyW") || keys.has("ArrowUp")) ? 1 : 0;
    const brakeKey = (keys.has("KeyS") || keys.has("ArrowDown") || keys.has("Space")) ? 1 : 0;
    let steer = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) steer += 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) steer -= 1;
    steer = clamp(steer + this.touch.steer, -1, 1);
    const throttleIn = Math.max(throttleKey, this.touch.throttle);
    const brakeIn = Math.max(brakeKey, this.touch.brake);

    let throttle = 0;
    let brake = 0;
    if (!this.engine || this.fuel <= 0) {
      brake = brakeIn;
    } else if (this.save.settings.manual) {
      throttle = throttleIn;
      brake = brakeIn;
      if (this.gear === "P" && throttle > 0) this.gear = "D";
    } else if (brakeIn > 0 && this.speed <= 0.6 && throttleIn === 0) {
      this.gear = "R";
      throttle = brakeIn;
    } else if (brakeIn > 0 && this.speed > 0.4) {
      brake = brakeIn;
      if (this.gear === "R") this.gear = "D";
    } else if (throttleIn > 0) {
      if (this.gear === "P" || this.gear === "R" || this.gear === "N") this.gear = "D";
      throttle = throttleIn;
    } else if (brakeIn > 0) {
      brake = brakeIn;
    }
    if (this.gear === "P") {
      throttle = 0;
      brake = Math.max(brake, 0.5);
    }
    if (this.gear === "N") throttle = 0;

    const up = this.save.upgrades;
    const assist = this.save.settings.assists;
    const accelBase = this.spec.accel * (1 + up.engine * 0.08) * (1385 / this.spec.mass);
    const modeMul = this.driveMode === "sport" ? 1.16 : this.driveMode === "eco" ? 0.8 : 1;
    const brakeForce = this.spec.brake * (1 + up.brakes * 0.1);
    let top = (this.spec.top / 3.6) * (this.driveMode === "eco" ? 0.85 : this.driveMode === "sport" ? 1.05 : 1);
    if (this.spec.id === "m3" && this.driveMode === "sport") top *= 1.08;
    if (this.damage > 75) top *= 0.5;

    const paved = this.city ? true : onPaved(this.x, this.z);
    let grip = 2.2 + this.spec.handling * 2.8 + up.tires * 0.5;
    if (assist.esp) grip += 1.4;
    if (!assist.abs && brake > 0.65) grip *= 0.48;
    if (!assist.tcs && throttle > 0.8 && Math.abs(this.speed) < 8) grip *= 0.7;
    if (this.weather === "rain") grip *= 0.74;
    if (this.weather === "fog") grip *= 0.9;
    if (!paved) grip *= 0.48;

    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let fs = this.vx * fx + this.vz * fz;
    let ss = this.vx * rx + this.vz * rz;

    const gearSign = this.gear === "R" ? -1 : 1;
    if (throttle > 0 && this.gear !== "P" && this.gear !== "N") {
      const cap = this.save.settings.manual ? this.manualCap() : top;
      const room = clamp(1 - Math.abs(fs) / Math.max(2, cap), 0, 1);
      let drive = throttle * accelBase * modeMul * gearSign * (0.78 + 0.22 * room);
      if (this.save.settings.manual && this.gear === "D") drive *= this.manualTorque(Math.abs(fs));
      fs += drive * dt;
    }
    if (brake > 0) {
      const dec = brakeForce * (0.7 + brake);
      if (Math.abs(fs) <= dec * dt) fs = 0;
      else fs -= Math.sign(fs) * dec * dt;
    }
    const drag = (paved ? 0.28 : 1.8) + (this.driveMode === "eco" ? 0.12 : 0) + up.suspension * 0.01;
    fs *= Math.exp(-drag * dt);
    if (this.spec.id === "m3") {
      const hand = this.keys.has("Space") || (this.forced?.has("Space") ?? false);
      if (throttle > 0.45 && Math.abs(fs) > 6) ss += steer * throttle * 5 * dt;
      if (hand && Math.abs(fs) > 5) {
        this.yaw += steer * 2.2 * dt;
        ss += steer * 7 * dt;
      }
    }
    ss *= Math.exp(-grip * dt);

    const prev = this.speed;
    this.speed = fs;
    this.vx = fx * fs + rx * ss;
    this.vz = fz * fs + rz * ss;

    const rolling = Math.abs(fs) > 0.3;
    const reverse = fs >= -0.2 ? 1 : -1;
    const speedFactor = rolling ? Math.min(1, 0.45 + Math.abs(fs) / 14) : 0;
    const stab = 1 / (1 + Math.abs(fs) * 0.032);
    const massRoll = Math.sqrt(this.spec.mass / 1300);
    const turn = (0.9 + this.spec.handling * 1.2) * (1 + up.suspension * 0.06) / massRoll;
    this.yaw += steer * turn * speedFactor * stab * reverse * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (!this.city) {
      this.x = clamp(this.x, -WORLD / 2 + 6, WORLD / 2 - 6);
      this.z = clamp(this.z, -WORLD / 2 + 6, WORLD / 2 - 6);
    } else {
      const y = this.city.groundY(this.x, this.z);
      if (y == null) {
        this.offMap += dt;
        if (this.offMap > 0.5) this.respawn();
      } else {
        this.offMap = 0;
        this.carY += (y - this.carY) * Math.min(1, dt * 8);
      }
    }

    this.resolveStatic();
    this.resolveDynamic(dt);
    this.steerVisual += (steer - this.steerVisual) * Math.min(1, dt * 8);
    this.fuel = Math.max(0, this.fuel - Math.abs(fs) * dt * 0.00018 * (this.driveMode === "eco" ? 0.75 : this.driveMode === "sport" ? 1.12 : 1));
    if (this.fuel <= 0 && this.engine) {
      this.toast = "Out of fuel. Find Yoqilg'i.";
      this.toastT = 2;
    }
    this.sideForAudio = Math.abs(ss);
    this.accelForBody = (this.speed - prev) / dt;
    this.noteRules(dt);
    this.updateMission(dt);
    this.updateNav();
    this.hitCd = Math.max(0, this.hitCd - dt);
  }

  private sideForAudio = 0;
  private accelForBody = 0;

  private manualCap() {
    return [0, 14, 24, 36, 48, 62][this.manualGear] ?? 40;
  }

  private manualTorque(spd: number) {
    const sweet = [0, 6, 12, 20, 30, 42][this.manualGear] ?? 10;
    const d = Math.abs(spd - sweet);
    return clamp(1.25 - d / 28, 0.25, 1.25);
  }

  private colliders(): Collider[] {
    if (this.city) return this.city.colliders;
    const list: Collider[] = [];
    for (const id of TILES) {
      const tile = this.world.tiles[id];
      if (tile.group.parent) list.push(...tile.colliders);
    }
    return list;
  }

  private resolveStatic() {
    const rad = this.vehicle.radius * 0.72;
    for (const b of this.colliders()) {
      this.pushCircle(b, rad, true);
    }
    if (!this.city) {
      for (const p of this.parked) {
        if (p.health <= 0) continue;
        this.pushCircle({ minX: p.x - 0.2, maxX: p.x + 0.2, minZ: p.z - 0.2, maxZ: p.z + 0.2 }, rad + p.r, true);
      }
    }
  }

  private pushCircle(b: Collider, rad: number, damage: boolean) {
    const cx = clamp(this.x, b.minX, b.maxX);
    const cz = clamp(this.z, b.minZ, b.maxZ);
    let dx = this.x - cx;
    let dz = this.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > rad * rad) return;
    if (d2 < 1e-6) {
      const left = this.x - b.minX;
      const right = b.maxX - this.x;
      const north = this.z - b.minZ;
      const south = b.maxZ - this.z;
      const m = Math.min(left, right, north, south);
      if (m === left) this.x = b.minX - rad;
      else if (m === right) this.x = b.maxX + rad;
      else if (m === north) this.z = b.minZ - rad;
      else this.z = b.maxZ + rad;
      this.vx *= 0.2;
      this.vz *= 0.2;
      return;
    }
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const nz = dz / d;
    const pen = rad - d;
    this.x += nx * pen;
    this.z += nz * pen;
    const vn = this.vx * nx + this.vz * nz;
    if (vn < 0) {
      this.vx -= vn * nx * 1.2;
      this.vz -= vn * nz * 1.2;
        if (damage && -vn > 4.5 && this.hitCd <= 0) {
          this.damage = Math.min(100, this.damage + (-vn - 3) * 0.9);
          this.collisions++;
          this.hitCd = 0.45;
          this.shake = Math.min(0.6, this.shake + 0.28);
          this.audio.thud();
        }
    }
  }

  private resolveDynamic(dt: number) {
    const rad = this.vehicle.radius * 0.7;
    for (const car of this.cars) {
      if (!car.alive) continue;
      const dx = this.x - car.mesh.position.x;
      const dz = this.z - car.mesh.position.z;
      const d = Math.hypot(dx, dz);
      const min = rad + car.radius;
      if (d < min && d > 0.001) {
        const n = (min - d) / d;
        this.x += dx * n;
        this.z += dz * n;
        const nx = dx / d;
        const nz = dz / d;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= vn * nx;
          this.vz -= vn * nz;
          car.speed = Math.min(car.speed, 2);
          if (-vn > 3 && car.cool <= 0 && car.health > 0) {
            car.health = this.hurtMesh(car.mesh, car.health);
            car.cool = 0.55;
            if (car.health <= 0) car.alive = false;
          }
          if (-vn > 3 && this.hitCd <= 0) {
            this.damage = Math.min(100, this.damage + 3);
            this.collisions++;
            this.hitCd = 0.4;
            this.shake = Math.min(0.6, this.shake + 0.22);
            this.audio.thud();
          }
        }
      }
    }
    if (!this.city) {
      for (const p of this.parked) {
        if (p.health <= 0 || p.cool > 0) continue;
        const d = Math.hypot(this.x - p.x, this.z - p.z);
        if (d < rad + p.r && Math.abs(this.speed) > 3) {
          p.health = this.hurtMesh(p.mesh, p.health);
          p.cool = 0.55;
        }
      }
    }
    for (const ped of this.peds) {
      if (ped.down) continue;
      const dx = this.x - ped.mesh.position.x;
      const dz = this.z - ped.mesh.position.z;
      const d = Math.hypot(dx, dz);
      if (d < rad + 0.5 && d > 0.001 && Math.abs(this.speed) > 2) {
        ped.down = true;
        ped.downT = 0;
        if (this.hitCd <= 0) {
          this.damage = Math.min(100, this.damage + 2);
          this.collisions++;
          this.hitCd = 0.5;
          this.speed *= 0.35;
          this.vx *= 0.35;
          this.vz *= 0.35;
          this.toast = "Watch the crossing";
          this.toastT = 1.6;
          this.audio.blip(220, 0.08, "triangle", 0.03);
        }
      }
      void dt;
    }
  }

  private stepTraffic(dt: number) {
    const cycle = 20;
    const t = this.lightT % cycle;
    let ns: "g" | "y" | "r" = "r";
    let ew: "g" | "y" | "r" = "r";
    if (t < 8) ns = "g";
    else if (t < 10) ns = "y";
    else if (t < 18) ew = "g";
    else ew = "y";
    this.nsGo = ns === "g";
    const mats = this.world.signalMats;
    const paint = (list: THREE.Mesh[], state: "g" | "y" | "r") => {
      for (const b of list) {
        const role = b.userData.role as number;
        const on = (state === "r" && role === 0) || (state === "y" && role === 1) || (state === "g" && role === 2);
        b.material = on ? (role === 0 ? mats.redOn : role === 1 ? mats.yelOn : mats.grnOn) : mats.off;
      }
    };
    paint(this.world.signal.ns, ns);
    paint(this.world.signal.ew, ew);
    this.stepFumes(dt);
    for (const p of this.parked) p.cool = Math.max(0, p.cool - dt);

    for (const car of this.cars) {
      if (!car.alive) continue;
      car.cool = Math.max(0, car.cool - dt);
      car.hornBrake = Math.max(0, car.hornBrake - dt);
      car.laneT -= dt;
      if (car.laneT < 0) {
        car.laneT = 4 + Math.random() * 7;
        car.laneTarget = car.laneTarget > 0 ? -1.15 : 1.15;
      }
      car.lane += (car.laneTarget - car.lane) * Math.min(1, dt * 0.6);
      samplePath(car.path, car.cum, car.dist + 3, this.sample);
      const aheadX = this.sample.x;
      const aheadZ = this.sample.z;
      samplePath(car.path, car.cum, car.dist, this.sample);
      const tx = aheadX - this.sample.x;
      const tz = aheadZ - this.sample.z;
      const len = Math.hypot(tx, tz) || 1;
      car.tx = tx / len;
      car.tz = tz / len;
      let blocked = car.hornBrake > 0;
      for (const ix of this.ix) {
        const dx = ix.x - this.sample.x;
        const dz = ix.z - this.sample.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 15 && dist > 5 && dx * car.tx + dz * car.tz > 0) {
          const nsMove = Math.abs(car.tz) > Math.abs(car.tx);
          if (nsMove ? ns !== "g" : ew !== "g") blocked = true;
        }
      }
      const rx = -car.tz;
      const rz = car.tx;
      for (const other of this.cars) {
        if (other === car || !other.alive) continue;
        const dx = other.mesh.position.x - this.sample.x;
        const dz = other.mesh.position.z - this.sample.z;
        const along = dx * car.tx + dz * car.tz;
        const side = Math.abs(dx * rx + dz * rz);
        if (along > 0 && along < 9 + car.radius && side < 2.1) blocked = true;
      }
      const pdx = this.x - this.sample.x;
      const pdz = this.z - this.sample.z;
      if (pdx * car.tx + pdz * car.tz > 0 && Math.hypot(pdx, pdz) < 8) blocked = true;
      for (const ped of this.peds) {
        if (ped.kind !== "cross") continue;
        const dx = ped.mesh.position.x - this.sample.x;
        const dz = ped.mesh.position.z - this.sample.z;
        if (dx * car.tx + dz * car.tz > 0 && Math.hypot(dx, dz) < 9) blocked = true;
      }
      const target = blocked ? 0 : car.max;
      const rate = target < car.speed ? 16 : 6;
      car.speed += clamp(target - car.speed, -rate * dt, rate * dt);
      car.dist += car.speed * dt;
      const px = this.sample.x + rx * car.lane;
      const pz = this.sample.z + rz * car.lane;
      const py = this.city?.groundY(px, pz) ?? 0;
      car.mesh.position.set(px, py, pz);
      const targetYaw = Math.atan2(-car.tx, -car.tz);
      let dy = Math.atan2(Math.sin(targetYaw - car.yaw), Math.cos(targetYaw - car.yaw));
      car.yaw += dy * Math.min(1, dt * 4);
      car.mesh.rotation.y = car.yaw;
      const wheels = car.mesh.userData.wheels as THREE.Object3D[] | undefined;
      if (wheels) {
        const spin = car.speed * dt * 2.4;
        for (const w of wheels) w.rotation.x += spin;
      }
    }
  }

  private stepPeds(dt: number) {
    const ewGreen = !this.nsGo && this.lightT % 20 >= 10 && this.lightT % 20 < 18;
    for (const ped of this.peds) {
      if (ped.down) {
        ped.downT += dt;
        ped.mesh.rotation.x += (-Math.PI / 2 - ped.mesh.rotation.x) * Math.min(1, dt * 5);
        if (ped.downT > 4) ped.mesh.userData.dead = true;
        continue;
      }
      if (ped.kind === "map" && this.city) {
        const pts = this.city.sidewalk;
        if (pts.length) {
          const near = Math.hypot(this.x - ped.mesh.position.x, this.z - ped.mesh.position.z) < 4;
          if (!near) ped.a = (ped.a + ped.speed * dt * 0.04) % 1;
          const idx = Math.floor(ped.a * pts.length) % pts.length;
          const p = pts[idx]!;
          ped.mesh.position.set(p.x, this.city.groundY(p.x, p.z) ?? 0, p.z);
          ped.mesh.rotation.y = ped.yawJ;
        }
      } else if (ped.kind === "ring") {
        const near = Math.hypot(this.x - Math.cos(ped.a) * 52, this.z - Math.sin(ped.a) * 52) < 4;
        if (!near) ped.a += ped.speed * dt * 0.045;
        const r = 52;
        ped.mesh.position.set(Math.cos(ped.a) * r, 0, Math.sin(ped.a) * r);
        ped.mesh.rotation.y = ped.a + Math.PI / 2 + ped.yawJ;
      } else {
        const crossNs = ped.across === "x";
        const walk = (crossNs ? ewGreen : this.nsGo) && Math.hypot(this.x - ped.mesh.position.x, this.z - ped.mesh.position.z) > 4;
        if (!walk) ped.wait = 1;
        else {
          ped.t += ped.dir * ped.speed * dt * 0.18;
          if (ped.t > 1) {
            ped.t = 1;
            ped.dir = -1;
          }
          if (ped.t < 0) {
            ped.t = 0;
            ped.dir = 1;
          }
        }
        const along = ped.from + (ped.to - ped.from) * ped.t;
        if (ped.across === "z") ped.mesh.position.set(ped.fixed, 0, along);
        else ped.mesh.position.set(along, 0, ped.fixed);
        ped.mesh.rotation.y = (ped.dir > 0 ? 0 : Math.PI) + ped.yawJ;
      }
      const bob = Math.abs(Math.sin(performance.now() * 0.008 + ped.a)) * 0.04;
      if (ped.kind === "map") ped.mesh.position.y += bob;
      else ped.mesh.position.y = bob;
      const legs = ped.mesh.userData.legs as THREE.Object3D[] | undefined;
      if (legs) {
        const swing = Math.sin(performance.now() * 0.009 + ped.a * 3) * 0.5;
        legs[0]!.rotation.x = swing;
        legs[1]!.rotation.x = -swing;
      }
    }
    if (this.peds.some((p) => p.mesh.userData.dead)) {
      this.peds = this.peds.filter((p) => {
        if (!p.mesh.userData.dead) return true;
        this.scene.remove(p.mesh);
        return false;
      });
    }
  }

  private stream() {
    if (this.city) return;
    for (const id of TILES) {
      if (id === "center") {
        this.world.buildTile(id);
        continue;
      }
      const c = TILE_CENTERS[id];
      const d = Math.hypot(this.x - c.x, this.z - c.z);
      if (d < 290) this.world.buildTile(id);
      else if (d > 360) this.world.disposeTile(id);
    }
  }

  private noteRules(dt: number) {
    this.violCd = Math.max(0, this.violCd - dt);
    const kmh = Math.abs(this.speed) * 3.6;
    if (this.violCd <= 0 && onPaved(this.x, this.z) && kmh > speedLimit(this.x, this.z) + 4) {
      this.violations++;
      this.violCd = 6;
      this.toast = "Over the limit";
      this.toastT = 1.1;
      this.audio.blip(660, 0.06, "sine", 0.03);
      return;
    }
    if (this.violCd > 0 || Math.abs(this.speed) < 5) return;
    const t = this.lightT % 20;
    const nsGreen = t < 8;
    const ewGreen = t >= 10 && t < 18;
    const nsMove = Math.abs(Math.cos(this.yaw)) > 0.78;
    const ewMove = Math.abs(Math.sin(this.yaw)) > 0.78;
    for (const ix of this.ix) {
      if (Math.hypot(this.x - ix.x, this.z - ix.z) > 7) continue;
      if ((nsMove && !nsGreen) || (ewMove && !ewGreen)) {
        this.violations++;
        this.violCd = 6;
        this.toast = "Red light";
        this.toastT = 1.2;
      }
      break;
    }
  }

  private updateMission(dt: number) {
    const done = new Set(this.save.missions);
    this.missionClock += dt;
    const pay = (id: string, amount: number, msg: string) => {
      if (done.has(id)) return;
      const fine = Math.min(0.4, this.violations * 0.08);
      const paid = Math.round(amount * (1 - fine));
      this.save.missions.push(id);
      this.money += paid;
      this.save.money = this.money;
      this.toast = fine > 0 ? `${msg} Fines trimmed it to +${paid}.` : msg;
      this.toastT = 3.5;
      this.audio.blip(523, 0.12, "sine", 0.04);
      this.audio.blip(784, 0.16, "sine", 0.03);
      this.persist();
    };
    if (this.mission === "hotel") {
      const p = POIS.find((q) => q.id === "hotel")!;
      if (Math.hypot(this.x - p.x, this.z - p.z) < p.r) pay("hotel", 900, "Hotel Uzbekistan. +900 so'm.");
    } else if (this.mission === "majlis") {
      const p = POIS.find((q) => q.id === "majlis")!;
      if (Math.hypot(this.x - p.x, this.z - p.z) < p.r) pay("majlis", 1000, "Oliy Majlis. +1000 so'm.");
    } else if (this.mission === "tower") {
      const p = POIS.find((q) => q.id === "tower")!;
      if (Math.hypot(this.x - p.x, this.z - p.z) < p.r) {
        if (this.collisions === 0) pay("tower", 1400, "Clean run to the tower. +1400 so'm.");
        else {
          this.toast = "You arrived, but not clean. Try again from the garage.";
          this.toastT = 3;
          this.mission = "free";
        }
      }
    } else if (this.mission === "park") {
      const d = Math.hypot(this.x - PARK_BAY.x, this.z - PARK_BAY.z);
      if (!this.missionArmed && d > 18) this.missionArmed = true;
      const aligned = Math.abs(Math.atan2(Math.sin(this.yaw - PARK_BAY.yaw), Math.cos(this.yaw - PARK_BAY.yaw))) < 0.45;
      if (this.missionArmed && d < 3.2 && Math.abs(this.speed) < 0.6 && aligned) {
        this.parkHold += dt;
        if (this.parkHold > 1.4) pay("park", 700, "Parked cleanly. +700 so'm.");
      } else this.parkHold = 0;
    } else if (this.mission === "fuel") {
      const p = POIS.find((q) => q.id === "fuel")!;
      if (Math.hypot(this.x - p.x, this.z - p.z) < p.r && this.fuel > 0.96 && Math.abs(this.speed) < 1) pay("fuel", 500, "Tank filled. +500 so'm.");
    } else if (this.mission === "servis") {
      const p = POIS.find((q) => q.id === "servis")!;
      if (Math.hypot(this.x - p.x, this.z - p.z) < p.r && Math.abs(this.speed) < 1 && this.damage < 8) pay("servis", 450, "Serviced. +450 so'm.");
    } else if (this.mission === "night") {
      const p = POIS.find((q) => q.id === "tower")!;
      const dark = this.hour < 6 || this.hour > 19.5;
      if (dark && Math.hypot(this.x - p.x, this.z - p.z) < p.r) pay("night", 1100, "Night run to the tower. +1100 so'm.");
      else if (!dark && Math.hypot(this.x - p.x, this.z - p.z) < p.r) {
        this.toast = "Too bright. Come back after sunset.";
        this.toastT = 2;
      }
    } else if (this.mission === "rain") {
      const p = POIS.find((q) => q.id === "majlis")!;
      if (this.weather === "rain" && Math.hypot(this.x - p.x, this.z - p.z) < p.r) pay("rain", 1100, "Rain run to the Majlis. +1100 so'm.");
    } else if (this.mission === "express") {
      const p = POIS.find((q) => q.id === "hotel")!;
      if (Math.hypot(this.x - p.x, this.z - p.z) < p.r) {
        if (this.missionClock < 95) pay("express", 1200, "Express to the hotel. +1200 so'm.");
        else {
          this.toast = "Too slow for the express. Try again.";
          this.toastT = 2.5;
          this.mission = "free";
        }
      }
    }
  }

  private updateNav() {
    const poi = POIS.find((p) => p.id === this.dest);
    if (!poi || this.route.length === 0) {
      this.navText = "Free drive";
      this.prompt = this.nearPrompt();
      this.routeLine.geometry.setDrawRange(0, 0);
      return;
    }
    const arrive = Math.hypot(this.x - poi.x, this.z - poi.z);
    if (arrive < poi.r + 6) {
      this.navText = `Arrive · ${poi.name}`;
      this.prompt = this.nearPrompt();
      return;
    }
    let idx = 0;
    let best = 1e9;
    this.route.forEach((n, i) => {
      const d = Math.hypot(this.x - XS[n.i]!, this.z - ZS[n.j]!);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    const next = this.route[Math.min(this.route.length - 1, idx + 1)] ?? this.route[idx]!;
    const tx = XS[next.i]!;
    const tz = ZS[next.j]!;
    const dx = tx - this.x;
    const dz = tz - this.z;
    const desired = Math.atan2(-dx, -dz);
    let diff = Math.atan2(Math.sin(desired - this.yaw), Math.cos(desired - this.yaw));
    if (Math.abs(diff) > 2.4) this.navText = "MAKE A U-TURN";
    else if (diff > 0.55) this.navText = "TURN LEFT";
    else if (diff < -0.55) this.navText = "TURN RIGHT";
    else this.navText = "CONTINUE";
    this.navText += ` · ${poi.name}`;
    this.prompt = this.nearPrompt();
    this.drawRoute(poi);
  }

  private nearPrompt() {
    const fuel = POIS.find((p) => p.id === "fuel")!;
    if (Math.hypot(this.x - fuel.x, this.z - fuel.z) < fuel.r && Math.abs(this.speed) < 1.2) return "Stopped at the pump · F refuels";
    const bay = PARK_BAY;
    if (this.mission === "park" && Math.hypot(this.x - bay.x, this.z - bay.z) < 8) return "Marked bay · stop aligned";
    const serv = POIS.find((p) => p.id === "servis")!;
    if (Math.hypot(this.x - serv.x, this.z - serv.z) < serv.r && Math.abs(this.speed) < 1) return "Servis · G repairs";
    if (!this.engine) return "Engine off · I to start";
    if (this.gear === "P") return "Park · W to drive";
    return "";
  }

  private drawRoute(_poi: { x: number; z: number }) {
    this.routeLine.geometry.setDrawRange(0, 0);
  }

  private recomputeRoute() {
    const poi = POIS.find((p) => p.id === this.dest);
    if (!poi) {
      this.route = [];
      return;
    }
    const start = nearest(this.x, this.z);
    const goal = nearest(poi.x, poi.z);
    this.route = astar(start, goal);
  }

  private animate(dt: number) {
    const alt = Math.cos(((this.hour - 12) / 12) * Math.PI);
    const day = THREE.MathUtils.smoothstep(alt, -0.08, 0.35);
    const sunset = (1 - Math.min(1, Math.abs(alt) / 0.22)) * (this.hour > 15 || this.hour < 8 ? 1 : 0);
    const night = 1 - day;
    const topU = this.skyMat.uniforms.top!.value as THREE.Color;
    const horU = this.skyMat.uniforms.hor!.value as THREE.Color;
    topU.copy(this.colNightTop).lerp(this.colDayTop, day);
    this.colTmp.copy(this.colNightHor).lerp(this.colSetHor, sunset);
    horU.copy(this.colTmp).lerp(this.colDayHor, day * (1 - sunset));
    const sunAngle = ((this.hour - 6) / 12) * Math.PI;
    const sx = Math.cos(sunAngle) * 0.8;
    const sy = Math.sin(sunAngle);
    const sz = 0.35;
    (this.skyMat.uniforms.sun!.value as THREE.Vector3).set(sx, Math.max(-0.2, sy), sz);
    this.sun.intensity = 0.15 + day * 2.5;
    this.sun.position.set(this.x + sx * 40, Math.max(6, sy * 40), this.z + sz * 30);
    this.sun.target.position.set(this.x, 0, this.z);
    this.sun.target.updateMatrixWorld();
    this.sun.color.copy(sunset > 0.4 ? this.colSunSet : this.colSunDay);
    this.hemi.intensity = 0.25 + day * 0.7;
    this.renderer.toneMappingExposure = 0.55 + day * 0.55;
    const qFar = this.save.settings.quality === "low" ? 220 : this.save.settings.quality === "medium" ? 420 : 640;
    this.fog.color.copy(horU);
    this.fog.near = this.save.settings.quality === "low" ? 18 : this.weather === "fog" ? 12 : 48;
    this.fog.far = this.weather === "fog" ? qFar * 0.38 : this.weather === "rain" ? qFar * 0.7 : Math.max(780, qFar);
    this.world.lampMat.emissiveIntensity = night * 1.6;
    const groundMat = this.world.ground.material as THREE.MeshStandardMaterial;
    groundMat.color.set(this.weather === "rain" ? "#4e5458" : "#ffffff");
    for (const m of this.world.glowMats) m.emissiveIntensity = night * 0.85;
    const autoLights = night > 0.45 || this.weather === "fog" || this.weather === "rain";
    const spots = (this.vehicle.root.userData.spots as THREE.SpotLight[]) || [];
    for (const s of spots) s.intensity = this.lightsOn || autoLights ? 18 : 0;
    const headOn = this.lightsOn || autoLights ? 1.6 : 0.08;
    this.vehicle.head.emissiveIntensity = headOn;
    const brakeOn = this.touch.brake > 0 || this.keys.has("KeyS") || this.keys.has("Space") || (this.forced?.has("KeyS") ?? false) ? 2.4 : 0.12;
    this.vehicle.brake.emissiveIntensity = brakeOn;
    this.vehicle.reverse.emissiveIntensity = this.gear === "R" ? 1.3 : 0;
    this.blink += dt;
    if (this.blink > 0.38) {
      this.blink = 0;
      this.blinkOn = !this.blinkOn;
      if ((this.indL || this.indR || this.hazard) && this.blinkOn) this.audio.blip(1400, 0.035, "square", 0.02);
      this.prevInd = this.blinkOn;
    }
    const showL = (this.indL || this.hazard) && this.blinkOn;
    const showR = (this.indR || this.hazard) && this.blinkOn;
    this.vehicle.indL.emissiveIntensity = showL ? 2.2 : 0;
    this.vehicle.indR.emissiveIntensity = showR ? 2.2 : 0;
    const glow = this.vehicle.bodyLights;
    if (glow) {
      for (const m of glow.head) m.emissiveIntensity = headOn;
      for (const m of glow.brake) m.emissiveIntensity = brakeOn;
      for (const m of glow.indL) m.emissiveIntensity = showL ? 2.4 : 0;
      for (const m of glow.indR) m.emissiveIntensity = showR ? 2.4 : 0;
    }

    const gmat = this.world.ground.material as THREE.MeshStandardMaterial;
    gmat.roughness = this.weather === "rain" ? 0.16 : 0.9;
    gmat.metalness = this.weather === "rain" ? 0.42 : 0.02;
    gmat.envMapIntensity = this.weather === "rain" ? 0.85 : 0.25;

    if (this.street.length) {
      const lit = night > 0.3 || this.weather === "fog" || this.weather === "rain";
      const near = this.lamps
        .map((l) => ({ l, d: (l.x - this.x) ** 2 + (l.z - this.z) ** 2 }))
        .sort((a, b) => a.d - b.d);
      this.street.forEach((pl, i) => {
        const hit = near[i];
        if (!lit || !hit || hit.d > 55 * 55) {
          pl.intensity = 0;
          return;
        }
        pl.position.set(hit.l.x, 5.3, hit.l.z);
        pl.intensity = (this.weather === "fog" ? 5 : 7) * Math.max(night, 0.35);
      });
    }

    this.vehicle.root.position.set(this.x, this.carY, this.z);
    this.vehicle.root.rotation.y = this.yaw;
    const lean = clamp(this.steerVisual * Math.min(1, Math.abs(this.speed) / 11) * 0.1 * (this.spec.mass / 1450), -0.12, 0.12);
    this.vehicle.chassis.rotation.z = lean;
    this.vehicle.chassis.rotation.x = clamp(-this.accelForBody * 0.015 * (this.spec.mass / 1400), -0.07, 0.07);
    this.vehicle.tickWheels(dt, this.speed, this.steerVisual);
    this.vehicle.tickDriver?.(dt);
    const wheel = this.vehicle.root.userData.wheel as THREE.Object3D | undefined;
    if (wheel) wheel.rotation.set(0, Math.PI / 2, -this.steerVisual * 0.7);
    const kmh = Math.abs(this.speed) * 3.6;
    const sport = this.driveMode === "sport";
    const rpm = this.engine ? 900 + kmh * 32 + (this.gear === "R" ? 400 : 0) : 0;
    this.vehicle.dashPaint(kmh, this.displayGear());
    this.audio.setVolume(this.save.settings.volume);
    this.audio.update(rpm, this.speed, this.engine && this.phase === "play", Math.min(1, this.sideForAudio * 0.4), sport);
    this.city?.update(dt, this.save.settings.quality === "low");

    if (this.weather === "rain") {
      if (!this.rain) {
        const count = this.save.settings.quality === "low" ? 280 : this.save.settings.quality === "ultra" ? 900 : 560;
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          pos[i * 3] = (Math.random() - 0.5) * 40;
          pos[i * 3 + 1] = Math.random() * 18;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
        this.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#e7eef5", size: 0.07, transparent: true, opacity: 0.55 }));
        this.scene.add(this.rain);
      }
      this.rain.visible = true;
      const arr = (this.rain.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i + 1]! -= dt * 18;
        if (arr[i + 1]! < 0) arr[i + 1] = 16;
      }
      this.rain.geometry.attributes.position!.needsUpdate = true;
      this.rain.position.set(this.x, 0, this.z);
    } else if (this.rain) this.rain.visible = false;

    this.updateCamera(dt);
    if (this.toastT > 0) this.toastT -= dt;
    if (this.phase !== "pause") {
      this.sky.position.set(this.x, 0, this.z);
      if (this.star) this.star.position.set(this.x, 0, this.z);
    }
  }

  private mountStars() {
    void loadStarDome().then((dome) => {
      if (!dome || this.disposed) return;
      this.star = dome;
      this.scene.add(dome);
      this.sky.visible = false;
    });
  }

  private displayGear() {
    if (this.save.settings.manual && this.gear === "D") return String(this.manualGear);
    return this.gear;
  }

  private updateCamera(dt: number) {
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    const kmh = Math.abs(this.speed) * 3.6;
    const y = 0;
    const desired = this.desired;
    const look = this.lookTarget;
    look.set(this.x + fx * 6, 1.15, this.z + fz * 6);
    let fov = 60 + Math.min(12, kmh * 0.06);
    if (this.phase !== "play") {
      this.cine += dt * 0.18;
      desired.set(this.x + Math.sin(this.cine) * 8.5, 2.15, this.z + Math.cos(this.cine) * 8.5);
      look.set(this.x, 0.9, this.z);
      fov = 42;
    } else if (this.cam === "chase") {
      const dist = 6.4 + Math.min(1.6, kmh / 90);
      desired.set(this.x - fx * dist + rx * this.steerVisual * 0.55, y + 2.15 + Math.min(0.35, kmh / 220), this.z - fz * dist + rz * this.steerVisual * 0.55);
    } else if (this.cam === "close") {
      desired.set(this.x - fx * 4.1, y + 1.7, this.z - fz * 4.1);
      fov = 58;
    } else if (this.cam === "hood") {
      desired.set(this.x + fx * 1.55, y + 1.28, this.z + fz * 1.55);
      look.set(this.x + fx * 14, 1.02, this.z + fz * 14);
      fov = 70 + Math.min(6, kmh * 0.03);
    } else if (this.cam === "cabin") {
      desired.set(this.x + rx * -0.34 + fx * 0.25, y + 1.18, this.z + rz * -0.34 + fz * 0.25);
      look.set(this.x + rx * -0.34 + fx * 8, 1.12, this.z + rz * -0.34 + fz * 8);
      fov = 74;
    } else if (this.cam === "rear") {
      desired.set(this.x + fx * 0.15, y + 1.35, this.z + fz * 0.15);
      look.set(this.x - fx * 8, 0.85, this.z - fz * 8);
      fov = 62;
    } else {
      this.cine += dt * 0.22;
      desired.set(this.x + Math.sin(this.cine) * 11, 2.6 + Math.sin(this.cine * 0.5) * 0.4, this.z + Math.cos(this.cine) * 11);
      look.set(this.x, 1, this.z);
      fov = 48;
    }
    const k = 1 - Math.exp(-dt * (this.cam === "cabin" || this.cam === "hood" ? 10 : 4.5));
    if (this.phase !== "play") this.camPos.lerp(desired, 1 - Math.exp(-dt * 1.4));
    else this.camPos.lerp(desired, k);
    this.look.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.shake = Math.max(0, this.shake - dt);
    if (this.shake > 0) {
      this.camera.position.x += Math.sin(this.shake * 40) * this.shake * 0.15;
      this.camera.position.y += Math.cos(this.shake * 33) * this.shake * 0.08;
    }
    this.camera.lookAt(this.look);
    const f = this.camera.fov + (fov - this.camera.fov) * Math.min(1, dt * 4);
    if (Math.abs(f - this.camera.fov) > 0.05) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
    }
  }

  private drawMini() {
    const c = this.mini;
    if (!c) return;
    const g = c.getContext("2d");
    if (!g) return;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#14201c";
    g.fillRect(0, 0, w, h);
    const scale = w / 180;
    const cx = w / 2;
    const cy = h / 2;
    const px = (x: number) => cx + (x - this.x) * scale;
    const py = (z: number) => cy + (z - this.z) * scale;
    g.strokeStyle = "#3d4f48";
    g.lineWidth = 4;
    const roads = [
      [-260, -76, 260, -76],
      [-260, 76, 260, 76],
      [-76, -260, -76, 260],
      [76, -260, 76, 260],
      [-260, -168, 260, -168],
      [-260, 168, 260, 168],
      [-168, -260, -168, 260],
      [168, -260, 168, 260],
    ];
    for (const r of roads) {
      g.beginPath();
      g.moveTo(px(r[0]!), py(r[1]!));
      g.lineTo(px(r[2]!), py(r[3]!));
      g.stroke();
    }
    g.fillStyle = "#1e8f7b";
    g.beginPath();
    g.arc(px(0), py(0), 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#d4b06a";
    const poi = POIS.find((p) => p.id === this.dest);
    for (const p of POIS) {
      const here = p.id === this.dest;
      g.fillStyle = here ? "#f4ecdc" : "#d4b06a";
      g.fillRect(px(p.x) - (here ? 3 : 2), py(p.z) - (here ? 3 : 2), here ? 6 : 4, here ? 6 : 4);
    }
    if (poi && this.route.length) {
      g.strokeStyle = "#e7c87a";
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(cx, cy);
      for (const n of this.route) g.lineTo(px(XS[n.i]!), py(ZS[n.j]!));
      g.lineTo(px(poi.x), py(poi.z));
      g.stroke();
    }
    g.fillStyle = "#8fd0a8";
    for (const car of this.cars) {
      if (Math.hypot(car.mesh.position.x - this.x, car.mesh.position.z - this.z) > 90) continue;
      g.fillRect(px(car.mesh.position.x) - 1.5, py(car.mesh.position.z) - 1.5, 3, 3);
    }
    g.save();
    g.translate(cx, cy);
    g.rotate(-this.yaw);
    g.fillStyle = "#f4ecdc";
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(5, 6);
    g.lineTo(-5, 6);
    g.closePath();
    g.fill();
    g.restore();
  }

  private emit() {
    this.onSnap({
      phase: this.phase,
      speed: Math.abs(this.speed) * 3.6,
      gear: this.displayGear(),
      engine: this.engine,
      fuel: this.fuel,
      damage: this.damage,
      indL: this.indL || this.hazard,
      indR: this.indR || this.hazard,
      lights: this.lightsOn,
      nav: this.navText,
      prompt: this.prompt,
      hour: this.hour,
      weather: this.weather,
      driveMode: this.driveMode,
      mission: this.mission,
      money: this.money,
      vehicle: this.spec.name,
      cam: this.cam,
      collisions: this.collisions,
      toast: this.toastT > 0 ? this.toast : "",
      quality: this.save.settings.quality,
      dest: this.dest,
      rpm: this.engine ? 900 + Math.abs(this.speed) * 3.6 * 32 + (this.gear === "R" ? 400 : 0) : 0,
      violations: this.violations,
      unlimited: this.save.settings.unlimited,
      mapNote: this.mapNote,
    });
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.timer.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVis);
    delete window.__controlsTest;
    this.renderer.dispose();
  }
}

function nearest(x: number, z: number) {
  let bi = 0;
  let bj = 0;
  let best = 1e12;
  XS.forEach((xv, i) => {
    ZS.forEach((zv, j) => {
      const d = (x - xv) ** 2 + (z - zv) ** 2;
      if (d < best) {
        best = d;
        bi = i;
        bj = j;
      }
    });
  });
  return { i: bi, j: bj };
}

function astar(start: { i: number; j: number }, goal: { i: number; j: number }) {
  const key = (n: { i: number; j: number }) => `${n.i},${n.j}`;
  const open = [start];
  const came = new Map<string, string>();
  const g = new Map<string, number>([[key(start), 0]]);
  while (open.length) {
    open.sort((a, b) => (g.get(key(a)) ?? 0) + heur(a, goal) - ((g.get(key(b)) ?? 0) + heur(b, goal)));
    const cur = open.shift()!;
    if (cur.i === goal.i && cur.j === goal.j) {
      const path = [cur];
      let k = key(cur);
      while (came.has(k)) {
        const [i, j] = came.get(k)!.split(",").map(Number);
        path.push({ i: i!, j: j! });
        k = `${i},${j}`;
      }
      path.reverse();
      return path;
    }
    const nbs = [
      { i: cur.i - 1, j: cur.j },
      { i: cur.i + 1, j: cur.j },
      { i: cur.i, j: cur.j - 1 },
      { i: cur.i, j: cur.j + 1 },
    ].filter((n) => n.i >= 0 && n.j >= 0 && n.i < XS.length && n.j < ZS.length);
    for (const nb of nbs) {
      const cost = (g.get(key(cur)) ?? 0) + Math.hypot(XS[nb.i]! - XS[cur.i]!, ZS[nb.j]! - ZS[cur.j]!);
      if (cost < (g.get(key(nb)) ?? 1e12)) {
        g.set(key(nb), cost);
        came.set(key(nb), key(cur));
        if (!open.some((o) => o.i === nb.i && o.j === nb.j)) open.push(nb);
      }
    }
  }
  return [start];
}

function heur(a: { i: number; j: number }, b: { i: number; j: number }) {
  return Math.abs(XS[a.i]! - XS[b.i]!) + Math.abs(ZS[a.j]! - ZS[b.j]!);
}
