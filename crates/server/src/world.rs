//! High-level convenience builder that wires together a working "world":
//! event store + event bus + hub + a set of `PanelActor`s + diagnostic
//! supervisor. Tests, the simulator (Phase 2) and the binary entry point
//! (Phase 3) all build a [`World`] and then either interact with it
//! programatically or expose it over WebSockets.

use std::sync::Arc;

use chrono::Utc;
use tokio::sync::RwLock;
use tsp_core::{Panel, PanelId, SectorId, TrackPosition, TrackSide, ZoneId};
use tsp_eventstore::{EventStore, InMemoryEventStore};

use crate::actors::ecu::{EcuActor, EcuHandle, PanelDirectory};
use crate::actors::marshal::{MarshalActor, MarshalHandle};
use crate::actors::panel::PanelHandle;
use crate::actors::race_control::{RaceControlActor, RaceControlHandle};
use crate::bus::EventBus;
use crate::car_registry::CarRegistry;
use crate::diagnostic::{DiagnosticConfig, DiagnosticSupervisor};
use crate::dispatch::{spawn_and_register, Hub};
use crate::flag_propagator::FlagPropagatorHandle;
use crate::topology::CircuitTopology;

/// All the moving parts of a running simulation, owned by a single value.
pub struct World {
    pub bus: EventBus,
    pub store: Arc<dyn EventStore>,
    pub hub: Hub,
    pub directory: Arc<PanelDirectory>,
    pub cars: CarRegistry,
    topology: Arc<RwLock<CircuitTopology>>,
    diagnostic_config: Arc<RwLock<DiagnosticConfig>>,
    ecus: Arc<RwLock<Vec<EcuHandle>>>,
    diagnostic: Arc<RwLock<Option<Arc<DiagnosticSupervisor>>>>,
    flag_propagator: Arc<RwLock<Option<FlagPropagatorHandle>>>,
}

impl World {
    /// Build an in-memory world. Convenience used by tests and the simulator.
    pub fn in_memory() -> Self {
        Self::with_store(InMemoryEventStore::shared())
    }

    /// Build with a custom store (e.g. JSONL on disk for the binary).
    pub fn with_store(store: Arc<dyn EventStore>) -> Self {
        let bus = EventBus::default();
        let cars = CarRegistry::new();
        cars.spawn(&bus);
        Self {
            bus,
            store,
            hub: Hub::new(),
            directory: Arc::new(PanelDirectory::new()),
            cars,
            topology: Arc::new(RwLock::new(CircuitTopology::demo())),
            diagnostic_config: Arc::new(RwLock::new(DiagnosticConfig::default())),
            ecus: Arc::new(RwLock::new(Vec::new())),
            diagnostic: Arc::new(RwLock::new(None)),
            flag_propagator: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn active_topology(&self) -> CircuitTopology {
        self.topology.read().await.clone()
    }

    pub async fn set_active_topology(&self, topology: CircuitTopology) {
        *self.topology.write().await = topology;
    }

    /// One-shot bootstrap: spawn every panel, marshal post and ECU described
    /// by `topology`. Falls back to legacy heuristics when the topology
    /// doesn't ship explicit `posts` / `drivers` (so the procedural circuits
    /// keep working).
    pub async fn bootstrap_from_topology(&self, topology: &CircuitTopology) {
        self.set_active_topology(topology.clone()).await;

        let layout: Vec<(u32, u32, u32, f32)> = topology
            .panels
            .iter()
            .map(|p| (p.id.raw(), p.zone.raw(), p.sector.raw(), p.distance_m))
            .collect();
        self.bootstrap_circuit(&layout).await;

        if topology.posts.is_empty() {
            for zone in topology.zones.iter() {
                let _ = self.spawn_marshal(tsp_core::PostId::new(zone.id.raw()));
            }
        } else {
            for post in topology.posts.iter() {
                let _ = self.spawn_marshal(post.id);
            }
        }

        if topology.drivers.is_empty() {
            let _ = self.spawn_ecu(tsp_core::CarNumber::new(44), None).await;
            let _ = self.spawn_ecu(tsp_core::CarNumber::new(16), None).await;
        } else {
            for driver in topology.drivers.iter() {
                let _ = self.spawn_ecu(driver.number, driver.initial_zone).await;
            }
        }

        // FIA "green after yellow" propagator. Subscribes to the bus and
        // emits `CommandSource::System` Green / Off commands at the zone
        // immediately downstream of any zone that just entered / left a
        // yellow state.
        let mut prop_slot = self.flag_propagator.write().await;
        if let Some(existing) = prop_slot.as_ref() {
            existing.refresh_topology(topology).await;
        } else {
            *prop_slot = Some(FlagPropagatorHandle::spawn(
                self.bus.clone(),
                self.hub.handle(),
                topology.clone(),
            ));
        }
    }

    /// Spawn a new panel actor and register it in both the hub and the
    /// panel ↔ zone directory used by ECUs.
    pub async fn spawn_panel(&self, panel: Panel) -> PanelHandle {
        let id = panel.id;
        let zone = panel.zone;
        self.directory.insert(id, zone);
        spawn_and_register(&self.hub, panel, self.bus.clone(), self.store.clone()).await
    }

    /// Spawn one panel per `(panel_id, zone, sector, distance_m)` tuple. Used
    /// to bootstrap a test circuit quickly.
    pub async fn bootstrap_circuit(&self, layout: &[(u32, u32, u32, f32)]) -> Vec<PanelHandle> {
        let now = Utc::now();
        let mut out = Vec::with_capacity(layout.len());
        for &(panel, zone, sector, distance) in layout {
            let p = Panel::powered_up(
                PanelId::new(panel),
                ZoneId::new(zone),
                SectorId::new(sector),
                TrackPosition::new(distance, TrackSide::Outside),
                now,
            );
            out.push(self.spawn_panel(p).await);
        }
        out
    }

    pub fn spawn_race_control(&self, operator: tsp_core::OperatorId) -> RaceControlHandle {
        RaceControlActor::spawn(operator, self.hub.handle())
    }

    pub fn spawn_marshal(&self, post: tsp_core::PostId) -> MarshalHandle {
        MarshalActor::spawn(post, self.hub.handle())
    }

    pub async fn spawn_ecu(
        &self,
        car: tsp_core::CarNumber,
        initial_zone: Option<ZoneId>,
    ) -> EcuHandle {
        let handle = EcuActor::spawn(
            car,
            initial_zone,
            self.directory.clone(),
            self.bus.clone(),
            self.store.clone(),
        );
        self.cars.upsert_initial(car, initial_zone).await;
        self.ecus.write().await.push(handle.clone());
        handle
    }

    /// Read-only view of every ECU registered. Used by the scenario runtime
    /// to dispatch car-movement steps.
    pub async fn ecu_handles(&self) -> Vec<EcuHandle> {
        self.ecus.read().await.clone()
    }

    /// Build and *return* the diagnostic supervisor without spawning it.
    /// Callers either `spawn()` it or call `tick()` manually in tests.
    pub async fn build_diagnostic(&self, config: DiagnosticConfig) -> Arc<DiagnosticSupervisor> {
        let panels = self.hub.all_handles().await;
        *self.diagnostic_config.write().await = config.clone();
        let sv = Arc::new(DiagnosticSupervisor::new(
            panels,
            self.bus.clone(),
            self.store.clone(),
            config,
        ));
        *self.diagnostic.write().await = Some(sv.clone());
        sv
    }

    /// Tear down the current panel grid and spawn a fresh one for the given
    /// topology. Marshals and ECUs are also re-spawned from `topology.posts`
    /// and `topology.drivers` so a circuit switch is a clean event-driven
    /// reset.
    pub async fn switch_circuit(&self, topology: CircuitTopology) {
        for h in self.hub.all_handles().await {
            h.shutdown().await;
        }
        self.hub.clear().await;
        self.directory.clear();
        self.cars.clear().await;
        self.ecus.write().await.clear();

        self.bootstrap_from_topology(&topology).await;

        if self.diagnostic.read().await.is_some() {
            let config = self.diagnostic_config.read().await.clone();
            let panels = self.hub.all_handles().await;
            let sv = Arc::new(DiagnosticSupervisor::new(
                panels,
                self.bus.clone(),
                self.store.clone(),
                config,
            ));
            *self.diagnostic.write().await = Some(sv.clone());
            Arc::clone(&sv).spawn();
        }
    }

    pub async fn diagnostic_supervisor(&self) -> Option<Arc<DiagnosticSupervisor>> {
        self.diagnostic.read().await.clone()
    }
}
