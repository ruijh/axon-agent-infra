/* ═══════════════════════════════════════════════════════════
   AXON · 控制平面入口
   node server/index.mjs [--port 8437] [--reset] [--data path]
   一个进程同时提供：静态演示 UI + /api/v1 REST + SSE + OpenAPI
   ═══════════════════════════════════════════════════════════ */
import http from "node:http";
import { readFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { SseHub } from "./sse.mjs";
import { createApi } from "./api.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));   // 项目根（index.html 所在）

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".md": "text/markdown; charset=utf-8", ".map": "application/json",
};

export async function startServer({ port = 8437, dataFile } = {}) {
  const store = new Store(dataFile ?? join(ROOT, "data", "axon.db"));
  store.seedIfEmpty();
  const sse = new SseHub();
  const handle = createApi({ store, sse });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      const body = await readBody(req);
      const handled = await handle(req, res, pathname, url.searchParams, body);
      if (handled) return;
    }
    serveStatic(req, res, pathname);
  });

  server.listen(port);
  await new Promise(r => server.once("listening", r));
  const addr = server.address();
  return { server, store, sse, port: addr.port, close() { sse.close(); store.db.close(); server.close(); } };
}

function readBody(req) {
  return new Promise((resolveBody) => {
    if (req.method === "GET" || req.method === "HEAD") return resolveBody(null);
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > 1e6) { req.destroy(); return resolveBody(null); } chunks.push(c); });
    req.on("end", () => {
      if (!chunks.length) return resolveBody(null);
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
      catch { resolveBody(undefined); }   // 非 JSON → 交给路由按缺失处理
    });
    req.on("error", () => resolveBody(null));
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT + sep) && file !== ROOT) {   // 防路径穿越
    res.writeHead(403); return res.end("Forbidden");
  }
  try {
    const buf = readFileSync(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 · " + pathname);
  }
}

/* ── CLI 直跑 ── */
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const port = Number(flag("port") || 8437);
  const dataFile = flag("data") ? resolve(flag("data")) : undefined;
  if (args.includes("--reset") && dataFile === undefined) {
    const { rmSync, existsSync } = await import("node:fs");
    for (const s of ["", "-wal", "-shm"]) { const f = join(ROOT, "data", "axon.db" + s); if (existsSync(f)) rmSync(f); }
    console.log("[axon] 已重置数据，下次启动重新播种");
  }
  const { server, store } = await startServer({ port, dataFile });
  console.log(`[axon] 控制平面已启动  http://127.0.0.1:${port}/`);
  console.log(`[axon] API 文档         http://127.0.0.1:${port}/api/v1/docs`);
  console.log(`[axon] 数据             ${store.file}`);
  if (store.listKeys().some(k => !k.revoked)) {
    console.log("[axon] 已初始化 · 如需新密钥：node cli.mjs keys create <name> <role>");
  } else {
    console.log("[axon] 未初始化 · 请运行：node cli.mjs setup   （或 POST /api/v1/setup）");
  }
}
