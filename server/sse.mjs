/* ═══════════════════════════════════════════════════════════
   AXON · SSE 事件流（对标 mission-control 的 WebSocket/SSE）
   event: policy / task / op / heartbeat
   ═══════════════════════════════════════════════════════════ */

export class SseHub {
  constructor() {
    this.clients = new Set();
    this.timer = setInterval(() => {
      for (const res of this.clients) {
        try { res.write(": ping\n\n"); } catch { this.clients.delete(res); }
      }
    }, 15000);
    this.timer.unref?.();
  }

  subscribe(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, transform",
      Connection: "keep-alive",
    });
    res.write("retry: 3000\n\n");
    this.clients.add(res);
    req.on("close", () => this.clients.delete(res));
    return res;
  }

  broadcast(event, data) {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.clients) {
      try { res.write(frame); } catch { this.clients.delete(res); }
    }
  }

  close() { clearInterval(this.timer); }
}
