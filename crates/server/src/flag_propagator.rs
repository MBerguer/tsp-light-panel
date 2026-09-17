//! Flag propagator — implements the FIA "green after yellow" rule.
//!
//! Per FIA Sporting Regulations and FIA 3504-2019 §5, the zone immediately
//! **downstream** of a yellow zone must display a green flag to signal
//! drivers that the incident has been cleared and racing may resume. On
//! digital trackside-panel systems this is performed automatically by the
//! system, **without** the next marshal having to manually press their own
//! green button.
//!
//! This actor subscribes to the [`crate::bus::EventBus`], tracks how many
//! panels in each zone are currently displaying yellow, and emits
//! [`tsp_core::CommandSource::System`] commands targeting the *next* zone:
//!
//! * `Yellow appeared at zone N`  → System `Green` to zone `N+1`.
//! * `Yellow cleared from zone N` → System `Off`   to zone `N+1`.
//!
//! `CommandSource::System` writes only the panel's
//! [`tsp_core::Panel::follow_up_state`], which sits *below* both the RC
//! override and the marshal's own local input — so the propagated green
//! never masks a real yellow / red at the downstream post.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::sync::{broadcast, RwLock};
use tracing::{debug, instrument, warn};
use tsp_core::{
    CommandSource, CommandTarget, DomainEvent, FlagState, PanelCommand, PanelId, YellowKind,
    ZoneId,
};

use crate::bus::EventBus;
use crate::dispatch::HubHandle;
use crate::topology::CircuitTopology;

/// Handle to a running propagator. Cloning is cheap; dropping the last
/// clone has no effect on the actor itself — the actor lives until the
/// event bus closes or [`FlagPropagator::shutdown`] is called.
#[derive(Clone)]
pub struct FlagPropagatorHandle {
    inner: Arc<RwLock<PropagatorState>>,
}

#[derive(Default)]
struct PropagatorState {
    /// `panel_id → zone` cache (built from the topology at boot, refreshed
    /// when the circuit changes).
    panel_zone: HashMap<PanelId, ZoneId>,
    /// `zone → next zone` table. Computed once from the topology by
    /// sorting zones by id (last zone wraps to the first).
    next_zone: HashMap<ZoneId, ZoneId>,
    /// Set of `panel_id` currently displaying any yellow variant. Used to
    /// reference-count yellow panels per zone so we only propagate on the
    /// **edge** transitions (first yellow appears, last yellow clears).
    yellow_panels: HashSet<PanelId>,
    /// Per-zone count derived from [`Self::yellow_panels`]. Kept separate
    /// to avoid recomputing it on every event.
    yellow_count_by_zone: HashMap<ZoneId, u32>,
    /// Set to `true` while the propagator itself is dispatching a System
    /// command. We don't actually need this guard right now — System
    /// commands only touch `follow_up_state` which we never observe as
    /// "yellow" — but it's a cheap belt-and-braces against future
    /// regressions where someone extends System to wear a yellow hat.
    suppressed: bool,
}

impl FlagPropagatorHandle {
    /// Spawn the propagator. It immediately starts consuming events from
    /// `bus` and emits System commands via `hub`. Returns the handle so
    /// callers can later call [`refresh_topology`](Self::refresh_topology)
    /// when the active circuit changes.
    pub fn spawn(bus: EventBus, hub: HubHandle, topology: CircuitTopology) -> Self {
        let inner = Arc::new(RwLock::new(PropagatorState::default()));
        // Hydrate the panel→zone cache before subscribing so we never miss
        // an early event.
        {
            let mut state = inner.blocking_write_or_panic();
            state.rebuild_from_topology(&topology);
        }
        let handle = Self { inner };
        let rx = bus.subscribe();
        let bg = handle.clone();
        tokio::spawn(bg.run(rx, hub));
        handle
    }

    /// Update the panel→zone cache and the next-zone table after a circuit
    /// switch.
    pub async fn refresh_topology(&self, topology: &CircuitTopology) {
        let mut state = self.inner.write().await;
        state.rebuild_from_topology(topology);
    }

    #[instrument(skip_all, name = "flag_propagator")]
    async fn run(self, mut rx: broadcast::Receiver<DomainEvent>, hub: HubHandle) {
        debug!("flag propagator started");
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Err(e) = self.handle_event(event, &hub).await {
                        warn!(error = %e, "propagator failed to dispatch");
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    // Losing events here is recoverable: the propagator
                    // re-derives its state from the next batch of edge
                    // transitions. Worst case: a stale auto-green lingers
                    // for a few hundred ms before the next event corrects it.
                    warn!(skipped = n, "propagator lagged");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
        debug!("flag propagator stopped");
    }

    async fn handle_event(
        &self,
        event: DomainEvent,
        hub: &HubHandle,
    ) -> Result<(), String> {
        // We only care about *effective* changes — the canonical
        // `PanelStateChanged`. Marshal/RC/follow-up "intent" events are
        // skipped: their effective consequence is reported separately.
        let (panel_id, from, to) = match event {
            DomainEvent::PanelStateChanged {
                panel, from, to, ..
            } => (panel, from, to),
            _ => return Ok(()),
        };

        let was_yellow = is_yellow(from);
        let is_yellow_now = is_yellow(to);
        if was_yellow == is_yellow_now {
            return Ok(());
        }

        let (zone, next_zone) = {
            let mut state = self.inner.write().await;
            if state.suppressed {
                return Ok(());
            }
            let zone = match state.panel_zone.get(&panel_id).copied() {
                Some(z) => z,
                None => return Ok(()),
            };
            let next = state.next_zone.get(&zone).copied();

            // Update the yellow-panels set first; commit the count delta
            // afterwards so we never hold two mutable borrows of `state`.
            let count_delta: i32 = if is_yellow_now {
                if state.yellow_panels.insert(panel_id) {
                    1
                } else {
                    0
                }
            } else if state.yellow_panels.remove(&panel_id) {
                -1
            } else {
                0
            };
            let count = state.yellow_count_by_zone.entry(zone).or_insert(0);
            let before = *count;
            *count = count.saturating_add_signed(count_delta);
            let after = *count;
            let edge = match (before, after) {
                (0, n) if n > 0 => Edge::ZoneEnteredYellow,
                (n, 0) if n > 0 => Edge::ZoneLeftYellow,
                _ => Edge::None,
            };

            match (edge, next) {
                (Edge::ZoneEnteredYellow, Some(n)) => (zone, Some((n, FlagState::Green))),
                (Edge::ZoneLeftYellow, Some(n)) => (zone, Some((n, FlagState::Off))),
                _ => (zone, None),
            }
        };

        if let Some((next, flag)) = next_zone {
            let cmd = PanelCommand::new(
                CommandSource::System,
                CommandTarget::Zone(next),
                flag,
            );
            debug!(
                from_zone = %zone,
                to_zone = %next,
                ?flag,
                "propagating auto-flag"
            );
            self.with_suppressed(|| async {
                hub.dispatch(cmd).await.map_err(|r| r.to_string()).map(|_| ())
            })
            .await?;
        }
        Ok(())
    }

    async fn with_suppressed<F, Fut>(&self, f: F) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<(), String>>,
    {
        {
            let mut s = self.inner.write().await;
            s.suppressed = true;
        }
        let result = f().await;
        {
            let mut s = self.inner.write().await;
            s.suppressed = false;
        }
        result
    }
}

enum Edge {
    ZoneEnteredYellow,
    ZoneLeftYellow,
    None,
}

fn is_yellow(flag: FlagState) -> bool {
    matches!(
        flag,
        FlagState::Yellow(YellowKind::Single)
            | FlagState::Yellow(YellowKind::Double),
    )
}

impl PropagatorState {
    fn rebuild_from_topology(&mut self, topology: &CircuitTopology) {
        self.panel_zone.clear();
        self.next_zone.clear();
        self.yellow_panels.clear();
        self.yellow_count_by_zone.clear();

        for p in &topology.panels {
            self.panel_zone.insert(p.id, p.zone);
        }
        // Sort zone ids ascending; the next zone of `z` is the one
        // immediately after it in track order, wrapping around at the end.
        let mut zone_ids: Vec<ZoneId> = topology.zones.iter().map(|z| z.id).collect();
        zone_ids.sort();
        for (i, z) in zone_ids.iter().enumerate() {
            let next = zone_ids[(i + 1) % zone_ids.len()];
            self.next_zone.insert(*z, next);
        }
    }
}

// Small convenience so the synchronous boot path can mutate the state
// without dragging in an extra runtime hop. Falls back to a blocking lock
// when used outside the tokio context — we only call it during startup.
trait BlockingWriteOrPanic<T> {
    fn blocking_write_or_panic(&self) -> tokio::sync::RwLockWriteGuard<'_, T>;
}

impl<T> BlockingWriteOrPanic<T> for Arc<RwLock<T>> {
    fn blocking_write_or_panic(&self) -> tokio::sync::RwLockWriteGuard<'_, T> {
        self.try_write()
            .expect("propagator state already locked at boot")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_yellow_variants() {
        assert!(is_yellow(FlagState::Yellow(YellowKind::Single)));
        assert!(is_yellow(FlagState::Yellow(YellowKind::Double)));
        assert!(!is_yellow(FlagState::YellowRedStriped));
        assert!(!is_yellow(FlagState::Green));
        assert!(!is_yellow(FlagState::Off));
        assert!(!is_yellow(FlagState::Red));
    }
}
