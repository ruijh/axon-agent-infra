/* ═══════════════════════════════════════════════════════════
   AXON · 存储层（SQLite WAL · 零 npm 依赖 · node:sqlite）
   业务对象采用 JSON 列；表结构用 PRAGMA user_version 独立迁移。
   演示播种与业务数据升级分离，初始化和迁移均以事务执行。
   ═══════════════════════════════════════════════════════════ */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { seedWorld } from "./model.mjs";
import { ApiError, nowIso } from "./util.mjs";

/** 演示种子版本只描述首次初始化内容；升级绝不以种子覆盖业务数据。 */
const SEED_VERSION = "0.95.2";
const SCHEMA_VERSION = 1;
const DATA_TABLES = ["objects", "agents", "tasks", "sandboxes", "ops", "events", "api_keys", "idempotency"];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta        (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS api_keys    (id TEXT PRIMARY KEY, name TEXT, role TEXT, hash TEXT,
                                        created_at TEXT, last_used_at TEXT, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS objects     (id TEXT PRIMARY KEY, kind TEXT, json TEXT);
CREATE TABLE IF NOT EXISTS agents      (id TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS tasks       (id TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS sandboxes   (id TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS ops         (op_id TEXT PRIMARY KEY, json TEXT);
CREATE TABLE IF NOT EXISTS events      (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, kind TEXT,
                                        type TEXT, severity TEXT, source TEXT, subject TEXT, msg TEXT, refs TEXT);
CREATE TABLE IF NOT EXISTS idempotency (key TEXT PRIMARY KEY, request_hash TEXT, response TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS sequences   (name TEXT PRIMARY KEY, next_value INTEGER NOT NULL CHECK(next_value > 0));
CREATE INDEX IF NOT EXISTS idx_events_subject ON events(subject);
`;

export class Store {
  constructor(file) {
    if (dirname(file) !== "." && !existsSync(dirname(file))) mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.file = file;
    try {
      this.db.exec("PRAGMA busy_timeout=5000;");
      const version = this.db.prepare("PRAGMA user_version").get().user_version;
      if (version > SCHEMA_VERSION) throw new Error(`数据库 schema v${version} 高于程序支持的 v${SCHEMA_VERSION}，请使用匹配版本；数据未重置`);
      this.db.exec("PRAGMA journal_mode=WAL;");
      if (version < 1) {
        this.transaction(() => {
          // v0 → v1：仅增加持久化序列，不改写任何旧业务记录或 seedVersion。
          this.db.exec(SCHEMA);
          this._initializeSequences();
          this.db.exec("PRAGMA user_version=1;");
        });
      }
    } catch (e) { this.db.close(); throw e; }
  }

  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  /* ── 通用行 ↔ JSON ── */
  _row(table, idCol, id) {
    return this.db.prepare(`SELECT * FROM ${table} WHERE ${idCol} = ?`).get(id);
  }
  _put(table, idCol, id, obj) {
    this.db.prepare(`INSERT INTO ${table} (${idCol}, json) VALUES (?, ?)
                     ON CONFLICT(${idCol}) DO UPDATE SET json = excluded.json`).run(id, JSON.stringify(obj));
  }
  _create(table, idCol, id, obj) {
    const result = this.db.prepare(`INSERT INTO ${table} (${idCol}, json) VALUES (?, ?)
      ON CONFLICT(${idCol}) DO NOTHING`).run(id, JSON.stringify(obj));
    if (!result.changes) throw new ApiError(409, "SOURCE_CONFLICT", `对象 ${id} 已存在，拒绝覆盖`);
  }
  _list(table) {
    return this.db.prepare(`SELECT json FROM ${table}`).all().map(r => JSON.parse(r.json));
  }
  _delete(table, idCol, id) {
    this.db.prepare(`DELETE FROM ${table} WHERE ${idCol} = ?`).run(id);
  }

  /* ── meta ── */
  getMeta(key) { const r = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key); return r ? r.value : null; }
  setMeta(key, value) {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
  }

  /* ── API Keys ── */
  saveKey(k) {
    this.db.prepare(`INSERT INTO api_keys (id, name, role, hash, created_at, last_used_at, revoked)
                     VALUES (?, ?, ?, ?, ?, ?, 0)
                     ON CONFLICT(id) DO UPDATE SET last_used_at = excluded.last_used_at, revoked = excluded.revoked`).run(k.id, k.name, k.role, k.hash, k.createdAt, k.lastUsedAt || null);
  }
  findKeyByHash(hash) {
    const r = this.db.prepare("SELECT * FROM api_keys WHERE hash = ? AND revoked = 0").get(hash);
    if (!r) return null;
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), r.id);
    return { id: r.id, name: r.name, role: r.role, createdAt: r.created_at };
  }
  listKeys() {
    return this.db.prepare("SELECT id, name, role, created_at, last_used_at, revoked FROM api_keys ORDER BY created_at").all()
      .map(r => ({ id: r.id, name: r.name, role: r.role, createdAt: r.created_at, lastUsedAt: r.last_used_at, revoked: !!r.revoked }));
  }
  revokeKey(id) { this.db.prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(id); }

  /* ── 目录对象：server / rack / netdevice / netlink / infra / model / tool / route / tenant ── */
  objects(kind) { return this._list("objects").filter(o => o._kind === kind); }
  object(id) { const r = this._row("objects", "id", id); return r ? JSON.parse(r.json) : null; }
  putObject(kind, obj) { this._put("objects", "id", obj.id, { ...obj, _kind: kind }); }
  get servers() { return this.objects("server"); }
  get infra() { return this.objects("infra"); }
  get models() { return this.objects("model"); }
  get tools() { return this.objects("tool"); }
  get routes() { return this.objects("route"); }
  get tenants() { return this.objects("tenant"); }
  tenant(id) { return this.object(id); }

  /* ── Agent（目录种子 + 运行时注册共用一张表）── */
  agents() { return this._list("agents"); }
  agent(id) { const r = this._row("agents", "id", id); return r ? JSON.parse(r.json) : null; }
  putAgent(a) { this._put("agents", "id", a.id, a); }

  /* ── Task ── */
  tasks() { return this._list("tasks").sort((a, b) => (a.id < b.id ? 1 : -1)); }
  task(id) { const r = this._row("tasks", "id", id); return r ? JSON.parse(r.json) : null; }
  createTask(t) { this._create("tasks", "id", t.id, t); }
  putTask(t) { this._put("tasks", "id", t.id, t); }

  /* ── Sandbox ── */
  sandboxes() { return this._list("sandboxes").sort((a, b) => (a.id < b.id ? -1 : 1)); }
  sandbox(id) { const r = this._row("sandboxes", "id", id); return r ? JSON.parse(r.json) : null; }
  putSandbox(x) { this._put("sandboxes", "id", x.id, x); }
  deleteSandbox(id) { this._delete("sandboxes", "id", id); }

  /* ── Ops（SPEC §4.3 三段式）── */
  ops() { return this._list("ops").sort((a, b) => (a.opId < b.opId ? 1 : -1)); }
  op(opId) { const r = this._row("ops", "op_id", opId); return r ? JSON.parse(r.json) : null; }
  createOp(o) { this._create("ops", "op_id", o.opId, o); }
  putOp(o) { this._put("ops", "op_id", o.opId, o); }

  /* ── Events（§8.1 信封）── */
  pushEvent(e) {
    const row = { ts: nowIso(), kind: e.kind || "policy", type: e.type, severity: e.severity || "info",
      source: e.source || "axon", subject: e.subject || "", msg: e.msg, refs: JSON.stringify(e.refs || []) };
    const r = this.db.prepare(
      `INSERT INTO events (ts, kind, type, severity, source, subject, msg, refs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.ts, row.kind, row.type, row.severity, row.source, row.subject, row.msg, row.refs);
    return { seq: Number(r.lastInsertRowid), ...row, refs: e.refs || [] };
  }
  events({ kind, subject, type, limit } = {}) {
    let sql = "SELECT * FROM events WHERE 1=1"; const args = [];
    if (kind) { sql += " AND kind = ?"; args.push(kind); }
    if (subject) { sql += " AND subject = ?"; args.push(subject); }
    if (type) { sql += " AND type = ?"; args.push(type); }
    sql += " ORDER BY seq DESC LIMIT ?"; args.push(limit || 50);
    return this.db.prepare(sql).all(...args).map(r => ({ ...r, refs: JSON.parse(r.refs || "[]") }));
  }

  /* ── Idempotency（§9.2）── */
  saveIdempotent(key, requestHash, response) {
    this.db.prepare("INSERT OR REPLACE INTO idempotency (key, request_hash, response, created_at) VALUES (?, ?, ?, ?)")
      .run(key, requestHash, JSON.stringify(response), nowIso());
  }
  findIdempotent(key, requestHash) {
    const r = this.db.prepare("SELECT * FROM idempotency WHERE key = ?").get(key);
    if (!r) return null;
    if (r.request_hash !== requestHash) return { conflict: true };
    return { conflict: false, response: JSON.parse(r.response) };
  }

  /* ── 持久化序列：原子分配，允许失败/崩溃后出现空号，禁止复用 ── */
  _initializeSequences() {
    for (const [name, table, col, pattern, floor] of [
      ["task", "tasks", "id", /^T\d+-(\d+)$/, 742],
      ["op", "ops", "op_id", /^OP-(\d+)$/, 4822],
    ]) {
      let next = floor;
      for (const row of this.db.prepare(`SELECT ${col} AS id FROM ${table}`).all()) {
        const match = pattern.exec(row.id);
        if (match) {
          const n = Number(match[1]);
          if (!Number.isSafeInteger(n + 1)) throw new Error(`历史编号超出安全整数范围：${row.id}`);
          next = Math.max(next, n + 1);
        }
      }
      this.db.prepare(`INSERT INTO sequences (name, next_value) VALUES (?, ?)
        ON CONFLICT(name) DO UPDATE SET next_value = MAX(sequences.next_value, excluded.next_value)`).run(name, next);
    }
  }
  _nextSeq(name) {
    const row = this.db.prepare(`UPDATE sequences SET next_value = next_value + 1
      WHERE name = ? AND next_value < 9007199254740991 RETURNING next_value - 1 AS value`).get(name);
    if (!row) throw new Error(`序列 ${name} 缺失或已耗尽`);
    return row.value;
  }
  nextTaskSeq() { return this._nextSeq("task"); }
  nextOpSeq() { return this._nextSeq("op"); }

  /* ── 播种只用于全新空库；结构迁移独立于演示种子版本 ── */
  seedIfEmpty() {
    return this.transaction(() => {
      if (this.getMeta("seeded") !== null || this.getMeta("seedVersion") !== null) return false;
      // 缺少 meta 的历史库/部分导入库也不能当空库覆盖。
      if (DATA_TABLES.some(t => this.db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get())) return false;
      const w = seedWorld();
      w.servers.forEach(x => this.putObject("server", x));
      w.racks.forEach(x => this.putObject("rack", x));
      w.netDevices.forEach(x => this.putObject("netdevice", x));
      w.netLinks.forEach((x, i) => this.putObject("netlink", { id: `link-${i + 1}`, ...x }));
      w.infra.forEach(x => this.putObject("infra", x));
      w.models.forEach(x => this.putObject("model", x));
      w.tools.forEach(x => this.putObject("tool", x));
      w.routes.forEach(x => this.putObject("route", x));
      w.tenants.forEach(x => this.putObject("tenant", x));
      w.agents.forEach(a => this.putAgent(a));
      w.tasks.forEach(t => this.createTask({ ...t, createdAt: nowIso() }));
      w.sandboxes.forEach(x => this.putSandbox(x));
      w.events.forEach(e => this.pushEvent(e));
      this.setMeta("seeded", nowIso());
      this.setMeta("seedVersion", SEED_VERSION);
      this.setMeta("version", "0.95.0");
      this._initializeSequences();
      return true;
    });
  }

  reset() {
    this.db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = this.file + suffix;
      if (existsSync(f)) rmSync(f);
    }
  }
}

export function storeInProjectDir() {
  return join(process.cwd(), "data", "axon.db");
}
