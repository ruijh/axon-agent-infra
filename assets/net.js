/* ═══════════════════════════════════════════════════════════
   AXON · 物理网络拓扑（服务器管理 · 子页）
   核心 / Spine ─ 接入 ToR ─ 服务器 + 带外管理网
   链路实时利用率 · 流量粒子 · 端口映射表
   ═══════════════════════════════════════════════════════════ */

(function () {
  const canvas = $("#net-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const CV = window.AXON_CV;
  const NL = window.AXON_NET_LAYOUT;

  /* 主题调色板包装：切换主题后下一次 draw 即生效 */
  const TYPE_COLOR = () => ({
    "业务": CV.tri("accent"),
    "上行": CV.tri("steel"),
    "带外": CV.tri("violet"),
  });
  const NODE_COLOR = () => ({ server: CV.hex("l0"), core: CV.hex("l2"), tor: CV.hex("l2"), bmc: CV.hex("violet") });
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

  let W = 0, H = 0, hoverId = null, selId = null;
  let rackFilter = null, initialized = false, userFiltered = false, positions = new Map();
  const textCache = new Map();
  let particles = [];

  /* 按机柜分组的数据驱动布局：核心层 / 接入层（ToR + 带外）/ 服务器 2×N */
  const RACK_TOR = { R02: "sw-tor-kbb", R03: "sw-tor-kbd", R04: "sw-tor-gpu", R05: "sw-tor-svc", R06: "sw-tor-aud" };
  const RACK_LABEL = { R02: "R02 · 业务知识库", R03: "R03 · 研发知识库", R04: "R04 · GPU 柜", R05: "R05 · 通用 / 存储", R06: "R06 · 审计存证" };
  const ZONE_COLORS = () => [CV.tri("l1"), CV.tri("l1"), CV.tri("l0"), CV.tri("violet"), CV.tri("warn")];
  let zones = [];

  function layout() {
    const plan = NL.layout({width: canvas.parentElement.clientWidth, rackId: rackFilter,
      rackIds: Object.keys(RACK_TOR), servers: AXON_DATA.servers, netDevices: AXON_DATA.netDevices});
    W = plan.width; H = plan.height; positions = plan.positions;
    nodes.forEach(n => { n.visible = positions.has(n.id); if (n.visible) Object.assign(n, positions.get(n.id)); });
    zones = plan.zones.map(z => ({...z, label: z.rack === "R01" ? "R01 · 网络柜（核心）" : RACK_LABEL[z.rack],
      color: z.rack === "R01" ? CV.tri("l2") : ZONE_COLORS()[Object.keys(RACK_TOR).indexOf(z.rack)]}));
    textCache.clear();
  }

  function resize() {
    if (!canvas.parentElement.clientWidth) return;
    if (!initialized) {
      initialized = true;
      if (canvas.parentElement.clientWidth < 900) rackFilter = AXON.floorRack || "R04";
      renderInventory();
    }
    if (!userFiltered && canvas.parentElement.clientWidth < 900 && !rackFilter) {
      rackFilter = AXON.floorRack || "R04";
      renderInventory();
    }
    layout();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    canvas.parentElement.style.height = (H + (W > canvas.parentElement.clientWidth ? 18 : 2)) + "px";
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const related = (id) => {
    const s = new Set([id]);
    links.forEach(l => { if (l.from === id) s.add(l.to); if (l.to === id) s.add(l.from); });
    return s;
  };

  function hitTest(x, y) {
    return NL.hitTest(positions, x, y);
  }

  const uLabel = ref => { const [lo, hi] = ref.location.u; return lo === hi ? `U${lo}` : `U${lo}–${hi}`; };
  const health = ref => ref.state === "warn" ? "预警" : ref.state === "maint" ? "维护中" : "正常";
  const describe = n => `${n.ref.name} · ${n.ref.location.rack} ${uLabel(n.ref)} · ${health(n.ref)}`;
  function setStatus(id) {
    const st = $("#net-status"), n = nodeMap.get(id);
    if (st) st.textContent = n ? `${describe(n)} · 打开资产详情` : "选择机柜聚焦链路 · 点击节点或下方设备查看详情";
  }
  function openDevice(id) {
    if (!nodeMap.has(id)) return;
    selId = id; setStatus(id);
    AXON.openRackDevice(id);
  }
  function point(e) {
    const r = canvas.getBoundingClientRect();
    return {x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height};
  }

  canvas.addEventListener("mousemove", (e) => {
    const p = point(e);
    hoverId = hitTest(p.x, p.y);
    canvas.style.cursor = hoverId ? "pointer" : "default";
    setStatus(hoverId);
  });
  canvas.addEventListener("click", e => {
    const p = point(e), id = hitTest(p.x, p.y);
    if (id) openDevice(id);
    else { selId = null; setStatus(null); }
  });
  canvas.addEventListener("mouseleave", () => { hoverId = null; setStatus(selId); });

  const toolbar = el("div", "net-inventory-toolbar");
  const inventory = el("div", "net-inventory");
  canvas.parentElement.before(toolbar); canvas.parentElement.after(inventory);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "物理网络拓扑；可使用下方设备清单选择节点并打开详情");
  canvas.parentElement.setAttribute("tabindex", "0");
  canvas.parentElement.setAttribute("role", "region");
  canvas.parentElement.setAttribute("aria-label", "物理网络图，可横向滚动");
  function renderInventory() {
    toolbar.innerHTML = `<label for="net-rack-filter">机柜范围</label>
      <select class="btn" id="net-rack-filter"><option value="">全部机柜</option>${AXON_DATA.racks.map(r =>
        `<option value="${esc(r.id)}" ${rackFilter === r.id ? "selected" : ""}>${esc(r.name)} · ${esc(r.note)}</option>`).join("")}</select>
      <button class="btn ghost" id="net-open-rack" ${rackFilter ? "" : "hidden"}>查看 ${esc(rackFilter || "")} U 位</button>
      <span class="dim">${rackFilter ? "聚焦当前机柜及其网络连接" : "完整网络图可横向滚动，选择机柜可聚焦"}</span>`;
    const members = nodes.filter(n => !rackFilter || n.ref.location.rack === rackFilter)
      .sort((a,b) => a.ref.location.rack.localeCompare(b.ref.location.rack) || b.ref.location.u[0] - a.ref.location.u[0]);
    inventory.innerHTML = `<h3>设备清单 · ${members.length} 台</h3><div class="net-device-list">${members.map(n =>
      `<button type="button" class="net-device-button" data-net-device="${esc(n.id)}" aria-label="${esc(describe(n))}，打开详情">
        <span class="net-device-name">${esc(n.ref.name)}</span>
        <span class="net-device-meta">${esc(n.ref.location.rack)} · ${uLabel(n.ref)} · <span data-net-state>${health(n.ref)}</span> · ${esc(n.ref.role)}</span>
      </button>`).join("")}</div>`;
    $("#net-rack-filter").onchange = e => {
      rackFilter = e.target.value || null; userFiltered = true;
      if (rackFilter) AXON.floorRack = rackFilter;
      hoverId = selId = null; particles = []; canvas.parentElement.scrollLeft = 0;
      renderInventory(); resize(); draw(); setStatus(null);
      $("#net-rack-filter").focus();
    };
    $("#net-open-rack").onclick = () => AXON.openRack(rackFilter);
    $$("[data-net-device]", inventory).forEach(b => {
      b.onclick = () => openDevice(b.dataset.netDevice);
      b.onfocus = () => { selId = b.dataset.netDevice; setStatus(selId); };
    });
  }

  function fitted(text, width) {
    const key = `${ctx.font}|${width}|${text}`;
    if (!textCache.has(key)) textCache.set(key, NL.fitText(text, width, value => ctx.measureText(value).width));
    return textCache.get(key);
  }

  function updateInventoryStates() {
    $$("[data-net-device]", inventory).forEach(b => {
      const n = nodeMap.get(b.dataset.netDevice);
      $("[data-net-state]", b).textContent = health(n.ref);
      b.setAttribute("aria-label", `${describe(n)}，打开详情`);
    });
  }

  function spawnParticles() {
    const focus = hoverId || selId;
    const rel = focus ? related(focus) : null;
    links.forEach(l => {
      if (!positions.has(l.from) || !positions.has(l.to)) return;
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
      const x = z.x, w = z.w;
      ctx.strokeStyle = `rgba(${z.color},.28)`;
      ctx.fillStyle = `rgba(${z.color},.028)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.roundRect(x, z.y, w, z.h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${z.color},.62)`;
      ctx.font = '12px "Segoe UI","Microsoft YaHei",sans-serif';
      ctx.textAlign = "left";
      ctx.fillText(fitted(z.label, w - 20), x + 10, z.y + 17);
    });
    ctx.restore();
  }

  function draw() {
    const focus = hoverId || selId;
    const rel = focus ? related(focus) : null;
    ctx.clearRect(0, 0, W, H);
    const TC = TYPE_COLOR(), NC = NODE_COLOR();
    drawZones();

    /* 分层标题 */
    ctx.font = "10px Consolas,monospace";
    ctx.textAlign = "left";
    const headings = [["L0 · 核心层 Spine", 26], ["L1 · 接入层 Leaf / 带外", 120]];
    if (rackFilter !== "R01") headings.push(["L2 · 服务器（按机柜分组）", 264]);
    headings.forEach(([t, y]) => {
      ctx.fillStyle = CV.rgba("textDim", .55);
      ctx.fillText(t, 14, y - 8);
    });

    /* 链路 */
    links.forEach(l => {
      const a = nodeMap.get(l.from), b = nodeMap.get(l.to);
      if (!a?.visible || !b?.visible) return;
      const lit = !rel || (rel.has(l.from) && rel.has(l.to));
      const col = TC[l.type] || CV.tri("textDim");
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
    if (!REDUCED) spawnParticles();
    particles.forEach(p => {
      const a = nodeMap.get(p.l.from), b = nodeMap.get(p.l.to);
      if (!a?.visible || !b?.visible) return;
      p.t += p.v;
      const t = p.dir === 1 ? p.t : 1 - p.t;
      const pt = lerp(a, b, Math.max(0, Math.min(1, t)));
      const col = TC[p.l.type] || CV.tri("accentSoft");
      ctx.fillStyle = p.dim ? `rgba(${col},.25)` : `rgba(${col},.95)`;
      ctx.shadowColor = `rgba(${col},.8)`; ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    /* 节点 */
    nodes.forEach(n => {
      if (!n.visible) return;
      const lit = !rel || rel.has(n.id);
      const col = NC[n.kind] || CV.hex("textFaint");
      ctx.globalAlpha = lit ? 1 : 0.18;
      ctx.fillStyle = CV.rgba("node", .94);
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
        ctx.fillStyle = CV.color("warn");
        ctx.shadowColor = CV.color("warn"); ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(n.x + n.w / 2 - 8, n.y - n.h / 2 + 8, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.textAlign = "left";
      ctx.fillStyle = CV.rgba("textBright", .96);
      ctx.font = '12px Consolas,"Segoe UI",monospace';
      const label = n.kind === "server" ? n.ref.id.replace("srv-", "") : n.ref.short;
      ctx.fillText(fitted((GLYPH[n.kind] || "◈") + " " + label, n.w - 24), n.x - n.w / 2 + 8, n.y - 3);
      ctx.fillStyle = CV.rgba("textDim", .85);
      ctx.font = "11px Consolas,monospace";
      const sub = n.kind === "server"
        ? `${n.ref.location.rack} U${n.ref.location.u[0]}` + (n.ref.location.u[1] > n.ref.location.u[0] ? `–${n.ref.location.u[1]}` : "")
        : n.ref.mgmt;
      ctx.fillText(fitted(sub, n.w - 16), n.x - n.w / 2 + 8, n.y + 14);
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
    `<span><i style="border-color:var(--cyan)"></i>业务链路</span>` +
    `<span><i style="border-color:var(--l-server)"></i>上行 / ECMP</span>` +
    `<span><i style="border-color:var(--violet)"></i>带外管理</span>` +
    `<span style="color:var(--cyan)">● 粒子 = 实时流量</span>`;

  /* 主题切换：分区框颜色在 layout() 固化，需重算（下一次 draw 生效） */
  AXON.on("theme", () => { if (W) layout(); });

  /* 生命周期：子页激活时布局 + 渲染 */
  AXON.on("servers-tab-net", () => {
    if (rackFilter && AXON.floorRack && rackFilter !== AXON.floorRack) { rackFilter = AXON.floorRack; renderInventory(); }
    resize();
    if (W) draw();           /* 后台标签页 rAF 暂停时保证至少渲染一帧 */
    renderNetLinks();
    updateInventoryStates();
    requestAnimationFrame(() => { resize(); draw(); renderNetLinks(); });
    setTimeout(() => { resize(); draw(); }, 120);
  });
  AXON.on("tick", () => {
    if (AXON.view !== "servers" || AXON.serversTab !== "net") return;
    links.forEach(l => { l.util = clamp(l.util + rnd(-2.5, 2.6), 2, 94); });
    renderNetLinks();
    updateInventoryStates();
  });
  new ResizeObserver(() => { if (AXON.serversTab === "net") resize(); }).observe(canvas.parentElement);
  resize();
  requestAnimationFrame(loop);
})();
