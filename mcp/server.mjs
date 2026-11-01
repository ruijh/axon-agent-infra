#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   AXON · MCP Server（stdio JSON-RPC · Model Context Protocol）
   ─────────────────────────────────────────────────────────
   让任意 MCP 宿主（Claude Code / Claude Desktop / 其他 Agent）
   作为操作方接入 AXON 控制平面。差异化工具：axon_impact_analysis
   —— Agent 在执行高危动作前，可先查询影响面与不可中断任务数。

   配置（以 Claude Code 为例）：
     claude mcp add axon -e AXON_URL=http://127.0.0.1:8437 -e AXON_API_KEY=axk_xxx -- node mcp/server.mjs

   环境：AXON_URL（默认 http://127.0.0.1:8437）· AXON_API_KEY
   ═══════════════════════════════════════════════════════════ */

const BASE = process.env.AXON_URL || "http://127.0.0.1:8437";
const KEY = process.env.AXON_API_KEY || "";

const err = (...a) => console.error("[axon-mcp]", ...a);

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json };
}

const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });

const TOOLS = [
  {
    name: "axon_status",
    description: "查询 AXON 控制平面状态：版本、对象计数、在途任务、配置是否完整。",
    inputSchema: { type: "object", properties: {} },
    async run() {
      const meta = await api("GET", "/api/v1/meta");
      const tasks = await api("GET", "/api/v1/tasks");
      const inFlight = tasks.json.filter(t => !["succeeded", "failed", "cancelled"].includes(t.state)).length;
      return `AXON ${meta.json.version} · 在途任务 ${inFlight}/${tasks.json.length} · 密钥${KEY ? "已配置" : "未配置（只读接口可用）"}`;
    },
  },
  {
    name: "axon_impact_analysis",
    description: "影响分析（AXON 差异化能力）：给出任意对象（服务器/Infra/模型/工具/Agent/任务）故障或维护时的辐射面——受影响 Infra、Agent、在途任务数，以及不可中断任务清单。执行维护、下线、重启等高危动作前应先调用。",
    inputSchema: { type: "object", properties: { objectId: { type: "string", description: "对象 ID，如 srv-gpu-01 / sb-e2b / ag-coder / T26-0731" } }, required: ["objectId"] },
    async run({ objectId }) {
      const r = await api("GET", `/api/v1/impact/${objectId}`);
      if (!r.ok) return `查询失败 ${r.status}：${r.json.error?.message}`;
      const { layers, stats } = r.json;
      return [`影响面（root=${objectId}）：`,
        `· Infra 服务 ×${stats.infraCount}：${layers.infra.join(", ") || "—"}`,
        `· 模型/工具 ×${stats.catalogCount}：${layers.catalog.join(", ") || "—"}`,
        `· Agent ×${stats.agentCount}：${layers.agents.join(", ") || "—"}`,
        `· 在途任务 ×${stats.inFlightTasks}（其中不可中断 ×${stats.uninterruptibleTasks}）`,
        layers.tasks.length ? `· 任务清单：${layers.tasks.join(", ")}` : ""].filter(Boolean).join("\n");
    },
  },
  {
    name: "axon_caps_query",
    description: "查询 Agent 的能力声明（observe/traffic/instance/state/task）。任何控制操作前应先查询：未声明的能力平台将拒绝（451），需人工处理。",
    inputSchema: { type: "object", properties: { agentId: { type: "string" } }, required: ["agentId"] },
    async run({ agentId }) {
      const r = await api("GET", `/api/v1/agents/${agentId}`);
      if (!r.ok) return `查询失败 ${r.status}：${r.json.error?.message}`;
      const a = r.json;
      return `${a.name}（${a.id}）caps=${JSON.stringify(a.caps)}${a.live ? ` · LIVE（心跳 ${a.lastHeartbeat}）` : ""}`;
    },
  },
  {
    name: "axon_task_queue",
    description: "查看可认领的任务队列（queued）。",
    inputSchema: { type: "object", properties: { agentId: { type: "string", description: "按认领者过滤，可选" } } },
    async run({ agentId }) {
      const r = await api("GET", `/api/v1/tasks/queue${agentId ? "?agent=" + agentId : ""}`);
      if (!r.ok) return `查询失败 ${r.status}：${r.json.error?.message}`;
      return r.json.length ? r.json.map(t => `${t.id} · ${t.name}（agent=${t.agent}）`).join("\n") : "队列为空";
    },
  },
  {
    name: "axon_task_claim",
    description: "认领任务（queued→running）。认领者需为 agent 角色密钥。",
    inputSchema: { type: "object", properties: { taskId: { type: "string" }, agentId: { type: "string" } }, required: ["taskId"] },
    async run({ taskId, agentId }) {
      const r = await api("POST", `/api/v1/tasks/${taskId}/claim`, { agent: agentId });
      return r.ok ? `已认领 ${taskId}（opId=${r.json.opId}）` : `认领失败 ${r.status}：${r.json.error?.message}`;
    },
  },
  {
    name: "axon_task_report",
    description: "汇报任务进度或终态。body.status 可取 succeeded/failed/unknown（结果未知时禁止自动重试，须人工核对）。",
    inputSchema: { type: "object", properties: {
      taskId: { type: "string" },
      progress: { type: "number", description: "进度百分比，可选" },
      status: { type: "string", enum: ["succeeded", "failed", "unknown"], description: "终态，可选" },
      summary: { type: "string", description: "结果摘要" },
    }, required: ["taskId"] },
    async run(p) {
      const body = {};
      if (p.progress !== undefined) body.progress = p.progress;
      if (p.summary) body.summary = p.summary;
      if (p.status) {
        const r = await api("POST", `/api/v1/tasks/${p.taskId}/result`, { status: p.status, summary: p.summary });
        return r.ok ? `${p.taskId} → ${r.json.state}` : `回报失败 ${r.status}：${r.json.error?.message}`;
      }
      const r = await api("PATCH", `/api/v1/tasks/${p.taskId}`, body);
      return r.ok ? `${p.taskId} 进度 ${r.json.progress}%` : `汇报失败 ${r.status}：${r.json.error?.message}`;
    },
  },
  {
    name: "axon_task_approve",
    description: "审批通过挂起中的任务（waiting_approval→running，授权重检）。",
    inputSchema: { type: "object", properties: { taskId: { type: "string" }, approvedBy: { type: "string" } }, required: ["taskId"] },
    async run({ taskId, approvedBy }) {
      const r = await api("POST", `/api/v1/tasks/${taskId}/approve`, { approvedBy: approvedBy || "mcp-operator" });
      return r.ok ? `${taskId} 审批通过 → running` : `审批失败 ${r.status}：${r.json.error?.message}`;
    },
  },
  {
    name: "axon_policy_events",
    description: "查询策略执行事件流（阻断/撤销/限流/配额/核对/准入/RECONCILE_DIFF），可按对象追溯。",
    inputSchema: { type: "object", properties: { subject: { type: "string", description: "按对象 ID 过滤" }, limit: { type: "number" } } },
    async run({ subject, limit }) {
      const q = new URLSearchParams({ limit: String(limit || 10) });
      if (subject) q.set("subject", subject);
      const r = await api("GET", `/api/v1/policy-events?` + q);
      if (!r.ok) return `查询失败 ${r.status}：${r.json.error?.message}`;
      return r.json.length ? r.json.reverse().map(e => `${e.ts.slice(11, 19)} [${e.type}] ${e.subject || ""} ${e.msg}`).join("\n") : "无事件";
    },
  },
];

/* ── JSON-RPC over stdio ── */
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function replyErr(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

rl.on("line", async (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return err("无法解析：", line.slice(0, 80)); }
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "axon-control-plane", version: "0.95.0" },
    });
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;   // 通知无响应
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") {
    return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }
  if (method === "tools/call") {
    const tool = TOOLS.find(t => t.name === params?.name);
    if (!tool) return replyErr(id, -32602, `未知工具 ${params?.name}`);
    try {
      const out = await tool.run(params?.arguments || {});
      return reply(id, text(out));
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: `工具执行错误：${e.message}` }], isError: true });
    }
  }
  return replyErr(id, -32601, `未知方法 ${method}`);
});

err(`MCP server 就绪（stdio）→ ${BASE}${KEY ? " · 密钥已配置" : " · 未配置 AXON_API_KEY（部分接口将 401）"}`);
