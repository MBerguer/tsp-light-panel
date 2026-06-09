//! Domain errors and command rejection reasons.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

use crate::flag::FlagState;

/// Why a command was rejected by the state machine. Returned alongside the
/// (unchanged) panel state so the gateway can ship a structured error to the
/// UI.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/CommandRejection.ts"))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Error)]
#[serde(tag = "reason", rename_all = "snake_case")]
pub enum CommandRejection {
    /// Marshal tried to issue a flag reserved for Race Control (red, chequered,
    /// black, SC, VSC).
    #[error("flag {flag:?} can only be issued by Race Control")]
    NotAllowedForMarshal { flag: FlagState },

    /// Race Control issued a flag that must be global on a narrower target.
    #[error("flag {flag:?} must be targeted globally")]
    GlobalFlagOnNonGlobalTarget { flag: FlagState },

    /// Race Control issued a driver-specific flag to a non-`Panel` target.
    #[error("driver-specific flag {flag:?} requires a single-panel target")]
    DriverSpecificFlagOnWrongTarget { flag: FlagState },

    /// Transition forbidden by FIA sporting interpretation (e.g.
    /// `Chequered → Green` without a session reset).
    #[error("invalid transition from {from:?} to {to:?}")]
    InvalidTransition { from: FlagState, to: FlagState },

    /// Marshal targeted a panel that does not belong to its zone.
    #[error("marshal cannot command panel outside its zone")]
    MarshalOutOfZone,
}

/// Catch-all domain error used in places where we still want a `Result` but
/// the precise rejection reason matters less (e.g. event store replay).
#[derive(Debug, Error)]
pub enum DomainError {
    #[error(transparent)]
    Rejected(#[from] CommandRejection),

    #[error("unknown panel: {0}")]
    UnknownPanel(u32),

    #[error("serialisation: {0}")]
    Serde(#[from] serde_json::Error),
}
