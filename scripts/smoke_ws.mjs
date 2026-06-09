#!/usr/bin/env node
// End-to-end smoke test for the WS gateway. Spawned by `npm run smoke`.
// 1. Connect as Race Control, send Hello.
// 2. Receive Welcome + Snapshot.
// 3. Submit a global RED flag.
// 4. Expect PanelStateChanged events for every panel.

import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:7878/ws");

const operator = "00000000-0000-4000-8000-000000000001";
const pending = new Set();
let stateChanges = 0;

const timeout = setTimeout(() => {
  console.error("FAIL: timed out waiting for events");
  process.exit(1);
}, 5000);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      role: { role: "race_control", data: { operator } },
      client_version: "smoke",
    })
  );
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "welcome") {
    console.log("welcome ok");
  } else if (msg.type === "snapshot") {
    console.log(`snapshot: ${msg.panels.length} panels`);
    for (const p of msg.panels) pending.add(p.id);
    ws.send(
      JSON.stringify({
        type: "submit_command",
        command: {
          id: crypto.randomUUID(),
          source: { kind: "race_control", data: { operator } },
          target: { scope: "global" },
          flag: { kind: "red" },
          timestamp: new Date().toISOString(),
        },
      })
    );
  } else if (msg.type === "event") {
    if (msg.event.type === "panel_state_changed") {
      stateChanges++;
      pending.delete(msg.event.panel);
      if (pending.size === 0) {
        console.log(`OK: all ${stateChanges} panels switched to RED`);
        clearTimeout(timeout);
        ws.close();
        process.exit(0);
      }
    }
  } else if (msg.type === "error") {
    console.error("server error", msg);
    process.exit(1);
  }
});

ws.on("error", (err) => {
  console.error("ws error", err);
  process.exit(1);
});
