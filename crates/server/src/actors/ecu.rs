//! `EcuActor` — one per car. Subscribes to the [`crate::bus::EventBus`] and
//! mirrors the panel state of whatever zone the car is currently in onto the
//! virtual steering-wheel light strip.
//!
//! This closes the bi-directional telemetry loop described in the FIA
//! standard: every panel state change becomes a `EcuNotified` event for each
//! car in range.

use std::sync::Arc;

use chrono::Utc;
use tokio::sync::{broadcast, mpsc, RwLock};
use tracing::{debug, info, instrument};

use tsp_core::{CarNumber, DomainEvent, EventId, FlagState, PanelId, ZoneId};
use tsp_eventstore::EventStore;

use crate::bus::EventBus;

/// Lightweight registry: which panel belongs to which zone, so the ECU knows
/// when an event applies to its current zone. Shared between hub and ECUs.
#[derive(Debug, Default)]
pub struct PanelDirectory {
    /// `panel_id -> zone_id` reverse map.
    by_panel: dashmap::DashMap<PanelId, ZoneId>,
}

impl PanelDirectory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&self, panel: PanelId, zone: ZoneId) {
        self.by_panel.insert(panel, zone);
    }

    pub fn zone_of(&self, panel: PanelId) -> Option<ZoneId> {
        self.by_panel.get(&panel).map(|e| *e.value())
    }

    pub fn clear(&self) {
        self.by_panel.clear();
    }
}

#[derive(Debug)]
pub enum EcuMessage {
    /// The car physically moved into a new zone.
    EnterZone(ZoneId),
    /// The car left the track.
    Park,
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct EcuHandle {
    pub car: CarNumber,
    tx: mpsc::Sender<EcuMessage>,
}

impl EcuHandle {
    pub async fn enter_zone(&self, zone: ZoneId) {
        let _ = self.tx.send(EcuMessage::EnterZone(zone)).await;
    }

    pub async fn park(&self) {
        let _ = self.tx.send(EcuMessage::Park).await;
    }

    pub async fn shutdown(&self) {
        let _ = self.tx.send(EcuMessage::Shutdown).await;
    }
}

pub struct EcuActor {
    car: CarNumber,
    current_zone: Arc<RwLock<Option<ZoneId>>>,
    directory: Arc<PanelDirectory>,
    bus: EventBus,
    store: Arc<dyn EventStore>,
    rx: mpsc::Receiver<EcuMessage>,
}

impl EcuActor {
    pub fn spawn(
        car: CarNumber,
        initial_zone: Option<ZoneId>,
        directory: Arc<PanelDirectory>,
        bus: EventBus,
        store: Arc<dyn EventStore>,
    ) -> EcuHandle {
        let (tx, rx) = mpsc::channel(32);
        let current_zone = Arc::new(RwLock::new(initial_zone));
        let actor = EcuActor {
            car,
            current_zone,
            directory,
            bus: bus.clone(),
            store: store.clone(),
            rx,
        };
        if let Some(zone) = initial_zone {
            let event = DomainEvent::CarMoved {
                id: EventId::new(),
                car,
                from: None,
                to: Some(zone),
                timestamp: Utc::now(),
            };
            let store_for_init = store.clone();
            let bus_for_init = bus.clone();
            tokio::spawn(async move {
                let _ = store_for_init.append(event.clone()).await;
                bus_for_init.publish(event);
            });
        }
        tokio::spawn(actor.run());
        EcuHandle { car, tx }
    }

    #[instrument(skip(self), fields(car = %self.car))]
    async fn run(mut self) {
        info!("ecu actor started");
        let mut events = self.bus.subscribe();
        loop {
            tokio::select! {
                Some(msg) = self.rx.recv() => {
                    match msg {
                        EcuMessage::EnterZone(z) => {
                            let from = {
                                let mut guard = self.current_zone.write().await;
                                let prev = *guard;
                                *guard = Some(z);
                                prev
                            };
                            self.emit_moved(from, Some(z)).await;
                            debug!(zone = %z, "car entered zone");
                        }
                        EcuMessage::Park => {
                            let from = {
                                let mut guard = self.current_zone.write().await;
                                let prev = *guard;
                                *guard = None;
                                prev
                            };
                            self.emit_moved(from, None).await;
                        }
                        EcuMessage::Shutdown => break,
                    }
                }
                ev = events.recv() => {
                    match ev {
                        Ok(event) => self.handle_event(event).await,
                        Err(broadcast::error::RecvError::Lagged(n)) => {
                            tracing::warn!(skipped = n, "ecu lagged on bus");
                        }
                        Err(broadcast::error::RecvError::Closed) => break,
                    }
                }
            }
        }
        info!("ecu actor stopped");
    }

    async fn emit_moved(&self, from: Option<ZoneId>, to: Option<ZoneId>) {
        if from == to {
            return;
        }
        let event = DomainEvent::CarMoved {
            id: EventId::new(),
            car: self.car,
            from,
            to,
            timestamp: Utc::now(),
        };
        if let Err(e) = self.store.append(event.clone()).await {
            tracing::error!(error = %e, "failed to persist car_moved");
        }
        self.bus.publish(event);
    }

    async fn handle_event(&self, event: DomainEvent) {
        let DomainEvent::PanelStateChanged { panel, to, .. } = event else {
            return;
        };
        let Some(zone) = self.directory.zone_of(panel) else {
            return;
        };
        let active = self.current_zone.read().await;
        // ECU shows globally-broadcast flags regardless of zone, and any
        // flag whose panel is in our current zone. Global broadcasts include
        // session-stop / end-of-session signals (Red, Chequered) and the
        // global procedural restrictions (FCY, Code 60, Standing/Rolling
        // Start) that apply to every car simultaneously.
        let is_global = to.is_global_only();
        if !is_global && Some(zone) != *active {
            return;
        }
        let notification = DomainEvent::EcuNotified {
            id: EventId::new(),
            car: self.car,
            zone,
            flag: to,
            timestamp: Utc::now(),
        };
        if let Err(e) = self.store.append(notification.clone()).await {
            tracing::error!(error = %e, "failed to persist ecu notification");
        }
        self.bus.publish(notification);
    }
}
