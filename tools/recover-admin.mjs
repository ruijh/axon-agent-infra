#!/usr/bin/env node
// Offline recovery relies on the operator's local filesystem access.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../server/store.mjs";
import { createKey } from "../server/auth.mjs";
const file = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../data/axon.db", import.meta.url));
if (!existsSync(file)) throw Error("数据库不存在，恢复不会创建新库");
const store = new Store(file);
try {
  const key = store.transaction(() => {
    const key = createKey(store, {
      name: "local-recovery",
      role: "platform-admin",
    });
    store.setMeta("initialized", "true");
    store.pushEvent({
      kind: "policy",
      type: "恢复",
      severity: "warn",
      source: "local-recovery",
      subject: key.id,
      msg: "本地管理员恢复",
      refs: [],
    });
    return key;
  });
  console.log(`恢复密钥 ${key.id}；Token 仅显示一次：\n${key.token}`);
} finally {
  store.db.close();
}
