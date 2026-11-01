/* ═══════════════════════════════════════════════════════════
   AXON · OpenAPI 3.1 描述 + 内联文档页（对标 mission-control
   的 “OpenAPI-described REST API”）
   ═══════════════════════════════════════════════════════════ */

const ERR = (description) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const JSON_ARR = (itemRef) => ({
  200: { description: "对象列表", content: { "application/json": { schema: { type: "array", items: { $ref: itemRef } } } } },
});

const PATHS = {
  "/api/v1/meta": { get: { summary: "控制平面元信息（免鉴权）", responses: { 200: { description: "版本 / 是否需要初始化" } } } },
  "/api/v1/setup": { post: { summary: "首次初始化：创建 platform-admin 根密钥", responses: { 201: ERR("返回 token（仅一次）"), 409: ERR("已初始化") } } },
  "/api/v1/openapi.json": { get: { summary: "本 OpenAPI 文档", responses: { 200: { description: "OpenAPI 3.1" } } } },
  "/api/v1/servers": { get: { summary: "服务器清单（L0）", responses: JSON_ARR("#/components/schemas/Server") } },
  "/api/v1/racks": { get: { summary: "机柜", responses: { 200: { description: "机柜列表" } } } },
  "/api/v1/netdevices": { get: { summary: "网络设备", responses: { 200: { description: "设备列表" } } } },
  "/api/v1/netlinks": { get: { summary: "物理链路", responses: { 200: { description: "链路列表" } } } },
  "/api/v1/infra": { get: { summary: "Infra 服务目录（L1）", responses: { 200: { description: "服务列表" } } } },
  "/api/v1/models": { get: { summary: "模型端点（L2）", responses: { 200: { description: "端点列表" } } } },
  "/api/v1/tools": { get: { summary: "工具目录（L2）", responses: { 200: { description: "工具列表" } } } },
  "/api/v1/tools/{id}": { patch: { summary: "登记工具契约 / 版本 / 幂等能力", parameters: [P("id", "工具 ID")],
    responses: { 200: { description: "更新后的工具" }, 404: ERR("不存在") } } },
  "/api/v1/agents": { get: { summary: "Agent 目录（L3，含 caps 能力声明）", responses: { 200: { description: "Agent 列表" } } } },
  "/api/v1/agents/register": { post: { summary: "Agent 注册（Worker pull 模型入口）", responses: { 201: { description: "注册成功" }, 400: ERR("缺 id/name") } } },
  "/api/v1/agents/{id}": { get: { summary: "Agent 详情", parameters: [P("id", "Agent ID")], responses: { 200: { description: "Agent" }, 404: ERR("不存在") } } },
  "/api/v1/agents/{id}/heartbeat": { post: { summary: "心跳保活", parameters: [P("id", "Agent ID")], responses: { 200: { description: "心跳确认" } } } },
  "/api/v1/tasks": {
    get: { summary: "任务列表（可按 state / agent 过滤）", parameters: [P("state", "状态过滤", "query"), P("agent", "Agent 过滤", "query")], responses: { 200: { description: "任务列表" } } },
    post: { summary: "创建任务（配额检查：Token 超限 → 429）", responses: { 201: { description: "已创建（queued）" }, 429: ERR("QUOTA_EXCEEDED") } },
  },
  "/api/v1/tasks/queue": { get: { summary: "认领队列（Worker 拉取）", parameters: [P("agent", "认领者", "query")], responses: { 200: { description: "可认领任务" } } } },
  "/api/v1/tasks/{id}/claim": { post: { summary: "认领任务 queued→running", parameters: [P("id", "任务 ID")], responses: { 200: { description: "已认领" }, 409: ERR("STATE_TRANSITION_INVALID") } } },
  "/api/v1/tasks/{id}": { patch: { summary: "Worker 汇报：progress / tokensM / requestApproval / resultUnknown", parameters: [P("id", "任务 ID")], responses: { 200: { description: "更新后任务" } } } },
  "/api/v1/tasks/{id}/approve": { post: { summary: "审批通过 waiting_approval→running（授权重检）", parameters: [P("id", "任务 ID")], responses: { 200: { description: "已续跑" }, 412: ERR("缺 approvedBy") } } },
  "/api/v1/tasks/{id}/cancel": { post: { summary: "取消任务（caps.task 门控 451；不可中断任务需 force）", parameters: [P("id", "任务 ID")], responses: { 200: { description: "已取消" }, 451: ERR("CAPABILITY_NOT_DECLARED"), 412: ERR("需 force 二次确认") } } },
  "/api/v1/tasks/{id}/checkpoint": { post: { summary: "检查点暂存 running→checkpointed（caps.state 门控）", parameters: [P("id", "任务 ID")], responses: { 200: { description: "已暂存" }, 451: ERR("CAPABILITY_NOT_DECLARED") } } },
  "/api/v1/tasks/{id}/restore": { post: { summary: "检查点恢复 checkpointed→recovering→running", parameters: [P("id", "任务 ID")], responses: { 200: { description: "恢复中" }, 412: ERR("检查点不兼容") } } },
  "/api/v1/tasks/{id}/result": { post: { summary: "终态回报 succeeded / failed / unknown（S12）", parameters: [P("id", "任务 ID")], responses: { 200: { description: "终态" } } } },
  "/api/v1/sandboxes": {
    get: { summary: "沙箱实例（期望/实际双列 + drift 标记）", responses: { 200: { description: "实例列表" } } },
    post: { summary: "创建实例（沙箱并发配额 429）", responses: { 201: { description: "已创建" }, 429: ERR("QUOTA_EXCEEDED") } },
  },
  "/api/v1/sandboxes/{id}/checkpoint": { post: { summary: "沙箱快照（三级语义）", parameters: [P("id", "实例 ID")], responses: { 200: { description: "已快照" } } } },
  "/api/v1/impact/{objectId}": { get: { summary: "影响分析：反向可达集合 + 分层统计（差异化能力）", parameters: [P("objectId", "任意对象 ID")], responses: { 200: { description: "layers + stats（含不可中断任务数）" }, 404: ERR("不存在") } } },
  "/api/v1/routes": { get: { summary: "模型路由规则", responses: { 200: { description: "规则列表" } } } },
  "/api/v1/routes/{id}": { patch: { summary: "调整权重（异步 op；权重和恒等 100）", parameters: [P("id", "规则 ID")], responses: { 202: { description: "opId（三段式推进）" }, 409: ERR("合规专路禁改") } } },
  "/api/v1/quotas": { get: { summary: "租户配额（三维 + 百分比）", responses: { 200: { description: "配额列表" } } } },
  "/api/v1/quotas/{tenant}": { patch: { summary: "调整配额", parameters: [P("tenant", "租户 ID")], responses: { 200: { description: "更新后配额" } } } },
  "/api/v1/policy-events": { get: { summary: "策略事件流（§7.2 枚举，按 subject 追溯）", parameters: [P("subject", "按对象过滤", "query"), P("limit", "条数", "query")], responses: { 200: { description: "事件列表" } } } },
  "/api/v1/ops": {
    post: { summary: "受理异步操作（accepted→executed→verified）", responses: { 202: { description: "opId" }, 412: ERR("前置未过（如不可中断任务阻塞维护）"), 451: ERR("能力未声明") } },
    get: { summary: "操作记录", responses: { 200: { description: "op 列表" } } },
  },
  "/api/v1/ops/{opId}": { get: { summary: "轮询操作状态", parameters: [P("opId", "OP-xxxx")], responses: { 200: { description: "三段式状态 + evidence" } } } },
  "/api/v1/keys": {
    get: { summary: "密钥列表（不含哈希）", responses: { 200: { description: "密钥列表" } } },
    post: { summary: "创建密钥（token 仅返回一次）", responses: { 201: { description: "密钥 + token" } } },
  },
  "/api/v1/keys/{id}/revoke": { post: { summary: "撤销密钥", parameters: [P("id", "密钥 ID")], responses: { 200: { description: "已撤销" } } } },
  "/api/v1/events/stream": { get: { summary: "SSE 事件流（event: policy/task/op；EventSource 可用 ?key=）", responses: { 200: { description: "text/event-stream" } } } },
};

function P(name, desc, where = "path") {
  return { name, in: where, required: where === "path", description: desc, schema: { type: "string" } };
}

export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "AXON Control Plane API",
      version: "0.95.0",
      description: "Agent Infra 统一控制平面 · 对象模型与状态机见 SPEC.md v0.95。" +
        "鉴权：Authorization: Bearer <API Key>。异步操作：POST 返回 accepted + opId，轮询 /ops/{opId} 直至终态。",
    },
    servers: [{ url: "/" }],
    tags: [
      { name: "setup", description: "初始化与密钥" }, { name: "assets", description: "L0-L2 资产目录" },
      { name: "agents", description: "L3 Agent：注册 / 心跳" }, { name: "tasks", description: "L4 任务状态机" },
      { name: "sandboxes", description: "沙箱实例" }, { name: "governance", description: "路由 / 配额 / 策略事件" },
      { name: "ops", description: "opId 三段式异步操作" },
    ],
    paths: PATHS,
    components: {
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: {
          code: { type: "string", description: "SOURCE_CONFLICT | CAPABILITY_NOT_DECLARED | STATE_TRANSITION_INVALID | PRECONDITION_FAILED | QUOTA_EXCEEDED | ..." },
          message: { type: "string" }, detail: {} } } } },
        Server: { type: "object", properties: { id: { type: "string" }, state: { type: "string" } } },
        Op: { type: "object", properties: {
          opId: { type: "string" }, status: { type: "string", enum: ["accepted", "executed", "verified", "failed"] },
          evidence: { type: "array", items: { type: "object" } }, limits: { type: "array", items: { type: "string" } } } },
      },
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "API Key（axk_ 前缀）" } },
    },
    security: [{ bearer: [] }],
  };
}

export function docsHtml() {
  const rows = Object.entries(PATHS).map(([p, ops]) => Object.entries(ops).map(([m, o]) =>
    `<tr><td><span class="m ${m}">${m.toUpperCase()}</span></td><td class="p">${p}</td><td>${o.summary}</td></tr>`).join("")).join("");
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>AXON API 文档</title>
<style>
body{font:13px/1.7 "Segoe UI",system-ui,sans-serif;background:#0a1226;color:#cfe3ff;margin:0;padding:32px}
h1{font-size:20px;color:#37e2ff}p{color:#8fa8cc;max-width:860px}
table{border-collapse:collapse;margin-top:16px;min-width:720px}
td{padding:6px 12px;border-bottom:1px solid #1c2a4a;vertical-align:top}
.p{font-family:Consolas,monospace;color:#9fd0ff;white-space:nowrap}
.m{font-weight:700;font-size:11px;padding:2px 8px;border-radius:3px}
.get{background:#123a5c;color:#6f9bff}.post{background:#123f33;color:#3ddba4}.patch{background:#4a3413;color:#ff9350}
a{color:#37e2ff}
</style></head><body>
<h1>AXON Control Plane API</h1>
<p>OpenAPI 3.1：<a href="/api/v1/openapi.json">/api/v1/openapi.json</a> · 鉴权 <code>Authorization: Bearer &lt;axk_…&gt;</code> ·
异步操作三段式 accepted → executed → verified（SPEC §4.3）· 错误码见 SPEC §9.4。</p>
<table>${rows}</table></body></html>`;
}
