import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { startServer } from "../server/index.mjs";

test("MCP rejects malformed frames and remains available for the next request", async () => {
  const p = spawn(process.execPath, ["mcp/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  p.stdout.on("data", (b) => (output += b));
  p.stderr.resume();
  p.stdin.end(
    "null\n{invalid\n" +
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }) +
      "\n",
  );
  assert.equal(await new Promise((r) => p.on("exit", r)), 0);
  const replies = output.trim().split("\n").map(JSON.parse);
  assert.equal(replies[0].error.code, -32600);
  assert.equal(replies[1].error.code, -32700);
  assert.equal(replies[2].id, 3);
  assert.equal(replies[2].result.tools.length, 8);
});

test("actual Worker completes a task using only a bound machine credential", async () => {
  const s = await startServer({ port: 0, dataFile: ":memory:" });
  let child;
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const call = async (path, body, token) => {
      const r = await fetch(base + "/api/v1" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify(body),
      });
      assert.ok(r.ok);
      return r.json();
    };
    const token = (await call("/setup", {})).token;
    await call(
      "/agents/register",
      { id: "ag-worker-test", name: "worker test" },
      token,
    );
    const usedBefore = s.store.tenant("platform").tokenUsed;
    const task = await call(
      "/tasks",
      { agent: "ag-worker-test", name: "real worker process" },
      token,
    );
    const key = await call(
      "/keys",
      {
        name: "worker",
        role: "agent",
        agentId: "ag-worker-test",
        tenantId: "platform",
      },
      token,
    );
    child = spawn(
      process.execPath,
      [
        "worker/worker.mjs",
        "--agent",
        "ag-worker-test",
        "--once",
        "--step-ms",
        "10",
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, AXON_URL: base, AXON_API_KEY: key.token },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    const code = await Promise.race([
      new Promise((r) => child.on("exit", r)),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error("Worker timeout")), 10000);
        t.unref();
      }),
    ]);
    assert.equal(code, 0);
    assert.equal(s.store.task(task.id).state, "succeeded");
    assert.ok(
      Math.abs(s.store.tenant("platform").tokenUsed - usedBefore - 0.42) < 1e-8,
    );
  } finally {
    if (child?.exitCode === null) child.kill();
    s.close();
  }
});
