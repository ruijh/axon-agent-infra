#!/usr/bin/env node
import { randomUUID } from "node:crypto";
/* ═══════════════════════════════════════════════════════════
   AXON · Worker（Agent 接入闭环演示 · pull 模型）
   ─────────────────────────────────────────────────────────
   对标 mission-control 的 REST 循环，但语义按 AXON SPEC 执行：
   register（caps 声明）→ heartbeat → claim queue → 状态机汇报
   → （requiresApproval 时）waiting_approval 等审批 → result 终态

   运行：
     node worker/worker.mjs --agent ag-live-01
   环境：AXON_URL / AXON_API_KEY（agent 角色密钥）
   选项：--once 只处理一个任务后退出（测试用）
         --create-task 自建一个演示任务再认领（端到端冒烟）
   ═══════════════════════════════════════════════════════════ */

const BASE = process.env.AXON_URL || "http://127.0.0.1:8437";
const KEY = process.env.AXON_API_KEY || "";
const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? (args[i + 1] ?? true) : d;
};

const AGENT_ID = flag("agent", "ag-live-01");
const ONCE = args.includes("--once");
const CREATE_TASK = args.includes("--create-task");
const STEP_MS = Number(flag("step-ms", 900));

if (!KEY) {
  console.error(
    "[worker] 缺少 AXON_API_KEY（agent 角色密钥，node cli.mjs keys create worker agent）",
  );
  process.exit(1);
}

const log = (...a) => console.log(`[${AGENT_ID}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, idem) {
  const res = await fetch(BASE + path, {
    signal: AbortSignal.timeout(10000),
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${KEY}`,
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

/* ── 1. 注册：能力声明是操作准入的唯一依据（§4）── */
async function register() {
  const r = await call("POST", "/api/v1/agents/register", {
    id: AGENT_ID,
    name: "Live 接入演示 Agent",
    owner: "平台工程 · Live",
    tenant: process.env.AXON_TENANT || "platform",
    runtime: "rt-langgraph",
    caps: {
      observe: true,
      traffic: true,
      instance: true,
      state: false,
      task: true,
    }, // state=0：演示 451 门控
  });
  if (!r.ok) throw new Error(`注册失败 ${r.status}: ${r.json.error?.message}`);
  log(
    `已注册 · caps=${JSON.stringify(r.json.caps)}（注意 state=0：平台将拒绝检查点类操作 451）`,
  );
}

/* ── 2. 心跳 ── */
async function heartbeat() {
  const r = await call("POST", `/api/v1/agents/${AGENT_ID}/heartbeat`, {
    status: "idle",
  });
  if (!r.ok) log(`心跳失败：${r.json.error?.message}`);
}

/* ── 3. 任务执行循环 ── */
async function runTask(task) {
  log(`认领 ${task.id}（${task.name}）`);
  const claim = await call(
    "POST",
    `/api/v1/tasks/${task.id}/claim`,
    { agent: AGENT_ID },
    `claim-${task.id}-${randomUUID()}`,
  );
  if (!claim.ok) {
    log(`认领被拒 ${claim.status}：${claim.json.error?.message}`);
    return;
  }

  const steps = 8;
  let approvalRequested = false;
  for (let i = 1; i <= steps; i++) {
    await sleep(STEP_MS);
    const progress = Math.round((i / steps) * 100);

    // 审批门：进行到 ~60% 时按任务声明挂起一次（running → waiting_approval）
    if (
      task.requiresApproval &&
      !approvalRequested &&
      progress >= 60 &&
      progress < 100
    ) {
      approvalRequested = true;
      const appr = await call("PATCH", `/api/v1/tasks/${task.id}`, {
        requestApproval: "外部 ERP 写入授权 · 等待安全风控审批",
      });
      if (appr.ok) {
        log(`${task.id} 已挂起等待审批（waiting_approval）· 轮询直至批准…`);
        while (true) {
          await sleep(1500);
          const t = (
            await call("GET", `/api/v1/agents/${AGENT_ID}/tasks`)
          ).json.find((x) => x.id === task.id);
          if (t.state === "running") {
            log("审批通过 · 授权重检通过，继续执行");
            break;
          }
          if (["cancelled", "failed"].includes(t.state)) {
            log(`任务在等待中被 ${t.state}，退出`);
            return;
          }
        }
      }
    }

    const p = await call("PATCH", `/api/v1/tasks/${task.id}`, {
      progress,
      tokensM: +(i * 0.05).toFixed(2),
      costCny: i * 3,
      note: `步骤 ${i}/${steps}`,
    });
    if (!p.ok) {
      log(`进度汇报被拒 ${p.status}：${p.json.error?.message}`);
      return;
    }
    log(`进度 ${progress}%`);

    // 演示门控：尝试做一次检查点（本 Agent state=0 → 平台必须拒绝，而非静默失败）
    if (i === 4) {
      const cp = await call("POST", `/api/v1/tasks/${task.id}/checkpoint`, {});
      const c = cp.json.error?.code;
      log(
        cp.ok
          ? "检查点成功（意外：caps.state 应为 0）"
          : c === "CAPABILITY_NOT_DECLARED"
            ? `能力门控生效：检查点被拒 ${cp.status} ${c}（caps.state=0 · 未支持/需人工处理 —— 未静默降级 ✓）`
            : `权限门控生效：检查点被拒 ${cp.status} ${c}（agent 角色无 taskWrite —— 由平台侧执行 ✓ 未静默降级）`,
      );
    }
  }

  const result = await call(
    "POST",
    `/api/v1/tasks/${task.id}/result`,
    {
      status: "succeeded",
      summary: `Worker 模拟执行完成（${steps} 步 · 含审批门与能力门控演示）`,
      tokensM: 0.02,
    },
    `result-${task.id}`,
  );
  if (result.ok)
    log(
      `${task.id} 终态 succeeded · opId=${result.json.finishedAt ? "已归档" : ""}`,
    );
  else log(`终态回报失败 ${result.status}：${result.json.error?.message}`);
}

async function mainLoop() {
  await register();
  if (CREATE_TASK) {
    const r = await call(
      "POST",
      "/api/v1/tasks",
      {
        name: "Live 接入演示任务（Worker 自建）",
        agent: AGENT_ID,
        requiresApproval: true,
      },
      `demo-${AGENT_ID}-${new Date().toISOString().slice(0, 13)}`,
    );
    if (r.ok) log(`已自建任务 ${r.json.id}（requiresApproval=true）`);
    else
      throw new Error(
        `自建任务失败：${r.json.error?.message}；机器密钥不能创建任务，请使用 CLI 管理员密钥先创建任务`,
      );
  }

  let busy = false;
  let heartbeatPending = false;
  setInterval(async () => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    try {
      await heartbeat();
    } catch (e) {
      log("心跳断连", e.message);
    } finally {
      heartbeatPending = false;
    }
  }, 5000).unref();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q;
    try {
      q = await call("GET", `/api/v1/tasks/queue?agent=${AGENT_ID}`);
    } catch (e) {
      log("队列暂不可达，稍后重试", e.message);
      await sleep(2000);
      continue;
    }
    if ([401, 403].includes(q.status))
      throw new Error("机器凭据失效或未绑定本 Agent");
    const task = q.json?.[0];
    if (task) {
      busy = true;
      await runTask(task);
      busy = false;
      if (ONCE) {
        log("--once 结束");
        process.exit(0);
      }
    }
    await sleep(2000);
  }
}

mainLoop().catch((e) => {
  console.error("[worker] 致命错误：", e.message);
  process.exit(1);
});
