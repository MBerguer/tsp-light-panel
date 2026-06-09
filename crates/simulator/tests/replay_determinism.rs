//! Determinism tests for the replay engine.
//!
//! For every library scenario we:
//!
//! 1. Run it once against a fresh world and snapshot the final panel state.
//! 2. Replay the persisted event log into the [`ReplayEngine`].
//! 3. Assert the replayed `final_states` match the live snapshot.
//!
//! This is the regression net for the *"event sourcing reproduces history
//! exactly"* invariant promised by Phase 1 §9.

use std::sync::Arc;
use std::time::Duration;

use tsp_server::diagnostic::DiagnosticConfig;
use tsp_server::World;
use tsp_simulator::library;
use tsp_simulator::replay::ReplayEngine;
use tsp_simulator::runner::{ScenarioRunner, TimeMode};

fn runner() -> ScenarioRunner {
    ScenarioRunner::new(TimeMode::Virtual).with_diagnostic_config(DiagnosticConfig {
        poll_interval: Duration::from_secs(60),
        ..Default::default()
    })
}

#[tokio::test(start_paused = true)]
async fn yellow_to_sc_event_log_replays_to_same_state() {
    let world = Arc::new(World::in_memory());
    runner()
        .run_against(&library::yellow_to_safety_car(), world.clone())
        .await
        .unwrap();

    // Yield once so the persistence path completes before we read it.
    tokio::task::yield_now().await;

    let report = ReplayEngine::replay_store(world.store.as_ref())
        .await
        .unwrap();
    assert!(report.events_processed > 0);
    assert!(report.state_transitions > 0);

    let mut live = Vec::new();
    for h in world.hub.all_handles().await {
        live.push(h.snapshot().await);
    }
    let divergences = ReplayEngine::diff_against(&report, live.iter());
    assert!(
        divergences.is_empty(),
        "replay diverged: {divergences:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn vsc_cycle_event_log_replays_to_same_state() {
    let world = Arc::new(World::in_memory());
    runner()
        .run_against(&library::vsc_cycle(), world.clone())
        .await
        .unwrap();
    tokio::task::yield_now().await;

    let report = ReplayEngine::replay_store(world.store.as_ref())
        .await
        .unwrap();
    let mut live = Vec::new();
    for h in world.hub.all_handles().await {
        live.push(h.snapshot().await);
    }
    assert!(ReplayEngine::diff_against(&report, live.iter()).is_empty());
}

#[tokio::test(start_paused = true)]
async fn rejection_events_are_persisted() {
    let world = Arc::new(World::in_memory());
    runner()
        .run_against(&library::marshal_red_rejected(), world.clone())
        .await
        .unwrap();
    tokio::task::yield_now().await;

    let events = world.store.read_all().await.unwrap();
    assert!(events
        .iter()
        .any(|e| matches!(e, tsp_core::DomainEvent::CommandRejected { .. })));
}
