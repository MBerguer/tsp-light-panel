//! `tsp-core` — Pure domain of the F1 trackside light panel simulator.
//!
//! Modelled after the **FIA Standard 3504-2019** (Light Panels for Motor Racing).
//! This crate has no I/O: it defines types, the flag state machine, the priority
//! resolver between Race Control, Marshal and local Panel state, and the wire
//! messages used by the WebSocket gateway in Phase 3.
//!
//! Layers:
//! - [`ids`]     — strongly-typed identifiers (newtypes around `Uuid` / numbers).
//! - [`flag`]    — the [`flag::FlagState`] enum and signalling helpers.
//! - [`command`] — operator intent: [`command::PanelCommand`] from Race Control or Marshal.
//! - [`panel`]   — the [`panel::Panel`] aggregate, including hardware health.
//! - [`event`]   — domain events emitted after applying a command (event sourcing).
//! - [`state`]   — pure state machine: `apply_command` and `resolve_effective_state`.
//! - [`wire`]    — typed WebSocket messages used by the UI gateway (Phase 3).

#![deny(rust_2018_idioms)]
#![warn(clippy::all)]

pub mod command;
pub mod error;
pub mod event;
pub mod fault;
pub mod flag;
pub mod ids;
pub mod panel;
pub mod scenario;
pub mod state;
pub mod wire;

pub use command::{CommandSource, CommandTarget, PanelCommand};
pub use error::{CommandRejection, DomainError};
pub use event::{DiagnosticAlert, DiagnosticSeverity, DomainEvent, SideEffect};
pub use fault::Fault;
pub use flag::{FlagState, YellowKind};
pub use ids::{
    CarNumber, CommandId, EventId, LedId, OperatorId, PanelId, PostId, SectorId, ZoneId,
};
pub use panel::{Car, HardwareHealth, Panel, TrackPosition, TrackSide};
pub use scenario::{
    CarSetup, EventMatcher, PanelLayout, Scenario, ScenarioSetup, ScenarioStep,
};
pub use state::{apply_command, resolve_effective_state};
