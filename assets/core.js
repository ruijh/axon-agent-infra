/* ═══════════════════════════════════════════════════════════
   AXON · 核心引擎：启动 / 路由 / 时钟 / 模拟数据 tick / Toast
   ═══════════════════════════════════════════════════════════ */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const AXON = {
  view: "servers",
  serversTab: "list",
  taskFilter: "all",
  taskQuery: "",
  assetsTab: "agents",
  listeners: {},
  on(evt, fn) { (this.listeners[evt] = this.listeners[evt] || []).push(fn); },
  emit(evt, arg) { (this.listeners[evt] || []).forEach(fn => fn(arg)); },
};

/* ── 时间与格式 ─────────────────────────────────────────── */
const pad2 = n => String(n).padStart(2, "0");
const fmtClock = (d) => `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
const hhmm = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

/* ── Toast ──────────────────────────────────────────────── */
AXON.toast = function (title, body, type = "info", ms = 3400) {
  const box = $("#toasts");
  const t = el("div", `toast ${type}`,
    `<div class="t-title">${{ ok: "✓", warn: "▲", err: "✕", info: "◈" }[type] || "◈"} ${esc(title)}</div>` +
    (body ? `<div class="t-body">${body}</div>` : ""));
  box.appendChild(t);
  setTimeout(() => { t.classList.add("leaving"); setTimeout(() => t.remove(), 320); }, ms);
};

/* ── 模态确认 ────────────────────────────────────────────── */
AXON.confirm = function ({ title, html, okText = "确认", danger = false, onOk }) {
  const wrap = $("#modal-wrap"), m = $("#modal");
  m.innerHTML = `<h3>${esc(title)}</h3><p>${html}</p>
    <div class="m-actions">
      <button class="btn ghost" data-x>取消</button>
      <button class="btn ${danger ? "danger" : ""}" data-ok>${esc(okText)}</button>
    </div>`;
  wrap.hidden = false;
  const close = () => (wrap.hidden = true);
  $("[data-x]", m).onclick = close;
  $("[data-ok]", m).onclick = () => { close(); onOk && onOk(); };
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
};

/* ── YAML 查看器（声明式对象 · SPEC §6）────────────────── */
AXON.yamlView = function (title, text) {
  const wrap = $("#modal-wrap"), m = $("#modal");
  m.innerHTML = `<h3>${esc(title)}</h3><pre class="yaml-pre">${esc(text)}</pre>
    <div class="m-actions"><button class="btn ghost" data-x>关闭</button></div>`;
  wrap.hidden = false;
  $("[data-x]", m).onclick = () => (wrap.hidden = true);
  wrap.onclick = (e) => { if (e.target === wrap) wrap.hidden = true; };
};

/* ── 操作中心：opId 三段式（SPEC §4.3 accepted → executed → verified）── */
AXON.ops = [
  { opId: "OP-4821", kind: "沙箱", target: "sbx-8805", label: "租约续订 +30min", stage: 2, ts: "10:28" },
  { opId: "OP-4819", kind: "路由", target: "rr-glm-default", label: "权重调整 80 → 86", stage: 2, ts: "10:21" },
];
AXON._opSeq = 4822;
const OP_STAGES = ["已受理", "已执行", "已验证"];
AXON.runOp = function (kind, target, label, opts = {}) {
  const opId = "OP-" + (AXON._opSeq++);
  const op = { opId, kind, target, label, stage: 0, ts: hhmm() };
  AXON.ops.unshift(op);
  AXON.ops = AXON.ops.slice(0, 12);
  AXON.emit("ops-changed", op);
  const advance = (stage) => {
    op.stage = stage;
    AXON.emit("ops-changed", op);
  };
  setTimeout(() => advance(1), opts.execMs ?? 900);
  setTimeout(() => {
    advance(2);
    AXON.toast("操作已验证", `${opId} · ${esc(label)} <span style="opacity:.7">(${esc(target)})</span>`, "ok", 3000);
    if (opts.onVerified) opts.onVerified();
    if (opts.event !== false) {
      AXON.pushEvent("操作", "info", `<b>${opId}</b> ${esc(kind)} · ${esc(label)} · ${esc(target)} — 三段式完成（受理→执行→验证）`);
    }
  }, opts.verifyMs ?? 2300);
  return op;
};

/* ── 抽屉 ────────────────────────────────────────────────── */
AXON.openDrawer = function (title, buildFn) {
  $("#drawer-title").textContent = title;
  const body = $("#drawer-body");
  body.innerHTML = "";
  buildFn(body);
  $("#drawer").classList.add("open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#drawer-mask").hidden = false;
};
AXON.closeDrawer = function () {
  $("#drawer").classList.remove("open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#drawer-mask").hidden = true;
};

/* ── 路由 ────────────────────────────────────────────────── */
AXON.nav = function (view) {
  this.view = view;
  $$(".rail-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + view));
  this.emit("view", view);
  const stage = $("#stage");
  if (stage) stage.scrollTop = 0;
};
$$(".rail-btn").forEach(b => b.addEventListener("click", () => AXON.nav(b.dataset.view)));

/* ── 启动序列 ────────────────────────────────────────────── */
(function boot() {
  const log = $("#boot-log"), fill = $("#boot-fill");
  const g0 = AXON_DATA.buildGraph();
  const lines = [
    "建立控制面连接 <span class='ok'>OK</span>",
    `加载对象目录 · 12 类 / ${g0.nodes.length} 个对象 <span class='ok'>OK</span>`,
    `解析依赖关系 · ${g0.edges.length} 条边 <span class='ok'>OK</span>`,
    "接入遥测流 · 指标 / 追踪 / 事件 <span class='ok'>OK</span>",
    "同步策略与配额状态 <span class='ok'>OK</span>",
    "数据源：内置模拟引擎 · 非真实采集",
  ];
  const finish = () => {
    $("#boot").classList.add("done");
    $("#app").classList.add("ready");
    $("#app").setAttribute("aria-hidden", "false");
    setTimeout(() => $("#boot").remove(), 600);
  };
  if (REDUCED) { finish(); return; }
  let i = 0;
  const step = () => {
    if (i < lines.length) {
      log.appendChild(el("div", null, "> " + lines[i]));
      fill.style.width = ((i + 1) / lines.length * 100) + "%";
      i++;
      setTimeout(step, 170 + Math.random() * 110);
    } else setTimeout(finish, 300);
  };
  setTimeout(step, 240);
  $("#boot").addEventListener("click", finish);
})();

/* ── 时钟 ────────────────────────────────────────────────── */
setInterval(() => { $("#clock").textContent = fmtClock(new Date()); }, 1000);
$("#clock").textContent = fmtClock(new Date());

/* ── 抽屉/告警 全局事件 ──────────────────────────────────── */
$("#drawer-close").addEventListener("click", () => AXON.closeDrawer());
$("#drawer-mask").addEventListener("click", () => AXON.closeDrawer());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { AXON.closeDrawer(); $("#modal-wrap").hidden = true; } });
$("#alert-pill").addEventListener("click", () => AXON.nav("overview"));

/* ── 模拟数据引擎：每 2s 让平台“活着” ─────────────────────── */
AXON.tickCount = 0;
setInterval(() => {
  AXON.tickCount++;
  const D = AXON_DATA, k = D.kpi;

  // 推进运行中任务的进度
  D.tasks.forEach(t => {
    if (t.state === "running" && Math.random() < 0.65) {
      t.progress = clamp(t.progress + rnd(0.4, 2.2), 0, 99.5);
      t.tokensM = +(t.tokensM + rnd(0.001, 0.02)).toFixed(3);
      t.cost = Math.round(t.cost + rnd(0.1, 1.4));
    }
    if (t.state === "recovering" && Math.random() < 0.7) {
      t.progress = clamp(t.progress + rnd(0.3, 1.4), 0, 99.5);
    }
    if (t.state === "waiting_approval" || t.state === "queued") t.waitMin = (t.waitMin || 0) + 0.033;
  });

  // 指标随机漫步
  k.token24h = +(k.token24h + rnd(0.002, 0.012)).toFixed(3);
  k.liveTasks = D.tasks.filter(t => !["succeeded","failed","cancelled"].includes(t.state)).length;
  D.charts.latency.push(clamp(D.charts.latency[D.charts.latency.length - 1] + rnd(-0.18, 0.2), 1.2, 3.6));
  D.charts.latency.shift();
  D.models[0].p95 = D.charts.latency[D.charts.latency.length - 1].toFixed(1);
  D.models[0].tps = Math.round(clamp(D.models[0].tps + rnd(-25, 26), 800, 1100));
  D.infra.forEach(f => {
    if (f.kind === "gateway") f.qps = +(f.qps + rnd(-1.2, 1.3)).toFixed(1);
  });
  D.tenants.forEach(t => {
    if (Math.random() < 0.4) t.tokenUsed = Math.min(t.tokenBudget, +(t.tokenUsed + rnd(0.05, 0.5)).toFixed(1));
  });
  // 沙箱租约倒计时（BOUND 实例每 2s ≈ 1/30 分钟）
  (D.sandboxInstances || []).forEach(x => {
    if (x.state === "BOUND" && x.leaseMin > 0) x.leaseMin = Math.max(0, +(x.leaseMin - 0.033).toFixed(2));
  });
  D.servers.forEach(s => {
    s.cpu = Math.round(clamp(s.cpu + rnd(-3, 3), 12, 92));
    s.mem = Math.round(clamp(s.mem + rnd(-2, 2), 20, 90));
    if (s.gpu) s.gpu = Math.round(clamp(s.gpu + rnd(-4, 4), 30, 95));
    if (s.temp) s.temp = Math.round(clamp(s.temp + rnd(-1, 1), 35, 52));
    if (s.fan) s.fan = Math.round(clamp(s.fan + rnd(-2, 2), 25, 70));
  });

  // 偶发新事件
  const acEl = $("#alert-count");
  if (acEl) acEl.textContent = D.alerts.length;
  if (Math.random() < 0.22) {
    const pool = [
      { tag: "遥测", cls: "info", msg: "<b>ag-cs</b> 会话吞吐上升 +12%，P95 延迟稳定" },
      { tag: "沙箱", cls: "info", msg: "预热池补充 2 个 <b>ubuntu-24</b> 兼容实例，命中率 91%" },
      { tag: "检查点", cls: "info", msg: "<b>T26-0712</b> 写入检查点 cp-77c2 · 确认落盘" },
      { tag: "路由", cls: "info", msg: "模型网关健康探测正常 · 主端点延迟 P95 <b>{p95}s</b>" },
      { tag: "配额", cls: "warn", msg: "租户 <b>dev-tools</b> Token 使用达到 {pct}%" },
    ];
    const p = pool[Math.floor(Math.random() * pool.length)];
    const msg = p.msg
      .replace("{p95}", D.models[0].p95)
      .replace("{pct}", Math.round(D.tenants[1].tokenUsed / D.tenants[1].tokenBudget * 100) + "%");
    AXON.pushEvent(p.tag, p.cls, msg);
  }

  AXON.emit("tick");
}, 2000);

/* 事件流（总览 + 治理共用） */
AXON.evtMax = 30;
AXON.pushEvent = function (tag, cls, msg, feedAll) {
  const D = AXON_DATA;
  const item = { ts: hhmm(), tag, cls, msg };
  if (feedAll || ["阻断", "撤销", "限流", "配额", "核对", "准入", "策略"].includes(tag)) {
    D.policyEvents.unshift(item);
    D.policyEvents = D.policyEvents.slice(0, AXON.evtMax);
  }
  AXON.emit("event", item);
};

/* 状态栏对象计数 */
(function () {
  const g = AXON_DATA.buildGraph();
  $("#sb-objects").textContent = `对象 ${g.nodes.length} · 关系 ${g.edges.length}`;
})();
