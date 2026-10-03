import * as THREE from "three";

// v1.6 wheel rigging for GLB cars whose four wheels are baked into shared
// meshes (one "Tire" mesh holding all four tyres, rims merged into the body…).
// At load time, in the car's ground space (road y=0, nose +z, +x = left):
//  1. the tyre contact patches (lowest vertices) are clustered into 4 wheels
//  2. each wheel's radius is measured from the vertex column above its patch
//     (tyre top = first vertical gap above the ground), sanity-clamped to the
//     car's real tyre size
//  3. every triangle that lies entirely inside a wheel's cylinder is moved
//     out of its mesh into a per-wheel, per-material merged mesh whose
//     geometry is re-centred on the wheel hub (the new pivot)
// Result: steer (yaw) → spin (roll about x) groups per wheel. Brake calipers
// stay static (only the two biggest materials per wheel — tyre + rim — are
// moved, to keep the phone draw-call budget: +8 calls per car).

export interface WheelRig {
  wheels: { steer: THREE.Group; spin: THREE.Group; front: boolean; radius: number }[];
  radius: number;
}

interface WheelGuess { x: number; z: number; r: number }

const _v = new THREE.Vector3();
const MAX_PARTS = 2;

function worldPositions(mesh: THREE.Mesh): Float32Array {
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    out[i * 3] = _v.x; out[i * 3 + 1] = _v.y; out[i * 3 + 2] = _v.z;
  }
  return out;
}

function findWheels(meshes: { mesh: THREE.Mesh; wp: Float32Array }[], specR: number): WheelGuess[] | null {
  let minY = Infinity;
  for (const { wp } of meshes) for (let i = 1; i < wp.length; i += 3) minY = Math.min(minY, wp[i]);
  const low: [number, number][] = [];
  for (const { wp } of meshes) for (let i = 0; i < wp.length; i += 3) if (wp[i + 1] < minY + 0.035) low.push([wp[i], wp[i + 2]]);
  if (low.length < 8) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of low) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  // k-means (4) seeded at the corners of the contact footprint
  const c = [[x1, z1], [x0, z1], [x1, z0], [x0, z0]];
  for (let it = 0; it < 8; it++) {
    const acc = c.map(() => [0, 0, 0]);
    for (const [x, z] of low) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < 4; k++) { const d = (x - c[k][0]) ** 2 + (z - c[k][1]) ** 2; if (d < bd) { bd = d; bi = k; } }
      acc[bi][0] += x; acc[bi][1] += z; acc[bi][2]++;
    }
    for (let k = 0; k < 4; k++) if (acc[k][2]) { c[k][0] = acc[k][0] / acc[k][2]; c[k][1] = acc[k][1] / acc[k][2]; }
  }
  // all four must be distinct corners
  if (!(c[0][0] > c[1][0] && c[2][0] > c[3][0] && c[0][1] > c[2][1] && c[1][1] > c[3][1])) return null;
  // per wheel: best-fit tyre circle in the (z, y) side plane, touching the
  // road (centre height = radius): most vertices on the circle wins. Only the
  // lower half is scored (the wheel-arch lip above is a bigger circle), and
  // the radius stays within ±8 % of the real tyre size (models are scaled to
  // the real car length, so the real tyre is a good prior).
  const fits = c.map(([cx, cz]) => {
    const pts: number[] = [];
    for (const { wp } of meshes) for (let i = 0; i < wp.length; i += 3) {
      const y = wp[i + 1] - minY;
      if (Math.abs(wp[i] - cx) < 0.13 && Math.abs(wp[i + 2] - cz) < 0.6 && y < specR * 1.15) pts.push(wp[i + 2], y);
    }
    let best = { s: -1, z: cz, r: specR };
    for (let r = specR * 0.92; r <= specR * 1.08; r += 0.004) for (let dz = -0.15; dz <= 0.15; dz += 0.01) {
      const zc = cz + dz;
      let sc = 0;
      for (let i = 0; i < pts.length; i += 2) { const d = Math.hypot(pts[i] - zc, pts[i + 1] - r); if (Math.abs(d - r) < 0.01) sc++; }
      if (sc > best.s) best = { s: sc, z: zc, r };
    }
    return { x: cx, z: best.z, r: best.s >= 12 ? best.r : specR, s: best.s };
  });
  // both wheels of an axle share z and radius: take the better-scoring fit
  // (one side often has extra brake/arch geometry that skews its fit)
  for (const [a, b] of [[0, 1], [2, 3]]) {
    const w = fits[a].s >= fits[b].s ? fits[a] : fits[b];
    for (const k of [a, b]) { fits[k].z = w.z; fits[k].r = w.r; }
    const mid = (fits[a].x + fits[b].x) / 2, half = Math.abs(fits[a].x - fits[b].x) / 2;
    fits[a].x = mid + half; fits[b].x = mid - half; // c[0]/c[2] are the +x (left) wheels
  }
  return fits.map(({ x, z, r }) => ({ x, z, r }));
}

/** Rig the wheels of a prepared car. `root` must be at its final pose in its
 * parent's space with the road at y=0. Returns null if the wheels can't be
 * found (the car then simply keeps static wheels). */
export function rigWheels(root: THREE.Object3D, specR = 0.32): WheelRig | null {
  root.updateMatrixWorld(true);
  const meshes: { mesh: THREE.Mesh; wp: Float32Array }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || Array.isArray(m.material) || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (m.name === "td-plate") return;
    meshes.push({ mesh: m, wp: worldPositions(m) });
  });
  const guess = findWheels(meshes, specR);
  if (!guess) return null;
  const parentInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rootScale = new THREE.Vector3().setFromMatrixScale(root.matrixWorld).x;
  // collect per wheel, per (material, attribute layout) merged triangles
  type Bucket = { mat: THREE.Material; pos: number[]; nrm: number[]; uv: number[] | null; caliper: boolean };
  const buckets: Map<string, Bucket>[] = guess.map(() => new Map());
  const nm = new THREE.Matrix3();
  const n = new THREE.Vector3();
  // pass 1: which wheel cylinder (if any) holds each triangle
  const cls = meshes.map(({ mesh, wp }) => {
    const g = mesh.geometry;
    const idx = g.getIndex();
    const triCount = idx ? idx.count / 3 : g.getAttribute("position").count / 3;
    const out = new Int8Array(triCount).fill(-1);
    for (let t = 0; t < triCount; t++) {
      let w = -1;
      for (let k = 0; k < 3 && (k === 0 || w >= 0); k++) {
        const i = (idx ? idx.getX(t * 3 + k) : t * 3 + k) * 3;
        const x = wp[i], y = wp[i + 1], z = wp[i + 2];
        let hit = -1;
        for (let q = 0; q < 4; q++) {
          const G = guess[q];
          if (Math.abs(x - G.x) < 0.2 && (y - G.r) ** 2 + (z - G.z) ** 2 < (G.r * 1.03) ** 2) { hit = q; break; }
        }
        if (k === 0) w = hit; else if (hit !== w) w = -1;
      }
      out[t] = w;
    }
    return out;
  });
  // phone budget: per wheel only the MAX_PARTS biggest materials (tyre, rim)
  // move into the spinning part; small bits (caps, discs, logos) stay put
  const tally = guess.map(() => new Map<string, number>());
  meshes.forEach(({ mesh }, mi) => { const key = (mesh.material as THREE.Material).uuid; for (const w of cls[mi]) if (w >= 0) tally[w].set(key, (tally[w].get(key) ?? 0) + 1); });
  const chosen = tally.map((m) => new Set([...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, MAX_PARTS).map(([k]) => k)));
  // pass 2: move the chosen triangles, re-centred on the hub
  meshes.forEach(({ mesh, wp }, mi) => {
    const g = mesh.geometry;
    const idx = g.getIndex();
    const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
    const mat = mesh.material as THREE.Material;
    const keep: number[] = [];
    let moved = 0;
    const nrmA = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
    const uvA = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
    nm.getNormalMatrix(mesh.matrixWorld);
    const order = mesh.matrixWorld.determinant() < 0 ? [0, 2, 1] : [0, 1, 2]; // mirrored mesh: keep winding
    const c = cls[mi];
    for (let t = 0; t < c.length; t++) {
      const w = c[t];
      if (w < 0 || !chosen[w].has(mat.uuid)) { keep.push(vi(t, 0), vi(t, 1), vi(t, 2)); continue; }
      moved++;
      let b = buckets[w].get(mat.uuid);
      if (!b) { b = { mat, pos: [], nrm: [], uv: uvA ? [] : null, caliper: false }; buckets[w].set(mat.uuid, b); }
      const G = guess[w];
      for (const k of order) {
        const v = vi(t, k);
        b.pos.push(wp[v * 3] - G.x, wp[v * 3 + 1] - G.r, wp[v * 3 + 2] - G.z);
        if (nrmA) { n.fromBufferAttribute(nrmA, v).applyMatrix3(nm).normalize(); b.nrm.push(n.x, n.y, n.z); } else b.nrm.push(0, 1, 0);
        if (b.uv && uvA) b.uv.push(uvA.getX(v), uvA.getY(v));
      }
    }
    if (!moved) return;
    if (!keep.length) { mesh.visible = false; return; }
    const ng = g.clone();
    ng.setIndex(keep);
    mesh.geometry = ng;
  });
  const rig: WheelRig = { wheels: [], radius: 0 };
  guess.forEach((G, q) => {
    const steer = new THREE.Group();
    steer.name = `td-wheel-${q}`;
    const spin = new THREE.Group();
    steer.add(spin);
    // the pivot lives in root's local space; meshes are baked in parent
    // (ground) metres, so undo root's uniform scale on the pivot
    steer.position.copy(new THREE.Vector3(G.x, G.r, G.z).applyMatrix4(parentInv));
    steer.scale.setScalar(1 / rootScale);
    for (const b of buckets[q].values()) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(b.nrm, 3));
      if (b.uv) geo.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, b.mat);
      m.castShadow = true;
      (b.caliper ? steer : spin).add(m);
    }
    root.add(steer);
    rig.wheels.push({ steer, spin, front: q < 2, radius: G.r });
  });
  rig.radius = guess.reduce((s, g) => s + g.r, 0) / 4;
  return rig;
}

/** Per-frame: roll by distance / radius, front wheels yaw with steering. */
export function poseWheels(rig: WheelRig, speed: number, delta: number, dt: number, rearLocked: boolean, rearSpinBoost: number) {
  for (const w of rig.wheels) {
    let omega = speed / w.radius;
    if (!w.front) omega = rearLocked ? 0 : omega * (1 + rearSpinBoost);
    w.spin.rotation.x = (w.spin.rotation.x + omega * dt) % (Math.PI * 2);
    if (w.front) w.steer.rotation.y = delta;
  }
}
