#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════
   AXON · CLI（对标 mission-control 的 `mc` 命令行）
   用法：node cli.mjs <command> [args]
   环境：AXON_URL（默认 http://127.0.0.1:8437）
         AXON_API_KEY（setup 之外都需要）
   ═══════════════════════════════════════════════════════════ */

const BASE = process.env.AXON_URL || "http://127.0.0.1:8437";
const KEY = process.env.AXON_API_KEY || "";

async function call(method, path, body, extraHeaders = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, json };
}

function die(msg) { console.error("✕ " + msg); process.exit(1); }
function ok(msg) { console.log("✓ " + msg); }

const W = 14;
const row = (a, b, c) => console.log(`  ${String(a).padEnd(26)}${String(b || "").padEnd(10)}${c || ""}`);

const COMMANDS = {
  setup: {
    help: "初始化控制平面，创建根密钥（仅首次）",
    async run(args) {
      const r = await call("POST", "/api/v1/setup", { adminName: args[0] || "admin" });
      if (!r.ok) die(r.json.error?.message || JSON.stringify(r.json));
      ok("控制平面已初始化");
      console.log(`  密钥：${r.json.keyId}（platform-admin）`);
      console.log(`  Token：${r.json.token}`);
      console.log(`  后续使用：\n    set AXON_API_KEY=${r.json.token}\n    node cli.mjs tasks`);
    },
  },

  keys: {
    help: "keys create <name> <role> | keys list | keys revoke <id>",
    async run(args) {
      if (args[0] === "create") {
        const r = await call("POST", "/api/v1/keys", { name: args[1], role: args[2] });
        if (!r.ok) die(r.json.error?.message);
        ok(`密钥已创建：${r.json.keyId}（${r.json.role}）`);
        console.log(`  Token：${r.json.token}（仅此一次显示）`);
      } else if (args[0] === "revoke") {
        const r = await call("POST", `/api/v1/keys/${args[1]}/revoke`);
        r.ok ? ok("已撤销") : die(r.json.error?.message);
      } else {
        const r = await call("GET", "/api/v1/keys");
        if (!r.ok) die(r.json.error?.message);
        row("KEY", "ROLE", "NAME / LAST USED");
        r.json.forEach(k => row(k.id, k.role, `${k.name} · ${k.lastUsedAt ? "recently" : "never"}${k.revoked ? " · REVOKED" : ""}`));
      }
    },
  },

  agents: {
    help: "Agent 目录（含 caps 与心跳）",
    async run() {
      const r = await call("GET", "/api/v1/agents");
      if (!r.ok) die(r.json.error?.message);
      row("ID", "STATE", "CAPS（observe/traffic/instance/state/task）");
      for (const a of r.json) {
        const caps = ["observe", "traffic", "instance", "state", "task"].map(k => a.caps?.[k] ? k[0].toUpperCase() : "·").join("");
        row(a.id, a.state || "-", `${a.name} · caps=${caps}${a.live ? " · LIVE" : ""}${a.admission ? " · " + a.admission : ""}`);
      }
    },
  },

  tasks: {
    help: "任务列表（?state= / ?agent= 过滤：tasks [running|queued|...]）",
    async run(args) {
      const q = new URLSearchParams();
      if (args[0]) q.set("state", args[0]);
      const r = await call("GET", "/api/v1/tasks" + (q.toString() ? "?" + q : ""));
      if (!r.ok) die(r.json.error?.message);
      row("ID", "STATE", "NAME");
      r.json.forEach(t => row(t.id, t.state, `${t.name} · ${t.agent} · ${t.progress}%${t.interruptible === false ? " · 不可中断" : ""}`));
    },
  },

  "create-task": {
    help: "create-task <name> <agentId> [--approval] [--uninterruptible]",
    async run(args) {
      const [name, agent] = args;
      if (!name || !agent) die("用法：create-task <name> <agentId> [--approval] [--uninterruptible]");
      const r = await call("POST", "/api/v1/tasks", {
        name, agent,
        requiresApproval: args.includes("--approval"),
        interruptible: !args.includes("--uninterruptible"),
      }, { "Idempotency-Key": `cli-${Date.now()}` });
      if (!r.ok) die(r.json.error?.message);
      ok(`任务已创建：${r.json.id}（queued · 等待 ${agent} 认领）`);
    },
  },

  approve: {
    help: "approve <taskId> [审批人]",
    async run(args) {
      const r = await call("POST", `/api/v1/tasks/${args[0]}/approve`, { approvedBy: args[1] || "cli-operator" });
      if (!r.ok) die(r.json.error?.message);
      ok(`${args[0]} 审批通过 → 续跑`);
    },
  },

  cancel: {
    help: "cancel <taskId> [--force]（不可中断任务需 --force）",
    async run(args) {
      const r = await call("POST", `/api/v1/tasks/${args[0]}/cancel`, { force: args.includes("--force") });
      if (!r.ok) die(`${r.json.error?.code}：${r.json.error?.message}`);
      ok(`${args[0]} 已取消`);
    },
  },

  impact: {
    help: "impact <objectId> —— 影响分析（差异化能力）",
    async run(args) {
      const r = await call("GET", `/api/v1/impact/${args[0]}`);
      if (!r.ok) die(r.json.error?.message);
      const { layers, stats } = r.json;
      ok(`影响面（root=${args[0]}）：Infra×${stats.infraCount} 目录×${stats.catalogCount} Agent×${stats.agentCount} 在途任务×${stats.inFlightTasks} 不可中断×${stats.uninterruptibleTasks}`);
      row("层", "", "对象");
      row("Infra", stats.infraCount, layers.infra.join(", ") || "—");
      row("模型/工具", stats.catalogCount, layers.catalog.join(", ") || "—");
      row("Agent", stats.agentCount, layers.agents.join(", ") || "—");
      row("任务", layers.tasks.length, layers.tasks.join(", ") || "—");
    },
  },

  ops: {
    help: "ops [opId] —— 三段式操作记录 / 单条详情",
    async run(args) {
      const r = await call("GET", args[0] ? `/api/v1/ops/${args[0]}` : "/api/v1/ops?limit=15");
      if (!r.ok) die(r.json.error?.message);
      if (args[0]) {
        console.log(JSON.stringify(r.json, null, 2));
      } else {
        row("OP", "STATUS", "LABEL");
        r.json.forEach(o => row(o.opId, o.status, o.label));
      }
    },
  },

  events: {
    help: "events [n] —— 策略事件流",
    async run(args) {
      const r = await call("GET", `/api/v1/policy-events?limit=${args[0] || 12}`);
      if (!r.ok) die(r.json.error?.message);
      r.json.reverse().forEach(e => {
        console.log(`  ${e.ts.slice(11, 19)} [${e.type}] ${e.subject ? e.subject + " · " : ""}${e.msg}`);
      });
    },
  },

  maintenance: {
    help: "maintenance begin <serverId> [--force] | maintenance finish <serverId>",
    async run(args) {
      const action = args[0] === "begin" ? "maintenance.begin" : "maintenance.finish";
      const r = await call("POST", "/api/v1/ops", {
        action, params: { serverId: args[1], force: args.includes("--force") },
      }, { "Idempotency-Key": `mw-${args[0]}-${args[1]}-${Date.now()}` });
      if (!r.ok) die(`${r.json.error?.code}：${r.json.error?.message}`);
      ok(`已受理：${r.json.opId} · ${r.json.label}（三段式推进，ops 命令查看）`);
    },
  },
};

/* ── main ── */
const [cmd, ...args] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help") {
  console.log(`AXON CLI —— 指向 ${KEY ? BASE + "（已配置密钥）" : BASE}

命令：`);
  for (const [name, c] of Object.entries(COMMANDS)) console.log(`  ${name.padEnd(W)} ${c.help}`);
  console.log(`\n环境变量：AXON_URL（默认 http://127.0.0.1:8437）· AXON_API_KEY`);
  process.exit(0);
}
const command = COMMANDS[cmd];
if (!command) die(`未知命令 ${cmd}（help 查看全部）`);
command.run(args).catch(e => die(e.message));
