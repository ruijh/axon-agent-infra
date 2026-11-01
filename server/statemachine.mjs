/* ═══════════════════════════════════════════════════════════
   AXON · 任务状态机（SPEC §5）
   queued → running → succeeded | failed | cancelled
   扩展态：waiting_approval / checkpointed / recovering / unknown
   ═══════════════════════════════════════════════════════════ */
import { ApiError } from "./util.mjs";

export const TASK_STATES = ["queued", "running", "succeeded", "failed", "cancelled",
  "waiting_approval", "checkpointed", "recovering", "unknown"];

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** 合法迁移表（§5.2） */
const TRANSITIONS = {
  queued:           ["running", "cancelled"],
  running:          ["succeeded", "failed", "cancelled", "waiting_approval", "checkpointed", "unknown"],
  waiting_approval: ["running", "cancelled"],
  checkpointed:     ["recovering", "cancelled"],
  recovering:       ["running", "failed", "cancelled"],
  unknown:          ["succeeded", "failed", "cancelled"],
  succeeded:        [],
  failed:           [],
  cancelled:        [],
};

export const IN_FLIGHT = (t) => !TERMINAL.has(t.state);

/**
 * 校验迁移合法性并执行前置条件检查。
 * agent:  归属 Agent（能力声明，§4）
 * params: { force, approvedBy, ckptId, mode, waitReason }
 * 返回副作用描述数组（写入事件流用）。
 */
export function transition(task, to, agent = null, params = {}) {
  const from = task.state;
  const legal = TRANSITIONS[from] || [];
  if (!legal.includes(to)) {
    throw new ApiError(409, "STATE_TRANSITION_INVALID",
      `任务 ${task.id} 不允许 ${from} → ${to} 迁移（合法目标：${legal.join(", ") || "无 · 终态"}）`);
  }

  const sideEffects = [];

  switch (`${from}→${to}`) {
    case "waiting_approval→running":
      // 授权必须重检（§5.2）：审批人身份必填
      if (!params.approvedBy) {
        throw new ApiError(412, "PRECONDITION_FAILED", "审批通过需要 approvedBy（授权重检：记录审批人身份）");
      }
      sideEffects.push(`审批通过（${params.approvedBy}）· 授权已重检`);
      delete task.waitReason;
      break;

    case "running→checkpointed":
      // 检查点暂存需要 state 控制能力（§5.2：caps.state=1 或运行时原生支持）
      if (!agent || !agent.caps?.state) {
        throw new ApiError(451, "CAPABILITY_NOT_DECLARED",
          `Agent ${task.agent} 未声明 state 能力，无法执行检查点暂存（需人工处理）`);
      }
      task.ckpt = { id: params.ckptId || task.ckpt?.id, mode: params.mode || "app-checkpoint", compatible: true, savedAt: new Date().toISOString() };
      sideEffects.push("检查点已保存，计算资源释放");
      break;

    case "checkpointed→recovering":
      // 兼容性前置（§2.8）：不兼容时恢复入口禁用
      if (task.ckpt && task.ckpt.compatible === false) {
        throw new ApiError(412, "PRECONDITION_FAILED", `检查点 ${task.ckpt.id} 与当前运行时版本不兼容，恢复入口禁用`);
      }
      sideEffects.push("自检查点恢复 · 环境重建 / 网络重连");
      break;

    default:
      if (to === "cancelled") {
        // 不可中断任务取消 = 高影响操作：二次确认（§5.2）
        if (task.interruptible === false && params.force !== true) {
          throw new ApiError(412, "PRECONDITION_FAILED",
            `任务 ${task.id} 不可中断，取消需要 force=true 二次确认（不可逆外部操作提示）`);
        }
        sideEffects.push("任务取消 · 产物按保留策略归档");
      }
      if (to === "unknown") {
        task.waitReason = params.waitReason || "工具调用超时且无幂等键 · 已进入人工核对队列（S12）";
        sideEffects.push("结果未知 · 禁止自动重放，入人工核对队列");
      }
      break;
  }

  task.state = to;
  if (to === "succeeded") task.progress = 100;
  task.stateChangedAt = new Date().toISOString();
  return sideEffects;
}

/** 任务认领：queued → running（Worker pull 模型入口） */
export function claimable(task, agentId) {
  return task.state === "queued" && (!task.agent || task.agent === agentId);
}
