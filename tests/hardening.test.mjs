import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../server/store.mjs";
import { startServer } from "../server/index.mjs";
import { createKey } from "../server/auth.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const publicAssets = JSON.parse(readFileSync(new URL("../server/public-assets.json", import.meta.url), "utf8"));
const tables = ["objects", "agents", "tasks", "sandboxes", "ops", "events", "api_keys", "idempotency", "meta"];
const snapshot = store => Object.fromEntries(tables.map(t => [t, store.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const delay = ms => new Promise(r => setTimeout(r, ms));

function tempDir(parent = tmpdir()) {
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, "axon-hardening-"));
  return { dir, clean() {
    if (!resolve(dir).startsWith(resolve(parent) + sep)) throw new Error("cleanup outside test directory");
    rmSync(dir, { recursive: true, force: true });
  } };
}

async function boot(dataFile, python = false) {
  const child = spawn(python ? (process.env.PYTHON || "python") : process.execPath,
    python ? ["_serve.py", "--port", "0"] : ["server/index.mjs", "--port", "0", "--data", dataFile],
    { cwd: ROOT, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stderr.on("data", b => { stderr += b; });
  let timer;
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = once(child, "exit");
    child.kill();
    await ended;
  };
  try {
    const port = await new Promise((ready, reject) => {
      timer = setTimeout(() => reject(new Error(`server startup timeout: ${stderr}`)), 8000);
      child.once("error", reject);
      child.once("exit", code => reject(new Error(`server exited ${code}: ${stderr}`)));
      child.stdout.on("data", b => {
        stdout += b;
        const match = stdout.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
        if (match) ready(Number(match[1]));
      });
    });
    return { child, port, base: `http://127.0.0.1:${port}`, stop };
  } catch (e) { await stop(); throw e; }
  finally { clearTimeout(timer); }
}

function raw(port, path, { method = "GET", body, headers = {} } = {}) {
  return new Promise((ready, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, res => {
      const chunks = [];
      res.on("data", b => chunks.push(b));
      res.on("end", () => ready({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function api(server, method, path, body, token, headers = {}) {
  const r = await fetch(server.base + path, { method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

async function waitVerified(server, opId, token) {
  for (let i = 0; i < 40; i++) {
    const { json } = await api(server, "GET", `/api/v1/ops/${opId}`, undefined, token);
    if (json.status === "verified") return json;
    assert.notEqual(json.status, "failed");
    await delay(100);
  }
  assert.fail(`operation ${opId} did not verify`);
}

for (const python of [false, true]) {
  test(`${python ? "Python" : "Node"} static server exposes only runtime assets, including encoded paths`, { timeout: 20000 }, async t => {
    const fixture = tempDir(join(ROOT, "data"));
    const file = join(fixture.dir, "private.db");
    writeFileSync(join(fixture.dir, "private.json"), '{"private":"must-not-leak"}');
    if (python) writeFileSync(file, "private database fixture");
    const server = await boot(file, python);
    t.after(async () => { await server.stop(); fixture.clean(); });
    for (const asset of publicAssets) {
      const r = await raw(server.port, "/" + asset, { method: "HEAD" });
      assert.equal(r.status, 200, asset);
      assert.equal(r.text, "", asset);
      assert.ok(Number(r.headers["content-length"]) > 0, asset);
      if (asset.endsWith(".js")) assert.match(r.headers["content-type"], /javascript/);
    }
    assert.equal((await raw(server.port, "/")).status, 200);
    const privatePaths = [
      "/.git/HEAD", "/.git/config", "/%2egit/config", "/server/store.mjs",
      "/server/public-assets.json", "/README.md", "/SPEC.md", "/_serve.py", "/tests/hardening.test.mjs",
      "/tools/dc-layout.json", "/data/", `/data/${basename(fixture.dir)}/private.db`,
      `/data/${basename(fixture.dir)}/private.db-wal`, `/data/${basename(fixture.dir)}/private.json`,
      `/assets/../data/${basename(fixture.dir)}/private.json`,
      `/assets/%2e%2e/data/${basename(fixture.dir)}/private.json`,
      "/assets/core.js.bak", "/assets/core.js:secret", "/index.html/private",
    ];
    for (const path of privatePaths) assert.equal((await raw(server.port, path)).status, 404, path);
    assert.equal((await raw(server.port, "/assets/%5c..%5cserver%5cstore.mjs")).status, 400);
    const encoded = await raw(server.port, "/assets/%63ore.js");
    assert.equal(encoded.status, 200);
    assert.equal(encoded.text, readFileSync(join(ROOT, "assets/core.js"), "utf8"));
  });
}

test("malformed paths/bodies return 400/413 and the same server process stays alive", { timeout: 20000 }, async t => {
  const fixture = tempDir();
  const server = await boot(join(fixture.dir, "test.db"));
  t.after(async () => { await server.stop(); fixture.clean(); });
  const alive = async () => {
    assert.equal(server.child.exitCode, null);
    assert.equal((await raw(server.port, "/api/v1/meta")).status, 200);
  };
  for (const path of ["/api/v1/agents/%ZZ", "/api/v1/tasks/%E0%A4%A/claim", "/%", "/%00", "/assets/%FF"]) {
    const r = await raw(server.port, path);
    assert.equal(r.status, 400, path);
    assert.equal(JSON.parse(r.text).error.code, "BAD_REQUEST");
    await alive();
  }
  for (const body of ['{"broken":', "null", "[]", '"text"', "123"]) {
    const r = await raw(server.port, "/api/v1/setup", { method: "POST", body });
    assert.equal(r.status, 400, body);
    await alive();
  }
  const large = await raw(server.port, "/api/v1/setup", { method: "POST", body: JSON.stringify({ x: "x".repeat(1_000_000) }) });
  assert.equal(large.status, 413);
  assert.equal(JSON.parse(large.text).error.code, "PAYLOAD_TOO_LARGE");
  await alive();
  assert.equal((await raw(server.port, "/api/v1/meta", { headers: { Host: "[invalid" } })).status, 200);
  assert.equal((await api(server, "GET", "/api/v1/meta")).json.setupRequired, true, "invalid setup requests must not create keys");
});

test("default listener is loopback only", async () => {
  const s = await startServer({ port: 0, dataFile: ":memory:" });
  try { assert.equal(s.server.address().address, "127.0.0.1"); }
  finally { s.close(); }
});

test("process restart preserves tasks, operation history, credentials and idempotency", { timeout: 20000 }, async t => {
  const fixture = tempDir();
  const file = join(fixture.dir, "test.db");
  let server = await boot(file);
  t.after(async () => { await server.stop(); fixture.clean(); });
  const token = (await api(server, "POST", "/api/v1/setup", {})).json.token;
  const body = { name: "before restart", agent: "ag-cs" };
  const first = await api(server, "POST", "/api/v1/tasks", body, token, { "Idempotency-Key": "persist-test" });
  assert.equal(first.status, 201);
  const claim = await api(server, "POST", `/api/v1/tasks/${first.json.id}/claim`, { agent: "ag-cs" }, token);
  assert.equal(claim.status, 200);
  const oldOp = await waitVerified(server, claim.json.opId, token);
  const oldTask = (await api(server, "GET", "/api/v1/tasks", undefined, token)).json.find(x => x.id === first.json.id);
  await server.stop();
  server = await boot(file);
  const second = await api(server, "POST", "/api/v1/tasks", { ...body, name: "after restart" }, token);
  assert.equal(second.status, 201);
  assert.notEqual(second.json.id, first.json.id);
  const secondClaim = await api(server, "POST", `/api/v1/tasks/${second.json.id}/claim`, { agent: "ag-cs" }, token);
  assert.notEqual(secondClaim.json.opId, oldOp.opId);
  const tasks = (await api(server, "GET", "/api/v1/tasks", undefined, token)).json;
  assert.deepEqual(tasks.find(x => x.id === first.json.id), oldTask);
  assert.deepEqual((await api(server, "GET", `/api/v1/ops/${oldOp.opId}`, undefined, token)).json, oldOp);
  const replay = await api(server, "POST", "/api/v1/tasks", body, token, { "Idempotency-Key": "persist-test" });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.json, first.json);
});

test("v0 migration preserves every existing record and advances past legacy IDs", () => {
  const fixture = tempDir();
  const file = join(fixture.dir, "legacy.db");
  let store = new Store(file);
  try {
    store.seedIfEmpty();
    store.setMeta("seedVersion", "0.90-legacy");
    store.putObject("tenant", { ...store.tenant("platform"), tokenUsed: 73.25 });
    store.putAgent({ id: "ag-custom", caps: { state: true } });
    store.createTask({ id: "T2645-9999", state: "running", name: "preserve task" });
    store.createOp({ opId: "OP-12345", status: "verified", evidence: [{ ref: "preserve evidence" }] });
    store.deleteSandbox("sbx-8799");
    store.pushEvent({ type: "核对", msg: "preserve audit" });
    createKey(store, { name: "legacy-admin", role: "platform-admin" });
    store.saveIdempotent("legacy", "hash", { status: 201, body: { id: "T2645-9999" } });
    const before = snapshot(store);
    // 模拟旧版的真实数据库布局：无 sequences，PRAGMA user_version 默认 0。
    store.db.exec("DROP TABLE sequences; PRAGMA user_version=0;");
    store.db.close(); store = null;
    store = new Store(file);
    assert.equal(store.seedIfEmpty(), false);
    const migrated=snapshot(store);migrated.meta=migrated.meta.filter(r=>r.key!=='initialized');
    assert.deepEqual(migrated,before);assert.equal(store.getMeta('initialized'),'true');
    assert.equal(store.nextTaskSeq(), 10000);
    assert.equal(store.nextOpSeq(), 12346);
    assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 2);
  } finally { store?.db.close(); fixture.clean(); }
});

test("missing seed metadata does not overwrite a populated database", () => {
  const store = new Store(":memory:");
  try {
    store.createTask({ id: "T2645-0742", state: "running", name: "imported" });
    const before = snapshot(store);
    assert.equal(store.seedIfEmpty(), false);
    assert.deepEqual(snapshot(store), before);
    assert.equal(store.agents().length, 0, "must not inject demo agents into a partial import");
  } finally { store.db.close(); }
});

test("seed initialization rolls back completely on failure and can retry", () => {
  const store = new Store(":memory:");
  try {
    const push = store.pushEvent;
    store.pushEvent = () => { throw new Error("injected seed failure"); };
    assert.throws(() => store.seedIfEmpty(), /injected seed failure/);
    for (const rows of Object.values(snapshot(store))) assert.equal(rows.length, 0);
    store.pushEvent = push;
    assert.equal(store.seedIfEmpty(), true);
    const before = snapshot(store);
    assert.equal(store.seedIfEmpty(), false);
    assert.deepEqual(snapshot(store), before);
  } finally { store.db.close(); }
});

test("creation conflicts cannot overwrite tasks or operation evidence", () => {
  const store = new Store(":memory:");
  try {
    const task = { id: "T2645-0742", state: "running", name: "original" };
    const op = { opId: "OP-4822", status: "verified", evidence: ["original"] };
    store.createTask(task); store.createOp(op);
    assert.throws(() => store.createTask({ ...task, name: "replacement" }), { status: 409 });
    assert.throws(() => store.createOp({ ...op, evidence: [] }), { status: 409 });
    assert.deepEqual(store.task(task.id), task);
    assert.deepEqual(store.op(op.opId), op);
  } finally { store.db.close(); }
});

test("sequence reservations survive restart and remain unique across processes", { timeout: 20000 }, async () => {
  const fixture = tempDir();
  const file = join(fixture.dir, "sequence.db");
  try {
    const store = new Store(file);
    const reserved = store.nextTaskSeq();
    store.db.close();
    const moduleUrl = new URL("../server/store.mjs", import.meta.url).href;
    const allocate = () => new Promise((ready, reject) => {
      const code = `import {Store} from ${JSON.stringify(moduleUrl)}; const s=new Store(${JSON.stringify(file)}); console.log(JSON.stringify(Array.from({length:40},()=>s.nextTaskSeq()))); s.db.close();`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { windowsHide: true });
      let stdout = "", stderr = "";
      child.stdout.on("data", b => { stdout += b; });
      child.stderr.on("data", b => { stderr += b; });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? ready(JSON.parse(stdout)) : reject(new Error(stderr)));
    });
    const ids = (await Promise.all([allocate(), allocate(), allocate()])).flat();
    assert.equal(new Set(ids).size, 120);
    assert.ok(ids.every(id => id > reserved));
    const reopened = new Store(file);
    try { assert.ok(reopened.nextTaskSeq() > Math.max(...ids)); }
    finally { reopened.db.close(); }
  } finally { fixture.clean(); }
});

test("newer database schemas are rejected without resetting data", () => {
  const fixture = tempDir();
  const file = join(fixture.dir, "future.db");
  try {
    const store = new Store(file);
    store.seedIfEmpty();
    const before = snapshot(store);
    store.db.exec("PRAGMA user_version=3;");
    store.db.close();
    assert.throws(() => new Store(file), /高于程序支持/);
    const db = new DatabaseSync(file);
    try {
      assert.deepEqual(snapshot({ db }), before);
      assert.equal(db.prepare("PRAGMA user_version").get().user_version, 3);
    } finally { db.close(); }
  } finally { fixture.clean(); }
});
