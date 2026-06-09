//! Re-exports of the scenario data model.
//!
//! Phase 4 moved the data definitions to [`tsp_core::scenario`] so that the
//! productive server can drive scenarios live without depending on the
//! simulator crate (avoiding a cycle). This module keeps the historic path
//! `tsp_simulator::scenario::Scenario` valid.

pub use tsp_core::scenario::{
    CarSetup, EventMatcher, PanelLayout, Scenario, ScenarioSetup, ScenarioStep, StepLabel,
};
