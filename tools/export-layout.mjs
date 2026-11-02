/* ═══════════════════════════════════════════════════════════
   AXON · 机房布局导出（Blender 建模管线的输入）
   从 assets/data.js 提取 dcFloor / racks / servers / netDevices，
   生成 tools/dc-layout.json，供 tools/build_dc_model.py 读取。
   用法：node tools/export-layout.mjs
   ═══════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "assets/data.js"), "utf8");

/* data.js 是经典脚本（const AXON_DATA = {...} + 尾部展开调用），
   在函数体内 eval 使其顶层声明落在同一作用域，直接取 AXON_DATA */
const D = new Function(src + "; return AXON_DATA;")();

const layout = {
  exportedAt: new Date().toISOString(),
  room: D.dcFloor.room,
  size: D.dcFloor.size,
  rowY: D.dcFloor.rowY,
  rackSize: D.dcFloor.rackSize,
  rackX: D.dcFloor.rows[0].racks.map((_, i) => D.dcFloor.rackX(i)),
  rows: D.dcFloor.rows.map(r => ({ id: r.id, label: r.label, racks: r.racks })),
  crac: D.dcFloor.crac,
  managedRacks: D.racks.map(r => ({ id: r.id, name: r.name, note: r.note })),
  devices: [
    ...D.servers.map(s => ({
      id: s.id, kind: "server", state: s.state,
      rack: s.location.rack, u: s.location.u,
    })),
    ...D.netDevices.map(n => ({
      id: n.id, kind: n.kind === "bmc" ? "bmc" : "net", state: n.state,
      rack: n.location.rack, u: n.location.u,
    })),
  ],
};

const out = join(root, "tools/dc-layout.json");
writeFileSync(out, JSON.stringify(layout, null, 2));
console.log(`dc-layout.json 已生成：机柜 ${layout.rows.flatMap(r => r.racks).length} 位 · 纳管 ${layout.managedRacks.length} · 设备 ${layout.devices.length} 台`);
