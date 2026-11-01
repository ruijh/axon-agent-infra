/* ═══════════════════════════════════════════════════════════
   AXON · 世界模型种子（控制平面真实数据源）
   与 SPEC §2 对象模型对齐；字段口径与前端演示 assets/data.js 同源，
   但以规范字段名存储。首次启动时写入存储层，之后以存储层为准。
   ═══════════════════════════════════════════════════════════ */

export function seedWorld() {
  const servers = [
    { id: "srv-gpu-01", name: "GPU 推理节点 · 01", model: "NF5468M6 · 8×A100-80G", role: "推理", state: "ok",
      bmc: "10.32.0.11", bios: "5.2.4", bmcFw: "3.4.0", asset: "AST-10241",
      location: { room: "A2 机房", row: "03 列", rack: "R04", u: [20, 25] },
      sensors: { cpu: 46, mem: 61, gpu: 78, powerKw: 3.1, tempC: 46, fanPct: 42 } },
    { id: "srv-gpu-02", name: "GPU 执行节点 · 02", model: "NF5468M6 · 8×A100-80G", role: "沙箱执行", state: "ok",
      bmc: "10.32.0.12", bios: "5.2.4", bmcFw: "3.4.0", asset: "AST-10242",
      location: { room: "A2 机房", row: "03 列", rack: "R04", u: [26, 31] },
      sensors: { cpu: 52, mem: 67, gpu: 71, powerKw: 3.4, tempC: 49, fanPct: 51 } },
    { id: "srv-cpu-01", name: "通用服务节点 · 01", model: "NF5280M6 · 2×Xeon 8568Y+", role: "网关/平台服务", state: "warn",
      warnNote: "磁盘槽位 5 SMART 预警 · 建议更换",
      bmc: "10.32.0.13", bios: "4.8.1", bmcFw: "3.3.2", asset: "AST-10243",
      location: { room: "A2 机房", row: "03 列", rack: "R05", u: [33, 34] },
      sensors: { cpu: 38, mem: 55, gpu: 0, powerKw: 0.7, tempC: 41, fanPct: 35 },
      slots: [{ no: 5, type: "3.84T NVMe · 数据", state: "warn", note: "SMART 预警 · 待更换" }] },
    { id: "srv-sto-01", name: "状态存储节点 · 01", model: "NF5266M6 · 12×NVMe 8T", role: "检查点/记忆", state: "ok",
      bmc: "10.32.0.14", bios: "4.8.1", bmcFw: "3.3.2", asset: "AST-10244",
      location: { room: "A2 机房", row: "03 列", rack: "R05", u: [35, 36] },
      sensors: { cpu: 22, mem: 40, gpu: 0, powerKw: 0.6, tempC: 38, fanPct: 30 } },
  ];

  const racks = [
    { id: "R01", room: "A2 机房 · 03 列", note: "核心 / 带外网络", managed: true },
    { id: "R04", room: "A2 机房 · 03 列", note: "GPU 推理 / 执行", managed: true },
    { id: "R05", room: "A2 机房 · 03 列", note: "通用 / 存储", managed: true },
  ];

  const netDevices = [
    { id: "sw-core-01", kind: "core", model: "S9827-64EF · 64×400G", mgmt: "10.32.1.1", role: "核心 / Spine", location: { rack: "R01", u: 41 } },
    { id: "sw-core-02", kind: "core", model: "S9827-64EF · 64×400G", mgmt: "10.32.1.2", role: "核心 / Spine", location: { rack: "R01", u: 40 } },
    { id: "sw-tor-gpu", kind: "tor", model: "S9825-48Y8C", mgmt: "10.32.1.11", role: "接入 / Leaf", location: { rack: "R04", u: 41 } },
    { id: "sw-tor-svc", kind: "tor", model: "S9825-48Y8C", mgmt: "10.32.1.12", role: "接入 / Leaf", location: { rack: "R05", u: 41 } },
    { id: "sw-bmc", kind: "bmc", model: "S5735S-24P4X", mgmt: "10.32.1.20", role: "BMC 带外", location: { rack: "R05", u: 40 } },
  ];

  const netLinks = [
    { from: "srv-gpu-01", to: "sw-tor-gpu", speed: "2×100G", type: "业务", vlan: "VLAN 110", util: 55 },
    { from: "srv-gpu-02", to: "sw-tor-gpu", speed: "2×100G", type: "业务", vlan: "VLAN 110", util: 48 },
    { from: "srv-cpu-01", to: "sw-tor-svc", speed: "2×25G", type: "业务", vlan: "VLAN 120", util: 22 },
    { from: "srv-sto-01", to: "sw-tor-svc", speed: "2×100G", type: "业务", vlan: "VLAN 130", util: 34 },
    { from: "sw-tor-gpu", to: "sw-core-01", speed: "2×400G", type: "上行", vlan: "Trunk · ECMP", util: 63 },
    { from: "sw-tor-svc", to: "sw-core-01", speed: "2×100G", type: "上行", vlan: "Trunk · ECMP", util: 18 },
    { from: "sw-bmc", to: "sw-core-01", speed: "1×10G", type: "带外", vlan: "VLAN 9", util: 12 },
  ];

  const infra = [
    { id: "rt-langgraph", kind: "runtime", name: "LangGraph Runtime", ver: "0.2.71", host: "srv-gpu-01", state: "ok" },
    { id: "sb-e2b", kind: "sandbox", name: "E2B 沙箱集群", ver: "1.5.2", host: "srv-gpu-02", state: "ok",
      template: "ubuntu-24-nocode-c4" },
    { id: "gw-model", kind: "gateway", name: "模型网关 · Higress", ver: "2.1.0", host: "srv-cpu-01", state: "ok" },
    { id: "gw-mcp", kind: "gateway", name: "MCP 工具网关", ver: "1.3.0", host: "srv-cpu-01", state: "ok" },
    { id: "st-ckpt", kind: "state", name: "检查点存储", ver: "v2", host: "srv-sto-01", state: "ok" },
    { id: "st-mem", kind: "state", name: "记忆库 · Redis", ver: "7.2", host: "srv-sto-01", state: "ok" },
    { id: "svc-iam", kind: "identity", name: "身份与凭据服务", ver: "3.4", host: "srv-sto-01", state: "ok" },
  ];

  const models = [
    { id: "ep-glm", name: "GLM-4.7 主力端点", vendor: "Zhipu · 私有化部署", ctx: "200K", state: "ok", trafficPct: 86, p95: 1.8, tps: 940, via: "gw-model" },
    { id: "ep-ds", name: "DeepSeek-V4 备用端点", vendor: "DeepSeek · 私有化部署", ctx: "128K", state: "standby", trafficPct: 14, p95: 2.4, tps: 180, via: "gw-model" },
  ];

  const tools = [
    { id: "tl-ticket", name: "工单系统 MCP", ver: "v3.2", effect: "external-write", idem: true, contract: "ok", consumers: ["ag-cs", "ag-risk"] },
    { id: "tl-kb", name: "知识库检索 MCP", ver: "v2.0", effect: "readonly", idem: true, contract: "ok", consumers: ["ag-cs", "ag-bi"] },
    { id: "tl-git", name: "代码仓库 MCP", ver: "v4.1", effect: "readonly", idem: true, contract: "ok", consumers: ["ag-coder", "ag-dm"] },
    { id: "tl-ci", name: "CI/CD 触发 MCP", ver: "v2.3", effect: "external-write", idem: true, contract: "ok", consumers: ["ag-coder"] },
    { id: "tl-web", name: "浏览器工具 MCP", ver: "v1.7", effect: "sandboxed", idem: true, contract: "ok", consumers: ["ag-coder", "ag-ops"] },
    { id: "tl-erp", name: "ERP 写入 MCP", ver: "v5.0", effect: "external-write", idem: false, contract: "warn", consumers: ["ag-risk"] },
  ];

  const agents = [
    { id: "ag-cs", name: "智能客服 Agent", ver: "v2.4.1", owner: "客服业务部 · 李文", tenant: "customer-svc",
      state: "running", instances: 4, runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-ticket", "tl-kb"], stores: ["st-mem"],
      caps: { observe: 1, traffic: 1, instance: 1, state: 1, task: 1 }, live: false },
    { id: "ag-coder", name: "代码助手 Agent", ver: "v1.8.0", owner: "研发效能 · 陈曦", tenant: "dev-tools",
      state: "running", instances: 6, runtime: "sb-e2b", models: ["ep-glm", "ep-ds"], tools: ["tl-git", "tl-ci", "tl-web"], stores: [],
      caps: { observe: 1, traffic: 1, instance: 1, state: 1, task: 1 }, live: false },
    { id: "ag-ops", name: "运维巡检 Agent", ver: "v3.0.2", owner: "平台工程 · 赵航", tenant: "platform",
      state: "running", instances: 2, runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-web"], stores: [],
      caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 }, live: false },
    { id: "ag-bi", name: "经营分析 Agent", ver: "v2.1.3", owner: "数据经营 · 孙萌", tenant: "data-biz",
      state: "running", instances: 2, runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-kb"], stores: ["st-mem"],
      caps: { observe: 1, traffic: 1, instance: 0, state: 1, task: 1 }, live: false },
    { id: "ag-risk", name: "风控审核 Agent", ver: "v1.2.0", owner: "安全风控 · 周麟", tenant: "sec",
      state: "running", instances: 3, runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-ticket", "tl-erp"], stores: [],
      caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 }, live: false },
    { id: "ag-dm", name: "数据治理 Agent", ver: "v0.9.0-rc", owner: "数据经营 · 孙萌", tenant: "data-biz",
      state: "gray", instances: 1, runtime: "sb-e2b", models: ["ep-ds"], tools: ["tl-git"], stores: [],
      caps: { observe: 1, traffic: 1, instance: 0, state: 0, task: 0 }, live: false },
  ];

  const tasks = [
    { id: "T26-0688", name: "支付模块重构 · 阶段 2", agent: "ag-coder", tenant: "dev-tools", state: "running",
      progress: 38, interruptible: true, tokensM: 2.4, costCny: 172, requiresApproval: false },
    { id: "T26-0712", name: "工单批量归档 · 夜间批", agent: "ag-cs", tenant: "customer-svc", state: "running",
      progress: 71, interruptible: true, tokensM: 1.1, costCny: 64, requiresApproval: false },
    { id: "T26-0733", name: "全链路夜间巡检", agent: "ag-ops", tenant: "platform", state: "running",
      progress: 12, interruptible: true, tokensM: 0.6, costCny: 31, requiresApproval: false },
    { id: "T26-0729", name: "季度经营简报生成", agent: "ag-bi", tenant: "data-biz", state: "running",
      progress: 55, interruptible: false, tokensM: 3.8, costCny: 289, requiresApproval: false },
    { id: "T26-0731", name: "供应商准入风控审核", agent: "ag-risk", tenant: "sec", state: "waiting_approval",
      progress: 62, interruptible: false, tokensM: 1.2, costCny: 86, requiresApproval: true,
      ckpt: { id: "cp-9f21", mode: "app-checkpoint", compatible: true },
      waitReason: "等待安全风控 · 周麟 审批（外部 ERP 写入授权）" },
    { id: "T26-0725", name: "高风险退款复核", agent: "ag-risk", tenant: "sec", state: "waiting_approval",
      progress: 28, interruptible: false, tokensM: 0.4, costCny: 22, requiresApproval: true,
      ckpt: { id: "cp-31e8", mode: "app-checkpoint", compatible: true },
      waitReason: "等待客服业务部 · 李文 补充订单上下文" },
    { id: "T26-0719", name: "客户投诉深查报告", agent: "ag-cs", tenant: "customer-svc", state: "checkpointed",
      progress: 81, interruptible: true, tokensM: 1.9, costCny: 121, requiresApproval: false,
      ckpt: { id: "cp-55d0", mode: "full-snapshot", compatible: true },
      waitReason: "等待用户补充信息 · 计算资源已释放" },
    { id: "T26-0741", name: "发布流水线代码审计", agent: "ag-coder", tenant: "dev-tools", state: "queued",
      progress: 0, interruptible: true, tokensM: 0, costCny: 0, requiresApproval: false,
      waitReason: "dev-tools 沙箱并发配额等待" },
    { id: "T26-0705", name: "库存对账重跑", agent: "ag-bi", tenant: "data-biz", state: "recovering",
      progress: 44, interruptible: true, tokensM: 2.2, costCny: 158, requiresApproval: false,
      ckpt: { id: "cp-77c3", mode: "app-checkpoint", compatible: true } },
    { id: "T26-0677", name: "ERP 批量写入 · 供应商台账", agent: "ag-risk", tenant: "sec", state: "unknown",
      progress: 87, interruptible: false, tokensM: 0.9, costCny: 44, requiresApproval: false,
      ckpt: { id: "cp-8811", mode: "app-checkpoint", compatible: true },
      waitReason: "工具调用超时且无幂等键 · 已进入人工核对队列（S12）" },
  ];

  const sandboxes = [
    { id: "sbx-8801", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "WARM", desiredState: "WARM",
      ownerTask: null, ownerNote: "预热池", tenant: null, leaseMin: null,
      resources: { vcpu: 4, memG: 8 }, netPolicy: { egress: "allowlist", cidrs: ["10.32.0.0/16"] } },
    { id: "sbx-8802", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "WARM", desiredState: "WARM",
      ownerTask: null, ownerNote: "预热池", tenant: null, leaseMin: null,
      resources: { vcpu: 4, memG: 8 }, netPolicy: { egress: "allowlist", cidrs: ["10.32.0.0/16"] } },
    { id: "sbx-8805", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "BOUND", desiredState: "BOUND",
      ownerTask: "T26-0688", tenant: "dev-tools", leaseMin: 38, renewable: true,
      resources: { vcpu: 8, memG: 16 }, netPolicy: { egress: "allowlist", cidrs: ["10.32.0.0/16", "github.com"] } },
    { id: "sbx-8806", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "BOUND", desiredState: "BOUND",
      ownerTask: null, ownerNote: "ag-dm · 灰度会话", tenant: "data-biz", leaseMin: 9, renewable: true,
      resources: { vcpu: 4, memG: 8 }, netPolicy: { egress: "allowlist", cidrs: ["10.32.0.0/16"] } },
    { id: "sbx-8810", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "PAUSED", desiredState: "PAUSED",
      ownerTask: "T26-0731", tenant: "sec", leaseMin: null,
      resources: { vcpu: 8, memG: 16 }, netPolicy: { egress: "deny-all", cidrs: [] },
      note: "检查点已暂存 · 等待审批，恢复前重检授权" },
    { id: "sbx-8812", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "PAUSED", desiredState: "BOUND",
      ownerTask: "T26-0705", tenant: "data-biz", leaseMin: null,
      resources: { vcpu: 8, memG: 16 }, netPolicy: { egress: "allowlist", cidrs: ["10.32.0.0/16"] },
      note: "节点维护后未恢复 · 存在状态漂移" },
    { id: "sbx-8821", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "GC-PENDING", desiredState: "TERMINATED",
      ownerTask: "T26-0677", tenant: "sec", leaseMin: 0,
      resources: { vcpu: 4, memG: 8 }, netPolicy: { egress: "deny-all", cidrs: [] },
      note: "租约已过期 · 关联任务结果待核对，受保护暂缓回收" },
    { id: "sbx-8799", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "GC-PENDING", desiredState: "TERMINATED",
      ownerTask: null, ownerNote: "会话已结束", tenant: "dev-tools", leaseMin: 0,
      resources: { vcpu: 4, memG: 8 }, netPolicy: { egress: "deny-all", cidrs: [] },
      note: "孤立实例 · 租约过期，可回收" },
  ];

  const routes = [
    { id: "rr-glm-default", name: "默认主力路由", match: { model: "glm-4.7", tenant: "*" },
      fwd: "ep-glm", peer: "ep-ds", weight: 86, prio: 100,
      fallback: { to: "ep-ds", on: ["circuit-open:5"], validateCaps: ["ctx", "tool-call"] } },
    { id: "rr-dev-dual", name: "研发效能 · 双活分担", match: { tenant: "dev-tools" },
      fwd: "ep-glm", peer: "ep-ds", weight: 70, prio: 200,
      fallback: { to: "ep-ds", on: ["circuit-open:5"], validateCaps: ["ctx"] } },
    { id: "rr-sec-only", name: "安全风控 · 合规专路", match: { tenant: "sec" },
      fwd: "ep-glm", peer: null, weight: 100, prio: 300,
      fallback: null, fallbackNote: "无备用（合规要求：不切换端点）" },
  ];

  const tenants = [
    { id: "customer-svc", name: "客服业务部", prio: "P1", tokenBudget: 300, tokenUsed: 187, sandboxQuota: 20, sandboxUsed: 11, stepLimit: 40 },
    { id: "dev-tools", name: "研发效能", prio: "P1", tokenBudget: 500, tokenUsed: 438, sandboxQuota: 40, sandboxUsed: 34, stepLimit: 80 },
    { id: "data-biz", name: "数据经营", prio: "P2", tokenBudget: 200, tokenUsed: 121, sandboxQuota: 12, sandboxUsed: 7, stepLimit: 60 },
    { id: "sec", name: "安全风控", prio: "P1", tokenBudget: 150, tokenUsed: 96, sandboxQuota: 16, sandboxUsed: 9, stepLimit: 50 },
    { id: "platform", name: "平台工程", prio: "P2", tokenBudget: 100, tokenUsed: 41, sandboxQuota: 8, sandboxUsed: 2, stepLimit: 30 },
  ];

  const events = [
    { kind: "policy", type: "阻断", severity: "crit", source: "gw-mcp", subject: "T26-0688",
      msg: "沙箱内尝试访问未授权端点 10.32.0.9:443，已在执行边界阻断", refs: ["sbx-8805", "tl-web"] },
    { kind: "policy", type: "撤销", severity: "crit", source: "svc-iam", subject: "ag-risk",
      msg: "委托凭据 ag-risk#erp-delegated 已撤销，在途任务暂停新调用", refs: [] },
    { kind: "policy", type: "限流", severity: "warn", source: "gw-mcp", subject: "T26-0677",
      msg: "工具步骤重试达上限，触发熔断进入待确认状态（防重复写入）", refs: ["tl-erp"] },
    { kind: "policy", type: "配额", severity: "warn", source: "gw-model", subject: "dev-tools",
      msg: "租户 dev-tools Token 消耗接近配额（88%），已提示负责人", refs: [] },
    { kind: "policy", type: "核对", severity: "info", source: "gw-mcp", subject: "T26-0677",
      msg: "ERP 写入结果未知任务已入人工核对队列，幂等能力缺失已登记工具目录", refs: ["tl-erp"] },
    { kind: "policy", type: "准入", severity: "info", source: "sb-e2b", subject: "T26-0741",
      msg: "因沙箱并发配额进入排队，预估等待 8 分钟", refs: [] },
  ];

  return { servers, racks, netDevices, netLinks, infra, models, tools, agents, tasks, sandboxes, routes, tenants, events };
}
