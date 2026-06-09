//! `PanelActor` — one task per physical light panel.
//!
//! Owns the [`Panel`] aggregate and applies [`PanelCommand`]s via the pure
//! state machine in `tsp-core`. Persists every resulting [`DomainEvent`] to
//! the [`EventStore`] **before** publishing it on the [`EventBus`], so any UI
//! subscriber that joins later via a snapshot + tail reads a consistent
//! history.

use std::sync::Arc;

use chrono::Utc;
use tokio::sync::{mpsc, oneshot};
use tracing::{debug, error, info, instrument, warn};

use tsp_core::{
    apply_command, CommandRejection, DomainEvent, EventId, HardwareHealth, Panel,
    PanelCommand, PanelId,
};
use tsp_eventstore::EventStore;

use crate::bus::EventBus;

/// Public message type accepted by a [`PanelActor`].
#[derive(Debug)]
pub enum PanelMessage {
    /// Apply a command and report the outcome.
    Apply {
        command: PanelCommand,
        reply: oneshot::Sender<Result<PanelOutcome, CommandRejection>>,
    },
    /// Snapshot the current panel state.
    Snapshot {
        reply: oneshot::Sender<Panel>,
    },
    /// Inspect hardware health (used by the diagnostic supervisor).
    Probe {
        reply: oneshot::Sender<HardwareHealth>,
    },
    /// Fault injection — tests / simulator only.
    InjectFault(Fault),
    /// Gracefully shut down the actor.
    Shutdown,
}

pub use tsp_core::Fault;

/// Result of a successful command application.
#[derive(Debug, Clone)]
pub struct PanelOutcome {
    pub panel: Panel,
    pub events: Vec<DomainEvent>,
}

/// Inbox + sugar for talking to a `PanelActor` from anywhere.
#[derive(Debug, Clone)]
pub struct PanelHandle {
    pub id: PanelId,
    tx: mpsc::Sender<PanelMessage>,
}

impl PanelHandle {
    pub async fn apply(&self, command: PanelCommand) -> Result<PanelOutcome, CommandRejection> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(PanelMessage::Apply { command, reply }).await;
        rx.await.expect("panel actor dropped before responding")
    }

    pub async fn snapshot(&self) -> Panel {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(PanelMessage::Snapshot { reply }).await;
        rx.await.expect("panel actor dropped before responding")
    }

    pub async fn probe(&self) -> HardwareHealth {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(PanelMessage::Probe { reply }).await;
        rx.await.expect("panel actor dropped before responding")
    }

    pub async fn inject_fault(&self, fault: Fault) {
        let _ = self.tx.send(PanelMessage::InjectFault(fault)).await;
    }

    pub async fn shutdown(&self) {
        let _ = self.tx.send(PanelMessage::Shutdown).await;
    }
}

/// State and behaviour of the `PanelActor`.
pub struct PanelActor {
    panel: Panel,
    bus: EventBus,
    store: Arc<dyn EventStore>,
    rx: mpsc::Receiver<PanelMessage>,
    /// When true, the panel pretends to be offline: the supervisor probe
    /// returns the (old) stored timestamp instead of refreshing it.
    handshake_blocked: bool,
}

impl PanelActor {
    pub fn spawn(panel: Panel, bus: EventBus, store: Arc<dyn EventStore>) -> PanelHandle {
        let id = panel.id;
        let (tx, rx) = mpsc::channel(64);
        let actor = PanelActor {
            panel,
            bus,
            store,
            rx,
            handshake_blocked: false,
        };
        tokio::spawn(actor.run());
        PanelHandle { id, tx }
    }

    #[instrument(skip(self), fields(panel = %self.panel.id))]
    async fn run(mut self) {
        info!("panel actor started");
        while let Some(msg) = self.rx.recv().await {
            match msg {
                PanelMessage::Apply { command, reply } => {
                    let outcome = self.handle_apply(command).await;
                    let _ = reply.send(outcome);
                }
                PanelMessage::Snapshot { reply } => {
                    let _ = reply.send(self.panel.clone());
                }
                PanelMessage::Probe { reply } => {
                    // A successful probe response IS the handshake. The
                    // supervisor sees the timestamp it ships back, so we
                    // record "now" only if no `StaleHandshake` fault is
                    // currently masking the line.
                    if !self.handshake_blocked {
                        self.panel.hardware.last_handshake = Utc::now();
                    }
                    let _ = reply.send(self.panel.hardware.clone());
                }
                PanelMessage::InjectFault(f) => {
                    self.apply_fault(f);
                }
                PanelMessage::Shutdown => break,
            }
        }
        info!("panel actor stopped");
    }

    async fn handle_apply(
        &mut self,
        command: PanelCommand,
    ) -> Result<PanelOutcome, CommandRejection> {
        let now = Utc::now();
        match apply_command(self.panel.clone(), &command, now) {
            Ok((next, events)) => {
                self.panel = next.clone();
                for ev in &events {
                    if let Err(e) = self.store.append(ev.clone()).await {
                        error!(error = %e, "failed to persist event");
                    }
                    self.bus.publish(ev.clone());
                }
                debug!(panel = %self.panel.id, state = ?self.panel.effective_state, "command applied");
                Ok(PanelOutcome { panel: next, events })
            }
            Err((unchanged, rejection)) => {
                self.panel = unchanged;
                let rejection_event = DomainEvent::CommandRejected {
                    id: EventId::new(),
                    command_id: command.id,
                    reason: rejection.clone(),
                    timestamp: now,
                };
                if let Err(e) = self.store.append(rejection_event.clone()).await {
                    error!(error = %e, "failed to persist rejection");
                }
                self.bus.publish(rejection_event);
                warn!(reason = %rejection, "command rejected");
                Err(rejection)
            }
        }
    }

    fn apply_fault(&mut self, fault: Fault) {
        match fault {
            Fault::SetPsuVoltage(v) => self.panel.hardware.psu_voltage = v,
            Fault::SetTemperature(t) => self.panel.hardware.temperature_c = t,
            Fault::AddLedFailure(led) => {
                if !self.panel.hardware.led_failures.contains(&led) {
                    self.panel.hardware.led_failures.push(led);
                }
            }
            Fault::ClearLedFailures => self.panel.hardware.led_failures.clear(),
            Fault::StaleHandshake { offset_ms } => {
                let now = Utc::now();
                self.panel.hardware.last_handshake =
                    now - chrono::Duration::milliseconds(offset_ms);
                self.handshake_blocked = true;
            }
        }
        debug!(hardware = ?self.panel.hardware, "fault applied");
    }
}
