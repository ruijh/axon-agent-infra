/* Neutral studio IBL. Retain the RenderTarget so disposal frees its buffers. */
import * as THREE from "three";
const environments = new WeakMap();

/** The caller owns the returned WebGLRenderTarget. */
export function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x353a40);
  const panel = (colorNum, intensity, w, h, x, y, z, rx, ry) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colorNum).multiplyScalar(intensity),
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  panel(0xffffff, 2.8, 12, 5, 0, 7, 0, Math.PI / 2, 0);
  panel(0xffffff, 1.8, 5, 8, -7, 3, 1, 0, Math.PI / 2);
  panel(0xffffff, 1.1, 7, 4, 7, 3, -2, 0, -Math.PI / 2);
  panel(0xffffff, 0.35, 12, 12, 0, -5, 0, -Math.PI / 2, 0);
  try { return pmrem.fromScene(scene, 0.04); }
  finally {
    pmrem.dispose();
    scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  }
}

/** UI themes never change physical lighting or allocate another IBL. */
export function applyEnvironment(renderer, scene, _palette, intensity = 0.7) {
  let target = environments.get(scene);
  if (!target) { target = buildEnvironment(renderer); environments.set(scene, target); }
  scene.environment = target.texture;
  scene.environmentIntensity = intensity;
  return target.texture;
}

export function disposeEnvironment(scene) {
  const target = environments.get(scene);
  if (!target) return;
  if (scene.environment === target.texture) scene.environment = null;
  target.dispose();
  environments.delete(scene);
}
