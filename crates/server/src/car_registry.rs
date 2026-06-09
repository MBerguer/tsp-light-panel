//! Aggregated view of every car in the simulation.
//!
//! `CarRegistry` subscribes to the global [`EventBus`] and maintains a
//! `car_number → Car` map by folding `CarMoved` and `EcuNotified` events. The
//! UI uses this to render the moving dot overlay on the track map without
//! having to listen for partial events itself on (re)connection.

use std::collections::BTreeMap;
use std::sync::Arc;

use chrono::Utc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use tsp_core::{Car, CarNumber, DomainEvent, FlagState};

use crate::bus::EventBus;

#[derive(Debug, Default, Clone)]
pub struct CarRegistry {
    inner: Arc<RwLock<BTreeMap<CarNumber, Car>>>,
}

impl CarRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Spawn the background folder. Returns immediately.
    pub fn spawn(&self, bus: &EventBus) {
        let inner = self.inner.clone();
        let mut rx = bus.subscribe();
        tokio::spawn(async move {
            info!("car registry started");
            loop {
                match rx.recv().await {
                    Ok(event) => apply(&inner, &event).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!(skipped = n, "car registry lagged on bus");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                }
            }
        });
    }

    pub async fn upsert_initial(&self, car: CarNumber, zone: Option<tsp_core::ZoneId>) {
        let mut g = self.inner.write().await;
        g.entry(car).or_insert(Car {
            number: car,
            zone,
            last_flag: FlagState::Off,
            last_updated: Utc::now(),
        });
    }

    pub async fn snapshot(&self) -> Vec<Car> {
        self.inner.read().await.values().cloned().collect()
    }

    pub async fn clear(&self) {
        self.inner.write().await.clear();
    }
}

async fn apply(inner: &Arc<RwLock<BTreeMap<CarNumber, Car>>>, event: &DomainEvent) {
    match event {
        DomainEvent::CarMoved { car, to, timestamp, .. } => {
            let mut g = inner.write().await;
            let entry = g.entry(*car).or_insert(Car {
                number: *car,
                zone: None,
                last_flag: FlagState::Off,
                last_updated: *timestamp,
            });
            entry.zone = *to;
            entry.last_updated = *timestamp;
        }
        DomainEvent::EcuNotified { car, flag, timestamp, .. } => {
            let mut g = inner.write().await;
            let entry = g.entry(*car).or_insert(Car {
                number: *car,
                zone: None,
                last_flag: FlagState::Off,
                last_updated: *timestamp,
            });
            entry.last_flag = *flag;
            entry.last_updated = *timestamp;
        }
        _ => {}
    }
}
