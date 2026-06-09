//! `Hub` — central dispatcher.
//!
//! Owns the routing tables (`PanelId`, `ZoneId`, `SectorId` indices) and is
//! the single entry point through which all commands reach the
//! [`PanelActor`]s. The hub itself is **not** an actor — it is a cheap-to-
//! clone handle backed by a shared `RwLock` so multiple senders (Race Control
//! actor, marshal actors, WS gateway) can dispatch concurrently.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::RwLock;
use tracing::{debug, instrument, warn};

use tsp_core::{CommandRejection, CommandTarget, PanelCommand, PanelId, SectorId, ZoneId};

use crate::actors::panel::{PanelActor, PanelHandle, PanelOutcome};

/// Cheap-to-clone handle for dispatching commands.
#[derive(Debug, Clone)]
pub struct HubHandle {
    inner: Arc<RwLock<HubInner>>,
}

#[derive(Debug, Default)]
struct HubInner {
    panels: HashMap<PanelId, PanelHandle>,
    by_zone: HashMap<ZoneId, Vec<PanelId>>,
    by_sector: HashMap<SectorId, Vec<PanelId>>,
}

/// Builder + control surface for the hub. Useful at startup and in tests.
#[derive(Debug, Clone)]
pub struct Hub {
    handle: HubHandle,
}

impl Hub {
    pub fn new() -> Self {
        Self {
            handle: HubHandle {
                inner: Arc::new(RwLock::new(HubInner::default())),
            },
        }
    }

    pub fn handle(&self) -> HubHandle {
        self.handle.clone()
    }

    /// Register a panel. Used by [`crate::world::World`] at startup and by the
    /// simulator when hot-loading scenarios.
    pub async fn register(
        &self,
        panel_id: PanelId,
        zone: ZoneId,
        sector: SectorId,
        handle: PanelHandle,
    ) {
        let mut inner = self.handle.inner.write().await;
        inner.panels.insert(panel_id, handle);
        inner.by_zone.entry(zone).or_default().push(panel_id);
        inner.by_sector.entry(sector).or_default().push(panel_id);
        debug!(%panel_id, %zone, %sector, "panel registered");
    }

    pub async fn panel_handle(&self, id: PanelId) -> Option<PanelHandle> {
        self.handle.inner.read().await.panels.get(&id).cloned()
    }

    pub async fn handles_by_zone(&self, zone: ZoneId) -> Vec<PanelHandle> {
        let inner = self.handle.inner.read().await;
        inner
            .by_zone
            .get(&zone)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.panels.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn handles_by_sector(&self, sector: SectorId) -> Vec<PanelHandle> {
        let inner = self.handle.inner.read().await;
        inner
            .by_sector
            .get(&sector)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| inner.panels.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn all_handles(&self) -> Vec<PanelHandle> {
        self.handle.inner.read().await.panels.values().cloned().collect()
    }

    pub async fn find(&self, panel: PanelId) -> Option<PanelHandle> {
        self.handle.inner.read().await.panels.get(&panel).cloned()
    }

    /// Remove every panel from the dispatcher. Used by the circuit switcher
    /// before installing a brand-new layout.
    pub async fn clear(&self) {
        let mut inner = self.handle.inner.write().await;
        inner.panels.clear();
        inner.by_zone.clear();
        inner.by_sector.clear();
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl HubHandle {
    /// Route a command to every panel it targets. Returns the number of
    /// panels that **accepted** the command (zero on full rejection or on an
    /// unknown target).
    ///
    /// Rejection rules:
    /// * If at least one panel rejects (and the target is single-panel), the
    ///   rejection is returned as `Err`.
    /// * If the target is multi-panel, rejections are logged but the dispatch
    ///   reports the number of accepts.
    #[instrument(skip(self, command), fields(target = ?command.target, flag = ?command.flag))]
    pub async fn dispatch(
        &self,
        command: PanelCommand,
    ) -> Result<usize, CommandRejection> {
        let targets = self.resolve_targets(&command.target).await;
        if targets.is_empty() {
            warn!("no panels matched target");
            return Ok(0);
        }

        let mut accepted = 0usize;
        let mut last_rejection: Option<CommandRejection> = None;
        for h in targets {
            match h.apply(command.clone()).await {
                Ok(PanelOutcome { .. }) => accepted += 1,
                Err(reason) => {
                    debug!(panel = %h.id, ?reason, "panel rejected command");
                    last_rejection = Some(reason);
                }
            }
        }

        if accepted == 0 {
            if let Some(reason) = last_rejection {
                return Err(reason);
            }
        }
        Ok(accepted)
    }

    async fn resolve_targets(&self, target: &CommandTarget) -> Vec<PanelHandle> {
        let inner = self.inner.read().await;
        match *target {
            CommandTarget::Global => inner.panels.values().cloned().collect(),
            CommandTarget::Sector(s) => inner
                .by_sector
                .get(&s)
                .map(|ids| {
                    ids.iter()
                        .filter_map(|id| inner.panels.get(id).cloned())
                        .collect()
                })
                .unwrap_or_default(),
            CommandTarget::Zone(z) => inner
                .by_zone
                .get(&z)
                .map(|ids| {
                    ids.iter()
                        .filter_map(|id| inner.panels.get(id).cloned())
                        .collect()
                })
                .unwrap_or_default(),
            CommandTarget::Panel(id) => inner
                .panels
                .get(&id)
                .cloned()
                .map(|h| vec![h])
                .unwrap_or_default(),
        }
    }
}

/// Convenience: spawn a [`PanelActor`] and register it with the hub in one
/// shot.
pub async fn spawn_and_register(
    hub: &Hub,
    panel: tsp_core::Panel,
    bus: crate::bus::EventBus,
    store: Arc<dyn tsp_eventstore::EventStore>,
) -> PanelHandle {
    let id = panel.id;
    let zone = panel.zone;
    let sector = panel.sector;
    let handle = PanelActor::spawn(panel, bus, store);
    hub.register(id, zone, sector, handle.clone()).await;
    handle
}
