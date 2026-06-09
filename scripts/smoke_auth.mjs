#!/usr/bin/env node
// Authorisation smoke test: connecting as Spectator and trying to submit
// a command should be rejected with `Unauthorized`.

import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:7878/ws");

setTimeout(() => {
  console.error("FAIL: timed out");
  process.exit(1);
}, 3000);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      role: { role: "spectator" },
      client_version: "smoke",
    })
  );
  setTimeout(() => {
    ws.send(
      JSON.stringify({
        type: "submit_command",
        command: {
          id: crypto.randomUUID(),
          source: {
            kind: "race_control",
            data: { operator: "00000000-0000-4000-8000-000000000001" },
          },
          target: { scope: "global" },
          flag: { kind: "red" },
          timestamp: new Date().toISOString(),
        },
      })
    );
  }, 200);
});

ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.type === "error" && msg.code === "unauthorized") {
    console.log("OK: spectator rejected:", msg.message);
    ws.close();
    process.exit(0);
  }
});
