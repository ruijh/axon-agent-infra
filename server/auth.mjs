/* ═══════════════════════════════════════════════════════════
   AXON · 鉴权：API Key / 角色 / 权限矩阵（SPEC §9.3）
   ─────────────────────────────────────────────────────────
   角色（对齐报告 §3.3 + 机器角色 agent）：
     platform-admin  AI 平台管理员 —— 全量（密钥、配额、路由、对象）
     infra-admin     基础设施管理员 —— 只读 + 维护编排（maintenance.*）
     agent-owner     Agent 应用负责人 —— 只读 + 任务/Agent 操作
     sec-admin       安全管理员 —— 只读 + 策略事件 + 密钥管理
     biz-owner       业务负责人 —— 只读
     agent           机器角色（Worker）—— 心跳 / 认领 / 回报
   ═══════════════════════════════════════════════════════════ */
import { createHash, randomBytes } from "node:crypto";
import { ApiError, newToken, newKeyId, nowIso } from "./util.mjs";

export const ROLES = ["platform-admin", "infra-admin", "agent-owner", "sec-admin", "biz-owner", "agent"];

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** 权限矩阵：能力 → 允许角色（“注册接入 ≠ 控制能力”，§4.2） */
export const PERMS = {
  read:            ROLES,
  taskWrite:       ["platform-admin", "agent-owner", "sec-admin"],
  taskApprove:     ["platform-admin", "agent-owner", "sec-admin"],
  taskMachine:     ["agent", "platform-admin"],
  agentWrite:      ["platform-admin", "agent-owner"],
  agentMachine:    ["agent", "platform-admin"],
  governance:      ["platform-admin"],
  keysManage:      ["platform-admin", "sec-admin"],
  maintenance:     ["platform-admin", "infra-admin"],
  policyRead:      ["platform-admin", "infra-admin", "sec-admin"],
};

export function createKey(store, { name, role }) {
  if (!ROLES.includes(role)) throw new ApiError(400, "BAD_ROLE", `未知角色 ${role}，可选：${ROLES.join(" / ")}`);
  const token = newToken();
  const key = { id: newKeyId(), name: name || role, role, hash: sha256(token), createdAt: nowIso() };
  store.saveKey(key);
  return { ...key, token };   // token 仅此一次返回
}

/** 从请求解析 Bearer token → key 记录；失败抛 401 */
export function authenticate(store, req) {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) throw new ApiError(401, "UNAUTHENTICATED", "缺少 Authorization: Bearer <API Key>");
  const key = store.findKeyByHash(sha256(m[1].trim()));
  if (!key) throw new ApiError(401, "UNAUTHENTICATED", "API Key 无效或已撤销");
  return key;
}

export function requireRole(key, perm) {
  const allowed = PERMS[perm];
  if (!allowed.includes(key.role)) {
    throw new ApiError(403, "FORBIDDEN", `角色 ${key.role} 无 ${perm} 权限（需要：${allowed.join(" / ")}）`);
  }
}

/** 首次初始化：创建 platform-admin 根密钥（对标 mission-control /setup） */
export function setup(store, { adminName }) {
  if (store.listKeys().some(k => !k.revoked)) {
    throw new ApiError(409, "ALREADY_SETUP", "控制平面已完成初始化；如需新密钥请用 keys 接口创建");
  }
  return createKey(store, { name: adminName || "admin", role: "platform-admin" });
}
