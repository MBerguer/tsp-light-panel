//! Replay engine.
//!
//! Reads an event log and folds it through the pure state machine in
//! `tsp_core` to reconstruct the final world state. Used for two purposes:
//!
//! 1. **Determinism check** — after running a scenario we can take the
//!    persisted event log, replay it against a fresh in-memory state and
//!    assert the final state matches the live world.
//! 2. **Postmortem** — given a real event log from production, recover the
//!    sequence of `PanelStateChanged` events and produce a per-panel
//!    timeline.
//!
//! The replay engine does **not** spin up actors. It works directly on
//! `tsp_core::Panel` aggregates so it is fast and side-effect free.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::Serialize;
use thiserror::Error;

use tsp_core::{DomainEvent, FlagState, Panel, PanelId};
use tsp_eventstore::EventStore;

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("event store: {0}")]
    Store(#[from] tsp_eventstore::EventStoreError),
    #[error("event {0} references unknown panel {1}")]
    UnknownPanel(usize, u32),
}

/// Outcome of a replay pass.
#[derive(Debug, Clone, Serialize)]
pub struct ReplayReport {
    /// Total number of events processed (every variant).
    pub events_processed: usize,
    /// State changes effectively applied.
    pub state_transitions: usize,
    /// Final effective state for each known panel.
    pub final_states: HashMap<PanelId, FlagState>,
    /// Per-panel timeline of transitions.
    pub timelines: HashMap<PanelId, Vec<TransitionPoint>>,
    pub first_event_at: Option<DateTime<Utc>>,
    pub last_event_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TransitionPoint {
    pub at: DateTime<Utc>,
    pub from: FlagState,
    pub to: FlagState,
}

/// Fold an event log into a final world. Panels not seen in any event are
/// **not** materialised — replay only knows about IDs that appear in the log.
pub struct ReplayEngine;

impl ReplayEngine {
    /// Replay every event in an in-memory or file-backed store.
    pub async fn replay_store<S: EventStore + ?Sized>(
        store: &S,
    ) -> Result<ReplayReport, ReplayError> {
        let events = store.read_all().await?;
        Ok(Self::replay_slice(&events))
    }

    /// Replay an in-memory slice.
    pub fn replay_slice(events: &[DomainEvent]) -> ReplayReport {
        let mut final_states: HashMap<PanelId, FlagState> = HashMap::new();
        let mut timelines: HashMap<PanelId, Vec<TransitionPoint>> = HashMap::new();
        let mut state_transitions = 0usize;
        let mut first_event_at = None;
        let mut last_event_at = None;

        for event in events {
            let ts = event.timestamp();
            first_event_at.get_or_insert(ts);
            last_event_at = Some(ts);

            if let DomainEvent::PanelStateChanged {
                panel,
                from,
                to,
                timestamp,
                ..
            } = event
            {
                final_states.insert(*panel, *to);
                timelines.entry(*panel).or_default().push(TransitionPoint {
                    at: *timestamp,
                    from: *from,
                    to: *to,
                });
                state_transitions += 1;
            }
        }

        ReplayReport {
            events_processed: events.len(),
            state_transitions,
            final_states,
            timelines,
            first_event_at,
            last_event_at,
        }
    }

    /// Cross-check: ensure the replayed final states match a live world's
    /// snapshot. Returns the panels (if any) that diverge.
    pub fn diff_against<'a, I>(
        report: &ReplayReport,
        live_panels: I,
    ) -> Vec<DivergedPanel>
    where
        I: IntoIterator<Item = &'a Panel>,
    {
        let mut diverged = Vec::new();
        for panel in live_panels {
            let replayed = report
                .final_states
                .get(&panel.id)
                .copied()
                .unwrap_or(FlagState::Off);
            if replayed != panel.effective_state {
                diverged.push(DivergedPanel {
                    panel: panel.id,
                    live: panel.effective_state,
                    replayed,
                });
            }
        }
        diverged
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DivergedPanel {
    pub panel: PanelId,
    pub live: FlagState,
    pub replayed: FlagState,
}
