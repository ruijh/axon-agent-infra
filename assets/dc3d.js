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
import { applyEnvironment, disposeEnvironment } from "./env3d.js";
import { showDetail, rackView, visibleInTree, pickHit } from "./dc3d-policy.js";
import { installBenchmark } from "./scene-benchmark.js";

(function () {
  const canvas = $("#dc3d-canvas");
  if (!canvas) return;

  const D = AXON_DATA;
  const F = D.dcFloor;

  /* 设备状态色只用于 LED；物理表面保持中性 */
  const CV = window.AXON_CV;
  const kindGlow = () => ({ server: 0x78cba1, net: 0x70b5dc, bmc: 0x70b5dc, warn: 0xeab558 });

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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  } catch (e) {
    hud.innerHTML = `<div class="h-title">3D 视图不可用</div><div class="h-kv">当前环境不支持 WebGL2</div>`;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const sceneColor = () => 0x626b72;
  scene.background = new THREE.Color(sceneColor());
  scene.fog = new THREE.Fog(sceneColor(), 36, 70);
  /* 中性环境光照（IBL），主题切换复用同一 RenderTarget */
  applyEnvironment(renderer, scene, CV, 0.85);

  const camera = new THREE.PerspectiveCamera(46, 2, 0.1, 120);
  camera.position.set(9.5, 8.2, -12.8);   /* 从 -z 侧看：A 排（纳管 R01-R06）前门正对镜头 */

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.minDistance = 1;
  controls.maxDistance = 30;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.42;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.65;
  controls.addEventListener("start", () => { controls.autoRotate = false; });

  /* 中性照明：半球补光 + 主阴影光 + 柔和轮廓光 + 通道灯具 */
  const hemi = new THREE.HemisphereLight(0xe5e9ed, 0x68645f, 0.45);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
  key.position.set(-3, 10, -5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -14; key.shadow.camera.right = 14;
  key.shadow.camera.top = 10; key.shadow.camera.bottom = -10;
  key.shadow.camera.near = 1; key.shadow.camera.far = 50;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xe3edfa, 0.9);
  rim.position.set(5, 4, 7);
  scene.add(rim);
  const ptLights = [];
  for (const px of [-1.5, 1.5]) {
    const p = new THREE.PointLight(0xfff6eb, 3, 5, 2);
    p.position.set(px, 2.65, 1.2);
    scene.add(p);
    ptLights.push(p);
  }

  /* 后期：MSAA 渲染目标（EffectComposer 会绕过 renderer 原生 antialias，
     必须自带多重采样）+ Bloom + 色调映射。
     阈值保持高于最亮浅色主题背景的线性亮度（~0.85），避免背景整体发光；
     LED/灯带的 emissiveIntensity 顶到阈值之上获得真实辉光 */
  const msaaRT = new THREE.WebGLRenderTarget(2, 2, { samples: 4, type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, msaaRT);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.12, 0.2, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ── 模型加载与数据映射 ─────────────────────────────── */
  const rackGroups = new Map();      // rid → Object3D（RACK_* 空物体）
  const pickables = [];              // 可拾取网格（机柜全部件）
  const devMeshes = new Map();       // 设备id → { body:[], led:[] }
  const rackBodyMats = new Map();    // rid → [{ mat }]（悬停高亮用）
  const devGlow = [];                // [{ mats, warn, color }]
  let ready = false;
  const doorPivots = new Map(), openDoors = new Set(), detailObjects = [];
  let currentView = "overview", focusedRack = "R04";
  const views = {
    room: { eye: [14, 12, -17], target: [0, .5, 0] },
    overview: { eye: [5.3, 5.3, -6.4], target: [0, 0.9, 1.1] },
    aisle: { eye: [-4.2, 1.65, 1.2], target: [0.4, 1.15, 1.2] },
    rack: { eye: [0.65, 1.5, -0.75], target: [0, 1.04, 2.55] },
  };
  const doorId = () => selId || focusedRack;
  function syncDoorButton() {
    const id = doorId(), open = openDoors.has(id);
    const button = $("#dc3d-door");
    button.textContent = `${open ? "关闭" : "打开"} ${id} 柜门`;
    button.setAttribute("aria-pressed", String(open));
    button.disabled = !doorPivots.has(id);
  }
  function setDoor(open, id = doorId()) {
    const pivot = doorPivots.get(id);
    if (!pivot) return;
    pivot.rotation.y = open ? Math.PI * 0.62 : 0;
    if (open) openDoors.add(id); else openDoors.delete(id);
    syncDoorButton(); invalidate();
  }
  function focusRack(id) {
    if (!rackGroups.has(id)) return;
    focusedRack = id; selId = id;
    $("#dc3d-rack-select").value = id;
    setView("rack");
  }
  function setView(name) {
    if (!views[name]) return;
    currentView = name;
    if (name === "rack") views.rack = rackView(racks.find(r => r.id === focusedRack), F);
    // Flush damping before jumping to a reproducible preset.
    controls.enableDamping = false; controls.update();
    camera.fov = views[name].fov || 46; camera.updateProjectionMatrix();
    camera.position.fromArray(views[name].eye);
    controls.target.fromArray(views[name].target);
    controls.update(); controls.enableDamping = true;
    controls.autoRotate = false;
    $$("[data-dc-view]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.dcView === name)));
    const focusedRow = F.rows.find(row => row.racks.includes(focusedRack));
    rackGroups.forEach((group, id) => { group.visible = name !== "rack" || focusedRow.racks.includes(id); });
    scene.traverse(o => {
      if (o.name === "ENV_ContainRoof" || o.name === "ENV_CeilingFixtures") o.visible = name === "aisle";
    });
    renderer.shadowMap.needsUpdate = true;
    if (name === "rack") setDoor(true, focusedRack);
    syncDoorButton();
    renderHud();
    invalidate();
  }
  $$("[data-dc-view]").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.dcView === "rack" && selId) focusRack(selId);
    else setView(b.dataset.dcView);
  }));
  $("#dc3d-door").addEventListener("click", () => setDoor(!openDoors.has(doorId())));
  $("#dc3d-rack-select").innerHTML = racks.map(r => `<option value="${r.id}"${r.id === focusedRack ? " selected" : ""}>${r.id}${r.managed ? "" : " · 未纳管"}</option>`).join("");
  $("#dc3d-rack-select").addEventListener("change", e => focusRack(e.target.value));

  const selRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.33, 0, -0.6), new THREE.Vector3(0.33, 0, -0.6),
      new THREE.Vector3(0.33, 0, 0.6), new THREE.Vector3(-0.33, 0, 0.6),
    ]),
    new THREE.LineBasicMaterial({ color: CV.num("accent"), transparent: true, opacity: 0.9 }),
  );
  selRing.visible = false;
  scene.add(selRing);

  function onModel(root) {
    racks.forEach(r => {
      const pivot = root.getObjectByName("DOOR_PIVOT_" + r.id);
      if (pivot) doorPivots.set(r.id, pivot);
    });
    /* 轴向说明：Blender Z-up → glTF/three Y-up（three.z = -blender.y） */
    root.traverse(o => {
      if (!o.isMesh) return;
      const n = o.name;
      if (o.material.name === "M_Door_PerforatedMesh") {
        // Square perforations on a tall door. Multisample coverage and filtered
        // alpha prevent a coarse, stretched lattice / moire at aisle distances.
        o.material.map.repeat.set(2, 7);
        o.material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        o.material.alphaToCoverage = true;
        o.material.alphaTest = .25;
        o.material.metalness = 0; // painted perforated steel, not exposed metal
        o.material.roughness = .64;
      }
      if (n.startsWith("DETAIL_") || n.startsWith("MICRO_") || n.startsWith("DOOR_") || n.startsWith("LED_") || n.startsWith("ENV_Contain") || n.startsWith("ENV_Strip") || n.startsWith("ENV_ColdFloor") || n.startsWith("CRAC_")) {
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
        if (o.name.startsWith("MECHANICS_") || o.name.startsWith("DETAIL_"))
          detailObjects.push({object:o, rackId:rk.id, center:wp.clone().add(new THREE.Vector3(0,1,0))});
        if (!o.isMesh) return;
        // Shared neutral materials stay shared; only per-rack hover surfaces
        // and per-device LEDs need independent mutable state.
        if (o.name.startsWith("BODY_") || o.name.startsWith("LED_")) o.material = o.material.clone();
        if (o.name.startsWith("BODY_")) {
          o.material.emissive = new THREE.Color(CV.num("accent"));
          o.material.emissiveIntensity = 0;
          bodyMats.push({ mat: o.material });
        }
        pickables.push(o);
      });
      rackBodyMats.set(rk.id, bodyMats);

      /* 屏幕空间机柜标签，不参与 Bloom / 色调映射 */
      const label = document.createElement("button");
      label.className = "dc3d-label";
      label.textContent = rk.id + (rk.hasWarn ? " · 预警" : "");
      label.dataset.managed = rk.managed;
      label.setAttribute("aria-label", `查看机柜 ${rk.id}${rk.hasWarn ? " · 硬件预警" : ""}`);
      label.addEventListener("click", () => { selId = rk.id; renderHud(); invalidate(); });
      $("#dc3d-labels").append(label);
      rackLabels.push({ el: label, position: wp.clone().add(new THREE.Vector3(0, 2.18, 0)), id: rk.id });


    });

    /* 设备发光映射：DEV_<id> 面板 / LED_<id> 灯条 → 运行时状态色 */
    devByIdLive.clear();
    [...D.servers.map(s => ({ id: s.id, kind: "server", state: s.state })),
     ...D.netDevices.map(n => ({ id: n.id, kind: n.kind === "bmc" ? "bmc" : "net", state: n.state }))]
      .forEach(dv => devByIdLive.set(dv.id, dv));
    devMeshes.clear();
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.userData.devId) {
        const id = o.userData.devId;
        const rec = devMeshes.get(id) || { body: [], led: [] };
        rec[o.name.startsWith("LED_") ? "led" : "body"].push(o);
        devMeshes.set(id, rec);
        return;
      }
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
    setView(new URLSearchParams(location.search).get("dcCamera") || "overview");
    canvas.dataset.ready = "true";
    if (new URLSearchParams(location.search).has("dcCamera")) {
      AXON.serversTab = "3d"; AXON.nav("servers"); renderServersTab();
    }
    renderHud();
  }

  /* 重建 LED 状态映射；列表有界，机箱材质不发光 */
  function applyDevGlow() {
    const G = kindGlow();
    devGlow.length = 0;
    devMeshes.forEach((rec, id) => {
      const dv = devByIdLive.get(id);
      if (!dv) return;
      const warn = dv.state === "warn";
      const color = warn ? G.warn : G[dv.kind];
      const mats = [];
      rec.body.forEach(o => {
        if (!o.material.emissive) return;
        o.material.emissive.set(0x000000);
        o.material.emissiveIntensity = 0;
      });
      rec.led.forEach(o => {
        o.material.color.set(color);
        o.material.emissive.set(color);
        o.material.emissiveIntensity = 1.8;
        mats.push({ mat: o.material, base: 1.8 });
      });
      if (warn) devGlow.push({ mats, warn: true });
    });
  }

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
    syncDoorButton();
    const total = racks.length;
    const managed = racks.filter(r => r.managed).length;
    const rk = racks.find(r => r.id === selId);
    if (!rk) {
      hud.innerHTML = `<div class="h-title">A2 机房 · 概览</div>
        <div class="h-kv">机柜 ${total} · 纳管 ${managed} · 服务器 ${D.servers.length} · 网络设备 ${D.netDevices.length}</div>
        <div class="h-kv">冷通道封闭 · 精密空调 ×4 · 双路供电</div>
        <div style="margin-top:6px">${currentView === "rack" ? focusedRack + " 剖切视角 · 对侧机柜与顶盖隐藏" : "全室统一精修 · 14 座 42U 机柜"}<br>选择机柜可查看设备与 U 位</div>`;
      return;
    }
    if (!rk.managed) {
      hud.innerHTML = `<div class="h-title">机柜 ${esc(rk.id)}</div>
        <div class="h-kv">状态：未纳管</div>
        <div style="margin-top:6px">该机柜不在当前管理范围（纳管 ${D.racks.map(r => r.id).join(" / ")}）</div><button class="btn tiny" id="dc3d-inspect-rack">近看 ${esc(rk.id)}</button>`;
      $("#dc3d-inspect-rack").onclick = () => focusRack(rk.id);
      return;
    }
    const meta = D.racks.find(r => r.id === rk.id);
    const st = rackStats(rk.id);
    hud.innerHTML = `<div class="h-title">${esc(meta.name)} · ${esc(meta.note)}</div>
      <div class="h-kv">位置：A2 机房 · 03 列 ${rk.id}（U 位见「机柜部署」）</div>
      <div class="h-kv">已用 ${st.usedU}U / 42U · ${st.devs.length} 台设备${st.hasWarn ? ' · <span style="color:var(--warn)">存在硬件预警</span>' : ""}</div>
      <div style="margin:6px 0 2px">${st.devs.map(m =>
        `<span class="dep-chip" data-3d-dev="${m.ref.id}" data-kind="${m.kind}">${esc(m.ref.name.replace(" · ", " "))}</span>`).join("")}</div>
      <button class="btn tiny" id="dc3d-open-rack">查看机柜 U 位</button>
      <button class="btn tiny" id="dc3d-inspect-rack">近看 ${esc(rk.id)}</button>`;
    $("#dc3d-inspect-rack").onclick = () => focusRack(rk.id);
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
    `<span>绿灯：设备正常</span>` +
    `<span>蓝灯：网络 / 带外</span>` +
    `<span>示意布局 · 冷通道净宽 1.64 m</span>`;

  /* ── 拾取与交互 ──────────────────────────────────────── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let selId = null, hoverId = null, hoverDev = null;
  let downPos = null;

  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const visible = pickables.filter(visibleInTree);
    const hits = ray.intersectObjects(visible, false);
    return pickHit(hits);
  }

  function setHover(h) {
    if (hoverId && hoverId !== (h && h.rackId)) {
      (rackBodyMats.get(hoverId) || []).forEach(({ mat }) => (mat.emissiveIntensity = 0));
    }
    hoverId = h ? h.rackId : null;
    hoverDev = h ? h.devId : null;
    if (hoverId) {
      (rackBodyMats.get(hoverId) || []).forEach(({ mat }) => (mat.emissiveIntensity = 0.035));
    }
    canvas.style.cursor = h ? "pointer" : "grab";
    invalidate();
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
    invalidate();
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

  /* Render only when the camera or scene changes; hidden tabs never draw. */
  const active = () => AXON.view === "servers" && AXON.serversTab === "3d" && !document.hidden;
  let W = 0, H = 0, frames = 2, stopped = false, raf;
  function invalidate() { frames = 32; }
  controls.addEventListener("change", invalidate);
  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const w = Math.round(r.width), h = Math.round(r.height);
    if (W === w && H === h) return;
    W = w; H = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
  }
  const projected = new THREE.Vector3();
  function updateLabels() {
    const occupied = [];
    rackLabels.forEach(({ el, position, id }) => {
      projected.copy(position).project(camera);
      const x = (projected.x + 1) * W / 2, y = (1 - projected.y) * H / 2;
      const inView = projected.z > -1 && projected.z < 1 && x > 20 && x < W - 20 && y > 58 && y < H - 45;
      const nearView = (currentView === "rack" && id !== focusedRack) || !rackGroups.get(id)?.visible;
      const collides = occupied.some(p => Math.abs(x - p.x) < 48 && Math.abs(y - p.y) < 24);
      el.hidden = !inView || nearView || collides;
      if (!el.hidden) { el.style.left = x + "px"; el.style.top = y + "px"; occupied.push({ x, y }); }
    });
  }
  let renderedFrames = 0, benchmark;
  function frame() {
    benchmark?.before();
    if (!active() || !ready || !frames) return;
    const start = performance.now();
    resize(); frames--; controls.update();
    detailObjects.forEach(d => {
      d.object.visible = showDetail(camera.position.distanceTo(d.center),d.object.visible,currentView === "rack" && d.rackId === focusedRack);
    });
    selRing.visible = !!selId && rackGroups.has(selId);
    if (selRing.visible) {
      rackGroups.get(selId).getWorldPosition(selRing.position);
      selRing.position.y = 0.025;
      selRing.material.opacity = 0.65;
    }
    updateLabels(); renderer.info.reset(); composer.render(); renderedFrames++;
    benchmark?.after(performance.now() - start, performance.now());
    if (diagnostics) diagnostics.textContent = JSON.stringify({
      ready, view: currentView, autoRotate: controls.autoRotate, openDoors: [...openDoors], focusedRack, renderedFrames,
      calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
      detailVisible: detailObjects.filter(d => visibleInTree(d.object)).length,
      warningDevices: devGlow.length, mappedDevices: devMeshes.size,
      textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs.length, camera: camera.position.toArray(),
    });
  }
  // Explicit developer mode exposes diagnostics as inspectable text, never in normal UI.
  let diagnostics;
  if (new URLSearchParams(location.search).has("diagnostics")) {
    diagnostics = document.createElement("output");
    diagnostics.id = "dc3d-diagnostics";
    diagnostics.style.cssText = "display:block;font:11px monospace;overflow-wrap:anywhere";
    canvas.parentElement.after(diagnostics);
    const benchContainer = document.createElement("div"); diagnostics.after(benchContainer);
    benchmark = installBenchmark({ renderer, canvas, container: benchContainer, active, ready: () => ready,
      setView, getView: () => currentView, invalidate,
      orbit: angle => { camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(controls.target); },
    });
  }
  function loop() { if (stopped) return; raf = requestAnimationFrame(loop); frame(); }
  AXON.on("servers-tab-3d", () => { setHover(null); resize(); renderHud(); invalidate(); });
  AXON.on("view", invalidate);
  document.addEventListener("visibilitychange", invalidate);
  const resizeObserver = new ResizeObserver(() => { if (active()) resize(); });
  resizeObserver.observe(canvas.parentElement);
  resize(); renderHud(); raf = requestAnimationFrame(loop);

  // Physical materials, lights and environment remain neutral across all UI themes.
  function applyPalette() {
    selRing.material.color.set(CV.num("accent"));
    rackBodyMats.forEach(mats => mats.forEach(({ mat }) => mat.emissive.set(CV.num("accent"))));
    if (ready) applyDevGlow();
    invalidate();
  }
  AXON.on("theme", applyPalette);
  function dispose() {
    stopped = true; cancelAnimationFrame(raf); resizeObserver.disconnect(); controls.dispose();
    document.removeEventListener("visibilitychange", invalidate);
    disposeEnvironment(scene);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    scene.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!mat) continue;
        materials.add(mat);
        Object.values(mat).forEach(v => { if (v?.isTexture) textures.add(v); });
      }
    });
    textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); geometries.forEach(g => g.dispose());
    composer.passes.forEach(p => p.dispose?.()); composer.dispose(); renderer.dispose();
  }
  window.addEventListener("pagehide", e => { if (!e.persisted) dispose(); });
  AXON.dc3d = { renderHud, state: () => ({ selId, hoverId, auto: controls.autoRotate, ready, currentView }) };
  window.__dc3d = AXON.dc3d;
  window.__dc3d_api = { scene, camera, renderer, controls, composer, setView, dispose,
    lights: { hemi, key, rim, ptLights }, info: () => renderer.info.render };
})();
