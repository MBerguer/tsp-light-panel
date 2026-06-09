//! Domain events emitted by the state machine and the diagnostic supervisor.
//!
//! Following an event-sourcing discipline, every observable state change in
//! the system is recorded as a [`DomainEvent`]. Actors emit them on the
//! broadcast bus and the event store persists them to an append-only log.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

use crate::command::PanelCommand;
use crate::flag::FlagState;
use crate::ids::{CarNumber, CommandId, EventId, LedId, PanelId, ZoneId};

/// All facts that the system can record.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/DomainEvent.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DomainEvent {
    /// A command was accepted but had no visible effect (idempotent re-issue).
    CommandAccepted {
        id: EventId,
        command_id: CommandId,
        timestamp: DateTime<Utc>,
    },
    /// A command was rejected. The reason is carried in a separate
    /// [`CommandRejected`] event so both paths are observable.
    CommandRejected {
        id: EventId,
        command_id: CommandId,
        reason: crate::error::CommandRejection,
        timestamp: DateTime<Utc>,
    },
    /// A panel's displayed flag changed.
    PanelStateChanged {
        id: EventId,
        command_id: CommandId,
        panel: PanelId,
        from: FlagState,
        to: FlagState,
        timestamp: DateTime<Utc>,
    },
    /// The Race Control override on a panel was set (or cleared if `flag` is
    /// `None`).
    RaceControlOverrideSet {
        id: EventId,
        panel: PanelId,
        flag: Option<FlagState>,
        timestamp: DateTime<Utc>,
    },
    /// The local marshal state on a panel was set (or cleared).
    MarshalLocalStateSet {
        id: EventId,
        panel: PanelId,
        flag: Option<FlagState>,
        timestamp: DateTime<Utc>,
    },
    /// A system-driven *follow-up* state on a panel was set (or cleared),
    /// e.g. the auto-green raised in the zone immediately after a marshal
    /// yellow per the FIA Yellow Sectors rule.
    FollowUpStateSet {
        id: EventId,
        panel: PanelId,
        flag: Option<FlagState>,
        timestamp: DateTime<Utc>,
    },
    /// A diagnostic supervisor poll detected a degraded condition.
    DiagnosticAlertRaised {
        id: EventId,
        alert: DiagnosticAlert,
        timestamp: DateTime<Utc>,
    },
    /// A previously raised alert has cleared.
    DiagnosticAlertCleared {
        id: EventId,
        alert: DiagnosticAlert,
        timestamp: DateTime<Utc>,
    },
    /// An ECU (car) was notified of a flag in its current zone.
    EcuNotified {
        id: EventId,
        car: CarNumber,
        zone: ZoneId,
        flag: FlagState,
        timestamp: DateTime<Utc>,
    },
    /// A car physically moved (entered a new zone or parked). Surfaces to the
    /// UI so it can animate the dot on the track without waiting for an
    /// `EcuNotified` event (which only fires when the new zone has a flag).
    CarMoved {
        id: EventId,
        car: CarNumber,
        from: Option<ZoneId>,
        to: Option<ZoneId>,
        timestamp: DateTime<Utc>,
    },
}

impl DomainEvent {
    pub fn id(&self) -> EventId {
        match self {
            DomainEvent::CommandAccepted { id, .. }
            | DomainEvent::CommandRejected { id, .. }
            | DomainEvent::PanelStateChanged { id, .. }
            | DomainEvent::RaceControlOverrideSet { id, .. }
            | DomainEvent::MarshalLocalStateSet { id, .. }
            | DomainEvent::FollowUpStateSet { id, .. }
            | DomainEvent::DiagnosticAlertRaised { id, .. }
            | DomainEvent::DiagnosticAlertCleared { id, .. }
            | DomainEvent::EcuNotified { id, .. }
            | DomainEvent::CarMoved { id, .. } => *id,
        }
    }

    pub fn timestamp(&self) -> DateTime<Utc> {
        match self {
            DomainEvent::CommandAccepted { timestamp, .. }
            | DomainEvent::CommandRejected { timestamp, .. }
            | DomainEvent::PanelStateChanged { timestamp, .. }
            | DomainEvent::RaceControlOverrideSet { timestamp, .. }
            | DomainEvent::MarshalLocalStateSet { timestamp, .. }
            | DomainEvent::FollowUpStateSet { timestamp, .. }
            | DomainEvent::DiagnosticAlertRaised { timestamp, .. }
            | DomainEvent::DiagnosticAlertCleared { timestamp, .. }
            | DomainEvent::EcuNotified { timestamp, .. }
            | DomainEvent::CarMoved { timestamp, .. } => *timestamp,
        }
    }
}

/// A diagnostic finding for a single panel.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/DiagnosticAlert.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiagnosticAlert {
    PsuOutOfRange {
        panel: PanelId,
        voltage: f32,
        severity: DiagnosticSeverity,
    },
    Overtemperature {
        panel: PanelId,
        celsius: f32,
        severity: DiagnosticSeverity,
    },
    LedFailure {
        panel: PanelId,
        leds: Vec<LedId>,
        severity: DiagnosticSeverity,
    },
    HandshakeTimeout {
        panel: PanelId,
        elapsed_ms: i64,
        severity: DiagnosticSeverity,
    },
}

impl DiagnosticAlert {
    pub fn panel(&self) -> PanelId {
        match self {
            DiagnosticAlert::PsuOutOfRange { panel, .. }
            | DiagnosticAlert::Overtemperature { panel, .. }
            | DiagnosticAlert::LedFailure { panel, .. }
            | DiagnosticAlert::HandshakeTimeout { panel, .. } => *panel,
        }
    }

    pub fn severity(&self) -> DiagnosticSeverity {
        match self {
            DiagnosticAlert::PsuOutOfRange { severity, .. }
            | DiagnosticAlert::Overtemperature { severity, .. }
            | DiagnosticAlert::LedFailure { severity, .. }
            | DiagnosticAlert::HandshakeTimeout { severity, .. } => *severity,
        }
    }
}

#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/DiagnosticSeverity.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
    Critical,
}

/// Side-effect requested by the state machine but performed by an actor.
///
/// The state machine is pure; instead of touching I/O it returns a list of
/// `SideEffect`s the caller (actor system) must carry out — broadcasting,
/// persisting, dispatching to ECUs, etc.
#[derive(Debug, Clone, PartialEq)]
pub enum SideEffect {
    /// Notify ECUs of cars currently in the affected zone(s).
    NotifyEcus { zone: ZoneId, flag: FlagState },
    /// Refresh the rear repeater strip for a panel.
    RefreshRepeater {
        panel: PanelId,
        flag: FlagState,
    },
}

/// Internal builder so actors can keep timestamps consistent.
#[derive(Debug, Clone)]
pub struct EventBuilder {
    pub now: DateTime<Utc>,
}

impl EventBuilder {
    pub fn new(now: DateTime<Utc>) -> Self {
        Self { now }
    }

    pub fn accepted(&self, cmd: &PanelCommand) -> DomainEvent {
        DomainEvent::CommandAccepted {
            id: EventId::new(),
            command_id: cmd.id,
            timestamp: self.now,
        }
    }

    pub fn rejected(
        &self,
        cmd: &PanelCommand,
        reason: crate::error::CommandRejection,
    ) -> DomainEvent {
        DomainEvent::CommandRejected {
            id: EventId::new(),
            command_id: cmd.id,
            reason,
            timestamp: self.now,
        }
    }

    pub fn panel_state_changed(
        &self,
        cmd: &PanelCommand,
        panel: PanelId,
        from: FlagState,
        to: FlagState,
    ) -> DomainEvent {
        DomainEvent::PanelStateChanged {
            id: EventId::new(),
            command_id: cmd.id,
            panel,
            from,
            to,
            timestamp: self.now,
        }
    }
}
