#!/usr/bin/env node
// End-to-end test for the live scenario controller.
// 1. Hello as Race Control.
// 2. Wait for snapshot.
// 3. Start scenario "yellow_to_sc" at speed 10x.
// 4. Verify ScenarioStarted → at least one ScenarioProgress → at least one
//    PanelStateChanged → ScenarioFinished.

import WebSocket from "ws";

const ws = new WebSocket("ws://127.0.0.1:7878/ws");

const operator = "00000000-0000-4000-8000-000000000001";
let sawStarted = false;
let sawProgress = false;
let sawPanelChange = false;
let sawFinished = false;
let marksSeen = 0;

const timeout = setTimeout(() => {
  console.error("FAIL: timed out", {
    sawStarted,
    sawProgress,
    sawPanelChange,
    sawFinished,
    marksSeen,
  });
  process.exit(1);
}, 20_000);

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
  if (msg.type === "snapshot") {
    console.log(`snapshot: ${msg.panels.length} panels`);
    ws.send(
      JSON.stringify({
        type: "start_scenario",
        name: "yellow_to_sc",
        scenario: null,
        speed: 10,
      })
    );
  } else if (msg.type === "scenario_started") {
    sawStarted = true;
    console.log(`started: ${msg.name} (${msg.total_steps} steps)`);
  } else if (msg.type === "scenario_progress") {
    sawProgress = true;
    if (msg.mark) {
      marksSeen++;
      console.log(`  mark[${msg.step_idx}]: ${msg.mark}`);
    }
  } else if (msg.type === "event" && msg.event.type === "panel_state_changed") {
    sawPanelChange = true;
  } else if (msg.type === "scenario_finished") {
    sawFinished = true;
    console.log(
      `finished: ${msg.reason} (assertions ${msg.assertions_passed}/${msg.assertions_failed})`
    );
    const ok =
      sawStarted &&
      sawProgress &&
      sawPanelChange &&
      sawFinished &&
      marksSeen >= 2;
    if (!ok) {
      console.error("FAIL", {
        sawStarted,
        sawProgress,
        sawPanelChange,
        sawFinished,
        marksSeen,
      });
      process.exit(1);
    }
    console.log(`OK: all checkpoints (${marksSeen} marks)`);
    clearTimeout(timeout);
    ws.close();
    process.exit(0);
  } else if (msg.type === "error") {
    console.error("server error", msg);
    process.exit(1);
  }
});
