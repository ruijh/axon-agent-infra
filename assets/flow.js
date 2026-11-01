/* ═══════════════════════════════════════════════════════════
   AXON · 任务感知编排中心（公共操作流程 §8.3 七段式）
   ─────────────────────────────────────────────────────────
   触发与责任确认 → 影响分析 → 前置检查 → 准入限制 →
   任务排空 → 执行 → 验证恢复 / 归档

   场景族（任务感知编排 × Agent Infra）：
   ① server-maint    服务器维护（S06：磁盘更换 + 网关漂移）
   ② endpoint-switch 模型端点切换演练（agentgateway Fallback 灰度）
   ③ agent-retire    Agent 退役下线（RET 单 · 能力声明门控）
   ④ sandbox-maint   沙箱集群节点维护（S05 保护 + 实例迁移）
   ⑤ kb-rolling      知识库集群滚动升级（副本下限 + 只读降级）
   ═══════════════════════════════════════════════════════════ */

(function () {
  const M = { scenario: "server-maint", step: 0, gateResolved: false, executed: false, _applied: false, timers: [] };
  const later = (fn, ms) => M.timers.push(setTimeout(fn, ms));
  const clearTimers = () => { M.timers.forEach(clearTimeout); M.timers = []; };
  const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`; };

  /* ══ 通用渲染件 ═════════════════════════════════════════ */

  function impactStats(rootId) {
    const g = AXON_DATA.buildGraph();
    const set = AXON_DATA.downstream(g.edges, rootId);
    const cnt = { infra: 0, agent: 0, task: 0, nonInt: 0 };
    set.forEach(id => {
      if (/^T26|^T26\d+/.test(id)) {
        cnt.task++;
        const o = AXON_DATA.find(id);
        if (o && o.interruptible === false) cnt.nonInt++;
      } else if (id.startsWith("ag-")) cnt.agent++;
      else if (!id.startsWith("srv-")) cnt.infra++;
    });
    const tasks = AXON_DATA.tasks.filter(t => set.has(t.id));
    return { set, cnt, tasks };
  }

  function impactPanel(rootId, note) {
    const { cnt, tasks } = impactStats(rootId);
    return `
      <div class="mt-summary">
        <div class="mt-stat"><div class="v">${cnt.infra}</div><div class="l">受影响 Infra 服务与目录</div></div>
        <div class="mt-stat"><div class="v">${cnt.agent}</div><div class="l">受影响 Agent</div></div>
        <div class="mt-stat"><div class="v">${cnt.task}</div><div class="l">在途任务</div></div>
        <div class="mt-stat"><div class="v">${cnt.nonInt}</div><div class="l">不可中断任务</div></div>
      </div>
      <div class="panel" style="padding:12px 16px">
        <div class="panel-head" style="margin-bottom:8px"><h2>影响清单（节选）</h2><span class="panel-note">来源：依赖图实时计算 · root=${esc(rootId)}</span></div>
        <table class="tbl"><thead><tr><th>任务</th><th>Agent</th><th>进度</th><th>可中断</th><th>处置策略</th></tr></thead>
        <tbody>${tasks.slice(0, 6).map(t => {
          const a = AXON_DATA.find(t.agent) || {};
          return `<tr style="cursor:default">
            <td class="mono" style="color:var(--cyan)">${t.id}</td>
            <td class="dim">${esc(a.name || "")}</td>
            <td class="mono dim">${Math.round(t.progress)}%</td>
            <td>${t.interruptible ? '<span class="badge ok">可中断</span>' : '<span class="badge crit">不可中断</span>'}</td>
            <td class="dim">${t.interruptible ? "会话保持 / 随迁移" : t.state === "waiting_approval" ? "检查点暂存 · 等待审批" : "降级保护 / 检查点暂存"}</td>
          </tr>`;
        }).join("")}</tbody></table>
        ${tasks.length > 6 ? `<p style="font-size:11px;color:var(--text-faint);padding:8px 14px">另有 ${tasks.length - 6} 个任务：排队类自动延后，已完成类不受影响。</p>` : ""}
        ${note ? `<p style="font-size:11.5px;color:var(--text-dim);padding:6px 14px 2px;line-height:1.7">${note}</p>` : ""}
      </div>`;
  }

  function checkPanel(checks) {
    return `
      <div class="check-list">
        ${checks.map(c => {
          const state = c.pass ? "pass" : "fail";
          return `<div class="check-item ${state}">
            <span class="ci-state">${c.pass ? "✓" : "✕"}</span>
            <div><div class="ci-name">${c.name}</div><div class="ci-note">${c.note}</div></div>
            ${c.isGate && !c.pass ? `<button class="btn tiny ci-extra" id="resolve-gate">${c.gateBtn || "解除阻塞"}</button>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${checks.some(c => c.isGate && !c.pass) ? `<p style="font-size:11.5px;color:var(--text-faint);margin-top:12px;line-height:1.7">
        ⚑ 按 SPEC §5.3 / §8.3 约束：前置检查未妥善处置时自动推进被阻止。强推需明确授权并记录影响（产生 AUDIT 前置记录）。</p>` : ""}`;
  }

  function admissionPanel(rows, stats) {
    return `
      <div class="check-list">
        ${rows.map(([n, d]) => `
          <div class="check-item pass">
            <span class="ci-state" style="color:var(--cyan)">◉</span>
            <div><div class="ci-name">${n}</div><div class="ci-note">${d}</div></div>
            <span class="badge ok ci-extra">已生效</span>
          </div>`).join("")}
      </div>
      <div class="panel" style="margin-top:14px;padding:12px 16px">
        <div class="panel-head" style="margin-bottom:6px"><h2>准入变化</h2><span class="live-dot"></span></div>
        <div style="display:flex;gap:20px;font-size:12px;color:var(--text-dim)">
          ${stats.map(([l, v, c]) => `<span>${l} <b class="mono" style="font-family:var(--mono);color:var(--${c})">${v}</b></span>`).join("")}
        </div>
      </div>`;
  }

  function drainPanel(rows, note) {
    return `
      <div class="drain-list">
        ${rows.map(([id, name, st, pct, cls]) => `
          <div class="drain-item">
            <span class="dn">${id}</span>
            <span class="dt">${name}</span>
            <div class="prog ${cls === "warn" ? "warn" : ""}"><i style="width:${pct}%"></i></div>
            <span class="ds" style="color:${cls === "warn" ? "var(--warn)" : cls === "crit" ? "var(--crit)" : "var(--ok)"}">${st}</span>
          </div>`).join("")}
      </div>
      ${note ? `<p style="font-size:11.5px;color:var(--text-faint);margin-top:12px;line-height:1.7">${note}</p>` : ""}`;
  }

  function termPanel() {
    return `<div class="term" id="maint-term"></div>
      <div class="prog striped" style="margin-top:12px"><i id="maint-exec-prog" style="width:0%"></i></div>`;
  }

  function playLog(log, onDone) {
    const term = $("#maint-term"), prog = $("#maint-exec-prog");
    log.forEach(([ts, cls, msg], i) => {
      later(() => {
        term.appendChild(el("div", "t-line",
          `<span class="t-ts">${ts}</span><span class="t-${cls}">[${{ ok: " OK ", info: "INFO", warn: "WARN", err: "ERR " }[cls]}]</span> ${esc(msg)}`));
        term.scrollTop = term.scrollHeight;
        prog.style.width = Math.round((i + 1) / log.length * 100) + "%";
        if (i === log.length - 1) { M.executed = true; onDone(); }
      }, 500 + i * 850);
    });
  }

  function renderLogFull(log) {
    const term = $("#maint-term"), prog = $("#maint-exec-prog");
    if (!term) return;
    log.forEach(([ts, cls, msg]) => {
      term.appendChild(el("div", "t-line",
        `<span class="t-ts">${ts}</span><span class="t-${cls}">[${{ ok: " OK ", info: "INFO", warn: "WARN", err: "ERR " }[cls]}]</span> ${esc(msg)}`));
    });
    term.scrollTop = term.scrollHeight;
    if (prog) prog.style.width = "100%";
  }

  function verifyPanel(cards, title, note) {
    return `
      <div class="verify-grid">
        ${cards.map(([n, d, cls]) => `
          <div class="check-item ${cls === "ok" ? "pass" : ""}" style="${cls === "warn" ? "border-color:rgba(255,179,64,.45)" : ""}">
            <span class="ci-state" style="color:${cls === "ok" ? "var(--ok)" : "var(--warn)"}">${cls === "ok" ? "✓" : "◷"}</span>
            <div><div class="ci-name">${n}</div><div class="ci-note">${d}</div></div>
          </div>`).join("")}
      </div>
      <div class="panel" style="margin-top:16px;border-color:rgba(46,240,168,.35);text-align:center;padding:20px">
        <div style="font-size:15px;color:var(--ok);letter-spacing:.15em">✓ ${title}</div>
        <p style="font-size:11.5px;color:var(--text-dim);margin-top:8px">${note}</p>
      </div>`;
  }

  /* ══ 场景定义 ═══════════════════════════════════════════ */

  const SC = {};

  /* ── ① 服务器维护（S06 原场景，保留）────────────────── */
  SC["server-maint"] = {
    name: "服务器维护", code: "S06",
    desc: "srv-cpu-01 磁盘更换 · 网关漂移 · 不可中断任务阻塞",
    steps: ["对象确认", "影响分析", "前置检查", "准入限制", "任务排空", "执行维护", "验证恢复"],
    targetHtml: () => `
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
      </div>`,
    root: "srv-cpu-01",
    impactNote: "排空策略区分三类：随漂移保持、自然完成、检查点暂存；等待审批的任务恢复前将重检授权（S04/S13）。",
    checks: (m) => [
      { name: "替代容量校验", note: "srv-gpu-01 剩余容量满足网关漂移 · 网络可达", pass: true },
      { name: "版本与兼容性", note: "固件 3.4.2 与整机型号匹配 · 变更单已登记", pass: true },
      { name: "维护窗口与审批", note: "审批单 MW-2211 · 基础设施管理员已授权", pass: true },
      { name: "不可中断任务检查", note: m.gateResolved
          ? "T26-0731 / T26-0725 已保存检查点暂存 · 授权恢复前不会续跑"
          : "发现 2 个不可中断任务（T26-0731 · T26-0725）阻塞自动推进",
        pass: m.gateResolved, isGate: true, gateBtn: "保存检查点并暂存" },
      { name: "回退方案", note: "旧磁盘保留 24h · 网关支持一键回切", pass: true },
    ],
    onResolveGate: () => {
      AXON.toast("检查点已暂存", "T26-0731 / T26-0725 保存检查点并释放资源 · 恢复前将重检授权", "ok");
      AXON.pushEvent("检查点", "ok", "维护前置：<b>T26-0731 / T26-0725</b> 检查点暂存 · 阻塞解除");
    },
    forceHtml: "存在 <b>2 个不可中断任务</b>未妥善处置。强制推进可能造成任务上下文丢失，需管理员明确授权并记录影响。",
    admission: () => [
      ["模型网关入口", "限制新会话进入 · 存量会话保持"],
      ["MCP 工具网关", "限制新任务接入 · 在途调用完成"],
      ["沙箱调度", "该节点不再分配新实例"],
      ["队列策略", "新任务进入排队 · 优先级保护 P1 租户"],
    ],
    admissionStats: () => [["新任务排队", 2, "warn"], ["在途会话保持", 7, "ok"], ["被限流入口", 2, "cyan"]],
    drain: () => [
      ["T26-0688", "支付模块重构 · 阶段 2", "随网关漂移 · 会话保持", 100, "ok"],
      ["T26-0712", "工单批量归档", "排空完成 ✓", 100, "ok"],
      ["T26-0733", "全链路夜间巡检", "排空完成 ✓", 100, "ok"],
      ["T26-0731", "供应商准入风控审核", "检查点暂存 · 等待审批", 62, "warn"],
      ["T26-0725", "高风险退款复核", "检查点暂存 · 等待补充", 28, "warn"],
    ],
    drainNote: "排空策略区分三类：随漂移保持、自然完成、检查点暂存。等待审批的任务计算资源已释放，恢复前将重检授权（S04/S13）。",
    execLog: () => [
      ["10:45:12", "info", "锁定节点 srv-cpu-01 · 通知执行面进入维护态"],
      ["10:45:15", "info", "gw-model / gw-mcp 流量漂移至 srv-gpu-01（会话保持）"],
      ["10:45:21", "ok", "漂移完成 · 0 个连接中断 · 7 个会话保持"],
      ["10:46:02", "info", "磁盘槽位 5 安全下线"],
      ["10:48:35", "info", "更换磁盘 · 重建 RAID 卷"],
      ["10:52:10", "info", "固件刷新 3.4.2 · 校验和通过"],
      ["10:54:40", "ok", "硬件自检通过 · SMART 基线重置"],
    ],
    verify: () => ([
      ["服务健康检查", "gw-model / gw-mcp 自检通过 · 流量已回切", "ok"],
      ["任务连续性验证", "7 个漂移会话正常 · 无上下文丢失", "ok"],
      ["检查点任务", "T26-0731 / T26-0725 保持暂存 · 待审批后恢复", "warn"],
      ["准入恢复", "新任务准入已放开 · 排队任务开始调度", "ok"],
      ["业务验证", "测试工单全链路通过 · 模型调用正常", "ok"],
      ["审计归档", "操作记录 AUDIT-2211 · 含每步执行证据", "ok"],
    ]),
    finishTitle: "维护完成 · 服务恢复与任务恢复分别验证通过",
    finishNote: "非预期中断 0 · 主动暂存 2 · 审计证据已归档 · 告警 AL-01 已自动关闭",
    replayToast: "srv-cpu-01 告警已恢复，可重新体验完整流程。",
    apply: (D) => {
      const srv = D.servers.find(x => x.id === "srv-cpu-01");
      srv.state = "ok"; srv.warnNote = null;
      const badSlot = (srv.slots || []).find(sl => sl.state === "warn");
      if (badSlot) { badSlot.state = "ok"; badSlot.note = null; badSlot.type = "3.84T NVMe · 已更换"; }
      D.alerts = D.alerts.filter(a => a.id !== "AL-01");
      AXON.pushEvent("任务", "ok", "维护 MW-2211 完成 · <b>srv-cpu-01</b> 磁盘槽位 5 已更换，告警关闭，准入恢复");
      AXON.toast("告警已关闭", "srv-cpu-01 磁盘更换完成 · 槽位 5 恢复正常", "ok", 4000);
    },
  };

  /* ── ② 模型端点切换演练（agentgateway Fallback）────── */
  SC["endpoint-switch"] = {
    name: "模型端点切换", code: "FR-08",
    desc: "ep-glm 模拟熔断 · 灰度切换至 ep-ds · 合规专路不切换",
    steps: ["对象确认", "影响分析", "前置检查", "准入限制", "灰度切换", "执行演练", "验证恢复"],
    targetHtml: () => `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="panel" style="border-color:rgba(55,226,255,.4)">
          <div class="panel-head"><h2>演练对象</h2><span class="badge info">Fallback 演练</span></div>
          <dl class="kv">
            <dt>主端点</dt><dd class="plain">ep-glm · GLM-4.7 主力（ctx 200K · 流量 86%）</dd>
            <dt>备用端点</dt><dd class="plain">ep-ds · DeepSeek-V4（ctx 128K · standby）</dd>
            <dt>演练内容</dt><dd class="plain">模拟主端点熔断 ×5 → 灰度切换 → 回切</dd>
            <dt>能力校验</dt><dd class="plain">备用端点 ctx / tool-call 能力标签比对</dd>
            <dt>审批</dt><dd><span class="badge ok">平台管理员已批准</span></dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>路由不变量（切换前基线）</h2></div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">
            ${AXON_DATA.routeRules.map(r => `
              <div style="display:flex;align-items:center;gap:8px"><i class="led ${r.peer ? "led-idle" : "led-warn"}"></i>
                <span class="mono" style="font-family:var(--mono);color:var(--cyan)">${r.id}</span>
                <span class="dim" style="font-size:11px">${esc(r.match)}</span>
                <span class="badge ${r.peer ? "info" : "crit"}" style="margin-left:auto">${r.peer ? `主 ${r.weight}% / 备 ${100 - r.weight}%` : "100% 合规专路"}</span></div>`).join("")}
            <p style="font-size:11.5px;color:var(--text-dim);line-height:1.7;margin-top:6px">
              不变量：同匹配组权重之和恒为 100；Fallback 切换前必须校验备用端点能力标签；<b>rr-sec-only 合规专路不参与切换</b>。</p>
          </div>
        </div>
      </div>`,
    root: "ep-glm",
    impactNote: "切换影响所有经 gw-model 使用 ep-glm 的 Agent；长上下文任务（ctx &gt; 128K）在备用端点不可用，需检查点暂存。",
    checks: (m) => [
      { name: "备用端点能力标签校验", note: "ep-ds：ctx=128K ✓ · tool-call ✓ · 流式 ✓", pass: true },
      { name: "合规专路检查", note: "rr-sec-only（租户=sec）标记为不可切换 · 演练范围已排除", pass: true },
      { name: "权重不变量校验", note: "切换后各匹配组权重和将保持 100（平台强制）", pass: true },
      { name: "长上下文任务检查", note: m.gateResolved
          ? "T26-0688（ctx 200K）已检查点暂存 · 其余任务 ctx ≤ 128K 可走备用端点"
          : "T26-0688（支付模块重构 · ctx 200K）超出备用端点 128K 上下文，阻塞自动切换",
        pass: m.gateResolved, isGate: true, gateBtn: "检查点暂存 T26-0688" },
      { name: "回切方案", note: "主端点健康探测恢复后 · 按灰度 10→50→100 回切", pass: true },
    ],
    onResolveGate: () => {
      AXON.toast("检查点已暂存", "T26-0688 保存应用检查点 · 切换期间暂停，回切后恢复", "ok");
      AXON.pushEvent("路由", "ok", "切换前置：<b>T26-0688</b> 检查点暂存（ctx 200K 超出备用端点能力）· 阻塞解除");
    },
    forceHtml: "长上下文任务 <b>T26-0688</b> 若强行切换将丢失超限上下文。授权强切需记录影响并人工恢复。",
    admission: () => [
      ["模型网关新会话", "新会话灰度 10% 走 ep-ds · 观察窗口 90s"],
      ["长上下文请求", "ctx > 128K 请求排队（暂不接受）"],
      ["合规专路", "rr-sec-only 保持 ep-glm 直连 · 不受演练影响"],
      ["回切预热", "ep-glm 健康探测间隔 5s · 恢复即触发灰度回切"],
    ],
    admissionStats: () => [["灰度流量 ep-ds", "10%", "cyan"], ["排队长上下文", 1, "warn"], ["保持会话", "全部", "ok"]],
    drain: () => [
      ["T26-0712", "工单批量归档", "ctx 32K · 随灰度切换至 ep-ds", 100, "ok"],
      ["T26-0729", "季度经营简报生成", "ctx 64K · 随灰度切换至 ep-ds", 100, "ok"],
      ["T26-0733", "全链路夜间巡检", "ctx 32K · 随灰度切换至 ep-ds", 100, "ok"],
      ["T26-0688", "支付模块重构 · 阶段 2", "ctx 200K 超限 · 检查点暂存等待回切", 38, "warn"],
      ["T26-0731", "供应商准入风控审核", "等待审批中 · 不产生新调用", 62, "warn"],
    ],
    drainNote: "排空按能力标签分流：ctx ≤ 128K 的任务随灰度无缝切换；超限任务暂存等待回切（对齐 agentgateway validateCaps 语义）。",
    execLog: () => [
      ["11:02:05", "warn", "熔断注入：ep-glm 健康探测连续失败 ×5"],
      ["11:02:06", "info", "能力标签校验：ep-ds ctx=128K · tool-call ✓ · 授权边界 ✓"],
      ["11:02:08", "info", "灰度切换 10% → 观察窗口 · P95 2.1s 无劣化"],
      ["11:03:52", "info", "灰度推进 50% → 错误率 0.02% 正常"],
      ["11:04:30", "ok", "切换 100% · rr-sec-only 合规专路保持未动"],
      ["11:06:10", "info", "回切演练：ep-glm 探测恢复 · 灰度回切 50%"],
      ["11:07:45", "ok", "回切完成 · 权重恢复 86/14 · T26-0688 自检查点恢复"],
    ],
    verify: () => ([
      ["备用端点承载验证", "切换期间 ep-ds 承载 100% · P95 稳定 2.1s", "ok"],
      ["合规专路验证", "rr-sec-only 全程未切换 · 0 笔流量漂移", "ok"],
      ["检查点任务", "T26-0688 已恢复运行 · 上下文完整（超限段重建）", "ok"],
      ["权重不变量", "回切后 86 + 14 = 100 ✓ · 各匹配组无违约", "ok"],
      ["灰度回切", "10→50→100 三级灰度 · 每级观察窗口通过", "ok"],
      ["审计归档", "路由变更 AUDIT-2212 · 含灰度曲线与探测证据", "ok"],
    ]),
    finishTitle: "Fallback 演练完成 · 切换与回切均按灰度推进",
    finishNote: "能力校验拦截超限任务 1 · 合规专路零影响 · 权重不变量全程保持",
    replayToast: "路由权重已恢复基线，可重新演练。",
    apply: (D) => {
      D.models[0].traffic = 86; D.models[1].traffic = 14;
      const def = D.routeRules.find(r => r.id === "rr-glm-default");
      if (def) def.weight = 86;
      AXON.pushEvent("路由", "ok", "Fallback 演练完成 · 流量回切主端点（灰度 10→50→100）· 合规专路保持");
      AXON.toast("演练完成", "权重恢复 86/14 · 超限任务已自检查点恢复", "ok", 4000);
    },
  };

  /* ── ③ Agent 退役下线（RET 单 · 能力声明门控）───────── */
  SC["agent-retire"] = {
    name: "Agent 退役", code: "RET",
    desc: "ag-dm 数据治理 Agent 下线 · 流量摘除 · 能力声明门控",
    steps: ["对象确认", "影响分析", "前置检查", "准入限制", "任务排空", "退役执行", "验证归档"],
    targetHtml: () => {
      const a = AXON_DATA.agents.find(x => x.id === "ag-dm") || {};
      return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="panel" style="border-color:rgba(177,140,255,.4)">
          <div class="panel-head"><h2>退役对象</h2><span class="badge violet">灰度收编下线</span></div>
          <dl class="kv">
            <dt>Agent</dt><dd class="plain">ag-dm · 数据治理 Agent ${esc(a.ver || "")}</dd>
            <dt>状态</dt><dd class="plain">gray · 灰度 ${a.canaryPct ?? 10}% · ${a.insts?.length || 1} 实例</dd>
            <dt>负责人</dt><dd class="plain">${esc(a.owner || "")}</dd>
            <dt>依赖</dt><dd class="plain">运行时 sb-e2b · ep-ds · tl-git</dd>
            <dt>退役单</dt><dd><span class="badge ok">RET-2212 业务负责人已确认</span></dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>能力声明（caps · §4）</h2></div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">
            ${["observe", "traffic", "instance", "state", "task"].map(k => {
              const on = a.caps?.[k];
              return `<div style="display:flex;align-items:center;gap:8px"><i class="led ${on ? "led-ok" : "led-crit"}"></i>${k}
                <span class="badge ${on ? "ok" : "crit"}" style="margin-left:auto">${on ? "已声明" : "未声明"}</span></div>`;
            }).join("")}
            <p style="font-size:11.5px;color:var(--text-dim);line-height:1.7;margin-top:6px">
              ag-dm 未声明 task / state / instance 能力：平台<b>不能</b>代为取消或迁移其任务（451 门控）。当前无在途任务，门控不构成阻塞；若有，必须人工处置。</p>
          </div>
        </div>
      </div>`;
    },
    root: "ag-dm",
    impactNote: "退役影响面 = 该 Agent 的在途任务与其依赖的下游（当前灰度阶段无在途任务，为干净下线示例）。",
    checks: (m) => [
      { name: "在途任务检查", note: "ag-dm 在途任务 0 个 · 无需排空或转移", pass: true },
      { name: "依赖方检查", note: "无其他 Agent 依赖 ag-dm · tl-git 消费方另有 ag-coder", pass: true },
      { name: "能力声明门控", note: m.gateResolved
          ? "已确认：因 caps.task=0，若退役时出现在途任务将拒绝平台代取消（转人工）"
          : "ag-dm 未声明 task 能力 —— 平台无法代为取消其任务，需负责人确认处置预案",
        pass: m.gateResolved, isGate: true, gateBtn: "确认人工处置预案" },
      { name: "灰度流量检查", note: "当前灰度 10% · 摘除后 0% · 主版本 ag-bi 不受影响", pass: true },
      { name: "回退方案", note: "退役保留 7 天可回滚 · 实例清单与配置已快照", pass: true },
    ],
    onResolveGate: () => {
      AXON.toast("预案已确认", "负责人确认：退役窗口内如出现任务由值班人工处置（能力门控保持生效）", "ok");
      AXON.pushEvent("策略", "ok", "退役前置：<b>ag-dm</b> caps.task=0 · 人工处置预案已登记，门控语义确认");
    },
    forceHtml: "能力声明检查未确认。平台严禁对未声明 task 能力的 Agent 代为取消任务（§4.2），如确认放弃演练请退出。",
    admission: () => [
      ["灰度流量摘除", "canary 10% → 0% · 灰度会话自然结束"],
      ["新会话准入", "入口不再为 ag-dm 分配新会话"],
      ["工具授权收回", "tl-git 委托凭据撤销 · 消费方名单移除"],
      ["配额释放", "租户 data-biz 沙箱并发 -1 · Token 预算回收"],
    ],
    admissionStats: () => [["灰度会话自然结束", 2, "ok"], ["入口摘除", "1", "cyan"], ["凭据撤销", 1, "warn"]],
    drain: () => [
      ["ag-dm-77c3", "灰度实例（唯一）", "缩容 1 → 0 · 配置已快照", 100, "ok"],
      ["会话 #4121", "数据质量巡检（灰度）", "自然结束 · 产物已归档", 100, "ok"],
      ["会话 #4122", "元数据抽取试验", "自然结束 · 上下文已导出", 100, "ok"],
      ["tl-git 凭据", "ag-dm#git-delegated", "撤销传播中", 62, "warn"],
    ],
    drainNote: "排空策略：灰度会话自然结束（不强制中断）、实例缩容至 0、委托凭据撤销传播（svc-iam）。",
    execLog: () => [
      ["13:20:05", "info", "RET-2212 启动 · 责任人已确认（业务负责人签字）"],
      ["13:20:08", "ok", "灰度流量摘除完成 · canary 0%"],
      ["13:21:30", "ok", "2 个灰度会话自然结束 · 产物归档"],
      ["13:22:10", "info", "实例 ag-dm-77c3 终止 · sb-e2b 配额释放"],
      ["13:22:12", "warn", "委托凭据 ag-dm#git-delegated 撤销 · 传播至 gw-mcp"],
      ["13:23:00", "info", "AgentDeployment 标记 retired · 目录与审计库写入"],
      ["13:23:05", "ok", "RET-2212 完成 · 回滚窗口 7 天"],
    ],
    verify: () => ([
      ["流量验证", "ag-dm 流量 0% · 无残留会话", "ok"],
      ["实例验证", "实例 0/0 · 期望与实际一致", "ok"],
      ["依赖方验证", "ag-coder 使用 tl-git 正常 · 无报错", "ok"],
      ["凭据验证", "撤销已传播 · 旧凭据调用全部拒绝", "ok"],
      ["配额回收", "data-biz 沙箱并发 -1 已生效", "ok"],
      ["审计归档", "RET-2212 全程证据入 st-audit（WORM）", "ok"],
    ]),
    finishTitle: "退役完成 · ag-dm 已下线并归档",
    finishNote: "非预期中断 0 · 凭据撤销 1 · 回滚窗口 7 天 · 审计证据 WORM 归档",
    replayToast: "ag-dm 已恢复灰度状态，可重新演练退役流程。",
    apply: (D) => {
      const a = D.agents.find(x => x.id === "ag-dm");
      if (a) { a.state = "retired"; a.canaryPct = 0; }
      AXON.pushEvent("撤销", "ok", "退役完成：<b>ag-dm</b> 流量摘除 · 实例缩容 0 · 委托凭据撤销 · RET-2212 归档");
      AXON.toast("Agent 已退役", "ag-dm 下线完成 · 凭据撤销 · 配额释放 · 审计归档", "ok", 4200);
    },
    replayReset: (D) => {
      const a = D.agents.find(x => x.id === "ag-dm");
      if (a) { a.state = "gray"; a.canaryPct = 10; }
    },
  };

  /* ── ④ 沙箱集群节点维护（S05 保护 + 实例迁移）──────── */
  SC["sandbox-maint"] = {
    name: "沙箱集群维护", code: "S05",
    desc: "srv-gpu-02 · sb-e2b 实例迁移 · 受保护实例跳过",
    steps: ["对象确认", "影响分析", "前置检查", "准入限制", "实例迁移", "执行维护", "验证恢复"],
    targetHtml: () => {
      const sb = AXON_DATA.infra.find(f => f.id === "sb-e2b") || {};
      const insts = AXON_DATA.sandboxInstances || [];
      return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="panel" style="border-color:rgba(55,226,255,.4)">
          <div class="panel-head"><h2>维护对象</h2><span class="badge info">沙箱执行节点</span></div>
          <dl class="kv">
            <dt>节点</dt><dd class="plain">srv-gpu-02 · GPU 执行节点 02</dd>
            <dt>承载</dt><dd class="plain">sb-e2b 沙箱集群 ${esc(sb.ver || "")} · ubuntu-24-nocode-c4</dd>
            <dt>实例分布</dt><dd class="plain">BOUND ${insts.filter(x => x.state === "BOUND").length} · WARM ${insts.filter(x => x.state === "WARM").length} · PAUSED ${insts.filter(x => x.state === "PAUSED").length}</dd>
            <dt>维护内容</dt><dd class="plain">Hypervisor 补丁 + GPU 驱动升级</dd>
            <dt>审批</dt><dd><span class="badge ok">MW-2213 平台管理员已批准</span></dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>实例与保护语义（S05）</h2></div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">
            ${insts.filter(x => x.state === "BOUND" || x.state === "GC-PENDING").slice(0, 5).map(x => `
              <div style="display:flex;align-items:center;gap:8px">
                <i class="led ${x.ownerTask ? "led-warn" : "led-idle"}"></i>
                <span class="mono" style="font-family:var(--mono);color:var(--cyan)">${x.id}</span>
                <span class="dim" style="font-size:11px">${x.ownerTask ? "归属 " + x.ownerTask : x.ownerNote || "无主"}</span>
                <span class="badge ${x.ownerTask ? "warn" : "info"}" style="margin-left:auto">${x.ownerTask ? "迁移前检查" : "可直接回收/漂移"}</span>
              </div>`).join("")}
            <p style="font-size:11.5px;color:var(--text-dim);line-height:1.7;margin-top:6px">
              <b>S05 保护语义</b>：待审批 / 结果待核对任务关联的实例禁止回收；迁移走 file-snapshot 重建 + 挂载。</p>
          </div>
        </div>
      </div>`;
    },
    root: "srv-gpu-02",
    impactNote: "影响面含沙箱集群、经沙箱执行的 Agent（ag-coder / ag-dm）与其实例归属任务；预热池提供迁移缓冲。",
    checks: (m) => [
      { name: "预热池容量校验", note: "WARM 4 ≥ 迁移需求 3 · 模板 ubuntu-24-nocode-c4 匹配", pass: true },
      { name: "快照能力校验", note: "file-snapshot 支持 · st-ckpt 剩余 62% · 双副本", pass: true },
      { name: "调度排除检查", note: "维护窗口内沙箱调度器排除 srv-gpu-02", pass: true },
      { name: "受保护实例检查", note: m.gateResolved
          ? "sbx-8821（T26-0677 结果待核对）已人工核对确认 · 转入迁移清单"
          : "sbx-8821 关联任务 T26-0677 处于结果待核对（S12），受保护禁止迁移，阻塞推进",
        pass: m.gateResolved, isGate: true, gateBtn: "人工核对并解除保护" },
      { name: "回退方案", note: "快照保留 24h · 迁移失败可原节点重建", pass: true },
    ],
    onResolveGate: () => {
      AXON.toast("保护已解除", "T26-0677 人工核对：ERP 写入已确认（幂等键证据）· sbx-8821 转入迁移", "ok");
      AXON.pushEvent("核对", "ok", "沙箱维护前置：<b>T26-0677</b> 人工核对确认 · sbx-8821 保护解除（S05）");
    },
    forceHtml: "受保护实例 <b>sbx-8821</b> 关联结果待核对任务。强推迁移可能造成核对证据丢失，需安全管理员授权。",
    admission: () => [
      ["沙箱调度排除", "该节点不再分配新实例"],
      ["预热池加速", "预热池目标 4 → 8 · 模板匹配预热"],
      ["租约续期暂停", "维护窗口内 BOUND 实例租约冻结（防 GC）"],
      ["创建入口限流", "租户新建沙箱请求排队 · P1 优先"],
    ],
    admissionStats: () => [["待迁移实例", 3, "warn"], ["预热缓冲", "+4", "ok"], ["冻结租约", 3, "cyan"]],
    drain: () => [
      ["sbx-8805", "T26-0688 · 支付模块重构", "file-snapshot → srv-gpu-03 重建挂载", 100, "ok"],
      ["sbx-8806", "ag-dm 灰度会话", "会话结束 · 实例回收", 100, "ok"],
      ["sbx-8810", "T26-0731 · 等待审批", "保持 PAUSED · 检查点已暂存", 62, "warn"],
      ["sbx-8821", "T26-0677 · 核对后迁移", "快照迁移 · 证据随实例保留", 87, "warn"],
      ["sbx-8812", "T26-0705 · 恢复中", "漂移标记 · 重建后继续恢复", 44, "warn"],
    ],
    drainNote: "迁移分级：运行中任务走快照重建；等待审批保持 PAUSED 随迁；受保护实例核对后迁移；无主实例直接回收。",
    execLog: () => [
      ["15:10:02", "info", "调度排除 srv-gpu-02 · 预热池加速补充 +4"],
      ["15:10:30", "info", "sbx-8805 file-snapshot 412MB → srv-gpu-03 重建挂载"],
      ["15:11:12", "ok", "T26-0688 沙箱恢复 · 网络重连 · 上下文完整"],
      ["15:11:40", "info", "sbx-8821 受保护迁移 · 核对证据随快照保留"],
      ["15:12:20", "ok", "3 实例迁移完成 · 0 中断 · 2 保持 PAUSED"],
      ["15:13:00", "info", "Hypervisor 补丁 + GPU 驱动升级"],
      ["15:16:30", "ok", "节点自检通过 · 调度恢复 · 对账无差异"],
    ],
    verify: () => ([
      ["实例状态验证", "迁移实例全部 BOUND · 无漂移标记", "ok"],
      ["任务连续性", "T26-0688 无感知迁移 · 步骤续跑", "ok"],
      ["受保护实例", "sbx-8821 证据完整 · S05 语义全程未破坏", "ok"],
      ["预热池恢复", "WARM 回补至基线 · 命中率 91%", "ok"],
      ["对账验证", "期望-实际双列对账 · 0 差异", "ok"],
      ["审计归档", "MW-2213 · 快照哈希与迁移轨迹入 st-audit", "ok"],
    ]),
    finishTitle: "沙箱节点维护完成 · 实例无感迁移",
    finishNote: "非预期中断 0 · 快照迁移 3 · 受保护实例证据完整 · 对账 0 差异",
    replayToast: "沙箱维护演练已重置。",
    apply: (D) => {
      const sbx = (D.sandboxInstances || []).find(x => x.id === "sbx-8812");
      if (sbx) { sbx.state = "BOUND"; sbx.desired = "BOUND"; delete sbx.note; }
      AXON.pushEvent("沙箱", "ok", "沙箱维护 MW-2213 完成：<b>srv-gpu-02</b> 3 实例无感迁移 · sbx-8812 漂移收敛");
      AXON.toast("维护完成", "srv-gpu-02 补丁完成 · 实例全部恢复 · 对账 0 差异", "ok", 4200);
    },
  };

  /* ── ⑤ 知识库集群滚动升级（副本下限 + 只读降级）────── */
  SC["kb-rolling"] = {
    name: "知识库滚动升级", code: "FR-04",
    desc: "st-kb-biz ×4 副本 · Milvus 2.4→2.4.3 · 只读降级滚动",
    steps: ["对象确认", "影响分析", "前置检查", "准入限制", "滚动排空", "滚动升级", "验证恢复"],
    targetHtml: () => `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="panel" style="border-color:rgba(46,240,168,.4)">
          <div class="panel-head"><h2>升级对象</h2><span class="badge ok">滚动升级</span></div>
          <dl class="kv">
            <dt>集群</dt><dd class="plain">st-kb-biz · 业务知识库集群（Milvus 2.4）</dd>
            <dt>节点</dt><dd class="plain">R02：srv-kbb-01~04 × 4 副本（3 副本 + 1 只读）</dd>
            <dt>升级内容</dt><dd class="plain">Milvus 2.4.3 · 向量索引格式升级</dd>
            <dt>依赖方</dt><dd class="plain">ag-cs 智能客服 · ag-bi 经营分析</dd>
            <dt>审批</dt><dd><span class="badge ok">MW-2214 业务+平台双签</span></dd>
          </dl>
        </div>
        <div class="panel">
          <div class="panel-head"><h2>副本保护策略</h2></div>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:12.5px">
            ${["kbb-01 向量检索/写入", "kbb-02 副本/检索", "kbb-03 重排/缓存", "kbb-04 入库流水线"].map((n, i) => `
              <div style="display:flex;align-items:center;gap:8px"><i class="led ${i === 0 ? "led-warn" : "led-ok"}"></i>srv-${esc(n)}
                <span class="badge ${i === 0 ? "warn" : "ok"}" style="margin-left:auto">${i === 0 ? "首轮目标" : "待轮"}</span></div>`).join("")}
            <p style="font-size:11.5px;color:var(--text-dim);line-height:1.7;margin-top:6px">
              副本下限保护：单轮最多 1 节点下线（4-1=3 ≥ 仲裁 2）；检索降级为只读副本承载；写入队列缓存。</p>
          </div>
        </div>
      </div>`,
    root: "st-kb-biz",
    impactNote: "影响面 = 依赖 st-kb-biz 的 Agent（ag-cs / ag-bi）及其在途任务；只读降级保证检索类调用不中断。",
    checks: (m) => [
      { name: "副本下限校验", note: "4 副本 · 单轮下线 1 · 剩余 3 ≥ 仲裁 2", pass: true },
      { name: "全量快照备份", note: "st-ckpt 保存 4 节点集合快照 · 双副本 · 2.1TB", pass: true },
      { name: "索引兼容性", note: "2.4.3 索引格式向后兼容 · 升级后自动重建", pass: true },
      { name: "不可中断检索检查", note: m.gateResolved
          ? "T26-0729（不可中断 · 依赖知识检索）已降级为只读副本承载 · 写入需求队列化"
          : "T26-0729（季度简报 · 不可中断）同时有知识库写入需求，直接下线节点将中断其写入",
        pass: m.gateResolved, isGate: true, gateBtn: "启用只读降级" },
      { name: "回退方案", note: "快照保留 48h · 节点级一键回滚 2.4", pass: true },
    ],
    onResolveGate: () => {
      AXON.toast("只读降级已启用", "T26-0729 检索走副本 · 写入需求进入队列缓存，升级完成后回放", "ok");
      AXON.pushEvent("准入", "ok", "滚动升级前置：<b>T26-0729</b> 只读降级启用 · 写入队列化 · 阻塞解除");
    },
    forceHtml: "未启用只读降级即下线节点，将中断 <b>T26-0729</b> 的知识库写入（不可中断任务）。需双签授权。",
    admission: () => [
      ["检索降级", "检索流量 100% 切只读副本 · P95 +8ms 可接受"],
      ["写入队列化", "入库/写入请求进队列缓存 · 容量 12 万条"],
      ["重排服务摘除", "kbb-03 重排降载 · 结果缓存延长 2 倍 TTL"],
      ["流水线暂停", "kbb-04 入库流水线暂停 · 断点续传"],
    ],
    admissionStats: () => [["只读承载检索", "100%", "cyan"], ["队列缓存写入", "3.2k/h", "warn"], ["保持检索会话", "全部", "ok"]],
    drain: () => [
      ["srv-kbb-01", "首轮：向量检索/写入", "副本摘除 → 升级中", 100, "warn"],
      ["srv-kbb-02", "检索承载 +37% 流量", "承载中 · P95 41ms", 74, "ok"],
      ["srv-kbb-03", "重排降载 + 缓存", "承载中 · 缓存命中 96%", 88, "ok"],
      ["srv-kbb-04", "流水线暂停", "断点位 #4127 已标记", 62, "ok"],
      ["T26-0729", "季度经营简报 · 不可中断", "检索走副本 · 写入队列 214 条", 55, "warn"],
    ],
    drainNote: "滚动策略：一轮一节点（副本下限 3）；检索不中断，写入队列化回放；每节点升级后一致性校验再进下一轮。",
    execLog: () => [
      ["16:30:02", "info", "只读降级生效 · 检索 100% 走副本 · 写入入队"],
      ["16:30:20", "info", "轮次 1/4：srv-kbb-01 副本摘除 · Milvus 2.4.3"],
      ["16:33:40", "ok", "kbb-01 升级完成 · segcount 一致性校验通过"],
      ["16:34:00", "info", "轮次 2/4：srv-kbb-02 … 轮次 3/4：srv-kbb-03"],
      ["16:41:15", "ok", "kbb-02 / kbb-03 完成 · 副本追平 · lag=0"],
      ["16:42:00", "info", "轮次 4/4：srv-kbb-04 · 流水线自断点 #4127 续传"],
      ["16:45:30", "ok", "4/4 完成 · 写入队列回放 214 条 · 只读解除"],
    ],
    verify: () => ([
      ["副本一致性", "4 副本 segcount 一致 · lag=0", "ok"],
      ["检索验证", "P95 恢复 38ms · 命中率 92% 持平", "ok"],
      ["写入回放", "队列 214 条全回放 · 0 丢失 0 重复", "ok"],
      ["不可中断任务", "T26-0729 全程运行 · 检索/写入无中断", "ok"],
      ["流水线", "kbb-04 断点续传完成 · 入库吞吐恢复", "ok"],
      ["审计归档", "MW-2214 · 4 轮升级轨迹与校验证据入 st-audit", "ok"],
    ]),
    finishTitle: "滚动升级完成 · 检索零中断",
    finishNote: "检索中断 0 · 写入队列回放 214/214 · 不可中断任务全程运行 · 副本一致性 lag=0",
    replayToast: "知识库版本已更新至 2.4.3（重置演练不会回退版本）。",
    apply: (D) => {
      const kb = D.infra.find(f => f.id === "st-kb-biz");
      if (kb) kb.ver = "Milvus 2.4.3";
      AXON.pushEvent("任务", "ok", "滚动升级 MW-2214 完成：<b>st-kb-biz</b> 4 副本升级 2.4.3 · 检索零中断");
      AXON.toast("升级完成", "业务知识库集群 2.4.3 · 副本一致性 lag=0", "ok", 4200);
    },
  };

  /* ══ 编排引擎 ═══════════════════════════════════════════ */

  const SCENARIO_ORDER = ["server-maint", "endpoint-switch", "agent-retire", "sandbox-maint", "kb-rolling"];

  function sc() { return SC[M.scenario]; }

  function renderScenarioBar() {
    const bar = $("#maint-scenarios");
    if (!bar) return;
    bar.innerHTML = SCENARIO_ORDER.map(id => {
      const s = SC[id];
      return `<button class="msc-chip ${id === M.scenario ? "active" : ""}" data-sc="${id}">
        <span class="msc-code">${s.code}</span>${s.name}</button>`;
    }).join("");
    $$("#maint-scenarios .msc-chip").forEach(b => b.addEventListener("click", () => {
      if (M.scenario === b.dataset.sc) return;
      M.scenario = b.dataset.sc;
      resetRun(false);
      render();
    }));
  }

  function resetRun(toast = true) {
    clearTimers();
    M.step = 0; M.gateResolved = false; M.executed = false; M._applied = false;
    if (toast) AXON.toast("演练已重置", sc().replayToast, "info");
  }

  function renderStepper() {
    const steps = sc().steps;
    $("#maint-stepper").innerHTML = steps.map((s, i) => {
      let cls = "";
      if (i < M.step) cls = "past";
      if (i === M.step) cls = (!M.gateResolved && sc().checks(M).some(c => c.isGate && !c.pass) && i === 2) ? "blocked now" : "now";
      return `<div class="ms-step ${cls}"><span class="idx">STEP ${i + 1}</span>${s}</div>`;
    }).join("");
  }

  function ctrlBtns() {
    const s = M.step, scd = sc();
    const gateBlocked = !M.gateResolved && scd.checks(M).some(c => c.isGate && !c.pass);
    const prev = `<button class="btn ghost" id="mt-prev" ${s === 0 ? "disabled" : ""}>上一步</button>`;
    let main = "";
    if (s === 0) main = `<button class="btn" id="mt-next">开始影响分析</button>`;
    if (s === 1) main = `<button class="btn" id="mt-next">确认影响 · 前置检查</button>`;
    if (s === 2) main = gateBlocked
      ? `<button class="btn danger" id="mt-force">强制推进（需授权）</button>`
      : `<button class="btn" id="mt-next">检查通过 · 准入限制</button>`;
    if (s === 3) main = `<button class="btn" id="mt-next">准入已限制 · 进入排空</button>`;
    if (s === 4) main = `<button class="btn" id="mt-next">排空完成 · 开始执行</button>`;
    if (s === 5) main = M.executed
      ? `<button class="btn" id="mt-next">执行完成 · 验证恢复</button>`
      : `<span class="hint">执行中，请等待完成…</span>`;
    if (s === 6) main = `<button class="btn" id="mt-replay">重置演练</button>`;
    const hint = s === 0 ? `${scd.name}：${scd.desc}` : "";
    return `<span class="hint">${hint}</span><div style="display:flex;gap:10px">${prev}${main}</div>`;
  }

  function bindCtrl() {
    $("#maint-ctrl").innerHTML = ctrlBtns();
    const prev = $("#mt-prev");
    if (prev) prev.onclick = () => { M.step = Math.max(0, M.step - 1); render(); };
    const next = $("#mt-next");
    if (next) next.onclick = () => {
      M.step = Math.min(sc().steps.length - 1, M.step + 1);
      if (M.step === 5) M.executed = false;
      render();
    };
    const gate = $("#resolve-gate");
    if (gate) gate.onclick = () => {
      M.gateResolved = true;
      sc().onResolveGate();
      render();
    };
    const force = $("#mt-force");
    if (force) force.onclick = () => AXON.confirm({
      title: "强制推进", html: sc().forceHtml, okText: "授权并强推", danger: true,
      onOk: () => {
        M.gateResolved = true;
        AXON.pushEvent("策略", "crit", `${sc().name} 强推授权通过 · 影响已记录（AUDIT 前置）`);
        AXON.toast("已授权强推", "影响已记录 · 继续推进", "warn");
        render();
      },
    });
    const replay = $("#mt-replay");
    if (replay) replay.onclick = () => { sc().replayReset?.(AXON_DATA); resetRun(); render(); };
  }

  function render() {
    renderScenarioBar();
    renderStepper();
    const stage = $("#maint-stage");
    const s = M.step, scd = sc();
    if (s === 0) stage.innerHTML = scd.targetHtml();
    if (s === 1) stage.innerHTML = impactPanel(scd.root, scd.impactNote);
    if (s === 2) stage.innerHTML = checkPanel(scd.checks(M));
    if (s === 3) stage.innerHTML = admissionPanel(scd.admission(), scd.admissionStats());
    if (s === 4) stage.innerHTML = drainPanel(scd.drain(), scd.drainNote);
    if (s === 5) {
      stage.innerHTML = termPanel();
      if (M.executed) { renderLogFull(scd.execLog()); }
      else playLog(scd.execLog(), () => { M.executed = true; bindCtrl(); });
    }
    if (s === 6) stage.innerHTML = verifyPanel(scd.verify(), scd.finishTitle, scd.finishNote);
    bindCtrl();

    /* 完成时落盘世界状态 */
    if (s === 6 && !M._applied) {
      M._applied = true;
      scd.apply(AXON_DATA);
    }
    if (s !== 6) M._applied = false;
  }

  AXON.on("view", (v) => { if (v === "maint" && !$("#maint-stage").children.length) render(); });
  AXON.on("maint-prefill", () => { M.scenario = "server-maint"; resetRun(false); render(); });

  render();
})();
