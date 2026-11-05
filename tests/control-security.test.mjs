import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server/index.mjs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fixture(file = ":memory:") {
  const s = await startServer({ port: 0, dataFile: file });
  let token = "";
  const call = async (method, path, body, key = token, extra = {}) => {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/v1${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: "Bearer " + key } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: await r.json(), headers: r.headers };
  };
  if (!s.store.getMeta("initialized"))
    token = (await call("POST", "/setup", { adminName: "admin" })).json.token;
  return {
    s,
    call,
    get token() {
      return token;
    },
    set token(t) {
      token = t;
    },
  };
}
test("bootstrap remains closed after every key is revoked and never caches secrets", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.call("POST", "/setup", {}, "", { "Idempotency-Key": "setup" }))
        .status,
      400,
    );
    assert.equal(
      (
        await f.call("POST", "/keys", { role: "agent" }, f.token, {
          "Idempotency-Key": "key",
        })
      ).status,
      400,
    );
    for (const k of f.s.store.listKeys()) f.s.store.revokeKey(k.id);
    assert.equal(
      (await f.call("GET", "/meta", undefined, "")).json.setupRequired,
      false,
    );
    assert.equal((await f.call("POST", "/setup", {}, "")).status, 409);
  } finally {
    f.s.close();
  }
});
test("key and sandbox collisions reject overwrites, preserving revocation and existing ownership", async () => {
  const f = await fixture();
  try {
    const old = f.s.store.listKeys()[0];
    f.s.store.revokeKey(old.id);
    assert.throws(
      () => f.s.store.saveKey({ ...old, hash: "replacement", role: "agent" }),
      /冲突/,
    );
    assert.equal(
      f.s.store.findKeyByHash(
        createHash("sha256").update(f.token).digest("hex"),
      ),
      null,
    );
    f.s.store.createSandbox({ id: "sbx-fixed", ownerTask: "protected" });
    assert.throws(
      () => f.s.store.createSandbox({ id: "sbx-fixed", ownerTask: null }),
      /拒绝覆盖/,
    );
    assert.equal(f.s.store.sandbox("sbx-fixed").ownerTask, "protected");
  } finally {
    f.s.close();
  }
});
test("machine keys are bound to an Agent and tenant on every machine endpoint", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.call("POST", "/keys", { name: "bad", role: "agent" })).status,
      400,
    );
    const key = (
      await f.call("POST", "/keys", {
        name: "worker",
        role: "agent",
        agentId: "ag-ops",
        tenantId: "platform",
      })
    ).json.token;
    assert.equal(
      (
        await f.call(
          "POST",
          "/agents/register",
          { id: "ag-cs", name: "impersonate" },
          key,
        )
      ).status,
      403,
    );
    assert.equal(
      (await f.call("POST", "/agents/ag-risk/heartbeat", {}, key)).status,
      403,
    );
    assert.equal(
      (await f.call("PATCH", "/tasks/T26-0712", { progress: 99 }, key)).status,
      403,
    );
    assert.equal(
      (
        await f.call(
          "POST",
          "/tasks/T26-0712/result",
          { status: "succeeded" },
          key,
        )
      ).status,
      403,
    );
    assert.equal((await f.call("GET", "/tasks", undefined, key)).status, 403);
    assert.equal(
      (await f.call("GET", "/agents/ag-ops/tasks", undefined, key)).status,
      200,
    );
    assert.equal(
      (await f.call("POST", "/agents/ag-ops/heartbeat", {}, key)).status,
      200,
    );
  } finally {
    f.s.close();
  }
});
test("bad schema and wrong-kind references cannot alter directory or quotas", async () => {
  const f = await fixture();
  try {
    const before = f.s.store.tenant("platform");
    for (const body of [
      { tenant: "srv-cpu-01" },
      { tenant: "platform", leaseMin: -1 },
    ])
      assert.equal(
        (await f.call("POST", "/sandboxes", body)).status,
        body.leaseMin === -1 ? 400 : 404,
      );
    assert.equal(f.s.store.servers.length, 18);
    assert.equal(
      (
        await f.call("POST", "/agents/register", {
          id: "ag-poison",
          name: "poison",
          models: "ep-glm",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("POST", "/agents/register", {
          id: "<b>agent</b>",
          name: "markup",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await f.call("POST", "/tasks/T26-0712/result", {
          status: "succeeded",
          tokensM: -10,
        })
      ).status,
      400,
    );
    assert.deepEqual(f.s.store.tenant("platform"), before);
    assert.equal((await f.call("GET", "/impact/srv-cpu-01")).status, 200);
  } finally {
    f.s.close();
  }
});
test("human resolution needs evidence; approve requires waiting state and records actual principal", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await f.call("POST", "/tasks/T26-0677/result", { status: "succeeded" }))
        .status,
      409,
    );
    assert.equal(
      (await f.call("POST", "/tasks/T26-0677/resolve", { status: "succeeded" }))
        .status,
      400,
    );
    const r = await f.call("POST", "/tasks/T26-0677/resolve", {
      status: "succeeded",
      evidence: "ERP query #42",
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.resolution.name, "admin");
    assert.equal(
      (await f.call("POST", "/tasks/T26-0741/approve", {})).status,
      409,
    );
    assert.equal(
      (
        await f.call("POST", "/tasks/T26-0731/approve", {
          approvedBy: "forged",
        })
      ).json.approvedBy,
      "admin",
    );
  } finally {
    f.s.close();
  }
});
test("fast task completion cannot retroactively invalidate its claim receipt", async () => {
  const f = await fixture();
  try {
    const t = (
      await f.call("POST", "/tasks", { name: "quick", agent: "ag-cs" })
    ).json;
    const c = await f.call("POST", `/tasks/${t.id}/claim`, { agent: "ag-cs" });
    assert.equal(
      (await f.call("POST", `/tasks/${t.id}/result`, { status: "succeeded" }))
        .status,
      200,
    );
    await wait(600);
    assert.equal(f.s.store.op(c.json.opId).status, "verified");
    assert.equal(f.s.store.op(c.json.opId).actor.name, "admin");
  } finally {
    f.s.close();
  }
});
test("execution rechecks maintenance preconditions; draining prevents new work", async () => {
  const f = await fixture();
  try {
    const op = (
      await f.call("POST", "/ops", {
        action: "maintenance.begin",
        params: { serverId: "srv-kbd-01" },
      })
    ).json;
    assert.equal(
      (
        await f.call("POST", "/tasks", {
          name: "race",
          agent: "ag-coder",
          interruptible: false,
        })
      ).status,
      201,
    );
    await wait(1000);
    assert.equal(f.s.store.op(op.opId).status, "failed");
    assert.notEqual(f.s.store.object("srv-kbd-01").state, "maint");
    await f.call("POST", "/ops", {
      action: "agent.drain",
      params: { agentId: "ag-cs" },
    });
    await wait(1000);
    assert.equal(
      (await f.call("POST", "/tasks", { name: "blocked", agent: "ag-cs" }))
        .status,
      409,
    );
  } finally {
    f.s.close();
  }
});
test("pending execution, verification and task recovery resume from durable checkpoints", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axon-recover-"));
  let f = await fixture(join(dir, "db"));
  const token = f.token;
  try {
    const op = (
      await f.call("POST", "/ops", {
        action: "agent.drain",
        params: { agentId: "ag-cs" },
      })
    ).json;
    await f.call("POST", "/tasks/T26-0719/restore", {});
    f.s.close();
    f = await fixture(join(dir, "db"));
    f.token = token;
    await wait(2400);
    assert.equal(f.s.store.op(op.opId).status, "verified");
    assert.equal(f.s.store.task("T26-0719").state, "running");
    const op2 = (
      await f.call("POST", "/ops", {
        action: "agent.drain",
        params: { agentId: "ag-coder" },
      })
    ).json;
    await wait(900);
    assert.equal(f.s.store.op(op2.opId).status, "executed");
    f.s.close();
    f = await fixture(join(dir, "db"));
    await wait(1500);
    assert.equal(f.s.store.op(op2.opId).status, "verified");
  } finally {
    f.s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("revoked SSE sessions terminate immediately", async () => {
  const f = await fixture();
  const abort = new AbortController();
  try {
    const k = (
      await f.call("POST", "/keys", { name: "viewer", role: "biz-owner" })
    ).json;
    const response = await fetch(
      `http://127.0.0.1:${f.s.port}/api/v1/events/stream`,
      { headers: { Authorization: "Bearer " + k.token }, signal: abort.signal },
    );
    const reader = response.body.getReader();
    await reader.read();
    assert.equal(
      (await f.call("POST", `/keys/${k.keyId}/revoke`, {})).status,
      200,
    );
    assert.equal((await reader.read()).done, true);
    assert.equal(f.s.sse.clients.size, 0);
  } finally {
    abort.abort();
    f.s.close();
  }
});
test("transaction failure rolls back sandbox quota, event journal and idempotency response", async () => {
  const f = await fixture();
  try {
    const before = f.s.store.tenant("platform"),
      count = f.s.store.sandboxes().length;
    const save = f.s.store.saveIdempotent;
    f.s.store.saveIdempotent = () => {
      throw Error("injected storage failure");
    };
    const r = await f.call(
      "POST",
      "/sandboxes",
      { tenant: "platform" },
      f.token,
      { "Idempotency-Key": "failure" },
    );
    assert.equal(r.status, 500);
    assert.equal(f.s.store.sandboxes().length, count);
    assert.deepEqual(f.s.store.tenant("platform"), before);
    f.s.store.saveIdempotent = save;
    assert.equal(
      (
        await f.call("POST", "/sandboxes", { tenant: "platform" }, f.token, {
          "Idempotency-Key": "failure",
        })
      ).status,
      201,
    );
  } finally {
    f.s.close();
  }
});
test("idempotency cache is scoped to the authenticated principal", async () => {
  const f = await fixture();
  try {
    const other = (
      await f.call("POST", "/keys", { name: "owner", role: "agent-owner" })
    ).json.token;
    const body = { name: "same request", agent: "ag-cs" },
      headers = { "Idempotency-Key": "shared" };
    const a = await f.call("POST", "/tasks", body, f.token, headers),
      b = await f.call("POST", "/tasks", body, other, headers);
    assert.notEqual(a.json.id, b.json.id);
    assert.equal(
      (await f.call("POST", "/tasks", body, other, headers)).json.id,
      b.json.id,
    );
  } finally {
    f.s.close();
  }
});
test("SSE resumes committed events after a reconnect cursor", async () => {
  const f = await fixture(),
    abort = new AbortController();
  try {
    const cursor = f.s.store.lastFrame();
    const t = (
      await f.call("POST", "/tasks", { name: "offline event", agent: "ag-cs" })
    ).json;
    const r = await fetch(`http://127.0.0.1:${f.s.port}/api/v1/events/stream`, {
      headers: {
        Authorization: "Bearer " + f.token,
        "Last-Event-ID": String(cursor),
      },
      signal: abort.signal,
    });
    const reader = r.body.getReader();
    let data = "";
    while (!data.includes(t.id)) {
      const { value, done } = await reader.read();
      if (done) break;
      data += new TextDecoder().decode(value);
    }
    assert.match(data, /id: \d+/);
    assert.ok(data.includes(t.id));
  } finally {
    abort.abort();
    f.s.close();
  }
});
test("a real killed process resumes accepted work without losing its checkpoint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "axon-kill-"));
  let child;
  const boot = () =>
    new Promise((resolve, reject) => {
      child = spawn(
        process.execPath,
        ["server/index.mjs", "--port", "0", "--data", join(dir, "db")],
        {
          cwd: new URL("..", import.meta.url),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let output = "";
      child.stdout.on("data", (b) => {
        output += b;
        const m = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (m) resolve("http://127.0.0.1:" + m[1]);
      });
      child.on("error", reject);
    });
  const kill = async () => {
    if (child && child.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill();
      await exited;
    }
  };
  try {
    let base = await boot();
    const call = async (path, body, token) => {
      const r = await fetch(base + "/api/v1" + path, {
        method: body ? "POST" : "GET",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return r.json();
    };
    const token = (await call("/setup", { adminName: "crash-test" })).token;
    const op = await call(
      "/ops",
      { action: "agent.drain", params: { agentId: "ag-cs" } },
      token,
    );
    await kill();
    base = await boot();
    await wait(2300);
    assert.equal(
      (await call("/ops/" + op.opId, undefined, token)).status,
      "verified",
    );
  } finally {
    await kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
