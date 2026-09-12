//! WebSocket gateway between the UI and the actor system.
//!
//! Protocol is fully described by [`tsp_core::wire`]: every JSON frame is
//! either a [`ClientMessage`] (UI → server) or a [`ServerMessage`]
//! (server → UI). Connections start with a `Hello { role }` handshake; the
//! server replies with `Welcome` followed by a full `Snapshot` of every
//! panel currently registered in the [`Hub`].
//!
//! After the handshake the gateway:
//!
//! * forwards every [`DomainEvent`] on the [`EventBus`] to the client (with
//!   topic filtering driven by `Subscribe`);
//! * accepts `SubmitCommand` and dispatches it through the hub, returning a
//!   structured `Error` if the role does not permit the source/target;
//! * answers `Ping` with `Pong` keeping a client-side latency window.
//!
//! The handler uses a per-connection outbound `mpsc` channel so the bus
//! forwarder and the command-processing task can both push frames without
//! racing on the underlying `WebSocket` sender.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tracing::{debug, info, instrument, warn};

use dashmap::DashMap;

use tsp_core::wire::{
    CircuitCatalogueEntry, ClientMessage, ClientRole, ErrorCode, MarshalPresenceEntry,
    PanelSummary, ServerMessage, Topic,
};
use tsp_core::{
    CommandSource, CommandTarget, DiagnosticAlert, DomainEvent, FlagState, PanelCommand, PostId,
};

use crate::World;

/// Notification published whenever the active circuit changes.
#[derive(Debug, Clone)]
pub struct TopologyChanged {
    pub circuit_id: String,
    pub label: String,
}

/// Application state shared with every WS connection.
#[derive(Clone)]
pub struct GatewayState {
    pub world: Arc<World>,
    pub scenarios: Arc<crate::ScenarioController>,
    pub server_version: String,
    pub topology_changes: tokio::sync::broadcast::Sender<TopologyChanged>,
    pub roster: Arc<DashMap<PostId, MarshalPresenceEntry>>,
    pub roster_changes: tokio::sync::broadcast::Sender<Vec<MarshalPresenceEntry>>,
}

impl GatewayState {
    pub fn new(world: Arc<World>, scenarios: Arc<crate::ScenarioController>) -> Self {
        let (topology_changes, _) = tokio::sync::broadcast::channel(8);
        let (roster_changes, _) = tokio::sync::broadcast::channel(16);
        Self {
            world,
            scenarios,
            server_version: env!("CARGO_PKG_VERSION").to_string(),
            topology_changes,
            roster: Arc::new(DashMap::new()),
            roster_changes,
        }
    }

    pub fn current_roster(&self) -> Vec<MarshalPresenceEntry> {
        let mut entries: Vec<_> = self.roster.iter().map(|kv| kv.value().clone()).collect();
        entries.sort_by_key(|e| e.post);
        entries
    }

    pub fn update_marshal_presence(&self, post: PostId, name: String, online: bool) {
        let now = Utc::now();
        self.roster
            .entry(post)
            .and_modify(|e| {
                if !name.is_empty() {
                    e.name = name.clone();
                }
                e.online = online;
                e.last_seen = now;
            })
            .or_insert_with(|| MarshalPresenceEntry {
                post,
                name: if name.is_empty() {
                    format!("Post #{}", post.raw())
                } else {
                    name
                },
                online,
                checked_in_at: now,
                last_seen: now,
            });
        let _ = self.roster_changes.send(self.current_roster());
    }

    pub fn mark_marshal_offline(&self, post: PostId) {
        if let Some(mut entry) = self.roster.get_mut(&post) {
            entry.online = false;
            entry.last_seen = Utc::now();
            drop(entry);
            let _ = self.roster_changes.send(self.current_roster());
        }
    }
}

/// `axum` entry point. Mount as `GET /ws`.
pub async fn ws_upgrade(
    ws: WebSocketUpgrade,
    State(state): State<GatewayState>,
) -> Response {
    ws.on_upgrade(|socket| serve_connection(socket, state))
}

#[instrument(skip(socket, state))]
async fn serve_connection(mut socket: WebSocket, state: GatewayState) {
    // 1. Mandatory `Hello` handshake — discard anything else first.
    let Some(initial_role) = wait_for_hello(&mut socket).await else {
        let _ = socket.close().await;
        return;
    };
    info!(role = ?initial_role, "client connected");
    if let ClientRole::Marshal { post } = initial_role {
        state.update_marshal_presence(post, "".into(), true);
    }

    let (outbound_tx, mut outbound_rx) = mpsc::channel::<ServerMessage>(64);
    let topics = Arc::new(tokio::sync::RwLock::new(default_topics(initial_role)));
    // Role is mutable: subsequent `Hello` frames upgrade / downgrade the
    // connection (e.g. spectator picking a marshal post in the UI).
    let role = Arc::new(tokio::sync::RwLock::new(initial_role));

    // 2. Send Welcome + initial snapshot + marshal roster.
    send_now(
        &mut socket,
        &ServerMessage::Welcome {
            server_version: state.server_version.clone(),
            server_time: Utc::now(),
        },
    )
    .await;
    let (initial_panels, initial_cars) = snapshot(&state).await;
    send_now(
        &mut socket,
        &ServerMessage::Snapshot {
            panels: initial_panels,
            cars: initial_cars,
        },
    )
    .await;
    send_now(
        &mut socket,
        &ServerMessage::MarshalRoster {
            entries: state.current_roster(),
        },
    )
    .await;

    // 3. Split socket so receive and send tasks can run in parallel.
    let (mut sender, mut receiver) = socket.split();

    // Forwarder: bus events → outbound channel.
    let mut bus_rx = state.world.bus.subscribe();
    let topics_for_bus = topics.clone();
    let outbound_for_bus = outbound_tx.clone();
    let bus_task = tokio::spawn(async move {
        loop {
            match bus_rx.recv().await {
                Ok(event) => {
                    let topics_guard = topics_for_bus.read().await;
                    if !event_passes_topics(&event, &topics_guard) {
                        continue;
                    }
                    let msgs = expand_event(event);
                    drop(topics_guard);
                    for msg in msgs {
                        if outbound_for_bus.send(msg).await.is_err() {
                            return;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "ws subscriber lagged on bus");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });

    // Forwarder: topology changes → outbound channel.
    let mut topo_rx = state.topology_changes.subscribe();
    let outbound_for_topo = outbound_tx.clone();
    let topo_task = tokio::spawn(async move {
        loop {
            match topo_rx.recv().await {
                Ok(t) => {
                    let msg = ServerMessage::TopologyChanged {
                        circuit_id: t.circuit_id,
                        label: t.label,
                    };
                    if outbound_for_topo.send(msg).await.is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });

    // Forwarder: scenario notifications → outbound channel.
    let mut scenario_rx = state.scenarios.subscribe();
    let outbound_for_sim = outbound_tx.clone();
    let sim_task = tokio::spawn(async move {
        loop {
            match scenario_rx.recv().await {
                Ok(n) => {
                    let msg = match n {
                        crate::ScenarioNotification::Started {
                            name,
                            description,
                            total_steps,
                        } => ServerMessage::ScenarioStarted {
                            name,
                            description,
                            total_steps,
                        },
                        crate::ScenarioNotification::Progress {
                            step_idx,
                            total_steps,
                            mark,
                            kind,
                        } => ServerMessage::ScenarioProgress {
                            step_idx,
                            total_steps,
                            mark,
                            kind,
                        },
                        crate::ScenarioNotification::Finished {
                            reason,
                            assertions_passed,
                            assertions_failed,
                        } => ServerMessage::ScenarioFinished {
                            reason,
                            assertions_passed,
                            assertions_failed,
                        },
                    };
                    if outbound_for_sim.send(msg).await.is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "ws subscriber lagged on scenario channel");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });

    // Writer: outbound channel → socket.
    let writer_task = tokio::spawn(async move {
        while let Some(msg) = outbound_rx.recv().await {
            let Ok(json) = serde_json::to_string(&msg) else {
                continue;
            };
            if sender.send(Message::Text(json)).await.is_err() {
                break;
            }
        }
        let _ = sender.close().await;
    });

    // 4. Reader: client → process.
    let state_for_reader = state.clone();
    let topics_for_reader = topics.clone();
    let role_for_reader = role.clone();
    let outbound_for_reader = outbound_tx.clone();
    let reader_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Text(text)) => {
                    match serde_json::from_str::<ClientMessage>(&text) {
                        Ok(parsed) => {
                            let current_role = *role_for_reader.read().await;
                            handle_client_message(
                                parsed,
                                current_role,
                                &role_for_reader,
                                &state_for_reader,
                                &topics_for_reader,
                                &outbound_for_reader,
                            )
                            .await;
                        }
                        Err(e) => {
                            let _ = outbound_for_reader
                                .send(ServerMessage::Error {
                                    code: ErrorCode::InvalidCommand,
                                    message: format!("malformed frame: {e}"),
                                })
                                .await;
                        }
                    }
                }
                Ok(Message::Ping(_)) | Ok(Message::Pong(_)) | Ok(Message::Binary(_)) => {}
                Ok(Message::Close(_)) | Err(_) => break,
            }
        }
    });

    // Forwarder: roster updates → outbound channel.
    let mut roster_rx = state.roster_changes.subscribe();
    let outbound_for_roster = outbound_tx.clone();
    let roster_task = tokio::spawn(async move {
        loop {
            match roster_rx.recv().await {
                Ok(entries) => {
                    let msg = ServerMessage::MarshalRoster { entries };
                    if outbound_for_roster.send(msg).await.is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });

    // Hold the connection open until either side ends.
    let _ = tokio::join!(reader_task, writer_task, bus_task, sim_task, topo_task, roster_task);
    let final_role = *role.read().await;
    if let ClientRole::Marshal { post } = final_role {
        state.mark_marshal_offline(post);
    }
    info!("client disconnected");
}

async fn wait_for_hello(socket: &mut WebSocket) -> Option<ClientRole> {
    let deadline = tokio::time::sleep(Duration::from_secs(5));
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _ = &mut deadline => {
                warn!("hello handshake timed out");
                return None;
            }
            msg = socket.next() => {
                let Some(Ok(Message::Text(text))) = msg else { return None; };
                if let Ok(ClientMessage::Hello { role, .. }) = serde_json::from_str(&text) {
                    return Some(role);
                }
                let _ = socket
                    .send(Message::Text(
                        serde_json::to_string(&ServerMessage::Error {
                            code: ErrorCode::HandshakeRequired,
                            message: "first frame must be Hello".into(),
                        })
                        .unwrap(),
                    ))
                    .await;
            }
        }
    }
}

async fn send_now(socket: &mut WebSocket, msg: &ServerMessage) {
    if let Ok(json) = serde_json::to_string(msg) {
        let _ = socket.send(Message::Text(json)).await;
    }
}

async fn snapshot(state: &GatewayState) -> (Vec<tsp_core::Panel>, Vec<tsp_core::Car>) {
    let mut panels = Vec::new();
    for handle in state.world.hub.all_handles().await {
        panels.push(handle.snapshot().await);
    }
    let cars = state.world.cars.snapshot().await;
    (panels, cars)
}

fn default_topics(role: ClientRole) -> HashSet<Topic> {
    match role {
        ClientRole::EngineeringRoom => {
            HashSet::from([Topic::PanelStates, Topic::Diagnostics, Topic::EcuLights])
        }
        _ => HashSet::from([Topic::All]),
    }
}

fn event_passes_topics(event: &DomainEvent, topics: &HashSet<Topic>) -> bool {
    if topics.contains(&Topic::All) {
        return true;
    }
    match event {
        DomainEvent::PanelStateChanged { .. }
        | DomainEvent::RaceControlOverrideSet { .. }
        | DomainEvent::MarshalLocalStateSet { .. }
        | DomainEvent::FollowUpStateSet { .. }
        | DomainEvent::CommandAccepted { .. }
        | DomainEvent::CommandRejected { .. } => topics.contains(&Topic::PanelStates),
        DomainEvent::DiagnosticAlertRaised { .. } | DomainEvent::DiagnosticAlertCleared { .. } => {
            topics.contains(&Topic::Diagnostics)
        }
        DomainEvent::EcuNotified { .. } | DomainEvent::CarMoved { .. } => {
            topics.contains(&Topic::EcuLights)
        }
    }
}

/// Some events expand into multiple `ServerMessage`s for ergonomics (e.g.
/// diagnostic events surface on the dedicated `Diagnostic` channel as well).
fn expand_event(event: DomainEvent) -> Vec<ServerMessage> {
    let mut out = Vec::with_capacity(2);
    let snapshot_alert: Option<DiagnosticAlert> = match &event {
        DomainEvent::DiagnosticAlertRaised { alert, .. } => Some(alert.clone()),
        _ => None,
    };
    let ecu_summary = match &event {
        DomainEvent::EcuNotified { car, zone, flag, .. } => Some((*car, *zone, *flag)),
        _ => None,
    };
    out.push(ServerMessage::Event { event });
    if let Some(alert) = snapshot_alert {
        out.push(ServerMessage::Diagnostic { alert });
    }
    if let Some((car, zone, flag)) = ecu_summary {
        out.push(ServerMessage::EcuLight { car, zone, flag });
    }
    out
}

#[instrument(skip_all, fields(?role))]
async fn handle_client_message(
    msg: ClientMessage,
    role: ClientRole,
    role_cell: &Arc<tokio::sync::RwLock<ClientRole>>,
    state: &GatewayState,
    topics: &Arc<tokio::sync::RwLock<HashSet<Topic>>>,
    outbound: &mpsc::Sender<ServerMessage>,
) {
    match msg {
        ClientMessage::Hello { role: new_role, .. } => {
            let old_role = *role_cell.read().await;
            if let ClientRole::Marshal { post: old_post } = old_role {
                if !matches!(new_role, ClientRole::Marshal { post } if post == old_post) {
                    state.mark_marshal_offline(old_post);
                }
            }
            if let ClientRole::Marshal { post: new_post } = new_role {
                state.update_marshal_presence(new_post, "".into(), true);
            }
            *role_cell.write().await = new_role;
            *topics.write().await = default_topics(new_role);
            debug!(?new_role, "role updated");
        }
        ClientMessage::Subscribe { topics: new_topics } => {
            *topics.write().await = new_topics.into_iter().collect();
        }
        ClientMessage::RequestSnapshot => {
            let (panels, cars) = snapshot(state).await;
            let _ = outbound
                .send(ServerMessage::Snapshot { panels, cars })
                .await;
        }
        ClientMessage::Ping { nonce } => {
            let _ = outbound
                .send(ServerMessage::Pong {
                    nonce,
                    server_time: Utc::now(),
                })
                .await;
        }
        ClientMessage::SubmitCommand { command } => {
            if let Err(reason) = authorize(role, &command) {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::Unauthorized,
                        message: reason,
                    })
                    .await;
                return;
            }
            match state.world.hub.handle().dispatch(command).await {
                Ok(n) => debug!(panels_updated = n, "command accepted"),
                Err(rej) => {
                    let _ = outbound
                        .send(ServerMessage::Error {
                            code: ErrorCode::InvalidCommand,
                            message: rej.to_string(),
                        })
                        .await;
                }
            }
        }
        ClientMessage::ListScenarios => {
            let entries = state.scenarios.catalogue();
            let _ = outbound
                .send(ServerMessage::ScenarioListing { entries })
                .await;
        }
        ClientMessage::StartScenario { name, scenario, speed } => {
            if !matches!(role, ClientRole::RaceControl { .. }) {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::Unauthorized,
                        message: "only Race Control can start scenarios".into(),
                    })
                    .await;
                return;
            }
            if let Err(reason) = state
                .scenarios
                .start(name.as_deref(), scenario, speed)
                .await
            {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::InvalidCommand,
                        message: reason,
                    })
                    .await;
            }
        }
        ClientMessage::StopScenario => {
            if !matches!(role, ClientRole::RaceControl { .. }) {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::Unauthorized,
                        message: "only Race Control can stop scenarios".into(),
                    })
                    .await;
                return;
            }
            state.scenarios.stop().await;
        }
        ClientMessage::ResetWorld => {
            if !matches!(role, ClientRole::RaceControl { .. }) {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::Unauthorized,
                        message: "only Race Control can reset the world".into(),
                    })
                    .await;
                return;
            }
            state.scenarios.stop().await;
            state.scenarios.reset_world().await;
        }
        ClientMessage::ResetSession => {
            if !matches!(role, ClientRole::RaceControl { .. }) {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::Unauthorized,
                        message: "only Race Control can reset the session".into(),
                    })
                    .await;
                return;
            }
            state.scenarios.stop().await;
            state.world.reset_session().await;
        }
        ClientMessage::MarshalCheckIn { post, name } => {
            state.update_marshal_presence(post, name, true);
        }
        ClientMessage::ListCircuits => {
            let active = state.world.active_topology().await.name;
            let entries = crate::circuits::builtin()
                .into_iter()
                .map(|c| CircuitCatalogueEntry {
                    id: c.id.to_string(),
                    label: c.label.to_string(),
                })
                .collect();
            let _ = outbound
                .send(ServerMessage::CircuitListing { active, entries })
                .await;
        }
        ClientMessage::SwitchCircuit { circuit_id } => {
            if !matches!(role, ClientRole::RaceControl { .. }) {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::Unauthorized,
                        message: "only Race Control can switch circuits".into(),
                    })
                    .await;
                return;
            }
            let Some(topology) = crate::circuits::find(&circuit_id) else {
                let _ = outbound
                    .send(ServerMessage::Error {
                        code: ErrorCode::InvalidCommand,
                        message: format!("unknown circuit `{circuit_id}`"),
                    })
                    .await;
                return;
            };
            let label = crate::circuits::builtin()
                .into_iter()
                .find(|c| c.id == circuit_id)
                .map(|c| c.label.to_string())
                .unwrap_or_else(|| circuit_id.clone());
            state.scenarios.stop().await;
            state.world.switch_circuit(topology).await;
            let _ = state.topology_changes.send(TopologyChanged {
                circuit_id,
                label,
            });
        }
    }
}

/// Role-based authorisation matrix:
///
/// * `RaceControl` can issue commands sourced as `RaceControl` only, but the
///   operator id must match the one declared on the connection.
/// * `Marshal` can issue commands sourced as `Marshal` only, restricted to its
///   own `post`. Targets are limited to that post's zone or a specific panel.
/// * `EngineeringRoom` and `Spectator` are read-only.
fn authorize(role: ClientRole, cmd: &PanelCommand) -> Result<(), String> {
    match (role, &cmd.source) {
        (ClientRole::RaceControl { operator: r_op }, CommandSource::RaceControl { operator })
            if r_op == *operator =>
        {
            Ok(())
        }
        (ClientRole::Marshal { post: r_post }, CommandSource::Marshal { post })
            if r_post == *post =>
        {
            match cmd.target {
                CommandTarget::Zone(_) | CommandTarget::Panel(_) => Ok(()),
                _ => Err("marshals cannot issue global/sector commands".into()),
            }
        }
        (ClientRole::Marshal { .. }, _) => Err("source mismatch with WS role".into()),
        (ClientRole::RaceControl { .. }, _) => Err("source mismatch with WS role".into()),
        (ClientRole::EngineeringRoom, _) | (ClientRole::Spectator, _) => {
            Err("read-only role cannot submit commands".into())
        }
    }
}

#[allow(dead_code)]
fn _suppress_panel_summary_unused() -> PanelSummary {
    PanelSummary {
        id: tsp_core::PanelId::new(0),
        zone: tsp_core::ZoneId::new(0),
        flag: FlagState::Off,
        last_updated: Utc::now(),
    }
}
