/* ═══════════════════════════════════════════════════════════
   AXON · 视图渲染：总览 / 资产目录 / 任务中心 / 治理配额
   ═══════════════════════════════════════════════════════════ */

TASK_META.cancelled = { txt: "已取消", cls: "dim" };

const CV = window.AXON_CV;

AXON.feed = [
  { ts: "10:28", tag: "检查点", cls: "info", msg: "<b>T26-0733</b> 写入检查点 cp-d90b · 双副本落盘确认" },
  { ts: "10:26", tag: "审批", cls: "warn", msg: "<b>T26-0731</b> 等待人工审批 47 分钟 · 环境已按检查点暂存" },
  { ts: "10:21", tag: "配额", cls: "warn", msg: "租户 <b>dev-tools</b> Token 配额使用 88%" },
  { ts: "10:14", tag: "沙箱", cls: "info", msg: "沙箱预热池命中 <b>ubuntu-24</b> 模板 · 供给耗时 1.8s" },
  { ts: "10:02", tag: "遥测", cls: "info", msg: "跨层追踪关联完成 · <b>T26-0729</b> 延迟主要来自模型端点" },
];

/* ══ Canvas 图表 ══════════════════════════════════════════ */
function chartCtx(cvs) {
  const r = cvs.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (cvs.width !== Math.round(r.width * dpr)) {
    cvs.width = r.width * dpr; cvs.height = r.height * dpr;
  }
  const ctx = cvs.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

function drawThroughput() {
  const cvs = $("#chart-throughput");
  if (!cvs || !cvs.offsetParent) return;
  const { ctx, w, h } = chartCtx(cvs);
  const data = AXON_DATA.charts.throughput;
  const pad = { l: 34, r: 12, t: 14, b: 22 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const maxV = Math.max(...data.map(d => d.done + d.fail)) * 1.15;
  const X = i => pad.l + iw * i / (data.length - 1);
  const Y = v => pad.t + ih * (1 - v / maxV);

  ctx.clearRect(0, 0, w, h);
  ctx.font = "9.5px Consolas,monospace";
  ctx.strokeStyle = CV.rgba("steel", .09); ctx.fillStyle = CV.rgba("textDim", .6);
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + ih * g / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(Math.round(maxV * (1 - g / 4)), pad.l - 6, y + 3);
  }
  ctx.textAlign = "center";
  data.forEach((d, i) => { if (i % 4 === 0) ctx.fillText(`-${data.length - 1 - i}h`, X(i), h - 6); });

  /* 完成量：面积 + 发光折线 */
  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, CV.rgba("accent", .30));
  grad.addColorStop(1, CV.rgba("accent", .02));
  ctx.beginPath();
  data.forEach((d, i) => i ? ctx.lineTo(X(i), Y(d.done)) : ctx.moveTo(X(0), Y(d.done)));
  ctx.lineTo(X(data.length - 1), pad.t + ih); ctx.lineTo(X(0), pad.t + ih); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  data.forEach((d, i) => i ? ctx.lineTo(X(i), Y(d.done)) : ctx.moveTo(X(0), Y(d.done)));
  ctx.strokeStyle = CV.rgba("accentSoft", .95); ctx.lineWidth = 1.6;
  ctx.shadowColor = CV.rgba("accent", .55); ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;

  /* 失败：红色点 */
  data.forEach((d, i) => {
    if (!d.fail) return;
    ctx.fillStyle = CV.rgba("crit", .9);
    ctx.beginPath(); ctx.arc(X(i), Y(d.done + d.fail), 2.2, 0, 7); ctx.fill();
  });

  $("#tp-legend").innerHTML =
    `<span><i style="background:${CV.hex("accentSoft")}"></i>完成任务/h</span><span><i style="background:${CV.hex("crit")}"></i>失败/超时</span>`;
}

function drawTokenBars() {
  const cvs = $("#chart-token");
  if (!cvs || !cvs.offsetParent) return;
  const { ctx, w, h } = chartCtx(cvs);
  const ts = AXON_DATA.tenants;
  const pad = { l: 10, r: 10, t: 20, b: 30 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const maxV = Math.max(...ts.map(t => t.tokenBudget)) * 1.05;
  const bw = iw / ts.length * 0.5;

  ctx.clearRect(0, 0, w, h);
  ts.forEach((t, i) => {
    const x = pad.l + iw * (i + 0.5) / ts.length;
    const pct = t.tokenUsed / t.tokenBudget;
    const col = pct > 0.85 ? CV.tri("crit") : pct > 0.7 ? CV.tri("warn") : CV.tri("accent");
    /* 预算刻度 */
    const bh = t.tokenBudget / maxV * ih;
    ctx.strokeStyle = CV.rgba("textDim", .35); ctx.setLineDash([3, 3]);
    ctx.strokeRect(x - bw / 2, pad.t + ih - bh, bw, bh);
    ctx.setLineDash([]);
    /* 实际用量 */
    const uh = t.tokenUsed / maxV * ih;
    const g = ctx.createLinearGradient(0, pad.t + ih - uh, 0, pad.t + ih);
    g.addColorStop(0, `rgba(${col},.85)`); g.addColorStop(1, `rgba(${col},.15)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - bw / 2, pad.t + ih - uh, bw, uh);
    ctx.font = "10px Consolas,monospace"; ctx.textAlign = "center";
    ctx.fillStyle = `rgba(${col},1)`;
    ctx.fillText(Math.round(pct * 100) + "%", x, pad.t + ih - uh - 5);
    ctx.fillStyle = CV.rgba("textDim", .8);
    ctx.fillText(t.name, x, h - 8);
  });
}

function drawLatency() {
  const cvs = $("#chart-latency");
  if (!cvs || !cvs.offsetParent) return;
  const { ctx, w, h } = chartCtx(cvs);
  const arr = AXON_DATA.charts.latency;
  const pad = { l: 30, r: 10, t: 12, b: 18 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const min = 1.0, max = 4.0;
  const X = i => pad.l + iw * i / (arr.length - 1);
  const Y = v => pad.t + ih * (1 - (v - min) / (max - min));

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = CV.rgba("steel", .09);
  ctx.font = "9.5px Consolas,monospace"; ctx.fillStyle = CV.rgba("textDim", .6);
  for (let v = 1; v <= 4; v++) {
    const y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(v + "s", pad.l - 5, y + 3);
  }
  /* SLO 阈值 */
  ctx.strokeStyle = CV.rgba("warn", .5); ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(pad.l, Y(2.5)); ctx.lineTo(w - pad.r, Y(2.5)); ctx.stroke();
  ctx.setLineDash([]);

  const grad = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
  grad.addColorStop(0, CV.rgba("violet", .25)); grad.addColorStop(1, CV.rgba("violet", .02));
  ctx.beginPath();
  arr.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(0), Y(v)));
  ctx.lineTo(X(arr.length - 1), h - pad.b); ctx.lineTo(X(0), h - pad.b); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  ctx.beginPath();
  arr.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(0), Y(v)));
  ctx.strokeStyle = CV.rgba("violet", .95); ctx.lineWidth = 1.5;
  ctx.shadowColor = CV.rgba("violet", .5); ctx.shadowBlur = 7; ctx.stroke(); ctx.shadowBlur = 0;

  const lv = arr[arr.length - 1];
  ctx.fillStyle = CV.color("textBright"); ctx.shadowColor = CV.color("violet"); ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.arc(X(arr.length - 1), Y(lv), 2.6, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
}

/* ══ 总览 ═════════════════════════════════════════════════ */
function renderKPIs() {
  const D = AXON_DATA, k = D.kpi;
  const items = [
    { l: "在管服务器", v: D.servers.length, u: "台",
      d: D.servers.some(x => x.state === "warn") ? "1 硬件预警" : "硬件全部正常",
      dc: D.servers.some(x => x.state === "warn") ? "down" : "up", c: "var(--l-server)" },
    { l: "在管 Agent", v: k.agents, u: "个", d: "+1 本周", dc: "up", c: "var(--l-agent)" },
    { l: "活跃任务", v: k.liveTasks, u: "个", d: "实时", dc: "flat", c: "var(--l-task)" },
    { l: "沙箱实例", v: k.sandboxes, u: "个", d: "14 预热", dc: "flat", c: "var(--l-infra)" },
    { l: "24h Token", v: k.token24h.toFixed(2), u: "亿", d: "+6.2%", dc: "up", c: "var(--cyan)" },
    { l: "单位任务成本", v: "¥" + k.costPerTask.toFixed(2), u: "", d: "-0.8% 环比", dc: "up", c: "var(--ok)" },
    { l: "任务成功率", v: k.successRate.toFixed(1) + "%", u: "", d: "验收口径", dc: "flat", c: "var(--ok)" },
    { l: "资产纳管完整率", v: k.coverage.toFixed(1) + "%", u: "", d: "1 对象待补录", dc: "down", c: "var(--l-server)" },
  ];
  $("#kpi-grid").innerHTML = items.map(i => `
    <div class="kpi" style="--kc:${i.c}">
      <div class="kpi-label">${i.l}</div>
      <div class="kpi-val">${i.v}<small>${i.u}</small></div>
      <div class="kpi-delta ${i.dc}">${i.d}</div>
    </div>`).join("");
}

function renderLayerHealth() {
  const D = AXON_DATA;
  const rows = [
    { name: "服务器与系统", color: LAYER_META[0].color, count: D.servers.length,
      sub: `${D.servers.filter(s => s.state === "ok").length} 正常 · ${D.servers.filter(s => s.state !== "ok").length} 预警`, warn: D.servers.some(s => s.state !== "ok"), view: "assets", tab: "infra" },
    { name: "Agent Infra", color: LAYER_META[1].color, count: D.infra.length + D.models.length + D.tools.length,
      sub: `${D.infra.length} 服务 · ${D.models.length} 端点 · ${D.tools.length} 工具`, view: "assets", tab: "infra" },
    { name: "Agent", color: LAYER_META[3].color, count: D.agents.length,
      sub: `${D.agents.reduce((a, x) => a + x.inst, 0)} 实例 · ${D.agents.filter(a => a.state === "gray").length} 灰度中 · ${D.agents.filter(a => a.state === "retired").length} 已退役`, view: "assets", tab: "agents" },
    { name: "任务与会话", color: LAYER_META[4].color, count: D.kpi.liveTasks,
      sub: "2 等待审批 · 1 待核对", warn: true, view: "tasks", tab: null },
  ];
  $("#layer-health").innerHTML = rows.map((r, i) => `
    <div class="layer-row" data-i="${i}">
      <div>
        <div class="layer-name" style="color:${r.color}"><i style="background:${r.color}"></i>${r.name}</div>
        <div class="layer-sub">${r.sub}</div>
      </div>
      <div></div>
      <div class="layer-count" style="color:${r.color}">${r.count}</div>
    </div>`).join("");
  $$("#layer-health .layer-row").forEach(row => {
    row.addEventListener("click", () => {
      const r = rows[+row.dataset.i];
      AXON.nav(r.view);
      if (r.tab) { AXON.assetsTab = r.tab; }
    });
  });
}

function renderQuick() {
  const cards = [
    { t: "服务器视角 · Agent 承载", code: "FR-02", view: "servers", act: "drawer",
      p: "从服务器出发：硬件部件、传感器，以及该服务器承载的 Infra 服务、Agent 与在途任务全链路。" },
    { t: "跨层影响分析", code: "FR-02", view: "topo", act: "impact",
      p: "从服务器故障面出发，反推受影响的 Infra 服务、Agent 与在途任务，区分可中断与不可中断。" },
    { t: "任务感知维护编排", code: "S06", view: "maint", act: null,
      p: "带影响清单的计划维护：准入限制、任务排空、检查点保存、执行维护与恢复验证全流程。" },
    { t: "配额与执行策略", code: "FR-08", view: "gov", act: null,
      p: "租户 Token / 沙箱并发配额、越权阻断、凭据撤销与工具副作用治理。" },
  ];
  $("#quick-grid").innerHTML = cards.map((c, i) => `
    <div class="quick-card" data-i="${i}">
      <span class="qc-code">${c.code}</span>
      <h3>${c.t}</h3><p>${c.p}</p><span class="qc-go">进入演练 →</span>
    </div>`).join("");
  $$("#quick-grid .quick-card").forEach(card => {
    card.addEventListener("click", () => {
      const c = cards[+card.dataset.i];
      AXON.nav(c.view);
      if (c.act === "impact") setTimeout(() => AXON.impact.setImpactMode(true, "srv-cpu-01"), 60);
      if (c.act === "drawer") setTimeout(() => AXON.emit("server-detail", "srv-cpu-01"), 60);
    });
  });
}

function renderAlertStrip() {
  const strip = $("#alert-strip");
  const D = AXON_DATA;
  $("#alert-count").textContent = D.alerts.length;
  strip.hidden = D.alerts.length === 0;
  strip.innerHTML = `<i class="led led-warn"></i><b style="font-family:var(--mono)">活动告警 ${D.alerts.length}</b>
    <ul>${D.alerts.map((a, i) => `<li data-i="${i}"><i class="led led-warn"></i>${esc(a.msg)}</li>`).join("")}</ul>
    <button class="btn tiny ghost" style="margin-left:auto" id="goto-maint">处理磁盘告警</button>`;
  $$("#alert-strip li").forEach(li => li.addEventListener("click", () => {
    const a = D.alerts[+li.dataset.i];
    AXON.nav(a.view);
    if (a.src === "T26-0731") setTimeout(() => AXON.emit("task-detail", "T26-0731"), 80);
  }));
  $("#goto-maint").addEventListener("click", () => { AXON.nav("maint"); AXON.emit("maint-prefill", "srv-cpu-01"); });
}

function renderFeed(item) {
  const feed = $("#evt-feed");
  if (!feed) return;
  const div = el("div", "evt-item", `
    <span class="evt-time">${item.ts}</span>
    <span class="evt-tag badge ${item.cls}">${item.tag}</span>
    <span class="evt-msg">${item.msg}</span>`);
  feed.prepend(div);
  while (feed.children.length > AXON.evtMax) feed.lastChild.remove();
}

AXON.pushEvent = ((orig) => function (tag, cls, msg, all) {
  orig(tag, cls, msg, all);
  AXON.feed.unshift({ ts: hhmm(), tag, cls, msg });
  AXON.feed = AXON.feed.slice(0, AXON.evtMax);
  renderFeed(AXON.feed[0]);
})(AXON.pushEvent);

function renderOverview() {
  renderKPIs(); renderLayerHealth(); renderAlertStrip(); renderQuick();
  const feed = $("#evt-feed");
  if (feed && !feed.children.length) {
    AXON.feed.slice(0, 8).forEach((item, i) => {
      const div = el("div", "evt-item", `
        <span class="evt-time">${item.ts}</span>
        <span class="evt-tag badge ${item.cls}">${item.tag}</span>
        <span class="evt-msg">${item.msg}</span>`);
      div.style.animation = "none";
      feed.prepend(div);
    });
  }
  drawThroughput(); drawTokenBars(); drawLatency();
}

/* ══ 服务器管理（首屏主视角）══════════════════════════════ */
const RACK_U = 11, RACK_UNITS = 42;

function renderServersTab() {
  const tab = AXON.serversTab;
  $$("#servers-tabs .subtab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $("#servers-list-wrap").hidden = tab !== "list";
  $("#servers-floor-wrap").hidden = tab !== "floor";
  $("#servers-3d-wrap").hidden = tab !== "3d";
  $("#servers-rack-wrap").hidden = tab !== "rack";
  $("#servers-net-wrap").hidden = tab !== "net";
  if (tab === "floor") renderFloor();
  if (tab === "rack") renderRacks();
  if (tab === "net") AXON.emit("servers-tab-net");
  if (tab === "3d") AXON.emit("servers-tab-3d");
}
$$("#servers-tabs .subtab").forEach(t => t.addEventListener("click", () => {
  AXON.serversTab = t.dataset.tab;
  renderServersTab();
}));

function rackDevBlock(m) {
  const ref = m.ref, [u0, u1] = ref.location.u;
  const h = (u1 - u0 + 1) * RACK_U - 2;
  const bottom = (u0 - 1) * RACK_U + 1;
  const kindCls = m.kind === "server" ? "server" : (ref.kind === "bmc" ? "bmc" : "net");
  const short = m.kind === "server" ? ref.name.replace(" · ", " ") : (ref.short || ref.name);
  const led = ref.state === "warn" ? '<i class="led led-warn rd-led"></i>' : '<i class="led led-ok rd-led"></i>';
  const sub = m.kind === "server"
    ? `U${u0}–${u1} · ${esc(ref.role)}`
    : `U${u0} · ${esc(ref.role)}`;
  return `<div class="rack-dev ${kindCls}" style="bottom:${bottom}px;height:${h}px" data-kind="${m.kind}" data-id="${ref.id}">
    <span class="rd-name">${led}${esc(short)}</span><span class="rd-sub">${sub}</span>
  </div>`;
}

function renderRacks() {
  const D = AXON_DATA;
  $("#servers-rack-wrap").innerHTML = `
    <div class="panel">
      <div class="dc-breadcrumb">机房拓扑：<b>华东-1 · A 栋</b> — A2 机房 — 03 列 A 排（R01 网络 · R02/R03 知识库 · R04 GPU · R05 通用/存储 · R06 审计存证）· 双路 PDU 供电 · 冷热通道封闭</div>
      <div class="rack-grid">${D.racks.map(rackColumnHtml).join("")}</div>
      <div class="rack-note">
        图例：<i style="background:var(--l-server)"></i>服务器
        <i style="background:var(--l-catalog)"></i>网络设备（核心 / ToR）
        <i style="background:var(--violet)"></i>带外管理
        · 悬停高亮 · 点击打开资产详情 · 空白 U 位可扩容
      </div>
    </div>`;
  $$("#servers-rack-wrap .rack-dev").forEach(d => d.addEventListener("click", () => {
    const id = d.dataset.id, kind = d.dataset.kind;
    if (kind === "server") openServerDrawer(id);
    else {
      const n = AXON_DATA.find(id);
      AXON.toast(n.name, `${esc(n.model)} · ${esc(n.role)} · 管理口 ${esc(n.mgmt)} · ${esc(n.location.rack)} U${n.location.u[0]}`, "info", 4200);
    }
  }));
}

function rackMembers() {
  const D = AXON_DATA;
  return [
    ...D.servers.map(s => ({ kind: "server", ref: s })),
    ...D.netDevices.map(n => ({ kind: "net", ref: n })),
  ];
}

function rackStats(rackId) {
  const devs = rackMembers().filter(m => m.ref.location.rack === rackId);
  const usedU = devs.reduce((a, m) => a + (m.ref.location.u[1] - m.ref.location.u[0] + 1), 0);
  const hasWarn = devs.some(m => m.ref.state === "warn");
  return { devs, usedU, hasWarn };
}

/* 单个机柜的 U 位立柱（机柜部署 / 平面图下钻共用） */
function rackColumnHtml(rk) {
  const { devs, usedU } = rackStats(rk.id);
  const marks = [1, 6, 12, 18, 24, 30, 36, 42].map(u =>
    `<span class="rack-u-mark" style="bottom:${(u - 1) * RACK_U + 3}px">${u}</span>`).join("");
  return `<div class="rack">
    <div class="rack-head">
      <div class="rh-name">${esc(rk.name)}</div>
      <div class="rh-sub">${esc(rk.room)} · 已用 ${usedU}U / ${RACK_UNITS}U</div>
      <div class="rh-note">${esc(rk.note)}</div>
    </div>
    <div class="rack-frame">
      <div class="rack-pdu"><span>PDU-A</span></div>
      <div class="rack-body">${marks}${devs
        .sort((a, b) => a.ref.location.u[0] - b.ref.location.u[0])
        .map(rackDevBlock).join("")}</div>
      <div class="rack-pdu"><span>PDU-B</span></div>
    </div>
  </div>`;
}

/* ══ 平面布局（机房俯视图 + 机柜下钻）══════════════════ */
function renderFloor() {
  const D = AXON_DATA, F = D.dcFloor;
  const W = 1440, H = 480, RW = 168, RD = 72;
  const rowY = { A: 96, B: 290 };
  const xs = (i) => 128 + i * 181;
  const managed = new Set(D.racks.map(r => r.id));
  const totalRacks = F.rows.reduce((a, r) => a + r.racks.length, 0);
  const sel = AXON.floorRack && managed.has(AXON.floorRack) ? AXON.floorRack : "R04";

  const els = [];
  /* 文字裁剪兜底：无论数据多长都不允许溢出机柜框 */
  els.push(`<defs>${[...managed].map(rid =>
    `<clipPath id="fpc-${rid}"><rect x="1" y="1" width="${RW - 2}" height="${RD - 2}" rx="4"/></clipPath>`).join("")}</defs>`);
  els.push(`<rect x="14" y="14" width="${W - 28}" height="${H - 28}" class="fp-room" rx="8"/>`);
  [[26, 100], [26, 216], [26, 332], [1390, 190]].forEach(([cx, cy]) =>
    els.push(`<g class="fp-crac"><rect x="${cx}" y="${cy}" width="32" height="72" rx="3"/><text x="${cx + 16}" y="${cy + 40}">CRAC</text></g>`));
  els.push(`<g class="fp-door"><rect x="86" y="${H - 28}" width="64" height="10"/><text x="118" y="${H - 34}">入口</text></g>`);
  els.push(`<g class="fp-aisle"><rect x="118" y="186" width="1174" height="86" rx="4"/><text x="${W / 2}" y="234">冷通道 · COLD AISLE（封闭）</text></g>`);
  els.push(`<text class="fp-hot" x="${W / 2}" y="56">热通道 · HOT AISLE</text>`);
  els.push(`<text class="fp-hot" x="${W / 2}" y="408">热通道 · HOT AISLE</text>`);

  F.rows.forEach(row => {
    els.push(`<text class="fp-rowlabel" transform="translate(88 ${rowY[row.id] + RD / 2}) rotate(-90)" text-anchor="middle">${esc(row.label)}</text>`);
    row.racks.forEach((rid, i) => {
      const x = xs(i), y = rowY[row.id];
      if (managed.has(rid)) {
        const rk = D.racks.find(r => r.id === rid);
        const { devs, usedU, hasWarn } = rackStats(rid);
        const nSrv = devs.filter(m => m.kind === "server").length;
        const nNet = devs.length - nSrv;
        const devList = devs.map(m => m.ref.name).join(" / ");
        els.push(`<g class="fp-rack managed ${rid === sel ? "sel" : ""}" data-rack="${rid}" transform="translate(${x},${y})">
          <title>${rid} · ${esc(rk.note)}｜已用 ${usedU}U / ${RACK_UNITS}U｜${nSrv}×服务器 + ${nNet}×网络设备｜${esc(devList)}</title>
          <rect class="fp-rack-rect" width="${RW}" height="${RD}" rx="4"/>
          <g clip-path="url(#fpc-${rid})">
            <circle class="fp-led ${hasWarn ? "warn" : "ok"}" cx="14" cy="19" r="4.5"/>
            <text class="fp-rack-name" x="26" y="24">${rid}</text>
            <text class="fp-rack-unit" x="${RW - 10}" y="24" text-anchor="end">${usedU}U / ${RACK_UNITS}U</text>
            <text class="fp-rack-note" x="10" y="43">${esc(rk.note)}</text>
            <text class="fp-rack-sub" x="10" y="60">${nSrv}×服务器 + ${nNet}×网络设备</text>
          </g>
          <line class="fp-front" x1="4" y1="${RD}" x2="${RW - 4}" y2="${RD}"/>
        </g>`);
      } else {
        els.push(`<g class="fp-rack unmanaged" data-rack="${rid}" transform="translate(${x},${y})">
          <rect class="fp-rack-rect" width="${RW}" height="${RD}" rx="4"/>
          <text class="fp-rack-name" x="${RW / 2}" y="40" text-anchor="middle">${rid}</text>
          <text class="fp-rack-sub" x="${RW / 2}" y="56" text-anchor="middle">未纳管</text>
          <line class="fp-front" x1="4" y1="${RD}" x2="${RW - 4}" y2="${RD}"/>
        </g>`);
      }
    });
  });

  $("#servers-floor-wrap").innerHTML = `
    <div class="panel">
      <div class="dc-breadcrumb">华东-1 · A 栋 — <b>A2 机房</b>（22×12 m · ${totalRacks} 柜，纳管 ${managed.size} 柜）— 冷热通道封闭 · 精密空调 ×4 · 悬停机柜看清单 · 点击机柜查看 U 位</div>
      <div class="fp-layout">
        <svg viewBox="0 0 ${W} ${H}" class="fp-svg" id="fp-svg">${els.join("")}</svg>
        <aside class="fp-detail" id="fp-detail"></aside>
      </div>
      <div class="rack-note">
        图例：<i style="background:var(--cyan)"></i>已纳管机柜（青色描边 + 绿灯/预警灯）
        <i style="background:rgba(90,120,170,.5)"></i>未纳管 ·
        <i style="background:var(--ok);width:8px;height:8px;border-radius:50%"></i>正常 / 预警灯 · 绿色粗线 = 机柜正面（朝冷通道）
      </div>
    </div>`;
  renderFloorDetail(sel);
  $$("#fp-svg .fp-rack").forEach(g => g.addEventListener("click", () => {
    const rid = g.dataset.rack;
    if (!managed.has(rid)) { AXON.toast("机柜未纳管", `${rid} 不在当前管理范围（示例：纳管 03 列 A 排 R01–R06，B 排预留扩容）`, "warn", 3600); return; }
    renderFloorDetail(rid);
  }));
}

function renderFloorDetail(rid) {
  AXON.floorRack = rid;
  $$("#fp-svg .fp-rack").forEach(g => g.classList.toggle("sel", g.dataset.rack === rid));
  const rk = AXON_DATA.racks.find(r => r.id === rid);
  const detail = $("#fp-detail");
  detail.innerHTML = rackColumnHtml(rk);
  $$("#fp-detail .rack-dev").forEach(d => d.addEventListener("click", () => {
    if (d.dataset.kind === "server") openServerDrawer(d.dataset.id);
    else {
      const n = AXON_DATA.find(d.dataset.id);
      AXON.toast(n.name, `${esc(n.model)} · ${esc(n.role)} · 管理口 ${esc(n.mgmt)}`, "info", 4200);
    }
  }));
}

function meterCell(pct) {
  const cls = pct > 85 ? "warn" : "";
  return `<div class="meter-cell"><div class="prog ${cls}"><i style="width:${pct}%"></i></div><span class="mv">${pct}%</span></div>`;
}

function serverCellHtml(s, f) {
  const wl = AXON_DATA.workload(s.id);
  if (f === "health") return s.state === "warn"
    ? `<div class="state-cell"><i class="led led-warn"></i>预警</div><div class="dim" style="font-size:10.5px">${esc(s.warnNote || "")}</div>`
    : `<div class="state-cell"><i class="led led-ok"></i>正常</div>`;
  if (f === "load") return `<div class="srv-load">
        <div class="l1"><span>服务 <b>${wl.svc.length}</b></span><span>Agent <b>${wl.agents.length}</b></span><span>任务 <b>${wl.tasks.length}</b></span>
          ${wl.nonInt.length ? `<span class="badge crit">不可中断 ${wl.nonInt.length}</span>` : ""}</div>
        <div class="l2">${wl.agents.map(a => esc(a.name.replace(" Agent", ""))).slice(0, 4).join(" · ") || "—"}${wl.agents.length > 4 ? " …" : ""}</div>
      </div>`;
  return null;
}

function serverRowHtml(s) {
  const wl = AXON_DATA.workload(s.id);
  const health = s.state === "warn"
    ? `<div class="state-cell"><i class="led led-warn"></i>预警</div><div class="dim" style="font-size:10.5px">${esc(s.warnNote || "")}</div>`
    : `<div class="state-cell"><i class="led led-ok"></i>正常</div>`;
  return `<tr data-id="${s.id}">
      <td><div class="srv-node-name">${esc(s.name)}</div>
          <div class="srv-node-sub" style="font-family:var(--mono)">${esc(s.asset)} · ${esc(s.location.rack)} U${s.location.u[0]}–${s.location.u[1]} · BMC ${esc(s.bmc)}</div></td>
      <td class="dim">${esc(s.role)}<div class="dim" style="font-size:10.5px;font-family:var(--mono)">${esc(s.model.split(" · ")[0])}</div></td>
      <td data-f="health">${health}</td>
      <td class="w-meter" data-f="cpu">${meterCell(s.cpu)}</td>
      <td class="w-meter" data-f="mem">${meterCell(s.mem)}</td>
      <td class="w-meter" data-f="gpu">${s.gpu ? meterCell(s.gpu) : '<span class="dim">—</span>'}</td>
      <td class="dim mono" style="font-size:11px" data-f="env"><div><span data-f="pt">${esc(s.power)} · ${s.temp}℃</span><div class="dim" style="font-size:10px">风扇 <span data-f="fan">${s.fan}%</span></div></div></td>
      <td data-f="load"><div class="srv-load">
        <div class="l1"><span>服务 <b>${wl.svc.length}</b></span><span>Agent <b>${wl.agents.length}</b></span><span>任务 <b>${wl.tasks.length}</b></span>
          ${wl.nonInt.length ? `<span class="badge crit">不可中断 ${wl.nonInt.length}</span>` : ""}</div>
        <div class="l2">${wl.agents.map(a => esc(a.name.replace(" Agent", ""))).slice(0, 4).join(" · ") || "—"}${wl.agents.length > 4 ? " …" : ""}</div>
      </div></td>
      <td><div style="display:flex;gap:6px">
        <button class="btn tiny ghost" data-act="impact" data-id="${s.id}">影响</button>
        <button class="btn tiny ${s.state === "warn" ? "" : "ghost"}" data-act="maint" data-id="${s.id}">维护</button>
      </div></td>
    </tr>`;
}

/* tick 时原地更新数值（不替换 DOM 节点），避免打断交互 */
function updateServerMeters() {
  AXON_DATA.servers.forEach(s => {
    const tr = document.querySelector(`#srv-tbody tr[data-id="${s.id}"]`);
    if (!tr) return;
    const setMeter = (f, pct) => {
      const td = tr.querySelector(`[data-f="${f}"]`);
      if (!td) return;
      const bar = td.querySelector(".prog > i"), mv = td.querySelector(".mv");
      if (bar) bar.style.width = pct + "%";
      if (mv) mv.textContent = pct + "%";
    };
    setMeter("cpu", s.cpu); setMeter("mem", s.mem);
    if (s.gpu) setMeter("gpu", s.gpu);
    const pt = tr.querySelector('[data-f="pt"]'), fan = tr.querySelector('[data-f="fan"]');
    if (pt) pt.textContent = `${s.power} · ${s.temp}℃`;
    if (fan) fan.textContent = `${s.fan}%`;
    /* 健康 / 承载摘要仅在内容变化时整体替换 */
    const health = serverCellHtml(s, "health"), load = serverCellHtml(s, "load");
    const hTd = tr.querySelector('[data-f="health"]'), lTd = tr.querySelector('[data-f="load"]');
    if (hTd && hTd.innerHTML !== health) hTd.innerHTML = health;
    if (lTd && lTd.innerHTML !== load) lTd.innerHTML = load;
  });
}

function renderServers() {
  const D = AXON_DATA;
  $("#srv-count").textContent = `在管节点 ${D.servers.length} · 全部在线`;
  $("#srv-tbody").innerHTML = D.servers.map(serverRowHtml).join("");
  $$("#srv-tbody tr[data-id]").forEach(tr => tr.addEventListener("click", () => openServerDrawer(tr.dataset.id)));
  $$("#srv-tbody [data-act]").forEach(b => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = b.dataset.id;
    if (b.dataset.act === "impact") { AXON.nav("topo"); setTimeout(() => AXON.impact.setImpactMode(true, id), 80); }
    if (b.dataset.act === "maint") { AXON.nav("maint"); AXON.emit("maint-prefill", id); }
  }));
}

function updateServerMeters() {
  AXON_DATA.servers.forEach(s => {
    const tr = document.querySelector(`#srv-tbody tr[data-id="${s.id}"]`);
    if (!tr) return;
    ["health", "cpu", "mem", "gpu", "env", "load"].forEach(f => {
      const td = tr.querySelector(`[data-f="${f}"]`);
      const html = serverCellHtml(s, f);
      if (td && html !== null && td.innerHTML !== html) td.innerHTML = html;
    });
  });
}

function openServerDrawer(id) {
  const s = AXON_DATA.find(id);
  if (!s) return;
  const wl = AXON_DATA.workload(id);
  const slotChips = s.slots.map(sl =>
    `<span class="slot-chip ${sl.state === "warn" ? "warn" : ""}" title="${esc(sl.note || "")}">
       槽位 ${sl.no}<span class="st">${sl.state === "warn" ? "SMART 预警" : "正常"}</span></span>`).join("");
  AXON.openDrawer(s.name, (body) => {
    body.innerHTML = `
      <div class="side-sec"><h4>资产与固件</h4><dl class="kv">
        <dt>资产编号</dt><dd>${esc(s.asset)}</dd>
        <dt>型号</dt><dd class="plain">${esc(s.model)}</dd>
        <dt>角色</dt><dd class="plain">${esc(s.role)}</dd>
        <dt>BMC</dt><dd>${esc(s.bmc)} · 带外在线</dd>
        <dt>BIOS / BMC</dt><dd>${esc(s.bios)} / ${esc(s.bmcFw)}</dd>
        <dt>机柜位置</dt><dd class="plain">${esc(s.location.room)} ${esc(s.location.row)} · ${esc(s.location.rack)} U${s.location.u[0]}–${s.location.u[1]}</dd>
        <dt>运行时长</dt><dd>${esc(s.uptime)}</dd>
        <dt>状态</dt><dd>${s.state === "warn" ? '<span class="badge warn">硬件预警</span>' : '<span class="badge ok">正常</span>'}</dd>
      </dl>
      ${s.warnNote ? `<p style="font-size:11.5px;color:var(--warn);margin-top:8px">⚑ ${esc(s.warnNote)}</p>` : ""}</div>

      <div class="side-sec"><h4>网络接入</h4>
        ${(s.nics || []).map(n => `<div class="hw-row"><span class="hw-n">${esc(n.port)}</span>
          <span class="hw-d mono" style="font-family:var(--mono);font-size:11px">→ ${esc(n.to)} · ${esc(n.vlan)}</span>
          <span class="hw-s"><span class="badge ${n.speed.includes("G") && n.speed !== "1G" ? "info" : "dim"}">${esc(n.speed)}</span></span></div>`).join("")}
        <p style="font-size:10.5px;color:var(--text-faint);margin-top:8px;line-height:1.7">业务口双上联 ToR（ECMP），BMC 独立带外网络 · 详见「网络拓扑」子页</p>
      </div>

      <div class="side-sec"><h4>传感器与负载</h4><dl class="kv">
        <dt>功耗 / 温度</dt><dd>${esc(s.power)} · ${s.temp}℃</dd>
        <dt>风扇</dt><dd>${s.fan}%</dd>
      </dl>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
        <div class="meter-cell"><span class="mv" style="width:36px">CPU</span><div class="prog"><i style="width:${s.cpu}%"></i></div><span class="mv">${s.cpu}%</span></div>
        <div class="meter-cell"><span class="mv" style="width:36px">内存</span><div class="prog"><i style="width:${s.mem}%"></i></div><span class="mv">${s.mem}%</span></div>
        ${s.gpu ? `<div class="meter-cell"><span class="mv" style="width:36px">GPU</span><div class="prog"><i style="width:${s.gpu}%"></i></div><span class="mv">${s.gpu}%</span></div>` : ""}
      </div></div>

      <div class="side-sec"><h4>硬件部件</h4>
        ${s.parts.map(([n, d, st]) => `<div class="hw-row"><span class="hw-n">${esc(n)}</span>
          <span class="hw-d">${esc(d)}</span>
          <span class="hw-s">${st === "ok" ? '<i class="led led-ok"></i>' : '<i class="led led-warn"></i>'}</span></div>`).join("")}
        <div style="margin-top:10px">${slotChips}</div>
      </div>

      <div class="side-sec"><h4>Agent 工作负载承载</h4>
        <p style="font-size:11px;color:var(--text-faint);margin-bottom:10px;line-height:1.7">该服务器承载的基础设施 → 依赖它们的 Agent → 在途任务。服务器侧的任何变更，影响面从这里出发。</p>
        <div class="chain-lane">
          <div class="cl-head"><span>承载的 Infra 服务</span><b>${wl.svc.length}</b></div>
          <div>${wl.svc.map(x => `<span class="dep-chip">${esc(x.name)}</span>`).join("")}</div>
        </div>
        <div class="chain-arrow">▼ 依赖</div>
        <div class="chain-lane">
          <div class="cl-head"><span>承载的 Agent</span><b>${wl.agents.length}</b></div>
          <div>${wl.agents.map(a => `<span class="dep-chip">${esc(a.name.replace(" Agent", ""))} · ${a.inst} 实例</span>`).join("")}</div>
        </div>
        <div class="chain-arrow">▼ 执行</div>
        <div class="chain-lane">
          <div class="cl-head"><span>在途任务</span><b>${wl.tasks.length}${wl.nonInt.length ? ` · 不可中断 ${wl.nonInt.length}` : ""}</b></div>
          <div>${wl.tasks.slice(0, 6).map(t => `<span class="dep-chip" data-task="${t.id}">${t.id} · ${Math.round(t.progress)}%</span>`).join("") || '<span class="badge dim">无</span>'}</div>
          ${wl.tasks.length > 6 ? `<div style="font-size:10.5px;color:var(--text-faint);margin-top:4px">另有 ${wl.tasks.length - 6} 个任务</div>` : ""}
        </div>
      </div>

      <div class="side-sec"><h4>服务器操作</h4><div class="drawer-actions">
        <button class="btn" id="sv-maint">进入维护编排</button>
        <button class="btn ghost" id="sv-impact">影响分析</button>
        <button class="btn ghost" id="sv-rack">机柜视图</button>
        <button class="btn ghost" id="sv-net">网络拓扑</button>
        <button class="btn ghost" id="sv-power">功耗策略</button>
        <button class="btn ghost" id="sv-led">LED 定位</button>
        <button class="btn danger" id="sv-poweroff">上下电</button>
      </div></div>`;

    $$("#drawer [data-task]").forEach(ch => ch.addEventListener("click", () => { AXON.closeDrawer(); AXON.nav("tasks"); AXON.emit("task-detail", ch.dataset.task); }));
    $("#sv-maint", body).onclick = () => { AXON.closeDrawer(); AXON.nav("maint"); AXON.emit("maint-prefill", id); };
    $("#sv-impact", body).onclick = () => { AXON.closeDrawer(); AXON.nav("topo"); setTimeout(() => AXON.impact.setImpactMode(true, id), 80); };
    $("#sv-rack", body).onclick = () => { AXON.closeDrawer(); AXON.serversTab = "rack"; AXON.nav("servers"); renderServersTab(); };
    $("#sv-net", body).onclick = () => { AXON.closeDrawer(); AXON.serversTab = "net"; AXON.nav("servers"); renderServersTab(); };
    $("#sv-power", body).onclick = () => AXON.toast("功耗策略", `${s.name} 已切换至「性能均衡」模式 · 预计节能 8%`, "ok");
    $("#sv-led", body).onclick = () => AXON.toast("LED 定位", `${s.name} 机箱定位灯已点亮 120 秒`, "info");
    $("#sv-poweroff", body).onclick = () => AXON.confirm({
      title: "服务器上下电",
      html: `该操作将经 BMC 对 <b>${esc(s.name)}</b> 执行安全下电。当前有 <b>${wl.tasks.length} 个在途任务</b>承载于该服务器，请先完成维护编排（排空/暂存）。`,
      okText: "仍要下电", danger: true,
      onOk: () => AXON.toast("指令已下发", "已进入 BMC 安全下电队列 · 等待任务排空确认", "warn"),
    });
  });
}
AXON.on("server-detail", (id) => openServerDrawer(id));

/* ══ 资产目录 ═════════════════════════════════════════════ */
const KIND_LABEL = { runtime: "运行时", sandbox: "沙箱", gateway: "网关", state: "状态服务", identity: "身份" };
const KIND_COLOR = { runtime: "#37e2ff", sandbox: "#2ef0a8", gateway: "#6f9bff", state: "#b18cff", identity: "#ffb340" };
function syncKindColor() {
  KIND_COLOR.runtime = CV.hex("l1"); KIND_COLOR.sandbox = CV.hex("ok"); KIND_COLOR.gateway = CV.hex("l0");
  KIND_COLOR.state = CV.hex("violet"); KIND_COLOR.identity = CV.hex("warn");
}
syncKindColor();
AXON.on("theme", syncKindColor);

/* ══ 沙箱实例管理（对标 OpenSandbox · SPEC §2.9/§6.1）══════ */
const SBX_STATE_CLS = { WARM: "dim", BOUND: "ok", PAUSED: "info", "GC-PENDING": "warn", TERMINATED: "dim" };

function sbxYaml(x) {
  return `apiVersion: axon.infra/v1
kind: Sandbox
metadata:
  name: ${x.id}
spec:
  cluster: ${x.cluster}
  template: ${x.template}
  resources: { vcpu: ${x.res.includes("8C") ? 8 : 4}, memG: ${x.res.includes("16G") ? 16 : 8} }
  netPolicy:
    egress: ${x.egress.includes("白名单") ? "allowlist" : "none"}
    cidrs: ["10.32.0.0/16"]${x.egress.includes("GitHub") ? '  # + github.com' : ""}
  lease: { ttlMin: ${x.leaseMin == null ? "null" : Math.round(x.leaseMin)}, renewable: ${!!x.renewable} }
  desiredState: ${x.desired}
status:
  currentState: ${x.state}
  ownerTask: ${x.ownerTask || "null"}
  conditions:
    - { type: Ready, status: "${x.state === "BOUND" ? "True" : "Unknown"}" }
    - { type: LeaseValid, status: "${x.leaseMin > 0 ? "True" : x.leaseMin === 0 ? "False" : "Unknown"}" }`;
}

function sbxLeaseText(x) {
  if (x.leaseMin == null) return '<span class="dim">—</span>';
  if (x.leaseMin <= 0) return '<span style="color:var(--crit)">已到期</span>';
  const m = Math.floor(x.leaseMin);
  return `<span class="${x.leaseMin < 15 ? "lease-warn" : "dim"} mono" style="font-family:var(--mono)">${m} min</span>`;
}

function renderSbx() {
  const D = AXON_DATA;
  const list = D.sandboxInstances;
  const cnt = (s) => list.filter(x => x.state === s).length;
  const drift = list.filter(x => x.state !== x.desired && x.desired !== "TERMINATED");
  const gc = list.filter(x => x.state === "GC-PENDING");

  $("#assets-body").innerHTML = `
    <div class="panel" style="padding:14px 16px">
      <div class="sbx-toolbar">
        <span class="sbx-stat">预热 WARM <b>${cnt("WARM")}</b></span>
        <span class="sbx-stat">绑定 BOUND <b>${cnt("BOUND")}</b></span>
        <span class="sbx-stat">已暂停 <b>${cnt("PAUSED")}</b></span>
        <span class="sbx-stat">待回收 <b>${gc.length}</b></span>
        <span class="sbx-stat ${drift.length ? "drift" : ""}">状态漂移 <b>${drift.length}</b></span>
        <span style="flex:1"></span>
        <span class="panel-note">对标 OpenSandbox Lifecycle · SPEC §2.9</span>
        <button class="btn tiny" id="sbx-warm">补充预热池 +2</button>
        <button class="btn tiny ghost" id="sbx-gc">GC 扫描</button>
        <button class="btn tiny ${drift.length ? "danger" : "ghost"}" id="sbx-reconcile" ${drift.length ? "" : "disabled"}>执行对账（${drift.length}）</button>
      </div>
      <table class="tbl"><thead><tr>
        <th>实例</th><th>期望状态</th><th>当前状态</th><th>归属</th><th>租约</th><th>资源</th><th>出口策略</th><th>操作</th>
      </tr></thead><tbody>
      ${list.map(x => {
        const isDrift = x.state !== x.desired && x.desired !== "TERMINATED";
        const protectedGc = x.state === "GC-PENDING" && x.note.includes("受保护");
        return `<tr style="cursor:default">
          <td class="mono" style="color:var(--cyan)">${x.id}
            ${x.note ? `<div class="dim" style="font-size:10.5px;max-width:230px">${esc(x.note)}</div>` : ""}</td>
          <td class="mono dim sbx-state">${x.desired}</td>
          <td><span class="badge ${SBX_STATE_CLS[x.state] || "dim"}">${x.state}</span>
            ${isDrift ? '<span class="badge crit" style="margin-left:4px">漂移</span>' : ""}</td>
          <td>${x.ownerTask
            ? `<span class="dep-chip" data-task="${x.ownerTask}">${x.ownerTask}</span>
               <div class="dim mono" style="font-size:10px;font-family:var(--mono)">${esc(x.tenant || "")}</div>`
            : `<span class="dim">${esc(x.ownerNote || "—")}</span>`}</td>
          <td data-lease="${x.id}">${sbxLeaseText(x)}</td>
          <td class="mono dim">${x.res}</td>
          <td class="dim" style="font-size:11px">${esc(x.egress)}</td>
          <td><div style="display:flex;gap:5px;flex-wrap:wrap">
            ${x.state === "BOUND" ? `<button class="btn tiny ghost" data-sbx="pause" data-id="${x.id}">暂停</button>
                <button class="btn tiny ghost" data-sbx="snap" data-id="${x.id}">快照</button>
                <button class="btn tiny ghost" data-sbx="renew" data-id="${x.id}">续订</button>` : ""}
            ${x.state === "PAUSED" && !isDrift ? `<button class="btn tiny ok" data-sbx="resume" data-id="${x.id}">恢复</button>` : ""}
            ${isDrift ? `<button class="btn tiny danger" data-sbx="reconcile-one" data-id="${x.id}">调谐</button>` : ""}
            ${x.state === "GC-PENDING" && !protectedGc ? `<button class="btn tiny danger" data-sbx="gc-one" data-id="${x.id}">回收</button>` : ""}
            ${protectedGc ? '<span class="badge info">受保护</span>' : ""}
            <button class="btn tiny ghost" data-sbx="yaml" data-id="${x.id}">YAML</button>
          </div></td>
        </tr>`;
      }).join("")}
      </tbody></table>
      <p style="font-size:11px;color:var(--text-faint);margin-top:10px;line-height:1.8">
        期望/实际双列对齐 agent-sandbox CRD 语义；GC 遵循 S05：待审批与结果待核对任务的实例受保护；租约到期不自动回收，进入 GC-PENDING 人工确认。</p>
    </div>`;

  $$("#assets-body [data-task]").forEach(ch => ch.addEventListener("click", () => {
    AXON.nav("tasks"); AXON.emit("task-detail", ch.dataset.task);
  }));
  $$("#assets-body [data-sbx]").forEach(b => b.addEventListener("click", () => {
    const x = D.sandboxInstances.find(i => i.id === b.dataset.id);
    const act = b.dataset.sbx;
    if (act === "yaml") return AXON.yamlView(`Sandbox · ${x.id}`, sbxYaml(x));
    if (act === "pause") {
      AXON.runOp("沙箱", x.id, `暂停 · 关联任务 ${x.ownerTask}`);
      x.desired = "PAUSED"; x.state = "PAUSED";
      AXON.pushEvent("沙箱", "info", `<b>${x.id}</b> 暂停（应用检查点已保存）· 归属 <b>${x.ownerTask}</b>`);
    }
    if (act === "snap") AXON.runOp("沙箱", x.id, "文件快照");
    if (act === "renew") { x.leaseMin += 30; AXON.runOp("沙箱", x.id, "租约续订 +30min"); }
    if (act === "resume") {
      x.desired = "BOUND"; x.leaseMin = 45; x.renewable = true;
      AXON.runOp("沙箱", x.id, `恢复执行 · 重建环境`, { onVerified: () => { x.state = "BOUND"; renderSbx(); } });
      AXON.pushEvent("恢复", "info", `<b>${x.id}</b> 恢复 · 环境重建 + 授权重检`);
    }
    if (act === "reconcile-one" || act === "gc-one") {
      AXON.runOp(act === "gc-one" ? "回收" : "对账", x.id, act === "gc-one" ? "实例回收" : `调谐 ${x.state} → ${x.desired}`, {
        onVerified: () => {
          if (act === "gc-one") {
            D.sandboxInstances = D.sandboxInstances.filter(i => i.id !== x.id);
            AXON.pushEvent("沙箱", "ok", `<b>${x.id}</b> 已回收 · 产物按保留策略归档`);
          } else {
            x.state = x.desired; x.leaseMin = x.leaseMin ?? 45;
            x.note = "已调谐收敛 · 期望 = 实际";
            AXON.pushEvent("对账", "ok", `<b>${x.id}</b> 调谐收敛 ${x.desired} · 期望=实际`);
          }
          AXON_DATA.syncSbxCounters();
          renderSbx();
        },
      });
    }
    renderSbx();
  }));
  const warmBtn = $("#sbx-warm");
  if (warmBtn) warmBtn.onclick = () => {
    const base = Math.max(...D.sandboxInstances.map(i => +i.id.slice(4))) + 1;
    for (let k = 0; k < 2; k++) D.sandboxInstances.push({
      id: "sbx-" + (base + k), cluster: "sb-e2b", template: "ubuntu-24-nocode-c4",
      state: "WARM", desired: "WARM", ownerTask: null, ownerNote: "预热池", tenant: null,
      leaseMin: null, res: "4C/8G", egress: "白名单 10.32.0.0/16",
    });
    AXON_DATA.syncSbxCounters();
    AXON.runOp("沙箱", "sb-e2b", "预热池补充 +2（模板校验通过）");
    renderSbx();
  };
  const gcBtn = $("#sbx-gc");
  if (gcBtn) gcBtn.onclick = () => {
    const pend = D.sandboxInstances.filter(i => i.state === "GC-PENDING");
    if (!pend.length) return AXON.toast("GC 扫描完成", "未发现可回收实例", "ok");
    pend.forEach(x => {
      if (x.note.includes("受保护")) {
        AXON.pushEvent("沙箱", "warn", `GC：<b>${x.id}</b> 受保护跳过 · 关联任务结果待核对（S12）`);
      } else {
        AXON.runOp("回收", x.id, "孤立实例回收", {
          onVerified: () => {
            D.sandboxInstances = D.sandboxInstances.filter(i => i.id !== x.id);
            AXON_DATA.syncSbxCounters();
            renderSbx();
          },
        });
      }
    });
    AXON.toast("GC 扫描完成", `发现 ${pend.length} 个待回收实例 · 受保护实例已跳过`, "warn", 3600);
  };
  const recBtn = $("#sbx-reconcile");
  if (recBtn) recBtn.onclick = () => {
    drift.forEach(x => $(`[data-sbx="reconcile-one"][data-id="${x.id}"]`)?.click());
  };
}

function updateSbxLeases() {
  AXON_DATA.sandboxInstances.forEach(x => {
    const td = document.querySelector(`#assets-body [data-lease="${x.id}"]`);
    if (td) td.innerHTML = sbxLeaseText(x);
  });
}

function renderAssets() {
  $$("#assets-tabs .subtab").forEach(t => t.classList.toggle("active", t.dataset.tab === AXON.assetsTab));
  const body = $("#assets-body");
  const D = AXON_DATA;

  if (AXON.assetsTab === "agents") {
    body.innerHTML = `<div class="agent-cards">${D.agents.map(a => {
      const t = D.tenants.find(x => x.id === a.tenant) || {};
      const caps = a.caps;
      const capsN = Object.values(caps).filter(Boolean).length;
      return `<div class="panel agent-card" data-id="${a.id}">
        <div class="ac-head">
          <div class="ac-icon">${esc(a.name.slice(0, 2))}</div>
          <div><div class="ac-name">${esc(a.name)}</div>
            <div class="ac-meta">${esc(a.ver)} · ${esc(a.owner)}</div></div>
          <span class="ac-status badge ${a.state === "retired" ? "dim" : a.state === "gray" ? "warn" : "ok"}">${a.state === "retired" ? "已退役" : a.state === "gray" ? "灰度中" : "运行中"}</span>
        </div>
        <div class="ac-rows">
          <div class="ac-row"><b>租户</b><span>${esc(t.name || a.tenant)} · ${a.inst} 实例 · ${a.uptime99}</span></div>
          <div class="ac-row"><b>运行时</b><span>${esc((D.find(a.runtime) || {}).name || a.runtime)}</span></div>
          <div class="ac-row"><b>模型</b><span>${a.models.map(m => esc((D.find(m) || {}).name.split(" ")[0])).join(" / ")}</span></div>
          <div class="ac-row"><b>工具</b><span>${a.tools.map(m => esc((D.find(m) || {}).name.replace(" MCP", ""))).join(" · ") || "—"}</span></div>
        </div>
        <div class="ac-caps">
          <span class="badge ${caps.observe ? "ok" : "dim"}">观测</span>
          <span class="badge ${caps.traffic ? "ok" : "dim"}">流量</span>
          <span class="badge ${caps.instance ? "ok" : "dim"}">实例</span>
          <span class="badge ${caps.state ? "ok" : "dim"}">状态</span>
          <span class="badge ${caps.task ? "ok" : "dim"}">任务</span>
          <span class="badge dim" style="margin-left:auto">能力 ${capsN}/5</span>
        </div>
      </div>`;
    }).join("")}</div>`;
    $$("#assets-body .agent-card").forEach(c => c.addEventListener("click", () => openAgentDrawer(c.dataset.id)));

  } else if (AXON.assetsTab === "infra") {
    body.innerHTML = `<div class="infra-cards">${D.infra.map(f => {
      const host = D.find(f.host) || {};
      const stats = f.kind === "sandbox"
        ? `<div class="sbx-stats">
            <div class="sbx-stat"><div class="v" style="color:var(--ok)">${f.warm}</div><div class="l">预热 WARM</div></div>
            <div class="sbx-stat"><div class="v" style="color:var(--cyan)">${f.bound}</div><div class="l">绑定 BOUND</div></div>
            <div class="sbx-stat"><div class="v" style="color:var(--warn)">${f.paused}</div><div class="l">已暂停</div></div>
          </div>`
        : f.kind === "state"
          ? `<div class="prog" style="margin-top:10px"><i style="width:${f.usedPct}%"></i></div>
             <div style="font-size:10.5px;color:var(--text-faint);margin-top:5px;font-family:var(--mono)">已用 ${f.usedPct}% / ${esc(f.cap)} · 双副本</div>`
          : f.kind === "identity"
            ? `<div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">在管凭据 ${f.creds} 个 · 撤销传播延迟 &lt; 2s</div>`
            : `<div style="font-size:11.5px;color:var(--text-dim);margin-top:8px">QPS <b class="mono" style="font-family:var(--mono);color:var(--cyan)">${f.qps}</b> · ${f.routes ?? f.tools} ${f.kind === "gateway" ? "条路由" : "个工具"}</div>`;
      return `<div class="panel infra-card" data-id="${f.id}">
        <div class="if-head">
          <span class="if-kind" style="color:${KIND_COLOR[f.kind]};border:1px solid ${KIND_COLOR[f.kind]}55;background:${KIND_COLOR[f.kind]}12">${KIND_LABEL[f.kind]}</span>
          <div><div class="if-name">${esc(f.name)}</div>
            <div class="if-ver">${esc(f.ver)} · 承载于 <b>${esc(host.id)}</b></div></div>
          <span class="badge ok" style="margin-left:auto">健康</span>
        </div>
        <div style="font-size:11.5px;color:var(--text-dim);line-height:1.65">${esc(f.desc || "")}</div>
        ${stats}
      </div>`;
    }).join("")}</div>`;
    $$("#assets-body .infra-card").forEach(c => c.addEventListener("click", () => openInfraDrawer(c.dataset.id)));

  } else if (AXON.assetsTab === "sbx") {
    renderSbx();
  } else {
    body.innerHTML = `<div class="panel table-panel"><table class="tbl">
      <thead><tr><th>工具</th><th>版本</th><th>副作用</th><th>幂等</th><th>消费方</th><th>QPS</th><th>错误率</th><th>契约</th></tr></thead>
      <tbody>${D.tools.map(t => `<tr data-id="${t.id}">
        <td class="mono">${esc(t.name)}</td>
        <td class="mono dim">${esc(t.ver)}</td>
        <td>${t.effect === "external-write" ? '<span class="badge crit">外部写入</span>' : t.effect === "sandboxed" ? '<span class="badge info">沙箱内</span>' : '<span class="badge dim">只读</span>'}</td>
        <td>${t.idem ? '<span class="badge ok">支持</span>' : '<span class="badge crit">不支持</span>'}</td>
        <td class="dim">${t.consumers.map(c => esc((D.find(c) || {}).name.replace(" Agent", ""))).join(" · ")}</td>
        <td class="mono">${t.qps}</td>
        <td class="mono ${t.err > 2 ? "dim" : "dim"}" style="color:${t.err > 2 ? "var(--crit)" : "var(--text-dim)"}">${t.err}%</td>
        <td>${t.contract === "ok" ? '<span class="badge ok">正常</span>' : '<span class="badge warn">需注意</span>'}</td>
      </tr>`).join("")}</tbody></table></div>`;
    $$("#assets-body tbody tr").forEach(r => r.addEventListener("click", () => openToolDrawer(r.dataset.id)));
  }
}
$$("#assets-tabs .subtab").forEach(t => t.addEventListener("click", () => {
  AXON.assetsTab = t.dataset.tab; renderAssets();
}));

function openAgentDrawer(id) {
  const a = AXON_DATA.find(id);
  const D = AXON_DATA;
  const t = D.tenants.find(x => x.id === a.tenant) || {};
  AXON.openDrawer(a.name, (body) => {
    body.innerHTML = `
      <div class="side-sec"><h4>注册信息</h4><dl class="kv">
        <dt>Agent ID</dt><dd>${a.id}</dd>
        <dt>版本</dt><dd>${esc(a.ver)}</dd>
        <dt>负责人</dt><dd class="plain">${esc(a.owner)}</dd>
        <dt>租户</dt><dd class="plain">${esc(t.name || a.tenant)}（${esc(a.tenant)}）</dd>
        <dt>实例</dt><dd>${a.inst} 个 · ${a.uptime99} SLA</dd>
      </dl></div>
      <div class="side-sec"><h4>部署状态 <span style="color:var(--text-faint);letter-spacing:.05em">· 对标 kagent</span></h4><dl class="kv">
        <dt>期望 / 就绪</dt><dd>${a.desiredInst} / ${a.insts.filter(i => i.state === "Ready").length}${a.desiredInst > a.insts.filter(i => i.state === "Ready").length ? ' <span class="badge warn">扩容中</span>' : ""}</dd>
        <dt>灰度流量</dt><dd>${a.canaryPct}%${a.canaryPct > 0 && a.canaryPct < 100 ? " · 灰度发布中" : a.canaryPct >= 100 ? " · 全量" : ""}</dd>
        <dt>上一版本</dt><dd>${esc(a.prevVer)} · 回退保留 24h</dd>
      </dl>
      <div style="margin-top:10px;display:flex;flex-direction:column;gap:5px">
        ${a.insts.map(i => `<div class="hw-row"><span class="hw-d mono" style="font-family:var(--mono);font-size:11px">${i.id}</span>
          <span class="hw-d dim" style="flex:0 0 100px;font-family:var(--mono);font-size:10.5px">${i.host}</span>
          <span class="hw-s">${i.state === "Ready" ? '<i class="led led-ok"></i>Ready' : '<i class="led led-warn"></i>' + esc(i.state)}</span>
          <span class="hw-d dim" style="flex:0 0 34px;text-align:right;font-family:var(--mono);font-size:10px">${i.uptime}</span>
          ${i.note ? `<span class="hw-d" style="flex:0 0 auto;font-size:10px;color:var(--warn)">${esc(i.note)}</span>` : ""}</div>`).join("")}
      </div>
      <div style="margin-top:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text-faint)">灰度：</span>
        ${[0, 10, 50, 100].map(p => `<button class="btn tiny ${a.canaryPct === p ? "" : "ghost"}" data-canary="${p}">${p}%</button>`).join("")}
        <button class="btn tiny ghost" id="ag-rollback" style="margin-left:auto">回退上一版</button>
        <button class="btn tiny ghost" id="ag-yaml">YAML</button>
      </div></div>

      <div class="side-sec"><h4>依赖清单</h4>
        <div style="margin-bottom:8px;font-size:11px;color:var(--text-faint)">运行时</div>
        <div>${depChipHtml(a.runtime)}</div>
        <div style="margin:8px 0 4px;font-size:11px;color:var(--text-faint)">模型端点</div>
        <div>${a.models.map(depChipHtml).join("")}</div>
        <div style="margin:8px 0 4px;font-size:11px;color:var(--text-faint)">工具（MCP）</div>
        <div>${(a.tools.length ? a.tools : []).map(depChipHtml).join("") || '<span class="badge dim">无</span>'}</div>
        ${a.stores.length ? `<div style="margin:8px 0 4px;font-size:11px;color:var(--text-faint)">状态服务</div><div>${a.stores.map(depChipHtml).join("")}</div>` : ""}
      </div>
      <div class="side-sec"><h4>适配器能力声明</h4>
        <div class="caps-grid">
          ${[["observe", "发现与观测"], ["traffic", "流量与准入"], ["instance", "实例控制"], ["state", "状态控制"], ["task", "任务控制"]].map(([k, n]) =>
            `<div class="cap-tag ${a.caps[k] ? "on" : "off"}">${n}<span>${a.caps[k] ? "✓ 已接入" : "未支持"}</span></div>`).join("")}
        </div>
        <p style="font-size:11px;color:var(--text-faint);margin-top:8px;line-height:1.7">未支持的能力在界面中不会开放对应操作，避免承诺超出实际控制能力。</p>
      </div>
      <div class="side-sec"><h4>版本历史</h4><dl class="kv">
        <dt>${esc(a.ver)}</dt><dd class="plain">当前 · 灰度 ${a.state === "gray" ? "10% 流量" : "100%"}</dd>
        <dt>上一版</dt><dd class="plain">回退入口保留 · 兼容检查通过</dd>
      </dl></div>
      <div class="side-sec"><h4>操作</h4><div class="drawer-actions">
        <button class="btn" id="op-restart">重启实例</button>
        <button class="btn ghost" id="op-limit">流量限制</button>
        <button class="btn danger" id="op-retire">退役申请</button>
      </div></div>`;
    $$("#drawer [data-canary]").forEach(b => b.addEventListener("click", () => {
      const p = +b.dataset.canary;
      a.canaryPct = p;
      a.state = p > 0 && p < 100 ? "gray" : "running";
      AXON.runOp("灰度", a.id, `灰度流量调整 → ${p}%`);
      AXON.pushEvent("路由", "info", `<b>${a.id}</b> 灰度流量调整为 <b>${p}%</b>${p === 0 ? "（全量回切稳定版）" : ""}`);
      openAgentDrawer(id);
      if (AXON.view === "assets" && AXON.assetsTab === "agents") renderAssets();
    }));
    const rollbackBtn = $("#ag-rollback", body);
    if (rollbackBtn) rollbackBtn.onclick = () => AXON.confirm({
      title: "回退到上一版本",
      html: `将 <b>${esc(a.name)}</b> 从 ${esc(a.ver)} 回退至 <b>${esc(a.prevVer)}</b>。配置回退不自动撤销数据结构变更，在途任务按兼容策略继续。`,
      okText: "确认回退", danger: true,
      onOk: () => {
        const cur = a.ver;
        a.ver = a.prevVer; a.prevVer = cur; a.canaryPct = 0; a.state = "running";
        AXON.runOp("回退", a.id, `版本回退 ${cur} → ${a.ver}`);
        AXON.pushEvent("策略", "warn", `<b>${a.id}</b> 回退至 ${a.ver} · 关键用例验证通过，灰度恢复 100%`);
        openAgentDrawer(id);
        if (AXON.view === "assets" && AXON.assetsTab === "agents") renderAssets();
      },
    });
    const yamlBtn = $("#ag-yaml", body);
    if (yamlBtn) yamlBtn.onclick = () => AXON.yamlView(`AgentDeployment · ${a.id}`, `apiVersion: axon.infra/v1
kind: AgentDeployment
metadata:
  name: ${a.id}
spec:
  version: ${a.ver}
  instances: ${a.desiredInst}
  canary: { enabled: ${a.canaryPct > 0}, trafficPct: ${a.canaryPct} }
  deps:
    runtime: ${a.runtime}
    models: [${a.models.join(", ")}]
    tools: [${a.tools.join(", ") || "—"}]
    stores: [${a.stores.join(", ") || "—"}]
  rollback: { retention: 24h, prevVersion: ${a.prevVer} }
status:
  currentVersion: ${a.ver}
  readyInstances: ${a.insts.filter(i => i.state === "Ready").length}/${a.desiredInst}
  capsObserved: { observe: ${!!a.caps.observe}, traffic: ${!!a.caps.traffic}, instance: ${!!a.caps.instance}, state: ${!!a.caps.state}, task: ${!!a.caps.task} }`);
    $("#op-restart", body).onclick = () => {
      AXON.toast("操作已受理", `${a.name} 实例滚动重启 · 操作记录 OP-${Math.floor(rnd(3000, 9000))}`, "ok");
      AXON.pushEvent("策略", "info", `<b>${a.id}</b> 实例重启指令已下发（滚动 · 不中断在途任务）`);
    };
    $("#op-limit", body).onclick = () => AXON.toast("已开启限流", `${a.name} 新会话速率限制为 50%`, "warn", 3000);
    $("#op-retire", body).onclick = () => AXON.confirm({
      title: "发起退役流程",
      html: `将按退役编排执行：<b>限制新任务 → 处理在途任务 → 关闭入口 → 撤销凭据 → 归档</b>。共享工具与身份资源不会被删除。`,
      okText: "发起退役", danger: true,
      onOk: () => { AXON.toast("退役流程已创建", "编排单 RET-2211 已生成，等待在途任务清空。", "ok"); AXON.pushEvent("策略", "warn", `<b>${a.id}</b> 退役编排已创建（RET-2211）`); },
    });
  });
}

function depChipHtml(id) {
  const o = AXON_DATA.find(id);
  if (!o) return "";
  const name = (o.name || id).replace(" Agent", "");
  return `<span class="dep-chip">${esc(name)}</span>`;
}

function openInfraDrawer(id) {
  const f = AXON_DATA.find(id);
  const host = AXON_DATA.find(f.host) || {};
  const dependents = AXON_DATA.agents.filter(a => a.runtime === id || a.models.includes(id) || a.tools.includes(id) || a.stores.includes(id));
  AXON.openDrawer(f.name, (body) => {
    body.innerHTML = `
      <div class="side-sec"><h4>服务信息</h4><dl class="kv">
        <dt>服务 ID</dt><dd>${esc(f.id)}</dd>
        <dt>类型</dt><dd>${KIND_LABEL[f.kind]}</dd>
        <dt>版本</dt><dd>${esc(f.ver)}</dd>
        <dt>承载节点</dt><dd>${esc(host.id)}</dd>
        <dt>状态</dt><dd>健康</dd>
      </dl></div>
      <div class="side-sec"><h4>说明</h4><p style="font-size:12px;color:var(--text-dim);line-height:1.8">${esc(f.desc || "")}</p></div>
      <div class="side-sec"><h4>被依赖（${dependents.length}）</h4>
        <div>${dependents.map(a => depChipHtml(a.id)).join("") || '<span class="badge dim">无</span>'}</div></div>
      ${f.kind === "sandbox" ? `<div class="side-sec"><h4>沙箱操作</h4><div class="drawer-actions">
        <button class="btn" id="sb-warm">补充预热池</button>
        <button class="btn ghost" id="sb-gc">回收空闲实例</button>
        <button class="btn ghost" id="sb-snap">快照演练</button>
      </div></div>` : `<div class="side-sec"><h4>操作</h4><div class="drawer-actions">
        <button class="btn" id="if-scale">容量检查</button>
        <button class="btn ghost" id="if-ha">高可用演练</button>
      </div></div>`}`;
    const warm = $("#sb-warm", body), gc = $("#sb-gc", body), snap = $("#sb-snap", body);
    if (warm) warm.onclick = () => {
      const base = Math.max(...AXON_DATA.sandboxInstances.map(i => +i.id.slice(4))) + 1;
      AXON_DATA.sandboxInstances.push({
        id: "sbx-" + base, cluster: "sb-e2b", template: f.template || "ubuntu-24-nocode-c4",
        state: "WARM", desired: "WARM", ownerTask: null, ownerNote: "预热池", tenant: null,
        leaseMin: null, res: "4C/8G", egress: "白名单 10.32.0.0/16",
      });
      AXON_DATA.syncSbxCounters();
      AXON.runOp("沙箱", f.id, "预热池补充 +1（模板校验通过）");
      AXON.toast("预热池已补充", "新增 1 个兼容实例 · 模板校验通过", "ok");
      renderAssets();
    };
    if (gc) gc.onclick = () => {
      const victim = AXON_DATA.sandboxInstances.find(i => i.state === "GC-PENDING" && !i.note.includes("受保护"));
      if (victim) {
        AXON_DATA.sandboxInstances = AXON_DATA.sandboxInstances.filter(i => i.id !== victim.id);
        AXON_DATA.syncSbxCounters();
        AXON.runOp("回收", victim.id, "孤立实例回收");
        AXON.pushEvent("沙箱", "ok", "沙箱 GC 完成 · 回收孤立实例 <b>" + victim.id + "</b>（租约已过期）");
      } else {
        AXON.toast("GC 扫描完成", "无可回收实例（受保护实例除外）", "ok");
      }
      renderAssets();
    };
    if (snap) snap.onclick = () => AXON.toast("快照演练开始", "文件快照 + 内存快照各 1 例 · 验证恢复兼容性", "info");
    const scale = $("#if-scale", body), ha = $("#if-ha", body);
    if (scale) scale.onclick = () => AXON.toast("容量检查通过", `${f.name} 当前负载 ${Math.round(rnd(30, 60))}% · 无需扩容`, "ok");
    if (ha) ha.onclick = () => AXON.toast("高可用演练已排队", "将验证控制面断连时执行端策略缓存行为。", "info");
  });
}

function openToolDrawer(id) {
  const t = AXON_DATA.find(id);
  const consumers = t.consumers.map(c => (AXON_DATA.find(c) || {}).name);
  AXON.openDrawer(t.name, (body) => {
    body.innerHTML = `
      <div class="side-sec"><h4>接口信息</h4><dl class="kv">
        <dt>工具 ID</dt><dd>${esc(t.id)}</dd>
        <dt>版本</dt><dd>${esc(t.ver)}</dd>
        <dt>副作用</dt><dd>${{ "external-write": "外部写入", readonly: "只读", sandboxed: "沙箱内" }[t.effect]}</dd>
        <dt>幂等能力</dt><dd>${t.idem ? "支持幂等键" : "不支持（需人工核对）"}</dd>
        <dt>契约状态</dt><dd>${t.contract === "ok" ? "正常" : "需注意"}</dd>
        <dt>消费方</dt><dd class="plain">${esc(consumers.join(" · "))}</dd>
      </dl></div>
      <div class="side-sec"><h4>治理说明</h4>
        <p style="font-size:12px;color:var(--text-dim);line-height:1.8">${esc(t.note || "")}</p>
        ${!t.idem ? `<p style="font-size:12px;color:var(--warn);line-height:1.8;margin-top:8px">按 S12 策略：超时后任务进入「结果待核对」状态，不会自动重放，防止重复外部写入。</p>` : ""}
      </div>
      <div class="side-sec"><h4>操作</h4><div class="drawer-actions">
        <button class="btn" id="tl-test">发起契约测试</button>
        <button class="btn ghost" id="tl-ver">登记新版本</button>
      </div></div>`;
    $("#tl-test", body).onclick = () => AXON.toast("契约测试通过", `${t.name} ${t.ver} 参数与返回格式校验通过 · 依赖方兼容`, "ok");
    $("#tl-ver", body).onclick = () => AXON.toast("已创建版本变更单", "新旧接口将并存 · 按消费者逐步切换", "info");
  });
}

/* ══ 任务中心 ═════════════════════════════════════════════ */
function renderTaskChips() {
  const D = AXON_DATA;
  const states = [
    ["all", "全部", D.tasks.length],
    ["running", "运行中", D.tasks.filter(t => t.state === "running").length],
    ["waiting_approval", "等待审批", D.tasks.filter(t => t.state === "waiting_approval").length],
    ["checkpointed", "已暂存", D.tasks.filter(t => t.state === "checkpointed").length],
    ["recovering", "恢复中", D.tasks.filter(t => t.state === "recovering").length],
    ["unknown", "待核对", D.tasks.filter(t => t.state === "unknown").length],
  ];
  $("#task-chips").innerHTML = states.map(([k, n, c]) =>
    `<button class="chip ${AXON.taskFilter === k ? "active" : ""}" data-k="${k}">${n}<span class="n">${c}</span></button>`).join("");
  $$("#task-chips .chip").forEach(c => c.addEventListener("click", () => {
    AXON.taskFilter = c.dataset.k; renderTasks();
  }));
}

function renderTasks() {
  renderTaskChips();
  const D = AXON_DATA;
  let list = D.tasks;
  if (AXON.taskFilter !== "all") list = list.filter(t => t.state === AXON.taskFilter);
  const q = AXON.taskQuery.trim().toLowerCase();
  if (q) list = list.filter(t => (t.id + t.name + ((D.find(t.agent) || {}).name || "")).toLowerCase().includes(q));

  $("#task-tbody").innerHTML = list.map(t => {
    const a = D.find(t.agent) || {};
    const meta = TASK_META[t.state] || { txt: t.state, cls: "dim" };
    const waitCell = t.state === "waiting_approval" || t.state === "queued"
      ? `<span style="color:var(--warn)">等待 ${Math.round(t.waitMin || 0)} min</span>`
      : t.state === "checkpointed" ? `<span style="color:var(--cyan)">暂存 ${Math.round(t.waitMin || 0)} min</span>`
      : `${t.elapsed} min`;
    return `<tr data-id="${t.id}">
      <td><div class="mono" style="color:var(--cyan)">${t.id}</div><div class="dim" style="font-size:11px">${esc(t.name)}</div></td>
      <td class="dim">${esc(a.name || "")}</td>
      <td class="dim mono" style="font-size:11px">${esc(a.tenant || "")}</td>
      <td><div class="state-cell"><i class="led ${meta.cls === "ok" ? "led-ok" : meta.cls === "warn" ? "led-warn" : meta.cls === "crit" ? "led-crit" : "led-idle"}"></i>${meta.txt}</div></td>
      <td><div class="prog ${t.state === "running" ? "striped" : ""}"><i style="width:${t.progress}%"></i></div>
          <div class="dim mono" style="font-size:10px;margin-top:3px">${Math.round(t.progress)}%${t.interruptible ? "" : " · 不可中断"}</div></td>
      <td>${t.ckpt ? `<span class="mono dim" style="font-size:11px">${t.ckpt.id}</span>` : '<span class="dim">—</span>'}</td>
      <td class="mono dim">${t.tokensM}M</td>
      <td class="mono dim">¥${t.cost}</td>
      <td class="dim mono" style="font-size:11px">${waitCell}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="9" style="text-align:center;color:var(--text-faint);padding:30px">无匹配任务</td></tr>`;
  $$("#task-tbody tr[data-id]").forEach(r => r.addEventListener("click", () => openTaskDrawer(r.dataset.id)));
}
$("#task-search").addEventListener("input", (e) => { AXON.taskQuery = e.target.value; renderTasks(); });

function taskTimeline(t) {
  const ev = [];
  const push = (ts, msg, cls, note) => ev.push({ ts, msg, cls, note });
  push("—" , "任务创建 · 通过准入检查", "good");
  push(t.started === "—" ? "—" : t.started, `调度至 ${((AXON_DATA.find(t.agent) || {}).name || "")} · 开始执行`, "hot");
  if (t.ckpt) push(t.ckpt.ts, `写入检查点 <b class="mono" style="font-family:var(--mono)">${t.ckpt.id}</b> · ${esc(t.ckpt.mode)}`, "good", "计算状态与任务状态分离 · 落盘双副本确认");
  if (t.state === "waiting_approval") push(hhmm(), "进入人工审批等待 · 执行环境按检查点暂存", "warn2", t.waitReason);
  if (t.state === "checkpointed") push("08:02", "长时间等待 · 已释放计算资源（沙箱回收）", "info", "恢复时将重建环境并核对授权");
  if (t.state === "recovering") push("09:44", "执行实例异常终止 · 自检查点恢复", "bad", "旧执行者已隔离 · 存在副作用的外部操作待核对");
  if (t.state === "unknown") push("09:02", "工具调用超时 · 外部结果未知", "bad", "无幂等键 → 按策略不重放，进入人工核对队列（S12）");
  if (t.state === "succeeded") push("—", "任务完成 · 业务验收通过", "good");
  if (t.state === "running") push(hhmm(), `步骤执行中 · 进度 ${Math.round(t.progress)}%`, "hot");
  return ev;
}

function openTaskDrawer(id) {
  const t = AXON_DATA.find(id);
  if (!t) return;
  const a = AXON_DATA.find(t.agent) || {};
  const meta = TASK_META[t.state] || {};
  AXON.openDrawer(`${t.id} · ${t.name}`, (body) => {
    body.innerHTML = `
      <div class="side-sec"><h4>执行概要</h4><dl class="kv">
        <dt>Agent</dt><dd class="plain">${esc(a.name || "")}</dd>
        <dt>状态</dt><dd><span class="badge ${meta.cls}">${meta.txt}</span></dd>
        <dt>进度</dt><dd>${Math.round(t.progress)}%</dd>
        <dt>可中断</dt><dd>${t.interruptible ? "是" : "否"}</dd>
        <dt>Token / 成本</dt><dd>${t.tokensM}M / ¥${t.cost}</dd>
        <dt>启动 / 耗时</dt><dd>${t.started} / ${t.elapsed}min</dd>
      </dl>
      <div class="prog ${t.state === "running" ? "striped" : "warn"}" style="margin-top:12px"><i style="width:${t.progress}%"></i></div></div>

      ${t.ckpt ? `<div class="side-sec"><h4>检查点</h4><div class="ck-box">
        <div class="ck-head"><span style="font-family:var(--mono);color:var(--cyan)">${t.ckpt.id}</span>
          <span class="badge ok">版本兼容 ✓</span></div>
        <dl class="kv"><dt>保存模式</dt><dd class="plain">${esc(t.ckpt.mode)}</dd>
          <dt>写入时间</dt><dd>${t.ckpt.ts}</dd></dl>
        <p style="font-size:11px;color:var(--text-faint);margin-top:8px;line-height:1.7">恢复语义：应用检查点续跑；内存快照恢复后网络连接需重建。</p>
      </div></div>` : `<div class="side-sec"><h4>检查点</h4><span class="badge dim">未写入</span></div>`}

      <div class="side-sec"><h4>执行轨迹</h4><div class="timeline">
        ${taskTimeline(t).map(e => `<div class="tl-item ${e.cls}">
          <div class="tl-ts">${e.ts}</div>
          <div class="tl-msg">${e.msg}</div>
          ${e.note ? `<div class="tl-note">${esc(e.note)}</div>` : ""}
        </div>`).join("")}
      </div></div>

      <div class="side-sec"><h4>操作</h4><div class="drawer-actions">
        ${t.state === "waiting_approval" ? `<button class="btn ok" id="tk-approve">批准并继续</button>` : ""}
        ${t.state === "checkpointed" ? `<button class="btn ok" id="tk-resume">恢复执行</button>` : ""}
        ${t.state === "running" ? `<button class="btn ghost" id="tk-hold">保存检查点并暂存</button>` : ""}
        ${t.state === "unknown" ? `<button class="btn" id="tk-verify">发送结果核对请求</button><button class="btn ok" id="tk-confirm">人工确认已成功</button>` : ""}
        ${["succeeded"].includes(t.state) ? "" : `<button class="btn danger" id="tk-cancel">取消任务</button>`}
      </div>
      ${t.waitReason ? `<p style="font-size:11.5px;color:var(--warn);margin-top:10px;line-height:1.7">⚑ ${esc(t.waitReason)}</p>` : ""}
      </div>`;

    const approve = $("#tk-approve", body);
    if (approve) approve.onclick = () => {
      t.state = "running"; t.waitReason = null; t.waitMin = 0;
      AXON.toast("审批通过", `${t.id} 已继续执行 · 授权重检通过`, "ok");
      AXON.pushEvent("审批", "info", `<b>${t.id}</b> 审批通过 · 恢复执行（授权重检通过）`);
      renderTasks(); openTaskDrawer(id);
    };
    const resume = $("#tk-resume", body);
    if (resume) resume.onclick = () => {
      t.state = "recovering"; t.waitReason = "环境重建中 · 自检查点恢复";
      AXON.toast("恢复中", `${t.id} 正在自检查点 ${t.ckpt ? t.ckpt.id : ""} 恢复`, "info");
      AXON.pushEvent("恢复", "info", `<b>${t.id}</b> 自检查点恢复 · 环境重建 + 授权重检`);
      renderTasks();
      setTimeout(() => {
        t.state = "running"; t.waitReason = null;
        AXON.toast("恢复完成", `${t.id} 已继续执行 · 上下文完整`, "ok");
        AXON.pushEvent("恢复", "ok", `<b>${t.id}</b> 恢复完成 · 上下文与文件完整`);
        if (AXON.view === "tasks") renderTasks();
      }, 3000);
      openTaskDrawer(id);
    };
    const hold = $("#tk-hold", body);
    if (hold) hold.onclick = () => {
      t.state = "checkpointed"; t.waitMin = 0;
      t.ckpt = t.ckpt || { id: "cp-" + Math.random().toString(16).slice(2, 6), mode: "应用检查点", ts: hhmm(), compat: true };
      t.ckpt.ts = hhmm();
      AXON.toast("已暂存", `${t.id} 检查点已保存 · 计算资源释放`, "ok");
      AXON.pushEvent("检查点", "info", `<b>${t.id}</b> 保存检查点并释放计算资源`);
      renderTasks(); openTaskDrawer(id);
    };
    const verify = $("#tk-verify", body);
    if (verify) verify.onclick = () => AXON.toast("核对请求已发送", "正在查询 ERP 业务编号 · 30s 内返回结果", "info");
    const confirmB = $("#tk-confirm", body);
    if (confirmB) confirmB.onclick = () => {
      t.state = "succeeded"; t.progress = 100;
      AXON.toast("已确认", `${t.id} 外部结果核对成功 · 任务终态更新`, "ok");
      AXON.pushEvent("核对", "ok", `<b>${t.id}</b> 人工核对确认外部写入成功 · 无重复操作`);
      renderTasks(); openTaskDrawer(id);
    };
    const cancel = $("#tk-cancel", body);
    if (cancel) cancel.onclick = () => AXON.confirm({
      title: "取消任务",
      html: `取消后进行中的外部副作用操作<b>不会被撤销</b>（不可逆操作需下游系统处理）。确认取消 <b>${t.id}</b>？`,
      okText: "确认取消", danger: true,
      onOk: () => {
        t.state = "cancelled";
        AXON.toast("任务已取消", `${t.id} 已停止 · 产物按保留策略归档`, "warn");
        AXON.pushEvent("任务", "warn", `<b>${t.id}</b> 被人工取消 · 已通知负责人`);
        renderTasks();
      },
    });
  });
}
AXON.on("task-detail", (id) => openTaskDrawer(id));
AXON.on("task-resume", (id) => { openTaskDrawer(id); const b = $("#tk-resume"); if (b) b.click(); });
AXON.on("task-hold", (id) => { openTaskDrawer(id); const b = $("#tk-hold"); if (b) b.click(); });

/* ══ 治理配额 ═════════════════════════════════════════════ */
function barColor(pct) { return pct > 85 ? "var(--crit)" : pct > 70 ? "var(--warn)" : "var(--cyan)"; }

const OP_STAGE_NAMES = ["已受理", "已执行", "已验证"];
function renderOpsPanel() {
  const el = $("#gov-ops");
  if (!el) return;
  el.innerHTML = AXON.ops.slice(0, 8).map(op => `
    <div class="op-row">
      <span class="op-id">${op.opId}</span>
      <span class="op-desc"><b>${esc(op.kind)}</b> · ${esc(op.label)}<br>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text-faint)">${esc(op.target)} · ${op.ts}</span></span>
      <span class="op-stages">${OP_STAGE_NAMES.map((n, i) =>
        `<span class="op-stage ${i < op.stage ? "done" : i === op.stage ? "active" : ""}">${n}</span>`).join("")}</span>
    </div>`).join("") || '<span class="badge dim">暂无操作</span>';
}
AXON.on("ops-changed", () => { if (AXON.view === "gov") renderOpsPanel(); });

function renderGov() {
  const D = AXON_DATA;
  $("#gov-quota-grid").innerHTML = D.tenants.map(t => {
    const tp = Math.round(t.tokenUsed / t.tokenBudget * 100);
    const sp = Math.round(t.sandboxUsed / t.sandboxQuota * 100);
    return `<div class="panel quota-card">
      <div class="qc-head"><span class="qc-name">${esc(t.name)}</span><span class="qc-prio">${t.prio} · ${t.id}</span></div>
      <div class="qc-rows">
        <div class="qc-row"><div class="q-lbl"><span>Token 配额</span><span class="mono" style="color:${tp > 85 ? "var(--crit)" : "var(--text-dim)"}">${t.tokenUsed}M / ${t.tokenBudget}M</span></div>
          <div class="prog ${tp > 85 ? "warn" : ""}"><i style="width:${tp}%;background:linear-gradient(90deg,transparent,${barColor(tp)})"></i></div></div>
        <div class="qc-row"><div class="q-lbl"><span>沙箱并发</span><span class="mono">${t.sandboxUsed} / ${t.sandboxQuota}</span></div>
          <div class="prog ${sp > 85 ? "warn" : ""}"><i style="width:${sp}%;background:linear-gradient(90deg,transparent,${barColor(sp)})"></i></div></div>
        <div class="qc-row"><div class="q-lbl"><span>单任务步骤上限</span><span class="mono">${t.stepLimit} 步 · 重试 5 次</span></div>
          <div class="prog"><i style="width:${Math.min(100, t.stepLimit / 80 * 100)}%;background:linear-gradient(90deg,transparent,var(--violet))"></i></div></div>
      </div>
    </div>`;
  }).join("");

  /* 模型路由规则（对标 agentgateway · SPEC §7.1） */
  $("#gov-routes").innerHTML = `
    <table class="tbl route-tbl"><thead><tr>
      <th>规则</th><th>匹配</th><th>流量分担</th><th>Fallback</th><th>优先级</th>
    </tr></thead><tbody>
    ${D.routeRules.map(r => {
      const fwd = D.find(r.fwd) || {}, peer = r.peer ? (D.find(r.peer) || {}) : null;
      return `<tr style="cursor:default">
        <td class="mono" style="color:var(--cyan)">${r.id}<div class="dim" style="font-size:10.5px">${esc(r.name)}</div></td>
        <td class="dim" style="font-size:11.5px">${esc(r.match)}</td>
        <td>${peer
          ? `<div class="weight-ctrl">
              <span class="dim" style="font-size:10.5px">${esc(fwd.name.split(" ")[0])}</span>
              <button class="btn tiny ghost" data-w="${r.id}" data-d="-5">−</button><b>${r.weight}%</b><button class="btn tiny ghost" data-w="${r.id}" data-d="5">+</button>
              <span class="dim" style="font-size:10.5px">${esc(peer.name.split(" ")[0])} ${100 - r.weight}%</span>
            </div>`
          : `<span class="badge info">100% 专路</span>`}</td>
        <td class="dim" style="font-size:11px">${esc(r.fallback)}</td>
        <td class="mono dim">${r.prio}</td>
      </tr>`;
    }).join("")}
    </tbody></table>
    <p style="font-size:10.5px;color:var(--text-faint);margin-top:8px;line-height:1.7">
      不变量：同匹配组权重之和恒为 100；Fallback 切换前校验能力标签与数据边界，回切必须灰度。端点实时状态见上方卡片区。</p>`;
  $$("#gov-routes [data-w]").forEach(b => b.addEventListener("click", () => {
    const r = D.routeRules.find(x => x.id === b.dataset.w);
    const nw = clamp(r.weight + (+b.dataset.d), 0, 100);
    if (nw === r.weight) return;
    r.weight = nw;
    if (r.id === "rr-glm-default") { D.models[0].traffic = nw; D.models[1].traffic = 100 - nw; }
    AXON.runOp("路由", r.id, `权重调整 → ${r.fwd.split("-")[1].toUpperCase()} ${nw}%`);
    renderGov();
  }));

  /* 操作记录（opId 三段式 · SPEC §4.3） */
  renderOpsPanel();

  $("#gov-events").innerHTML = D.policyEvents.map(e => `
    <div class="evt-item"><span class="evt-time">${e.ts}</span>
      <span class="evt-tag badge ${e.cls}">${e.tag}</span>
      <span class="evt-msg">${e.msg}</span></div>`).join("");

  $("#gov-tools").innerHTML = D.tools.map(t => `
    <div class="tool-item">
      <div class="tl-head"><span class="tl-name mono" style="font-family:var(--mono)">${esc(t.name)}</span>
        ${t.contract === "ok" ? '<span class="badge ok">契约正常</span>' : '<span class="badge warn">契约注意</span>'}
        ${t.idem ? "" : '<span class="badge crit">无幂等</span>'}</div>
      <div class="tl-sub">${{ "external-write": "外部写入", readonly: "只读", sandboxed: "沙箱内" }[t.effect]} · ${esc(t.note)}</div>
    </div>`).join("");
}

$("#btn-fallback-drill").addEventListener("click", () => {
  const D = AXON_DATA;
  const [m0, m1] = D.models;
  m0.state = "standby"; m0.traffic = 0; m1.state = "ok"; m1.traffic = 100;
  D.routeRules.forEach(r => { if (r.peer) r.weight = 0; });   // rr-sec-only 合规专路不切换
  AXON.toast("Fallback 已切换", "主端点熔断演练：流量 100% 切换至备用端点 · 能力标签校验通过 · 安全风控合规专路不受影响", "warn", 4200);
  AXON.pushEvent("路由", "warn", "Fallback 演练：主端点模拟熔断 · 流量切换 <b>DeepSeek-V4</b>（能力校验通过，合规专路保持）");
  if (AXON.view === "gov") renderGov();
  setTimeout(() => {
    m0.state = "ok"; m0.traffic = 86; m1.state = "standby"; m1.traffic = 14;
    const def = D.routeRules.find(r => r.id === "rr-glm-default");
    const dev = D.routeRules.find(r => r.id === "rr-dev-dual");
    if (def) def.weight = 86;
    if (dev) dev.weight = 70;
    AXON.toast("已切回主端点", "回切前关键用例验证通过 · 灰度恢复中", "ok");
    AXON.pushEvent("路由", "ok", "Fallback 演练结束 · 流量回切主端点（灰度恢复）");
    if (AXON.view === "gov") renderGov();
  }, 8000);
});

/* ══ 视图生命周期 ═════════════════════════════════════════ */
AXON.on("view", (v) => {
  if (v === "servers") { renderServers(); renderServersTab(); }
  if (v === "overview") renderOverview();
  if (v === "assets") renderAssets();
  if (v === "tasks") renderTasks();
  if (v === "gov") renderGov();
});

AXON.on("tick", () => {
  if (AXON.view === "assets" && AXON.assetsTab === "sbx") updateSbxLeases();
  if (AXON.view === "servers") updateServerMeters();
  if (AXON.view === "overview") {
    renderKPIs();
    drawThroughput(); drawTokenBars(); drawLatency();
  }
  if (AXON.view === "tasks" && !document.querySelector("#drawer.open")) renderTasks();
  if (AXON.view === "gov") renderGov();
});

/* 首屏 */
renderServers();
renderServersTab();
renderOverview();
renderTasks();
window.addEventListener("resize", () => {
  if (AXON.view === "overview") { drawThroughput(); drawTokenBars(); drawLatency(); }
});
