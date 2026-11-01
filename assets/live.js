/* ═══════════════════════════════════════════════════════════
   AXON · 接入面 Live 视图（真实控制平面数据）
   ─────────────────────────────────────────────────────────
   前七个视图 = 内置模拟世界（data.js + tick 引擎）；
   本视图 = server/ 真实控制平面：REST + SSE + 状态机 + 能力门控。
   未运行服务端时给出启动指引，不影响演示模式。

   依赖 core.js 的 $ / $$ / el / esc / AXON.toast / AXON.confirm。
   ═══════════════════════════════════════════════════════════ */
(function () {
  const KEY_STORE = "axon_api_key";
  const LIVE = {
    connected: false, meta: null, key: localStorage.getItem(KEY_STORE) || "",
    sse: null, timers: [], evtItems: [],
  };
  window.AXON_LIVE = LIVE;

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", ...(LIVE.key ? { Authorization: `Bearer ${LIVE.key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, json };
  }

  const errText = (r) => r.json?.error ? `${r.json.error.code}：${r.json.error.message}` : `HTTP ${r.status}`;

  /* ── 状态徽标（与演示世界同语义）────────────────────── */
  const STATE_TXT = {
    running: ["运行中", "ok"], queued: ["排队中", "dim"], waiting_approval: ["等待审批", "warn"],
    checkpointed: ["已暂存", "info"], recovering: ["恢复中", "violet"], succeeded: ["已完成", "dim"],
    failed: ["失败", "crit"], cancelled: ["已取消", "dim"], unknown: ["结果待核对", "crit"],
    ok: ["正常", "ok"], warn: ["预警", "warn"], crit: ["严重", "crit"], maint: ["维护中", "info"],
  };
  const stateBadge = (s) => { const m = STATE_TXT[s] || [s, "dim"]; return `<span class="badge ${m[1]}">${m[0]}</span>`; };
  const capsBadges = (caps) => ["observe", "traffic", "instance", "state", "task"].map(k =>
    `<span class="caps-chip ${caps?.[k] ? "on" : "off"}" title="${k}">${k[0].toUpperCase()}</span>`).join(" ");
  const ago = (iso) => {
    if (!iso) return "—";
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    return s < 90 ? `${Math.round(s)}s 前` : s < 5400 ? `${Math.round(s / 60)}m 前` : "长期";
  };
  const hhmmssLocal = (iso) => iso ? iso.slice(11, 19) : "--:--:--";

  /* ── 连接面板 ─────────────────────────────────────────── */
  function renderConn() {
    const box = $("#live-conn");
    if (!box) return;
    box.innerHTML = LIVE.connected
      ? `<span class="badge ok"><i class="led led-ok"></i>控制平面已连接 · v${LIVE.meta?.version || "?"}</span>`
      : `<span class="badge crit"><i class="led led-crit"></i>控制平面未连接</span>`;
    box.innerHTML += `
      <input class="input live-key" id="live-key" type="password" placeholder="API Key（axk_…，cli setup 获取）"
        value="${esc(LIVE.key)}" style="width:240px">
      <button class="btn tiny" id="live-key-save">保存密钥</button>
      <button class="btn tiny ghost" id="live-refresh">重新检测</button>`;
    $("#live-key-save").onclick = () => {
      LIVE.key = $("#live-key").value.trim();
      localStorage.setItem(KEY_STORE, LIVE.key);
      AXON.toast("密钥已保存", "将以 Bearer 方式调用受保护接口", "ok");
      probe();
    };
    $("#live-refresh").onclick = probe;

    const hint = $("#live-hint");
    if (!LIVE.connected) {
      hint.hidden = false;
      hint.className = "alert-strip warn";
      hint.innerHTML = `<b>控制平面未运行。</b>在项目目录执行：
        <code>node server/index.mjs</code>（默认 8437 端口，同时提供本 UI 与 /api/v1），
        然后 <code>node cli.mjs setup</code> 获取 API Key 填入上方；
        再开一个终端 <code>node worker/worker.mjs</code> 启动接入演示 Agent，即可看到真实认领/审批/终态闭环。
        <span class="dim">前七个视图不受影响，仍为内置模拟数据。</span>`;
    } else if (LIVE.meta?.setupRequired) {
      hint.hidden = false;
      hint.className = "alert-strip warn";
      hint.innerHTML = `控制平面尚未初始化：执行 <code>node cli.mjs setup</code> 创建根密钥（或 <code>POST /api/v1/setup</code>）。`;
    } else if (!LIVE.key) {
      hint.hidden = false;
      hint.className = "alert-strip warn";
      hint.innerHTML = `已连接但未配置 API Key：只读公开接口可用，操作类接口将返回 401。请填入密钥。`;
    } else {
      hint.hidden = true;
    }
  }

  /* ── Agent 实况 ───────────────────────────────────────── */
  async function renderAgents() {
    const tb = $("#live-agents");
    if (!tb || !LIVE.connected) return;
    const r = await api("GET", "/api/v1/agents");
    if (!r.ok) return;
    const agents = r.json;
    tb.innerHTML = agents.map(a => `
      <tr>
        <td class="mono" style="color:var(--cyan)">${esc(a.id)}
          <div class="dim" style="font-size:10.5px">${esc(a.name)}${a.live ? ' · <span style="color:var(--green)">LIVE</span>' : ""}</div></td>
        <td>${a.admission === "draining" ? '<span class="badge warn">排空中</span>' : stateBadge(a.state)}</td>
        <td>${capsBadges(a.caps)}</td>
        <td class="dim mono" style="font-size:11px">${a.lastHeartbeat ? ago(a.lastHeartbeat) : "未接入"}</td>
      </tr>`).join("");
    renderCreateForm(agents);
  }

  /* ── 发起任务 ─────────────────────────────────────────── */
  function renderCreateForm(agents) {
    const box = $("#live-create");
    if (!box || box.dataset.built) return;
    box.dataset.built = "1";
    box.innerHTML = `
      <input class="input" id="lc-name" placeholder="任务名称" style="flex:1">
      <select class="input" id="lc-agent" style="width:150px">
        ${agents.map(a => `<option value="${esc(a.id)}">${esc(a.id)}</option>`).join("")}
      </select>
      <label class="lc-check"><input type="checkbox" id="lc-appr" checked> 需审批</label>
      <button class="btn" id="lc-go">创建（queued）</button>
      <p class="dim" style="font-size:10.5px;margin:8px 0 0">任务由平台创建后进入队列，由 <code>worker/worker.mjs</code> 认领执行（pull 模型）。</p>`;
    $("#lc-go").onclick = async () => {
      const name = $("#lc-name").value.trim();
      if (!name) return AXON.toast("请填写任务名称", "", "warn");
      const r = await api("POST", "/api/v1/tasks", {
        name, agent: $("#lc-agent").value, requiresApproval: $("#lc-appr").checked,
      });
      if (r.ok) {
        AXON.toast("任务已创建", `${r.json.id} · queued · 等待 ${esc(r.json.agent)} 认领`, "ok");
        $("#lc-name").value = "";
        renderTasks();
      } else AXON.toast("创建被拒", errText(r), "err", 5200);
    };
  }

  /* ── 任务实况（状态机操作）───────────────────────────── */
  let lastTasksJson = "";
  async function renderTasks() {
    const tb = $("#live-tasks");
    if (!tb || !LIVE.connected) return;
    if (!$("#modal-wrap").hidden) return;   // 确认弹窗打开时不重渲染，避免误触
    const r = await api("GET", "/api/v1/tasks");
    if (!r.ok) return;
    const sig = JSON.stringify(r.json);
    if (sig === lastTasksJson) return;     // 数据未变化不重绘（防点击被重渲染打断）
    lastTasksJson = sig;
    const tasks = r.json;
    tb.innerHTML = tasks.map(t => {
      const btn = (label, cls, fn, title) =>
        `<button class="btn tiny ${cls}" data-act="${label}" data-t="${t.id}" title="${title || ""}">${label}</button>`;
      let actions = "";
      if (t.state === "waiting_approval") actions += btn("批准续跑", "", null, "授权重检（§5.2）");
      if (t.state === "running") actions += btn("检查点暂存", "ghost", null, "caps.state 门控") + btn("取消", "ghost danger", null, "不可中断任务需二次确认");
      if (t.state === "checkpointed") actions += btn("恢复执行", "", null, "兼容性检查后恢复");
      if (t.state === "unknown") actions += btn("人工核对通过", "", null, "S12 出口");
      if (["queued", "running", "waiting_approval", "checkpointed", "recovering", "unknown"].includes(t.state))
        actions += t.interruptible === false && t.state !== "queued" ? "" : (t.state !== "running" ? btn("取消", "ghost danger", null, "") : "");
      return `<tr>
        <td class="mono" style="color:var(--cyan)">${esc(t.id)}
          <div class="dim" style="font-size:10.5px">${esc(t.name)}${t.interruptible === false ? ' · <span style="color:var(--warn)">不可中断</span>' : ""}</div></td>
        <td class="dim mono" style="font-size:11px">${esc(t.agent || "—")}</td>
        <td>${stateBadge(t.state)}</td>
        <td><div class="prog"><i style="width:${t.progress}%;background:linear-gradient(90deg,transparent,var(--green))"></i></div></td>
        <td class="live-acts">${actions || '<span class="dim" style="font-size:11px">终态 · 无可用操作</span>'}</td>
      </tr>`;
    }).join("");
    $$("#live-tasks [data-act]").forEach(b => b.addEventListener("click", () => act(b.dataset.t, b.dataset.act)));
  }

  async function act(taskId, action) {
    if (action === "批准续跑") {
      AXON.confirm({
        title: `批准 ${taskId} 续跑`, html: "审批通过后任务恢复运行，<b>授权将重检</b>并记录审批人（§5.2）。",
        okText: "批准", onOk: async () => {
          const r = await api("POST", `/api/v1/tasks/${taskId}/approve`, { approvedBy: "Live 控制台" });
          r.ok ? AXON.toast("已批准续跑", `${taskId} → running`, "ok") : AXON.toast("操作被拒", errText(r), "err", 5200);
          renderTasks(); renderOps();
        },
      });
    } else if (action === "检查点暂存") {
      const r = await api("POST", `/api/v1/tasks/${taskId}/checkpoint`, {});
      r.ok ? AXON.toast("已暂存", `${taskId} 检查点保存 · 资源释放`, "ok")
           : AXON.toast("能力门控（451）", errText(r), "err", 5200);
      renderTasks();
    } else if (action === "恢复执行") {
      const r = await api("POST", `/api/v1/tasks/${taskId}/restore`, {});
      r.ok ? AXON.toast("恢复中", `${taskId} 自检查点恢复`, "ok") : AXON.toast("恢复被拒", errText(r), "err", 5200);
      renderTasks();
    } else if (action === "人工核对通过") {
      const r = await api("POST", `/api/v1/tasks/${taskId}/result`, { status: "succeeded", summary: "Live 控制台人工核对确认" });
      r.ok ? AXON.toast("核对完成", `${taskId} → succeeded`, "ok") : AXON.toast("操作被拒", errText(r), "err", 5200);
      renderTasks();
    } else if (action === "取消") {
      AXON.confirm({
        title: `取消 ${taskId}`, html: "任务产物将按保留策略归档。", okText: "确认取消", danger: true,
        onOk: async () => {
          let r = await api("POST", `/api/v1/tasks/${taskId}/cancel`, {});
          if (r.status === 412) {   // 不可中断 → 二次确认强推
            AXON.confirm({
              title: "不可中断任务", html: `${esc(errText(r))}<br><br>确认 <b>强推取消</b>？将产生审计记录。`,
              okText: "强推取消", danger: true,
              onOk: async () => {
                r = await api("POST", `/api/v1/tasks/${taskId}/cancel`, { force: true });
                r.ok ? AXON.toast("已强推取消", `${taskId} · 已审计`, "warn") : AXON.toast("取消被拒", errText(r), "err", 5200);
                renderTasks();
              },
            });
            return;
          }
          r.ok ? AXON.toast("已取消", taskId, "ok") : AXON.toast("取消被拒", errText(r), "err", 5200);
          renderTasks();
        },
      });
    }
  }

  /* ── 操作记录（三段式）────────────────────────────────── */
  let lastOpsJson = "";
  async function renderOps() {
    const box = $("#live-ops");
    if (!box || !LIVE.connected) return;
    const r = await api("GET", "/api/v1/ops?limit=12");
    if (!r.ok) return;
    const sig = JSON.stringify(r.json);
    if (sig === lastOpsJson) return;
    lastOpsJson = sig;
    const stage = { accepted: ["已受理", "warn"], executed: ["已执行", "info"], verified: ["已验证", "ok"], failed: ["失败", "crit"] };
    box.innerHTML = r.json.map(o => {
      const s = stage[o.status] || [o.status, "dim"];
      return `<div class="evt-item">
        <span class="evt-time mono">${o.opId}</span>
        <span class="evt-tag badge ${s[1]}">${s[0]}</span>
        <span class="evt-msg">${esc(o.label)} <span class="dim">· ${esc(o.target || "")}</span></span>
      </div>`;
    }).join("") || '<div class="evt-item dim">暂无操作记录</div>';
  }

  /* ── SSE 实时事件 ─────────────────────────────────────── */
  function pushFeed(item) {
    LIVE.evtItems.unshift(item);
    LIVE.evtItems = LIVE.evtItems.slice(0, 40);
    const box = $("#live-events");
    if (!box) return;
    box.innerHTML = LIVE.evtItems.map(e => `
      <div class="evt-item">
        <span class="evt-time">${e.ts}</span>
        <span class="evt-tag badge ${e.cls}">${e.tag}</span>
        <span class="evt-msg">${e.msg}</span>
      </div>`).join("");
  }

  function connectSse() {
    disconnectSse();
    const qs = LIVE.key ? `?key=${encodeURIComponent(LIVE.key)}` : "";
    try { LIVE.sse = new EventSource(`/api/v1/events/stream${qs}`); } catch { return; }
    LIVE.sse.onopen = () => { const d = $("#live-evt-dot"); if (d) d.hidden = false; };
    LIVE.sse.onerror = () => { const d = $("#live-evt-dot"); if (d) d.hidden = true; };
    LIVE.sse.addEventListener("policy", (ev) => {
      const d = JSON.parse(ev.data);
      pushFeed({ ts: hhmmssLocal(new Date().toISOString()), tag: "策略", cls: "warn", msg: esc(d.msg || d.subject || "policy") });
    });
    LIVE.sse.addEventListener("task", (ev) => {
      const d = JSON.parse(ev.data);
      pushFeed({ ts: hhmmssLocal(new Date().toISOString()), tag: "任务", cls: "ok", msg: `<b>${esc(d.id)}</b> → ${esc(d.state)}${d.progress != null ? " · " + d.progress + "%" : ""}` });
      renderTasks();
    });
    LIVE.sse.addEventListener("op", (ev) => {
      const d = JSON.parse(ev.data);
      pushFeed({ ts: hhmmssLocal(new Date().toISOString()), tag: "操作", cls: "info", msg: `<b>${esc(d.opId)}</b> ${esc(d.status)} · ${esc(d.label || "")}` });
      renderOps();
    });
  }
  function disconnectSse() { if (LIVE.sse) { LIVE.sse.close(); LIVE.sse = null; } }

  /* ── 生命周期 ─────────────────────────────────────────── */
  async function probe() {
    try {
      const r = await api("GET", "/api/v1/meta");
      if (r.ok) { LIVE.connected = true; LIVE.meta = r.json; }
      else throw new Error();
    } catch { LIVE.connected = false; LIVE.meta = null; }
    renderConn();
    if (LIVE.connected) {
      renderAgents(); renderTasks(); renderOps(); connectSse();
      const d = $("#live-task-dot"); if (d) d.hidden = false;
    } else {
      disconnectSse();
      ["#live-agents", "#live-tasks"].forEach(s => { const n = $(s); if (n) n.innerHTML = ""; });
      const hint = `<tr><td colspan="5" class="dim" style="text-align:center;padding:18px">未连接 · 见上方指引</td></tr>`;
      const ta = $("#live-tasks"); if (ta) ta.innerHTML = hint;
      const ag = $("#live-agents"); if (ag) ag.innerHTML = hint.replace('colspan="5"', 'colspan="4"');
      const d = $("#live-task-dot"); if (d) d.hidden = true;
    }
  }

  function activate() {
    probe();
    stopTimers();
    LIVE.timers.push(setInterval(renderAgents, 6000));
    LIVE.timers.push(setInterval(renderTasks, 4000));
    LIVE.timers.push(setInterval(renderOps, 3500));
  }
  function stopTimers() { LIVE.timers.forEach(clearInterval); LIVE.timers = []; }

  AXON.on("view", (v) => {
    if (v === "live") activate();
    else { stopTimers(); disconnectSse(); }
  });

  /* 顶栏 LIVE 徽标（连接后点亮，不影响演示模式其余部分） */
  setInterval(async () => {
    let ok = false;
    try { ok = (await fetch("/api/v1/meta")).ok; } catch { ok = false; }
    let pill = $("#live-pill");
    if (ok && !pill) {
      pill = el("span", "badge ok", "LIVE · 控制平面");
      pill.id = "live-pill";
      pill.style.cursor = "pointer";
      pill.title = "server/ 控制平面运行中 · 点击进入接入面";
      pill.onclick = () => AXON.nav("live");
      $(".top-right").appendChild(pill);
    } else if (!ok && pill) pill.remove();
  }, 5000);
})();
