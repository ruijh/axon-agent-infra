/* Shared, deterministic physical-network layout. No DOM or canvas dependency. */
(function (root) {
  function layout({ width, rackId = null, servers, netDevices, rackIds }) {
    const focused = !!rackId;
    const widthPx = Math.max(width, focused ? 320 : 20 + rackIds.length * 240 + 170);
    const positions = new Map(), zones = [];
    const put = (ref, x, y, w = 136) => positions.set(ref.id, { x, y, w, h: 48 });
    const cores = netDevices.filter(n => n.kind === "core");
    cores.forEach((n, i) => put(n, widthPx * (i + .5) / cores.length, 72));
    zones.push({ rack: "R01", x: 12, y: 28, w: widthPx - 24, h: 78 });
    let bottom = 430;
    if (rackId === "R01") {
      // The network rack's downstream ToRs remain visible as its direct peers.
      const peers = netDevices.filter(n => n.kind === "tor");
      const cols = widthPx < 420 ? 1 : Math.max(2, Math.floor((widthPx - 24) / 166));
      peers.forEach((n, i) => put(n, widthPx * ((i % cols) + .5) / cols, 180 + Math.floor(i / cols) * 78));
      bottom = Math.max(bottom, 240 + Math.ceil(peers.length / cols) * 78);
    } else {
      const ids = focused ? [rackId] : rackIds;
      const left = focused ? 12 : 20, right = focused ? widthPx - 12 : widthPx - 170;
      const band = (right - left) / ids.length;
      ids.forEach((rid, i) => {
        const x0 = left + band * i;
        const tor = netDevices.find(n => n.kind === "tor" && n.location.rack === rid);
        if (tor) put(tor, focused ? widthPx * .28 : x0 + band / 2, 180);
        const members = servers.filter(n => n.location.rack === rid);
        const cols = focused && widthPx < 420 ? 1 : Math.min(2, members.length || 1);
        members.forEach((n, j) => put(n, x0 + band * ((j % cols) + .5) / cols,
          300 + Math.floor(j / cols) * 78, focused ? 148 : 104));
        const zoneBottom = Math.max(354, 338 + (Math.ceil(members.length / cols) - 1) * 78);
        zones.push({ rack: rid, x: x0 + 4, y: 128, w: band - 8, h: zoneBottom - 128 });
        bottom = Math.max(bottom, zoneBottom + 56);
      });
      const bmc = netDevices.find(n => n.kind === "bmc");
      if (bmc) put(bmc, focused ? widthPx * .72 : widthPx - 82, 180);
    }
    return { width: widthPx, height: bottom, positions, zones };
  }

  function fitText(text, width, measure) {
    const value = String(text);
    if (measure(value) <= width) return value;
    if (measure("…") > width) return "";
    const chars = Array.from(value);
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (measure(chars.slice(0, mid).join("") + "…") <= width) lo = mid;
      else hi = mid - 1;
    }
    return chars.slice(0, lo).join("") + "…";
  }

  function hitTest(positions, x, y) {
    for (const [id, n] of positions) {
      if (x >= n.x - n.w / 2 && x <= n.x + n.w / 2 && y >= n.y - n.h / 2 && y <= n.y + n.h / 2) return id;
    }
    return null;
  }

  const api = { layout, fitText, hitTest };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.AXON_NET_LAYOUT = api;
})(typeof window !== "undefined" ? window : this);
