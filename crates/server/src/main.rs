//! `tsp-server` binary.
//!
//! Phase 3 productive layout:
//!
//! ```text
//! GET  /health
//! GET  /api/topology      → CircuitTopology (UI layout)
//! GET  /api/snapshot      → every panel right now
//! GET  /ws                → bidirectional gateway (tsp_core::wire)
//! GET  /*                 → static files from web/dist (if built)
//! ```

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use axum::extract::{FromRef, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing::info;
use tracing_subscriber::EnvFilter;

use tsp_core::wire::CircuitCatalogueEntry;
use tsp_core::{OperatorId, Panel};
use tsp_server::gateway::TopologyChanged;
use tsp_server::{
    circuits, diagnostic::DiagnosticConfig, scenario_library, ws_upgrade, CircuitTopology,
    GatewayState, ScenarioController, World,
};

#[derive(Clone)]
struct AppState {
    gateway: GatewayState,
    scenarios: Arc<ScenarioController>,
    mode: String,
}

impl FromRef<AppState> for GatewayState {
    fn from_ref(s: &AppState) -> Self {
        s.gateway.clone()
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("tsp=info,info")),
        )
        .init();

    let circuits_dir = std::env::var("TSP_CIRCUITS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("crates/server/circuits"));
    if circuits_dir.exists() {
        info!(dir = %circuits_dir.display(), "scanning for JSON circuit files");
        circuits::register_disk_dir(circuits_dir);
    }

    let initial_circuit = std::env::var("TSP_CIRCUIT").unwrap_or_else(|_| "el_pinar_n13".into());
    let topology = circuits::find(&initial_circuit).unwrap_or_else(CircuitTopology::demo);
    let world = Arc::new(World::in_memory());
    world.bootstrap_from_topology(&topology).await;

    let mode = std::env::var("TSP_MODE").unwrap_or_else(|_| {
        if initial_circuit.contains("el_pinar") {
            "track".into()
        } else {
            "demo".into()
        }
    });
    info!(%mode, circuit = %initial_circuit, "launching server");

    let system_rc_operator = OperatorId::new();
    let _ = world.spawn_race_control(system_rc_operator);

    let supervisor = world
        .build_diagnostic(DiagnosticConfig {
            poll_interval: Duration::from_millis(500),
            ..Default::default()
        })
        .await;
    Arc::clone(&supervisor).spawn();

    let scenarios = Arc::new(ScenarioController::new(world.clone(), system_rc_operator));
    let gateway = GatewayState::new(world.clone(), scenarios.clone());

    let udp_target_str = std::env::var("TSP_UDP_BROADCAST_ADDR")
        .unwrap_or_else(|_| "255.255.255.255:8888".into());
    if let Ok(udp_target) = udp_target_str.parse::<SocketAddr>() {
        tsp_server::udp_broadcast::spawn_udp_broadcaster(world.clone(), udp_target);
    } else {
        tracing::warn!(target = %udp_target_str, "invalid TSP_UDP_BROADCAST_ADDR, UDP broadcasting disabled");
    }

    let state = AppState {
        gateway: gateway.clone(),
        scenarios: scenarios.clone(),
        mode,
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        .route("/health", get(health))
        .route("/api/config", get(get_config))
        .route("/api/auth/login", axum::routing::post(post_login))
        .route("/api/topology", get(get_topology))
        .route("/api/snapshot", get(get_snapshot))
        .route("/api/sim/library", get(get_library))
        .route("/api/sim/run", axum::routing::post(post_run))
        .route("/api/sim/stop", axum::routing::post(post_stop))
        .route("/api/sim/reset", axum::routing::post(post_reset))
        .route("/api/circuits", get(get_circuits))
        .route("/api/circuits/active", axum::routing::post(post_switch_circuit))
        .route("/api/replay/events", get(get_replay))
        .route("/ws", get(ws_upgrade))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(cors);

    // Serve the built frontend from `web/dist` if present. This is the
    // production layout — during development the Vite dev server runs on a
    // separate port and points its WS at this server via CORS.
    let static_dir = std::env::var("TSP_STATIC_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("web/dist"));
    let app = if static_dir.exists() {
        info!(?static_dir, "serving frontend statically");
        api.fallback_service(ServeDir::new(static_dir))
    } else {
        info!("no static frontend bundle found — UI is dev-served");
        api
    };

    let addr_str = std::env::var("TSP_BIND").ok().or_else(|| {
        std::env::var("PORT").ok().map(|p| format!("0.0.0.0:{p}"))
    }).unwrap_or_else(|| "0.0.0.0:7878".into());
    let addr = addr_str.parse::<SocketAddr>()?;
    info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> (StatusCode, &'static str) {
    (StatusCode::OK, "ok")
}

#[derive(serde::Serialize)]
struct ConfigResponse {
    mode: String,
    circuit: String,
    auth_required: bool,
}

async fn get_config(State(state): State<AppState>) -> Json<ConfigResponse> {
    let topo = state.gateway.world.active_topology().await;
    Json(ConfigResponse {
        mode: state.mode.clone(),
        circuit: topo.name.clone(),
        auth_required: state.mode == "track",
    })
}

#[derive(serde::Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
enum LoginRequest {
    RaceControl {
        password: String,
    },
    Marshal {
        post: u32,
        name: String,
        pin: String,
    },
}

async fn post_login(
    State(state): State<AppState>,
    Json(body): Json<LoginRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    match body {
        LoginRequest::RaceControl { password } => {
            let expected = std::env::var("TSP_RC_PASSWORD").unwrap_or_else(|_| "control123".into());
            if password == expected {
                let op = tsp_core::OperatorId::new();
                (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "ok": true,
                        "role": {
                            "role": "race_control",
                            "data": { "operator": op.to_string() }
                        },
                        "name": "Director de Carrera"
                    })),
                )
            } else {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({
                        "ok": false,
                        "error": "Contraseña de Race Control incorrecta"
                    })),
                )
            }
        }
        LoginRequest::Marshal { post, name, pin } => {
            let expected = std::env::var("TSP_MARSHAL_PIN").unwrap_or_else(|_| "1234".into());
            if pin == expected {
                let clean_name = if name.trim().is_empty() {
                    format!("Comisario Puesto #{post}")
                } else {
                    name.trim().to_string()
                };
                state.gateway.update_marshal_presence(
                    tsp_core::PostId::new(post),
                    clean_name.clone(),
                    true,
                );
                (
                    StatusCode::OK,
                    Json(serde_json::json!({
                        "ok": true,
                        "role": {
                            "role": "marshal",
                            "data": { "post": post }
                        },
                        "name": clean_name
                    })),
                )
            } else {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({
                        "ok": false,
                        "error": "PIN de Comisario incorrecto"
                    })),
                )
            }
        }
    }
}


async fn get_topology(State(state): State<AppState>) -> Json<CircuitTopology> {
    Json(state.gateway.world.active_topology().await)
}

async fn get_circuits(State(_state): State<AppState>) -> Json<Vec<CircuitCatalogueEntry>> {
    Json(
        circuits::builtin()
            .into_iter()
            .map(|c| CircuitCatalogueEntry {
                id: c.id.to_string(),
                label: c.label.to_string(),
            })
            .collect(),
    )
}

#[derive(serde::Deserialize)]
struct SwitchCircuitRequest {
    circuit_id: String,
}

async fn post_switch_circuit(
    State(state): State<AppState>,
    Json(body): Json<SwitchCircuitRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    let Some(topology) = circuits::find(&body.circuit_id) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": format!("unknown circuit `{}`", body.circuit_id) })),
        );
    };
    let label = circuits::builtin()
        .into_iter()
        .find(|c| c.id == body.circuit_id)
        .map(|c| c.label.to_string())
        .unwrap_or_else(|| body.circuit_id.clone());
    state.scenarios.stop().await;
    state.gateway.world.switch_circuit(topology).await;
    let _ = state.gateway.topology_changes.send(TopologyChanged {
        circuit_id: body.circuit_id.clone(),
        label: label.clone(),
    });
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({ "active": body.circuit_id, "label": label })),
    )
}

async fn get_snapshot(State(state): State<AppState>) -> Json<SnapshotResponse> {
    let mut panels = Vec::new();
    for h in state.gateway.world.hub.all_handles().await {
        panels.push(h.snapshot().await);
    }
    let cars = state.gateway.world.cars.snapshot().await;
    Json(SnapshotResponse {
        server_time: Utc::now(),
        panels,
        cars,
    })
}

#[derive(serde::Serialize)]
struct SnapshotResponse {
    server_time: chrono::DateTime<chrono::Utc>,
    panels: Vec<Panel>,
    cars: Vec<tsp_core::Car>,
}

async fn get_library(
    State(state): State<AppState>,
) -> Json<Vec<tsp_core::wire::ScenarioCatalogueEntry>> {
    let _ = state; // suppress unused
    Json(state.scenarios.catalogue())
}

#[derive(serde::Deserialize, Default)]
struct RunRequest {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    scenario: Option<tsp_core::Scenario>,
    #[serde(default = "default_speed")]
    speed: f32,
}

fn default_speed() -> f32 {
    1.0
}

async fn post_run(
    State(state): State<AppState>,
    Json(body): Json<RunRequest>,
) -> (StatusCode, Json<serde_json::Value>) {
    match state
        .scenarios
        .start(body.name.as_deref(), body.scenario, body.speed)
        .await
    {
        Ok(name) => (
            StatusCode::ACCEPTED,
            Json(serde_json::json!({ "started": name })),
        ),
        Err(reason) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": reason })),
        ),
    }
}

async fn post_stop(State(state): State<AppState>) -> StatusCode {
    state.scenarios.stop().await;
    StatusCode::OK
}

async fn post_reset(State(state): State<AppState>) -> StatusCode {
    state.scenarios.stop().await;
    state.scenarios.reset_world().await;
    StatusCode::OK
}

#[derive(serde::Deserialize)]
struct ReplayQuery {
    #[serde(default)]
    since: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    until: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default)]
    limit: Option<usize>,
}

async fn get_replay(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<ReplayQuery>,
) -> Result<Json<ReplayResponse>, (StatusCode, Json<serde_json::Value>)> {
    let all = state.gateway.world.store.read_all().await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
    })?;
    let mut events: Vec<_> = all
        .into_iter()
        .filter(|ev| {
            let t = ev.timestamp();
            q.since.map(|s| t >= s).unwrap_or(true) && q.until.map(|u| t <= u).unwrap_or(true)
        })
        .collect();
    events.sort_by_key(|e| e.timestamp());
    if let Some(limit) = q.limit {
        events.truncate(limit);
    }
    let span = if events.is_empty() {
        None
    } else {
        Some((
            events.first().unwrap().timestamp(),
            events.last().unwrap().timestamp(),
        ))
    };
    Ok(Json(ReplayResponse {
        total: events.len(),
        first_ts: span.map(|s| s.0),
        last_ts: span.map(|s| s.1),
        events,
    }))
}

#[derive(serde::Serialize)]
struct ReplayResponse {
    total: usize,
    first_ts: Option<chrono::DateTime<chrono::Utc>>,
    last_ts: Option<chrono::DateTime<chrono::Utc>>,
    events: Vec<tsp_core::DomainEvent>,
}

// silence: keep `scenario_library` re-export usable from main.
#[allow(dead_code)]
fn _ensure_library_compiles() {
    let _ = scenario_library::catalogue();
}
