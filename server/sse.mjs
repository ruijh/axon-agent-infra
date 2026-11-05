/** Durable event cursors; slow or revoked subscribers are disconnected. */
export class SseHub {
  constructor(store) {
    this.store = store;
    this.clients = new Map();
    this.timer = setInterval(() => this.flush(), 100);
    this.timer.unref?.();
  }
  subscribe(req, res, key) {
    const header = req.headers["last-event-id"];
    const cursor =
      header === undefined ? this.store.lastFrame() : Number(header);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      res.writeHead(400);
      res.end();
      return;
    }
    const oldest = this.store.db
      .prepare("SELECT MIN(seq) AS seq FROM event_journal")
      .get().seq;
    if (cursor > this.store.lastFrame() || (oldest && cursor < oldest - 1)) {
      res.writeHead(409);
      res.end("EVENT_CURSOR_EXPIRED: reload snapshots");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write("retry: 3000\n\n");
    this.clients.set(res, { key, cursor, ping: Date.now() });
    req.on("close", () => this.clients.delete(res));
    this.flush();
  }
  broadcast(event, data) {
    this.store.queueFrame(event, data);
  }
  flush() {
    for (const [res, client] of this.clients) {
      const active = this.store.db
        .prepare("SELECT revoked FROM api_keys WHERE id=?")
        .get(client.key.id);
      if (!active || active.revoked) {
        res.end();
        this.clients.delete(res);
        continue;
      }
      try {
        for (const frame of this.store.framesSince(client.cursor)) {
          client.cursor = frame.seq;
          if (
            frame.event === "policy" &&
            !["platform-admin", "infra-admin", "sec-admin"].includes(
              client.key.role,
            )
          )
            continue;
          if (
            !res.write(
              `id: ${frame.seq}\nevent: ${frame.event}\ndata: ${frame.json}\n\n`,
            )
          ) {
            res.end();
            this.clients.delete(res);
            break;
          }
        }
        if (Date.now() - client.ping > 15000) {
          client.ping = Date.now();
          res.write(": ping\n\n");
        }
      } catch {
        res.destroy();
        this.clients.delete(res);
      }
    }
  }
  revoke(id) {
    for (const [res, c] of this.clients)
      if (c.key.id === id) {
        res.end();
        this.clients.delete(res);
      }
  }
  close() {
    clearInterval(this.timer);
    for (const [res] of this.clients) res.end();
    this.clients.clear();
  }
}
