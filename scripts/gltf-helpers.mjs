// Shared glTF-Transform helpers for scripts/optimize-*.mjs
// Column-major 4x4 helpers (glTF matrix layout)
const mul4 = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};

/** Bake skinned meshes into static geometry at their bind/rest pose. A rigged
 *  car (doors/wheels on bones) can't be flattened or joined and renders as
 *  SkinnedMesh (extra shader variants and a bone texture per mesh); the game
 *  moves the whole body as one rigid object anyway. */
export function bakeSkins(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  let baked = 0;
  for (const node of root.listNodes()) {
    const skin = node.getSkin(); const mesh = node.getMesh();
    if (!skin || !mesh) continue;
    const joints = skin.listJoints();
    const ibm = skin.getInverseBindMatrices();
    const jm = joints.map((j, i) => mul4(j.getWorldMatrix(), ibm ? ibm.getElement(i, []) : [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]));
    for (const prim of mesh.listPrimitives()) {
      const J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
      const P = prim.getAttribute("POSITION"), N = prim.getAttribute("NORMAL"), T = prim.getAttribute("TANGENT");
      if (!J || !W) continue;
      const n = P.getCount();
      const pos = new Float32Array(n * 3), nor = N ? new Float32Array(n * 3) : null, tan = T ? new Float32Array(n * 4) : null;
      const j4 = [], w4 = [], v = [], m = new Array(16);
      for (let i = 0; i < n; i++) {
        J.getElement(i, j4); W.getElement(i, w4);
        m.fill(0);
        let ws = 0;
        for (let k = 0; k < 4; k++) { const w = w4[k]; if (!w) continue; ws += w; const M = jm[j4[k]]; for (let e = 0; e < 16; e++) m[e] += w * M[e]; }
        if (ws > 0 && Math.abs(ws - 1) > 1e-4) for (let e = 0; e < 16; e++) m[e] /= ws;
        P.getElement(i, v);
        pos[i * 3] = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        pos[i * 3 + 1] = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13];
        pos[i * 3 + 2] = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        const dir = (src, dst, stride) => {
          src.getElement(i, v);
          let x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2], z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2];
          const l = Math.hypot(x, y, z) || 1; dst[i * stride] = x / l; dst[i * stride + 1] = y / l; dst[i * stride + 2] = z / l;
          if (stride === 4) dst[i * 4 + 3] = v[3] ?? 1;
        };
        if (nor) dir(N, nor, 3);
        if (tan) dir(T, tan, 4);
      }
      prim.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(P.getBuffer()));
      if (nor) prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nor).setBuffer(N.getBuffer()));
      if (tan) prim.setAttribute("TANGENT", doc.createAccessor().setType("VEC4").setArray(tan).setBuffer(T.getBuffer()));
      prim.setAttribute("JOINTS_0", null); prim.setAttribute("WEIGHTS_0", null);
    }
    // skinned vertices are now in world space: re-home the mesh on an identity root node
    node.setMesh(null); node.setSkin(null);
    scene.addChild(doc.createNode(node.getName() + "_baked").setMesh(mesh));
    baked++;
  }
  for (const s of root.listSkins()) s.dispose();
  return baked;
}

/** Remove UV sets no texture reads (saves bytes and lets primitives join). */
export function dropUnusedUVs(doc) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    const used = new Set([0]);
    if (mat) {
      // walk the material's property graph (core slots + extension slots) for TextureInfo
      const g = doc.getGraph(); const seen = new Set(); const stack = [mat];
      while (stack.length) {
        const p = stack.pop(); if (seen.has(p)) continue; seen.add(p);
        if (p.propertyType === "TextureInfo") used.add(p.getTexCoord());
        for (const c of g.listChildren(p)) if (c.propertyType !== "Texture") stack.push(c);
        if (p.listExtensions) for (const e of p.listExtensions()) stack.push(e);
      }
    }
    for (const sem of prim.listSemantics()) {
      const mm = /^TEXCOORD_(\d+)$/.exec(sem);
      if (mm && !used.has(Number(mm[1]))) prim.setAttribute(sem, null);
    }
    if (!prim.getAttribute("TEXCOORD_0") && prim.getAttribute("TANGENT")) prim.setAttribute("TANGENT", null);
  }
}

/** Pose the rig at time t of the first animation whose name matches `re`
 *  (falls back to the first animation), so bakeSkins captures e.g. an idle
 *  stance instead of the T-pose bind. Step/linear sampling only. */
export function applyAnimationPose(doc, re = /idle|walk|stand/i, t = 0) {
  const anims = doc.getRoot().listAnimations();
  const anim = anims.find((a) => re.test(a.getName())) || anims[0];
  if (!anim) return null;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(); const path = ch.getTargetPath(); const smp = ch.getSampler();
    if (!node || !smp || path === "weights") continue;
    const input = smp.getInput(), output = smp.getOutput();
    const n = input.getCount(); if (!n) continue;
    let k = 0; while (k < n - 1 && input.getScalar(k + 1) <= t) k++;
    let v = output.getElement(Math.min(k, output.getCount() - 1), []);
    if (smp.getInterpolation() === "CUBICSPLINE") v = output.getElement(k * 3 + 1, []);
    if (path === "translation") node.setTranslation(v.slice(0, 3));
    else if (path === "rotation") node.setRotation(v.slice(0, 4));
    else if (path === "scale") node.setScale(v.slice(0, 3));
  }
  return anim.getName();
}
