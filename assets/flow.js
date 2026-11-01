/* ═══════════════════════════════════════════════════════════
   AXON · 任务感知维护编排（场景 S06 全流程演练）
   影响分析 → 前置检查 → 准入限制 → 任务排空 → 执行维护 → 验证恢复
   ═══════════════════════════════════════════════════════════ */

(function () {
  const STEPS = ["对象确认", "影响分析", "前置检查", "准入限制", "任务排空", "执行维护", "验证恢复"];
  const M = { step: 0, timers: [], gateResolved: false, drained: false, executed: false, verified: false };

  const later = (fn, ms) => M.timers.push(setTimeout(fn, ms));
  const clearTimers = () => { M.timers.forEach(clearTimeout); M.timers = []; };

  function impactOf() {
    const g = AXON_DATA.buildGraph();
    return AXON_DATA.downstream(g.edges, "srv-cpu-01");
  }

  function affectedTasks() {
    const set = impactOf();
    return AXON_DATA.tasks.filter(t => set.has(t.id));
  }

  /* ── 步进器 ────────────────────────────────────────────── */
  function renderStepper() {
    $("#maint-stepper").innerHTML = STEPS.map((s, i) => {
      let cls = "";
      if (i < M.step) cls = "past";
      if (i === M.step) cls = M.gateBlocked && i === 2 ? "blocked now" : "now";
      return `<div class="ms-step ${cls}"><span class="idx">STEP ${i + 1}</span>${s}</div>`;
    }).join("");
  }

  /* ── 各步骤舞台 ────────────────────────────────────────── */
  function stageTarget() {
    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="panel" style="border-color:rgba(255,179,64,.4)">
          <div class="panel-head"><h2>维护对象</h2><span class="badge warn">存在活动告警</span></div>
          <dl class="kv">
            <dt>节点</dt><dd class="plain">srv-cpu-01 · 通用服务节点 01</dd>
            <dt>告警</dt><dd class="plain">磁盘槽位 5 SMART 预警</dd>
            <dt>维护内容</dt><dd class="plain">更换磁盘 + 固件升级 3.4.2</dd>
            <dt>计划窗口</dt><dd>现在 · 30 分钟</dd>
            <dt>审批</dt><dd><span class="badge ok">MW-2211 已批准</span></dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>承载服务（受影响预告）</h2></div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">
            ${AXON_DATA.infra.filter(f => f.host === "srv-cpu-01").map(f =>
              `<div style="display:flex;align-items:center;gap:8px"><i class="led ${f.kind === "gateway" ? "led-warn" : "led-idle"}"></i>${esc(f.name)}
                <span class="badge info" style="margin-left:auto">可漂移 → srv-gpu-01</span></div>`).join("")}
            <p style="font-size:11.5px;color:var(--text-dim);line-height:1.7;margin-top:6px">
              两项网关服务均具备漂移能力，维护期间通过会话保持避免任务中断；不可中断任务将在排空阶段单独处理。</p>
          </div>
        </div>
      </div>`;
  }

  function stageImpact() {
    const set = impactOf();
    const cnt = { infra: 0, agent: 0, task: 0, nonInt: 0 };
    set.forEach(id => {
      if (/^T26-/.test(id)) {
        const o = AXON_DATA.find(id);
        cnt.task++;
        if (o && o.interruptible === false) cnt.nonInt++;
      } else if (id.startsWith("ag-")) cnt.agent++;
      else if (!id.startsWith("srv-")) cnt.infra++;
    });
    const tasks = affectedTasks();
    return `
      <div class="mt-summary">
        <div class="mt-stat"><div class="v">${cnt.infra}</div><div class="l">受影响 Infra 服务与目录</div></div>
        <div class="mt-stat"><div class="v">${cnt.agent}</div><div class="l">受影响 Agent</div></div>
        <div class="mt-stat"><div class="v">${cnt.task}</div><div class="l">在途任务</div></div>
        <div class="mt-stat"><div class="v">${cnt.nonInt}</div><div class="l">不可中断任务</div></div>
      </div>
      <div class="panel" style="padding:12px 16px">
        <div class="panel-head" style="margin-bottom:8px"><h2>影响清单（节选）</h2><span class="panel-note">来源：依赖图实时计算</span></div>
        <table class="tbl"><thead><tr><th>任务</th><th>Agent</th><th>进度</th><th>可中断</th><th>处置策略</th></tr></thead>
        <tbody>${tasks.slice(0, 6).map(t => {
          const a = AXON_DATA.find(t.agent) || {};
          return `<tr style="cursor:default">
            <td class="mono" style="color:var(--cyan)">${t.id}</td>
            <td class="dim">${esc(a.name || "")}</td>
            <td class="mono dim">${Math.round(t.progress)}%</td>
            <td>${t.interruptible ? '<span class="badge ok">可中断</span>' : '<span class="badge crit">不可中断</span>'}</td>
            <td class="dim">${t.interruptible ? "随网关漂移 · 会话保持" : t.state === "waiting_approval" ? "检查点暂存 · 等待审批" : "等待自然完成"}</td>
          </tr>`;
        }).join("")}</tbody></table>
        ${tasks.length > 6 ? `<p style="font-size:11px;color:var(--text-faint);padding:8px 14px">另有 ${tasks.length - 6} 个任务：排队类自动延后，已完成类不受影响。</p>` : ""}
      </div>`;
  }

  function stageChecks() {
    const checks = [
      { name: "替代容量校验", note: "srv-gpu-01 剩余容量满足网关漂移 · 网络可达", pass: true },
      { name: "版本与兼容性", note: "固件 3.4.2 与整机型号匹配 · 变更单已登记", pass: true },
      { name: "维护窗口与审批", note: "审批单 MW-2211 · 基础设施管理员已授权", pass: true },
      { name: "不可中断任务检查", note: M.gateResolved
          ? "T26-0731 / T26-0725 已保存检查点暂存 · 授权恢复前不会续跑"
          : "发现 2 个不可中断任务（T26-0731 · T26-0725）阻塞自动推进",
        pass: M.gateResolved, isGate: true },
      { name: "回退方案", note: "旧磁盘保留 24h · 网关支持一键回切", pass: true },
    ];
    return `
      <div class="check-list">
        ${checks.map((c, i) => {
          const state = M.gateResolved || !c.isGate ? "pass" : (c.isGate ? "fail" : "pass");
          return `<div class="check-item ${state}" ${i === 3 && !M.gateResolved ? 'style="animation-delay:.1s"' : ""}>
            <span class="ci-state">${state === "pass" ? "✓" : "✕"}</span>
            <div><div class="ci-name">${c.name}</div><div class="ci-note">${c.note}</div></div>
            ${c.isGate && !M.gateResolved ? `<button class="btn tiny ci-extra" id="resolve-gate">保存检查点并暂存</button>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${!M.gateResolved ? `<p style="font-size:11.5px;color:var(--text-faint);margin-top:12px;line-height:1.7">
        ⚑ 按 S06 约束：存在不可中断任务且未妥善处置时，自动推进被阻止。强推维护需明确授权并记录影响。</p>` : ""}`;
  }

  function stageAdmission() {
    const gates = [
      ["模型网关入口", "限制新会话进入 · 存量会话保持", true],
      ["MCP 工具网关", "限制新任务接入 · 在途调用完成", true],
      ["沙箱调度", "该节点不再分配新实例", true],
      ["队列策略", "新任务进入排队 · 优先级保护 P1 租户", true],
    ];
    return `
      <div class="check-list">
        ${gates.map(([n, d]) => `
          <div class="check-item pass">
            <span class="ci-state" style="color:var(--cyan)">◉</span>
            <div><div class="ci-name">${n}</div><div class="ci-note">${d}</div></div>
            <span class="badge ok ci-extra">已生效</span>
          </div>`).join("")}
      </div>
      <div class="panel" style="margin-top:14px;padding:12px 16px">
        <div class="panel-head" style="margin-bottom:6px"><h2>准入变化</h2><span class="live-dot"></span></div>
        <div style="display:flex;gap:20px;font-size:12px;color:var(--text-dim)">
          <span>新任务排队 <b class="mono" style="font-family:var(--mono);color:var(--warn)">2</b></span>
          <span>在途会话保持 <b class="mono" style="font-family:var(--mono);color:var(--ok)">7</b></span>
          <span>被限流入口 <b class="mono" style="font-family:var(--mono);color:var(--cyan)">2</b></span>
        </div>
      </div>`;
  }

  function stageDrain() {
    const rows = [
      ["T26-0688", "支付模块重构 · 阶段 2", "随网关漂移 · 会话保持", "ok"],
      ["T26-0712", "工单批量归档", "排空完成 ✓", "ok"],
      ["T26-0733", "全链路夜间巡检", "排空完成 ✓", "ok"],
      ["T26-0731", "供应商准入风控审核", "检查点暂存 · 等待审批", "warn"],
      ["T26-0725", "高风险退款复核", "检查点暂存 · 等待补充", "warn"],
    ];
    return `
      <div class="drain-list">
        ${rows.map(([id, name, st, cls]) => `
          <div class="drain-item">
            <span class="dn">${id}</span>
            <span class="dt">${name}</span>
            <div class="prog ${cls === "warn" ? "warn" : ""}"><i style="width:${cls === "warn" ? 62 : 100}%"></i></div>
            <span class="ds" style="color:${cls === "warn" ? "var(--warn)" : "var(--ok)"}">${st}</span>
          </div>`).join("")}
      </div>
      <p style="font-size:11.5px;color:var(--text-faint);margin-top:12px;line-height:1.7">
        排空策略区分三类：随漂移保持、自然完成、检查点暂存。等待审批的任务计算资源已释放，恢复前将重检授权（S04/S13）。</p>`;
  }

  function stageExecute() {
    return `
      <div class="term" id="maint-term"></div>
      <div class="prog striped" style="margin-top:12px"><i id="maint-exec-prog" style="width:0%"></i></div>`;
  }

  const EXEC_LOG = [
    ["10:45:12", "info", "锁定节点 srv-cpu-01 · 通知执行面进入维护态"],
    ["10:45:15", "info", "gw-model / gw-mcp 流量漂移至 srv-gpu-01（会话保持）"],
    ["10:45:21", "ok", "漂移完成 · 0 个连接中断 · 7 个会话保持"],
    ["10:46:02", "info", "磁盘槽位 5 安全下线"],
    ["10:48:35", "info", "更换磁盘 · 重建 RAID 卷"],
    ["10:52:10", "info", "固件刷新 3.4.2 · 校验和通过"],
    ["10:54:40", "ok", "硬件自检通过 · SMART 基线重置"],
  ];

  function playExecute(onDone) {
    const term = $("#maint-term");
    const prog = $("#maint-exec-prog");
    EXEC_LOG.forEach(([ts, cls, msg], i) => {
      later(() => {
        term.appendChild(el("div", "t-line",
          `<span class="t-ts">${ts}</span><span class="t-${cls}">[${{ ok: " OK ", info: "INFO", warn: "WARN", err: "ERR " }[cls]}]</span> ${esc(msg)}`));
        term.scrollTop = term.scrollHeight;
        prog.style.width = Math.round((i + 1) / EXEC_LOG.length * 100) + "%";
        if (i === EXEC_LOG.length - 1) { M.executed = true; onDone(); }
      }, 500 + i * 950);
    });
  }

  function stageVerify() {
    const cards = [
      ["服务健康检查", "gw-model / gw-mcp 自检通过 · 流量已回切", "ok"],
      ["任务连续性验证", "7 个漂移会话正常 · 无上下文丢失", "ok"],
      ["检查点任务", "T26-0731 / T26-0725 保持暂存 · 待审批后恢复", "warn"],
      ["准入恢复", "新任务准入已放开 · 排队任务开始调度", "ok"],
      ["业务验证", "测试工单全链路通过 · 模型调用正常", "ok"],
      ["审计归档", "操作记录 AUDIT-2211 · 含每步执行证据", "ok"],
    ];
    return `
      <div class="verify-grid">
        ${cards.map(([n, d, cls]) => `
          <div class="check-item ${cls === "ok" ? "pass" : ""}" style="${cls === "warn" ? "border-color:rgba(255,179,64,.45)" : ""}">
            <span class="ci-state" style="color:${cls === "ok" ? "var(--ok)" : "var(--warn)"}">${cls === "ok" ? "✓" : "◷"}</span>
            <div><div class="ci-name">${n}</div><div class="ci-note">${d}</div></div>
          </div>`).join("")}
      </div>
      <div class="panel" style="margin-top:16px;border-color:rgba(46,240,168,.35);text-align:center;padding:20px">
        <div style="font-size:15px;color:var(--ok);letter-spacing:.15em">✓ 维护完成 · 服务恢复与任务恢复分别验证通过</div>
        <p style="font-size:11.5px;color:var(--text-dim);margin-top:8px">
          非预期中断 0 · 主动暂存 2 · 审计证据已归档 · 告警 AL-01 已自动关闭</p>
      </div>`;
  }

  /* ── 渲染 ──────────────────────────────────────────────── */
  function ctrlBtns() {
    const s = M.step;
    const prev = `<button class="btn ghost" id="mt-prev" ${s === 0 ? "disabled" : ""}>上一步</button>`;
    let main = "";
    if (s === 0) main = `<button class="btn" id="mt-next">开始影响分析</button>`;
    if (s === 1) main = `<button class="btn" id="mt-next">确认影响 · 前置检查</button>`;
    if (s === 2) main = M.gateResolved
      ? `<button class="btn" id="mt-next">检查通过 · 准入限制</button>`
      : `<button class="btn danger" id="mt-force">强制推进（需授权）</button>`;
    if (s === 3) main = `<button class="btn" id="mt-next">准入已限制 · 开始排空</button>`;
    if (s === 4) main = `<button class="btn" id="mt-next">排空完成 · 执行维护</button>`;
    if (s === 5) main = M.executed
      ? `<button class="btn" id="mt-next">执行完成 · 验证恢复</button>`
      : `<span class="hint">维护执行中，请等待完成…</span>`;
    if (s === 6) main = `<button class="btn" id="mt-replay">重置演练</button>`;
    const hint = s === 0 ? "演练目标：srv-cpu-01 磁盘更换（存在 SMART 预警）" : "";
    return `<span class="hint">${hint}</span><div style="display:flex;gap:10px">${prev}${main}</div>`;
  }

  function bindCtrl() {
    $("#maint-ctrl").innerHTML = ctrlBtns();
    const prev = $("#mt-prev");
    if (prev) prev.onclick = () => { M.step = Math.max(0, M.step - 1); render(); };
    const next = $("#mt-next");
    if (next) next.onclick = () => {
      M.step = Math.min(STEPS.length - 1, M.step + 1);
      if (M.step === 5) M.executed = false;
      render();
    };
    const gate = $("#resolve-gate");
    if (gate) gate.onclick = () => {
      M.gateResolved = true;
      AXON.toast("检查点已暂存", "T26-0731 / T26-0725 保存检查点并释放资源 · 恢复前将重检授权", "ok");
      AXON.pushEvent("检查点", "ok", "维护前置：<b>T26-0731 / T26-0725</b> 检查点暂存 · 阻塞解除");
      render();
    };
    const force = $("#mt-force");
    if (force) force.onclick = () => AXON.confirm({
      title: "强制推进维护",
      html: `存在 <b>2 个不可中断任务</b>未妥善处置。强制推进可能造成任务上下文丢失，需管理员明确授权并记录影响。`,
      okText: "授权并强推", danger: true,
      onOk: () => {
        M.gateResolved = true;
        AXON.pushEvent("策略", "crit", "维护强推授权通过 · 不可中断任务影响已记录（AUDIT 前置）");
        AXON.toast("已授权强推", "影响已记录 · 继续前置检查", "warn");
        render();
      },
    });
    const replay = $("#mt-replay");
    if (replay) replay.onclick = () => {
      M.step = 0; M.gateResolved = false; M.executed = false;
      render();
      AXON.toast("演练已重置", "srv-cpu-01 告警已恢复，可重新体验完整流程。", "info");
    };
  }

  function renderTermFinal() {
    const term = $("#maint-term"), prog = $("#maint-exec-prog");
    if (!term) return;
    EXEC_LOG.forEach(([ts, cls, msg]) => {
      term.appendChild(el("div", "t-line",
        `<span class="t-ts">${ts}</span><span class="t-${cls}">[${{ ok: " OK ", info: "INFO", warn: "WARN", err: "ERR " }[cls]}]</span> ${esc(msg)}`));
    });
    term.scrollTop = term.scrollHeight;
    if (prog) prog.style.width = "100%";
  }

  function render() {
    clearTimers();
    renderStepper();
    const stage = $("#maint-stage");
    const s = M.step;
    if (s === 0) stage.innerHTML = stageTarget();
    if (s === 1) stage.innerHTML = stageImpact();
    if (s === 2) stage.innerHTML = stageChecks();
    if (s === 3) stage.innerHTML = stageAdmission();
    if (s === 4) stage.innerHTML = stageDrain();
    if (s === 5) {
      stage.innerHTML = stageExecute();
      if (M.executed) renderTermFinal();
      else playExecute(() => { M.executed = true; bindCtrl(); });
    }
    if (s === 6) stage.innerHTML = stageVerify();
    bindCtrl();

    /* 完成时落盘世界状态：关闭告警 */
    if (s === 6 && !M._applied) {
      M._applied = true;
      const D = AXON_DATA;
      const srv = D.servers.find(x => x.id === "srv-cpu-01");
      srv.state = "ok"; srv.warnNote = null;
      const badSlot = (srv.slots || []).find(sl => sl.state === "warn");
      if (badSlot) { badSlot.state = "ok"; badSlot.note = null; badSlot.type = "3.84T NVMe · 已更换"; }
      D.alerts = D.alerts.filter(a => a.id !== "AL-01");
      AXON.pushEvent("任务", "ok", "维护 MW-2211 完成 · <b>srv-cpu-01</b> 磁盘槽位 5 已更换，告警关闭，准入恢复");
      AXON.toast("告警已关闭", "srv-cpu-01 磁盘更换完成 · 槽位 5 恢复正常", "ok", 4000);
    }
    if (s !== 6) M._applied = false;
  }

  AXON.on("view", (v) => { if (v === "maint" && !$("#maint-stage").children.length) render(); });
  AXON.on("maint-prefill", () => { M.step = 0; render(); });

  /* 首次进入即渲染 */
  render();
})();
