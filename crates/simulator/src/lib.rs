//! `tsp-simulator` — **Phase 2**: scriptable scenarios, replay engine and
//! deterministic time-virtualised testing utilities for the F1 trackside
//! light-panel simulator.
//!
//! The crate is a thin orchestration layer that drives a `tsp_server::World`
//! through a declarative timeline of operator actions, ECU movements, fault
//! injections and assertions. It is the engine behind:
//!
//! * **Unit-style scenarios** in tests (with `tokio::time::pause`).
//! * **Hand-written demo scripts** in YAML/JSON (loaded by [`loader`]).
//! * **Replay** of real event logs into a fresh world to verify determinism
//!   (see [`replay`]).
//! * **Property-based fuzzing** of the pure state machine (see the tests
//!   under `crates/simulator/tests/`).
//!
//! ### Quick example
//!
//! ```no_run
//! use tsp_simulator::library;
//! use tsp_simulator::runner::{ScenarioRunner, TimeMode};
//! # async fn run() -> anyhow::Result<()> {
//! let scenario = library::yellow_to_safety_car();
//! let report = ScenarioRunner::new(TimeMode::Real)
//!     .run(&scenario)
//!     .await?;
//! assert!(report.all_assertions_passed());
//! # Ok(()) }
//! ```

#![deny(rust_2018_idioms)]
#![warn(clippy::all)]

pub mod assertions;
pub mod library;
pub mod loader;
pub mod replay;
pub mod runner;
pub mod scenario;

pub use assertions::{AssertionFailure, AssertionReport};
pub use replay::{ReplayEngine, ReplayReport};
pub use runner::{RunnerError, ScenarioReport, ScenarioRunner, TimeMode};
pub use scenario::{
    CarSetup, EventMatcher, PanelLayout, Scenario, ScenarioSetup, ScenarioStep, StepLabel,
};
