/* ═══════════════════════════════════════════════════════════
   AXON · 3D 环境光照（IBL）共享模块
   PMREMGenerator + 程序化"灯箱"场景：顶部白天光板 + 两侧主题色
   补光板 + 地面弱反弹板 → scene.environment。
   替代无环境贴图的扁平 PBR（塑料感根因），且可随主题重建换色。
   零新增 vendor 依赖：PMREMGenerator 为 three 核心 API。
   ═══════════════════════════════════════════════════════════ */
import * as THREE from "three";

/**
 * buildEnvTexture(renderer, opts) → PMREM 环境贴图
 * opts: { top?:number 天光强度, sideA/sideB?:number 侧板颜色(num),
 *         sideI?:number 侧板强度, ground?:number 地反弹强度 }
 */
export function buildEnvTexture(renderer, opts = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
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
  panel(0xffffff, opts.top ?? 3.5, 14, 14, 0, 9, 0, Math.PI / 2, 0);                       // 天光
  panel(opts.sideA ?? 0xffffff, opts.sideI ?? 1.5, 10, 7, -10, 3.5, 0, 0, Math.PI / 2);    // 左侧主题色补光
  panel(opts.sideB ?? 0xffffff, (opts.sideI ?? 1.5) * 0.8, 10, 7, 10, 3.5, 0, 0, -Math.PI / 2); // 右侧补光（稍弱）
  panel(0xffffff, opts.ground ?? 0.7, 16, 16, 0, -6, 0, -Math.PI / 2, 0);                  // 地面反弹
  const rt = pmrem.fromScene(scene, 0.08);
  pmrem.dispose();
  scene.traverse(o => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
  return rt.texture;
}

/** 主题化环境：按调色板重建 scene.environment（旧贴图安全释放） */
export function applyEnvironment(renderer, scene, cv, intensity = 0.6) {
  const tex = buildEnvTexture(renderer, {
    sideA: cv.num("steel"),
    sideB: cv.num("accent"),
    sideI: 1.4,
  });
  if (scene.environment && scene.environment.dispose) scene.environment.dispose();
  scene.environment = tex;
  if ("environmentIntensity" in scene) scene.environmentIntensity = intensity;
  return tex;
}
