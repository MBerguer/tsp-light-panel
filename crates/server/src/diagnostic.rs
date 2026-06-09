//! Diagnostic supervisor.
//!
//! Periodically probes each [`PanelActor`] for [`HardwareHealth`] and turns
//! out-of-range readings into [`DiagnosticAlert`]s on the event bus.
//!
//! Mirrors the *"continuous query of power supply units, temperature sensors,
//! and individual LED driver circuits"* loop described in FIA 3504-2019 §6.
//!
//! The supervisor maintains a set of **active alerts** per panel so it only
//! re-emits a [`DomainEvent::DiagnosticAlertRaised`] on edge transitions
//! (healthy → degraded) and emits a matching `DiagnosticAlertCleared` when
//! the condition returns to nominal.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tokio::sync::Mutex;
use tracing::{debug, info, instrument};

use tsp_core::{
    DiagnosticAlert, DiagnosticSeverity, DomainEvent, EventId, HardwareHealth, PanelId,
};
use tsp_eventstore::EventStore;

use crate::actors::panel::PanelHandle;
use crate::bus::EventBus;

/// Distinct alert categories used as keys in the supervisor's active-alert
/// table — so we can clear them individually.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AlertKind {
    Psu,
    Temperature,
    Led,
    Handshake,
}

#[derive(Debug, Clone)]
pub struct DiagnosticConfig {
    pub poll_interval: Duration,
    pub include_repeater: bool,
}

impl Default for DiagnosticConfig {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_millis(500),
            include_repeater: true,
        }
    }
}

pub struct DiagnosticSupervisor {
    panels: Vec<PanelHandle>,
    bus: EventBus,
    store: Arc<dyn EventStore>,
    config: DiagnosticConfig,
    active: Mutex<HashMap<PanelId, HashMap<AlertKind, DiagnosticAlert>>>,
}

impl DiagnosticSupervisor {
    pub fn new(
        panels: Vec<PanelHandle>,
        bus: EventBus,
        store: Arc<dyn EventStore>,
        config: DiagnosticConfig,
    ) -> Self {
        Self {
            panels,
            bus,
            store,
            config,
            active: Mutex::new(HashMap::new()),
        }
    }

    /// Spawn the supervision loop. Returns immediately.
    pub fn spawn(self: Arc<Self>) {
        tokio::spawn(async move {
            self.run_loop().await;
        });
    }

    /// Run a single probe sweep — useful for deterministic tests.
    pub async fn tick(&self) {
        let now = Utc::now();
        for handle in &self.panels {
            let hw = handle.probe().await;
            self.evaluate(handle.id, &hw, now).await;
        }
    }

    #[instrument(skip(self))]
    async fn run_loop(self: Arc<Self>) {
        info!("diagnostic supervisor started");
        let mut interval = tokio::time::interval(self.config.poll_interval);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            self.tick().await;
        }
    }

    async fn evaluate(&self, panel: PanelId, hw: &HardwareHealth, now: chrono::DateTime<chrono::Utc>) {
        let mut active = self.active.lock().await;
        let entry = active.entry(panel).or_default();

        self.evaluate_psu(panel, hw, entry).await;
        self.evaluate_temp(panel, hw, entry).await;
        self.evaluate_leds(panel, hw, entry).await;
        self.evaluate_handshake(panel, hw, entry, now).await;
    }

    async fn raise(&self, alert: DiagnosticAlert) {
        let ev = DomainEvent::DiagnosticAlertRaised {
            id: EventId::new(),
            alert: alert.clone(),
            timestamp: Utc::now(),
        };
        if let Err(e) = self.store.append(ev.clone()).await {
            tracing::error!(error = %e, "failed to persist alert");
        }
        self.bus.publish(ev);
        debug!(?alert, "alert raised");
    }

    async fn clear(&self, alert: DiagnosticAlert) {
        let ev = DomainEvent::DiagnosticAlertCleared {
            id: EventId::new(),
            alert: alert.clone(),
            timestamp: Utc::now(),
        };
        if let Err(e) = self.store.append(ev.clone()).await {
            tracing::error!(error = %e, "failed to persist clear");
        }
        self.bus.publish(ev);
        debug!(?alert, "alert cleared");
    }

    async fn evaluate_psu(
        &self,
        panel: PanelId,
        hw: &HardwareHealth,
        entry: &mut HashMap<AlertKind, DiagnosticAlert>,
    ) {
        let severity = if hw.psu_voltage < HardwareHealth::PSU_MIN_VOLTAGE - 3.0
            || hw.psu_voltage > HardwareHealth::PSU_MAX_VOLTAGE + 3.0
        {
            Some(DiagnosticSeverity::Critical)
        } else if !hw.is_psu_healthy() {
            Some(DiagnosticSeverity::Warning)
        } else {
            None
        };
        match severity {
            Some(sev) => {
                let new = DiagnosticAlert::PsuOutOfRange {
                    panel,
                    voltage: hw.psu_voltage,
                    severity: sev,
                };
                if entry.get(&AlertKind::Psu) != Some(&new) {
                    entry.insert(AlertKind::Psu, new.clone());
                    self.raise(new).await;
                }
            }
            None => {
                if let Some(prev) = entry.remove(&AlertKind::Psu) {
                    self.clear(prev).await;
                }
            }
        }
    }

    async fn evaluate_temp(
        &self,
        panel: PanelId,
        hw: &HardwareHealth,
        entry: &mut HashMap<AlertKind, DiagnosticAlert>,
    ) {
        let severity = if hw.temperature_c >= HardwareHealth::TEMP_CRIT_C {
            Some(DiagnosticSeverity::Critical)
        } else if hw.temperature_c >= HardwareHealth::TEMP_WARN_C {
            Some(DiagnosticSeverity::Warning)
        } else {
            None
        };
        match severity {
            Some(sev) => {
                let new = DiagnosticAlert::Overtemperature {
                    panel,
                    celsius: hw.temperature_c,
                    severity: sev,
                };
                if entry.get(&AlertKind::Temperature) != Some(&new) {
                    entry.insert(AlertKind::Temperature, new.clone());
                    self.raise(new).await;
                }
            }
            None => {
                if let Some(prev) = entry.remove(&AlertKind::Temperature) {
                    self.clear(prev).await;
                }
            }
        }
    }

    async fn evaluate_leds(
        &self,
        panel: PanelId,
        hw: &HardwareHealth,
        entry: &mut HashMap<AlertKind, DiagnosticAlert>,
    ) {
        if hw.led_failures.is_empty() {
            if let Some(prev) = entry.remove(&AlertKind::Led) {
                self.clear(prev).await;
            }
            return;
        }
        let severity = if hw.led_failures.len() > 10 {
            DiagnosticSeverity::Critical
        } else if hw.led_failures.len() > 3 {
            DiagnosticSeverity::Warning
        } else {
            DiagnosticSeverity::Info
        };
        let new = DiagnosticAlert::LedFailure {
            panel,
            leds: hw.led_failures.clone(),
            severity,
        };
        if entry.get(&AlertKind::Led) != Some(&new) {
            entry.insert(AlertKind::Led, new.clone());
            self.raise(new).await;
        }
    }

    async fn evaluate_handshake(
        &self,
        panel: PanelId,
        hw: &HardwareHealth,
        entry: &mut HashMap<AlertKind, DiagnosticAlert>,
        now: chrono::DateTime<chrono::Utc>,
    ) {
        let elapsed = now.signed_duration_since(hw.last_handshake).num_milliseconds();
        if elapsed >= HardwareHealth::HANDSHAKE_TIMEOUT_MS {
            let new = DiagnosticAlert::HandshakeTimeout {
                panel,
                elapsed_ms: elapsed,
                severity: DiagnosticSeverity::Critical,
            };
            if entry.get(&AlertKind::Handshake) != Some(&new) {
                entry.insert(AlertKind::Handshake, new.clone());
                self.raise(new).await;
            }
        } else if let Some(prev) = entry.remove(&AlertKind::Handshake) {
            self.clear(prev).await;
        }
    }
}
