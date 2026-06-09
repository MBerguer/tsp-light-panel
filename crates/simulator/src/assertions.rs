//! Assertion model.
//!
//! Each `ScenarioStep::Assert*` produces an [`AssertionOutcome`] that the
//! runner accumulates into an [`AssertionReport`]. Failures carry enough
//! context for the report (or a test framework) to print a useful message.

use serde::Serialize;

use tsp_core::FlagState;

use crate::scenario::EventMatcher;

/// One concrete check the runner performed.
#[derive(Debug, Clone, Serialize)]
pub struct AssertionOutcome {
    pub step_index: usize,
    pub description: String,
    pub passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<AssertionFailure>,
}

/// Structured failure reason. Implements `Display` so tests can `unwrap()`
/// without losing context.
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AssertionFailure {
    #[error("panel {panel} expected {expected:?} but had {actual:?}")]
    PanelState {
        panel: u32,
        expected: FlagState,
        actual: FlagState,
    },
    #[error("panel {panel} not registered in the world")]
    UnknownPanel { panel: u32 },
    #[error(
        "expected every panel to be {expected:?} but {wrong_count} panel(s) differ; first offender: panel {first_offender} = {first_actual:?}"
    )]
    EffectiveStateGlobal {
        expected: FlagState,
        wrong_count: usize,
        first_offender: u32,
        first_actual: FlagState,
    },
    #[error("no event matched {matcher:?} during the run")]
    NoMatchingEvent { matcher: EventMatcher },
    #[error(
        "panel {panel}: expected at least {expected_min} active alert(s) but observed {observed}"
    )]
    InsufficientAlerts {
        panel: u32,
        expected_min: usize,
        observed: usize,
    },
}

/// Aggregate report for all assertions in a scenario.
#[derive(Debug, Clone, Serialize)]
pub struct AssertionReport {
    pub total: usize,
    pub passed: usize,
    pub outcomes: Vec<AssertionOutcome>,
}

impl AssertionReport {
    pub fn new() -> Self {
        Self {
            total: 0,
            passed: 0,
            outcomes: Vec::new(),
        }
    }

    pub fn record(&mut self, outcome: AssertionOutcome) {
        self.total += 1;
        if outcome.passed {
            self.passed += 1;
        }
        self.outcomes.push(outcome);
    }

    pub fn failures(&self) -> impl Iterator<Item = &AssertionOutcome> {
        self.outcomes.iter().filter(|o| !o.passed)
    }

    pub fn all_passed(&self) -> bool {
        self.total == self.passed
    }
}

impl Default for AssertionReport {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for AssertionReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        writeln!(
            f,
            "assertions: {}/{} passed",
            self.passed, self.total
        )?;
        for outcome in self.failures() {
            writeln!(
                f,
                "  ✗ step {}: {} — {}",
                outcome.step_index,
                outcome.description,
                outcome
                    .failure
                    .as_ref()
                    .map(|e| e.to_string())
                    .unwrap_or_else(|| "<unknown>".to_string())
            )?;
        }
        Ok(())
    }
}
