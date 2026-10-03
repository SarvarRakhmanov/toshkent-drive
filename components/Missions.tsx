"use client";

import { useEffect } from "react";
import * as THREE from "three";
import { useFrame } from "@/lib/safeFrame";
import { stepMissions, useMissions, missionColor } from "@/lib/missions";
import { useCareer } from "@/lib/career";
import { groundYAt } from "@/lib/marina";

// v1.9: drives lib/missions.ts every frame and draws the current target as a
// tall additive light beam + ground ring (1 draw call: both are one merged
// geometry; hidden when no job is running).

const beamGeo = (() => {
  const beam = new THREE.CylinderGeometry(2.2, 2.6, 70, 16, 1, true).translate(0, 35, 0);
  const ring = new THREE.RingGeometry(5.2, 6.4, 32).rotateX(-Math.PI / 2).translate(0, 0.12, 0);
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const src of [beam, ring]) {
    const s = src.index ? src.toNonIndexed() : src;
    pos.push(...(s.getAttribute("position").array as Float32Array));
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
})();
const beamMat = new THREE.MeshBasicMaterial({ color: "#ffd21f", transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
const beam = new THREE.Mesh(beamGeo, beamMat);
beam.name = "mission-beacon";
beam.visible = false;
beam.frustumCulled = false;
beam.renderOrder = 5;

export function Missions() {
  useEffect(() => {
    useCareer.getState().load();
  }, []);
  useFrame((state, dt) => {
    stepMissions(Math.min(dt, 0.1));
    const m = useMissions.getState().m;
    if (!m) {
      beam.visible = false;
      return;
    }
    const t = m.targets[m.stage];
    beam.visible = true;
    beam.position.set(t.x, groundYAt(t.x, t.z), t.z);
    beamMat.color.set(missionColor(m.kind));
    beamMat.opacity = 0.26 + 0.08 * Math.sin(state.clock.elapsedTime * 4);
  });
  return <primitive object={beam} />;
}
