"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Buildings } from "@/components/Buildings";
import { Crowd, SPAWNS } from "@/components/Crowd";

// Framed on the first walker (street-level distance), not a bird's-eye view
// of the whole 500-building grid — a 1.8-unit person is an invisible speck
// from 60 units up. Drag/scroll (OrbitControls) to look around the rest.
const FOCUS = SPAWNS[0];

export default function CrowdScene() {
  return (
    <Canvas
      camera={{ position: [FOCUS.x + 4, 2.5, FOCUS.z + 6], fov: 50, far: 2000 }}
      style={{ position: "fixed", inset: 0 }}
    >
      <color attach="background" args={["#0a0e18"]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[80, 120, 40]} intensity={1} />
      <Buildings />
      <Crowd />
      <OrbitControls makeDefault target={[FOCUS.x, 1, FOCUS.z]} />
    </Canvas>
  );
}
