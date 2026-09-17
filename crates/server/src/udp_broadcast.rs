//! UDP broadcaster for physical LED panels (e.g. ESP32-S3 HUB75 controllers).
//!
//! Broadcasts panel state changes in real-time over UDP to the trackside network,
//! plus a periodic heartbeat so newly powered-on panels immediately synchronize.

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::net::UdpSocket;
use tracing::{debug, error, info, warn};
use tsp_core::{DomainEvent, FlagState};

use crate::World;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum UdpPacket {
    FlagChange {
        panel: u32,
        flag: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        sub: Option<String>,
        seq: u64,
    },
    Heartbeat {
        circuit: String,
        panels: Vec<UdpPanelSummary>,
        seq: u64,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct UdpPanelSummary {
    pub p: u32,
    pub f: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub s: Option<String>,
}

pub fn flag_to_strings(flag: FlagState) -> (String, Option<String>) {
    match flag {
        FlagState::Off => ("off".into(), None),
        FlagState::Green => ("green".into(), None),
        FlagState::Yellow(kind) => {
            let sub = match kind {
                tsp_core::YellowKind::Single => "single",
                tsp_core::YellowKind::Double => "double",
            };
            ("yellow".into(), Some(sub.into()))
        }
        FlagState::Blue | FlagState::CustomBlue => ("blue".into(), None),
        FlagState::White => ("white".into(), None),
        FlagState::YellowRedStriped => ("slippery".into(), None),
        FlagState::Rain => ("rain".into(), None),
        FlagState::Red => ("red".into(), None),
        FlagState::Chequered => ("chequered".into(), None),
        FlagState::SafetyCar => ("safety_car".into(), None),
        FlagState::VirtualSafetyCar => ("vsc".into(), None),
        FlagState::VscEnding => ("vsc_ending".into(), None),
        FlagState::Code60 => ("code60".into(), None),
        FlagState::FullCourseYellow => ("fcy".into(), None),
        _ => (format!("{:?}", flag).to_lowercase(), None),
    }
}

/// Spawns the background UDP broadcaster.
pub fn spawn_udp_broadcaster(world: Arc<World>, target: SocketAddr) {
    tokio::spawn(async move {
        // Bind to any ephemeral UDP port
        let socket = match UdpSocket::bind("0.0.0.0:0").await {
            Ok(s) => Arc::new(s),
            Err(err) => {
                error!(?err, "failed to bind UDP broadcast socket");
                return;
            }
        };

        if let Err(err) = socket.set_broadcast(true) {
            warn!(?err, "could not enable SO_BROADCAST on UDP socket");
        }

        info!(%target, "UDP panel broadcaster active");

        let mut event_rx = world.bus.subscribe();
        let mut seq: u64 = 0;
        let mut heartbeat_interval = tokio::time::interval(Duration::from_millis(1000));

        loop {
            tokio::select! {
                // 1. Immediate Flag Change broadcast on DomainEvent
                Ok(event) = event_rx.recv() => {
                    if let DomainEvent::PanelStateChanged { panel, to, .. } = event {
                        seq = seq.wrapping_add(1);
                        let (flag, sub) = flag_to_strings(to);
                        let packet = UdpPacket::FlagChange {
                            panel: panel.raw(),
                            flag,
                            sub,
                            seq,
                        };
                        if let Ok(bytes) = serde_json::to_vec(&packet) {
                            let _ = socket.send_to(&bytes, target).await;
                            debug!(panel = %panel.raw(), %seq, "sent UDP flag change");
                        }
                    }
                }

                // 2. Periodic Heartbeat with full panel snapshot
                _ = heartbeat_interval.tick() => {
                    seq = seq.wrapping_add(1);
                    let circuit_name = world.active_topology().await.name;
                    let handles = world.hub.all_handles().await;
                    let mut panels_summary = Vec::with_capacity(handles.len());

                    for handle in handles {
                        let panel = handle.snapshot().await;
                        let (flag, sub) = flag_to_strings(panel.effective_state);
                        panels_summary.push(UdpPanelSummary {
                            p: panel.id.raw(),
                            f: flag,
                            s: sub,
                        });
                    }

                    // Sort by panel ID for deterministic payloads
                    panels_summary.sort_by_key(|p| p.p);

                    let packet = UdpPacket::Heartbeat {
                        circuit: circuit_name,
                        panels: panels_summary,
                        seq,
                    };

                    if let Ok(bytes) = serde_json::to_vec(&packet) {
                        let _ = socket.send_to(&bytes, target).await;
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_flag_to_strings_mappings() {
        let (flag, sub) = flag_to_strings(FlagState::Green);
        assert_eq!(flag, "green");
        assert_eq!(sub, None);

        let (flag, sub) = flag_to_strings(FlagState::Yellow(tsp_core::YellowKind::Double));
        assert_eq!(flag, "yellow");
        assert_eq!(sub, Some("double".into()));

        let (flag, sub) = flag_to_strings(FlagState::Red);
        assert_eq!(flag, "red");
        assert_eq!(sub, None);

        let (flag, sub) = flag_to_strings(FlagState::Rain);
        assert_eq!(flag, "rain");
        assert_eq!(sub, None);
    }

    #[test]
    fn test_udp_packet_serialization() {
        let packet = UdpPacket::FlagChange {
            panel: 3,
            flag: "yellow".into(),
            sub: Some("double".into()),
            seq: 42,
        };
        let json = serde_json::to_string(&packet).expect("serialize");
        assert!(json.contains("\"type\":\"flag_change\""));
        assert!(json.contains("\"panel\":3"));
        assert!(json.contains("\"sub\":\"double\""));
    }
}
