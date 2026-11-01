/* ═══════════════════════════════════════════════════════════
   AXON · 物理网络拓扑（服务器管理 · 子页）
   核心 / Spine ─ 接入 ToR ─ 服务器 + 带外管理网
   链路实时利用率 · 流量粒子 · 端口映射表
   ═══════════════════════════════════════════════════════════ */

(function () {
  const canvas = $("#net-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const TYPE_COLOR = {
    "业务": [55, 226, 255],
    "上行": [111, 155, 255],
    "带外": [177, 140, 255],
  };
  const NODE_COLOR = { server: "#6f9bff", core: "#ff9350", tor: "#ff9350", bmc: "#b18cff" };
  const GLYPH = { server: "▤", core: "◈", tor: "⇄", bmc: "◍" };

  const nodes = [], nodeMap = new Map(), links = AXON_DATA.netLinks;
  AXON_DATA.netDevices.forEach(n => {
    const node = { id: n.id, kind: n.kind === "bmc" ? "bmc" : n.kind, ref: n, row: n.kind === "core" ? 0 : 1, w: 118, h: 36 };
    nodes.push(node); nodeMap.set(n.id, node);
  });
  AXON_DATA.servers.forEach(s => {
    const node = { id: s.id, kind: "server", ref: s, row: 2, w: 86, h: 40 };
    nodes.push(node); nodeMap.set(s.id, node);
  });

  let W = 0, H = 0, hoverId = null, selId = null, mouse = { x: -1, y: -1 };
  let particles = [];

  /* 按机柜分组的数据驱动布局：核心层 / 接入层（ToR + 带外）/ 服务器 2×N */
  const ROW_Y = [52, 138, 232, 306];
  const RACK_TOR = { R02: "sw-tor-kbb", R03: "sw-tor-kbd", R04: "sw-tor-gpu", R05: "sw-tor-svc", R06: "sw-tor-aud" };
  const RACK_LABEL = { R02: "R02 · 业务知识库", R03: "R03 · 研发知识库", R04: "R04 · GPU 柜", R05: "R05 · 通用 / 存储", R06: "R06 · 审计存证" };
  const ZONE_COLORS = ["61,226,255", "61,226,255", "111,155,255", "177,140,255", "255,179,64"];
  let zones = [];

  function layout() {
    const rackIds = Object.keys(RACK_TOR);
    const L = 26, R = W - 150;
    const bandW = Math.max(120, (R - L) / rackIds.length);
    zones = [{ label: "R01 · 网络柜（核心）", x0: 0.24, x1: 0.76, y0: 16, y1: 84, color: "255,147,80" }];
    rackIds.forEach((rid, i) => {
      const x0 = L + bandW * i, x1 = L + bandW * (i + 1);
      const tor = nodeMap.get(RACK_TOR[rid]);
      if (tor) { tor.x = (x0 + x1) / 2; tor.y = ROW_Y[1]; }
      const srvs = AXON_DATA.servers.filter(s => s.location.rack === rid);
      const cols = srvs.length > 2 ? 2 : 1;
      srvs.forEach((s, j) => {
        const n = nodeMap.get(s.id);
        if (!n) return;
        const col = Math.floor(j / 2), row = j % 2;
        n.x = cols === 1 ? (x0 + x1) / 2 : x0 + bandW * (col + 0.5) / cols;
        n.y = ROW_Y[2] + row * (ROW_Y[3] - ROW_Y[2]);
      });
      zones.push({ label: RACK_LABEL[rid], x0: (x0 - 6) / W, x1: (x1 + 6) / W, y0: 106, y1: 350, color: ZONE_COLORS[i] });
    });
    ["sw-core-01", "sw-core-02"].forEach((id, i) => {
      const n = nodeMap.get(id);
      if (n) { n.x = 70 + (W - 140) * (i === 0 ? 0.32 : 0.68); n.y = ROW_Y[0]; }
    });
    const bmc = nodeMap.get("sw-bmc");
    if (bmc) { bmc.x = W - 78; bmc.y = ROW_Y[1]; }
  }

  function resize() {
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    W = r.width; H = r.height;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layout();
  }

  const related = (id) => {
    const s = new Set([id]);
    links.forEach(l => { if (l.from === id) s.add(l.to); if (l.to === id) s.add(l.from); });
    return s;
  };

  function hitTest(x, y) {
    for (const n of nodes) {
      if (x >= n.x - n.w / 2 - 3 && x <= n.x + n.w / 2 + 3 && y >= n.y - n.h / 2 - 3 && y <= n.y + n.h / 2 + 3) return n.id;
    }
    return null;
  }

  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    hoverId = hitTest(mouse.x, mouse.y);
    canvas.style.cursor = hoverId ? "pointer" : "default";
    const st = $("#net-status");
    if (st) {
      const n = hoverId ? nodeMap.get(hoverId) : null;
      st.textContent = n
        ? (n.kind === "server"
          ? `${n.ref.name} · ${n.ref.location.rack} U${n.ref.location.u[0]}–${n.ref.location.u[1]} · 点击打开资产抽屉`
          : `${n.ref.name} · ${n.ref.model.split(" · ")[0]} · 管理口 ${n.ref.mgmt}`)
        : "悬停节点查看详情 · 点击服务器打开资产抽屉";
    }
  });
  canvas.addEventListener("click", () => {
    if (!hoverId) return;
    const n = nodeMap.get(hoverId);
    selId = hoverId;
    if (n.kind === "server") AXON.emit("server-detail", hoverId);
    else AXON.toast(n.ref.name, `${n.ref.model} · ${n.ref.role} · 管理口 ${n.ref.mgmt}`, "info", 3600);
  });
  canvas.addEventListener("mouseleave", () => { hoverId = null; });

  function spawnParticles() {
    const focus = hoverId || selId;
    const rel = focus ? related(focus) : null;
    links.forEach(l => {
      const lit = !rel || (rel.has(l.from) && rel.has(l.to));
      const rate = (l.util / 100) * (lit ? 0.10 : 0.02);
      if (Math.random() < rate) {
        particles.push({ l, t: 0, v: rnd(0.008, 0.016) * (0.5 + l.util / 100), dir: Math.random() < 0.5 ? 1 : -1, dim: !lit });
      }
    });
    particles = particles.filter(p => p.t < 1);
    if (particles.length > 80) particles.splice(0, particles.length - 80);
  }

  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  function drawZones() {
    ctx.save();
    zones.forEach(z => {
      const x = z.x0 * W, w = (z.x1 - z.x0) * W;
      ctx.strokeStyle = `rgba(${z.color},.28)`;
      ctx.fillStyle = `rgba(${z.color},.028)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.roundRect(x, z.y0, w, z.y1 - z.y0, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${z.color},.62)`;
      ctx.font = "9.5px Consolas,monospace";
      ctx.textAlign = "left";
      ctx.fillText(z.label, x + 10, z.y0 + 15);
    });
    ctx.restore();
  }

  function draw() {
    const focus = hoverId || selId;
    const rel = focus ? related(focus) : null;
    ctx.clearRect(0, 0, W, H);
    drawZones();

    /* 分层标题 */
    ctx.font = "10px Consolas,monospace";
    ctx.textAlign = "left";
    [["L0 · 核心层 Spine", ROW_Y[0]], ["L1 · 接入层 Leaf / 带外", ROW_Y[1]], ["L2 · 服务器（按机柜分组）", ROW_Y[2]]].forEach(([t, y]) => {
      ctx.fillStyle = "rgba(130,150,189,.55)";
      ctx.fillText(t, 14, y - 32);
    });

    /* 链路 */
    links.forEach(l => {
      const a = nodeMap.get(l.from), b = nodeMap.get(l.to);
      if (!a || !b) return;
      const lit = !rel || (rel.has(l.from) && rel.has(l.to));
      const col = TYPE_COLOR[l.type] || [120, 160, 220];
      ctx.strokeStyle = `rgba(${col},${lit ? 0.62 : 0.06})`;
      ctx.lineWidth = l.w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y + a.h / 2 * Math.sign(b.y - a.y || 1));
      ctx.lineTo(b.x, b.y - b.h / 2 * Math.sign(b.y - a.y || 1));
      ctx.stroke();
      /* 焦点链路标注带宽与利用率 */
      if (rel && lit && (rel.has(l.from) && rel.has(l.to)) && focus && (l.from === focus || l.to === focus)) {
        const mid = lerp(a, b, 0.5);
        ctx.font = "9px Consolas,monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = `rgba(${col},.95)`;
        ctx.fillText(`${l.speed} · ${Math.round(l.util)}%`, mid.x, mid.y - 5);
      }
    });

    /* 流量粒子 */
    spawnParticles();
    particles.forEach(p => {
      const a = nodeMap.get(p.l.from), b = nodeMap.get(p.l.to);
      if (!a || !b) return;
      p.t += p.v;
      const t = p.dir === 1 ? p.t : 1 - p.t;
      const pt = lerp(a, b, Math.max(0, Math.min(1, t)));
      const col = TYPE_COLOR[p.l.type] || [140, 230, 255];
      ctx.fillStyle = p.dim ? `rgba(${col},.25)` : `rgba(${col},.95)`;
      ctx.shadowColor = `rgba(${col},.8)`; ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    /* 节点 */
    nodes.forEach(n => {
      const lit = !rel || rel.has(n.id);
      const col = NODE_COLOR[n.kind] || "#8aa";
      ctx.globalAlpha = lit ? 1 : 0.18;
      ctx.fillStyle = "rgba(9,17,35,.94)";
      ctx.strokeStyle = (n.id === hoverId || n.id === selId) ? col : col + "cc";
      ctx.lineWidth = (n.id === hoverId || n.id === selId) ? 1.8 : 1.1;
      if (n.id === hoverId || n.id === selId) { ctx.shadowColor = col; ctx.shadowBlur = 12; }
      ctx.beginPath();
      ctx.roundRect(n.x - n.w / 2, n.y - n.h / 2, n.w, n.h, 5);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = col;
      ctx.fillRect(n.x - n.w / 2, n.y - n.h / 2, n.w, 2.4);

      if (n.ref.state === "warn") {
        ctx.fillStyle = "#ffb340";
        ctx.shadowColor = "#ffb340"; ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(n.x + n.w / 2 - 8, n.y - n.h / 2 + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.textAlign = "left";
      ctx.fillStyle = "rgba(216,231,255,.96)";
      ctx.font = '10.5px Consolas,"Segoe UI",monospace';
      const label = n.kind === "server" ? n.ref.id.replace("srv-", "") : n.ref.short;
      ctx.fillText((GLYPH[n.kind] || "◈") + " " + label, n.x - n.w / 2 + 8, n.y - 2);
      ctx.fillStyle = "rgba(130,150,189,.85)";
      ctx.font = "9px Consolas,monospace";
      const sub = n.kind === "server"
        ? `${n.ref.location.rack} U${n.ref.location.u[0]}` + (n.ref.location.u[1] > n.ref.location.u[0] ? `–${n.ref.location.u[1]}` : "")
        : n.ref.mgmt;
      ctx.fillText(sub, n.x - n.w / 2 + 8, n.y + 12);
      ctx.globalAlpha = 1;
    });
  }

  function loop() {
    if (AXON.view === "servers" && AXON.serversTab === "net" && !REDUCED) draw();
    else if (AXON.view === "servers" && AXON.serversTab === "net" && REDUCED) draw();
    requestAnimationFrame(loop);
  }

  /* 链路映射表 */
  function shortName(o) {
    if (!o) return "?";
    return o.short || o.name.replace(" · ", " ");
  }
  function renderNetLinks() {
    const tb = $("#net-link-tbody");
    if (!tb) return;
    tb.innerHTML = links.map(l => {
      const f = AXON_DATA.find(l.from), t = AXON_DATA.find(l.to);
      const cls = l.type === "业务" ? "info" : l.type === "上行" ? "violet" : "dim";
      return `<tr style="cursor:default">
        <td class="mono" style="color:var(--cyan);font-size:11.5px">${esc(shortName(f))}</td>
        <td class="dim" style="width:24px;text-align:center">↔</td>
        <td class="mono dim" style="font-size:11.5px">${esc(shortName(t))}</td>
        <td><span class="badge ${cls}">${esc(l.speed)}</span></td>
        <td class="dim" style="font-size:11.5px">${esc(l.vlan)}</td>
        <td class="w-meter"><div class="meter-cell"><div class="prog ${l.util > 80 ? "warn" : ""}"><i style="width:${l.util}%;background:linear-gradient(90deg,transparent,${l.type === "业务" ? "var(--cyan)" : l.type === "上行" ? "var(--steel)" : "var(--violet)"})"></i></div><span class="mv">${Math.round(l.util)}%</span></div></td>
      </tr>`;
    }).join("");
  }

  /* 图例 */
  $("#net-legend").innerHTML =
    `<span><i style="border-color:rgb(55,226,255)"></i>业务链路</span>` +
    `<span><i style="border-color:rgb(111,155,255)"></i>上行 / ECMP</span>` +
    `<span><i style="border-color:rgb(177,140,255)"></i>带外管理</span>` +
    `<span style="color:var(--cyan)">● 粒子 = 实时流量</span>`;

  /* 生命周期：子页激活时布局 + 渲染 */
  AXON.on("servers-tab-net", () => {
    resize();
    if (W) draw();           /* 后台标签页 rAF 暂停时保证至少渲染一帧 */
    renderNetLinks();
    requestAnimationFrame(() => { resize(); draw(); renderNetLinks(); });
    setTimeout(() => { resize(); draw(); }, 120);
  });
  AXON.on("tick", () => {
    if (AXON.view !== "servers" || AXON.serversTab !== "net") return;
    links.forEach(l => { l.util = clamp(l.util + rnd(-2.5, 2.6), 2, 94); });
    renderNetLinks();
  });
  new ResizeObserver(() => { if (AXON.serversTab === "net") resize(); }).observe(canvas.parentElement);
  resize();
  requestAnimationFrame(loop);
})();
