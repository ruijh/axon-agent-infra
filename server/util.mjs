import { randomBytes } from "node:crypto";
/* ═══════════════════════════════════════════════════════════
   AXON · 控制平面公共工具：错误 / 时间 / 编号
   ═══════════════════════════════════════════════════════════ */

/** SPEC §9.4 错误信封：HTTP 状态 + 机器可读 code */
export class ApiError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

export const nowIso = () => new Date().toISOString();

export const hhmmss = (d = new Date()) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");

const randHex = (n) =>
  randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n);

/** 任务编号：T{yyww}-{序号}（SPEC §1.1） */
export function newTaskId(seq) {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `T${String(d.getFullYear()).slice(2)}${String(week).padStart(2, "0")}-${String(seq).padStart(4, "0")}`;
}

export const newOpId = (seq) => `OP-${seq}`;
export const newSbxId = () => `sbx-${randHex(24)}`;
export const newCpId = () => `cp-${randHex(24)}`;
export const newToken = () => `axk_${randHex(64)}`;
export const newKeyId = () => `K-${randHex(24).toUpperCase()}`;

export function weekOf(d = new Date()) {
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
}
