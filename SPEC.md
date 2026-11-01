# AXON 统一对象与 API 规范

**Unified Object & API Specification**

| 项 | 值 |
|---|---|
| 版本 | v0.95-DRAFT（P0 出口文档草案） |
| 日期 | 2026-11-01 |
| 状态 | 待评审 |
| 上游输入 | 《面向 Agent 与 Agent 工作负载的系统管理软件需求调研报告》（下称"报告"）；AXON Demo（`E:\Agent Infra Pilot`，v0.95.0-MVP） |
| 对标项目 | opensandbox-group/OpenSandbox · kubernetes-sigs/agent-sandbox · agentgateway/agentgateway · kagent-dev/kagent · e2b-dev/runtime · builderz-labs/mission-control（控制平面交付形态参照） |
| 关键词约定 | **必须**（MUST）/ **应**（SHOULD）/ **可以**（MAY），参照 RFC 2119 |

---

## 0. 文档定位与范围

本规范定义 AXON 控制平面的**统一对象模型、能力声明接口、状态机、关系模型、事件与操作凭据格式、API 资源面**，用于：

1. 固化 Demo 已验证的管理语义，使其成为可开发、可测试的产品定义（报告 §13 产出物"统一对象及 API 说明"）；
2. 为 P0 适配层提供对接契约：外部系统（OpenSandbox、agent-sandbox CRD、agentgateway、kagent、InManage 类服务器管理底座）按本规范映射接入；
3. 约束界面行为：**界面不得开放任何超出对象能力声明的操作**（原则见 §4）。

不在本版范围：多集群联邦、计费结算口径、前端视觉规范、具体数据库 Schema。

---

## 1. 标识体系

### 1.1 对象 ID

所有对象 ID **必须**全局唯一，**必须**采用「类型前缀-语义名-序号」格式：

| 前缀 | 对象 | 示例 | 备注 |
|---|---|---|---|
| `srv-` | 物理服务器 | `srv-gpu-01` | |
| `sw-` | 网络设备 | `sw-core-01` | core / tor / bmc |
| `R` | 机柜 | `R04` | 未纳管机柜允许仅存在于平面/3D 视图 |
| `rt-` | 运行时服务 | `rt-langgraph` | |
| `sb-` | 沙箱集群 | `sb-e2b` | 集群级 |
| `sbx-` | 沙箱实例 | `sbx-8821` | 实例级（§2.9） |
| `gw-` | 网关 | `gw-model` / `gw-mcp` | |
| `st-` | 状态服务 | `st-ckpt` / `st-mem` | |
| `svc-` | 身份等其他平台服务 | `svc-iam` | |
| `ep-` | 模型端点 | `ep-glm` | |
| `tl-` | 工具（MCP） | `tl-ticket` | |
| `ag-` | Agent | `ag-cs` | |
| `T` | 任务 | `T26-0731` | `T{yyww}-{序号}` |
| `cp-` | 检查点 | `cp-9f21` | |

外部纳管对象（已存在于其它系统的资产）**必须**携带 `externalId` + `sourceSystem`，平台 ID 与外部 ID 的映射**不得**双向覆盖（§9.4 错误码 `409 SOURCE_CONFLICT`）。

### 1.2 操作凭据编号

| 前缀 | 含义 | 生命周期 | 示例 |
|---|---|---|---|
| `OP-` | 单次管理操作 | 即时 | `OP-4821` |
| `MW-` | 维护编排单 | 多步骤，含审批 | `MW-2211` |
| `RET-` | 退役编排单 | 多步骤 | `RET-2211` |
| `AUDIT-` | 审计归档包 | 终态归档 | `AUDIT-2211` |
| `CP-` | 审批单 | 与 `waiting_approval` 任务关联 | （Demo 未显式编号，**应**补齐） |

---

## 2. 对象模型（Schema）

### 2.0 分层分类法

| 层 | 名称 | 对象 | 层色（UI 约定） |
|---|---|---|---|
| L0 | 服务器与系统 | Server, Rack, NetDevice, NetLink | `#6f9bff` 钢蓝 |
| L1 | Agent Infra | InfraService（runtime/sandbox/gateway/state/identity） | `#37e2ff` 青 |
| L2 | 模型与工具目录 | ModelEndpoint, Tool | `#ff9350` 橙 |
| L3 | Agent | Agent | `#b18cff` 紫 |
| L4 | 任务与会话 | Task（, SandboxInstance 挂靠 L1 但由 L4 驱动） | `#3ddba4` 绿 |

### 2.1 Server（服务器）

```json
{
  "id": "srv-cpu-01", "name": "通用服务节点 · 01", "asset": "AST-10243",
  "model": "NF5280M6", "role": "网关/平台服务",
  "state": "warn",                  // ok | warn | crit | maint | offline
  "bmc": "10.32.0.13", "bios": "4.8.1", "bmcFw": "3.3.2",
  "location": { "room": "A2 机房", "row": "03 列", "rack": "R05", "u": [33, 34] },
  "sensors": { "cpu": 38, "mem": 55, "gpu": 0, "powerKw": 0.7, "tempC": 41, "fanPct": 35 },
  "parts":  [ { "kind": "CPU", "desc": "2× Xeon Gold 6430", "state": "ok" } ],
  "slots":  [ { "no": 5, "type": "3.84T NVMe", "state": "warn", "note": "SMART 预警" } ],
  "nics":   [ { "port": "port-1", "speed": "25G", "to": "sw-tor-svc:17", "vlan": "VLAN 120" } ]
}
```

约束：`state=maint` **必须**由维护编排（§8.3）进入与退出；`slots[].state=warn` **应**联动对象 `warnNote` 与告警条目。

### 2.2 Rack / NetDevice / NetLink

- **Rack**：`{ id, room, row, note, managed }`；`managed=false` 的机柜**必须**在 UI 置灰并禁用下钻。
- **NetDevice**：`{ id, kind: core|tor|bmc, model, mgmt, role, location }`。
- **NetLink**：`{ from, to, speed, type: 业务|上行|带外, vlan, util% }`；`util` **必须**来自周期采样（模拟环境中由 tick 引擎提供）。

### 2.3 InfraService（Infra 服务）

```json
{
  "id": "sb-e2b", "kind": "sandbox", "name": "E2B 沙箱集群", "ver": "1.5.2",
  "host": "srv-gpu-02", "state": "ok",
  "template": "ubuntu-24-nocode-c4",
  "warm": 14, "bound": 9, "paused": 2
}
```

`kind` 枚举：`runtime | sandbox | gateway | state | identity`。**必须**提供 `health()` 语义（ok/degraded/down），UI 据此渲染分层健康度。

### 2.4 ModelEndpoint / Tool

- **ModelEndpoint**：`{ id, vendor, ctx, state: ok|standby|drained, trafficPct, p95, tps }`。`trafficPct` 之和**必须**为 100（路由不变量）。
- **Tool**：`{ id, ver, effect: readonly|external-write|sandboxed, idem: bool, contract: ok|warn, consumers[] }`。
  - **必须**登记幂等能力；`idem=false` 的工具所参与的超时调用**必须**进入「结果待核对」流程（§5.4），**禁止**自动重放。

### 2.5 Agent

```json
{
  "id": "ag-cs", "name": "智能客服 Agent", "ver": "v2.4.1",
  "owner": "客服业务部 · 李文", "tenant": "customer-svc",
  "state": "running",                  // running | gray | retired
  "instances": 4,
  "deps": { "runtime": "rt-langgraph", "models": ["ep-glm"],
            "tools": ["tl-ticket", "tl-kb"], "stores": ["st-mem"] },
  "caps": { "observe": 1, "traffic": 1, "instance": 1, "state": 0, "task": 1 }
}
```

`caps` 为**能力声明**（§4），是界面与 API 开放操作的**唯一依据**。

### 2.6 Task（任务）

```json
{
  "id": "T26-0731", "name": "供应商准入风控审核", "agent": "ag-risk",
  "state": "waiting_approval", "progress": 62,
  "interruptible": false,
  "tokensM": 1.2, "costCny": 86,
  "ckpt": { "id": "cp-9f21", "mode": "app-checkpoint", "ts": "10:12", "compatible": true },
  "waitReason": "等待安全风控审批（外部 ERP 写入授权）"
}
```

### 2.7 Tenant 与 Quota

`Quota` 为三维上限 + 双阈值行为：

| 维度 | 字段 | ≥70% | ≥85% |
|---|---|---|---|
| Token 预算 | `tokenBudget/tokenUsed` | 黄色提示 | **必须**告警 + 通知负责人 |
| 沙箱并发 | `sandboxQuota/sandboxUsed` | 黄色提示 | **必须**限制新分配（排队） |
| 单任务步骤 | `stepLimit`（重试上限 5） | — | 触发熔断事件 |

### 2.8 Checkpoint（检查点）

`mode` 枚举与语义（对齐报告 §5.4 E2B 分级）：

| mode | 保存范围 | 恢复语义 |
|---|---|---|
| `app-checkpoint` | 应用执行状态 | 续跑；授权**必须**重检 |
| `file-snapshot` | 文件系统 | 重建环境后挂载 |
| `full-snapshot` | 含内存的完整快照 | 恢复后网络连接**必须**重建 |

`compatible=true` 表示与当前运行时版本兼容；`false` 时恢复入口**必须**禁用并提示版本约束。

### 2.9 SandboxInstance（沙箱实例）★ 本版新增

Demo 目前仅到集群级计数；规范定义实例粒度（对齐 OpenSandbox Console / agent-sandbox CRD）：

```json
{
  "id": "sbx-8821", "cluster": "sb-e2b", "template": "ubuntu-24-nocode-c4",
  "state": "BOUND",                     // WARM | BOUND | PAUSED | GC-PENDING
  "ownerTask": "T26-0688", "tenant": "dev-tools",
  "lease": { "issuedAt": "...", "ttlMin": 45, "renewable": true },
  "resources": { "vcpu": 4, "memG": 8, "gpu": 0 },
  "netPolicy": { "egress": "allowlist", "cidrs": ["10.32.0.0/16"] }
}
```

不变量：`ownerTask` 终态后实例进入 `GC-PENDING`；**共享资源与待审批任务关联实例禁止回收**（报告 S05）。

---

## 3. 关系模型

### 3.1 边类型

| 边 | 方向 | 语义 | 示例 |
|---|---|---|---|
| `host` | InfraService → Server | 承载 | `gw-model → srv-cpu-01` |
| `mount` | Endpoint/Tool → Gateway | 挂载 | `ep-glm → gw-model` |
| `dep` | Agent → Infra/Endpoint/Tool/State | 依赖（多对多） | `ag-cs → ep-glm` |
| `own` | Task → Agent | 归属执行 | `T26-0731 → ag-risk` |
| `link` | Server/Switch ↔ NetDevice | 物理网络 | `srv-gpu-01 ↔ sw-tor-gpu` |

### 3.2 关系属性

每条边**必须**携带：`source: declared | inferred`（显式声明 / 遥测推断）、`updatedAt`、`expiresAt`（推断关系**应**设有效期）。**推断关系在 UI 中必须与声明关系区别标注**（报告 §3.1）。

### 3.3 影响分析

定义「影响面」= 沿依赖边（task→agent→infra→server 方向）的反向可达集合。API **必须**返回分层统计：受影响 Infra 数、Agent 数、在途任务数、**不可中断任务数**（`interruptible=false`）。该结果用于维护编排前置检查（§8.3）与拓扑影响分析模式。

---

## 4. 能力声明接口（Adapter Capability）——本规范的核心约束

### 4.1 能力定义（报告 §7.1）

| 能力键 | 名称 | 开放的操作（映射表） |
|---|---|---|
| `observe` | 发现与观测 | 列实例、查健康、读指标/追踪 |
| `traffic` | 流量与准入 | 限制新会话、阻断入口、限流、切换端点 |
| `instance` | 实例控制 | 创建、停止、重启、扩缩容、排空 |
| `state` | 状态控制 | 检查点保存/恢复、快照、暂停续跑 |
| `task` | 任务控制 | 取消、暂停、继续、查询外部结果 |

### 4.2 强制规则

1. 界面与 API 网关**必须**以 `caps` 为准入条件：未声明能力 → 操作入口置灰 + 返回 `451 CAPABILITY_NOT_DECLARED`；
2. 「注册接入、网络可达、遥测可用」**不得**被解释为具备任何控制能力；
3. 缺失能力**必须**展示「未支持 / 需人工处理」，**禁止**静默降级为自动成功。

### 4.3 操作返回值（统一信封）

```json
{
  "opId": "OP-4821",
  "status": "accepted | executed | verified | failed | unknown",
  "evidence": [ { "type": "bmc-log", "ref": "..." } ],
  "limits": [ "旧执行者隔离中", "外部写操作不可撤销" ]
}
```

三段式状态对应报告 §7.2：`accepted`（请求已受理）→ `executed`（资源操作完成）→ `verified`（业务验证通过）。**禁止**以 `executed` 冒充 `verified`（“容器已启动”≠“业务已恢复”）。

---

## 5. 任务状态机

### 5.1 状态枚举

`queued → running → succeeded | failed | cancelled`，以及四个扩展态：`waiting_approval`、`checkpointed`、`recovering`、`unknown`（结果待核对）。

### 5.2 合法迁移表（Demo 已实现部分加 ✦）

| 迁移 | 触发 | 前置条件 | 副作用 |
|---|---|---|---|
| waiting_approval → running ✦ | 审批通过 | 授权重检通过 | 事件流 + 通知负责人 |
| running → checkpointed ✦ | 暂存 / 维护排空 | `caps.state=1` 或运行时原生支持 | 释放计算资源 |
| checkpointed → recovering ✦ | 恢复 | `ckpt.compatible=true` | 重建环境、网络重连 |
| recovering → running ✦ | 恢复完成 | 上下文完整性校验 | 记录恢复点损失 |
| running → unknown | 工具超时且 `idem=false` | — | **禁止**重放，入人工核对队列 |
| unknown → succeeded ✦ | 人工核对确认 | 查询接口/幂等键证据 | 审计归档 |
| any → cancelled ✦ | 人工取消 | 不可逆外部操作提示（**必须**二次确认） | 产物按保留策略归档 |

### 5.3 不可中断任务

`interruptible=false` 的任务**必须**阻塞维护自动推进（§8.3 Step 3），解除路径仅两条：检查点暂存（`caps.state=1`）或管理员授权强推（产生 `AUDIT` 前置记录）。

### 5.4 结果未知语义（S12）

超时 + 无幂等键 → `unknown`；平台**必须**提供核对队列与「查询/人工确认」两个出口，**不得**自动重试。

---

## 6. 声明式对象与 CRD 映射（期望状态）

为对齐 kubernetes-sigs/agent-sandbox 与 K8s 生态，定义三个声明式对象。期望状态由控制面持有，实际状态由执行面回报，**两者不一致时 UI 必须双列展示差异**（禁止只显示其一）。

### 6.1 Sandbox（沙箱）

```yaml
apiVersion: axon.infra/v1
kind: Sandbox
metadata: { name: sbx-8821 }
spec:
  cluster: sb-e2b
  template: ubuntu-24-nocode-c4
  resources: { vcpu: 4, memG: 8 }
  netPolicy: { egress: allowlist, cidrs: ["10.32.0.0/16"] }
  lease: { ttlMin: 45, renewable: true }
  desiredState: BOUND          # WARM | BOUND | PAUSED | TERMINATED
status:
  currentState: BOUND
  conditions:
    - { type: Ready, status: "True", reason: NodeAllocated }
    - { type: LeaseValid, status: "True" }
```

### 6.2 AgentDeployment（Agent 部署）

```yaml
apiVersion: axon.infra/v1
kind: AgentDeployment
metadata: { name: ag-cs }
spec:
  version: v2.4.1
  instances: 4
  canary: { enabled: false, trafficPct: 0 }   # 灰度发布
  deps:
    runtime: rt-langgraph
    models: [ep-glm]
    tools: [tl-ticket, tl-kb]
    stores: [st-mem]
  rollback: { retention: 24h }                # 上一版回退保留
status:
  currentVersion: v2.4.1
  readyInstances: 4
  capsObserved: { observe: true, state: false }   # 实测能力，与声明 caps 对账
```

### 6.3 TaskRun（任务执行）

```yaml
apiVersion: axon.infra/v1
kind: TaskRun
metadata: { name: T26-0731 }
spec:
  agent: ag-risk
  interruptible: false
  checkpoint: { mode: app-checkpoint, intervalMin: 10 }
  budget: { maxTokensM: 5, maxSteps: 50 }
status:
  state: waiting_approval
  progressPct: 62
  lastCheckpoint: cp-9f21
  waitingFor: { kind: approval, owner: "安全风控 · 周麟" }
```

### 6.4 调谐语义

控制面**必须**周期对账 `desiredState` vs `currentState`；差异项产生 `RECONCILE_DIFF` 事件（§7.2）。断连场景遵循报告 S20：执行面按最近有效策略运行，恢复后先对账再放行新操作。

---

## 7. 流量与策略模型

### 7.1 路由规则（对齐 agentgateway）

```json
{ "id": "route-glm-primary", "match": { "model": "glm-4.7", "tenant": "*" },
  "action": { "forward": "ep-glm", "weight": 86 },
  "fallback": { "to": "ep-ds", "on": ["circuit-open:5"], "validateCaps": ["ctx", "tool-call"] } }
```

不变量：同 `match` 的 weight 之和 = 100；fallback 切换**必须**先做能力标签校验与授权边界检查；回切**必须**灰度。

### 7.2 策略事件类型枚举

`阻断`（执行边界拦截）、`撤销`（凭据/授权）、`限流`（步骤/重试熔断）、`配额`（租户阈值）、`核对`（结果未知人工处理）、`准入`（排队/限制）、`RECONCILE_DIFF`（期望-实际差异）。

### 7.3 维护准入四开关

进入维护的节点**必须**依次生效：①入口限新会话 ②工具网关限新任务 ③沙箱调度排除该节点 ④队列按租户优先级保护。退出时逆序放开并发布验证事件。

---

## 8. 事件、审计与操作流程

### 8.1 事件信封

```json
{ "ts": "10:31", "type": "阻断", "severity": "crit",
  "source": "gw-mcp", "subject": "T26-0688",
  "msg": "...", "refs": ["sbx-8821", "tl-web"] }
```

### 8.2 事件保留

高频遥测事件**应**采样入观测后端；策略事件与操作事件**必须**入平台事件流并支持按 `subject` 追溯（保留策略由租户配置，默认 90 天）。

### 8.3 公共操作流程（报告 §7.2，七段）

**触发与责任确认 → 影响分析 → 前置条件与策略检查 → 按授权执行 → 采集结果 → 验证服务与任务 → 归档证据 / 失败分支。**

以维护编排（MW）为例的步骤映射（Demo 已实现 ✦）：对象确认✦ → 影响分析✦ → 前置检查（不可中断阻塞✦、强推授权✦）→ 准入限制✦ → 任务排空✦ → 执行维护✦ → 验证恢复✦ + 审计归档✦。

**场景族（v0.95 演示范围）**：七段式流程统一驱动五类编排单——MW 服务器维护（S06，网关漂移）、路由切换演练（FR-08，能力标签校验 + 合规专路 + 权重恒等 100 + 灰度回切）、RET Agent 退役（caps 门控 + 凭据撤销传播）、MW 沙箱集群维护（S05 受保护实例 + 快照迁移 + 对账）、MW 知识库滚动升级（副本下限 + 只读降级 + 写入队列回放）。各场景的前置检查均含至少一个**阻塞门**（不满足则阻止自动推进，仅可妥善处置或强推授权）。

---

## 9. API 概要

### 9.1 资源面

| 资源 | 方法 | 说明 |
|---|---|---|
| `/api/v1/servers` `/racks` `/netdevices` `/netlinks` | GET | 资产与网络 |
| `/api/v1/infra` `/models` `/tools` | GET/PATCH | Infra 目录；PATCH 用于登记契约/版本 |
| `/api/v1/agents` | GET/POST(retire) | `POST /agents/{id}:retire` 产生 RET 单 |
| `/api/v1/tasks` | GET/PATCH | `PATCH /tasks/{id}` 仅允许状态机合法迁移 |
| `/api/v1/sandboxes` | GET/POST/PATCH | 实例级生命周期；`POST /sandboxes/{id}:checkpoint` |
| `/api/v1/impact/{objectId}` | GET | 影响分析（§3.3），返回分层统计 |
| `/api/v1/routes` `/quotas` `/policy-events` | GET/PATCH | 治理面 |
| `/api/v1/ops` `/ops/{opId}` | POST/GET | 异步操作：POST 返回 `accepted`，轮询 `opId` 直至终态 |

### 9.2 幂等

所有 POST 操作**必须**接受 `Idempotency-Key`；重复提交返回首次结果。

### 9.3 权限模型

角色（报告 §3.3）：基础设施管理员 / AI 平台管理员 / Agent 应用负责人 / 安全管理员 / 业务负责人。操作 × 角色 × 对象租户三维鉴权；高影响操作（强推维护、取消不可逆副作用任务、上下电）**必须**二次确认 + 审计。

### 9.4 错误码

| 码 | 含义 |
|---|---|
| `409 SOURCE_CONFLICT` | 与外部系统配置来源冲突（双控制器写同一对象）；亦用于幂等键请求体冲突 |
| `451 CAPABILITY_NOT_DECLARED` | 对象未声明该能力 |
| `409 STATE_TRANSITION_INVALID` | 非法状态迁移 |
| `412 PRECONDITION_FAILED` | 前置检查未过（如不可中断任务未处置、强推未二次确认） |
| `429 QUOTA_EXCEEDED` | 配额限制生效中 |

### 9.5 交付面（v0.95 已实现）

| 交付面 | 入口 | 说明 |
|---|---|---|
| REST | `node server/index.mjs` → `/api/v1/*` | 本规范 §9.1 全量资源面 + `Idempotency-Key` + §9.4 错误信封 |
| OpenAPI | `GET /api/v1/openapi.json`、`/api/v1/docs` | OpenAPI 3.1 描述与内联文档页 |
| SSE | `GET /api/v1/events/stream` | `event: policy / task / op`；EventSource 可用 `?key=` 携带凭据 |
| CLI | `node cli.mjs <command>` | setup / keys / tasks / create-task / approve / impact / ops / events / maintenance |
| MCP Server | `node mcp/server.mjs`（stdio JSON-RPC） | 8 工具：状态 / **影响分析** / 能力查询 / 队列 / 认领 / 回报 / 审批 / 策略事件 |
| Worker 接入 | `node worker/worker.mjs` | pull 模型参照 mission-control：register（caps）→ heartbeat → queue → claim → 汇报 → 终态 |
| UI | 侧栏「接入面 · Live」 | 真实数据视图：状态机操作、opId 三段式、SSE 事件流；错误码原样透出。服务端不可达时（如静态托管）自动降级为**内置模拟控制平面**（前端复刻同一状态机/门控/三段式语义，仅用于线上演示，UI 以 SIM 徽标显式标注） |

机器角色 `agent`（§9.3 之外新增）：仅允许心跳、认领、进度/终态回报、自注册——**任务创建仍归属平台/负责人角色**（与 mission-control 的任意 Key 建任务不同，AXON 保持治理边界）。

### 9.6 不变量的可执行验证

§4/§5/§7/§8 的硬约束以 `node --test tests/invariants.test.mjs` 固化（19 项）：451 能力门控且任务状态不被静默变更、非法迁移 409、不可中断任务取消与维护前置 412（含强推审计）、配额双阈值 429 + 策略事件、路由权重和恒等 100、幂等重放与冲突、影响分析分层统计、S05 GC 保护、对账收敛与 RECONCILE_DIFF 事件、opId 三段式全部推进到 verified。

---

## 10. 与开源项目对齐映射

| 本规范概念 | OpenSandbox | agent-sandbox (k8s-sigs) | agentgateway | kagent |
|---|---|---|---|---|
| SandboxInstance（§2.9） | Lifecycle API 实例 | `Sandbox` CRD | — | — |
| 沙箱模板 / 预热池 | Template | `SandboxTemplate` + WarmPool | — | — |
| 检查点三级语义（§2.8） | snapshot/pause | pause/resume | — | — |
| 路由规则（§7.1） | — | — | Route/Fallback | — |
| 能力声明（§4） | Console 租户流程 | RBAC（无 per-agent gating） | 策略 | Agent CRD |
| AgentDeployment（§6.2） | — | — | — | Agent CRD + 观测 |
| 影响分析（§3.3） | — | — | — | — （各项目均缺失，AXON 差异化点） |

---

## 11. 附录 A：Demo 覆盖度对照（v0.9.1 更新）

| 规范条目 | Demo 状态 |
|---|---|
| §1 标识体系 / §2.1-2.8 对象 | ✅ 已实现（`assets/data.js`） |
| §2.9 SandboxInstance 实例粒度 | ✅ 已实现（资产目录 · 沙箱实例子页：状态双列、租约倒计时、GC 受保护、CRD YAML 查看器；对标 OpenSandbox） |
| §3.1 关系 source=declared/inferred 区分 | ✅ 已实现（拓扑图推断边虚线 + 图例；数据层 `inferred` 标记） |
| §4 能力声明 gating | ✅ 已实现（Agent 卡片 + 抽屉置灰） |
| §4.3 三段式操作状态 | ✅ 已实现（操作中心：opId + 已受理→已执行→已验证 阶段推进，治理页操作记录面板） |
| §5 任务状态机 | ✅ 已实现（含全部扩展态迁移） |
| §6 声明式对象 / 期望-实际双列 | ⚙️ 部分（沙箱实例双列 + 对账收敛 + Sandbox/AgentDeployment YAML 查看器；TaskRun 与全局对账视图待补） |
| §7.1 路由规则可见 | ✅ 已实现（治理页规则表：匹配/权重编辑/Fallback/优先级，权重不变量；对标 agentgateway） |
| §7.3 维护准入四开关 | ✅ 已实现（维护向导 Step 3） |
| §8.3 七段操作流程 | ✅ 已实现（维护向导七步） |
| Agent 部署深度（§6.2 扩展） | ✅ 已实现（实例清单、期望/就绪、灰度流量控制 0/10/50/100、版本回退；对标 kagent） |
| §9 API 服务层 | ✅ 已实现（v0.95：REST 全量 + OpenAPI 3.1 + SSE + CLI + MCP + Worker 接入闭环；`server/` 零 npm 依赖，node:sqlite WAL；不变量测试 19/19 通过，见 §9.5/§9.6） |

## 12. 版本与演进

- v0.9：语义冻结；
- v0.95（本文）：§9 API 服务层落地（REST/OpenAPI/SSE/CLI/MCP/Worker + 六角色鉴权 + 幂等 + opId 三段式）+ 不变量测试固化 + UI「接入面 · Live」真实数据视图；对账语义细化：`desiredState=TERMINATED` 的收敛只能走 GC 路径（S05 保护检查），对账操作不得越过；
- v1.0（目标）：权限矩阵细则（租户级隔离）+ TaskRun 期望/实际双列 + 全局对账视图；
- v1.x：多集群、对账（S20）演练接口、成本归集口径（报告 FR-15）、Webhook 告警与定时任务模板、Docker 交付与安全加固文档。
