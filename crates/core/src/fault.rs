//! Hardware-fault descriptor used by both the simulator and the scenario
//! engine.
//!
//! A `Fault` lives entirely in domain-data land: it does not perform any
//! mutation on its own, it is the *command* that something — typically a
//! `PanelActor` — interprets to mutate its [`HardwareHealth`]. Keeping the
//! type in `tsp_core` keeps it free of `tokio`/actor concerns so it can be
//! shipped in JSON payloads (REST, WS, scenario YAML) without depending on
//! the server.
//!
//! [`HardwareHealth`]: crate::panel::HardwareHealth

use serde::{Deserialize, Serialize};

use crate::ids::LedId;

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/Fault.ts"))]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum Fault {
    SetPsuVoltage(f32),
    SetTemperature(f32),
    AddLedFailure(LedId),
    ClearLedFailures,
    StaleHandshake { offset_ms: i64 },
}
