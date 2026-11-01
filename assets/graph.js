/* ═══════════════════════════════════════════════════════════
   AXON · 跨层拓扑图（Canvas）
   粒子沿「任务 → Agent → Infra → 服务器」依赖方向流动
   影响分析：选定节点后反向辐射标红
   ═══════════════════════════════════════════════════════════ */

(function () {
  const canvas = $("#topo-canvas");
  const ctx = canvas.getContext("2d");
  let G = AXON_DATA.buildGraph();
  const nodes = new Map(G.nodes.map(n => [n.id, n]));
  const edges = G.edges;
  let W = 0, H = 0, dpr = 1;
  let hoverId = null, selId = null;
  let impactMode = false, impactSet = null, impactRoot = null;
  let particles = [];
  let dragId = null, dragMoved = false, mouse = { x: -1, y: -1 };
  let t0 = performance.now();

  const GLYPH = {
    server: "▤", runtime: "◈", sandbox: "▣", gateway: "⇄", state: "◫", identity: "◍",
    model: "◇", tool: "⚙", agent: "◉", task: "▸",
  };
  const layerColor = (n) => LAYER_META[n.layer].color;

  /* ── 布局 ──────────────────────────────────────────────── */
  function layout() {
    const cols = [[], [], [], [], []];
    G.nodes.forEach(n => cols[n.layer].push(n));
    const padX = 70, padY = 56;
    const colW = (W - padX * 2) / 4;
    cols.forEach((col, ci) => {
      col.sort((a, b) => (a.ref && a.ref.id > b.ref.id ? 1 : -1));
      const availH = H - padY * 2;
      col.forEach((n, i) => {
        const y = col.length === 1 ? H / 2 : padY + availH * (i / (col.length - 1)) + availH / col.length / 2;
        n.bx = padX + colW * ci + (ci === 0 ? 0 : (ci === 2 ? 26 : 0));
        n.by = y;
        if (n.dx == null) { n.dx = 0; n.dy = 0; }
        n.phase = (i * 1.7 + ci * 0.9) % (Math.PI * 2);
      });
    });
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }

  const pos = (n) => ({
    x: n.bx + n.dx,
    y: n.by + n.dy + (REDUCED ? 0 : Math.sin((performance.now() - t0) / 2400 + n.phase) * 2.4),
  });

  /* ── 关系集合 ──────────────────────────────────────────── */
  const related = (id) => {
    const s = new Set([id]);
    edges.forEach(e => { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); });
    return s;
  };

  function computeImpact(rootId) {
    const set = AXON_DATA.downstream(edges, rootId);
    const cnt = { infra: 0, agent: 0, task: 0, nonInterrupt: 0, names: [] };
    set.forEach(id => {
      const n = nodes.get(id); if (!n) return;
      if (n.layer <= 2) cnt.infra++;
      if (n.layer === 3) cnt.agent++;
      if (n.layer === 4) {
        cnt.task++;
        if (n.ref && n.ref.interruptible === false) cnt.nonInterrupt++;
      }
    });
    return { set, cnt };
  }

  function showImpactBar(rootId) {
    const { cnt } = computeImpact(rootId);
    const root = nodes.get(rootId);
    const bar = $("#topo-impact-bar");
    bar.hidden = false;
    bar.innerHTML = `
      <span>影响分析 · <b>${esc(root ? root.label : rootId)}</b></span>
      <span>受影响 Infra 服务 <b>${cnt.infra}</b></span>
      <span>Agent <b>${cnt.agent}</b></span>
      <span>在途任务 <b>${cnt.task}</b></span>
      <span>其中不可中断 <b>${cnt.nonInterrupt}</b></span>
      <button class="btn tiny danger" id="impact-exit">退出</button>`;
    $("#impact-exit").onclick = () => setImpactMode(false);
  }

  function setImpactMode(on, rootId) {
    impactMode = on;
    $("#btn-impact-mode").classList.toggle("active", on);
    $("#btn-impact-mode").innerHTML = on
      ? '<i class="dot" style="animation:ledBlink 1s infinite"></i>影响分析中 · 点击节点'
      : '<i class="dot"></i>影响分析模式';
    if (on && rootId) {
      const { set } = computeImpact(rootId);
      impactSet = set; impactRoot = rootId;
      showImpactBar(rootId);
      AXON.toast("影响分析完成", `已标定受影响对象链路，红色脉冲即为故障辐射面。`, "warn");
    } else if (!on) {
      impactSet = null; impactRoot = null;
      $("#topo-impact-bar").hidden = true;
    }
  }
  AXON.impact = { setImpactMode, refresh: (id) => on && setImpactMode(true, id) };
  $("#btn-impact-mode").addEventListener("click", () => setImpactMode(!impactMode));
  $("#btn-topo-reset").addEventListener("click", () => {
    G.nodes.forEach(n => { n.dx = 0; n.dy = 0; });
    layout();
    AXON.toast("视图已重置", "节点布局恢复默认。", "info", 2200);
  });

  /* ── 命中检测 ──────────────────────────────────────────── */
  function hitTest(x, y) {
    for (const n of G.nodes) {
      const p = pos(n);
      if (x >= p.x - n.w / 2 - 3 && x <= p.x + n.w / 2 + 3 && y >= p.y - n.h / 2 - 3 && y <= p.y + n.h / 2 + 3) return n.id;
    }
    return null;
  }

  /* ── 交互 ──────────────────────────────────────────────── */
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    if (dragId) {
      const n = nodes.get(dragId);
      n.dx = mouse.x - n.bx; n.dy = mouse.y - n.by;
      dragMoved = true;
      canvas.classList.add("grabbing");
      return;
    }
    hoverId = hitTest(mouse.x, mouse.y);
    canvas.style.cursor = hoverId ? "pointer" : "grab";
  });
  canvas.addEventListener("mousedown", (e) => {
    const id = hitTest(mouse.x, mouse.y);
    if (id) { dragId = id; dragMoved = false; }
  });
  window.addEventListener("mouseup", () => {
    if (dragId && !dragMoved) {
      const id = dragId;
      if (impactMode) { selId = id; setImpactMode(true, id); renderSide(id); }
      else { selId = id; renderSide(id); }
    }
    dragId = null;
    canvas.classList.remove("grabbing");
  });
  canvas.addEventListener("mouseleave", () => { hoverId = null; });

  /* ── 粒子 ──────────────────────────────────────────────── */
  function spawnParticles() {
    const focus = impactSet || (selId ? related(selId) : null);
    edges.forEach((e, i) => {
      const lit = !focus || (focus.has(e.from) && focus.has(e.to));
      const rate = lit ? 0.10 : 0.02;
      if (Math.random() < rate) {
        particles.push({ e, t: 0, v: rnd(0.006, 0.013), hot: !!impactSet && lit });
      }
    });
    particles = particles.filter(p => p.t < 1);
    if (particles.length > 90) particles.splice(0, particles.length - 90);
  }

  /* ── 绘制 ──────────────────────────────────────────────── */
  const ease = (t) => t * t * (3 - 2 * t);
  function bez(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
  }

  function draw() {
    const focus = impactSet || (selId || hoverId ? related(selId || hoverId) : null);
    ctx.clearRect(0, 0, W, H);

    /* 列标题 */
    ctx.font = '10px Consolas, monospace';
    ctx.textAlign = "center";
    for (let ci = 0; ci < 5; ci++) {
      const colNodes = G.nodes.filter(n => n.layer === ci);
      if (!colNodes.length) continue;
      const x = colNodes[0].bx;
      ctx.fillStyle = "rgba(130,150,189,.55)";
      ctx.fillText("L" + ci + " · " + LAYER_META[ci].name, x, 26);
    }

    /* 边 */
    edges.forEach(e => {
      const a = nodes.get(e.from), b = nodes.get(e.to);
      if (!a || !b) return;
      const pa = pos(a), pb = pos(b);
      const p0 = { x: pa.x - a.w / 2, y: pa.y };
      const p3 = { x: pb.x + b.w / 2, y: pb.y };
      const dx = Math.max(40, (p0.x - p3.x) * 0.45);
      const p1 = { x: p0.x - dx, y: p0.y }, p2 = { x: p3.x + dx, y: p3.y };

      let alpha = 0.13, color = "110,180,255", width = 1;
      if (focus) {
        if (focus.has(e.from) && focus.has(e.to)) { alpha = 0.6; width = 1.5; color = "90,220,255"; }
        else alpha = 0.035;
      }
      if (impactSet && impactSet.has(e.from) && impactSet.has(e.to) && (e.from === impactRoot || e.to === impactRoot || impactSet.has(e.from) && impactSet.has(e.to))) {
        if (e.from === impactRoot || e.to === impactRoot) { color = "255,77,109"; alpha = 0.85; width = 2; }
        else { color = "255,120,150"; alpha = 0.5; width = 1.4; }
      }
      ctx.strokeStyle = `rgba(${color},${alpha})`;
      ctx.lineWidth = width;
      if (e.inferred) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      e._geom = [p0, p1, p2, { x: p3.x, y: pb.y }];
    });

    /* 粒子 */
    spawnParticles();
    particles.forEach(p => {
      const g = p.e._geom;
      if (!g) return;
      p.t += p.v;
      const pt = bez(g[0], g[1], g[2], g[3], ease(clamp(p.t, 0, 1)));
      const hot = p.hot;
      ctx.fillStyle = hot ? "rgba(255,99,130,.95)" : "rgba(140,230,255,.9)";
      ctx.shadowColor = hot ? "rgba(255,77,109,.9)" : "rgba(55,226,255,.8)";
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, hot ? 2.2 : 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    /* 节点 */
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() - t0) / 300);
    G.nodes.forEach(n => {
      const p = pos(n);
      const isFocus = focus ? focus.has(n.id) : true;
      const alpha = focus ? (isFocus ? 1 : 0.16) : 1;
      const inImpact = impactSet && impactSet.has(n.id);
      const isRoot = impactRoot === n.id;
      const col = layerColor(n);

      ctx.globalAlpha = alpha;

      /* 影响脉冲圈 */
      if (inImpact && !REDUCED) {
        ctx.strokeStyle = `rgba(255,77,109,${0.35 + 0.4 * pulse})`;
        ctx.lineWidth = 1.4;
        const rr = 6 + pulse * 5;
        ctx.beginPath();
        ctx.roundRect(p.x - n.w / 2 - rr, p.y - n.h / 2 - rr, n.w + rr * 2, n.h + rr * 2, 7);
        ctx.stroke();
      }

      /* 芯片底 */
      ctx.fillStyle = "rgba(9,17,35,.92)";
      ctx.strokeStyle = isRoot ? "#ff4d6d" : inImpact ? "rgba(255,99,130,.85)" : col + "cc";
      ctx.lineWidth = n.id === selId || n.id === hoverId ? 1.8 : 1.1;
      if (n.id === selId || n.id === hoverId) { ctx.shadowColor = col; ctx.shadowBlur = 13; }
      if (isRoot) { ctx.shadowColor = "#ff4d6d"; ctx.shadowBlur = 18; }
      ctx.beginPath();
      ctx.roundRect(p.x - n.w / 2, p.y - n.h / 2, n.w, n.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* 顶条（层色） */
      ctx.fillStyle = inImpact ? "rgba(255,77,109,.8)" : col;
      ctx.fillRect(p.x - n.w / 2, p.y - n.h / 2, n.w, 2.4);

      /* 状态点（服务器预警 / 任务状态） */
      let dot = null;
      if (n.type === "server" && n.ref.state === "warn") dot = "#ffb340";
      if (n.type === "task") {
        const st = n.ref.state;
        dot = st === "unknown" ? "#ff4d6d" : (st === "waiting_approval" || st === "queued") ? "#ffb340" : st === "checkpointed" ? "#37e2ff" : null;
      }
      if (dot) {
        ctx.fillStyle = dot;
        ctx.shadowColor = dot; ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(p.x + n.w / 2 - 8, p.y - n.h / 2 + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      /* 文本 */
      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(216,231,255,.96)";
      ctx.font = '11.5px "Segoe UI","Microsoft YaHei",sans-serif';
      const gx = p.x - n.w / 2 + 8;
      ctx.fillText((GLYPH[n.type] || "◈") + " " + n.label, gx, p.y - 2);
      ctx.fillStyle = "rgba(130,150,189,.85)";
      ctx.font = '9.5px Consolas,monospace';
      ctx.fillText(n.sub || "", gx, p.y + 12);
      ctx.globalAlpha = 1;
    });
  }

  function loop() {
    if (AXON.view === "topo") draw();
    requestAnimationFrame(loop);
  }

  /* ── 右侧详情面板 ──────────────────────────────────────── */
  function kv(pairs) {
    return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${k}</dt><dd class="${/[\u4e00-\u9fa5]/.test(v) && v.length > 8 ? "plain" : ""}">${v}</dd>`).join("")}</dl>`;
  }
  function capsGrid(caps) {
    const items = [["observe", "发现与观测"], ["traffic", "流量与准入"], ["instance", "实例控制"], ["state", "状态控制"], ["task", "任务控制"]];
    return `<div class="caps-grid">${items.map(([k, n]) =>
      `<div class="cap-tag ${caps[k] ? "on" : "off"}">${n}<span>${caps[k] ? "✓" : "未支持"}</span></div>`).join("")}</div>`;
  }

  window.renderSide = function (id) {
    const side = $("#topo-side");
    const n = nodes.get(id);
    if (!n) return;
    const D = AXON_DATA;
    let html = "";

    if (n.type === "server") {
      const s = n.ref;
      const { cnt } = computeImpact(id);
      html = `
        <div class="side-node-title"><span class="t">${esc(s.name)}</span><span class="badge warn">维护建议</span></div>
        <div class="side-node-sub">${s.id} · ${esc(s.model)}</div>
        <div class="side-sec"><h4>资产</h4>${kv([["资产编号", s.asset], ["角色", s.role], ["CPU", s.cpu + "%"], ["内存", s.mem + "%"], ...(s.gpu ? [["GPU", s.gpu + "%"]] : []), ["功耗", s.power], ["运行时长", s.uptime]])}</div>
        <div class="side-sec"><h4>承载与影响</h4>${kv([["承载服务", D.infra.filter(f => f.host === s.id).length + " 个"], ["在途任务", cnt.task + " 个"], ["不可中断", cnt.nonInterrupt + " 个"]])}
          <p style="font-size:11.5px;color:var(--text-dim);margin-top:8px;line-height:1.7">${esc(s.warnNote || "健康状态正常")}</p></div>
        <div class="drawer-actions">
          <button class="btn" id="side-maint">发起维护编排</button>
          <button class="btn ghost" id="side-impact">影响分析</button>
          <button class="btn ghost" id="side-srv">服务器详情</button>
        </div>`;
    } else if (n.layer === 1) {
      const f = n.ref;
      const extras = f.kind === "sandbox"
        ? [["预热", f.warm], ["绑定", f.bound], ["已暂停", f.paused], ["模板", `<span class="badge info">${esc(f.template)}</span>`]]
        : f.kind === "gateway" ? [["QPS", f.qps], ["路由", f.routes + " 条"]]
        : f.kind === "state" ? [["容量", `${f.usedPct}% / ${f.cap}`], ...(f.hitRate ? [["命中率", f.hitRate + "%"]] : [])]
        : [["Pods", f.pods]];
      html = `
        <div class="side-node-title"><span class="t">${esc(f.name)}</span><span class="badge info">${esc(f.ver)}</span></div>
        <div class="side-node-sub">${f.id} · 承载于 ${esc(D.find(f.host).id)}</div>
        <div class="side-sec"><h4>服务</h4>${kv([["类型", { runtime: "运行时", sandbox: "沙箱", gateway: "网关", state: "状态服务", identity: "身份" }[f.kind]], ...extras])}
          <p style="font-size:11.5px;color:var(--text-dim);margin-top:8px;line-height:1.7">${esc(f.desc || "")}</p></div>
        <div class="side-sec"><h4>被依赖</h4>${depChips(dependentAgents(f.id))}</div>
        <div class="drawer-actions"><button class="btn ghost" id="side-impact">影响分析</button></div>`;
    } else if (n.layer === 2) {
      const m = n.ref, isModel = n.type === "model";
      html = `
        <div class="side-node-title"><span class="t">${esc(m.name)}</span><span class="badge ${m.state === "standby" || m.contract === "warn" ? "warn" : "ok"}">${isModel ? (m.state === "standby" ? "备用" : "主用") : (m.contract === "warn" ? "契约注意" : "契约正常")}</span></div>
        <div class="side-node-sub">${m.id} · 挂载于 ${esc(m.via)}</div>
        <div class="side-sec"><h4>${isModel ? "端点" : "工具"}</h4>${kv(isModel
          ? [["供应商", esc(m.vendor.split(" · ")[0])], ["上下文", m.ctx], ["流量占比", m.traffic + "%"], ["P95", m.p95 + "s"], ["TPS", m.tps], ["24h Token", m.tokens24h + "M"]]
          : [["版本", m.ver], ["副作用", { "external-write": "外部写入", readonly: "只读", sandboxed: "沙箱内" }[m.effect]], ["幂等", m.idem ? "支持" : "不支持"], ["QPS", m.qps], ["错误率", m.err + "%"]])}
          <p style="font-size:11.5px;color:var(--text-dim);margin-top:8px;line-height:1.7">${esc(m.note || "")}</p></div>
        <div class="side-sec"><h4>消费方</h4>${depChips(m.consumers)}</div>
        <div class="drawer-actions"><button class="btn ghost" id="side-impact">影响分析</button></div>`;
    } else if (n.type === "agent") {
      const a = n.ref;
      html = `
        <div class="side-node-title"><span class="t">${esc(a.name)}</span><span class="badge violet">${esc(a.ver)}</span></div>
        <div class="side-node-sub">${a.id} · ${esc(a.owner)}</div>
        <div class="side-sec"><h4>部署</h4>${kv([["实例", a.inst + " 个"], ["租户", esc((D.tenants.find(t => t.id === a.tenant) || {}).name || a.tenant)], ["可用性", a.uptime99], ["状态", a.state === "gray" ? "灰度中" : "运行中"]])}</div>
        <div class="side-sec"><h4>依赖</h4>
          <div>${depChips([a.runtime, ...a.models, ...a.tools, ...a.stores])}</div></div>
        <div class="side-sec"><h4>适配器能力声明</h4>${capsGrid(a.caps)}</div>
        <div class="drawer-actions"><button class="btn ghost" id="side-impact">影响分析</button></div>`;
    } else {
      const t = n.ref;
      const meta = TASK_META[t.state] || {};
      html = `
        <div class="side-node-title"><span class="t">${esc(t.name)}</span><span class="badge ${meta.cls}">${meta.txt}</span></div>
        <div class="side-node-sub">${t.id} · ${esc((D.find(t.agent) || {}).name || "")}</div>
        <div class="side-sec"><h4>执行</h4>${kv([["进度", Math.round(t.progress) + "%"], ["Token", t.tokensM + "M"], ["成本", "¥" + t.cost], ["可中断", t.interruptible ? "是" : "否"], ["启动", t.started], ["耗时", t.elapsed + "min"]])}
          <div class="prog ${t.state === "running" ? "" : "warn"}" style="margin-top:10px"><i style="width:${t.progress}%"></i></div></div>
        <div class="side-sec"><h4>检查点</h4>${t.ckpt
          ? `<div class="ck-box"><div class="ck-head"><span class="mono" style="font-family:var(--mono);color:var(--cyan)">${t.ckpt.id}</span><span class="badge ok">兼容</span></div>
             <div class="kv">${kv([["模式", esc(t.ckpt.mode)], ["时间", t.ckpt.ts]])}</div></div>`
          : `<span class="badge dim">无检查点</span>`}</div>
        ${t.waitReason ? `<div class="side-sec"><h4>当前等待</h4><p style="font-size:11.5px;color:var(--warn);line-height:1.7">${esc(t.waitReason)}</p></div>` : ""}
        <div class="drawer-actions">
          ${t.state === "checkpointed" || t.state === "waiting_approval" ? `<button class="btn ok" id="side-resume">恢复执行</button>` : ""}
          ${t.state === "running" ? `<button class="btn ghost" id="side-hold">保存检查点并暂停</button>` : ""}
          <button class="btn ghost" id="side-task-detail">任务详情</button>
        </div>`;
    }

    side.innerHTML = html;
    wireSideActions(id);
  };

  function dependentAgents(infraId) {
    return AXON_DATA.agents.filter(a => a.runtime === infraId || a.models.includes(infraId) || a.tools.includes(infraId) || a.stores.includes(infraId)).map(a => a.id);
  }
  function depChips(ids) {
    if (!ids || !ids.length) return '<span class="badge dim">无</span>';
    return ids.map(id => {
      const o = AXON_DATA.find(id);
      if (!o) return "";
      const name = (o.name || id).replace(" Agent", "").replace(" · ", " ");
      return `<span class="dep-chip" data-node="${id}">${esc(name.length > 13 ? name.slice(0, 12) + "…" : name)}</span>`;
    }).join("");
  }

  function wireSideActions(id) {
    const side = $("#topo-side");
    $$(".dep-chip", side).forEach(c => c.addEventListener("click", () => { selId = c.dataset.node; renderSide(selId); }));
    const impactBtn = $("#side-impact", side);
    if (impactBtn) impactBtn.addEventListener("click", () => setImpactMode(true, id));
    const maintBtn = $("#side-maint", side);
    if (maintBtn) maintBtn.addEventListener("click", () => { AXON.nav("maint"); AXON.emit("maint-prefill", id); });
    const srvBtn = $("#side-srv", side);
    if (srvBtn) srvBtn.addEventListener("click", () => { AXON.nav("servers"); AXON.emit("server-detail", id); });
    const resumeBtn = $("#side-resume", side);
    if (resumeBtn) resumeBtn.addEventListener("click", () => AXON.emit("task-resume", id));
    const holdBtn = $("#side-hold", side);
    if (holdBtn) holdBtn.addEventListener("click", () => AXON.emit("task-hold", id));
    const detBtn = $("#side-task-detail", side);
    if (detBtn) detBtn.addEventListener("click", () => AXON.emit("task-detail", id));
  }
  AXON.renderSide = renderSide;

  /* 图例 */
  $("#topo-legend").innerHTML =
    Object.values(LAYER_META).map(l => `<span><i style="background:${l.color}"></i>${l.name}</span>`).join("") +
    `<span class="sep"></span><span class="flow">● 粒子 = 依赖调用方向（任务 → 服务器）</span>` +
    `<span class="sep"></span><span style="color:var(--text-dim)">虚线 = 遥测推断关系（区别于显式声明 · 有时效）</span>`;

  /* 生命周期 */
  new ResizeObserver(() => resize()).observe(canvas.parentElement);
  resize();
  requestAnimationFrame(loop);

  AXON.graph = { computeImpact, nodes, edges, select: (id) => { selId = id; renderSide(id); } };
})();
