//! Operator intent that enters the system from Race Control or a marshal post.
//!
//! A [`PanelCommand`] is what the WS gateway receives from the UI. The state
//! machine in [`crate::state`] consumes it and decides whether to emit a
//! [`crate::event::DomainEvent`].

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

use crate::flag::FlagState;
use crate::ids::{CommandId, OperatorId, PanelId, PostId, SectorId, ZoneId};

/// Who issued the command. Used by the state machine to enforce the priority
/// hierarchy `RaceControl > Marshal > Panel`.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/CommandSource.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum CommandSource {
    /// Issued by a race director or deputy from the Race Control software.
    RaceControl { operator: OperatorId },
    /// Issued by a marshal from the local post console.
    Marshal { post: PostId },
    /// Issued automatically by the system (e.g. handshake recovery,
    /// auto-clearing a yellow when the incident is resolved).
    System,
}

impl CommandSource {
    pub const fn is_race_control(&self) -> bool {
        matches!(self, CommandSource::RaceControl { .. })
    }

    pub const fn is_marshal(&self) -> bool {
        matches!(self, CommandSource::Marshal { .. })
    }
}

/// Scope of a command.
///
/// * `Global` — every panel on track.
/// * `Sector` — every panel inside the given track sector.
/// * `Zone` — every panel inside a marshal zone (typical for local yellows).
/// * `Panel` — a single panel (used for driver-specific black flags shown at
///   start/finish, or for diagnostics).
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/CommandTarget.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "scope", content = "id", rename_all = "snake_case")]
pub enum CommandTarget {
    Global,
    Sector(SectorId),
    Zone(ZoneId),
    Panel(PanelId),
}

impl CommandTarget {
    pub const fn is_global(&self) -> bool {
        matches!(self, CommandTarget::Global)
    }
}

/// External request to set a flag on one or more panels.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/PanelCommand.ts"))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PanelCommand {
    pub id: CommandId,
    pub source: CommandSource,
    pub target: CommandTarget,
    pub flag: FlagState,
    pub timestamp: DateTime<Utc>,
}

impl PanelCommand {
    /// Convenience constructor used by tests and the simulator.
    pub fn new(source: CommandSource, target: CommandTarget, flag: FlagState) -> Self {
        Self {
            id: CommandId::new(),
            source,
            target,
            flag,
            timestamp: Utc::now(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flag::YellowKind;

    #[test]
    fn race_control_command_serde_roundtrip() {
        let cmd = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Global,
            FlagState::Red,
        );
        let json = serde_json::to_string(&cmd).unwrap();
        let back: PanelCommand = serde_json::from_str(&json).unwrap();
        assert_eq!(cmd, back);
    }

    #[test]
    fn marshal_command_targets_zone() {
        let cmd = PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(12),
            },
            CommandTarget::Zone(ZoneId::new(12)),
            FlagState::Yellow(YellowKind::Single),
        );
        assert!(cmd.source.is_marshal());
        assert!(!cmd.target.is_global());
    }
}
