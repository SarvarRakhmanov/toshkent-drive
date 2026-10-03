import * as THREE from "three";

// A tiny procedural sky used only as an IBL source (PMREMGenerator) so
// MeshStandardMaterial's chrome/glass/water surfaces (car mirrors, the
// windshield, the sea) pick up real specular sky reflections during sunny
// weather — three.js reflects scene.environment automatically on any
// metalness>0 material, no per-material wiring needed once this is set.
// Baked once and cached; PMREMGenerator is a real render pass so this must
// run lazily (needs a renderer) rather than at module load.
let cached: THREE.Texture | null = null;

export function getSunnyEnvMap(gl: THREE.WebGLRenderer): THREE.Texture {
  if (cached) return cached;
  const pmrem = new THREE.PMREMGenerator(gl);
  pmrem.compileEquirectangularShader();

  const scene = new THREE.Scene();
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x3f8ff2) },
      bottom: { value: new THREE.Color(0xfff2d6) },
    },
    vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 top;
      uniform vec3 bottom;
      void main() {
        float h = clamp(normalize(vPos).y * 0.6 + 0.4, 0.0, 1.0);
        gl_FragColor = vec4(mix(bottom, top, h), 1.0);
      }
    `,
    side: THREE.BackSide,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), skyMat));

  // a bright spot standing in for the sun itself, so metal/glass gets a
  // real specular hotspot instead of just an even sky tint
  const sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  sun.position.set(24, 30, 12);
  scene.add(sun);

  const rt = pmrem.fromScene(scene, 0.03);
  cached = rt.texture;
  skyMat.dispose();
  pmrem.dispose();
  return cached;
}
