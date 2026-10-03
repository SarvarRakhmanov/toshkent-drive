import * as THREE from "three";

let loaderPromise: Promise<{ loadAsync: (url: string) => Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> }> | null = null;

function loader() {
  if (!loaderPromise) {
    loaderPromise = Promise.all([
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
    ]).then(([{ GLTFLoader }, { MeshoptDecoder }]) => {
      const gltf = new GLTFLoader();
      gltf.setMeshoptDecoder(MeshoptDecoder);
      return gltf;
    });
  }
  return loaderPromise;
}

const cache = new Map<string, Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null>>();

/** Cached GLB. Resolves null if the file is missing, so callers keep the old mesh. */
export function loadGltf(url: string): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] } | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = loader()
      .then((gltf) => gltf.loadAsync(url))
      .then((doc) => ({ scene: doc.scene, animations: doc.animations }))
      .catch(() => null);
    cache.set(url, pending);
  }
  return pending;
}

export function loadModel(url: string): Promise<THREE.Group | null> {
  return loadGltf(url).then((doc) => doc?.scene ?? null);
}

export function dropJunk(root: THREE.Object3D) {
  const gone: THREE.Object3D[] = [];
  root.traverse((obj) => {
    const light = obj as THREE.Light;
    const cam = obj as THREE.Camera;
    if (light.isLight || cam.isCamera) gone.push(obj);
  });
  for (const obj of gone) obj.removeFromParent();
}

/** Sit the model on y=0 and scale its longest horizontal axis to `length` meters. */
export function placeCar(model: THREE.Object3D, length: number) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 0.01);
  model.scale.multiplyScalar(length / span);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fitted.min.y;
}

export function placeProp(model: THREE.Object3D, height: number) {
  model.updateMatrixWorld(true);
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.computeBoundingBox();
  });
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.y, 0.01);
  model.scale.multiplyScalar(height / h);
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= fitted.min.y;
}
