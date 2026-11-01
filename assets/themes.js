/* ═══════════════════════════════════════════════════════════
   AXON · 主题系统
   8 套主题：axon(默认) / macos / google / spacex / aws /
            openai / light / dark
   机制：<head> 内联脚本提前设置 data-theme（防闪色）→
        CSS 变量整体换肤 → 本文件把计算样式同步进 AXON_CV
        运行时调色板（供 Canvas/WebGL 绘制取色）→
        emit("view") 重渲染 DOM 视图 + emit("theme") 通知画布
   记忆：localStorage["axon-theme"]
   ═══════════════════════════════════════════════════════════ */

(function () {

  /* AXON_CV 键 → CSS 变量（全部为 hex，便于拼 rgba/hex/rgb 三种形态） */
  const VAR_KEYS = {
    accent: "--cyan", accentSoft: "--cyan-soft",
    ok: "--ok", warn: "--warn", crit: "--crit", violet: "--violet",
    green: "--green", steel: "--steel", orange: "--orange",
    l0: "--l-server", l1: "--l-infra", l2: "--l-catalog", l3: "--l-agent", l4: "--l-task",
    text: "--text", textDim: "--text-dim", textFaint: "--text-faint", textBright: "--text-bright",
    node: "--nodebg-hex", bg1: "--bg1",
    dcManaged: "--dc-managed", dcRackOff: "--dc-rack-off", dcFloor: "--dc-floor",
    dcBg: "--dc-2",
  };

  function parseColor(s) {
    s = (s || "").trim();
    if (s[0] === "#") {
      if (s.length === 4) return [parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16), parseInt(s[3] + s[3], 16)];
      return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
    }
    const m = s.match(/(\d+)\D+(\d+)\D+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
  }

  const CV = {
    v: {}, hexes: {},
    refresh() {
      const cs = getComputedStyle(document.documentElement);
      Object.entries(VAR_KEYS).forEach(([k, name]) => {
        const raw = cs.getPropertyValue(name).trim();
        this.hexes[k] = raw;
        this.v[k] = parseColor(raw);
      });
    },
    rgb(key) { return this.v[key] || [128, 128, 128]; },
    tri(key) { const c = this.rgb(key); return c[0] + "," + c[1] + "," + c[2]; },
    hex(key) { return this.hexes[key] || "#808080"; },
    color(key) { return "rgb(" + this.tri(key) + ")"; },
    rgba(key, a) { return "rgba(" + this.tri(key) + "," + a + ")"; },
    num(key) { const c = this.rgb(key); return (c[0] << 16) + (c[1] << 8) + c[2]; },
  };
  window.AXON_CV = CV;
  CV.refresh();

  /* ── 主题目录（顺序即选择器展示顺序）────────────────── */
  const THEMES = [
    { id: "axon",   name: "深空靛蓝",        tag: "AXON 默认 · 深空控制台",        sw: ["#060c1a", "#37e2ff", "#b18cff", "#2ef0a8"] },
    { id: "macos",  name: "macOS",           tag: "磨砂玻璃 · 交通灯 · 大圆角",    sw: ["#f5f5f7", "#0a84ff", "#bf5af2", "#30d158"] },
    { id: "google", name: "谷歌数据中心",    tag: "Material · 品牌四色带",         sw: ["#ffffff", "#4285f4", "#fbbc05", "#34a853"] },
    { id: "spacex", name: "SpaceX 数据中心", tag: "工业风 · 纯黑 · 等宽字体",      sw: ["#000000", "#e9eef4", "#d9a441", "#3fdc78"] },
    { id: "aws",    name: "Amazon 数据中心", tag: "Squid Ink 深蓝 · AWS 橙",      sw: ["#161e2d", "#ff9900", "#7aa2d8", "#44b87d"] },
    { id: "openai", name: "OpenAI 数据中心", tag: "极简黑白 · 青绿点缀",           sw: ["#ffffff", "#0d0d0d", "#10a37f", "#7a6bc4"] },
    { id: "light",  name: "浅色",            tag: "通用浅色运维控制台",            sw: ["#eef1f6", "#2563eb", "#7c3aed", "#16a34a"] },
    { id: "dark",   name: "深色",            tag: "石墨深色 · 高可读",             sw: ["#0b0e14", "#58a6ff", "#bc8cff", "#3fb950"] },
  ];
  AXON.THEMES = THEMES;

  /* LAYER_META 五层色随主题（data.js 中的字面量为默认主题等价值） */
  function syncLayerColors() {
    if (typeof LAYER_META === "undefined") return;
    LAYER_META[0].color = CV.hex("l0");
    LAYER_META[1].color = CV.hex("l1");
    LAYER_META[2].color = CV.hex("l2");
    LAYER_META[3].color = CV.hex("l3");
    LAYER_META[4].color = CV.hex("l4");
  }

  AXON.themeId = () => document.documentElement.getAttribute("data-theme") || "axon";

  AXON.applyTheme = function (id, opts = {}) {
    const t = THEMES.find(x => x.id === id) || THEMES[0];
    document.documentElement.setAttribute("data-theme", t.id);
    try { localStorage.setItem("axon-theme", t.id); } catch (e) { /* 隐私模式等 */ }
    CV.refresh();
    syncLayerColors();
    if (AXON.view) AXON.emit("view", AXON.view);   // 重渲染当前视图（图表/图例/卡片随新色重建）
    AXON.emit("theme", t.id);                       // 画布/3D 自行换色
    if (!opts.silent) AXON.toast("主题已切换", `${esc(t.name)} · ${esc(t.tag)}`, "info", 2400);
  };

  /* ── 主题选择器 ──────────────────────────────────────── */
  function renderThemePop() {
    const pop = $("#theme-pop");
    if (!pop) return;
    const cur = AXON.themeId();
    pop.innerHTML = `
      <div class="tp-head"><span>主题风格</span><span class="tp-note">${THEMES.length} 套 · 全站生效 · 本地记忆</span></div>
      <div class="theme-grid">${THEMES.map(t => `
        <button class="theme-card ${t.id === cur ? "active" : ""}" data-theme-id="${t.id}">
          <span class="tc-name">${esc(t.name)}</span>
          <span class="tc-tag">${esc(t.tag)}</span>
          <span class="tc-sw">${t.sw.map(c => `<i style="background:${c}"></i>`).join("")}</span>
        </button>`).join("")}
      </div>`;
    $$(".theme-card", pop).forEach(card =>
      card.addEventListener("click", () => { AXON.applyTheme(card.dataset.themeId); closePop(); }));
  }
  function closePop() {
    const pop = $("#theme-pop");
    if (pop) pop.hidden = true;
    const btn = $("#theme-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
  const btn = $("#theme-btn");
  if (btn) btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const pop = $("#theme-pop");
    if (pop.hidden) { renderThemePop(); pop.hidden = false; btn.setAttribute("aria-expanded", "true"); }
    else closePop();
  });
  document.addEventListener("click", (e) => {
    const pop = $("#theme-pop");
    if (pop && !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) closePop();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  /* 初始化：<head> 已设好 data-theme，这里只需同步数据层颜色 */
  syncLayerColors();
})();
