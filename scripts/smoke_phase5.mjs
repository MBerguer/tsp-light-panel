#!/usr/bin/env node
// End-to-end smoke test for Phase 5 (cars + multi-circuit + replay + editor).
//
// Steps:
// 1. Hello as Race Control.
// 2. Verify snapshot includes cars (2 demo ECUs).
// 3. Run inline a small custom scenario that:
//      - enters car 44 in zone 2
//      - waves a global yellow
//      - waits, marks
//      - clears
// 4. Expect:
//      - ScenarioStarted
//      - DomainEvent::CarMoved {car: 44, to: 2}
//      - DomainEvent::PanelStateChanged with FlagState::Yellow
//      - ScenarioFinished completed
// 5. Switch circuit to monza_like, expect TopologyChanged.
// 6. GET /api/replay/events and verify the event log is non-empty and contains
//    a CarMoved or PanelStateChanged from the run.
//
// Requires the server to be running on 127.0.0.1:7878.

import WebSocket from "ws";

const HTTP = "http://127.0.0.1:7878";
const operator = "00000000-0000-4000-8000-000000000001";

const flags = {
  sawSnapshot: false,
  sawCarsInSnapshot: false,
  sawStarted: false,
  sawCarMoved: false,
  sawYellow: false,
  sawFinished: false,
  sawTopologyChanged: false,
};

const ws = new WebSocket(`${HTTP.replace("http", "ws")}/ws`);

const fail = (why) => {
  console.error("FAIL", why, flags);
  process.exit(1);
};

const timeout = setTimeout(() => fail("timed out"), 25_000);

ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "hello",
      role: { role: "race_control", data: { operator } },
      client_version: "smoke-phase5",
    })
  );
});

ws.on("message", async (data) => {
  const msg = JSON.parse(data.toString());

  if (msg.type === "snapshot") {
    flags.sawSnapshot = true;
    flags.sawCarsInSnapshot = Array.isArray(msg.cars) && msg.cars.length >= 1;
    console.log(
      `snapshot: ${msg.panels.length} panels, ${msg.cars.length} cars`
    );

    const scenario = {
      name: "phase5-smoke",
      description: "inline run from smoke script",
      setup: {
        panels: [],
        marshals: [],
        cars: [],
        race_control: true,
      },
      steps: [
        { step: "enter_zone", car: 44, zone: 2 },
        { step: "wait", duration_ms: 50 },
        {
          step: "race_control_command",
          target: { scope: "global" },
          flag: { kind: "yellow", data: "single" },
        },
        { step: "mark", label: "yellow-up" },
        { step: "wait", duration_ms: 100 },
        {
          step: "race_control_command",
          target: { scope: "global" },
          flag: { kind: "off" },
        },
        { step: "mark", label: "yellow-down" },
      ],
    };
    const res = await fetch(`${HTTP}/api/sim/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario, speed: 10 }),
    });
    if (!res.ok) {
      const body = await res.text();
      fail(`/api/sim/run rejected: ${body}`);
    }
    return;
  }

  if (msg.type === "scenario_started") {
    flags.sawStarted = true;
    console.log(`started: ${msg.name}`);
  }

  if (msg.type === "event" && msg.event.type === "car_moved") {
    if (msg.event.car === 44 && msg.event.to === 2) {
      flags.sawCarMoved = true;
    }
  }

  if (msg.type === "event" && msg.event.type === "panel_state_changed") {
    if (msg.event.to.kind === "yellow") {
      flags.sawYellow = true;
    }
  }

  if (msg.type === "scenario_finished") {
    flags.sawFinished = true;
    console.log(`finished: ${msg.reason}`);

    // Now switch circuit to monza_like.
    const res = await fetch(`${HTTP}/api/circuits/active`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ circuit_id: "monza_like" }),
    });
    if (!res.ok) fail(`circuit switch rejected: ${await res.text()}`);
  }

  if (msg.type === "topology_changed") {
    flags.sawTopologyChanged = true;
    console.log(`topology changed → ${msg.circuit_id}`);

    // Fetch replay log.
    const r = await fetch(`${HTTP}/api/replay/events`);
    if (!r.ok) fail(`replay endpoint failed: ${r.status}`);
    const body = await r.json();
    const sawAnyEvent = body.events.length > 0;
    const sawCarMovedInLog = body.events.some(
      (e) => e.type === "car_moved" && e.car === 44 && e.to === 2
    );
    console.log(
      `replay log: ${body.events.length} events, car_moved found: ${sawCarMovedInLog}`
    );
    if (!sawAnyEvent) fail("replay log empty");
    if (!sawCarMovedInLog) fail("car_moved not in replay log");

    const ok = Object.values(flags).every((v) => v);
    if (!ok) fail("missing flag");
    console.log("OK", flags);
    clearTimeout(timeout);
    ws.close();
    process.exit(0);
  }

  if (msg.type === "error") {
    fail(`server error: ${msg.message ?? JSON.stringify(msg)}`);
  }
});
