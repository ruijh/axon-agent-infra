import { ApiError } from "./util.mjs";
import { impactAnalysis } from "./impact.mjs";
export function reject(message, status = 400) {
  throw new ApiError(
    status,
    status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
    message,
  );
}
export function id(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)
  )
    reject("无效对象 ID");
}
export function validate(body) {
  for (const k of [
    "id",
    "agent",
    "agentId",
    "tenant",
    "tenantId",
    "runtime",
    "cluster",
    "ownerTask",
    "serverId",
    "ruleId",
  ])
    if (body[k] != null) id(body[k]);
  for (const k of [
    "name",
    "owner",
    "ver",
    "note",
    "summary",
    "reason",
    "requestApproval",
    "resultUnknown",
    "approvedBy",
    "evidence",
  ])
    if (
      body[k] !== undefined &&
      (typeof body[k] !== "string" || body[k].length > 4096)
    )
      reject(k + " 必须是有限长度字符串");
  for (const k of ["models", "tools", "stores"])
    if (body[k] !== undefined) {
      if (!Array.isArray(body[k]) || body[k].length > 1000)
        reject(k + " 必须为数组");
      body[k].forEach(id);
    }
  for (const k of [
    "tokensM",
    "costCny",
    "progress",
    "leaseMin",
    "tokenBudget",
    "sandboxQuota",
    "stepsMax",
  ])
    if (
      body[k] !== undefined &&
      (typeof body[k] !== "number" || !Number.isFinite(body[k]) || body[k] < 0)
    )
      reject(k + " 必须为有限非负数");
  for (const k of [
    "force",
    "requiresApproval",
    "interruptible",
    "renewable",
    "idem",
  ])
    if (body[k] !== undefined && typeof body[k] !== "boolean")
      reject(k + " 必须为布尔值");
  if (body.params !== undefined) {
    if (
      !body.params ||
      typeof body.params !== "object" ||
      Array.isArray(body.params)
    )
      reject("params 必须为对象");
    validate(body.params);
  }
  if (
    body.action !== undefined &&
    (typeof body.action !== "string" || body.action.length > 128)
  )
    reject("无效操作名称");
  if (body.caps !== undefined) {
    if (!body.caps || typeof body.caps !== "object" || Array.isArray(body.caps))
      reject("caps 必须为对象");
    for (const v of Object.values(body.caps))
      if (![true, false, 0, 1].includes(v)) reject("无效能力值");
  }
}
export function own(store, key, agentId) {
  if (key.role !== "agent") return;
  if (!key.agentId || key.agentId !== agentId)
    reject("机器密钥不能操作其他 Agent", 403);
  const a = store.agent(agentId);
  if (a && a.tenant !== key.tenantId) reject("租户不匹配", 403);
}
export function admission(store, agentId) {
  const a = store.agent(agentId);
  if (!a) reject("Agent 不存在");
  if (a.admission === "draining" || a.state === "retired")
    reject("Agent 已限制准入", 409);
  for (const s of store.servers)
    if (
      s.state === "maint" &&
      impactAnalysis(store, s.id).layers.agents.includes(agentId)
    )
      reject("承载资源处于维护状态", 409);
}
