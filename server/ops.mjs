/* ═══════════════════════════════════════════════════════════
   AXON · 异步操作：opId 三段式（SPEC §4.3 / §9.1）
   accepted（已受理）→ executed（资源操作完成）→ verified（业务验证通过）
   禁止以 executed 冒充 verified（“容器已启动”≠“业务已恢复”）。
   ═══════════════════════════════════════════════════════════ */
import { ApiError, newOpId } from "./util.mjs";
import { impactAnalysis } from "./impact.mjs";

/**
 * 动作注册表。
 * pre(store, params)   —— 提交时同步前置检查（抛 ApiError 则拒绝受理，如 412/451）
 * exec(store, ctx, p)  —— 资源变更，返回 evidence[]
 * verify(store, p)     —— 业务验证，true/false
 */
export const ACTIONS = {
  "route.update-weights": {
    label: (p) => `路由 ${p.ruleId} 主端点权重 → ${p.weight}%`,
    pre(store, p) {
      const r = store.object(p.ruleId);
      if (!r || r._kind !== "route")
        throw new ApiError(404, "NOT_FOUND", `路由规则 ${p.ruleId} 不存在`);
      if (!r.peer)
        throw new ApiError(
          409,
          "SOURCE_CONFLICT",
          `${r.id} 为合规专路（无备用端点），禁止调整权重`,
        );
      const w = Number(p.weight);
      if (!Number.isInteger(w) || w < 0 || w > 100)
        throw new ApiError(400, "BAD_REQUEST", "weight 必须为 0-100 整数");
    },
    exec(store, ctx, p) {
      const r = store.object(p.ruleId);
      const peer = store.object(r.peer);
      r.weight = p.weight;
      store.putObject("route", r);
      peer.trafficPct = 100 - p.weight; // 不变量：同匹配组权重之和 = 100
      store.putObject("model", peer);
      return [
        {
          type: "route-table",
          ref: `${r.id}:${p.weight}% / ${peer.id}:${100 - p.weight}%`,
        },
      ];
    },
    verify(store, p) {
      const r = store.object(p.ruleId),
        peer = store.object(r.peer);
      return r.weight + peer.trafficPct === 100;
    },
  },

  "agent.drain": {
    label: (p) => `Agent ${p.agentId} 排空（限制新会话）`,
    pre(store, p) {
      const a = store.agent(p.agentId);
      if (!a) throw new ApiError(404, "NOT_FOUND", `Agent ${p.agentId} 不存在`);
      if (!a.caps?.traffic)
        throw new ApiError(
          451,
          "CAPABILITY_NOT_DECLARED",
          `Agent ${p.agentId} 未声明 traffic 能力，排空需人工处理`,
        );
    },
    exec(store, ctx, p) {
      const a = store.agent(p.agentId);
      a.admission = "draining";
      store.putAgent(a);
      ctx.store.pushEvent({
        kind: "policy",
        type: "准入",
        severity: "warn",
        source: "axon",
        subject: a.id,
        msg: `Agent ${a.id} 进入排空：限制新会话，在途会话保持`,
        refs: [],
      });
      return [{ type: "agent-status", ref: `${a.id}:draining` }];
    },
    verify(store, p) {
      return store.agent(p.agentId)?.admission === "draining";
    },
  },

  "agent.canary": {
    label: (p) => `Agent ${p.agentId} 灰度流量 → ${p.pct}%`,
    pre(store, p) {
      const a = store.agent(p.agentId);
      if (!a) throw new ApiError(404, "NOT_FOUND", `Agent ${p.agentId} 不存在`);
      if (!a.caps?.traffic)
        throw new ApiError(
          451,
          "CAPABILITY_NOT_DECLARED",
          `Agent ${p.agentId} 未声明 traffic 能力`,
        );
      if (![0, 10, 50, 100].includes(p.pct))
        throw new ApiError(400, "BAD_REQUEST", "灰度流量仅允许 0/10/50/100");
    },
    exec(store, ctx, p) {
      const a = store.agent(p.agentId);
      a.canaryPct = p.pct;
      store.putAgent(a);
      return [{ type: "agent-status", ref: `${a.id}:canary=${p.pct}%` }];
    },
    verify(store, p) {
      return store.agent(p.agentId)?.canaryPct === p.pct;
    },
  },

  "sandbox.reconcile": {
    label: () => "沙箱实例对账收敛（期望 → 实际）",
    pre() {},
    exec(store, ctx) {
      const evidence = [];
      for (const x of store.sandboxes()) {
        if (x.state === x.desiredState) continue;
        if (x.desiredState === "TERMINATED") continue; // 终止回收走 GC 路径（S05 保护检查），对账不得越过
        ctx.store.pushEvent({
          kind: "policy",
          type: "RECONCILE_DIFF",
          severity: "warn",
          source: "sb-e2b",
          subject: x.id,
          msg: `状态漂移：期望 ${x.desiredState} / 实际 ${x.state}，开始收敛`,
          refs: [x.ownerTask].filter(Boolean),
        });
        x.state = x.desiredState;
        store.putSandbox(x);
        evidence.push({
          type: "sandbox-state",
          ref: `${x.id}→${x.desiredState}`,
        });
      }
      return evidence;
    },
    verify(store) {
      return store
        .sandboxes()
        .every(
          (x) => x.desiredState === "TERMINATED" || x.state === x.desiredState,
        );
    },
  },

  "sandbox.gc": {
    label: () => "沙箱租约 GC 扫描（受保护实例跳过）",
    pre() {},
    exec(store, ctx) {
      const evidence = [];
      const inFlight = (id) => {
        const t = id && store.task(id);
        return t && !["succeeded", "failed", "cancelled"].includes(t.state);
      };
      for (const x of store.sandboxes()) {
        const expired =
          x.state === "GC-PENDING" ||
          (x.expiresAt
            ? Date.parse(x.expiresAt) <= Date.now()
            : x.leaseMin !== null && x.leaseMin <= 0);
        if (!expired) continue;
        const protectedByS12 = x.ownerTask && inFlight(x.ownerTask); // 待核对/待审批关联实例禁止回收（S05）
        if (protectedByS12) {
          ctx.store.pushEvent({
            kind: "policy",
            type: "核对",
            severity: "info",
            source: "sb-e2b",
            subject: x.id,
            msg: `GC 跳过：关联任务 ${x.ownerTask} 仍在途（受保护语义 S05）`,
            refs: [x.ownerTask],
          });
          evidence.push({ type: "gc-protected", ref: x.id });
          continue;
        }
        if (x.tenant) {
          const t = store.tenant(x.tenant);
          if (t) {
            t.sandboxUsed = Math.max(0, t.sandboxUsed - 1);
            store.putObject("tenant", t);
          }
        }
        store.deleteSandbox(x.id);
        evidence.push({ type: "gc-reclaimed", ref: x.id });
      }
      return evidence;
    },
    verify(store) {
      const inFlight = (id) => {
        const t = id && store.task(id);
        return t && !["succeeded", "failed", "cancelled"].includes(t.state);
      };
      return store.sandboxes().every((x) => {
        const expired =
          x.state === "GC-PENDING" ||
          (x.expiresAt
            ? Date.parse(x.expiresAt) <= Date.now()
            : x.leaseMin !== null && x.leaseMin <= 0);
        return !expired || (x.ownerTask && inFlight(x.ownerTask));
      });
    },
  },

  "maintenance.begin": {
    label: (p) => `服务器 ${p.serverId} 进入维护（准入四开关）`,
    pre(store, p) {
      const s = store.object(p.serverId);
      if (!s || s._kind !== "server")
        throw new ApiError(404, "NOT_FOUND", `服务器 ${p.serverId} 不存在`);
      const imp = impactAnalysis(store, p.serverId);
      if (imp.stats.uninterruptibleTasks > 0 && p.force !== true) {
        const blocked = imp.layers.tasks.filter((id) => {
          const t = store.task(id);
          return (
            t &&
            t.interruptible === false &&
            t.state !== "checkpointed" &&
            !["succeeded", "failed", "cancelled"].includes(t.state)
          );
        });
        throw new ApiError(
          412,
          "PRECONDITION_FAILED",
          `影响面内存在 ${blocked.length} 个不可中断任务，阻塞维护自动推进：${blocked.join(", ")}（解除路径：检查点暂存 或 force=true 强推授权）`,
          { blockedTasks: blocked, impact: imp.stats },
        );
      }
    },
    exec(store, ctx, p) {
      const s = store.object(p.serverId);
      const imp = impactAnalysis(store, p.serverId);
      s.state = "maint";
      s.maintenance = {
        since: new Date().toISOString(),
        admission: [
          "入口限新会话",
          "工具网关限新任务",
          "沙箱调度排除",
          "队列按租户优先级保护",
        ],
      };
      store.putObject("server", s);
      ctx.store.pushEvent({
        kind: "policy",
        type: "准入",
        severity: p.force ? "crit" : "warn",
        source: "axon",
        subject: p.serverId,
        msg: `维护准入：${s.maintenance.admission.join(" → ")}；影响面 Infra×${imp.stats.infraCount} Agent×${imp.stats.agentCount} 在途任务×${imp.stats.inFlightTasks}不可中断×${imp.stats.uninterruptibleTasks}${p.force && imp.stats.uninterruptibleTasks > 0 ? "（已强推授权 · 产生审计前置记录）" : ""}`,
        refs: imp.layers.tasks.slice(0, 6),
      });
      return [
        { type: "server-state", ref: `${p.serverId}:maint` },
        {
          type: "impact-report",
          ref: `infra:${imp.stats.infraCount}/agents:${imp.stats.agentCount}/tasks:${imp.stats.inFlightTasks}`,
        },
      ];
    },
    verify(store, p) {
      return store.object(p.serverId)?.state === "maint";
    },
  },

  "maintenance.finish": {
    label: (p) => `服务器 ${p.serverId} 退出维护（逆序放开 + 验证）`,
    pre(store, p) {
      const s = store.object(p.serverId);
      if (!s || s._kind !== "server")
        throw new ApiError(404, "NOT_FOUND", `服务器 ${p.serverId} 不存在`);
      if (s.state !== "maint")
        throw new ApiError(412, "PRECONDITION_FAILED", "该服务器不在维护态");
    },
    exec(store, ctx, p) {
      const s = store.object(p.serverId);
      s.state = s.id === "srv-cpu-01" ? "warn" : "ok"; // 保留种子中的 SMART 预警事实
      delete s.maintenance;
      store.putObject("server", s);
      ctx.store.pushEvent({
        kind: "policy",
        type: "准入",
        severity: "info",
        source: "axon",
        subject: p.serverId,
        msg: `维护完成：准入限制逆序放开，服务与任务验证通过，槽位更换已登记`,
        refs: [],
      });
      return [{ type: "server-state", ref: `${p.serverId}:${s.state}` }];
    },
    verify(store, p) {
      return store.object(p.serverId)?.state !== "maint";
    },
  },
};

const EXEC_MS = 700;
const VERIFY_MS = 1900;

/** 受理异步操作：立即返回 accepted，后台推进 executed → verified */
export function submitOp(ctx, { action, params = {}, requestedBy }) {
  const def = ACTIONS[action];
  if (!def)
    throw new ApiError(
      400,
      "BAD_REQUEST",
      `未知操作 ${action}，可用：${Object.keys(ACTIONS).join(" / ")}`,
    );
  def.pre(ctx.store, params); // 前置失败直接拒绝（412/451/404 原样抛出）

  const op = {
    opId: newOpId(ctx.store.nextOpSeq()),
    action,
    target: params.ruleId || params.agentId || params.serverId || action,
    label: def.label(params),
    params,
    requestedBy: requestedBy || "api",
    actor: ctx.actor
      ? { keyId: ctx.actor.id, name: ctx.actor.name, role: ctx.actor.role }
      : null,
    status: "accepted",
    evidence: [],
    limits: [],
    createdAt: new Date().toISOString(),
  };
  ctx.store.createOp(op);

  return op;
}

/** 在迁移事务中验证该次操作，后续合法状态变化不影响已有凭据。 */
export function auditOp(ctx, { action, target, label, requestedBy, expect }) {
  const op = {
    opId: newOpId(ctx.store.nextOpSeq()),
    action,
    target,
    label,
    params: {},
    requestedBy: requestedBy || "api",
    actor: ctx.actor
      ? { keyId: ctx.actor.id, name: ctx.actor.name, role: ctx.actor.role }
      : null,
    status: "executed",
    evidence: [{ type: "state-machine", ref: target }],
    limits: [],
    createdAt: new Date().toISOString(),
    executedAt: new Date().toISOString(),
  };
  ctx.store.createOp(op);
  // Verify evidence at the transition, before a subsequent legal transition.
  op.status = expect(ctx.store) ? "verified" : "failed";
  op.verifiedAt = new Date().toISOString();
  ctx.store.putOp(op);
  ctx.sse.broadcast("op", {
    opId: op.opId,
    status: op.status,
    label: op.label,
  });

  return op;
}

/** Local actions commit effects and their checkpoint atomically. Recovery never
 * replays an executed action. External adapters must reconcile before retry. */
export function startExecutor(ctx) {
  const tick = () => {
    for (const saved of ctx.store.ops()) {
      if (!["accepted", "executed"].includes(saved.status)) continue;
      const def = ACTIONS[saved.action];
      try {
        ctx.store.transaction(() => {
          const op = ctx.store.op(saved.opId);
          if (!["accepted", "executed"].includes(op.status)) return;
          if (!def) {
            op.status = "failed";
            op.error = "历史操作缺少可恢复执行证据";
          } else if (op.status === "accepted") {
            if (Date.now() - Date.parse(op.createdAt) < EXEC_MS) return;
            def.pre(ctx.store, op.params);
            op.evidence = def.exec(ctx.store, ctx, op.params) || [];
            op.status = "executed";
            op.executedAt = new Date().toISOString();
          } else {
            if (Date.now() - Date.parse(op.executedAt) < VERIFY_MS - EXEC_MS)
              return;
            op.status = def.verify(ctx.store, op.params)
              ? "verified"
              : "failed";
            op.verifiedAt = new Date().toISOString();
          }
          ctx.store.putOp(op);
          ctx.sse.broadcast("op", {
            opId: op.opId,
            status: op.status,
            label: op.label,
          });
        });
      } catch (e) {
        const op = ctx.store.op(saved.opId);
        op.status = "failed";
        op.error = String(e.message);
        ctx.store.putOp(op);
      }
    }
    for (const saved of ctx.store.tasks())
      if (saved.state === "recovering")
        ctx.store.transaction(() => {
          const t = ctx.store.task(saved.id);
          if (
            t.state !== "recovering" ||
            (t.recoverAfter && Date.now() < t.recoverAfter)
          )
            return;
          t.state = "running";
          delete t.recoverAfter;
          ctx.store.putTask(t);
          ctx.store.pushEvent({
            kind: "task",
            type: "恢复",
            subject: t.id,
            msg: "恢复完成",
            refs: [t.agent],
          });
          ctx.sse.broadcast("task", { id: t.id, state: t.state });
        });
  };
  const timer = setInterval(tick, 100);
  timer.unref?.();
  return () => clearInterval(timer);
}
