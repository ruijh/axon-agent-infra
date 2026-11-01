/* ═══════════════════════════════════════════════════════════
   AXON · 数据中心 3D 视图（服务器管理 · 子页）
   Canvas 等轴投影：房间地面 / 机柜立体建模 / 设备 U 位
   交互：拖拽旋转 yaw · 滚轮缩放 · 点击机柜查看详情
   ═══════════════════════════════════════════════════════════ */

(function () {
  const canvas = $("#dc3d-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const D = AXON_DATA;
  const F = D.dcFloor;
  const SC0 = 26;                 // 基准比例 px/m
  const RACK = { w: 0.62, d: 1.16, h: 2.0 };
  const CRAC = { w: 0.8, d: 0.8, h: 2.2 };

  let W = 0, H = 0;
  let yaw = -0.72, zoom = 1, auto = true;
  let selId = null, hoverId = null;
  let mouse = { x: -1, y: -1 }, drag = null, dragMoved = false;
  const t0 = performance.now();

  /* 机柜实体：dcFloor 布局 + racks 纳管状态 */
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

  function rackStats(rid) {
    const members = [
      ...AXON_DATA.servers.map(s => ({ kind: "server", ref: s })),
      ...AXON_DATA.netDevices.map(n => ({ kind: "net", ref: n })),
    ];
    const devs = members.filter(m => m.ref.location.rack === rid);
    return {
      devs,
      usedU: devs.reduce((a, m) => a + (m.ref.location.u[1] - m.ref.location.u[0] + 1), 0),
      hasWarn: devs.some(m => m.ref.state === "warn"),
    };
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* 等轴投影：世界坐标（米，房间中心为原点）→ 屏幕 */
  function project(x, y, z) {
    const s = SC0 * zoom;
    const cx = F.size.w / 2, cy = F.size.d / 2;
    const px = x - cx, py = y - cy;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    const xr = px * c - py * sn, yr = px * sn + py * c;
    return {
      x: W / 2 + (xr - yr) * 0.866 * s,
      y: H / 2 + 34 + ((xr + yr) * 0.5 - z) * s,
      d: xr + yr,
    };
  }

  const quad = (a, b, c, d2, fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  };

  const shade = (rgb, k) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${k})`;

  /* 立方体：绘制顶面 + 两个朝向观察者的侧面 */
  function drawBox(x, y, w, d, h, rgb, opts = {}) {
    const p = (dx, dy, dz) => project(x + dx, y + dy, dz);
    const cs = [
      p(0, 0, 0), p(w, 0, 0), p(w, d, 0), p(0, d, 0),           // 底面四角
      p(0, 0, h), p(w, 0, h), p(w, d, h), p(0, d, h),           // 顶面四角
    ];
    /* 找深度最大的底角（最靠观察者），其相邻两侧面可见 */
    let fi = 0;
    for (let i = 1; i < 4; i++) if (cs[i].d > cs[fi].d) fi = i;
    const adj = [(fi + 3) % 4, (fi + 1) % 4];

    /* 侧面（暗 → 亮），先画远的相邻面 */
    const order = adj.slice().sort((a, b) => cs[a].d - cs[b].d);
    order.forEach((idx, k) => {
      const n = (idx + 1) % 4;
      quad(cs[idx], cs[n], cs[n + 4], cs[idx + 4],
        shade(rgb, k === 0 ? 0.32 : 0.5),
        shade(rgb, 0.85));
    });
    /* 顶面（最亮） */
    quad(cs[4], cs[5], cs[6], cs[7],
      shade(rgb, 0.66), shade(rgb, 0.95));

    return { cs, fi, adj };
  }

  /* 正面设备块：贴在最前侧面上的仿射小矩形 */
  function drawDevices(rack, face) {
    const { cs, fi } = face;
    const i0 = fi, i1 = (fi + 1) % 4;
    const p0 = cs[i0], p1 = cs[i1];         // 底边两端
    const p2 = cs[i1 + 4], p3 = cs[i0 + 4]; // 顶边两端
    rack.devList.forEach(m => {
      const [u0, u1] = m.ref.location.u;
      const t0v = 1 - u1 / 42, t1v = 1 - u0 / 42;   // 底=U1 → t=0 在底
      const sPad = 0.14, s0 = sPad, s1 = 1 - sPad;
      const pt = (s, t) => ({
        x: (p0.x + (p1.x - p0.x) * s) * (1 - t) + (p3.x + (p2.x - p3.x) * s) * t,
        y: (p0.y + (p1.y - p0.y) * s) * (1 - t) + (p3.y + (p2.y - p3.y) * s) * t,
      });
      const col = m.kind === "server" ? [111, 155, 255] : (m.ref.kind === "bmc" ? [177, 140, 255] : [255, 147, 80]);
      const a = pt(s0, t0v), b = pt(s1, t0v), c = pt(s1, t1v), d2 = pt(s0, t1v);
      quad(a, b, c, d2, shade(col, 0.72), shade(col, 0.95));
      if (m.ref.state === "warn") {
        const mid = pt((s0 + s1) / 2, (t0v + t1v) / 2);
        const pulse = 0.5 + 0.5 * Math.sin((performance.now() - t0) / 300);
        ctx.fillStyle = `rgba(255,179,64,${0.5 + 0.5 * pulse})`;
        ctx.shadowColor = "#ffb340"; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(mid.x, mid.y, 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    });
  }

  function bboxOf(rack) {
    const pts = [
      project(rack.x - RACK.w / 2, rack.y - RACK.d / 2, 0),
      project(rack.x + RACK.w / 2, rack.y + RACK.d / 2, 0),
      project(rack.x, rack.y, RACK.h + 0.5),
    ];
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const S = F.size;
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() - t0) / 900);

    /* 地面 + 网格 */
    const f = [
      project(0, 0, 0), project(S.w, 0, 0), project(S.w, S.d, 0), project(0, S.d, 0),
    ];
    quad(f[0], f[1], f[2], f[3], "rgba(16,30,60,.72)", "rgba(96,190,255,.4)");
    ctx.lineWidth = 1;
    for (let gx = 1; gx < S.w; gx++) {
      const a = project(gx, 0, 0), b = project(gx, S.d, 0);
      ctx.strokeStyle = "rgba(78,150,255,.10)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let gy = 1; gy < S.d; gy++) {
      const a = project(0, gy, 0), b = project(S.w, gy, 0);
      ctx.strokeStyle = "rgba(78,150,255,.10)";
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    /* 冷通道提示带（A/B 排之间） */
    const ca = [
      project(1.2, 4.4, 0), project(S.w - 1.2, 4.4, 0), project(S.w - 1.2, 7.6, 0), project(1.2, 7.6, 0),
    ];
    quad(ca[0], ca[1], ca[2], ca[3], "rgba(55,226,255,.06)", "rgba(55,226,255,.22)");
    const caMid = project(S.w / 2, 6.0, 0);
    ctx.fillStyle = "rgba(120,220,255,.5)";
    ctx.font = '10px "Segoe UI","Microsoft YaHei"';
    ctx.textAlign = "center";
    ctx.fillText("冷通道 · COLD AISLE", caMid.x, caMid.y + 4);

    /* CRAC 空调 */
    F.crac.forEach(c => drawBox(c.x - CRAC.w / 2, c.y - CRAC.d / 2, CRAC.w, CRAC.d, CRAC.h, [70, 120, 180]));

    /* 机柜：远 → 近 */
    const sorted = racks.slice().sort((a, b) => {
      const da = project(a.x, a.y, 0).d, db = project(b.x, b.y, 0).d;
      return da - db;
    });
    sorted.forEach(rk => {
      const isSel = rk.id === selId, isHover = rk.id === hoverId;
      const rgb = rk.managed ? [70, 130, 235] : [38, 52, 82];
      const x0 = rk.x - RACK.w / 2, y0 = rk.y - RACK.d / 2;
      const face = drawBox(x0, y0, RACK.w, RACK.d, RACK.h, rgb);
      if (rk.managed) drawDevices(rk, face);

      /* 标签（顶面上方） */
      const top = project(rk.x, rk.y, RACK.h + 0.42);
      ctx.textAlign = "center";
      ctx.font = (isSel || isHover ? "bold " : "") + '10px Consolas,monospace';
      ctx.fillStyle = rk.managed ? (isSel || isHover ? "#c8f4ff" : "rgba(150,200,255,.85)") : "rgba(110,125,160,.5)";
      ctx.fillText(rk.id, top.x, top.y);

      /* 选中/预警效果 */
      if (isSel) {
        const bb = bboxOf(rk);
        ctx.strokeStyle = `rgba(55,226,255,${0.55 + 0.4 * pulse})`;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(bb.x0 - 5, bb.y0 - 5, bb.x1 - bb.x0 + 10, bb.y1 - bb.y0 + 10);
        ctx.setLineDash([]);
      }
      if (rk.hasWarn) {
        const w = project(rk.x, rk.y, RACK.h + 0.1);
        ctx.fillStyle = `rgba(255,179,64,${0.4 + 0.5 * pulse})`;
        ctx.shadowColor = "#ffb340"; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.arc(w.x, w.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
      }
    });

    /* 房间标注 */
    const rm = project(S.w / 2, -0.55, 0);
    ctx.fillStyle = "rgba(130,150,189,.6)";
    ctx.font = '10px Consolas,monospace';
    ctx.textAlign = "center";
    ctx.fillText("华东-1 · A 栋 — A2 机房 · 22×12 m · 14 柜（纳管 3）", rm.x, rm.y);
  }

  function loop() {
    if (auto && !drag) yaw += 0.0026;
    if (AXON.view === "servers" && AXON.serversTab === "3d") {
      if (!W) resize();
      draw();
    }
    requestAnimationFrame(loop);
  }

  /* ── 交互 ── */
  function rackAt(x, y) {
    const sorted = racks.slice().sort((a, b) => project(b.x, b.y, 0).d - project(a.x, a.y, 0).d);
    for (const rk of sorted) {
      const bb = bboxOf(rk);
      if (x >= bb.x0 - 4 && x <= bb.x1 + 4 && y >= bb.y0 - 4 && y <= bb.y1 + 4) return rk;
    }
    return null;
  }

  canvas.addEventListener("mousedown", (e) => {
    const r = canvas.getBoundingClientRect();
    drag = { x: e.clientX - r.left, y: e.clientY - r.top, yaw };
    dragMoved = false;
    canvas.classList.add("dragging");
  });
  window.addEventListener("mousemove", (e) => {
    if (!canvas.offsetParent) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    if (drag) {
      const dx = mouse.x - drag.x;
      if (Math.abs(dx) > 3) dragMoved = true;
      yaw = drag.yaw + dx * 0.006;
      auto = false;
      return;
    }
    const hit = rackAt(mouse.x, mouse.y);
    hoverId = hit ? hit.id : null;
    canvas.style.cursor = hoverId ? "pointer" : "grab";
  });
  window.addEventListener("mouseup", () => {
    if (drag && !dragMoved && hoverId) {
      selId = hoverId;
      renderHud();
    }
    drag = null;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    auto = false;
    zoom = clamp(zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.55, 2.4);
  }, { passive: false });

  function renderHud() {
    const hud = $("#dc3d-hud");
    if (!hud) return;
    const rk = racks.find(r => r.id === selId);
    if (!rk) {
      hud.innerHTML = `<div class="h-title">A2 机房 · 概览</div>
        <div class="h-kv">机柜 14 · 纳管 3 · 服务器 4 · 网络设备 5</div>
        <div class="h-kv">冷通道封闭 · 精密空调 ×4 · 双路供电</div>
        <div style="margin-top:6px">点击任一机柜查看承载详情</div>`;
      return;
    }
    if (!rk.managed) {
      hud.innerHTML = `<div class="h-title">机柜 ${esc(rk.id)}</div>
        <div class="h-kv">状态：未纳管</div>
        <div style="margin-top:6px">该机柜不在当前管理范围（示例仅纳管 R01 / R04 / R05）</div>`;
      return;
    }
    const meta = AXON_DATA.racks.find(r => r.id === rk.id);
    const st = rackStats(rk.id);
    hud.innerHTML = `<div class="h-title">${esc(meta.name)} · ${esc(meta.note)}</div>
      <div class="h-kv">位置：A2 机房 · 03 列 ${rk.id}（U 位见「机柜部署」）</div>
      <div class="h-kv">已用 ${st.usedU}U / 42U · ${st.devs.length} 台设备${st.hasWarn ? ' · <span style="color:var(--warn)">存在硬件预警</span>' : ""}</div>
      <div style="margin:6px 0 2px">${st.devs.map(m =>
        `<span class="dep-chip" data-3d-dev="${m.ref.id}" data-kind="${m.kind}">${esc(m.ref.name.replace(" · ", " "))}</span>`).join("")}</div>
      <button class="btn tiny" id="dc3d-open-rack">查看机柜 U 位</button>`;
    $$("#dc3d-hud [data-3d-dev]").forEach(ch => ch.addEventListener("click", () => {
      if (ch.dataset.kind === "server") AXON.emit("server-detail", ch.dataset["3dDev"]);
      else {
        const n = AXON_DATA.find(ch.dataset["3dDev"]);
        AXON.toast(n.name, `${esc(n.model)} · ${esc(n.role)} · 管理口 ${esc(n.mgmt)}`, "info", 3800);
      }
    }));
    $("#dc3d-open-rack").onclick = () => { AXON.serversTab = "rack"; renderServersTab(); };
  }

  $("#dc3d-legend").innerHTML =
    `<span><i style="border-color:rgb(70,130,235)"></i>已纳管机柜</span>` +
    `<span><i style="border-color:rgb(38,52,82)"></i>未纳管</span>` +
    `<span style="color:var(--orange)">● 硬件预警</span>` +
    `<span>正面色块 = 服务器 / 网络设备 U 位</span>`;

  AXON.on("servers-tab-3d", () => {
    resize();
    if (W) draw();          /* 后台标签页 rAF 暂停时保证至少渲染一帧 */
    renderHud();
    requestAnimationFrame(() => { resize(); draw(); renderHud(); });
    setTimeout(() => { resize(); draw(); }, 120);
  });
  new ResizeObserver(() => { if (AXON.serversTab === "3d") resize(); }).observe(canvas.parentElement);
  resize();
  renderHud();
  requestAnimationFrame(loop);

  AXON.dc3d = { rackAt, renderHud, state: () => ({ yaw, zoom, selId, auto }) };
  window.__dc3d = AXON.dc3d;   /* 调试/测试钩子 */
})();
