//! Global event bus.
//!
//! A thin wrapper around [`tokio::sync::broadcast`] so every actor (panel,
//! ECU, diagnostic supervisor, WS gateway, event store) can subscribe to the
//! same stream of [`DomainEvent`]s without coupling to each other.

use tokio::sync::broadcast;
use tracing::warn;
use tsp_core::DomainEvent;

/// Buffer kept by the broadcast channel. If a slow subscriber lags behind
/// more than this it will receive `RecvError::Lagged` instead of crashing —
/// fine for the UI, the event store has its own back-pressure path.
pub const DEFAULT_CAPACITY: usize = 1024;

/// Sender half of the global event bus. Cheap to clone.
#[derive(Debug, Clone)]
pub struct EventBus {
    tx: broadcast::Sender<DomainEvent>,
}

impl EventBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self { tx }
    }

    /// Returns the number of currently-attached subscribers.
    pub fn subscribers(&self) -> usize {
        self.tx.receiver_count()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<DomainEvent> {
        self.tx.subscribe()
    }

    /// Publish an event. Logs (does not panic) when there are no subscribers.
    pub fn publish(&self, event: DomainEvent) {
        match self.tx.send(event) {
            Ok(n) => tracing::trace!(subscribers = n, "bus publish"),
            Err(_) => warn!("event bus publish with no subscribers"),
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}
