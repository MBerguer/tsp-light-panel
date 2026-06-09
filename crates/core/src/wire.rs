//! Wire protocol between the WebSocket gateway and the UI (Phase 3 preview).
//!
//! Both directions are modelled as tagged enums so we get exhaustive matching
//! on the Rust side and discriminated unions on the TS side (via `ts-rs` or
//! `specta`, plugged in during Phase 3).
//!
//! ### Roles
//!
//! Every WS connection upgrades with a [`ClientRole`]. The gateway uses it to
//! restrict which [`ClientMessage`]s it accepts: a `Marshal` can only emit
//! marshal-scoped commands for its post, `RaceControl` can issue overrides,
//! and `EngineeringRoom` / `Spectator` are read-only.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::command::PanelCommand;
use crate::event::{DiagnosticAlert, DomainEvent};
use crate::flag::FlagState;
use crate::ids::{CarNumber, OperatorId, PanelId, PostId, ZoneId};
use crate::panel::{Car, Panel};
use crate::scenario::Scenario;

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

/// Role advertised by a client when opening the WebSocket.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ClientRole.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "role", content = "data", rename_all = "snake_case")]
pub enum ClientRole {
    RaceControl { operator: OperatorId },
    Marshal { post: PostId },
    EngineeringRoom,
    Spectator,
}

impl ClientRole {
    pub const fn can_send_race_control(self) -> bool {
        matches!(self, ClientRole::RaceControl { .. })
    }

    pub const fn can_send_marshal(self) -> bool {
        matches!(self, ClientRole::Marshal { .. })
    }
}

/// Messages a client can send to the server.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ClientMessage.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMessage {
    /// Initial handshake. Must be sent before any other message.
    Hello { role: ClientRole, client_version: String },
    /// Subscribe to a sub-stream (panel updates, diagnostics, ECU, all).
    Subscribe { topics: Vec<Topic> },
    /// Request a full snapshot — used by clients on (re)connection.
    RequestSnapshot,
    /// Submit a command. The server validates it against the connection role.
    SubmitCommand { command: PanelCommand },
    /// Start a scenario by name (must be present in the library) or as an
    /// inline definition. Race-Control-role only.
    StartScenario {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scenario: Option<Scenario>,
        /// Scale factor on wait durations. 1.0 = real time, 5.0 = 5x faster.
        #[serde(default = "default_speed")]
        speed: f32,
    },
    /// Stop the currently-running scenario.
    StopScenario,
    /// Reset every panel to OFF and clear active alerts.
    ResetWorld,
    /// Ask the server to list the names+descriptions in the built-in library.
    ListScenarios,
    /// Switch the active circuit. Race-Control-role only.
    SwitchCircuit { circuit_id: String },
    /// Ask the server to list available circuit ids + labels.
    ListCircuits,
    /// Lightweight liveness probe.
    Ping { nonce: u32 },
}

fn default_speed() -> f32 {
    1.0
}

/// Messages the server pushes to the client.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ServerMessage.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMessage {
    /// Acknowledges the [`ClientMessage::Hello`].
    Welcome {
        server_version: String,
        server_time: DateTime<Utc>,
    },
    /// Initial / on-demand snapshot of the world.
    Snapshot { panels: Vec<Panel>, cars: Vec<Car> },
    /// A domain event happened.
    Event { event: DomainEvent },
    /// A diagnostic finding. Duplicates the corresponding `DomainEvent` but is
    /// kept as a separate channel so the Engineering Room view can subscribe
    /// to alerts only.
    Diagnostic { alert: DiagnosticAlert },
    /// Push the ECU view of a single car (for the steering-wheel light strip).
    EcuLight {
        car: CarNumber,
        zone: ZoneId,
        flag: FlagState,
    },
    /// Reply to [`ClientMessage::Ping`].
    Pong { nonce: u32, server_time: DateTime<Utc> },
    /// The server rejected a client message (bad role, malformed command, ...).
    Error { code: ErrorCode, message: String },
    /// A scenario started running.
    ScenarioStarted {
        name: String,
        description: Option<String>,
        total_steps: u32,
    },
    /// A step of the running scenario completed. `mark` is `Some` only for
    /// `ScenarioStep::Mark { label }` rows so the UI can render timeline pins.
    ScenarioProgress {
        step_idx: u32,
        total_steps: u32,
        mark: Option<String>,
        kind: String,
    },
    /// The currently-running scenario terminated.
    ScenarioFinished {
        reason: ScenarioFinishReason,
        assertions_passed: u32,
        assertions_failed: u32,
    },
    /// Catalogue of built-in scenarios.
    ScenarioListing { entries: Vec<ScenarioCatalogueEntry> },
    /// The active circuit changed; clients should refetch `/api/topology`.
    TopologyChanged { circuit_id: String, label: String },
    /// Catalogue of available circuits.
    CircuitListing {
        active: String,
        entries: Vec<CircuitCatalogueEntry>,
    },
}

/// Why a scenario stopped running.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ScenarioFinishReason.ts"))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioFinishReason {
    Completed,
    Stopped,
    Failed,
}

#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ScenarioCatalogueEntry.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ScenarioCatalogueEntry {
    pub name: String,
    pub description: Option<String>,
    pub total_steps: u32,
}

#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/CircuitCatalogueEntry.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CircuitCatalogueEntry {
    pub id: String,
    pub label: String,
}

/// Topics a client can subscribe to. `All` is shorthand for every topic.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/Topic.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    PanelStates,
    Diagnostics,
    EcuLights,
    All,
}

/// Stable error codes the UI can branch on.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ErrorCode.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    HandshakeRequired,
    Unauthorized,
    InvalidCommand,
    UnknownPanel,
    Internal,
}

/// Panel snapshot trimmed for the UI (no hardware health, kept on Engineering
/// Room channel only). Useful when broadcasting frequent state changes.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/PanelSummary.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PanelSummary {
    pub id: PanelId,
    pub zone: ZoneId,
    pub flag: FlagState,
    pub last_updated: DateTime<Utc>,
}

impl From<&Panel> for PanelSummary {
    fn from(p: &Panel) -> Self {
        Self {
            id: p.id,
            zone: p.zone,
            flag: p.effective_state,
            last_updated: p.last_updated,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{CommandSource, CommandTarget};
    use crate::flag::{FlagState, YellowKind};
    use crate::ids::PostId;

    #[test]
    fn client_message_serde_tag() {
        let msg = ClientMessage::SubmitCommand {
            command: PanelCommand::new(
                CommandSource::Marshal {
                    post: PostId::new(3),
                },
                CommandTarget::Zone(ZoneId::new(3)),
                FlagState::Yellow(YellowKind::Single),
            ),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"submit_command\""));
    }

    #[test]
    fn server_message_welcome_roundtrip() {
        let msg = ServerMessage::Welcome {
            server_version: "0.1.0".into(),
            server_time: Utc::now(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        let back: ServerMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(msg, back);
    }
}
