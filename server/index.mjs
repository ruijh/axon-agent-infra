import { startExecutor } from "./ops.mjs";
/* ═══════════════════════════════════════════════════════════
   AXON · 控制平面入口
   node server/index.mjs [--host 127.0.0.1] [--port 8437] [--reset] [--data path]
   一个进程同时提供：静态演示 UI + /api/v1 REST + SSE + OpenAPI
   ═══════════════════════════════════════════════════════════ */
import http from "node:http";
import { readFileSync, realpathSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { SseHub } from "./sse.mjs";
import { createApi } from "./api.mjs";
import { ApiError } from "./util.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url))); // 项目根（index.html 所在）
const REAL_ROOT = realpathSync(ROOT);
const PUBLIC_ASSETS = new Set(
  JSON.parse(
    readFileSync(new URL("./public-assets.json", import.meta.url), "utf8"),
  ),
);
const MAX_BODY_BYTES = 1_000_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".map": "application/json",
  ".glb": "model/gltf-binary",
};

export async function startServer({
  port = 8437,
  host = "127.0.0.1",
  dataFile,
} = {}) {
  const store = new Store(dataFile ?? join(ROOT, "data", "axon.db"));
  try {
    store.seedIfEmpty();
  } catch (e) {
    store.db.close();
    throw e;
  }
  const sse = new SseHub(store);
  const handle = createApi({ store, sse });

  const server = http.createServer(async (req, res) => {
    try {
      // Host 是客户端输入；本服务只接受 origin-form 请求路径。
      if (
        !req.url?.startsWith("/") ||
        req.url.startsWith("//") ||
        req.url.includes("\\")
      ) {
        throw new ApiError(400, "BAD_REQUEST", "无效的请求路径");
      }
      const url = new URL(req.url, "http://localhost");
      let decodedPath;
      try {
        decodedPath = decodeURIComponent(url.pathname);
      } catch {
        throw new ApiError(400, "BAD_REQUEST", "请求路径编码无效");
      }
      if (/[\\\u0000-\u001f\u007f]/.test(decodedPath)) {
        throw new ApiError(400, "BAD_REQUEST", "请求路径含非法字符");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (url.pathname.startsWith("/api/")) {
        const body = await readBody(req);
        if (await handle(req, res, url.pathname, url.searchParams, body))
          return;
      }
      serveStatic(req, res, decodedPath);
    } catch (e) {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const known = e instanceof ApiError;
      if (!known) console.error("[http] 未预期错误:", e);
      const payload = JSON.stringify({
        error: {
          code: known ? e.code : "INTERNAL",
          message: known ? e.message : "服务器内部错误",
        },
      });
      res.writeHead(known ? e.status : 500, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(payload);
    }
  });

  try {
    await new Promise((ready, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        ready();
      });
    });
  } catch (e) {
    sse.close();
    store.db.close();
    throw e;
  }
  const stopExecutor = startExecutor({ store, sse });
  const addr = server.address();
  return {
    server,
    store,
    sse,
    port: addr.port,
    close() {
      stopExecutor();
      sse.close();
      store.db.close();
      server.close();
    },
  };
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    if (req.method === "GET" || req.method === "HEAD") return resolveBody(null);
    let size = 0;
    const chunks = [];
    let failed = false;
    const fail = (error) => {
      failed = true;
      chunks.length = 0;
      reject(error);
    };
    req.on("data", (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY_BYTES)
        return fail(
          new ApiError(413, "PAYLOAD_TOO_LARGE", "请求体不能超过 1 MB"),
        );
      chunks.push(c);
    });
    req.on("end", () => {
      if (failed) return;
      if (!chunks.length) return resolveBody({});
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        return fail(new ApiError(400, "BAD_REQUEST", "请求体不是有效 JSON"));
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return fail(new ApiError(400, "BAD_REQUEST", "请求体必须是 JSON 对象"));
      }
      resolveBody(body);
    });
    req.on("aborted", () =>
      fail(new ApiError(400, "BAD_REQUEST", "请求传输中断")),
    );
    req.on("error", () =>
      fail(new ApiError(400, "BAD_REQUEST", "请求读取失败")),
    );
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!PUBLIC_ASSETS.has(rel)) {
    res.writeHead(404);
    return res.end("Not Found");
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end("Method Not Allowed");
  }
  try {
    const file = realpathSync(join(ROOT, rel));
    // 白名单中的文件也不能通过符号链接或目录联接指向其他文件。
    if (file !== join(REAL_ROOT, rel)) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    const buf = readFileSync(file);
    res.writeHead(200, {
      "Content-Type":
        MIME[extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": buf.length,
      "Cache-Control": "no-cache",
    });
    res.end(req.method === "HEAD" ? undefined : buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 · " + pathname);
  }
}

/* ── CLI 直跑 ── */
const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const port = Number(flag("port") || 8437);
  const dataFile = flag("data") ? resolve(flag("data")) : undefined;
  if (args.includes("--reset") && dataFile === undefined) {
    const { rmSync, existsSync } = await import("node:fs");
    for (const s of ["", "-wal", "-shm"]) {
      const f = join(ROOT, "data", "axon.db" + s);
      if (existsSync(f)) rmSync(f);
    }
    console.log("[axon] 已重置数据，下次启动重新播种");
  }
  const host = flag("host") || "127.0.0.1";
  const { store, port: boundPort } = await startServer({
    port,
    host,
    dataFile,
  });
  const displayHost = host.includes(":") ? `[${host}]` : host;
  console.log(`[axon] 控制平面已启动  http://${displayHost}:${boundPort}/`);
  console.log(
    `[axon] API 文档         http://${displayHost}:${boundPort}/api/v1/docs`,
  );
  console.log(`[axon] 数据             ${store.file}`);
  if (store.listKeys().some((k) => !k.revoked)) {
    console.log(
      "[axon] 已初始化 · 如需新密钥：node cli.mjs keys create <name> <role>",
    );
  } else {
    console.log(
      "[axon] 未初始化 · 请运行：node cli.mjs setup   （或 POST /api/v1/setup）",
    );
  }
}
