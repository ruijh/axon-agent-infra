/* ═══════════════════════════════════════════════════════════
   AXON · REST API 资源面（SPEC §9.1）
   Web UI / CLI / MCP / Worker 四个入口统一走这里：
   auth → dispatch → statemachine → policy → receipts(opId)
   ═══════════════════════════════════════════════════════════ */
import { createHash } from "node:crypto";
import { ApiError, newTaskId, newSbxId, newCpId } from "./util.mjs";
import { authenticate, requireRole, setup, createKey, ROLES } from "./auth.mjs";
import { transition, claimable } from "./statemachine.mjs";
import { impactAnalysis } from "./impact.mjs";
import { submitOp, auditOp, ACTIONS } from "./ops.mjs";
import { openApiDocument, docsHtml } from "./openapi.mjs";

const VERSION = "0.95.0";

/* ── 工具 ── */
const hashOf = (s) => createHash("sha256").update(s).digest("hex");
const num = (v, def) => (v === undefined || v === null || isNaN(Number(v)) ? def : Number(v));
const publicTask = (t) => ({ ...t });

function emitTaskEvent(ctx, task, msg, severity = "info") {
  const e = ctx.store.pushEvent({ kind: "task", type: "任务", severity, source: "axon", subject: task.id,
    msg: `${task.id} ${msg}`, refs: [task.agent].filter(Boolean) });
  ctx.sse.broadcast("task", { id: task.id, state: task.state, msg: e.msg });
  return e;
}

function guardCaps(agent, cap, opName) {
  if (!agent.caps?.[cap]) {
    throw new ApiError(451, "CAPABILITY_NOT_DECLARED",
      `Agent ${agent.id} 未声明 ${cap} 能力，「${opName}」入口关闭（未支持 / 需人工处理，禁止静默降级）`);
  }
}

/** 路由表：[method, pattern, perm, handler(ctx, req, res, match)]
    pattern 用 :param 占位；perm 为空数组表示免鉴权 */
export function createApi(ctx) {
  const routes = [
    ["GET", "/api/v1/meta", [], (c) => json(c.res, 200, {
      product: "AXON Control Plane", version: VERSION, spec: "v0.95",
      setupRequired: !c.store.listKeys().some(k => !k.revoked),
      roles: ROLES, actions: Object.keys(ACTIONS),
    })],

    ["POST", "/api/v1/setup", [], (c) => {
      const key = setup(c.store, c.body || {});
      c.store.pushEvent({ kind: "policy", type: "准入", severity: "warn", source: "axon", subject: "setup",
        msg: `控制平面初始化：创建根密钥 ${key.id}（${key.role}）。请妥善保存 token，仅此一次返回。`, refs: [] });
      json(c.res, 201, { keyId: key.id, role: key.role, token: key.token, note: "token 仅此一次返回，请妥善保存" });
    }],

    ["GET", "/api/v1/openapi.json", [], (c) => json(c.res, 200, openApiDocument())],
    ["GET", "/api/v1/docs", [], (c) => html(c.res, docsHtml())],

    /* ── 资产与网络（L0）── */
    ["GET", "/api/v1/servers", ["read"], (c) => json(c.res, 200, c.store.servers.map(s => { const { _kind, ...o } = s; return o; }))],
    ["GET", "/api/v1/racks", ["read"], (c) => json(c.res, 200, c.store.objects("rack").map(strip))],
    ["GET", "/api/v1/netdevices", ["read"], (c) => json(c.res, 200, c.store.objects("netdevice").map(strip))],
    ["GET", "/api/v1/netlinks", ["read"], (c) => json(c.res, 200, c.store.objects("netlink").map(strip))],

    /* ── Infra 目录（L1/L2）── */
    ["GET", "/api/v1/infra", ["read"], (c) => json(c.res, 200, c.store.infra.map(strip))],
    ["GET", "/api/v1/models", ["read"], (c) => json(c.res, 200, c.store.models.map(strip))],
    ["GET", "/api/v1/tools", ["read"], (c) => json(c.res, 200, c.store.tools.map(strip))],
    ["PATCH", "/api/v1/tools/:id", ["governance"], (c) => {
      const t = c.store.object(c.match.id);
      if (!t || t._kind !== "tool") throw new ApiError(404, "NOT_FOUND", `工具 ${c.match.id} 不存在`);
      if (c.body.contract) t.contract = c.body.contract;
      if (c.body.ver) t.ver = c.body.ver;
      if (c.body.idem !== undefined) t.idem = !!c.body.idem;
      c.store.putObject("tool", t);
      c.store.pushEvent({ kind: "policy", type: "核对", severity: "info", source: "gw-mcp", subject: t.id,
        msg: `工具契约登记更新：contract=${t.contract} idem=${t.idem}`, refs: [] });
      json(c.res, 200, strip(t));
    }],

    /* ── Agent（L3）：注册 / 心跳 / 目录（pull 模型 · 对标 mission-control）── */
    ["GET", "/api/v1/agents", ["read"], (c) => json(c.res, 200, c.store.agents())],
    ["POST", "/api/v1/agents/register", ["agentMachine"], (c) => {
      const b = c.body || {};
      if (!b.id || !b.name) throw new ApiError(400, "BAD_REQUEST", "注册需要 id 与 name");
      const caps = Object.fromEntries(["observe", "traffic", "instance", "state", "task"]
        .map(k => [k, b.caps?.[k] ? 1 : 0]));   // 未声明即 0：能力声明是操作准入的唯一依据（§4）
      const existing = c.store.agent(b.id);
      const agent = existing || {
        id: b.id, name: b.name, ver: b.ver || "v0.1.0", owner: b.owner || "runtime-registered",
        tenant: b.tenant || "platform", state: "running", instances: 1,
        runtime: b.runtime || "rt-langgraph", models: b.models || [], tools: b.tools || [], stores: [],
      };
      agent.caps = caps;
      agent.live = true;
      agent.lastHeartbeat = new Date().toISOString();
      agent.registeredAt = agent.registeredAt || new Date().toISOString();
      c.store.putAgent(agent);
      emitAgentEvent(c, agent.id, `Agent 注册接入：caps=${JSON.stringify(caps)}（注册接入 ≠ 控制能力）`);
      json(c.res, existing ? 200 : 201, agent);
    }],
    ["GET", "/api/v1/agents/:id", ["read"], (c) => {
      const a = c.store.agent(c.match.id);
      if (!a) throw new ApiError(404, "NOT_FOUND", `Agent ${c.match.id} 不存在`);
      json(c.res, 200, a);
    }],
    ["POST", "/api/v1/agents/:id/heartbeat", ["agentMachine"], (c) => {
      const a = c.store.agent(c.match.id);
      if (!a) throw new ApiError(404, "NOT_FOUND", `Agent ${c.match.id} 未注册`);
      a.lastHeartbeat = new Date().toISOString();
      if (c.body?.status) a.presence = c.body.status;
      c.store.putAgent(a);
      json(c.res, 200, { id: a.id, lastHeartbeat: a.lastHeartbeat, admission: a.admission || "open" });
    }],

    /* ── 任务（L4）：创建 / 队列 / 认领 / 状态机操作 ── */
    ["GET", "/api/v1/tasks", ["read"], (c) => {
      let list = c.store.tasks().map(publicTask);
      if (c.query.get("state")) list = list.filter(t => t.state === c.query.get("state"));
      if (c.query.get("agent")) list = list.filter(t => t.agent === c.query.get("agent"));
      json(c.res, 200, list);
    }],
    ["POST", "/api/v1/tasks", ["taskWrite"], (c) => {
      const b = c.body || {};
      const agent = c.store.agent(b.agent);
      if (!agent) throw new ApiError(404, "NOT_FOUND", `Agent ${b.agent} 不存在`);
      if (!b.name) throw new ApiError(400, "BAD_REQUEST", "任务需要 name");
      const tenant = c.store.tenant(agent.tenant);
      if (tenant && tenant.tokenUsed >= tenant.tokenBudget) {   // §2.7 配额硬阈值
        c.store.pushEvent({ kind: "policy", type: "配额", severity: "crit", source: "gw-model", subject: tenant.id,
          msg: `任务创建被拒：租户 ${tenant.id} Token 配额已耗尽（${tenant.tokenUsed}/${tenant.tokenBudget}M）`, refs: [agent.id] });
        throw new ApiError(429, "QUOTA_EXCEEDED",
          `租户 ${tenant.id} Token 配额已耗尽（${tenant.tokenUsed}/${tenant.tokenBudget}M）`);
      }
      const task = {
        id: newTaskId(c.store.nextTaskSeq()), name: b.name, agent: agent.id, tenant: agent.tenant,
        state: "queued", progress: 0, interruptible: b.interruptible !== false,
        requiresApproval: !!b.requiresApproval, tokensM: 0, costCny: 0,
        createdAt: new Date().toISOString(), createdBy: c.key.name,
      };
      c.store.putTask(task);
      emitTaskEvent(c, task, `创建（${task.name} · ${agent.id} · 租户 ${task.tenant}）`);
      json(c.res, 201, task);
    }],
    ["GET", "/api/v1/tasks/queue", ["taskMachine"], (c) => {
      const agentId = c.query.get("agent");
      const list = c.store.tasks().filter(t => claimable(t, agentId));
      json(c.res, 200, list);
    }],
    ["POST", "/api/v1/tasks/:id/claim", ["taskMachine"], (c) => {
      const task = mustTask(c);
      const agentId = c.body?.agent || c.key.name;
      if (!claimable(task, agentId)) {
        throw new ApiError(409, "STATE_TRANSITION_INVALID",
          `任务 ${task.id} 当前 ${task.state}（agent=${task.agent}），不可被 ${agentId} 认领`);
      }
      const agent = c.store.agent(agentId) || c.store.agent(task.agent);
      task.agent = c.store.agent(agentId) ? agentId : task.agent;
      transition(task, "running", agent);
      task.startedAt = new Date().toISOString();
      c.store.putTask(task);
      const op = auditOp(c.ctx, { action: "task.claim", target: task.id, label: `任务认领 → ${task.agent}`,
        requestedBy: agentId, expect: s => s.task(task.id)?.state === "running" });
      emitTaskEvent(c, task, `被 ${task.agent} 认领，进入运行`, "info");
      json(c.res, 200, { task, opId: op.opId });
    }],
    ["PATCH", "/api/v1/tasks/:id", ["taskMachine"], (c) => {
      const task = mustTask(c);
      const b = c.body || {};
      if (b.requestApproval && task.state === "running") {
        transition(task, "waiting_approval", c.store.agent(task.agent), {});
        task.waitReason = b.requestApproval;
        c.store.putTask(task);
        emitTaskEvent(c, task, `进入等待审批：${task.waitReason}`, "warn");
      } else if (b.resultUnknown && task.state === "running") {
        transition(task, "unknown", c.store.agent(task.agent), { waitReason: b.resultUnknown });
        c.store.putTask(task);
        c.store.pushEvent({ kind: "policy", type: "核对", severity: "crit", source: "gw-mcp", subject: task.id,
          msg: `${task.id} 工具超时且无幂等键 → 结果待核对（禁止自动重放，S12）`, refs: [task.agent] });
        c.ctx.sse.broadcast("task", { id: task.id, state: task.state, msg: "结果未知 · 入人工核对队列" });
      } else {
        if (b.progress !== undefined) {
          if (!["running", "recovering", "waiting_approval"].includes(task.state)) {
            throw new ApiError(409, "STATE_TRANSITION_INVALID", `任务 ${task.id} 状态 ${task.state} 不可更新进度`);
          }
          task.progress = Math.max(0, Math.min(100, num(b.progress, task.progress)));
        }
        if (b.tokensM !== undefined) task.tokensM = +num(b.tokensM, task.tokensM).toFixed(3);
        if (b.costCny !== undefined) task.costCny = Math.round(num(b.costCny, task.costCny));
        if (b.note !== undefined) task.note = b.note;
        c.store.putTask(task);
        c.ctx.sse.broadcast("task", { id: task.id, state: task.state, progress: task.progress });
      }
      json(c.res, 200, publicTask(task));
    }],
    ["POST", "/api/v1/tasks/:id/approve", ["taskApprove"], (c) => {
      const task = mustTask(c);
      const agent = c.store.agent(task.agent);
      const sideEffects = transition(task, "running", agent, { approvedBy: (c.body || {}).approvedBy || c.key.name });
      task.approvedBy = (c.body || {}).approvedBy || c.key.name;
      c.store.putTask(task);
      auditOp(c.ctx, { action: "task.approve", target: task.id, label: `审批通过 → 续跑`,
        requestedBy: task.approvedBy, expect: s => s.task(task.id)?.state === "running" });
      emitTaskEvent(c, task, sideEffects.join(" · "), "ok");
      c.store.pushEvent({ kind: "policy", type: "准入", severity: "info", source: "svc-iam", subject: task.id,
        msg: `${task.id} 审批通过（${task.approvedBy}）· 授权重检通过 · 通知负责人`, refs: [task.agent] });
      json(c.res, 200, publicTask(task));
    }],
    ["POST", "/api/v1/tasks/:id/cancel", ["taskWrite"], (c) => {
      const task = mustTask(c);
      const agent = c.store.agent(task.agent);
      guardCaps(agent, "task", "取消任务");   // §4.1 任务控制能力
      transition(task, "cancelled", agent, { force: (c.body || {}).force });
      c.store.putTask(task);
      auditOp(c.ctx, { action: "task.cancel", target: task.id, label: `任务取消${task.interruptible === false ? "（强推 · 已审计）" : ""}`,
        requestedBy: c.key.name, expect: s => s.task(task.id)?.state === "cancelled" });
      emitTaskEvent(c, task, "人工取消 · 产物按保留策略归档", "warn");
      json(c.res, 200, publicTask(task));
    }],
    ["POST", "/api/v1/tasks/:id/checkpoint", ["taskWrite"], (c) => {
      const task = mustTask(c);
      const agent = c.store.agent(task.agent);
      guardCaps(agent, "state", "检查点暂存");
      transition(task, "checkpointed", agent, { ckptId: newCpId(), mode: (c.body || {}).mode });
      c.store.putTask(task);
      auditOp(c.ctx, { action: "task.checkpoint", target: task.id, label: `检查点暂存（${task.ckpt.mode}）`,
        requestedBy: c.key.name, expect: s => s.task(task.id)?.state === "checkpointed" });
      emitTaskEvent(c, task, `检查点 ${task.ckpt.id} 已保存 · 计算资源释放`, "info");
      json(c.res, 200, publicTask(task));
    }],
    ["POST", "/api/v1/tasks/:id/restore", ["taskWrite"], (c) => {
      const task = mustTask(c);
      const agent = c.store.agent(task.agent);
      guardCaps(agent, "state", "检查点恢复");
      transition(task, "recovering", agent, {});
      c.store.putTask(task);
      auditOp(c.ctx, { action: "task.restore", target: task.id, label: `自检查点 ${task.ckpt?.id} 恢复`,
        requestedBy: c.key.name, expect: s => ["recovering", "running"].includes(s.task(task.id)?.state) });
      emitTaskEvent(c, task, "自检查点恢复 · 环境重建 / 网络重连", "info");
      // 恢复完成（上下文完整性校验通过）→ running
      setTimeout(() => {
        const t = c.store.task(task.id);
        if (t && t.state === "recovering") {
          transition(t, "running", agent, {});
          c.store.putTask(t);
          emitTaskEvent(c, t, "恢复完成 · 上下文完整性校验通过（记录恢复点损失：无）", "ok");
        }
      }, 1200);
      json(c.res, 200, publicTask(task));
    }],
    ["POST", "/api/v1/tasks/:id/result", ["taskMachine"], (c) => {
      const task = mustTask(c);
      const agent = c.store.agent(task.agent);
      const b = c.body || {};
      const to = b.status;
      if (!["succeeded", "failed", "unknown"].includes(to)) {
        throw new ApiError(400, "BAD_REQUEST", "result.status 必须为 succeeded / failed / unknown");
      }
      if (task.state !== "running" && !(task.state === "unknown" && to !== "unknown")) {
        throw new ApiError(409, "STATE_TRANSITION_INVALID", `任务 ${task.id} 状态 ${task.state}，不可回报终态`);
      }
      if (b.tokensM) task.tokensM = +(task.tokensM + num(b.tokensM, 0)).toFixed(3);
      if (b.summary) task.resultSummary = b.summary;
      transition(task, to, agent, { waitReason: b.reason });
      task.finishedAt = new Date().toISOString();
      c.store.putTask(task);
      // Token 计入租户配额（§2.7），双阈值行为
      const tenant = c.store.tenant(task.tenant);
      if (tenant && b.tokensM) {
        tenant.tokenUsed = +Math.min(tenant.tokenBudget * 1.2, tenant.tokenUsed + num(b.tokensM, 0)).toFixed(1);
        c.store.putObject("tenant", tenant);
        const pct = tenant.tokenUsed / tenant.tokenBudget * 100;
        if (pct >= 85) c.store.pushEvent({ kind: "policy", type: "配额", severity: pct >= 100 ? "crit" : "warn",
          source: "gw-model", subject: tenant.id,
          msg: `租户 ${tenant.id} Token 使用 ${Math.round(pct)}%（${tenant.tokenUsed}/${tenant.tokenBudget}M）${pct >= 100 ? "· 已硬限流" : "· 已通知负责人"}`, refs: [] });
      }
      auditOp(c.ctx, { action: "task.result", target: task.id, label: `回报终态 ${to}`,
        requestedBy: c.key.name, expect: s => s.task(task.id)?.state === to });
      emitTaskEvent(c, task, `回报终态：${to}${b.summary ? ` · ${b.summary}` : ""}`, to === "succeeded" ? "ok" : "warn");
      json(c.res, 200, publicTask(task));
    }],

    /* ── 沙箱实例（§2.9 / §6.1：期望-实际双列）── */
    ["GET", "/api/v1/sandboxes", ["read"], (c) => {
      const list = c.store.sandboxes();
      json(c.res, 200, list.map(x => ({ ...x, drift: x.state !== x.desiredState })));
    }],
    ["POST", "/api/v1/sandboxes", ["taskWrite"], (c) => {
      const b = c.body || {};
      const tenant = c.store.tenant(b.tenant || "platform");
      if (!tenant) throw new ApiError(404, "NOT_FOUND", `租户 ${b.tenant} 不存在`);
      if (tenant.sandboxUsed >= tenant.sandboxQuota) {   // §2.7 ≥100%：限制新分配
        c.store.pushEvent({ kind: "policy", type: "配额", severity: "warn", source: "sb-e2b", subject: tenant.id,
          msg: `沙箱创建被限：租户 ${tenant.id} 并发 ${tenant.sandboxUsed}/${tenant.sandboxQuota}，新分配排队`, refs: [] });
        throw new ApiError(429, "QUOTA_EXCEEDED", `租户 ${tenant.id} 沙箱并发配额已满（${tenant.sandboxUsed}/${tenant.sandboxQuota}）`);
      }
      const x = {
        id: newSbxId(), cluster: b.cluster || "sb-e2b", template: b.template || "ubuntu-24-nocode-c4",
        state: "WARM", desiredState: b.desiredState || "BOUND", ownerTask: b.ownerTask || null,
        tenant: tenant.id, leaseMin: b.leaseMin ?? 45, renewable: b.renewable !== false,
        resources: b.resources || { vcpu: 4, memG: 8 },
        netPolicy: b.netPolicy || { egress: "allowlist", cidrs: ["10.32.0.0/16"] },
      };
      c.store.putSandbox(x);
      tenant.sandboxUsed += 1;
      c.store.putObject("tenant", tenant);
      json(c.res, 201, x);
    }],
    ["POST", "/api/v1/sandboxes/:id/checkpoint", ["taskWrite"], (c) => {
      const x = c.store.sandbox(c.match.id);
      if (!x) throw new ApiError(404, "NOT_FOUND", `沙箱 ${c.match.id} 不存在`);
      const mode = ["app-checkpoint", "file-snapshot", "full-snapshot"].includes(c.body?.mode) ? c.body.mode : "file-snapshot";
      x.snapshot = { mode, at: new Date().toISOString() };
      c.store.putSandbox(x);
      auditOp(c.ctx, { action: "sandbox.checkpoint", target: x.id, label: `沙箱快照（${mode}）`,
        requestedBy: c.key.name, expect: s => !!s.sandbox(x.id)?.snapshot });
      json(c.res, 200, x);
    }],

    /* ── 影响分析（§3.3 · 差异化能力）── */
    ["GET", "/api/v1/impact/:objectId", ["read"], (c) => {
      const id = c.match.objectId;
      const known = c.store.object(id) || c.store.agent(id) || c.store.task(id) || c.store.sandbox(id);
      if (!known) throw new ApiError(404, "NOT_FOUND", `对象 ${id} 不存在`);
      json(c.res, 200, impactAnalysis(c.store, id));
    }],

    /* ── 治理面（§7）── */
    ["GET", "/api/v1/routes", ["read"], (c) => json(c.res, 200, c.store.routes.map(strip))],
    ["PATCH", "/api/v1/routes/:id", ["governance"], (c) => {
      const op = submitOp(c.ctx, { action: "route.update-weights",
        params: { ruleId: c.match.id, weight: num((c.body || {}).weight, NaN) }, requestedBy: c.key.name });
      json(c.res, 202, opEnvelope(op));
    }],
    ["GET", "/api/v1/quotas", ["read"], (c) => json(c.res, 200, c.store.tenants.map(t => ({
      ...strip(t), tokenPct: Math.round(t.tokenUsed / t.tokenBudget * 100), sandboxPct: Math.round(t.sandboxUsed / t.sandboxQuota * 100),
    })))],
    ["PATCH", "/api/v1/quotas/:tenant", ["governance"], (c) => {
      const t = c.store.tenant(c.match.tenant);
      if (!t) throw new ApiError(404, "NOT_FOUND", `租户 ${c.match.tenant} 不存在`);
      for (const k of ["tokenBudget", "sandboxQuota", "stepLimit"]) {
        if (c.body?.[k] !== undefined) t[k] = num(c.body[k], t[k]);
      }
      c.store.putObject("tenant", t);
      json(c.res, 200, strip(t));
    }],
    ["GET", "/api/v1/policy-events", ["policyRead"], (c) => {
      json(c.res, 200, c.store.events({
        kind: c.query.get("kind") || undefined,
        subject: c.query.get("subject") || undefined,
        type: c.query.get("type") || undefined,
        limit: num(c.query.get("limit"), 50),
      }));
    }],

    /* ── 异步操作（§9.1 ops）── */
    ["POST", "/api/v1/ops", ["read"], (c) => {
      const action = c.body?.action;
      const perm = action?.startsWith("maintenance.") ? "maintenance" : "governance";
      requireRole(c.key, perm);
      const op = submitOp(c.ctx, { action, params: c.body?.params || {}, requestedBy: c.key.name });
      json(c.res, 202, opEnvelope(op));
    }],
    ["GET", "/api/v1/ops", ["read"], (c) => json(c.res, 200, c.store.ops().slice(0, num(c.query.get("limit"), 20)))],
    ["GET", "/api/v1/ops/:opId", ["read"], (c) => {
      const op = c.store.op(c.match.opId);
      if (!op) throw new ApiError(404, "NOT_FOUND", `操作 ${c.match.opId} 不存在`);
      json(c.res, 200, op);
    }],

    /* ── 密钥管理 ── */
    ["GET", "/api/v1/keys", ["keysManage"], (c) => json(c.res, 200, c.store.listKeys())],
    ["POST", "/api/v1/keys", ["keysManage"], (c) => {
      const key = createKey(c.store, c.body || {});
      json(c.res, 201, { keyId: key.id, name: key.name, role: key.role, token: key.token, note: "token 仅此一次返回" });
    }],
    ["POST", "/api/v1/keys/:id/revoke", ["keysManage"], (c) => {
      const k = c.store.listKeys().find(x => x.id === c.match.id);
      if (!k) throw new ApiError(404, "NOT_FOUND", `密钥 ${c.match.id} 不存在`);
      c.store.revokeKey(c.match.id);
      c.store.pushEvent({ kind: "policy", type: "撤销", severity: "warn", source: "axon", subject: c.match.id,
        msg: `API 密钥 ${c.match.id}（${k.name} · ${k.role}）已撤销`, refs: [] });
      json(c.res, 200, { id: c.match.id, revoked: true });
    }],

    /* ── SSE 事件流 ── */
    ["GET", "/api/v1/events/stream", ["read"], (c) => {
      c.sse.subscribe(c.req, c.res);
    }],
  ];

  return async function handle(req, res, pathname, query, body) {
    for (const [method, pattern, perm, handler] of routes) {
      if (method !== req.method) continue;
      const match = matchPath(pattern, pathname);
      if (!match) continue;

      try {
        // 鉴权：perm 为空 = 豁免（meta / setup / openapi / docs）
        if (perm.length) {
          if (!req.headers["authorization"] && query.get("key")) {
            req.headers["authorization"] = `Bearer ${query.get("key")}`;   // SSE 兜底
          }
          const key = authenticate(ctx.store, req);
          requireRole(key, perm[0]);
          req.authKey = key;
        }
        // 幂等（§9.2）：POST + Idempotency-Key，重复提交返回首次结果
        const idemKey = req.headers["idempotency-key"];
        if (req.method === "POST" && idemKey) {
          const requestHash = hashOf(method + pathname + JSON.stringify(body || {}));
          const hit = ctx.store.findIdempotent(idemKey, requestHash);
          if (hit?.conflict) throw new ApiError(409, "SOURCE_CONFLICT", "Idempotency-Key 已用于不同请求体");
          if (hit) {
            res.setHeader("Idempotency-Replayed", "true");
            return json(res, hit.response.status, hit.response.body);
          }
          const captured = { status: null, body: null };
          const wrapped = capture(res, captured);
          await handler({ ctx, req, res: wrapped, query, body, match, key: req.authKey, store: ctx.store, sse: ctx.sse });
          if (captured.status && captured.status < 400) {
            ctx.store.saveIdempotent(idemKey, requestHash, { status: captured.status, body: captured.body });
          }
          return true;
        }
        await handler({ ctx, req, res, query, body, match, key: req.authKey, store: ctx.store, sse: ctx.sse });
      } catch (e) {
        if (e instanceof ApiError) {
          json(res, e.status, { error: { code: e.code, message: e.message, detail: e.detail } });
        } else {
          console.error("[api] 未预期错误:", e);
          json(res, 500, { error: { code: "INTERNAL", message: String(e.message || e) } });
        }
      }
      return true;
    }
    if (pathname.startsWith("/api/")) {
      json(res, 404, { error: { code: "NOT_FOUND", message: `无此路由 ${req.method} ${pathname}` } });
      return true;
    }
    return false;   // 交给静态文件
  };
}

/* ── 私有辅助 ── */
function strip(o) { const { _kind, ...rest } = o; return rest; }
function mustTask(c) {
  const t = c.store.task(c.match.id);
  if (!t) throw new ApiError(404, "NOT_FOUND", `任务 ${c.match.id} 不存在`);
  return t;
}
function emitAgentEvent(c, id, msg) {
  c.store.pushEvent({ kind: "policy", type: "准入", severity: "info", source: "axon", subject: id, msg, refs: [] });
  c.sse.broadcast("policy", { subject: id, msg });
}
const opEnvelope = (op) => ({ opId: op.opId, status: op.status, action: op.action, label: op.label });
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
  return { status, body };
}
function html(res, doc) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(doc);
}
function matchPath(pattern, pathname) {
  const pp = pattern.split("/"), ap = pathname.split("/");
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (pp[i] !== ap[i]) return null;
  }
  return params;
}
/** 捕获 json() 写出的响应供幂等存储 */
function capture(res, captured) {
  return {
    writeHead(status, headers) { captured.status = status; res.writeHead(status, headers); },
    setHeader: (...a) => res.setHeader(...a),
    end: (payload) => { try { captured.body = JSON.parse(payload); } catch { /* 非 JSON（SSE 等）不存 */ } res.end(payload); },
    on: (...a) => res.on(...a),
    write: (...a) => res.write(...a),
  };
}
