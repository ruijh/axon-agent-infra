/* ═══════════════════════════════════════════════════════════
   AXON · 跨层拓扑 3D 视图（three.js · 与 3D 机房同栈）
   五层立体分列（服务器 → Infra → 模型/工具 → Agent → 任务）
   芯片节点 / 贝塞尔依赖边 / 发光粒子流 / 影响分析红色辐射
   主题：全部取色走 AXON_CV 运行时调色板，切主题即时换色
   交互：拖拽环绕 · 滚轮缩放 · 悬停聚焦 · 点击节点查看详情
   ═══════════════════════════════════════════════════════════ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { applyEnvironment } from "./env3d.js";

(function () {
  const canvas = $("#topo3d-canvas");
  if (!canvas) return;
  const CV = window.AXON_CV;

  const G = AXON_DATA.buildGraph();
  const nodeById = new Map(G.nodes.map(n => [n.id, n]));
  const edges = G.edges;

  /* ── 渲染器 / 场景 / 相机 ─────────────────────────────── */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    canvas.parentElement.dataset.fallback = "当前环境不支持 WebGL2，请切回 2D 视图";
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const bgHex = () => CV.num("bg1");
  scene.background = new THREE.Color(bgHex());
  /* 环境光照（IBL）：芯片获得顶部高光与反射层次，随主题重建 */
  applyEnvironment(renderer, scene, CV, 0.5);
  /* 雾只作用于远端余量：主体（相机距 ~150）必须保持全对比度，
     否则浅色主题下白色芯片会被雾融进白色背景 */
  scene.fog = new THREE.Fog(bgHex(), 260, 520);

  const camera = new THREE.PerspectiveCamera(48, 2, 0.1, 600);
  camera.position.set(26, 44, 150);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 30;
  controls.maxDistance = 240;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = 1.42;
  controls.autoRotate = !REDUCED;
  controls.autoRotateSpeed = 0.45;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  const hemi = new THREE.HemisphereLight(0xffffff, 0x334155, 1.0);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(40, 80, 60);
  scene.add(key);

  /* MSAA 渲染目标：EffectComposer 绕过原生 antialias，需自带多重采样 */
  const msaaRT = new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, msaaRT);
  composer.addPass(new RenderPass(scene, camera));
  /* 阈值 0.97：高于最亮浅色主题背景的线性亮度（~0.95），
     避免整片背景过 Bloom；粒子材质色 ×2.6 与灯带 emissiveIntensity 1.8+ 稳过阈值发光 */
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 1.0, 0.55, 0.97);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ── 3D 布局：层 = X 列，层内「卡片墙」（X 子车道 × Y 行）──
     与 2D 视图的车道思想一致：密集层拆双列，全部正对相机方向排开，
     避免沿相机视线（Z 轴）堆叠造成的视觉拥挤 */
  const LAYER_GAP = 38;
  const LANE_X = 16, ROW_Y = 10;
  const layoutOf = (n) => n;   /* 节点携带 pos 字段 */
  const cols = [[], [], [], [], []];
  G.nodes.forEach(n => cols[n.layer].push(n));
  cols.forEach((col, ci) => {
    col.sort((a, b) => (a.ref && a.ref.id > b.ref.id ? 1 : -1));
    const lanes = col.length > 6 ? 2 : 1;
    const per = Math.ceil(col.length / lanes);
    col.forEach((n, i) => {
      const lane = Math.floor(i / per), li = i % per;
      n.px = (ci - 2) * LAYER_GAP + (lane - (lanes - 1) / 2) * LANE_X;
      n.py = ((per - 1) / 2 - li) * ROW_Y + 2;
      n.pz = -(ci - 2) * 3;   /* 轻微纵深错落，保留立体层次感 */
    });
  });

  /* ── 文本精灵（2.5× 高分辨率 + 各向异性：消除锯齿与发糊）── */
  function textSprite(lines, opts = {}) {
    const S = 2.5;
    const c = document.createElement("canvas");
    c.width = Math.round(320 * S);
    c.height = Math.round((44 + (lines.length - 1) * 26) * S);
    const g = c.getContext("2d");
    g.textAlign = "center"; g.textBaseline = "middle";
    lines.forEach((ln, i) => {
      g.font = ln.mono
        ? `${Math.round(12 * S)}px Consolas,"Courier New",monospace`
        : `bold ${Math.round(15 * S)}px "Segoe UI","Microsoft YaHei",sans-serif`;
      if (ln.shadow !== false) { g.shadowColor = "rgba(0,0,0,.75)"; g.shadowBlur = Math.round(5 * S); }
      else { g.shadowColor = "transparent"; g.shadowBlur = 0; }
      g.fillStyle = ln.color;
      g.fillText(ln.text, c.width / 2, Math.round((26 + i * 26) * S));
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
    const w = opts.w || 13;
    sp.scale.set(w, w * c.height / c.width, 1);
    return sp;
  }

  /* ── 节点芯片 ─────────────────────────────────────────── */
  const GLYPH3 = {
    server: "▤", runtime: "◈", sandbox: "▣", gateway: "⇄", state: "◫", identity: "◍",
    model: "◇", tool: "⚙", agent: "◉", task: "▸",
  };
  const chips = new Map();       // id → { group, body, strip, label, dot }
  const pickMeshes = [];

  function statusDotColor(n) {
    if (n.type === "server" && n.ref.state === "warn") return CV.hex("warn");
    if (n.type === "task") {
      const st = n.ref.state;
      if (st === "unknown") return CV.hex("crit");
      if (st === "waiting_approval" || st === "queued") return CV.hex("warn");
      if (st === "checkpointed") return CV.hex("accent");
    }
    return null;
  }

  G.nodes.forEach(n => {
    const group = new THREE.Group();
    group.position.set(n.px, n.py, n.pz);
    group.name = "NODE_" + n.id;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(12, 3.4, 0.7),
      new THREE.MeshStandardMaterial({ color: CV.num("node"), roughness: 0.55, metalness: 0.08, transparent: true }),
    );
    body.userData.nodeId = n.id;
    group.add(body);
    pickMeshes.push(body);

    /* 层色描边：浅色主题下芯片与背景同色，靠描边保形（与 2D 视图一致） */
    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(body.geometry),
      new THREE.LineBasicMaterial({ color: LAYER_META[n.layer].color, transparent: true, opacity: 0.9 }),
    );
    group.add(border);

    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(12.05, 0.42, 0.74),
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: new THREE.Color(LAYER_META[n.layer].color),
        emissiveIntensity: 2.2,
        transparent: true,
      }),
    );
    strip.position.y = 1.55;
    group.add(strip);

    const label = textSprite([
      { text: (GLYPH3[n.type] || "◈") + " " + n.label, color: CV.hex("textBright") },
      { text: n.sub || "", color: CV.hex("textDim"), mono: true },
    ]);
    group.add(label);

    const dotCol = statusDotColor(n);
    let dot = null;
    if (dotCol) {
      /* 颜色增益 ×2.2：状态点稳过 Bloom 阈值获得辉光 */
      dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.38, 10, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(dotCol).multiplyScalar(2.2), transparent: true }),
      );
      dot.position.set(5.3, 1.55, 0.5);
      group.add(dot);
    }

    scene.add(group);
    chips.set(n.id, { group, body, border, strip, label, dot, n });
  });

  /* 层标题 */
  const layerTitles = [];
  cols.forEach((col, ci) => {
    if (!col.length) return;
    const sp = textSprite([{ text: `L${ci} · ${LAYER_META[ci].name}`, color: CV.hex("textDim"), mono: true }], { w: 17 });
    sp.position.set((ci - 2) * LAYER_GAP, 52, -(ci - 2) * 3);
    scene.add(sp);
    layerTitles.push({ sp, ci });
  });

  /* 地面参考网格（主题切换时重建） */
  let grid = null;
  function buildGrid() {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(220, 44, CV.num("steel"), CV.num("node"));
    grid.material.transparent = true;
    grid.material.opacity = 0.22;
    grid.position.y = -46;
    scene.add(grid);
  }
  buildGrid();

  /* ── 依赖边（二次贝塞尔 + 虚线推断）──────────────────── */
  const edgeObjs = [];
  const edgeObjOf = new Map();   // edge → 边对象（粒子取曲线用）
  const curveOf = (a, b) => {
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    const h = ((a.x * 7 + b.y * 13 + a.z * 17) % 16) / 16;   /* 稳定抖动，散开交叠 */
    mid.y -= 6 + h * 4;
    mid.z += (h - 0.5) * 18;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  };
  edges.forEach(e => {
    const na = nodeById.get(e.from), nb = nodeById.get(e.to);
    if (!na || !nb) return;
    const curve = curveOf(
      new THREE.Vector3(na.px, na.py, na.pz),
      new THREE.Vector3(nb.px, nb.py, nb.pz),
    );
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(26));
    const mat = e.inferred
      ? new THREE.LineDashedMaterial({ color: CV.num("steel"), transparent: true, opacity: 0.16, dashSize: 1.5, gapSize: 1.3 })
      : new THREE.LineBasicMaterial({ color: CV.num("steel"), transparent: true, opacity: 0.16 });
    const line = new THREE.Line(geo, mat);
    if (e.inferred) line.computeLineDistances();
    scene.add(line);
    const obj = { e, line, mat, curve };
    edgeObjs.push(obj);
    edgeObjOf.set(e, obj);
  });

  /* ── 粒子流（发光小球 · Bloom 辉光）──────────────────── */
  const PART_MAX = 80;
  /* 颜色乘 >1 抬进 Bloom 阈值（线性 HDR 通道），暗色主题呈现辉光 */
  const particleMat = (k = 2.6) => {
    const m = new THREE.MeshBasicMaterial({ color: CV.num("accentSoft"), transparent: true });
    m.color.multiplyScalar(k);
    return m;
  };
  let matFlow = particleMat(), matHot = null, matDim = null;
  function rebuildParticleMats() {
    const flow = particleMat();
    const hot = new THREE.MeshBasicMaterial({ color: CV.num("crit"), transparent: true });
    hot.color.multiplyScalar(2.6);
    const dim = new THREE.MeshBasicMaterial({ color: CV.num("accentSoft"), transparent: true, opacity: 0.25 });
    [matFlow, matHot, matDim].forEach(m => m && m.dispose());
    matFlow = flow; matHot = hot; matDim = dim;
  }
  rebuildParticleMats();
  const particles = [];
  for (let i = 0; i < PART_MAX; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), matFlow);
    m.visible = false;
    scene.add(m);
    particles.push({ mesh: m, t: 1, v: 0, edge: null, hot: false, dim: false });
  }

  /* ── 焦点 / 影响分析状态 ──────────────────────────────── */
  let hoverId = null, selId = null;
  let impact = { on: false, rootId: null, set: null };

  const related = (id) => {
    const s = new Set([id]);
    edges.forEach(e => { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); });
    return s;
  };
  const focusSet = () => impact.set || ((selId || hoverId) ? related(selId || hoverId) : null);

  function updateStates() {
    const focus = focusSet();
    edgeObjs.forEach(({ e, mat }) => {
      const lit = !focus || (focus.has(e.from) && focus.has(e.to));
      const both = impact.set && impact.set.has(e.from) && impact.set.has(e.to);
      const root = impact.set && (e.from === impact.rootId || e.to === impact.rootId);
      if (root) { mat.color.set(CV.hex("crit")); mat.opacity = 0.9; }
      else if (both) { mat.color.set(CV.hex("crit")); mat.opacity = 0.5; }
      else if (lit && focus) { mat.color.set(CV.hex("accentSoft")); mat.opacity = 0.62; }
      else { mat.color.set(CV.hex("steel")); mat.opacity = focus ? 0.04 : 0.16; }
    });
    chips.forEach(({ group, body, border, strip, label, dot, n }) => {
      const isFocus = focus ? focus.has(n.id) : true;
      const a = focus ? (isFocus ? 1 : 0.14) : 1;
      const inImpact = impact.set && impact.set.has(n.id);
      const isRoot = impact.rootId === n.id;
      body.material.opacity = 0.96 * a;
      if (border) border.material.opacity = 0.9 * a;
      strip.material.opacity = a;
      if (label) label.material.opacity = a;
      if (dot) dot.material.opacity = a;
      strip.material.emissiveIntensity = (n.id === selId || n.id === hoverId) ? 2.8 : (inImpact ? 2.4 : 2.2);
      body.material.emissive = body.material.emissive || new THREE.Color();
      if (isRoot) { body.material.emissive.set(CV.hex("crit")); body.material.emissiveIntensity = 0.55; }
      else if (n.id === hoverId || n.id === selId) { body.material.emissive.set(CV.hex("accent")); body.material.emissiveIntensity = 0.35; }
      else { body.material.emissiveIntensity = inImpact ? 0.3 : 0; if (inImpact) body.material.emissive.set(CV.hex("crit")); }
    });
  }
  updateStates();

  /* ── 拾取 ─────────────────────────────────────────────── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;

  function pickAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickMeshes, false);
    return hits.length ? hits[0].object.userData.nodeId : null;
  }
  canvas.addEventListener("pointermove", (e) => {
    if (!active() || downAt) return;
    const id = pickAt(e.clientX, e.clientY);
    if (id !== hoverId) { hoverId = id; updateStates(); }
    canvas.style.cursor = id ? "pointer" : "grab";
  });
  canvas.addEventListener("pointerleave", () => { hoverId = null; updateStates(); });
  canvas.addEventListener("pointerdown", (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    canvas.classList.add("dragging");
  });
  window.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 5 || !active()) return;
    const id = pickAt(e.clientX, e.clientY);
    if (!id) return;
    selId = id;
    if (impact.on) AXON.impact.setImpactMode(true, id);   /* 影响分析模式：点击即定根 */
    else if (AXON.graph) AXON.graph.select(id);           /* 常规：右侧详情面板 */
    updateStates();
  });

  /* 2D 侧发起的影响分析同步到 3D（graph.js emit） */
  AXON.on("topo-impact", (st) => { impact = st || { on: false, rootId: null, set: null }; updateStates(); });

  /* ── 主题联动：全部取色重建（含环境贴图）─────────────── */
  function applyPalette() {
    scene.background.set(bgHex());
    scene.fog.color.set(bgHex());
    hemi.groundColor.set(bgHex());
    applyEnvironment(renderer, scene, CV, 0.5);
    chips.forEach((rec, id) => {
      const { body, n, group } = rec;
      body.material.color.set(CV.num("node"));
      const lb = textSprite([
        { text: (GLYPH3[n.type] || "◈") + " " + n.label, color: CV.hex("textBright") },
        { text: n.sub || "", color: CV.hex("textDim"), mono: true },
      ]);
      group.remove(rec.label);
      rec.label.material.map.dispose();
      rec.label.material.dispose();
      group.add(lb);
      rec.label = lb;
      const dotCol = statusDotColor(n);
      if (rec.dot) {
        if (dotCol) rec.dot.material.color.set(new THREE.Color(dotCol).multiplyScalar(2.2));
        else { group.remove(rec.dot); rec.dot = null; }
      } else if (dotCol) {
        const d2 = new THREE.Mesh(new THREE.SphereGeometry(0.38, 10, 10),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(dotCol).multiplyScalar(2.2), transparent: true }));
        d2.position.set(5.3, 1.55, 0.5);
        group.add(d2);
        rec.dot = d2;
      }
    });
    /* 层色（LAYER_META 已由 themes.js 按主题同步） */
    chips.forEach(({ strip, border, n }) => {
      strip.material.emissive.set(LAYER_META[n.layer].color);
      if (border) border.material.color.set(LAYER_META[n.layer].color);
    });
    for (let i = 0; i < layerTitles.length; i++) {
      const { sp, ci } = layerTitles[i];
      const t = textSprite([{ text: `L${ci} · ${LAYER_META[ci].name}`, color: CV.hex("textDim"), mono: true }], { w: 17 });
      t.position.copy(sp.position);
      scene.remove(sp);
      sp.material.map.dispose();
      sp.material.dispose();
      scene.add(t);
      layerTitles[i] = { sp: t, ci };
    }
    buildGrid();
    rebuildParticleMats();
    updateStates();
  }
  AXON.on("theme", applyPalette);

  /* ── 渲染循环 ─────────────────────────────────────────── */
  const active = () => AXON.view === "topo" && AXON.topoMode !== "2d" && !document.hidden;
  let W = 0;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    W = r.width;
    renderer.setSize(Math.round(r.width), Math.round(r.height), false);
    composer.setSize(Math.round(r.width), Math.round(r.height));
    bloom.setSize(Math.round(r.width), Math.round(r.height));
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
  }

  const t0 = performance.now();
  let lastDraw = 0;
  function spawnParticles() {
    const focus = focusSet();
    const free = particles.filter(p => p.t >= 1);
    edges.forEach(e => {
      const eo = edgeObjOf.get(e);
      if (!eo) return;
      const lit = !focus || (focus.has(e.from) && focus.has(e.to));
      if (Math.random() < (lit ? 0.10 : 0.02) && free.length) {
        const p = free.pop();
        p.edge = eo;
        p.t = 0; p.v = rnd(0.007, 0.014);
        p.hot = !!impact.set && lit;
        p.dim = !lit;
        p.mesh.material = p.hot ? matHot : (p.dim ? matDim : matFlow);
        p.mesh.visible = true;
      }
    });
  }
  function frame() {
    if (!W) resize();
    controls.update();
    /* 芯片朝向相机（柱面 billboard） */
    chips.forEach(({ group }) => {
      group.rotation.y = Math.atan2(camera.position.x - group.position.x, camera.position.z - group.position.z);
    });
    /* 粒子推进 */
    spawnParticles();
    particles.forEach(p => {
      if (p.t >= 1) { p.mesh.visible = false; return; }
      p.t += p.v;
      const pt = p.edge.curve.getPoint(Math.max(0, Math.min(1, p.t)));
      p.mesh.position.copy(pt);
    });
    composer.render();
    lastDraw = performance.now();
  }
  function loop() {
    requestAnimationFrame(loop);
    if (!active()) return;
    frame();
  }
  /* 页签隐藏时 rAF/ResizeObserver 都可能错过尺寸变化：心跳兜底补 resize + 出帧 */
  setInterval(() => {
    if (!active()) return;
    if (!W) resize();
    if (performance.now() - lastDraw > 400) frame();
  }, 250);

  AXON.on("topo-mode", (m) => { if (m !== "2d") { resize(); } });
  AXON.on("view", (v) => { if (v === "topo") requestAnimationFrame(() => resize()); });
  new ResizeObserver(() => { if (active()) resize(); }).observe(canvas.parentElement);
  resize();
  requestAnimationFrame(loop);

  /* 调试/测试钩子 */
  AXON.topo3d = { state: () => ({ hoverId, selId, impactOn: impact.on, ready: true }) };
  window.__topo3d_api = { scene, camera, renderer, controls, composer, chips, edgeObjs, resize, info: () => renderer.info.render };
})();
