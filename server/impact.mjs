/* ═══════════════════════════════════════════════════════════
   AXON · 影响分析（SPEC §3.3）
   依赖方向 task → agent → infra/model/tool → server，
   「对象的影响面」= 沿边反向可达集合，返回分层统计。
   各开源对标项目均缺失此能力（§10），AXON 差异化点。
   ═══════════════════════════════════════════════════════════ */

/** 由目录对象推导边集合（host / mount / dep / own / link） */
export function buildEdges(store) {
  const edges = [];
  for (const f of store.infra) edges.push({ from: f.id, to: f.host, kind: "host", source: "declared" });
  for (const m of store.models) edges.push({ from: m.id, to: m.via || "gw-model", kind: "mount", source: "declared" });
  for (const t of store.tools) edges.push({ from: t.id, to: "gw-mcp", kind: "mount", source: "declared" });
  for (const a of store.agents()) {
    edges.push({ from: a.id, to: a.runtime, kind: "dep", source: "declared" });
    (a.models || []).forEach(m => edges.push({ from: a.id, to: m, kind: "dep", source: "declared" }));
    (a.tools || []).forEach(t => edges.push({ from: a.id, to: t, kind: "dep", source: "declared" }));
    (a.stores || []).forEach(s => edges.push({ from: a.id, to: s, kind: "dep", source: "declared" }));
  }
  // 遥测推断的调用关系（§3.1：与显式声明区分标注）
  edges.push({ from: "ag-ops", to: "tl-kb", kind: "dep", source: "inferred", expiresAt: "+7d" });
  edges.push({ from: "ag-bi", to: "tl-ticket", kind: "dep", source: "inferred", expiresAt: "+7d" });
  for (const t of store.tasks()) {
    if (t.state !== "succeeded") edges.push({ from: t.id, to: t.agent, kind: "own", source: "declared" });
  }
  return edges;
}

const layerOf = (id) => {
  if (id.startsWith("srv-") || id.startsWith("sw-")) return "servers";
  if (id.startsWith("rt-") || id.startsWith("sb-") || id.startsWith("sbx-") ||
      id.startsWith("gw-") || id.startsWith("st-") || id.startsWith("svc-")) return "infra";
  if (id.startsWith("ep-") || id.startsWith("tl-")) return "catalog";
  if (id.startsWith("ag-")) return "agents";
  if (/^T\d/.test(id)) return "tasks";
  return "other";
};

/** 反向可达集合 + 分层统计（含不可中断任务数） */
export function impactAnalysis(store, rootId) {
  const edges = buildEdges(store);
  const rev = new Map();
  for (const e of edges) {
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to).push(e);
  }
  const seen = new Set([rootId]);
  const reachedEdges = [];
  const q = [rootId];
  while (q.length) {
    for (const e of rev.get(q.shift()) || []) {
      if (!seen.has(e.from)) { seen.add(e.from); reachedEdges.push(e); q.push(e.from); }
    }
  }
  seen.delete(rootId);

  const layers = { servers: [], infra: [], catalog: [], agents: [], tasks: [], other: [] };
  seen.forEach(id => layers[layerOf(id)].push(id));
  layers.all = [...seen];
  layers.tasks.sort();

  const taskObjs = layers.tasks.map(id => store.task(id)).filter(Boolean);
  const stats = {
    infraCount: layers.infra.length,
    catalogCount: layers.catalog.length,
    agentCount: layers.agents.length,
    inFlightTasks: taskObjs.filter(t => !["succeeded", "failed", "cancelled"].includes(t.state)).length,
    uninterruptibleTasks: taskObjs.filter(t => t.interruptible === false &&
      !["succeeded", "failed", "cancelled"].includes(t.state) && t.state !== "checkpointed").length,
  };
  return { root: rootId, layers, stats, edges: reachedEdges.map(e => ({ from: e.from, to: e.to, kind: e.kind, source: e.source })) };
}
