/* ═══════════════════════════════════════════════════════════
   AXON · 世界模型（模拟数据）
   四层对象：服务器 → Infra 服务 → Agent → 任务
   ═══════════════════════════════════════════════════════════ */

const AXON_DATA = {

  servers: [
    { id: "srv-gpu-01", name: "GPU 推理节点 · 01", model: "NF5468M6 · 8×A100-80G", role: "推理",
      state: "ok", cpu: 46, mem: 61, gpu: 78, power: "3.1 kW", temp: 46, fan: 42, uptime: "112d", asset: "AST-10241",
      bmc: "10.32.0.11", bios: "5.2.4", bmcFw: "3.4.0",
      location: { room: "A2 机房", row: "03 列", rack: "R04", u: [20, 25] },
      nics: [
        { port: "port-1", speed: "100G", to: "sw-tor-gpu · 25", vlan: "VLAN 110" },
        { port: "port-2", speed: "100G", to: "sw-tor-gpu · 26", vlan: "VLAN 110" },
        { port: "bmc", speed: "1G", to: "sw-bmc · 9", vlan: "VLAN 9" }],
      parts: [["CPU", "2× Xeon Platinum 8568Y+", "ok"], ["内存", "16× 64G DDR5-5600", "ok"], ["GPU", "8× A100-80G SXM", "ok"], ["网卡", "2× 100G OCP 3.0", "ok"]],
      slots: [{ no: "M2-1", type: "960G M.2 · 系统", state: "ok" }, { no: "M2-2", type: "960G M.2 · 系统", state: "ok" }] },
    { id: "srv-gpu-02", name: "GPU 执行节点 · 02", model: "NF5468M6 · 8×A100-80G", role: "沙箱执行",
      state: "ok", cpu: 52, mem: 67, gpu: 71, power: "3.4 kW", temp: 49, fan: 51, uptime: "98d", asset: "AST-10242",
      bmc: "10.32.0.12", bios: "5.2.4", bmcFw: "3.4.0",
      location: { room: "A2 机房", row: "03 列", rack: "R04", u: [26, 31] },
      nics: [
        { port: "port-1", speed: "100G", to: "sw-tor-gpu · 27", vlan: "VLAN 110" },
        { port: "port-2", speed: "100G", to: "sw-tor-gpu · 28", vlan: "VLAN 110" },
        { port: "bmc", speed: "1G", to: "sw-bmc · 10", vlan: "VLAN 9" }],
      parts: [["CPU", "2× Xeon Platinum 8568Y+", "ok"], ["内存", "16× 64G DDR5-5600", "ok"], ["GPU", "8× A100-80G SXM", "ok"], ["网卡", "2× 100G OCP 3.0", "ok"]],
      slots: [{ no: "M2-1", type: "960G M.2 · 系统", state: "ok" }, { no: "M2-2", type: "960G M.2 · 系统", state: "ok" }] },
    { id: "srv-cpu-01", name: "通用服务节点 · 01", model: "NF5280M6 · 2×Xeon 8568Y+", role: "网关/平台服务",
      state: "warn", warnNote: "磁盘槽位 5 SMART 预警 · 建议更换",
      cpu: 38, mem: 55, gpu: 0, power: "0.7 kW", temp: 41, fan: 35, uptime: "203d", asset: "AST-10243",
      bmc: "10.32.0.13", bios: "4.8.1", bmcFw: "3.3.2",
      location: { room: "A2 机房", row: "03 列", rack: "R05", u: [33, 34] },
      nics: [
        { port: "port-1", speed: "25G", to: "sw-tor-svc · 17", vlan: "VLAN 120" },
        { port: "port-2", speed: "25G", to: "sw-tor-svc · 18", vlan: "VLAN 120" },
        { port: "bmc", speed: "1G", to: "sw-bmc · 11", vlan: "VLAN 9" }],
      parts: [["CPU", "2× Xeon Gold 6430", "ok"], ["内存", "8× 64G DDR5-4800", "ok"], ["RAID", "MR9460-8i · 2G 缓存", "ok"], ["网卡", "4× 25G OCP", "ok"]],
      slots: [
        { no: 1, type: "3.84T NVMe · 数据", state: "ok" }, { no: 2, type: "3.84T NVMe · 数据", state: "ok" },
        { no: 3, type: "3.84T NVMe · 数据", state: "ok" }, { no: 4, type: "3.84T NVMe · 数据", state: "ok" },
        { no: 5, type: "3.84T NVMe · 数据", state: "warn", note: "SMART 预警 · 待更换" },
        { no: 6, type: "3.84T NVMe · 数据", state: "ok" }, { no: 7, type: "3.84T NVMe · 数据", state: "ok" },
        { no: 8, type: "热备", state: "ok" }] },
    { id: "srv-sto-01", name: "状态存储节点 · 01", model: "NF5266M6 · 12×NVMe 8T", role: "检查点/记忆",
      state: "ok", cpu: 22, mem: 40, gpu: 0, power: "0.6 kW", temp: 38, fan: 30, uptime: "203d", asset: "AST-10244",
      bmc: "10.32.0.14", bios: "4.8.1", bmcFw: "3.3.2",
      location: { room: "A2 机房", row: "03 列", rack: "R05", u: [35, 36] },
      nics: [
        { port: "port-1", speed: "100G", to: "sw-tor-svc · 25", vlan: "VLAN 130" },
        { port: "port-2", speed: "100G", to: "sw-tor-svc · 26", vlan: "VLAN 130" },
        { port: "bmc", speed: "1G", to: "sw-bmc · 12", vlan: "VLAN 9" }],
      parts: [["CPU", "2× Xeon Silver 4410Y", "ok"], ["内存", "8× 64G DDR5-4800", "ok"], ["存储", "12× 8T NVMe · 双副本", "ok"], ["网卡", "2× 25G + 2× 100G", "ok"]],
      slots: Array.from({ length: 12 }, (_, i) => ({ no: i + 1, type: "8T NVMe · 检查点/记忆", state: "ok" })),
    },
  ],

  /* ── 节点扩容与场景化集群 ────────────────────────────────
     ① 既有类型扩容：GPU 推理 / GPU 执行 / 通用服务 / 状态存储
     ② 场景集群（Agent Infra 依赖的知识与合规设施）：
        业务知识库集群 R02×4（客服/经营检索 · ag-cs / ag-bi 依赖）
        研发知识库集群 R03×3（代码/文档索引 · ag-coder 依赖）
        安全审计存证集群 R06×3（WORM 归档 · ag-risk 依赖） */
  __expandServers: function () {
    const NIC = (tor, ports, vlan) => ([
      { port: "port-1", speed: ports, to: `${tor} · 25`, vlan },
      { port: "port-2", speed: ports, to: `${tor} · 26`, vlan },
      { port: "bmc", speed: "1G", to: `sw-bmc · ${30 + AXON_DATA.servers.length}`, vlan: "VLAN 9" },
    ]);
    const mk = (o) => AXON_DATA.servers.push(Object.assign({
      state: "ok", cpu: 30, mem: 50, gpu: 0, power: "0.6 kW", temp: 39, fan: 32, uptime: "30d",
      bios: "4.8.1", bmcFw: "3.3.2",
      parts: [["CPU", "2× Xeon Gold 6430", "ok"], ["内存", "8× 64G DDR5-4800", "ok"], ["网卡", "2× 25G OCP", "ok"]],
      slots: [{ no: 1, type: "3.84T NVMe · 数据", state: "ok" }, { no: 2, type: "3.84T NVMe · 数据", state: "ok" }],
    }, o));
    const A2 = "A2 机房", ROW = "03 列";

    /* ① 既有类型扩容 */
    mk({ id: "srv-gpu-03", name: "GPU 推理节点 · 03", model: "NF5468M6 · 8×A100-80G", role: "推理",
      cpu: 41, mem: 58, gpu: 73, power: "3.0 kW", temp: 45, fan: 40, uptime: "23d", asset: "AST-10245", bmc: "10.32.0.15",
      location: { room: A2, row: ROW, rack: "R04", u: [14, 19] },
      nics: NIC("sw-tor-gpu", "100G", "VLAN 110"),
      parts: [["CPU", "2× Xeon Platinum 8568Y+", "ok"], ["内存", "16× 64G DDR5-5600", "ok"], ["GPU", "8× A100-80G SXM", "ok"], ["网卡", "2× 100G OCP 3.0", "ok"]] });
    mk({ id: "srv-gpu-04", name: "GPU 执行节点 · 04", model: "NF5468M6 · 8×A100-80G", role: "沙箱执行",
      cpu: 47, mem: 62, gpu: 66, power: "3.2 kW", temp: 47, fan: 48, uptime: "21d", asset: "AST-10246", bmc: "10.32.0.16",
      location: { room: A2, row: ROW, rack: "R04", u: [8, 13] },
      nics: NIC("sw-tor-gpu", "100G", "VLAN 110"),
      parts: [["CPU", "2× Xeon Platinum 8568Y+", "ok"], ["内存", "16× 64G DDR5-5600", "ok"], ["GPU", "8× A100-80G SXM", "ok"], ["网卡", "2× 100G OCP 3.0", "ok"]] });
    mk({ id: "srv-cpu-02", name: "通用服务节点 · 02", model: "NF5280M6 · 2×Xeon 8568Y+", role: "网关/平台服务 · 扩容",
      cpu: 33, mem: 48, power: "0.7 kW", temp: 40, fan: 33, uptime: "61d", asset: "AST-10247", bmc: "10.32.0.17",
      location: { room: A2, row: ROW, rack: "R05", u: [29, 30] },
      nics: NIC("sw-tor-svc", "25G", "VLAN 120"),
      parts: [["CPU", "2× Xeon Gold 6430", "ok"], ["内存", "8× 64G DDR5-4800", "ok"], ["网卡", "4× 25G OCP", "ok"]] });
    mk({ id: "srv-sto-02", name: "状态存储节点 · 02", model: "NF5266M6 · 12×NVMe 8T", role: "检查点/记忆 · 扩容",
      cpu: 19, mem: 43, power: "0.6 kW", temp: 37, fan: 29, uptime: "61d", asset: "AST-10248", bmc: "10.32.0.18",
      location: { room: A2, row: ROW, rack: "R05", u: [24, 25] },
      nics: NIC("sw-tor-svc", "100G", "VLAN 130"),
      parts: [["CPU", "2× Xeon Silver 4410Y", "ok"], ["内存", "8× 64G DDR5-4800", "ok"], ["存储", "12× 8T NVMe · 双副本", "ok"]],
      slots: Array.from({ length: 12 }, (_, i) => ({ no: i + 1, type: "8T NVMe · 检查点/记忆", state: "ok" })) });

    /* ② 业务知识库集群 · R02 ×4（ag-cs / ag-bi → st-kb-biz）*/
    [
      ["01", "知识库 · 向量检索 / 写入", 30, 26, 74, "10.32.0.19", "AST-10249", 44],
      ["02", "知识库 · 副本 / 检索", 36, 33, 68, "10.32.0.20", "AST-10250", 41],
      ["03", "知识库 · 重排 / 缓存", 44, 41, 71, "10.32.0.21", "AST-10251", 47],
      ["04", "知识库 · 入库流水线", 52, 49, 62, "10.32.0.22", "AST-10252", 43],
    ].forEach(([n, role, cpu, fan, mem, bmc, asset, temp], i) => mk({
      id: `srv-kbb-${n}`, name: `业务知识库节点 · ${n}`, model: "NF5280M6 · 2×Xeon 6430 + 6×NVMe",
      role, cpu, mem, fan, temp, bmc, asset, power: "0.65 kW", uptime: `${120 - i * 9}d`,
      location: { room: A2, row: ROW, rack: "R02", u: [30 - i * 3, 31 - i * 3] },
      nics: NIC("sw-tor-kbb", "25G", "VLAN 140 · 业务知识库"),
      slots: Array.from({ length: 6 }, (_, j) => ({ no: j + 1, type: "3.84T NVMe · 向量/索引", state: "ok" })),
    }));

    /* ③ 研发知识库集群 · R03 ×3（ag-coder → st-kb-dev）*/
    [
      ["01", "知识库 · 代码索引 / 写入", 38, 30, 66, "10.32.0.23", "AST-10253", 42],
      ["02", "知识库 · 嵌入检索", 29, 26, 60, "10.32.0.24", "AST-10254", 40],
      ["03", "知识库 · 文档解析流水线", 47, 38, 58, "10.32.0.25", "AST-10255", 44],
    ].forEach(([n, role, cpu, fan, mem, bmc, asset, temp], i) => mk({
      id: `srv-kbd-${n}`, name: `研发知识库节点 · ${n}`, model: "NF5280M6 · 2×Xeon 6430 + 4×NVMe",
      role, cpu, mem, fan, temp, bmc, asset, power: "0.6 kW", uptime: `${98 - i * 11}d`,
      location: { room: A2, row: ROW, rack: "R03", u: [30 - i * 3, 31 - i * 3] },
      nics: NIC("sw-tor-kbd", "25G", "VLAN 141 · 研发知识库"),
      slots: Array.from({ length: 4 }, (_, j) => ({ no: j + 1, type: "3.84T NVMe · 代码索引", state: "ok" })),
    }));

    /* ④ 安全审计存证集群 · R06 ×3（ag-risk → st-audit）*/
    [
      ["01", "审计存证 · WORM 归档", 24, 27, 51, "10.32.0.26", "AST-10256", 38],
      ["02", "审计存证 · 校验 / 巡检", 31, 30, 47, "10.32.0.27", "AST-10257", 39],
      ["03", "审计存证 · 检索 / 取证", 27, 24, 44, "10.32.0.28", "AST-10258", 37],
    ].forEach(([n, role, cpu, fan, mem, bmc, asset, temp], i) => mk({
      id: `srv-aud-${n}`, name: `安全审计节点 · ${n}`, model: "NF5266M6 · 12×NVMe 8T · WORM",
      role, cpu, mem, fan, temp, bmc, asset, power: "0.55 kW", uptime: `${150 - i * 13}d`,
      location: { room: A2, row: ROW, rack: "R06", u: [33 - i * 3, 34 - i * 3] },
      nics: NIC("sw-tor-aud", "25G", "VLAN 150 · 审计存证"),
      parts: [["CPU", "2× Xeon Silver 4410Y", "ok"], ["内存", "8× 64G DDR5-4800", "ok"], ["存储", "12× 8T NVMe · WORM", "ok"]],
      slots: Array.from({ length: 12 }, (_, j) => ({ no: j + 1, type: "8T NVMe · WORM 归档", state: "ok" })),
    }));
  },

  racks: [
    { id: "R01", name: "网络柜 R01", room: "A2 机房 · 03 列", note: "核心 / 带外网络" },
    { id: "R02", name: "机柜 R02", room: "A2 机房 · 03 列", note: "业务知识库集群 ×4" },
    { id: "R03", name: "机柜 R03", room: "A2 机房 · 03 列", note: "研发知识库集群 ×3" },
    { id: "R04", name: "机柜 R04", room: "A2 机房 · 03 列", note: "GPU 推理 / 执行" },
    { id: "R05", name: "机柜 R05", room: "A2 机房 · 03 列", note: "通用 / 存储" },
    { id: "R06", name: "机柜 R06", room: "A2 机房 · 03 列", note: "安全审计存证 ×3" },
  ],

  /* 机房平面布局（米制，等轴 3D 与平面图共用） */
  dcFloor: {
    room: "A2 机房",
    size: { w: 22, d: 12 },
    rowY: { A: 3.4, B: 6.2 },
    rackSize: { w: 0.62, d: 1.16, h: 2.05 },
    rackX: (i) => 8.96 + i * 0.68,
    rows: [
      { id: "A", label: "03 列 · A 排", racks: ["R01", "R02", "R03", "R04", "R05", "R06", "R07"] },
      { id: "B", label: "03 列 · B 排", racks: ["R11", "R12", "R13", "R14", "R15", "R16", "R17"] },
    ],
    crac: [{ x: 0.6, y: 2.2 }, { x: 0.6, y: 5.2 }, { x: 0.6, y: 8.2 }, { x: 21.4, y: 5.2 }],
  },

  netDevices: [
    { id: "sw-core-01", name: "核心交换机 01", short: "核心 SW-01", model: "S9827-64EF · 64×400G", kind: "core",
      state: "ok", mgmt: "10.32.1.1", role: "核心 / Spine", location: { rack: "R01", u: [41, 41] } },
    { id: "sw-core-02", name: "核心交换机 02", short: "核心 SW-02", model: "S9827-64EF · 64×400G", kind: "core",
      state: "ok", mgmt: "10.32.1.2", role: "核心 / Spine", location: { rack: "R01", u: [40, 40] } },
    { id: "sw-tor-gpu", name: "GPU 柜 ToR 01", short: "ToR · GPU 柜", model: "S9825-48Y8C · 48×25G + 8×100G", kind: "tor",
      state: "ok", mgmt: "10.32.1.11", role: "接入 / Leaf", location: { rack: "R04", u: [41, 41] } },
    { id: "sw-tor-svc", name: "通用柜 ToR 02", short: "ToR · 通用柜", model: "S9825-48Y8C · 48×25G + 8×100G", kind: "tor",
      state: "ok", mgmt: "10.32.1.12", role: "接入 / Leaf", location: { rack: "R05", u: [41, 41] } },
    { id: "sw-bmc", name: "带外管理交换机", short: "带外 SW", model: "S5735S-24P4X · 24×1G", kind: "bmc",
      state: "ok", mgmt: "10.32.1.20", role: "BMC 带外", location: { rack: "R05", u: [40, 40] } },
    { id: "sw-tor-kbb", name: "知识库柜 ToR 03", short: "ToR · 业务KB", model: "S9825-48Y8C · 48×25G + 8×100G", kind: "tor",
      state: "ok", mgmt: "10.32.1.13", role: "接入 / Leaf", location: { rack: "R02", u: [41, 41] } },
    { id: "sw-tor-kbd", name: "知识库柜 ToR 04", short: "ToR · 研发KB", model: "S9825-48Y8C · 48×25G + 8×100G", kind: "tor",
      state: "ok", mgmt: "10.32.1.14", role: "接入 / Leaf", location: { rack: "R03", u: [41, 41] } },
    { id: "sw-tor-aud", name: "审计柜 ToR 05", short: "ToR · 审计", model: "S9825-48Y8C · 48×25G + 8×100G", kind: "tor",
      state: "ok", mgmt: "10.32.1.15", role: "接入 / Leaf", location: { rack: "R06", u: [41, 41] } },
  ],

  /* 沙箱实例（对标 OpenSandbox Lifecycle · SPEC §2.9）
     state=实际状态 desired=期望状态，不一致即「状态漂移」 */
  sandboxInstances: [
    { id: "sbx-8801", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "WARM", desired: "WARM",
      ownerTask: null, ownerNote: "预热池", tenant: null, leaseMin: null, res: "4C/8G", egress: "白名单 10.32.0.0/16" },
    { id: "sbx-8802", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "WARM", desired: "WARM",
      ownerTask: null, ownerNote: "预热池", tenant: null, leaseMin: null, res: "4C/8G", egress: "白名单 10.32.0.0/16" },
    { id: "sbx-8803", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "WARM", desired: "WARM",
      ownerTask: null, ownerNote: "预热池", tenant: null, leaseMin: null, res: "4C/8G", egress: "白名单 10.32.0.0/16" },
    { id: "sbx-8804", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "WARM", desired: "WARM",
      ownerTask: null, ownerNote: "预热池", tenant: null, leaseMin: null, res: "4C/8G", egress: "白名单 10.32.0.0/16" },
    { id: "sbx-8805", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "BOUND", desired: "BOUND",
      ownerTask: "T26-0688", tenant: "dev-tools", leaseMin: 38, renewable: true, res: "8C/16G", egress: "白名单 10.32.0.0/16 + GitHub" },
    { id: "sbx-8806", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "BOUND", desired: "BOUND",
      ownerTask: null, ownerNote: "ag-dm · 灰度会话", tenant: "data-biz", leaseMin: 9, renewable: true, res: "4C/8G", egress: "白名单 10.32.0.0/16" },
    { id: "sbx-8810", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "PAUSED", desired: "PAUSED",
      ownerTask: "T26-0731", tenant: "sec", leaseMin: null, res: "8C/16G", egress: "—",
      note: "检查点已暂存 · 等待审批，恢复前重检授权" },
    { id: "sbx-8811", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "PAUSED", desired: "PAUSED",
      ownerTask: "T26-0719", tenant: "customer-svc", leaseMin: null, res: "4C/8G", egress: "—",
      note: "等待用户补充信息 · 计算资源已释放" },
    { id: "sbx-8812", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "PAUSED", desired: "BOUND",
      ownerTask: "T26-0705", tenant: "data-biz", leaseMin: null, res: "8C/16G", egress: "白名单 10.32.0.0/16",
      note: "节点维护后未恢复 · 存在状态漂移" },
    { id: "sbx-8821", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "GC-PENDING", desired: "TERMINATED",
      ownerTask: "T26-0677", tenant: "sec", leaseMin: 0, res: "4C/8G", egress: "—",
      note: "租约已过期 · 关联任务结果待核对，受保护暂缓回收" },
    { id: "sbx-8799", cluster: "sb-e2b", template: "ubuntu-24-nocode-c4", state: "GC-PENDING", desired: "TERMINATED",
      ownerTask: null, ownerNote: "会话已结束", tenant: "dev-tools", leaseMin: 0, res: "4C/8G", egress: "—",
      note: "孤立实例 · 租约过期，可回收" },
  ],

  /* 模型路由规则（对标 agentgateway · SPEC §7.1） */
  routeRules: [
    { id: "rr-glm-default", name: "默认主力路由", match: "model=glm-4.7 · 租户=全部", fwd: "ep-glm", weight: 86,
      peer: "ep-ds", fallback: "熔断×5 → ep-ds（校验 ctx / 工具调用能力）", prio: 100 },
    { id: "rr-dev-dual", name: "研发效能 · 双活分担", match: "租户=dev-tools", fwd: "ep-glm", weight: 70,
      peer: "ep-ds", fallback: "同默认路由 · 回切需灰度", prio: 200 },
    { id: "rr-sec-only", name: "安全风控 · 合规专路", match: "租户=sec", fwd: "ep-glm", weight: 100,
      peer: null, fallback: "无备用（合规要求：不切换端点）", prio: 300 },
  ],

  netLinks: [
    { from: "srv-gpu-01", to: "sw-tor-gpu", speed: "2×100G", type: "业务", vlan: "VLAN 110 · 推理业务", util: 55, w: 2.2 },
    { from: "srv-gpu-02", to: "sw-tor-gpu", speed: "2×100G", type: "业务", vlan: "VLAN 110 · 推理业务", util: 48, w: 2.2 },
    { from: "srv-cpu-01", to: "sw-tor-svc", speed: "2×25G", type: "业务", vlan: "VLAN 120 · 平台服务", util: 22, w: 1.6 },
    { from: "srv-sto-01", to: "sw-tor-svc", speed: "2×100G", type: "业务", vlan: "VLAN 130 · 检查点存储", util: 34, w: 2.2 },
    { from: "sw-tor-gpu", to: "sw-core-01", speed: "2×400G", type: "上行", vlan: "Trunk · ECMP", util: 63, w: 3 },
    { from: "sw-tor-gpu", to: "sw-core-02", speed: "2×400G", type: "上行", vlan: "Trunk · 冗余", util: 9, w: 3 },
    { from: "sw-tor-svc", to: "sw-core-01", speed: "2×100G", type: "上行", vlan: "Trunk · ECMP", util: 18, w: 2.2 },
    { from: "sw-tor-svc", to: "sw-core-02", speed: "2×100G", type: "上行", vlan: "Trunk · 冗余", util: 4, w: 2.2 },
    { from: "sw-bmc", to: "sw-core-01", speed: "1×10G", type: "带外", vlan: "VLAN 9 · BMC", util: 12, w: 1.4 },
    { from: "srv-gpu-01", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 6, w: 1 },
    { from: "srv-gpu-02", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 5, w: 1 },
    { from: "srv-cpu-01", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },
    { from: "srv-sto-01", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },

    /* 场景集群与扩容节点接入（业务链路 + 上行 + 带外）*/
    { from: "srv-gpu-03", to: "sw-tor-gpu", speed: "2×100G", type: "业务", vlan: "VLAN 110 · 推理业务", util: 44, w: 2.2 },
    { from: "srv-gpu-04", to: "sw-tor-gpu", speed: "2×100G", type: "业务", vlan: "VLAN 110 · 沙箱执行", util: 39, w: 2.2 },
    { from: "srv-cpu-02", to: "sw-tor-svc", speed: "2×25G", type: "业务", vlan: "VLAN 120 · 平台服务", util: 18, w: 1.6 },
    { from: "srv-sto-02", to: "sw-tor-svc", speed: "2×100G", type: "业务", vlan: "VLAN 130 · 检查点存储", util: 28, w: 2.2 },
    { from: "srv-kbb-01", to: "sw-tor-kbb", speed: "2×25G", type: "业务", vlan: "VLAN 140 · 业务知识库", util: 41, w: 1.6 },
    { from: "srv-kbb-02", to: "sw-tor-kbb", speed: "2×25G", type: "业务", vlan: "VLAN 140 · 业务知识库", util: 33, w: 1.6 },
    { from: "srv-kbb-03", to: "sw-tor-kbb", speed: "2×25G", type: "业务", vlan: "VLAN 140 · 业务知识库", util: 26, w: 1.6 },
    { from: "srv-kbb-04", to: "sw-tor-kbb", speed: "2×25G", type: "业务", vlan: "VLAN 140 · 业务知识库", util: 22, w: 1.6 },
    { from: "srv-kbd-01", to: "sw-tor-kbd", speed: "2×25G", type: "业务", vlan: "VLAN 141 · 研发知识库", util: 37, w: 1.6 },
    { from: "srv-kbd-02", to: "sw-tor-kbd", speed: "2×25G", type: "业务", vlan: "VLAN 141 · 研发知识库", util: 24, w: 1.6 },
    { from: "srv-kbd-03", to: "sw-tor-kbd", speed: "2×25G", type: "业务", vlan: "VLAN 141 · 研发知识库", util: 19, w: 1.6 },
    { from: "srv-aud-01", to: "sw-tor-aud", speed: "2×25G", type: "业务", vlan: "VLAN 150 · 审计存证", util: 16, w: 1.6 },
    { from: "srv-aud-02", to: "sw-tor-aud", speed: "2×25G", type: "业务", vlan: "VLAN 150 · 审计存证", util: 12, w: 1.6 },
    { from: "srv-aud-03", to: "sw-tor-aud", speed: "2×25G", type: "业务", vlan: "VLAN 150 · 审计存证", util: 9, w: 1.6 },
    { from: "sw-tor-kbb", to: "sw-core-01", speed: "2×100G", type: "上行", vlan: "Trunk · ECMP", util: 34, w: 2.2 },
    { from: "sw-tor-kbb", to: "sw-core-02", speed: "2×100G", type: "上行", vlan: "Trunk · 冗余", util: 7, w: 2.2 },
    { from: "sw-tor-kbd", to: "sw-core-01", speed: "2×100G", type: "上行", vlan: "Trunk · ECMP", util: 28, w: 2.2 },
    { from: "sw-tor-kbd", to: "sw-core-02", speed: "2×100G", type: "上行", vlan: "Trunk · 冗余", util: 5, w: 2.2 },
    { from: "sw-tor-aud", to: "sw-core-01", speed: "1×100G", type: "上行", vlan: "Trunk · 审计隔离", util: 13, w: 2.2 },
    { from: "srv-gpu-03", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 6, w: 1 },
    { from: "srv-gpu-04", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 5, w: 1 },
    { from: "srv-cpu-02", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },
    { from: "srv-sto-02", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },
    { from: "srv-kbb-01", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 5, w: 1 },
    { from: "srv-kbb-02", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },
    { from: "srv-kbb-03", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },
    { from: "srv-kbb-04", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 3, w: 1 },
    { from: "srv-kbd-01", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 4, w: 1 },
    { from: "srv-kbd-02", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 3, w: 1 },
    { from: "srv-kbd-03", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 3, w: 1 },
    { from: "srv-aud-01", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 3, w: 1 },
    { from: "srv-aud-02", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 3, w: 1 },
    { from: "srv-aud-03", to: "sw-bmc", speed: "1G", type: "带外", vlan: "VLAN 9 · BMC", util: 2, w: 1 },
  ],

  infra: [
    { id: "rt-langgraph", kind: "runtime", name: "LangGraph Runtime", ver: "0.2.71", host: "srv-gpu-01",
      state: "ok", pods: 12, desc: "有状态 Agent 执行运行时 · 检查点自动持久化" },
    { id: "sb-e2b", kind: "sandbox", name: "E2B 沙箱集群", ver: "1.5.2", host: "srv-gpu-02",
      state: "ok", warm: 14, bound: 9, paused: 2, template: "ubuntu-24-nocode-c4",
      desc: "代码执行沙箱 · 支持文件快照与内存快照" },
    { id: "gw-model", kind: "gateway", name: "模型网关 · Higress", ver: "2.1.0", host: "srv-cpu-01",
      state: "ok", routes: 6, qps: 38, desc: "模型统一入口 · 路由 / 限流 / Fallback" },
    { id: "gw-mcp", kind: "gateway", name: "MCP 工具网关", ver: "1.3.0", host: "srv-cpu-01",
      state: "ok", tools: 6, qps: 12, desc: "工具统一接入 · 契约校验 · 凭据注入" },
    { id: "st-ckpt", kind: "state", name: "检查点存储", ver: "v2", host: "srv-sto-01",
      state: "ok", usedPct: 38, cap: "12 TB", desc: "任务检查点 / 沙箱快照 · 双副本" },
    { id: "st-mem", kind: "state", name: "记忆库 · Redis", ver: "7.2", host: "srv-sto-01",
      state: "ok", hitRate: 94, desc: "跨会话长期记忆 · 共享 Store" },
    { id: "svc-iam", kind: "identity", name: "身份与凭据服务", ver: "3.4", host: "srv-sto-01",
      state: "ok", creds: 27, desc: "Agent 身份 / 委托凭据 / 撤销传播" },
    { id: "st-kb-biz", kind: "state", name: "业务知识库集群", ver: "Milvus 2.4", host: "srv-kbb-01",
      state: "ok", nodes: 4, hitRate: 92, desc: "客服/经营知识检索 · 向量 + 重排（4 节点 · 3 副本）" },
    { id: "st-kb-dev", kind: "state", name: "研发知识库集群", ver: "Milvus 2.4", host: "srv-kbd-01",
      state: "ok", nodes: 3, hitRate: 88, desc: "代码/文档索引 · 嵌入检索（3 节点）" },
    { id: "st-audit", kind: "state", name: "审计存证库", ver: "WORM v3", host: "srv-aud-01",
      state: "ok", nodes: 3, cap: "48 TB", desc: "操作留痕与合规归档 · WORM 不可篡改（3 节点）" },
  ],

  models: [
    { id: "ep-glm", name: "GLM-4.7 主力端点", vendor: "Zhipu · 私有化部署", ctx: "200K",
      state: "ok", traffic: 86, p95: 1.8, tps: 940, tokens24h: 312, via: "gw-model" },
    { id: "ep-ds", name: "DeepSeek-V4 备用端点", vendor: "DeepSeek · 私有化部署", ctx: "128K",
      state: "standby", traffic: 14, p95: 2.4, tps: 180, tokens24h: 61, via: "gw-model" },
  ],

  tools: [
    { id: "tl-ticket", name: "工单系统 MCP", ver: "v3.2", effect: "external-write", idem: true,
      contract: "ok", consumers: ["ag-cs", "ag-risk"], qps: 4.2, err: 0.3,
      note: "支持幂等键 · 可安全重试" },
    { id: "tl-kb", name: "知识库检索 MCP", ver: "v2.0", effect: "readonly", idem: true,
      contract: "ok", consumers: ["ag-cs", "ag-bi"], qps: 11, err: 0.1, note: "只读" },
    { id: "tl-git", name: "代码仓库 MCP", ver: "v4.1", effect: "readonly", idem: true,
      contract: "ok", consumers: ["ag-coder", "ag-dm"], qps: 6, err: 0.2, note: "只读" },
    { id: "tl-ci", name: "CI/CD 触发 MCP", ver: "v2.3", effect: "external-write", idem: true,
      contract: "ok", consumers: ["ag-coder"], qps: 0.8, err: 0.6,
      note: "构建产物可查询 · 结果可核对" },
    { id: "tl-web", name: "浏览器工具 MCP", ver: "v1.7", effect: "sandboxed", idem: true,
      contract: "ok", consumers: ["ag-coder", "ag-ops"], qps: 2.1, err: 1.2,
      note: "沙箱内执行 · 网络白名单" },
    { id: "tl-erp", name: "ERP 写入 MCP", ver: "v5.0", effect: "external-write", idem: false,
      contract: "warn", consumers: ["ag-risk"], qps: 0.4, err: 2.8,
      note: "无幂等键 · 超时后必须走结果核对队列" },
  ],

  agents: [
    { id: "ag-cs", name: "智能客服 Agent", ver: "v2.4.1", owner: "客服业务部 · 李文", tenant: "customer-svc",
      state: "running", inst: 4, uptime99: "99.6%",
      runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-ticket", "tl-kb"], stores: ["st-mem", "st-kb-biz"],
      caps: { observe: 1, traffic: 1, instance: 1, state: 1, task: 1 } },
    { id: "ag-coder", name: "代码助手 Agent", ver: "v1.8.0", owner: "研发效能 · 陈曦", tenant: "dev-tools",
      state: "running", inst: 6, uptime99: "99.2%",
      runtime: "sb-e2b", models: ["ep-glm", "ep-ds"], tools: ["tl-git", "tl-ci", "tl-web"], stores: ["st-kb-dev"],
      caps: { observe: 1, traffic: 1, instance: 1, state: 1, task: 1 } },
    { id: "ag-ops", name: "运维巡检 Agent", ver: "v3.0.2", owner: "平台工程 · 赵航", tenant: "platform",
      state: "running", inst: 2, uptime99: "99.8%",
      runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-web"], stores: [],
      caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 } },
    { id: "ag-bi", name: "经营分析 Agent", ver: "v2.1.3", owner: "数据经营 · 孙萌", tenant: "data-biz",
      state: "running", inst: 2, uptime99: "98.9%",
      runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-kb"], stores: ["st-mem", "st-kb-biz"],
      caps: { observe: 1, traffic: 1, instance: 0, state: 1, task: 1 } },
    { id: "ag-risk", name: "风控审核 Agent", ver: "v1.2.0", owner: "安全风控 · 周麟", tenant: "sec",
      state: "running", inst: 3, uptime99: "99.5%",
      runtime: "rt-langgraph", models: ["ep-glm"], tools: ["tl-ticket", "tl-erp"], stores: ["st-audit"],
      caps: { observe: 1, traffic: 1, instance: 1, state: 0, task: 1 } },
    { id: "ag-dm", name: "数据治理 Agent", ver: "v0.9.0-rc", owner: "数据经营 · 孙萌", tenant: "data-biz",
      state: "gray", inst: 1, uptime99: "—",
      runtime: "sb-e2b", models: ["ep-ds"], tools: ["tl-git"], stores: [],
      caps: { observe: 1, traffic: 1, instance: 0, state: 0, task: 0 } },
  ],

  tasks: [
    { id: "T26-0688", name: "支付模块重构 · 阶段 2", agent: "ag-coder", state: "running",
      progress: 38, interruptible: true, tokensM: 2.4, cost: 172, started: "09:41", elapsed: 46,
      ckpt: { id: "cp-a13f", mode: "应用检查点", ts: "10:12", compat: true } },
    { id: "T26-0712", name: "工单批量归档 · 夜间批", agent: "ag-cs", state: "running",
      progress: 71, interruptible: true, tokensM: 1.1, cost: 64, started: "08:05", elapsed: 142,
      ckpt: { id: "cp-77c2", mode: "应用检查点", ts: "09:50", compat: true } },
    { id: "T26-0733", name: "全链路夜间巡检", agent: "ag-ops", state: "running",
      progress: 12, interruptible: true, tokensM: 0.6, cost: 31, started: "10:32", elapsed: 9,
      ckpt: { id: "cp-d90b", mode: "应用检查点", ts: "10:36", compat: true } },
    { id: "T26-0729", name: "季度经营简报生成", agent: "ag-bi", state: "running",
      progress: 55, interruptible: false, tokensM: 3.8, cost: 289, started: "09:18", elapsed: 89,
      ckpt: { id: "cp-4e2a", mode: "应用检查点", ts: "10:20", compat: true } },
    { id: "T26-0731", name: "供应商准入风控审核", agent: "ag-risk", state: "waiting_approval",
      progress: 62, interruptible: false, tokensM: 1.2, cost: 86, started: "09:26", elapsed: 76, waitMin: 47,
      ckpt: { id: "cp-9f21", mode: "应用检查点 + 文件快照", ts: "10:12", compat: true },
      waitReason: "等待安全风控 · 周麟 审批（外部 ERP 写入授权）" },
    { id: "T26-0725", name: "高风险退款复核", agent: "ag-risk", state: "waiting_approval",
      progress: 28, interruptible: false, tokensM: 0.4, cost: 22, started: "10:04", elapsed: 41, waitMin: 12,
      ckpt: { id: "cp-31e8", mode: "应用检查点", ts: "10:18", compat: true },
      waitReason: "等待客服业务部 · 李文 补充订单上下文" },
    { id: "T26-0719", name: "客户投诉深查报告", agent: "ag-cs", state: "checkpointed",
      progress: 81, interruptible: true, tokensM: 1.9, cost: 121, started: "07:52", elapsed: 158, waitMin: 138,
      ckpt: { id: "cp-55d0", mode: "完整快照（含内存）", ts: "08:02", compat: true },
      waitReason: "等待用户补充信息 · 计算资源已释放" },
    { id: "T26-0741", name: "发布流水线代码审计", agent: "ag-coder", state: "queued",
      progress: 0, interruptible: true, tokensM: 0, cost: 0, started: "—", elapsed: 0, waitMin: 6,
      ckpt: null, waitReason: "dev-tools 沙箱并发配额等待（34/40）" },
    { id: "T26-0705", name: "库存对账重跑", agent: "ag-bi", state: "recovering",
      progress: 44, interruptible: true, tokensM: 2.2, cost: 158, started: "06:30", elapsed: 243,
      ckpt: { id: "cp-77c3", mode: "应用检查点", ts: "09:44", compat: true },
      waitReason: "自检查点恢复中 · 步骤 12/27" },
    { id: "T26-0701", name: "每日知识库增量刷新", agent: "ag-cs", state: "succeeded",
      progress: 100, interruptible: true, tokensM: 0.8, cost: 38, started: "05:00", elapsed: 22,
      ckpt: null },
    { id: "T26-0699", name: "Release Notes 生成", agent: "ag-coder", state: "succeeded",
      progress: 100, interruptible: true, tokensM: 0.3, cost: 17, started: "04:12", elapsed: 9,
      ckpt: null },
    { id: "T26-0677", name: "ERP 批量写入 · 供应商台账", agent: "ag-risk", state: "unknown",
      progress: 87, interruptible: false, tokensM: 0.9, cost: 44, started: "08:44", elapsed: 28,
      ckpt: { id: "cp-8811", mode: "应用检查点", ts: "09:02", compat: true },
      waitReason: "工具调用超时且无幂等键 · 已进入人工核对队列（S12）" },
  ],

  tenants: [
    { id: "customer-svc", name: "客服业务部", prio: "P1",
      tokenBudget: 300, tokenUsed: 187, sandboxQuota: 20, sandboxUsed: 11, stepLimit: 40 },
    { id: "dev-tools", name: "研发效能", prio: "P1",
      tokenBudget: 500, tokenUsed: 438, sandboxQuota: 40, sandboxUsed: 34, stepLimit: 80 },
    { id: "data-biz", name: "数据经营", prio: "P2",
      tokenBudget: 200, tokenUsed: 121, sandboxQuota: 12, sandboxUsed: 7, stepLimit: 60 },
    { id: "sec", name: "安全风控", prio: "P1",
      tokenBudget: 150, tokenUsed: 96, sandboxQuota: 16, sandboxUsed: 9, stepLimit: 50 },
    { id: "platform", name: "平台工程", prio: "P2",
      tokenBudget: 100, tokenUsed: 41, sandboxQuota: 8, sandboxUsed: 2, stepLimit: 30 },
  ],

  /* KPI 初始值（tick 引擎会微调部分数值） */
  kpi: {
    agents: 6, infraSvc: 13, liveTasks: 9, sandboxes: 25,
    token24h: 4.83, costPerTask: 0.42, coverage: 97.6, successRate: 94.2,
  },

  charts: {
    throughput: (() => {
      const a = [];
      for (let h = 24; h >= 0; h--) {
        const base = 20 + 30 * Math.exp(-Math.pow((24 - h - 3) % 24 - 2, 2) / 8) + 26 * Math.exp(-Math.pow(((24 - h + 12) % 24) - 14, 2) / 10);
        a.push({ done: Math.round(base + Math.random() * 8), fail: Math.random() < 0.18 ? Math.round(1 + Math.random() * 2) : 0 });
      }
      return a;
    })(),
    latency: Array.from({ length: 40 }, () => 1.5 + Math.random() * 1.1),
  },

  alerts: [
    { id: "AL-01", level: "warn", src: "srv-cpu-01", msg: "磁盘槽位 5 SMART 预警 · 建议更换", ts: "09:58", view: "maint" },
    { id: "AL-02", level: "warn", src: "dev-tools", msg: "Token 配额使用 88% · 预计 17:40 触发限流", ts: "10:21", view: "gov" },
    { id: "AL-03", level: "warn", src: "T26-0731", msg: "等待人工审批 47 分钟 · 执行环境已按检查点暂存", ts: "10:26", view: "tasks" },
  ],

  policyEvents: [
    { ts: "10:31", tag: "阻断", cls: "crit", msg: "沙箱内尝试访问未授权端点 <b>10.32.0.9:443</b>，已在执行边界阻断 · 关联 <b>T26-0688</b>" },
    { ts: "10:24", tag: "撤销", cls: "crit", msg: "委托凭据 <b>ag-risk#erp-delegated</b> 已撤销，在途任务暂停新调用，2 个任务受影响" },
    { ts: "10:17", tag: "限流", cls: "warn", msg: "<b>T26-0677</b> 工具步骤重试达上限，触发熔断进入待确认状态（防重复写入）" },
    { ts: "10:02", tag: "配额", cls: "warn", msg: "租户 <b>dev-tools</b> Token 消耗接近配额（88%），已提示负责人" },
    { ts: "09:47", tag: "核对", cls: "info", msg: "ERP 写入结果未知任务已入 <b>人工核对队列</b>，幂等能力缺失已登记工具目录" },
    { ts: "09:30", tag: "准入", cls: "info", msg: "<b>T26-0741</b> 因沙箱并发配额进入排队，预估等待 8 分钟" },
  ],
};

/* 执行节点扩容（延迟到对象构造完成后，避免 TDZ）*/
AXON_DATA.__expandServers();
delete AXON_DATA.__expandServers;

/* ── 派生：图节点与边 ─────────────────────────────────────── */
AXON_DATA.buildGraph = function () {
  const nodes = [], edges = [];

  const push = (n) => nodes.push(n);
  this.servers.forEach(s => push({
    id: s.id, layer: 0, type: "server", label: s.name.replace(/ · \d+$/, ""),
    sub: s.model.split(" · ")[0], ref: s, w: 118, h: 44,
  }));

  const kindName = { runtime: "运行时", sandbox: "沙箱", gateway: "网关", state: "状态", identity: "身份" };
  this.infra.forEach(f => {
    push({ id: f.id, layer: 1, type: f.kind, label: f.name, sub: `${kindName[f.kind]} · ${f.ver}`, ref: f, w: 118, h: 40 });
    edges.push({ from: f.id, to: f.host, kind: "host" });
  });

  const pushCatalog = (m, type, sub) => push({ id: m.id, layer: 2, type, label: m.name, sub, ref: m, w: 112, h: 38 });
  this.models.forEach(m => { pushCatalog(m, "model", `${m.vendor.split(" ·")[0]} · ${m.ctx}`); edges.push({ from: m.id, to: m.via, kind: "mount" }); });
  this.tools.forEach(t => { pushCatalog(t, "tool", `MCP ${t.ver}`); edges.push({ from: t.id, to: "gw-mcp", kind: "mount" }); });

  this.agents.forEach(a => {
    push({ id: a.id, layer: 3, type: "agent", label: a.name.replace(" Agent", ""), sub: `${a.ver} · ${a.inst} 实例`, ref: a, w: 124, h: 42 });
    edges.push({ from: a.id, to: a.runtime, kind: "dep" });
    a.models.forEach(m => edges.push({ from: a.id, to: m, kind: "dep" }));
    a.tools.forEach(t => edges.push({ from: a.id, to: t, kind: "dep" }));
    a.stores.forEach(st => edges.push({ from: a.id, to: st, kind: "dep" }));
  });

  /* 遥测推断的调用关系（SPEC §3.1：与显式声明区分展示，虚线 + 有效期） */
  edges.push({ from: "ag-ops", to: "tl-kb", kind: "dep", inferred: true });
  edges.push({ from: "ag-bi", to: "tl-ticket", kind: "dep", inferred: true });

  this.tasks.forEach(t => {
    if (t.state === "succeeded") return;
    push({ id: t.id, layer: 4, type: "task", label: t.name.length > 11 ? t.name.slice(0, 10) + "…" : t.name, sub: t.id, ref: t, w: 116, h: 38 });
    edges.push({ from: t.id, to: t.agent, kind: "own" });
  });

  return { nodes, edges };
};

/* 服务器的 Agent 承载链路（服务器管理视角的核心查询）：
   该服务器承载的 Infra 服务 → 直接依赖这些服务的 Agent → 其在途任务 */
AXON_DATA.workload = function (srvId) {
  const hosted = this.infra.filter(f => f.host === srvId);
  const hostedIds = new Set(hosted.map(f => f.id));
  const models = this.models.filter(m => hostedIds.has(m.via));
  const tools = hostedIds.has("gw-mcp") ? this.tools : [];
  const svc = [...hosted, ...models, ...tools];
  const svcIds = new Set(svc.map(x => x.id));
  const agents = this.agents.filter(a =>
    svcIds.has(a.runtime) || a.models.some(m => svcIds.has(m)) ||
    a.tools.some(t => svcIds.has(t)) || a.stores.some(s => svcIds.has(s)));
  const tasks = this.tasks.filter(t => agents.some(a => a.id === t.agent) && !["succeeded","failed","cancelled"].includes(t.state));
  const nonInt = tasks.filter(t => t.interruptible === false);
  return { svc, agents, tasks, nonInt };
};

/* 下游影响：依赖方向为 task→agent→infra→server，
   故「server 的影响面」= 沿边反向可达的所有节点 */
AXON_DATA.downstream = function (edges, rootId) {
  const rev = new Map();
  edges.forEach(e => {
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to).push(e.from);
  });
  const seen = new Set([rootId]), q = [rootId];
  while (q.length) {
    const cur = q.shift();
    (rev.get(cur) || []).forEach(n => { if (!seen.has(n)) { seen.add(n); q.push(n); } });
  }
  seen.delete(rootId);
  return seen;
};

AXON_DATA.nodeIndex = function () {
  if (this._ni) return this._ni;
  const ni = new Map();
  this.servers.forEach(s => ni.set(s.id, s));
  this.netDevices.forEach(n => ni.set(n.id, n));
  this.infra.forEach(f => ni.set(f.id, f));
  this.models.forEach(m => ni.set(m.id, m));
  this.tools.forEach(t => ni.set(t.id, t));
  this.agents.forEach(a => ni.set(a.id, a));
  this.tasks.forEach(t => ni.set(t.id, t));
  this._ni = ni;
  return ni;
};

AXON_DATA.find = function (id) { return this.nodeIndex().get(id); };

/* ── Agent 部署态（对标 kagent · SPEC §6.2）──────────────
   实例清单 / 期望实例数 / 灰度流量 / 上一版本（回退入口） */
(function decorateAgents() {
  const hostOf = { "rt-langgraph": "srv-gpu-01", "sb-e2b": "srv-gpu-02" };
  const seedInsts = {
    "ag-cs": ["7f2a", "7f2b", "7f2c", "7f2d"],
    "ag-coder": ["31e0", "31e1", "31e2", "31e3", "31e4", "31e5"],
    "ag-ops": ["d90b", "d90c"],
    "ag-bi": ["4e2a", "4e2b"],
    "ag-risk": ["9f21", "9f22", "9f23"],
    "ag-dm": ["77c3"],
  };
  const prev = { "ag-cs": "v2.3.9", "ag-coder": "v1.7.6", "ag-ops": "v3.0.1", "ag-bi": "v2.1.2", "ag-risk": "v1.1.4", "ag-dm": "—" };
  this.agents.forEach(a => {
    a.insts = (seedInsts[a.id] || []).map((s, i) => ({
      id: `${a.id}-${s}`,
      host: hostOf[a.runtime] || "srv-gpu-01",
      state: (a.id === "ag-bi" && i === 1) ? "NotReady" : "Ready",
      note: (a.id === "ag-bi" && i === 1) ? "扩容中 · 镜像拉取" : "",
      uptime: `${3 + i * 7}d`,
    }));
    a.desiredInst = a.id === "ag-bi" ? 3 : a.insts.length;
    a.canaryPct = a.state === "gray" ? 10 : 0;
    a.prevVer = prev[a.id] || "—";
  });
}).call(AXON_DATA);

/* 沙箱集群计数从实例表派生（单一事实来源 · SPEC 不变量） */
AXON_DATA.syncSbxCounters = function () {
  const sb = this.infra.find(f => f.id === "sb-e2b");
  if (!sb) return;
  const list = this.sandboxInstances.filter(x => x.cluster === "sb-e2b");
  sb.warm = list.filter(x => x.state === "WARM").length;
  sb.bound = list.filter(x => x.state === "BOUND").length;
  sb.paused = list.filter(x => x.state === "PAUSED").length;
};
AXON_DATA.syncSbxCounters();

/* 任务状态显示语义 */
const TASK_META = {
  running:           { txt: "运行中",   cls: "ok" },
  queued:            { txt: "排队中",   cls: "dim" },
  waiting_approval:  { txt: "等待审批", cls: "warn" },
  checkpointed:      { txt: "已暂存",   cls: "info" },
  recovering:        { txt: "恢复中",   cls: "violet" },
  succeeded:         { txt: "已完成",   cls: "dim" },
  failed:            { txt: "失败",     cls: "crit" },
  unknown:           { txt: "结果待核对", cls: "crit" },
};

const LAYER_META = {
  0: { name: "服务器与系统", color: "#6f9bff" },
  1: { name: "Infra 服务",   color: "#37e2ff" },
  2: { name: "模型 / 工具",  color: "#ff9350" },
  3: { name: "Agent",        color: "#b18cff" },
  4: { name: "任务与会话",   color: "#3ddba4" },
};
