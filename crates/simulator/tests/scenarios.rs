//! Integration tests for the library scenarios.
//!
//! Each test runs a predefined `Scenario` from [`tsp_simulator::library`]
//! through the [`ScenarioRunner`] in **virtual time** (`start_paused = true`),
//! then asserts the resulting [`ScenarioReport`] has every assertion green.
//!
//! Running in virtual time keeps the test suite millisecond-fast even for
//! scenarios that script multi-second `Wait`s.

use std::time::Duration;

use tsp_simulator::library;
use tsp_simulator::runner::{ScenarioRunner, TimeMode};
use tsp_server::diagnostic::DiagnosticConfig;

fn runner() -> ScenarioRunner {
    ScenarioRunner::new(TimeMode::Virtual).with_diagnostic_config(DiagnosticConfig {
        poll_interval: Duration::from_secs(60), // disable auto-poll in tests
        ..Default::default()
    })
}

#[tokio::test(start_paused = true)]
async fn yellow_to_safety_car_passes_every_assertion() {
    let report = runner()
        .run(&library::yellow_to_safety_car())
        .await
        .unwrap();
    assert!(
        report.all_assertions_passed(),
        "expected all assertions to pass, got:\n{}",
        report.assertions
    );
    assert!(report.events_observed > 0);
    assert!(!report.marks.is_empty(), "marks should be recorded");
}

#[tokio::test(start_paused = true)]
async fn red_flag_restart_completes() {
    let report = runner().run(&library::red_flag_restart()).await.unwrap();
    assert!(report.all_assertions_passed(), "{}", report.assertions);
}

#[tokio::test(start_paused = true)]
async fn vsc_cycle_completes() {
    let report = runner().run(&library::vsc_cycle()).await.unwrap();
    assert!(report.all_assertions_passed(), "{}", report.assertions);
}

#[tokio::test(start_paused = true)]
async fn psu_undervoltage_raises_alert() {
    let report = runner()
        .run(&library::psu_undervoltage_fault())
        .await
        .unwrap();
    assert!(report.all_assertions_passed(), "{}", report.assertions);
}

#[tokio::test(start_paused = true)]
async fn multi_zone_yellow_keeps_local_independence() {
    let report = runner().run(&library::multi_zone_yellow()).await.unwrap();
    assert!(report.all_assertions_passed(), "{}", report.assertions);
}

#[tokio::test(start_paused = true)]
async fn marshal_red_is_rejected_and_observed() {
    let report = runner().run(&library::marshal_red_rejected()).await.unwrap();
    assert!(report.all_assertions_passed(), "{}", report.assertions);
}
