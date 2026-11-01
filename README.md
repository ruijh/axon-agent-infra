# AXON · Agent Infra 控制中心

**在线访问（演示 UI）：** <https://ruijh.github.io/axon-agent-infra/>（GitHub Pages 部署，数据为内置模拟）

基于《面向 Agent 与 Agent 工作负载的系统管理软件需求调研报告》开发的**任务控制室风格**全栈管理平台。v0.95 起包含两部分：

- **演示 UI（纯静态）**：零依赖、纯前端单页应用，双击 `index.html` 即可运行。前七个视图（服务器/总览/拓扑/资产/任务/维护/治理）为内置模拟数据；
- **控制平面（真实服务）**：`node server/index.mjs` 一条命令启动，提供 **REST API + SSE + OpenAPI 文档 + CLI + MCP Server + Worker 接入闭环**（对标 builderz-labs/mission-control 的多接口交付形态，管理语义按 AXON 自有 SPEC 执行）。UI 第八个视图「接入面 · Live」连接该真实控制平面。

> **数据声明：前七个视图为纯前端原型**，所有服务器、Agent、任务、指标、事件均为内置模拟数据（`assets/data.js` 中的静态世界模型 + 2 秒节拍的模拟引擎生成），非真实采集，页面不发起任何对外网络请求。「接入面 · Live」视图的数据来自本机控制平面（`server/`，SQLite 存储），为真实 API 数据。

> **产品定义：管理语义与接口契约见 [SPEC.md](SPEC.md)《AXON 统一对象与 API 规范》v0.95**——统一对象模型、能力声明接口、任务状态机、声明式对象（Sandbox/AgentDeployment/TaskRun CRD 映射）、路由与策略模型、API 资源面，并附 Demo 覆盖度对照与开源项目对齐映射（OpenSandbox / agent-sandbox / agentgateway / kagent / mission-control）。

## 运行方式

**方式一（控制平面 + 完整 UI，推荐）：**
```bash
cd "E:\Agent Infra Pilot"
node server/index.mjs            # 零 npm 依赖，同时提供 UI 与 /api/v1，默认 8437 端口
# 浏览器访问 http://127.0.0.1:8437/  → 侧栏「接入面 · Live」

node cli.mjs setup               # 首次初始化：创建根密钥（token 仅显示一次）
node cli.mjs keys create worker agent          # 为 Worker 创建 agent 角色密钥
AXON_API_KEY=<agent密钥> node worker/worker.mjs   # 启动接入演示 Agent（心跳/认领/审批门/终态）
```
在 Live 视图填入 root 密钥后即可：创建任务 → 观察 Worker 认领 → 审批续跑 → 三段式操作记录 → SSE 实时事件。

**方式二（纯静态演示，不带控制平面）：** 直接双击 `index.html`，或
```bash
python _serve.py        # 或 python -m http.server 8437
```

**测试（SPEC 硬约束的可执行验证）：**
```bash
node --test tests/invariants.test.mjs    # 19 项：451 能力门控 / 409 状态机 / 412 维护前置 / 429 配额 / 幂等 / 权重恒等 100 / GC 保护…
```

## 控制平面架构（v0.95 新增，参考 mission-control 落地）

```
server/index.mjs      入口：静态 UI + /api/v1 + SSE 同进程；--reset 重置数据，--port 自定义
server/api.mjs        REST 资源面（SPEC §9.1）：路由表 + 鉴权 + 幂等 + 错误信封（409/412/429/451）
server/store.mjs      存储：node:sqlite（WAL）零依赖；JSON 列模式，无需建表迁移
server/auth.mjs       API Key + 六角色权限矩阵（SPEC §9.3 + 机器角色 agent）；/setup 首管理员
server/statemachine.mjs 任务状态机（§5）：合法迁移表 + 审批重检 / 检查点兼容 / 强推二次确认
server/ops.mjs        opId 三段式执行器（§4.3）：accepted → executed → verified；维护/路由/沙箱对账/GC
server/impact.mjs     影响分析（§3.3）：反向可达 + 分层统计（含不可中断任务数）
server/model.mjs      世界模型种子（与演示 UI 数据同源）
server/openapi.mjs    OpenAPI 3.1（/api/v1/openapi.json）+ 内联文档页（/api/v1/docs）
server/sse.mjs        SSE 事件流（event: policy / task / op）
cli.mjs               命令行：setup / keys / tasks / create-task / approve / impact / ops / events / maintenance
worker/worker.mjs     Agent 接入闭环（pull 模型）：注册 caps → 心跳 → 认领 → 汇报 → 审批门 → 终态
mcp/server.mjs        MCP Server（stdio）：8 工具，含 axon_impact_analysis（Agent 行动前查影响面）
tests/                规范不变量测试（node:test）
assets/live.js        UI「接入面 · Live」视图（真实数据 + SSE + 状态机操作）
```

与 mission-control 的关键差异：接入模型同为 pull（register/queue/claim/heartbeat），但 AXON 的每次操作受**能力声明（caps）+ 角色权限 + 状态机**三重门控，且提供其不具备的**影响分析**接口（MCP 工具 `axon_impact_analysis`，供 Agent 在高危动作前自查辐射面）。安全提示：与 mission-control alpha 相同口径——本控制平面面向可信内网，公网暴露需自加 TLS 反代。

## 功能地图（对应需求报告）

**管理视角：以服务器管理为主视角管理 Agent**（对应报告 §4「InManage 参考基线与演进方向」——复用服务器资产、监控与维护能力，向上延伸到 Agent 与任务）。

| 视图 | 演示内容 | 对应需求 |
| --- | --- | --- |
| **服务器管理**（首屏默认） | 五个子页：<br>① **设备清单** — 资产（编号/BMC/固件/机柜 U 位）、实时负载与传感器、健康灯与部件级告警、Agent 承载摘要；点击下钻：硬件部件 → 磁盘槽位 → 机柜位置 → 网络接入 → Agent 承载链路（Infra → Agent → 任务）<br>② **平面布局** — A2 机房 SVG 俯视图：冷/热通道、精密空调、入口、14 柜排布（纳管 3 柜高亮、未纳管置灰），点击机柜右侧下钻 U 位立柱<br>③ **3D 机房** — Canvas 等轴投影建模：房间地面网格、14 机柜立体建模（正面呈现服务器/交换机 U 位色块）、预警机柜琥珀脉冲；拖拽旋转 / 滚轮缩放 / 点击机柜查看承载详情<br>④ **机柜部署** — 三柜 U 位立柱（42U 刻度、双路 PDU、U 位统计）<br>⑤ **网络拓扑** — 核心/接入/带外三层 + **机柜分组区**（R01/R04/R05 虚线聚合），链路带宽与 VLAN、实时利用率粒子流、端口映射表 | FR-01 / FR-02、§4.2 复用与扩展 |
| **总览** | 四层对象 KPI（服务器优先 + 纳管完整率、单位任务成本、任务成功率）、任务吞吐/Token 消耗/端点延迟图表、分层健康度、实时事件流 | §9.1 核心指标口径 |
| **拓扑依赖** | Canvas 绘制的跨层依赖图（服务器 → Infra → 模型/工具 → Agent → 任务），粒子沿调用方向流动；节点可点击查看详情、可拖拽；**影响分析模式**点击任意节点反推故障辐射面，区分可中断任务 | FR-01 / FR-02、S06 |
| **资产目录** | 四个子页：<br>① **Agent**（负责人/版本/依赖/**适配器能力声明 5 项**，未支持即置灰；**部署状态对标 kagent**：实例清单、期望/就绪、灰度流量控制 0/10/50/100%、版本回退、AgentDeployment YAML）<br>② **Infra 服务**（运行时/沙箱/网关/状态/身份）<br>③ **沙箱实例**（**对标 OpenSandbox**：期望/实际状态双列、漂移标记与对账收敛、租约倒计时、GC 受保护语义、Sandbox CRD YAML 查看器）<br>④ **工具目录**（副作用/幂等/契约） | FR-01/FR-04、§7.1 适配器能力模型 |
| **任务中心** | 任务状态机（运行/排队/等待审批/已暂存/恢复中/结果待核对），详情抽屉含执行轨迹、检查点（模式/兼容性）、**批准续跑 / 检查点暂存 / 恢复 / 取消**等可操作语义 | FR-04 / FR-09、S04 / S12 |
| **维护编排** | S06 全流程向导：影响分析 → 前置检查（**不可中断任务阻塞自动推进，可暂存解除或授权强推**）→ 准入限制 → 任务排空 → 执行维护（终端日志）→ 验证恢复；完成后**自动更换槽位、关闭告警**，服务器视图同步刷新 | FR-05、S06、T03 |
| **治理配额** | 租户 Token / 沙箱并发 / 步骤上限配额条；**模型路由规则表（对标 agentgateway）**：匹配条件、流量分担权重编辑（恒等于 100 不变量）、Fallback 策略与优先级，合规专路不切换；**操作记录（opId 三段式：已受理→已执行→已验证）**；策略事件流（越权阻断/凭据撤销/熔断/结果核对）；工具契约 | FR-06 / FR-08 / FR-10、S13 / S14 / S16 |
| **接入面 · Live**（双形态） | 连接 `server/` 真实控制平面：Agent 实况（注册/心跳/能力声明五项徽标）、发起任务（平台创建 → Worker 认领）、任务实况（**批准续跑 / 检查点暂存 / 恢复 / 取消**，受 caps + 状态机双重门控，拒绝时透出 403/451/412 错误码）、opId 三段式操作记录、SSE 实时事件流；**服务端不可达时（如 GitHub Pages 在线访问）自动切换内置模拟控制平面**（`assets/livesim.js`：同一状态机/门控/三段式语义的前端复刻，含自动推进的模拟 Worker 闭环），线上演示效果完整 | §4 / §5 / §9 全量落地 |

## 建议 5 分钟演示动线

1. **服务器管理 · 设备清单** — 首屏即服务器资产；点开通用服务节点 · 01，看硬件部件、槽位 5 预警、机柜 U 位与网络接入，以及「Agent 工作负载承载」三层链路
2. **平面布局 / 3D 机房** — 俯视图看机房分区与 14 柜纳管状态；3D 视图拖拽旋转机房，点击 R05 看承载详情与预警脉冲
3. **机柜部署 / 网络拓扑** — U 位立柱与三层物理网络（机柜分组区、链路实时利用率）
4. **维护编排** — 从服务器抽屉点「进入维护编排」，完整走完 7 步（注意第 3 步的阻塞与解除），看槽位更换与告警自动关闭
5. **拓扑依赖** — 点「影响分析模式」后点击预警服务器，看红色辐射面与影响统计（服务器 → Agent Infra → 任务）
6. **任务中心 / 治理配额** — 审批 `T26-0731` 续跑、看 `T26-0677` 的 S12 结果待核语义；治理页看路由规则与权重编辑、操作记录三段式推进，做一次 Fallback 演练
7. **沙箱实例（资产目录）** — 看期望/实际双列与漂移，点「执行对账」看收敛；GC 扫描看受保护实例跳过；打开任一实例的 CRD YAML
8. **接入面 · Live** — 本地：`node server/index.mjs` + `node worker/worker.mjs` 后创建"需审批"任务，看认领与进度推送，60% 挂起后点「批准续跑」，对 ag-ops 的运行任务点「检查点暂存」看 **451 能力门控**；**线上（GitHub Pages）**：同一视图自动进入模拟形态，含自动认领/推进/审批门的模拟 Worker，交互语义与真实模式一致（徽标为琥珀色 SIM 以示区分）

## 技术说明

```
index.html          外壳：启动序列 / 顶栏 / 侧栏导航 / 八个视图骨架（服务器管理为默认首屏，含五个子页）
assets/style.css    视觉系统：深空靛蓝控制台、四层语义色、HUD 细节
assets/data.js      模拟世界模型：四层对象 + 机房平面/机柜/网络设备/链路 + 依赖边 + 影响分析 + 服务器承载查询
assets/core.js      核心引擎：路由 / 时钟 / 2s 模拟数据 tick（含传感器抖动）/ Toast / 模态 / 抽屉
assets/graph.js     拓扑图：Canvas 布局与绘制、粒子流、命中检测、拖拽、影响分析
assets/views.js     视图渲染：服务器（清单/平面/机柜）/ 总览 / 资产 / 任务 / 治理 + 手绘 Canvas 图表
assets/net.js       物理网络拓扑：三层网络 + 机柜分组区 + 流量粒子 + 端口映射表
assets/dc3d.js      数据中心 3D 等轴投影：机柜建模、拖拽旋转、缩放、点击选中
assets/flow.js      维护编排向导状态机（完成后联动服务器槽位与告警）
assets/livesim.js   内置模拟控制平面（线上演示形态）：Live 视图在服务端不可达时的前端复刻
assets/live.js      接入面 Live 视图：真实控制平面（REST + SSE）与模拟形态自动切换
```

- 前端纯 vanilla JS，无任何外部依赖（无 CDN、无字体请求），离线可用；控制平面同样零 npm 依赖（Node 22+ 内置 `node:sqlite` / `node:test`）
- 图表全部 Canvas 手绘（吞吐面积图 / 租户配额柱状 / 延迟折线），拓扑图支持悬停高亮上下游
- 尊重 `prefers-reduced-motion`；键盘 Esc 关闭抽屉/模态；窄屏自适应降级
- MCP 接入示例：`claude mcp add axon -e AXON_URL=http://127.0.0.1:8437 -e AXON_API_KEY=axk_xxx -- node mcp/server.mjs`
