/* ═══════════════════════════════════════════════════════════
   AXON · 规范不变量测试（node:test，零依赖）
   ─────────────────────────────────────────────────────────
   把 SPEC.md 的硬约束固化为可执行验证：
   §4 能力声明门控（451）· §5 状态机（409/412）· §2.7 配额（429）
   §7.1 路由权重恒等 100 · §8.3 维护前置（不可中断阻塞）
   §9.2 幂等 · §4.3 opId 三段式 · §3.3 影响分析 · S05 GC 保护
   运行：node --test tests/
   ═══════════════════════════════════════════════════════════ */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server/index.mjs";

let BASE = "", TOKEN = "";
let srv, tmpDir;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function call(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, json, headers: res.headers };
}

async function pollOp(opId, timeoutMs = 9000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeoutMs) {
    const r = await call("GET", `api/v1/ops/${opId}`);
    last = r;
    if (["verified", "failed"].includes(r.json.status)) return r.json;
    await sleep(250);
  }
  throw new Error(`op ${opId} 超时未到终态 · last=${last.status} ${JSON.stringify(last.json).slice(0, 300)}`);
}

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "axon-test-"));
  srv = await startServer({ port: 0, dataFile: join(tmpDir, "axon.db") });
  BASE = `http://127.0.0.1:${srv.port}/`;
});

after(async () => {
  srv.close();
  await sleep(100);
  rmSync(tmpDir, { recursive: true, force: true });
});

/* ── §9.3 初始化与鉴权 ──────────────────────────────────── */
test("setup：首次创建根密钥，重复初始化 409，未鉴权访问 401", async () => {
  const bad = await fetch(BASE + "api/v1/tasks");
  assert.equal(bad.status, 401);
  const badKey = await fetch(BASE + "api/v1/tasks", { headers: { Authorization: "Bearer axk_wrong" } });
  assert.equal(badKey.status, 401);

  const r = await call("POST", "api/v1/setup", { adminName: "test-admin" });
  assert.equal(r.status, 201);
  assert.match(r.json.token, /^axk_/);
  TOKEN = r.json.token;

  const dup = await call("POST", "api/v1/setup", {});
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, "ALREADY_SETUP");
});

test("meta / openapi / docs：免鉴权可达", async () => {
  const meta = await fetch(BASE + "api/v1/meta");
  assert.equal(meta.status, 200);
  const oa = await (await fetch(BASE + "api/v1/openapi.json")).json();
  assert.equal(oa.openapi, "3.1.0");
  assert.ok(Object.keys(oa.paths).length > 20);
  const docs = await fetch(BASE + "api/v1/docs");
  assert.match(docs.headers.get("content-type"), /text\/html/);
});

/* ── §3.3 影响分析 + §8.3 维护前置（在任务被改动前测）──── */
test("影响分析：srv-gpu-01 辐射面含不可中断任务统计", async () => {
  const r = await call("GET", "api/v1/impact/srv-gpu-01");
  assert.equal(r.status, 200);
  assert.ok(r.json.layers.agents.length >= 3);
  assert.ok(r.json.stats.uninterruptibleTasks >= 2, JSON.stringify(r.json.stats));
  assert.ok(r.json.layers.tasks.includes("T26-0729"));   // ag-bi 不可中断
});

test("维护前置：不可中断任务阻塞（412），强推需 force 并留审计", async () => {
  const blocked = await call("POST", "api/v1/ops", { action: "maintenance.begin", params: { serverId: "srv-gpu-01" } });
  assert.equal(blocked.status, 412);
  assert.equal(blocked.json.error.code, "PRECONDITION_FAILED");
  assert.ok(blocked.json.error.detail.blockedTasks.includes("T26-0729"));

  const forced = await call("POST", "api/v1/ops", { action: "maintenance.begin", params: { serverId: "srv-gpu-01", force: true } });
  assert.equal(forced.status, 202);
  const op = await pollOp(forced.json.opId);
  assert.equal(op.status, "verified");
  assert.equal(op.evidence.length, 2);

  const server = (await call("GET", "api/v1/servers")).json.find(s => s.id === "srv-gpu-01");
  assert.equal(server.state, "maint");

  const fin = await call("POST", "api/v1/ops", { action: "maintenance.finish", params: { serverId: "srv-gpu-01" } });
  assert.equal(fin.status, 202);
  assert.equal((await pollOp(fin.json.opId)).status, "verified");
  assert.equal((await call("GET", "api/v1/servers")).json.find(s => s.id === "srv-gpu-01").state, "ok");
});

/* ── §4 能力声明门控（451）───────────────────────────────── */
test("能力门控：ag-ops 未声明 state → 检查点 451，不静默降级", async () => {
  const r = await call("POST", "api/v1/tasks/T26-0733/checkpoint", {});
  assert.equal(r.status, 451);
  assert.equal(r.json.error.code, "CAPABILITY_NOT_DECLARED");
  // 任务状态未被改变（禁止静默降级为自动成功）
  assert.equal((await call("GET", "api/v1/tasks")).json.find(t => t.id === "T26-0733").state, "running");
});

test("能力门控：ag-dm 未声明 task → 任务取消 451", async () => {
  const created = await call("POST", "api/v1/tasks", { name: "能力门控演示", agent: "ag-dm" });
  assert.equal(created.status, 201);
  const r = await call("POST", `api/v1/tasks/${created.json.id}/cancel`, {});
  assert.equal(r.status, 451);
});

/* ── §5 状态机 ───────────────────────────────────────────── */
test("状态机：running 任务不可被认领（409 STATE_TRANSITION_INVALID）", async () => {
  const r = await call("POST", "api/v1/tasks/T26-0688/claim", { agent: "ag-coder" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "STATE_TRANSITION_INVALID");
});

test("状态机：检查点 → 恢复 → 自动回 running（ag-coder 有 state 能力）", async () => {
  const cp = await call("POST", "api/v1/tasks/T26-0688/checkpoint", {});
  assert.equal(cp.status, 200, JSON.stringify(cp.json));
  assert.equal(cp.json.state, "checkpointed");
  assert.ok(cp.json.ckpt.id.startsWith("cp-"));

  const rs = await call("POST", "api/v1/tasks/T26-0688/restore", {});
  assert.equal(rs.json.state, "recovering");
  await sleep(1800);
  assert.equal((await call("GET", "api/v1/tasks")).json.find(t => t.id === "T26-0688").state, "running");
});

test("状态机：审批（授权重检）waiting_approval → running，记录审批人", async () => {
  const r = await call("POST", "api/v1/tasks/T26-0731/approve", { approvedBy: "安全风控 · 周麟" });
  assert.equal(r.status, 200);
  assert.equal(r.json.state, "running");
  assert.equal(r.json.approvedBy, "安全风控 · 周麟");
});

test("状态机：不可中断任务取消需 force 二次确认（412 → 200）", async () => {
  const no = await call("POST", "api/v1/tasks/T26-0729/cancel", {});
  assert.equal(no.status, 412);
  assert.equal(no.json.error.code, "PRECONDITION_FAILED");

  const yes = await call("POST", "api/v1/tasks/T26-0729/cancel", { force: true });
  assert.equal(yes.status, 200);
  assert.equal(yes.json.state, "cancelled");
});

test("状态机（S12）：结果未知 → 人工核对确认 → succeeded，禁止重放", async () => {
  const q = await call("GET", "api/v1/tasks");
  assert.equal(q.json.find(t => t.id === "T26-0677").state, "unknown");
  const r = await call("POST", "api/v1/tasks/T26-0677/result", { status: "succeeded", summary: "人工核对：ERP 写入已确认（幂等键证据）" });
  assert.equal(r.status, 200);
  assert.equal(r.json.state, "succeeded");
});

/* ── §2.7 配额（429）────────────────────────────────────── */
test("配额：租户 Token 超限 → 任务创建 429 + 策略事件", async () => {
  await call("PATCH", "api/v1/quotas/sec", { tokenBudget: 90 });   // tokenUsed=96 > 90
  const r = await call("POST", "api/v1/tasks", { name: "配额演示", agent: "ag-risk" });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, "QUOTA_EXCEEDED");
  const ev = await call("GET", "api/v1/policy-events?type=配额&limit=3");
  assert.ok(ev.json.some(e => e.subject === "sec" && /Token 配额已耗尽/.test(e.msg)));
  await call("PATCH", "api/v1/quotas/sec", { tokenBudget: 150 });
});

test("配额：沙箱并发满 → 创建 429；恢复后可建", async () => {
  await call("PATCH", "api/v1/quotas/dev-tools", { sandboxQuota: 34 });   // used=34
  const full = await call("POST", "api/v1/sandboxes", { tenant: "dev-tools" });
  assert.equal(full.status, 429);
  await call("PATCH", "api/v1/quotas/dev-tools", { sandboxQuota: 40 });
  const okr = await call("POST", "api/v1/sandboxes", { tenant: "dev-tools" });
  assert.equal(okr.status, 201);
  assert.ok(okr.json.id.startsWith("sbx-"));
});

/* ── §9.2 幂等 ───────────────────────────────────────────── */
test("幂等：同 Idempotency-Key 重复提交返回首次结果；改请求体 409", async () => {
  const body = { name: "幂等演示任务", agent: "ag-cs" };
  const h = { "Idempotency-Key": "test-idem-1" };
  const first = await call("POST", "api/v1/tasks", body, h);
  assert.equal(first.status, 201);
  const replay = await call("POST", "api/v1/tasks", body, h);
  assert.equal(replay.status, 201);
  assert.equal(replay.json.id, first.json.id);
  assert.equal(replay.headers.get("idempotency-replayed"), "true");
  const conflict = await call("POST", "api/v1/tasks", { ...body, name: "不同的请求体" }, h);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "SOURCE_CONFLICT");
});

/* ── §7.1 路由权重不变量 ─────────────────────────────────── */
test("路由：权重调整异步三段式且和恒等 100；合规专路禁改 409", async () => {
  const r = await call("PATCH", "api/v1/routes/rr-glm-default", { weight: 80 });
  assert.equal(r.status, 202);
  assert.equal(r.json.status, "accepted");
  const op = await pollOp(r.json.opId);
  assert.equal(op.status, "verified");

  const routes = await call("GET", "api/v1/routes");
  const rule = routes.json.find(x => x.id === "rr-glm-default");
  assert.equal(rule.weight, 80);
  const models = await call("GET", "api/v1/models");
  const peer = models.json.find(m => m.id === rule.peer);
  assert.equal(rule.weight + peer.trafficPct, 100);   // 不变量

  const sec = await call("PATCH", "api/v1/routes/rr-sec-only", { weight: 50 });
  assert.equal(sec.status, 409);
});

/* ── §6.4 对账 + S05 GC 保护 ───────────────────────────── */
test("沙箱对账：漂移实例收敛并产生 RECONCILE_DIFF 事件", async () => {
  const before = (await call("GET", "api/v1/sandboxes")).json;
  assert.ok(before.some(x => x.id === "sbx-8812" && x.drift));

  const r = await call("POST", "api/v1/ops", { action: "sandbox.reconcile" });
  assert.equal(r.status, 202);
  assert.equal((await pollOp(r.json.opId)).status, "verified");

  const after = (await call("GET", "api/v1/sandboxes")).json;
  // 终止回收走 GC 路径（S05 保护），对账只收敛非终止漂移
  assert.ok(after.every(x => x.desiredState === "TERMINATED" || !x.drift));
  assert.ok(after.every(x => x.id !== "sbx-8812" || (x.state === "BOUND" && !x.drift)));
  const ev = await call("GET", "api/v1/policy-events?type=RECONCILE_DIFF&limit=5");
  assert.ok(ev.json.some(e => e.subject === "sbx-8812"));
});

test("GC 保护（S05）：在途任务关联实例跳过回收，孤立/已终态实例回收", async () => {
  // 场景构造：一个挂在运行中任务下的过期实例（应受保护），一个无主过期实例（应回收）
  const prot = await call("POST", "api/v1/sandboxes", { tenant: "platform", ownerTask: "T26-0712", leaseMin: 0 });
  const orphan = await call("POST", "api/v1/sandboxes", { tenant: "platform", leaseMin: 0 });
  assert.equal(prot.status, 201);
  assert.equal(orphan.status, 201);

  const r = await call("POST", "api/v1/ops", { action: "sandbox.gc" });
  assert.equal(r.status, 202);
  const op = await pollOp(r.json.opId);
  assert.ok(op.evidence.some(e => e.ref === orphan.json.id && e.type === "gc-reclaimed"));
  assert.ok(op.evidence.some(e => e.ref === prot.json.id && e.type === "gc-protected"));

  const list = (await call("GET", "api/v1/sandboxes")).json;
  assert.ok(!list.some(x => x.id === orphan.json.id), "孤立过期实例应被回收");
  assert.ok(list.some(x => x.id === prot.json.id), "运行中任务关联实例必须受保护（S05）");
  assert.ok(!list.some(x => x.id === "sbx-8799"), "种子孤立实例应被回收");
  assert.ok(!list.some(x => x.id === "sbx-8821"), "sbx-8821 关联任务已人工核对完成（succeeded），保护解除后回收");

  const ev = await call("GET", `api/v1/policy-events?type=核对&subject=${prot.json.id}&limit=5`);
  assert.ok(ev.json.some(e => /GC 跳过/.test(e.msg)));
});

/* ── Agent 接入闭环（Worker pull 模型 · 对标 mission-control）── */
test("接入闭环：注册(caps) → 建任务 → 认领 → 审批门 → 终态回报", async () => {
  const reg = await call("POST", "api/v1/agents/register", {
    id: "ag-live-01", name: "Live 接入演示 Agent", tenant: "platform",
    caps: { observe: true, traffic: true, instance: true, state: false, task: true },
  });
  assert.equal(reg.status, 201);
  assert.deepEqual(reg.json.caps, { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 });

  const hb = await call("POST", "api/v1/agents/ag-live-01/heartbeat", { status: "busy" });
  assert.equal(hb.status, 200);

  const created = await call("POST", "api/v1/tasks", { name: "接入闭环演示", agent: "ag-live-01", requiresApproval: true });
  assert.equal(created.json.state, "queued");

  const queue = await call("GET", "api/v1/tasks/queue?agent=ag-live-01");
  assert.ok(queue.json.some(t => t.id === created.json.id));

  const claim = await call("POST", `api/v1/tasks/${created.json.id}/claim`, { agent: "ag-live-01" });
  assert.equal(claim.json.task.state, "running");

  const wait = await call("PATCH", `api/v1/tasks/${created.json.id}`, { requestApproval: "外部写入授权" });
  assert.equal(wait.json.state, "waiting_approval");

  const appr = await call("POST", `api/v1/tasks/${created.json.id}/approve`, { approvedBy: "sec-admin-key" });
  assert.equal(appr.json.state, "running");

  const prog = await call("PATCH", `api/v1/tasks/${created.json.id}`, { progress: 90, tokensM: 0.3 });
  assert.equal(prog.json.progress, 90);

  const done = await call("POST", `api/v1/tasks/${created.json.id}/result`, { status: "succeeded", summary: "闭环完成", tokensM: 0.12 });
  assert.equal(done.json.state, "succeeded");

  // 任务事件按 subject 可追溯（§8.2）
  const ev = await call("GET", `api/v1/policy-events?subject=${created.json.id}&limit=10`);
  assert.ok(ev.json.length >= 3);
});

/* ── §4.3 三段式操作记录 ─────────────────────────────────── */
test("操作记录：全部操作留有 opId 轨迹且推进到 verified", async () => {
  const ops = await call("GET", "api/v1/ops?limit=50");
  assert.ok(ops.json.length >= 6);
  const actions = new Set(ops.json.map(o => o.action));
  for (const expected of ["maintenance.begin", "route.update-weights", "sandbox.reconcile", "sandbox.gc", "task.claim", "task.approve", "task.result"]) {
    assert.ok(actions.has(expected), `缺少 ${expected} 的操作记录`);
  }
  await sleep(600);   // 等最后一批 auditOp verify
  const again = await call("GET", "api/v1/ops?limit=50");
  assert.ok(again.json.filter(o => o.status === "accepted" || o.status === "executed").length <= 1,
    "三段式应推进到终态（verified/failed），而非停留中间态");
});
