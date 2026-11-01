/* ═══════════════════════════════════════════════════════════
   AXON · Live 视图内置模拟控制平面（仅线上演示形态）
   ─────────────────────────────────────────────────────────
   GitHub Pages 无法运行 Node 服务端，本模块在前端复刻控制平面的
   关键语义：同一状态机 / 同一套 caps 门控（451）/ 412 强推确认 /
   opId 三段式 / 事件流，让线上演示与本地真实模式观感一致。

   启用条件：live.js 探测 /api/v1/meta 不可达（且本模块已加载）。
   本地运行 node server/index.mjs 时始终走真实 API，本模块不介入。
   ═══════════════════════════════════════════════════════════ */
(function () {
  const pad2 = (n) => String(n).padStart(2, "0");
  const now = () => new Date();
  const hhmmss = (d = now()) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad2).join(":");
  const rnd = (a, b) => a + Math.random() * (b - a);
  const uid = (p, n = 4) => p + Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

  /* ── 状态机（与 server/statemachine.mjs 同表）────────── */
  const TRANSITIONS = {
    queued: ["running", "cancelled"],
    running: ["succeeded", "failed", "cancelled", "waiting_approval", "checkpointed", "unknown"],
    waiting_approval: ["running", "cancelled"],
    checkpointed: ["recovering", "cancelled"],
    recovering: ["running", "failed", "cancelled"],
    unknown: ["succeeded", "failed", "cancelled"],
    succeeded: [], failed: [], cancelled: [],
  };
  const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

  /* ── 世界模型（与 server/model.mjs 同源子集）──────────── */
  const S = {
    started: false, timer: null, listeners: [],
    taskSeq: 750, opSeq: 4822,
    agents: [
      { id: "ag-cs", name: "智能客服 Agent", state: "running", tenant: "customer-svc", live: false, caps: { observe: 1, traffic: 1, instance: 1, state: 1, task: 1 } },
      { id: "ag-coder", name: "代码助手 Agent", state: "running", tenant: "dev-tools", live: false, caps: { observe: 1, traffic: 1, instance: 1, state: 1, task: 1 } },
      { id: "ag-ops", name: "运维巡检 Agent", state: "running", tenant: "platform", live: false, caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 } },
      { id: "ag-bi", name: "经营分析 Agent", state: "running", tenant: "data-biz", live: false, caps: { observe: 1, traffic: 1, instance: 0, state: 1, task: 1 } },
      { id: "ag-risk", name: "风控审核 Agent", state: "running", tenant: "sec", live: false, caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 } },
      { id: "ag-dm", name: "数据治理 Agent", state: "gray", tenant: "data-biz", live: false, caps: { observe: 1, traffic: 1, instance: 0, state: 0, task: 0 } },
      { id: "ag-live-01", name: "Live 接入演示 Agent", state: "running", tenant: "platform", live: true,
        caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 }, lastHeartbeat: new Date().toISOString() },
    ],
    tasks: [
      { id: "T26-0688", name: "支付模块重构 · 阶段 2", agent: "ag-coder", state: "running", progress: 38, interruptible: true, requiresApproval: false, approvalPassed: true, tokensM: 2.4 },
      { id: "T26-0712", name: "工单批量归档 · 夜间批", agent: "ag-cs", state: "running", progress: 71, interruptible: true, requiresApproval: false, approvalPassed: true, tokensM: 1.1 },
      { id: "T26-0733", name: "全链路夜间巡检", agent: "ag-ops", state: "running", progress: 12, interruptible: true, requiresApproval: false, approvalPassed: true, tokensM: 0.6 },
      { id: "T26-0729", name: "季度经营简报生成", agent: "ag-bi", state: "running", progress: 55, interruptible: false, requiresApproval: false, approvalPassed: true, tokensM: 3.8 },
      { id: "T26-0731", name: "供应商准入风控审核", agent: "ag-risk", state: "waiting_approval", progress: 62, interruptible: false, requiresApproval: true, approvalPassed: false, tokensM: 1.2, waitReason: "外部 ERP 写入授权 · 等待安全风控审批" },
      { id: "T26-0725", name: "高风险退款复核", agent: "ag-risk", state: "waiting_approval", progress: 28, interruptible: false, requiresApproval: true, approvalPassed: false, tokensM: 0.4, waitReason: "等待客服业务部补充订单上下文" },
      { id: "T26-0719", name: "客户投诉深查报告", agent: "ag-cs", state: "checkpointed", progress: 81, interruptible: true, requiresApproval: false, approvalPassed: true, tokensM: 1.9, ckpt: { id: "cp-55d0", mode: "full-snapshot" } },
      { id: "T26-0741", name: "发布流水线代码审计", agent: "ag-coder", state: "queued", progress: 0, interruptible: true, requiresApproval: false, approvalPassed: true, tokensM: 0 },
      { id: "T26-0705", name: "库存对账重跑", agent: "ag-bi", state: "recovering", progress: 44, interruptible: true, requiresApproval: false, approvalPassed: true, tokensM: 2.2 },
      { id: "T26-0677", name: "ERP 批量写入 · 供应商台账", agent: "ag-risk", state: "unknown", progress: 87, interruptible: false, requiresApproval: false, approvalPassed: true, tokensM: 0.9, waitReason: "工具调用超时且无幂等键 · 人工核对（S12）" },
    ],
    ops: [
      { opId: "OP-4821", action: "sandbox.checkpoint", target: "sbx-8805", label: "沙箱快照（file-snapshot）", status: "verified", ts: hhmmss() },
      { opId: "OP-4819", action: "route.update-weights", target: "rr-glm-default", label: "路由 rr-glm-default 主端点权重 → 86%", status: "verified", ts: hhmmss() },
    ],
    events: [],
  };

  /* ── 事件与操作 ──────────────────────────────────────── */
  function emit(kind, tag, cls, msg, subject) {
    const item = { ts: hhmmss(), kind, tag, cls, msg, subject };
    S.events.unshift(item);
    S.events = S.events.slice(0, 60);
    S.listeners.forEach((fn) => fn({ kind, item }));
  }
  function opRecord(action, target, label) {
    const op = { opId: "OP-" + (S.opSeq++), action, target, label, status: "accepted", ts: hhmmss() };
    S.ops.unshift(op);
    S.ops = S.ops.slice(0, 30);
    setTimeout(() => { op.status = "executed"; S.listeners.forEach((fn) => fn({ kind: "op", op })); }, 700);
    setTimeout(() => {
      op.status = "verified";
      S.listeners.forEach((fn) => fn({ kind: "op", op }));
      emit("policy", "操作", "info", `<b>${op.opId}</b> ${label} — 三段式完成（受理→执行→验证）`);
    }, 1900);
    return op;
  }
  const agentOf = (t) => S.agents.find((a) => a.id === t.agent);
  function setState(t, to, extraMsg, cls) {
    const legal = TRANSITIONS[t.state] || [];
    if (!legal.includes(to)) return { status: 409, ok: false, json: err("STATE_TRANSITION_INVALID", `任务 ${t.id} 不允许 ${t.state} → ${to} 迁移`) };
    t.state = to;
    emit("task", "任务", cls || "ok", `<b>${t.id}</b> → ${to}${extraMsg ? " · " + extraMsg : ""}`, t.id);
    return null;
  }
  const err = (code, message) => ({ error: { code, message } });
  const ok = (body, status = 200) => ({ status, ok: true, json: body });

  /* ── 模拟 API（与 server/api.mjs 响应形状一致）────────── */
  function call(method, path, body) {
    const clean = path.split("?")[0].replace(/^\//, "");
    const parts = clean.split("/");
    body = body || {};

    if (method === "GET" && clean === "api/v1/agents") return ok(S.agents.map((a) => ({ ...a })));
    if (method === "GET" && clean === "api/v1/tasks") return ok([...S.tasks].map((t) => ({ ...t })).reverse());
    if (method === "GET" && clean === "api/v1/ops") return ok(S.ops.slice(0, 12));
    if (method === "GET" && clean === "api/v1/meta") return ok(meta());

    if (method === "POST" && clean === "api/v1/tasks") {
      const agent = S.agents.find((a) => a.id === body.agent);
      if (!agent) return { status: 404, ok: false, json: err("NOT_FOUND", `Agent ${body.agent} 不存在`) };
      const t = {
        id: `T${String(now().getFullYear()).slice(2)}${pad2(Math.ceil(((now() - new Date(now().getFullYear(), 0, 1)) / 86400000 + 1) / 7))}-${String(S.taskSeq++).padStart(4, "0")}`,
        name: body.name || "未命名任务", agent: agent.id, state: "queued", progress: 0,
        interruptible: body.interruptible !== false, requiresApproval: !!body.requiresApproval,
        approvalPassed: !body.requiresApproval, tokensM: 0, simBorn: true,
      };
      S.tasks.push(t);
      emit("task", "任务", "info", `<b>${t.id}</b> 创建（${t.name} · ${agent.id} · 等待认领）`, t.id);
      return ok({ ...t }, 201);
    }

    // /api/v1/tasks/{id}/{action}
    if (parts[0] === "api" && parts[1] === "v1" && parts[2] === "tasks" && parts[3] && parts[4]) {
      const t = S.tasks.find((x) => x.id === parts[3]);
      if (!t) return { status: 404, ok: false, json: err("NOT_FOUND", `任务 ${parts[3]} 不存在`) };
      const a = agentOf(t);

      if (parts[4] === "approve") {
        if (t.state !== "waiting_approval") return { status: 409, ok: false, json: err("STATE_TRANSITION_INVALID", `任务 ${t.id} 当前 ${t.state}，非等待审批`) };
        t.approvalPassed = true;
        delete t.waitReason;
        const r = setState(t, "running", `审批通过（${body.approvedBy || "操作员"}）· 授权已重检`);
        if (r) return r;
        opRecord("task.approve", t.id, "审批通过 → 续跑");
        return ok({ ...t });
      }
      if (parts[4] === "checkpoint") {
        if (!a.caps?.state) return { status: 451, ok: false, json: err("CAPABILITY_NOT_DECLARED", `Agent ${t.agent} 未声明 state 能力，「检查点暂存」入口关闭（未支持 / 需人工处理，禁止静默降级）`) };
        if (t.state !== "running") return { status: 409, ok: false, json: err("STATE_TRANSITION_INVALID", `任务 ${t.id} 当前 ${t.state}，不可暂存`) };
        t.ckpt = { id: uid("cp-"), mode: "app-checkpoint" };
        const r = setState(t, "checkpointed", `检查点 ${t.ckpt.id} 已保存 · 资源释放`, "info");
        if (r) return r;
        opRecord("task.checkpoint", t.id, `检查点暂存（${t.ckpt.mode}）`);
        return ok({ ...t });
      }
      if (parts[4] === "restore") {
        if (t.state !== "checkpointed") return { status: 409, ok: false, json: err("STATE_TRANSITION_INVALID", `任务 ${t.id} 当前 ${t.state}，不可恢复`) };
        const r = setState(t, "recovering", "自检查点恢复 · 环境重建 / 网络重连", "info");
        if (r) return r;
        opRecord("task.restore", t.id, `自检查点 ${t.ckpt?.id} 恢复`);
        setTimeout(() => {
          if (t.state === "recovering") setState(t, "running", "恢复完成 · 上下文完整性校验通过");
        }, 1300);
        return ok({ ...t });
      }
      if (parts[4] === "cancel") {
        if (!a.caps?.task) return { status: 451, ok: false, json: err("CAPABILITY_NOT_DECLARED", `Agent ${t.agent} 未声明 task 能力，「取消任务」入口关闭（需人工处理）`) };
        if (t.interruptible === false && body.force !== true) {
          return { status: 412, ok: false, json: err("PRECONDITION_FAILED", `任务 ${t.id} 不可中断，取消需要 force=true 二次确认（不可逆外部操作提示）`) };
        }
        const r = setState(t, "cancelled", "人工取消 · 产物按保留策略归档", "warn");
        if (r) return r;
        opRecord("task.cancel", t.id, "任务取消");
        return ok({ ...t });
      }
      if (parts[4] === "result") {
        const to = body.status;
        if (!["succeeded", "failed", "unknown"].includes(to)) return { status: 400, ok: false, json: err("BAD_REQUEST", "status 必须为 succeeded/failed/unknown") };
        const r = setState(t, to, body.summary || "", to === "succeeded" ? "ok" : "warn");
        if (r) return r;
        if (body.summary) t.resultSummary = body.summary;
        opRecord("task.result", t.id, `回报终态 ${to}`);
        return ok({ ...t });
      }
    }
    return { status: 404, ok: false, json: err("NOT_FOUND", `模拟控制平面未实现 ${method} ${path}`) };
  }

  const meta = () => ({ product: "AXON Control Plane", version: "0.95.0-sim", spec: "v0.95", sim: true, setupRequired: false });

  /* ── 模拟引擎：Worker 心跳 / 认领 / 推进 / 审批门 / 终态 ── */
  const AUTO_TASKS = [
    ["夜间批处理 · 知识库增量", "ag-cs"], ["供应商对账单核验", "ag-risk"], ["Release Notes 生成", "ag-coder"],
    ["全链路巡检报告汇总", "ag-ops"], ["工单情绪分析批处理", "ag-cs"], ["代码审计 · 依赖升级评估", "ag-coder"],
    ["经营日报快照生成", "ag-bi"], ["数据管道健康检查", "ag-ops"],
  ];
  let autoIdx = 0, ticks = 0;

  function tick() {
    ticks++;
    const live = S.agents.find((a) => a.id === "ag-live-01");
    if (live) live.lastHeartbeat = new Date().toISOString();

    for (const t of S.tasks) {
      if (t.state === "queued" && (t.simClaimAt ||= ticks + 2) <= ticks) {
        t.state = "running";
        emit("task", "任务", "info", `<b>${t.id}</b> 被 ${t.agent} 认领，进入运行`, t.id);
        opRecord("task.claim", t.id, `任务认领 → ${t.agent}`);
      } else if (t.state === "running") {
        t.progress = Math.min(100, +(t.progress + rnd(2, 5)).toFixed(1));
        t.tokensM = +(t.tokensM + 0.01).toFixed(2);
        if (t.requiresApproval && !t.approvalPassed && t.progress >= 60 && t.progress < 100) {
          t.state = "waiting_approval";
          t.waitReason = "外部写入授权 · 等待审批";
          emit("task", "任务", "warn", `<b>${t.id}</b> 进入等待审批：${t.waitReason}`, t.id);
        } else if (t.progress >= 100) {
          const to = Math.random() < 0.1 ? "failed" : "succeeded";
          setState(t, to, to === "succeeded" ? "Worker 模拟执行完成" : "步骤校验失败（模拟）", to === "succeeded" ? "ok" : "crit");
          opRecord("task.result", t.id, `回报终态 ${to}`);
        } else if (ticks % 3 === 0) {
          emit("task", "任务", "ok", `<b>${t.id}</b> 运行中 · ${Math.round(t.progress)}%`, t.id);
        }
      } else if (t.state === "recovering") {
        t.progress = Math.min(100, t.progress + rnd(1, 3));
        if (t.progress >= 99.5 || Math.random() < 0.1) setState(t, "running", "恢复完成 · 上下文完整性校验通过");
      }
    }

    // 自动补充演示任务，保持画面持续有活动
    const active = S.tasks.filter((t) => !TERMINAL.has(t.state));
    if (active.length < 5 && ticks % 14 === 0) {
      const [name, agent] = AUTO_TASKS[autoIdx++ % AUTO_TASKS.length];
      call("POST", "/api/v1/tasks", { name, agent, requiresApproval: Math.random() < 0.5 });
    }
    S.tasks = S.tasks.slice(-30);
    S.listeners.forEach((fn) => fn({ kind: "refresh" }));
  }

  function start(onEvent) {
    if (S.started) return;
    S.started = true;
    S.listeners.push(onEvent);
    if (!S.events.length) {
      emit("policy", "准入", "info", "<b>ag-live-01</b> 注册接入：caps={observe,traffic,instance,state:0,task}（注册接入 ≠ 控制能力）", "ag-live-01");
      emit("policy", "配额", "warn", "租户 <b>dev-tools</b> Token 使用 88%，已通知负责人", "dev-tools");
      emit("policy", "核对", "info", "<b>T26-0677</b> 结果未知入人工核对队列（幂等键缺失，禁止自动重放）", "T26-0677");
    }
    S.timer = setInterval(tick, 1600);
    tick();
  }
  function stop() { clearInterval(S.timer); S.timer = null; S.started = false; S.listeners = []; }

  window.AXON_LIVE_SIM = { call, start, stop, meta };
})();
