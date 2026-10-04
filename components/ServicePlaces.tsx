"use client";

import { useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { STATIONS, HOUSES, DEALER, useEconomy, type Station, type House } from "@/lib/economy";
import { worldState } from "@/lib/worldState";
import { skyState } from "@/lib/skyState";

// v1.8: UzNefteProdukt gas stations (fuel + AVTO SERVIS repair), homes for sale
// and the AVTO BOZOR dealer sign. Each place is 2 draw calls (one vertex-coloured
// merged body + one sign texture) and only exists within VIS m of the player;
// pump/column colliders only within PHYS m. Everything sits on the 6 m
// sidewalk band (|local x| 34..40) so the roads stay open.
const VIS = 230, PHYS = 110;

function signTexture(lines: { t: string; c: string; s: number }[], bg: string, w = 512, h = 256) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
  const total = lines.reduce((a, l) => a + l.s * 1.15, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    g.font = `900 ${l.s}px system-ui, sans-serif`; g.fillStyle = l.c; g.textAlign = "center"; g.textBaseline = "top";
    let s = l.s;
    while (g.measureText(l.t).width > w - 30 && s > 10) { s -= 2; g.font = `900 ${s}px system-ui, sans-serif`; }
    g.fillText(l.t, w / 2, y + (l.s - s) / 2); y += l.s * 1.15;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** merged box list → one geometry with vertex colours */
function boxes(list: [number, number, number, number, number, number, string][]) {
  const col = new THREE.Color();
  const geos = list.map(([x, y, z, w, h, d, c]) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    col.set(c);
    const n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g;
  });
  return mergeGeometries(geos)!;
}

const BODY_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 });
const signMats: THREE.MeshStandardMaterial[] = [];
function signMat(tex: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.25, roughness: 0.5 });
  signMats.push(m);
  return m;
}

// local frame: +x points from the pumps to the road (side), z along the road
// canopy spans the sidewalk and the kerb lane (x -3..10), 5.4 m clear — buses fit
const STATION_GEO = boxes([
  [3.5, 5.75, 0, 13, 0.5, 14, "#f4f6f8"], // canopy roof
  [3.5, 5.4, 0, 13.2, 0.25, 14.2, "#1f5fd0"], // blue fascia band
  [0, 2.75, -5, 0.5, 5.5, 0.5, "#d9dde3"], // columns (sidewalk)
  [0, 2.75, 5, 0.5, 5.5, 0.5, "#d9dde3"],
  [0, 0.12, 0, 2.2, 0.24, 13, "#c9ccd1"], // pump island
  [0, 0.95, -2.2, 0.8, 1.7, 1.1, "#1f5fd0"], // pumps
  [0, 0.95, 2.2, 0.8, 1.7, 1.1, "#2a9d4b"],
  [0, 1.4, -2.2, 0.84, 0.5, 0.8, "#11161f"],
  [0, 1.4, 2.2, 0.84, 0.5, 0.8, "#11161f"],
  [-1.6, 3.6, -7.4, 0.3, 7.2, 0.3, "#9aa2ad"], // sign pole
]);
const HOUSE_GEO = boxes([
  [0, 0.12, 0, 2.6, 0.24, 4, "#b9a98f"], // porch
  [-1.2, 1.4, 0, 0.3, 2.8, 2.4, "#6b4a2e"], // door frame
  [-1.1, 1.3, 0, 0.2, 2.4, 1.2, "#3d2a18"], // door
  [0.6, 1.4, -1.8, 0.12, 2.8, 0.12, "#8e939b"], // sign posts
  [0.6, 1.4, 1.8, 0.12, 2.8, 0.12, "#8e939b"],
]);
const DEALER_GEO = boxes([
  [0, 3.2, -6, 0.3, 6.4, 0.3, "#9aa2ad"],
  [0, 3.2, 6, 0.3, 6.4, 0.3, "#9aa2ad"],
]);

function StationPlace({ s, phys }: { s: Station; phys: boolean }) {
  const mat = useMemo(() => signMat(signTexture([
    { t: "UZNEFTEPRODUKT", c: "#ffffff", s: 50 },
    { t: "AI-92  $0.80   METAN  $0.40", c: "#ffd23f", s: 38 },
    { t: "⛽ YOQILG'I · 🔧 AVTO SERVIS", c: "#bfe3ff", s: 34 },
  ], "#1748a8")), []);
  const rot = s.side === 1 ? 0 : Math.PI;
  return (
    <group position={[s.x, 0, s.z]} rotation={[0, rot, 0]}>
      <mesh geometry={STATION_GEO} material={BODY_MAT} castShadow receiveShadow />
      <mesh position={[-1.6, 6.6, -7.4]} rotation={[0, Math.PI / 2, 0]} material={mat}>
        <planeGeometry args={[6, 3]} />
      </mesh>
      {phys && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[0.45, 1, 3.4]} position={[0, 1, 0]} />
          <CuboidCollider args={[0.3, 2.75, 0.3]} position={[0, 2.75, -5]} />
          <CuboidCollider args={[0.3, 2.75, 0.3]} position={[0, 2.75, 5]} />
        </RigidBody>
      )}
    </group>
  );
}

function HousePlace({ h, owned, home }: { h: House; owned: boolean; home: boolean }) {
  const mat = useMemo(() => signMat(signTexture(owned
    ? [{ t: home ? "🏠 UYIM · HOME" : "🏠 MENING UYIM", c: "#9dff6a", s: 54 }, { t: h.name, c: "#ffffff", s: 36 }]
    : [{ t: "SOTILADI · FOR SALE", c: "#ffd23f", s: 50 }, { t: h.name, c: "#ffffff", s: 34 }, { t: `$${h.price.toLocaleString("en-US")}`, c: "#9dff6a", s: 44 }], owned ? "#1d4d2b" : "#5a1d1d")), [h, owned, home]);
  return (
    <group position={[h.x, 0, h.z]} rotation={[0, h.side === 1 ? 0 : Math.PI, 0]}>
      <mesh geometry={HOUSE_GEO} material={BODY_MAT} receiveShadow />
      <mesh position={[0.62, 2.3, 0]} rotation={[0, Math.PI / 2, 0]} material={mat}>
        <planeGeometry args={[3.6, 1.8]} />
      </mesh>
    </group>
  );
}

function DealerSign() {
  const mat = useMemo(() => signMat(signTexture([
    { t: "AVTO BOZOR", c: "#00e5ff", s: 64 },
    { t: "2103 $600 · COBALT $1500 · CAPTIVA $3000", c: "#ffffff", s: 30 },
    { t: "STOP HERE TO BUY", c: "#ffd23f", s: 32 },
  ], "#10202a", 768, 256)), []);
  // on the west kerb of the x=-50 street, facing the road
  return (
    <group position={[-37, 0, DEALER.z]}>
      <mesh geometry={DEALER_GEO} material={BODY_MAT} />
      <mesh position={[0, 6.4, 0]} rotation={[0, -Math.PI / 2, 0]} material={mat}>
        <planeGeometry args={[12, 4]} />
      </mesh>
    </group>
  );
}

export function ServicePlaces() {
  const [near, setNear] = useState<string>("");
  const acc = useRef(0);
  const owned = useEconomy((s) => s.houses);
  const home = useEconomy((s) => s.home);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < 0.5) return;
    acc.current = 0;
    const { px, pz } = worldState;
    const ids: string[] = [];
    for (const s of STATIONS) { const d = Math.hypot(s.x - px, s.z - pz); if (d < VIS) ids.push(d < PHYS ? s.id + "!" : s.id); }
    for (const h of HOUSES) if (Math.hypot(h.x - px, h.z - pz) < VIS) ids.push(h.id);
    if (Math.hypot(DEALER.x - px, DEALER.z - pz) < VIS) ids.push("dealer");
    const k = ids.join(",");
    if (k !== near) setNear(k);
    // signs glow a little brighter at night
    const e = 0.25 + skyState.nightK * 0.9;
    for (const m of signMats) m.emissiveIntensity = e;
  });
  const set = new Set(near.split(","));
  return (
    <group>
      {STATIONS.map((s) => (set.has(s.id) || set.has(s.id + "!")) && <StationPlace key={s.id} s={s} phys={set.has(s.id + "!")} />)}
      {HOUSES.map((h) => set.has(h.id) && <HousePlace key={h.id} h={h} owned={owned.includes(h.id)} home={home === h.id} />)}
      {set.has("dealer") && <DealerSign />}
    </group>
  );
}
