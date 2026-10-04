"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";
import { useGfxStore } from "@/lib/gfx";
import { AIRPORT_CHUNKS } from "@/components/City";
import { HIGHWAY_CHUNKS } from "@/lib/highway";
import { SHORE_X } from "@/lib/marina";
import { signalFor, signalTime } from "@/lib/trafficSignals";

// v1.8: signal heads at every grid junction near the camera. One pole per
// junction corner (on the sidewalk corner, 12.5 m out from the junction
// centre on both axes), each carrying two heads — one facing along x, one
// along z — so whichever way a car approaches it sees a lit head on its side
// of the road. The bulbs
// are re-coloured from the shared cycle (lib/trafficSignals.ts) per frame.

const CELL = 100;
const OUT = 12.5;
const POLE_H = 5.2;
const MAX_RING = 2; // 5×5 junctions on MEDIUM/HIGH
const MAX_J = (MAX_RING * 2 + 1) ** 2;

// everything is the same unit box, scaled per instance, in ONE unlit
// InstancedMesh with per-instance colour: 1 draw call for every pole, head
// and bulb in view (phone LOW: 3×3 junctions ≈ 320 boxes ≈ 3.9k tris)
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
const PER_J = 4 + 8 + 24;
const POLE_C = new THREE.Color("#23262b"), HEAD_C = new THREE.Color("#15171a");
const RED = new THREE.Color("#ff2414"), RED_OFF = new THREE.Color("#2a0d0b");
const AMB = new THREE.Color("#ffb21a"), AMB_OFF = new THREE.Color("#2a200b");
const GRN = new THREE.Color("#2cff6a"), GRN_OFF = new THREE.Color("#0b2a15");

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const pv = new THREE.Vector3();
const scl = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

/** junction list currently drawn; [x, z] pairs */
const juncs: number[] = [];
const last = { ci: NaN, cj: NaN, ring: -1 };
// per bulb instance: index, axis it shows (0 = x, 1 = z), bulb (0 r,1 y,2 g)
const lampIdx: number[] = [];
const lampAxis: number[] = [];
const lampBulb: number[] = [];

export function junctionOk(x: number, z: number): boolean {
  if (x >= SHORE_X - 60) return false;
  for (const [dx, dz] of [[-50, -50], [50, -50], [-50, 50], [50, 50]]) {
    const key = `${Math.round((x + dx) / CELL)},${Math.round((z + dz) / CELL)}`;
    if (AIRPORT_CHUNKS.has(key) || HIGHWAY_CHUNKS.has(key)) return false;
  }
  return true;
}

// module scope (react-hooks/immutability: no mutating memoised values in useFrame)
const boxes = new THREE.InstancedMesh(boxGeo, mat, MAX_J * PER_J);
boxes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_J * PER_J * 3), 3);
boxes.count = 0;
boxes.frustumCulled = false;
boxes.matrixAutoUpdate = false;
boxes.name = "traffic-signals";

export function TrafficSignals() {
  const quality = useGfxStore((s) => s.quality);
  const ring = quality === "low" ? 1 : MAX_RING;
  useEffect(() => {
    last.ci = NaN; // re-layout on (re)mount
  }, []);

  useFrame(({ camera }) => {
    const ci = Math.round((camera.position.x - 50) / CELL);
    const cj = Math.round((camera.position.z - 50) / CELL);
    if (ci !== last.ci || cj !== last.cj || ring !== last.ring) {
      last.ci = ci; last.cj = cj; last.ring = ring;
      juncs.length = 0;
      for (let i = -ring; i <= ring; i++)
        for (let j = -ring; j <= ring; j++) {
          const x = (ci + i) * CELL + 50, z = (cj + j) * CELL + 50;
          if (junctionOk(x, z)) juncs.push(x, z);
        }
      let n = 0;
      lampIdx.length = 0;
      lampAxis.length = 0;
      lampBulb.length = 0;
      for (let k = 0; k < juncs.length; k += 2) {
        const jx = juncs[k], jz = juncs[k + 1];
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            const px = jx + sx * OUT, pz = jz + sz * OUT;
            q.identity();
            m4.compose(pv.set(px, POLE_H / 2, pz), q, scl.set(0.22, POLE_H, 0.22));
            boxes.setMatrixAt(n, m4);
            boxes.setColorAt(n++, POLE_C);
            // head A faces outward along x (seen by cars approaching along x
            // from this side), head B outward along z
            for (let a = 0; a < 2; a++) {
              const fx = a === 0 ? sx : 0, fz = a === 0 ? 0 : sz;
              const hx = px + fx * 0.3, hz = pz + fz * 0.3, hy = POLE_H - 0.7;
              q.setFromAxisAngle(yAxis, -Math.atan2(fz, fx));
              m4.compose(pv.set(hx, hy, hz), q, scl.set(0.34, 1.15, 0.34));
              boxes.setMatrixAt(n, m4);
              boxes.setColorAt(n++, HEAD_C);
              for (let b = 0; b < 3; b++) {
                m4.compose(pv.set(hx + fx * 0.18, hy + 0.36 - b * 0.36, hz + fz * 0.18), q, scl.set(0.06, 0.24, 0.24));
                boxes.setMatrixAt(n, m4);
                lampIdx.push(n++);
                lampAxis.push(a);
                lampBulb.push(b);
              }
            }
          }
      }
      boxes.count = n;
      boxes.instanceMatrix.needsUpdate = true;
    }
    const t = signalTime();
    const sx = signalFor("x", t), sz = signalFor("z", t);
    for (let i = 0; i < lampIdx.length; i++) {
      const s = lampAxis[i] === 0 ? sx : sz;
      const b = lampBulb[i];
      const c = b === 0 ? (s === 0 ? RED : RED_OFF) : b === 1 ? (s === 1 ? AMB : AMB_OFF) : s === 2 ? GRN : GRN_OFF;
      boxes.setColorAt(lampIdx[i], c);
    }
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  });

  return (
<primitive object={boxes} />
  );
}
