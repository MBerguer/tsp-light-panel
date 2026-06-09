//! `ScenarioRunner` — executes a [`Scenario`] against a fresh `World`.
//!
//! The runner is intentionally hub-aware (it materialises the setup block by
//! calling `World::bootstrap_circuit` + `spawn_marshal` + `spawn_ecu`) and
//! event-aware (it eagerly drains the broadcast bus into an internal buffer
//! so that `AssertEventOccurred` can look back at the entire run).
//!
//! ## Time modes
//!
//! * [`TimeMode::Real`] — `tokio::time::sleep`. Use for live demos.
//! * [`TimeMode::Virtual`] — `tokio::time::advance`. Use inside tests gated by
//!   `#[tokio::test(start_paused = true)]` to make scenarios complete in
//!   millisecond-of-wall-clock.
//!
//! ## Output
//!
//! Each run yields a [`ScenarioReport`] with timeline markers, assertion
//! outcomes and the full ordered list of events observed on the bus.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use thiserror::Error;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use tsp_core::{
    CarNumber, CommandSource, DomainEvent, FlagState, OperatorId, PanelCommand, PanelId, PostId,
    ZoneId,
};
use tsp_eventstore::EventStore;
use tsp_server::actors::{ecu::EcuHandle, marshal::MarshalHandle, panel::PanelHandle};
use tsp_server::diagnostic::{DiagnosticConfig, DiagnosticSupervisor};
use tsp_server::World;

use crate::assertions::{AssertionFailure, AssertionOutcome, AssertionReport};
use crate::scenario::{Scenario, ScenarioStep};

/// How the runner advances time between steps.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum TimeMode {
    /// Use real `tokio::time::sleep`.
    #[default]
    Real,
    /// Use `tokio::time::advance` — only meaningful when the test was started
    /// with `tokio::test(start_paused = true)` or `tokio::time::pause()`.
    Virtual,
}

#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("scenario refers to panel {0} which is not in the setup")]
    UnknownPanel(u32),
    #[error("scenario refers to marshal post {0} which is not in the setup")]
    UnknownMarshal(u32),
    #[error("scenario refers to car {0} which is not in the setup")]
    UnknownCar(u32),
    #[error("dispatch failed: {0}")]
    Dispatch(#[from] tsp_core::CommandRejection),
    #[error("setup error: {0}")]
    Setup(String),
}

/// Final, serialisable report produced by [`ScenarioRunner::run`].
#[derive(Debug, Clone, Serialize)]
pub struct ScenarioReport {
    pub name: String,
    pub steps_executed: usize,
    pub events_observed: usize,
    pub marks: Vec<TimelineMark>,
    pub assertions: AssertionReport,
}

impl ScenarioReport {
    pub fn all_assertions_passed(&self) -> bool {
        self.assertions.all_passed()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct TimelineMark {
    pub step_index: usize,
    pub virtual_offset_ms: u64,
    pub label: String,
}

/// One-shot executor.
pub struct ScenarioRunner {
    mode: TimeMode,
    diagnostic_config: DiagnosticConfig,
}

impl ScenarioRunner {
    pub fn new(mode: TimeMode) -> Self {
        Self {
            mode,
            diagnostic_config: DiagnosticConfig::default(),
        }
    }

    pub fn with_diagnostic_config(mut self, config: DiagnosticConfig) -> Self {
        self.diagnostic_config = config;
        self
    }

    /// Run a scenario from scratch in an in-memory world and return the
    /// report.
    pub async fn run(&self, scenario: &Scenario) -> Result<ScenarioReport, RunnerError> {
        let world = Arc::new(World::in_memory());
        self.run_against(scenario, world).await
    }

    /// Run a scenario against an externally-provided world. Used by the
    /// replay engine and by tests that want to assert on the surviving store.
    pub async fn run_against(
        &self,
        scenario: &Scenario,
        world: Arc<World>,
    ) -> Result<ScenarioReport, RunnerError> {
        info!(name = %scenario.name, "scenario starting");
        let mut ctx = RunContext::bootstrap(&world, scenario, self.diagnostic_config.clone())
            .await?;

        let mut report = ScenarioReport {
            name: scenario.name.clone(),
            steps_executed: 0,
            events_observed: 0,
            marks: Vec::new(),
            assertions: AssertionReport::new(),
        };

        for (idx, step) in scenario.steps.iter().enumerate() {
            debug!(?step, "executing step");
            self.execute_step(idx, step, &mut ctx, &mut report).await?;
            report.steps_executed += 1;
            // After every step we drain the bus so subsequent assertions see
            // the latest events even when `Wait`s are zero-length.
            ctx.drain_events().await;
        }

        // Final drain to capture anything that arrived between the last step
        // and termination.
        ctx.drain_events().await;
        report.events_observed = ctx.events_buffer.lock().await.len();

        info!(
            name = %scenario.name,
            assertions = %report.assertions,
            "scenario done"
        );
        Ok(report)
    }

    async fn execute_step(
        &self,
        idx: usize,
        step: &ScenarioStep,
        ctx: &mut RunContext,
        report: &mut ScenarioReport,
    ) -> Result<(), RunnerError> {
        match step {
            ScenarioStep::Wait { duration_ms } => {
                self.advance(Duration::from_millis(*duration_ms)).await;
                ctx.virtual_offset_ms += *duration_ms;
            }
            ScenarioStep::Mark { label } => {
                report.marks.push(TimelineMark {
                    step_index: idx,
                    virtual_offset_ms: ctx.virtual_offset_ms,
                    label: label.clone(),
                });
            }
            ScenarioStep::MarshalCommand {
                post,
                target,
                flag,
            } => {
                let handle = ctx
                    .marshals
                    .get(post)
                    .ok_or(RunnerError::UnknownMarshal(*post))?;
                let cmd = PanelCommand::new(
                    CommandSource::Marshal {
                        post: PostId::new(*post),
                    },
                    *target,
                    *flag,
                );
                match handle.submit(cmd).await {
                    Ok(n) => debug!(panels = n, "marshal cmd accepted"),
                    Err(reason) => {
                        warn!(?reason, "marshal cmd rejected");
                    }
                }
            }
            ScenarioStep::RaceControlCommand { target, flag } => {
                let cmd = PanelCommand::new(
                    CommandSource::RaceControl {
                        operator: ctx.race_control_operator,
                    },
                    *target,
                    *flag,
                );
                match ctx
                    .race_control
                    .as_ref()
                    .ok_or_else(|| RunnerError::Setup("no race control".into()))?
                    .submit(cmd)
                    .await
                {
                    Ok(n) => debug!(panels = n, "rc cmd accepted"),
                    Err(reason) => warn!(?reason, "rc cmd rejected"),
                }
            }
            ScenarioStep::EnterZone { car, zone } => {
                let h = ctx.cars.get(car).ok_or(RunnerError::UnknownCar(*car))?;
                h.enter_zone(ZoneId::new(*zone)).await;
            }
            ScenarioStep::ParkCar { car } => {
                let h = ctx.cars.get(car).ok_or(RunnerError::UnknownCar(*car))?;
                h.park().await;
            }
            ScenarioStep::InjectFault { panel, fault } => {
                let h = ctx
                    .panels
                    .get(panel)
                    .ok_or(RunnerError::UnknownPanel(*panel))?;
                h.inject_fault(fault.clone()).await;
            }
            ScenarioStep::DiagnosticTick => {
                ctx.diagnostic.tick().await;
            }
            ScenarioStep::AssertPanelState { panel, expected } => {
                let outcome = self.check_panel_state(idx, *panel, *expected, ctx).await;
                report.assertions.record(outcome);
            }
            ScenarioStep::AssertEffectiveStateGlobal { expected } => {
                let outcome = self.check_global_state(idx, *expected, ctx).await;
                report.assertions.record(outcome);
            }
            ScenarioStep::AssertEventOccurred { matcher } => {
                let observed = ctx.events_buffer.lock().await;
                let passed = observed.iter().any(|e| matcher.matches(e));
                report.assertions.record(AssertionOutcome {
                    step_index: idx,
                    description: format!("event matches {matcher:?}"),
                    passed,
                    failure: if passed {
                        None
                    } else {
                        Some(AssertionFailure::NoMatchingEvent {
                            matcher: matcher.clone(),
                        })
                    },
                });
            }
            ScenarioStep::AssertActiveAlerts {
                panel,
                expected_min,
            } => {
                let observed = ctx.events_buffer.lock().await;
                let raised = observed
                    .iter()
                    .filter(|e| {
                        matches!(
                            e,
                            DomainEvent::DiagnosticAlertRaised { alert, .. }
                              if alert.panel().raw() == *panel
                        )
                    })
                    .count();
                let cleared = observed
                    .iter()
                    .filter(|e| {
                        matches!(
                            e,
                            DomainEvent::DiagnosticAlertCleared { alert, .. }
                              if alert.panel().raw() == *panel
                        )
                    })
                    .count();
                let active = raised.saturating_sub(cleared);
                let passed = active >= *expected_min;
                report.assertions.record(AssertionOutcome {
                    step_index: idx,
                    description: format!(
                        "panel {panel} active alerts >= {expected_min} (observed {active})"
                    ),
                    passed,
                    failure: if passed {
                        None
                    } else {
                        Some(AssertionFailure::InsufficientAlerts {
                            panel: *panel,
                            expected_min: *expected_min,
                            observed: active,
                        })
                    },
                });
            }
        }
        Ok(())
    }

    async fn check_panel_state(
        &self,
        step_index: usize,
        panel_id: u32,
        expected: FlagState,
        ctx: &RunContext,
    ) -> AssertionOutcome {
        let Some(handle) = ctx.panels.get(&panel_id) else {
            return AssertionOutcome {
                step_index,
                description: format!("panel {panel_id} state == {expected:?}"),
                passed: false,
                failure: Some(AssertionFailure::UnknownPanel { panel: panel_id }),
            };
        };
        let snap = handle.snapshot().await;
        let passed = snap.effective_state == expected;
        AssertionOutcome {
            step_index,
            description: format!("panel {panel_id} state == {expected:?}"),
            passed,
            failure: if passed {
                None
            } else {
                Some(AssertionFailure::PanelState {
                    panel: panel_id,
                    expected,
                    actual: snap.effective_state,
                })
            },
        }
    }

    async fn check_global_state(
        &self,
        step_index: usize,
        expected: FlagState,
        ctx: &RunContext,
    ) -> AssertionOutcome {
        let handles = ctx.panel_handles_in_order();
        let mut wrong = 0usize;
        let mut first_offender: Option<(u32, FlagState)> = None;
        for (id, h) in handles {
            let snap = h.snapshot().await;
            if snap.effective_state != expected {
                wrong += 1;
                first_offender.get_or_insert((id, snap.effective_state));
            }
        }
        let passed = wrong == 0;
        AssertionOutcome {
            step_index,
            description: format!("every panel == {expected:?}"),
            passed,
            failure: if passed {
                None
            } else {
                let (id, actual) = first_offender.expect("must be set when wrong > 0");
                Some(AssertionFailure::EffectiveStateGlobal {
                    expected,
                    wrong_count: wrong,
                    first_offender: id,
                    first_actual: actual,
                })
            },
        }
    }

    async fn advance(&self, duration: Duration) {
        match self.mode {
            TimeMode::Real => tokio::time::sleep(duration).await,
            TimeMode::Virtual => tokio::time::advance(duration).await,
        }
    }
}

/// Bundle of runtime handles produced by `bootstrap`.
struct RunContext {
    panels: HashMap<u32, PanelHandle>,
    panel_ids: Vec<u32>,
    marshals: HashMap<u32, MarshalHandle>,
    cars: HashMap<u32, EcuHandle>,
    race_control: Option<tsp_server::actors::race_control::RaceControlHandle>,
    race_control_operator: OperatorId,
    diagnostic: Arc<DiagnosticSupervisor>,
    events_buffer: Arc<Mutex<Vec<DomainEvent>>>,
    virtual_offset_ms: u64,
    _store: Arc<dyn EventStore>,
}

impl RunContext {
    async fn bootstrap(
        world: &Arc<World>,
        scenario: &Scenario,
        diag_config: DiagnosticConfig,
    ) -> Result<Self, RunnerError> {
        // Spawn panels.
        let mut panels = HashMap::new();
        let mut panel_ids = Vec::new();
        for layout in &scenario.setup.panels {
            let panel = tsp_core::Panel::powered_up(
                PanelId::new(layout.panel),
                ZoneId::new(layout.zone),
                tsp_core::SectorId::new(layout.sector),
                tsp_core::TrackPosition::new(layout.distance_m, tsp_core::TrackSide::Outside),
                chrono::Utc::now(),
            );
            let h = world.spawn_panel(panel).await;
            panels.insert(layout.panel, h);
            panel_ids.push(layout.panel);
        }

        // Spawn marshals.
        let mut marshals = HashMap::new();
        for post in &scenario.setup.marshals {
            let h = world.spawn_marshal(PostId::new(*post));
            marshals.insert(*post, h);
        }

        // Spawn cars.
        let mut cars = HashMap::new();
        for c in &scenario.setup.cars {
            let h = world
                .spawn_ecu(CarNumber::new(c.car), c.initial_zone.map(ZoneId::new))
                .await;
            cars.insert(c.car, h);
        }

        let race_control_operator = OperatorId::new();
        let race_control = if scenario.setup.race_control {
            Some(world.spawn_race_control(race_control_operator))
        } else {
            None
        };

        // Pre-subscribe to the bus and drain into a buffer so assertions can
        // look back at the whole timeline.
        let events_buffer = Arc::new(Mutex::new(Vec::<DomainEvent>::new()));
        let buf = events_buffer.clone();
        let mut rx = world.bus.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(event) => buf.lock().await.push(event),
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        warn!(skipped = n, "scenario subscriber lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        let diagnostic = world.build_diagnostic(diag_config).await;

        Ok(Self {
            panels,
            panel_ids,
            marshals,
            cars,
            race_control,
            race_control_operator,
            diagnostic,
            events_buffer,
            virtual_offset_ms: 0,
            _store: world.store.clone(),
        })
    }

    fn panel_handles_in_order(&self) -> Vec<(u32, PanelHandle)> {
        self.panel_ids
            .iter()
            .filter_map(|id| self.panels.get(id).map(|h| (*id, h.clone())))
            .collect()
    }

    /// Yield the current task slice so the broadcast subscriber drains.
    async fn drain_events(&self) {
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
    }
}
