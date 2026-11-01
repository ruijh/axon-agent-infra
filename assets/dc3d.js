/* ═══════════════════════════════════════════════════════════
   AXON · 数据中心 3D 视图（服务器管理 · 子页）
   管线：Blender 无头建模（tools/build_dc_model.py）
         → glTF（assets/models/dc-a2.glb）
         → three.js WebGL 实时渲染（本文件）
   特性：PBR 材质 / 阴影 / Bloom / U 位设备状态映射 / 拾取交互
   交互：拖拽环绕 · 滚轮缩放 · 点击机柜或设备查看详情
   ═══════════════════════════════════════════════════════════ */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

(function () {
  const canvas = $("#dc3d-canvas");
  if (!canvas) return;

  const D = AXON_DATA;
  const F = D.dcFloor;

  /* 设备种类 → 运行时发光色（面板 + LED）· 随主题调色板 */
  const CV = window.AXON_CV;
  const kindGlow = () => ({ server: CV.num("l0"), net: CV.num("l2"), bmc: CV.num("violet"), warn: CV.num("warn") });

  /* 机柜实体：dcFloor 布局 + racks 纳管状态（与旧版数据口径一致） */
  function rackStats(rid) {
    const members = [
      ...D.servers.map(s => ({ kind: "server", ref: s })),
      ...D.netDevices.map(n => ({ kind: n.kind === "bmc" ? "bmc" : "net", ref: n })),
    ];
    const devs = members.filter(m => m.ref.location.rack === rid);
    return {
      devs,
      usedU: devs.reduce((a, m) => a + (m.ref.location.u[1] - m.ref.location.u[0] + 1), 0),
      hasWarn: devs.some(m => m.ref.state === "warn"),
    };
  }
  const racks = [];
  F.rows.forEach(row => {
    row.racks.forEach((rid, i) => {
      const managed = D.racks.some(r => r.id === rid);
      racks.push({
        id: rid, managed,
        x: F.rackX(i), y: F.rowY[row.id],
        devList: managed ? rackStats(rid).devs : [],
        hasWarn: managed ? rackStats(rid).hasWarn : false,
      });
    });
  });

  const hud = $("#dc3d-hud");

  /* ── 渲染器 / 场景 ───────────────────────────────────── */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    hud.innerHTML = `<div class="h-title">3D 视图不可用</div><div class="h-kv">当前环境不支持 WebGL2</div>`;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const scene = new THREE.Scene();
  const sceneColor = () => CV.num("dcBg");
  scene.background = new THREE.Color(sceneColor());
  scene.fog = new THREE.Fog(sceneColor(), 24, 50);

  const camera = new THREE.PerspectiveCamera(46, 2, 0.1, 120);
  camera.position.set(9.5, 8.2, -12.8);   /* 从 -z 侧看：A 排（纳管 R01-R06）前门正对镜头 */

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 3.5;
  controls.maxDistance = 30;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.42;
  controls.autoRotate = !REDUCED;
  controls.autoRotateSpeed = 0.65;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  /* 灯光：半球环境 + 主光（带阴影）+ 主题色轮廓光 + 冷通道点光 */
  const hemi = new THREE.HemisphereLight(0x9fc3ff, 0x0a1226, 0.8);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xdfeaff, 2.6);
  key.position.set(10, 16, -9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -15; key.shadow.camera.right = 15;
  key.shadow.camera.top = 15; key.shadow.camera.bottom = -15;
  key.shadow.camera.near = 1; key.shadow.camera.far = 50;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(CV.num("accent"), 1.2);
  rim.position.set(-14, 7, 9);
  scene.add(rim);
  const ptLights = [];
  for (const px of [-4.5, 4.5]) {
    const p = new THREE.PointLight(CV.num("accentSoft"), 36, 10, 2);
    p.position.set(px, 2.7, 0);
    scene.add(p);
    ptLights.push(p);
  }

  /* 后期：Bloom（LED / 灯带辉光）+ 输出色调映射 */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.55, 0.55, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ── 模型加载与数据映射 ─────────────────────────────── */
  const rackGroups = new Map();      // rid → Object3D（RACK_* 空物体）
  const pickables = [];              // 可拾取网格（机柜全部件）
  const devMeshes = new Map();       // 设备id → { body:[], led:[] }
  const rackBodyMats = new Map();    // rid → [{ mat }]（悬停高亮用）
  const devGlow = [];                // [{ mats, warn, color }]
  let ready = false;

  const selRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.86, 0.012, 10, 56),
    new THREE.MeshBasicMaterial({ color: CV.num("accent"), transparent: true, opacity: 0.9 }),
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.visible = false;
  scene.add(selRing);

  function labelSprite(text, color, alpha) {
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.font = "bold 30px Consolas,'Courier New',monospace";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,.85)"; g.shadowBlur = 6;
    g.fillStyle = color;
    g.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: alpha, depthWrite: false,
    }));
    sp.scale.set(1.05, 0.26, 1);
    return sp;
  }

  function onModel(root) {
    /* 轴向说明：Blender Z-up → glTF/three Y-up（three.z = -blender.y） */
    root.traverse(o => {
      if (!o.isMesh) return;
      const n = o.name;
      if (n.startsWith("DOOR_") || n.startsWith("LED_") || n.startsWith("ENV_Contain") || n.startsWith("ENV_Strip") || n.startsWith("ENV_ColdFloor") || n.startsWith("CRAC_")) {
        o.castShadow = false;                       // 玻璃/发光件不投影，避免遮挡
      } else {
        o.castShadow = true;
      }
      o.receiveShadow = true;
    });

    /* 机柜分组：RACK_<rid> 空物体 */
    root.traverse(o => {
      const m = /^RACK_(.+)$/.exec(o.name);
      if (m) rackGroups.set(m[1], o);
    });

    racks.forEach(rk => {
      const g = rackGroups.get(rk.id);
      if (!g) return;
      g.updateWorldMatrix(true, false);
      const wp = new THREE.Vector3();
      g.getWorldPosition(wp);

      /* 每柜克隆材质（悬停高亮互不影响）+ 收集拾取件 */
      const bodyMats = [];
      g.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        if (o.name.startsWith("BODY_")) {
          o.material.emissive = new THREE.Color(CV.num("accent"));
          o.material.emissiveIntensity = 0;
          bodyMats.push({ mat: o.material });
        }
        pickables.push(o);
      });
      rackBodyMats.set(rk.id, bodyMats);

      /* 机柜号标签（主题切换时按调色板重建） */
      const lb = labelSprite(rk.id, CV.hex("textBright"), rk.managed ? 0.95 : 0.5);
      lb.position.copy(wp).add(new THREE.Vector3(0, 2.42, 0));
      scene.add(lb);
      rackLabels.push({ sp: lb, id: rk.id, managed: rk.managed });

      /* 预警机柜：顶部琥珀脉冲点 */
      if (rk.hasWarn) {
        const c = document.createElement("canvas");
        c.width = c.height = 64;
        const g2 = c.getContext("2d");
        const grad = g2.createRadialGradient(32, 32, 2, 32, 32, 30);
        grad.addColorStop(0, "rgba(255,196,90,1)");
        grad.addColorStop(0.4, "rgba(255,160,50,.55)");
        grad.addColorStop(1, "rgba(255,160,50,0)");
        g2.fillStyle = grad; g2.fillRect(0, 0, 64, 64);
        const tex = new THREE.CanvasTexture(c);
        const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
        dot.scale.set(0.5, 0.5, 1);
        dot.position.copy(wp).add(new THREE.Vector3(0, 2.14, 0));
        dot.userData.pulse = true;
        scene.add(dot);
        warnDots.push(dot);
      }
    });

    /* 设备发光映射：DEV_<id> 面板 / LED_<id> 灯条 → 运行时状态色 */
    devByIdLive.clear();
    [...D.servers.map(s => ({ id: s.id, kind: "server", state: s.state })),
     ...D.netDevices.map(n => ({ id: n.id, kind: n.kind === "bmc" ? "bmc" : "net", state: n.state }))]
      .forEach(dv => devByIdLive.set(dv.id, dv));
    devMeshes.clear();
    root.traverse(o => {
      if (!o.isMesh) return;
      let m = /^(DEV_.+?)_bez$/.exec(o.name);
      const isBez = !!m;
      if (!m) m = /^(DEV_.+)$/.exec(o.name);
      if (m) {
        const id = m[1].slice(4);
        const rec = devMeshes.get(id) || { body: [], led: [] };
        rec.body.push(o);
        devMeshes.set(id, rec);
        o.userData.devId = id;
        return;
      }
      m = /^LED_(.+)$/.exec(o.name);
      if (m) {
        const id = m[1];
        const rec = devMeshes.get(id) || { body: [], led: [] };
        rec.led.push(o);
        devMeshes.set(id, rec);
        o.userData.devId = id;
      }
    });
    scene.add(root);
    ready = true;
    applyDevGlow();
    renderHud();
  }

  /* 设备发光按当前主题上色（模型加载后 / 主题切换后调用） */
  function applyDevGlow() {
    const G = kindGlow();
    devMeshes.forEach((rec, id) => {
      const dv = devByIdLive.get(id);
      if (!dv) return;
      const warn = dv.state === "warn";
      const color = warn ? G.warn : G[dv.kind];
      const mats = [];
      rec.body.forEach(o => {
        if (!o.material.emissive) return;
        o.material.emissive.set(color);
        o.material.emissiveIntensity = warn ? 0.5 : 0.55;
        mats.push({ mat: o.material, base: warn ? 0.5 : 0.55 });
      });
      rec.led.forEach(o => {
        o.material.emissive.set(warn ? CV.num("warn") : CV.num("accentSoft"));
        o.material.emissiveIntensity = warn ? 2.2 : 3.2;
        mats.push({ mat: o.material, base: warn ? 2.2 : 3.2 });
      });
      if (warn && !devGlow.some(g => g.mats === mats)) devGlow.push({ mats, warn: true });
    });
  }

  const warnDots = [];
  const rackLabels = [];
  const devByIdLive = new Map();
  const loader = new GLTFLoader();
  loader.load(
    "assets/models/dc-a2.glb",
    (gltf) => {
      try {
        onModel(gltf.scene);
      } catch (e) {
        console.error("[dc3d] 模型处理失败", e);
        hud.innerHTML = `<div class="h-title">模型处理失败</div>
          <div class="h-kv" style="white-space:pre-wrap">${esc(String(e && e.message || e))}</div>`;
      }
    },
    undefined,
    () => {
      hud.innerHTML = `<div class="h-title">模型加载失败</div>
        <div class="h-kv">assets/models/dc-a2.glb 不可达</div>
        <div class="h-kv" style="margin-top:4px">重建：node tools/export-layout.mjs &amp;&amp; blender --background --python tools/build_dc_model.py</div>`;
    },
  );

  /* ── HUD / 图例（数据口径与设备清单一致）────────────── */
  function renderHud() {
    if (!hud) return;
    if (!ready) {
      hud.innerHTML = `<div class="h-title">A2 机房</div><div class="h-kv">正在加载 Blender 模型…</div>`;
      return;
    }
    const total = racks.length;
    const managed = racks.filter(r => r.managed).length;
    const rk = racks.find(r => r.id === selId);
    if (!rk) {
      hud.innerHTML = `<div class="h-title">A2 机房 · 概览</div>
        <div class="h-kv">机柜 ${total} · 纳管 ${managed} · 服务器 ${D.servers.length} · 网络设备 ${D.netDevices.length}</div>
        <div class="h-kv">冷通道封闭 · 精密空调 ×4 · 双路供电</div>
        <div style="margin-top:6px">点击任一机柜查看承载详情 · Blender 建模 · WebGL 实时渲染</div>`;
      return;
    }
    if (!rk.managed) {
      hud.innerHTML = `<div class="h-title">机柜 ${esc(rk.id)}</div>
        <div class="h-kv">状态：未纳管</div>
        <div style="margin-top:6px">该机柜不在当前管理范围（纳管 ${D.racks.map(r => r.id).join(" / ")}）</div>`;
      return;
    }
    const meta = D.racks.find(r => r.id === rk.id);
    const st = rackStats(rk.id);
    hud.innerHTML = `<div class="h-title">${esc(meta.name)} · ${esc(meta.note)}</div>
      <div class="h-kv">位置：A2 机房 · 03 列 ${rk.id}（U 位见「机柜部署」）</div>
      <div class="h-kv">已用 ${st.usedU}U / 42U · ${st.devs.length} 台设备${st.hasWarn ? ' · <span style="color:var(--warn)">存在硬件预警</span>' : ""}</div>
      <div style="margin:6px 0 2px">${st.devs.map(m =>
        `<span class="dep-chip" data-3d-dev="${m.ref.id}" data-kind="${m.kind}">${esc(m.ref.name.replace(" · ", " "))}</span>`).join("")}</div>
      <button class="btn tiny" id="dc3d-open-rack">查看机柜 U 位</button>`;
    $$("#dc3d-hud [data-3d-dev]").forEach(ch => ch.addEventListener("click", () => openDev(ch.dataset["3dDev"], ch.dataset.kind)));
    $("#dc3d-open-rack").onclick = () => { AXON.serversTab = "rack"; renderServersTab(); };
  }

  function openDev(id, kind) {
    if (kind === "server") AXON.emit("server-detail", id);
    else {
      const n = D.find(id);
      AXON.toast(n.name, `${esc(n.model)} · ${esc(n.role)} · 管理口 ${esc(n.mgmt)}`, "info", 3800);
    }
  }

  $("#dc3d-legend").innerHTML =
    `<span><i style="border-color:var(--l-infra)"></i>已纳管机柜</span>` +
    `<span><i style="border-color:var(--dc-rack-off)"></i>未纳管</span>` +
    `<span style="color:var(--orange)">● 硬件预警</span>` +
    `<span><i style="border-color:var(--l-server)"></i>服务器</span>` +
    `<span><i style="border-color:var(--l-catalog)"></i>网络设备</span>` +
    `<span><i style="border-color:var(--violet)"></i>带外</span>` +
    `<span>Blender 建模 · glTF 实时渲染</span>`;

  /* ── 拾取与交互 ──────────────────────────────────────── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let selId = null, hoverId = null, hoverDev = null;
  let downPos = null;

  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    /* 前门玻璃会先命中：向后再找 0.2m 内的设备面，命中则视为点设备 */
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      if (h.object.userData.devId) return { devId: h.object.userData.devId, rackId: rackOfMesh(h.object) };
      if (h.object.name.startsWith("DOOR_")) {
        for (let j = i + 1; j < hits.length && hits[j].distance - h.distance < 0.2; j++) {
          if (hits[j].object.userData.devId) return { devId: hits[j].object.userData.devId, rackId: rackOfMesh(hits[j].object) };
        }
        return { devId: null, rackId: rackOfMesh(h.object) };
      }
      const rid = rackOfMesh(h.object);
      if (rid) return { devId: null, rackId: rid };
    }
    return null;
  }
  function rackOfMesh(o) {
    let p = o;
    while (p) {
      const m = /^RACK_(.+)$/.exec(p.name || "");
      if (m) return m[1];
      p = p.parent;
    }
    return null;
  }

  function setHover(h) {
    if (hoverId && hoverId !== (h && h.rackId)) {
      (rackBodyMats.get(hoverId) || []).forEach(({ mat }) => (mat.emissiveIntensity = 0));
    }
    hoverId = h ? h.rackId : null;
    hoverDev = h ? h.devId : null;
    if (hoverId) {
      (rackBodyMats.get(hoverId) || []).forEach(({ mat }) => (mat.emissiveIntensity = 0.22));
    }
    canvas.style.cursor = h ? "pointer" : "grab";
  }

  canvas.addEventListener("pointerdown", (e) => {
    downPos = { x: e.clientX, y: e.clientY };
    canvas.classList.add("dragging");
  });
  window.addEventListener("pointerup", (e) => {
    canvas.classList.remove("dragging");
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
    downPos = null;
    if (moved > 5 || !active() || !ready) return;
    const hit = pick(e.clientX, e.clientY);
    if (hit && hit.devId) { openDev(hit.devId, devKind(hit.devId)); return; }
    selId = hit ? hit.rackId : null;
    renderHud();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!active() || !ready || downPos) return;
    setHover(pick(e.clientX, e.clientY));
  });
  canvas.addEventListener("pointerleave", () => setHover(null));

  function devKind(id) {
    if (D.servers.some(s => s.id === id)) return "server";
    const n = D.netDevices.find(x => x.id === id);
    return n && n.kind === "bmc" ? "bmc" : "net";
  }

  /* ── 渲染循环（仅本页签可见时渲染）──────────────────── */
  const active = () => AXON.view === "servers" && AXON.serversTab === "3d" && !document.hidden;

  let W = 0;
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const w = Math.round(r.width), h = Math.round(r.height);
    W = w;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const t0 = performance.now();
  let lastDraw = 0;
  function frame() {
    if (!active()) return;
    if (!W) resize();
    controls.update();
    const t = (performance.now() - t0) / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4);
    /* 预警设备发光脉冲 */
    devGlow.forEach(({ mats }) => mats.forEach(({ mat, base }) => {
      mat.emissiveIntensity = base * (0.45 + 0.75 * pulse);
    }));
    warnDots.forEach(d => { d.material.opacity = 0.45 + 0.55 * pulse; });
    /* 选中环 */
    if (selId && rackGroups.has(selId)) {
      const g = rackGroups.get(selId);
      const wp = new THREE.Vector3();
      g.getWorldPosition(wp);
      selRing.position.set(wp.x, 0.02, wp.z);
      selRing.visible = true;
      selRing.material.opacity = 0.5 + 0.4 * pulse;
      const s = 1 + 0.03 * Math.sin(t * 3);
      selRing.scale.set(s, s, 1);
    } else {
      selRing.visible = false;
    }
    composer.render();
    lastDraw = performance.now();
  }
  function loop() {
    requestAnimationFrame(loop);
    frame();
  }
  /* 页签被遮挡时 rAF 会停摆：低频心跳兜底出帧（预览/截图/投屏场景） */
  setInterval(() => {
    if (active() && performance.now() - lastDraw > 400) frame();
  }, 250);

  AXON.on("servers-tab-3d", () => {
    setHover(null);
    resize();
    renderHud();
    requestAnimationFrame(() => { resize(); });
    setTimeout(resize, 120);
  });
  new ResizeObserver(() => { if (active()) resize(); }).observe(canvas.parentElement);
  resize();
  renderHud();
  requestAnimationFrame(loop);

  /* ── 主题切换：底色 / 雾 / 灯光 / 发光色 / 标签随调色板刷新 ── */
  function applyPalette() {
    const bg = sceneColor();
    scene.background.set(bg);
    scene.fog.color.set(bg);
    hemi.color.set(CV.num("steel"));
    hemi.groundColor.set(bg);
    rim.color.set(CV.num("accent"));
    ptLights.forEach(p => p.color.set(CV.num("accentSoft")));
    selRing.material.color.set(CV.num("accent"));
    if (ready) {
      applyDevGlow();
      for (let i = 0; i < rackLabels.length; i++) {
        const { sp, id, managed } = rackLabels[i];
        const lb = labelSprite(id, CV.hex("textBright"), managed ? 0.95 : 0.5);
        lb.position.copy(sp.position);
        scene.remove(sp);
        sp.material.map.dispose();
        sp.material.dispose();
        scene.add(lb);
        rackLabels[i] = { sp: lb, id, managed };
      }
    }
  }
  AXON.on("theme", applyPalette);

  AXON.dc3d = { renderHud, state: () => ({ selId, hoverId, auto: controls.autoRotate, ready }) };
  window.__dc3d = AXON.dc3d;   /* 调试/测试钩子 */
  window.__dc3d_api = {        /* 调参入口：曝光 / 灯强 / 渲染统计 */
    scene, camera, renderer, controls, composer,
    lights: { hemi, key, rim, ptLights },
    setExposure: (v) => { renderer.toneMappingExposure = v; },
    info: () => renderer.info.render,
  };
})();
