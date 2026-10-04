"use client";

import { Suspense, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import { RigidBody, CuboidCollider } from "@react-three/rapier";
import * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";
import { useGfxStore, IS_MOBILE } from "@/lib/gfx";
import { asset } from "@/lib/asset";
import { skyState } from "@/lib/skyState";
import BLOCKS from "@/public/models/bigcity/blocks.json";

// v1.7.1 "Big City" map. Every 68x68 m block interior of the normal 100 m
// road grid is filled with one real city block sliced out of 4 Sketchfab city
// packs (scripts/build-bigcity.mjs; credits in CREDITS.md):
//   block-<kit>-<n>.glb      full geometry, merged per material (near LOD)
//   block-<kit>-<n>-imp.glb  baked box impostor, 1 material = 1 draw call (far LOD + phone LOW)
// Block choice and 90° rotation are hashed per chunk, so the city is stable.
// Colliders are the impostor's heightmap boxes (same volumes the far LOD shows).
type Block = { kit: string; name: string; h: number; tris: number; calls: number; imp: number[][] };
const LIST = (BLOCKS as { blocks: Block[] }).blocks;
// tiny/sparse tiles (a single low building) show up less often
const WEIGHTED: Block[] = LIST.flatMap((b) => Array(b.imp.length >= 12 ? 3 : 1).fill(b));

function hash(ci: number, cj: number) {
  let h = Math.imul(ci, 374761393) ^ Math.imul(cj, 668265263) ^ 0x27d4eb2f;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
export function bigCityBlockFor(ci: number, cj: number) {
  const h = hash(ci, cj);
  return { block: WEIGHTED[h % WEIGHTED.length], rot: ((h >>> 8) & 3) * (Math.PI / 2) };
}

const url = (name: string, imp: boolean) => asset(`/models/bigcity/${name}${imp ? "-imp" : ""}.glb`);

// night: every Big City material glows faintly with its own texture (lit
// windows read from afar); one shared update per frame over all materials
const NIGHT_MATS = new Set<THREE.MeshStandardMaterial>();
let nightFrame = -1;
function updateNight(frame: number) {
  if (frame === nightFrame) return;
  nightFrame = frame;
  const k = skyState.nightK;
  for (const m of NIGHT_MATS) m.emissiveIntensity = k * 0.32;
}
function prep(root: THREE.Object3D, shadows: boolean) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = shadows; m.receiveShadow = shadows; m.matrixAutoUpdate = false; m.updateMatrix();
    const mat = m.material as THREE.MeshStandardMaterial;
    if (mat.isMeshStandardMaterial && !NIGHT_MATS.has(mat)) {
      if (mat.map) { mat.emissiveMap = mat.map; mat.emissive.set("#ffe2b0"); } else mat.emissive.copy(mat.color).multiplyScalar(0.6);
      mat.emissiveIntensity = skyState.nightK * 0.32;
      mat.needsUpdate = true;
      NIGHT_MATS.add(mat);
    }
  });
  return root;
}

function Impostor({ name }: { name: string }) {
  const g = useGLTF(url(name, true));
  const obj = useMemo(() => prep(g.scene.clone(true), false), [g]);
  return <primitive object={obj} />;
}
function Full({ name, shadows }: { name: string; shadows: boolean }) {
  const g = useGLTF(url(name, false));
  const obj = useMemo(() => prep(g.scene.clone(true), shadows), [g, shadows]);
  return <primitive object={obj} />;
}

export function BigCityBlock({ ci, cj, cell }: { ci: number; cj: number; cell: number }) {
  const { block, rot } = useMemo(() => bigCityBlockFor(ci, cj), [ci, cj]);
  const cx = ci * cell, cz = cj * cell;
  const quality = useGfxStore((s) => s.quality);
  // full geometry only near the camera, never on LOW
  const near = quality === "low" ? 0 : IS_MOBILE ? 55 : 125;
  const [full, setFull] = useState(false);
  const [tick] = useState(() => (ci * 5 + cj * 3) & 7);
  let n = tick;
  useFrame((state) => {
    updateNight(state.clock.elapsedTime);
    if ((n++ & 7) !== 0) return;
    if (!near) { if (full) setFull(false); return; }
    const p = state.camera.position;
    const dx = Math.max(0, Math.abs(p.x - cx) - 34), dz = Math.max(0, Math.abs(p.z - cz) - 34);
    const d = Math.hypot(dx, dz);
    if (!full && d < near) setFull(true);
    else if (full && d > near + 15) setFull(false);
  });
  const imp = <Impostor name={block.name} />;
  return (
    <group name="BigCity">
      <RigidBody type="fixed" colliders={false} position={[cx, 0, cz]} rotation={[0, rot, 0]}>
        {block.imp.map(([x0, y0, z0, x1, y1, z1], i) => (
          <CuboidCollider key={i} args={[(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2]} position={[(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]} />
        ))}
      </RigidBody>
      <group position={[cx, 0.02, cz]} rotation={[0, rot, 0]}>
        <Suspense fallback={null}>
          {full ? <Suspense fallback={imp}><Full name={block.name} shadows={quality === "high" && !IS_MOBILE} /></Suspense> : imp}
        </Suspense>
      </group>
    </group>
  );
}
