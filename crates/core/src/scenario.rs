//! Declarative scenario model.
//!
//! A [`Scenario`] is a self-contained description of a simulation run:
//!
//! * a `setup` block listing the panels, marshal posts and cars to spawn
//!   inside a fresh `World`;
//! * an ordered list of [`ScenarioStep`]s that drive the simulation forward
//!   in virtual or real time.
//!
//! The vocabulary mirrors what a race engineer or stewards' assistant would
//! script: *"raise yellow at zone 7, wait 2 s, race control deploys safety
//! car, wait 30 s, verify all panels show SafetyCar"*.
//!
//! Scenarios round-trip through serde so they can be authored in YAML or
//! JSON and reused across test runs, live-played from the UI, or replayed
//! against the event store.

use serde::{Deserialize, Serialize};

use crate::{CommandRejection, CommandTarget, DomainEvent, Fault, FlagState};

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

/// A complete simulation script.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/Scenario.ts"))]
pub struct Scenario {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub setup: ScenarioSetup,
    pub steps: Vec<ScenarioStep>,
}

impl Scenario {
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: None,
            setup: ScenarioSetup::default(),
            steps: Vec::new(),
        }
    }

    pub fn with_description(mut self, desc: impl Into<String>) -> Self {
        self.description = Some(desc.into());
        self
    }

    pub fn with_setup(mut self, setup: ScenarioSetup) -> Self {
        self.setup = setup;
        self
    }

    pub fn push(mut self, step: ScenarioStep) -> Self {
        self.steps.push(step);
        self
    }

    pub fn extend(mut self, steps: impl IntoIterator<Item = ScenarioStep>) -> Self {
        self.steps.extend(steps);
        self
    }

    /// Total number of "expected" assertions in the script. Used by the
    /// reporter to compute a pass-rate.
    pub fn assertion_count(&self) -> usize {
        self.steps.iter().filter(|s| s.is_assertion()).count()
    }
}

/// Initial world configuration.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ScenarioSetup.ts"))]
pub struct ScenarioSetup {
    /// Panels to spawn. Each entry is `(panel_id, zone, sector, distance_m)`.
    pub panels: Vec<PanelLayout>,
    /// Marshal post ids to spawn handles for.
    #[serde(default)]
    pub marshals: Vec<u32>,
    /// Cars to spawn ECU actors for.
    #[serde(default)]
    pub cars: Vec<CarSetup>,
    /// Whether to spawn a Race Control handle.
    #[serde(default = "default_true")]
    pub race_control: bool,
}

fn default_true() -> bool {
    true
}

impl ScenarioSetup {
    pub fn with_panel(mut self, layout: PanelLayout) -> Self {
        self.panels.push(layout);
        self
    }

    pub fn with_marshal(mut self, post: u32) -> Self {
        self.marshals.push(post);
        self
    }

    pub fn with_car(mut self, car: CarSetup) -> Self {
        self.cars.push(car);
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/PanelLayout.ts"))]
pub struct PanelLayout {
    pub panel: u32,
    pub zone: u32,
    pub sector: u32,
    pub distance_m: f32,
}

impl PanelLayout {
    pub const fn new(panel: u32, zone: u32, sector: u32, distance_m: f32) -> Self {
        Self {
            panel,
            zone,
            sector,
            distance_m,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/CarSetup.ts"))]
pub struct CarSetup {
    pub car: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_zone: Option<u32>,
}

impl CarSetup {
    pub const fn new(car: u32, initial_zone: Option<u32>) -> Self {
        Self { car, initial_zone }
    }
}

/// Optional human-readable label for grouping output.
pub type StepLabel = String;

/// A single timeline event a scenario can execute.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/ScenarioStep.ts"))]
#[serde(tag = "step", rename_all = "snake_case")]
pub enum ScenarioStep {
    /// Block for `duration_ms` of (virtual or real) time.
    Wait { duration_ms: u64 },
    /// Annotation only; the runner records it in the report.
    Mark { label: StepLabel },

    /// Submit a flag command from a marshal post.
    MarshalCommand {
        post: u32,
        target: CommandTarget,
        flag: FlagState,
    },
    /// Submit a command from Race Control.
    RaceControlCommand {
        target: CommandTarget,
        flag: FlagState,
    },

    /// Move a car into a new marshalling zone.
    EnterZone { car: u32, zone: u32 },
    /// Pretend the car retired.
    ParkCar { car: u32 },

    /// Inject a hardware fault on a panel.
    InjectFault { panel: u32, fault: Fault },
    /// Trigger one diagnostic supervisor poll (for deterministic tests).
    DiagnosticTick,

    // ----- Assertions ---------------------------------------------------
    /// Verify that the named panel currently displays `expected`.
    AssertPanelState { panel: u32, expected: FlagState },
    /// Verify that *every* registered panel shows `expected`.
    AssertEffectiveStateGlobal { expected: FlagState },
    /// Verify that an event matching `matcher` has been observed since the
    /// scenario started.
    AssertEventOccurred { matcher: EventMatcher },
    /// Verify the active-alert count for a panel.
    AssertActiveAlerts { panel: u32, expected_min: usize },
}

impl ScenarioStep {
    pub const fn is_assertion(&self) -> bool {
        matches!(
            self,
            ScenarioStep::AssertPanelState { .. }
                | ScenarioStep::AssertEffectiveStateGlobal { .. }
                | ScenarioStep::AssertEventOccurred { .. }
                | ScenarioStep::AssertActiveAlerts { .. }
        )
    }

    pub fn wait_ms(ms: u64) -> Self {
        Self::Wait { duration_ms: ms }
    }

    pub fn mark(label: impl Into<String>) -> Self {
        Self::Mark { label: label.into() }
    }
}

/// Coarse matcher for `DomainEvent`s, used by `AssertEventOccurred`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/EventMatcher.ts"))]
#[serde(tag = "match", rename_all = "snake_case")]
pub enum EventMatcher {
    /// Any `PanelStateChanged` to `flag`. Optionally restricted to a panel.
    PanelStateChangedTo {
        flag: FlagState,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        panel: Option<u32>,
    },
    /// Any `CommandRejected`.
    CommandRejected {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flag: Option<FlagState>,
    },
    /// Any `DiagnosticAlertRaised`. Optionally restricted to a panel.
    DiagnosticAlertRaised {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        panel: Option<u32>,
    },
    /// Any `EcuNotified`. Optionally restricted to a car.
    EcuNotified {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        car: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flag: Option<FlagState>,
    },
}

impl EventMatcher {
    pub fn matches(&self, event: &DomainEvent) -> bool {
        use DomainEvent::*;
        match (self, event) {
            (
                EventMatcher::PanelStateChangedTo { flag, panel },
                PanelStateChanged {
                    to,
                    panel: ev_panel,
                    ..
                },
            ) => flag == to && panel.map_or(true, |p| p == ev_panel.raw()),
            (EventMatcher::CommandRejected { flag }, CommandRejected { reason, .. }) => {
                if let Some(expected_flag) = flag {
                    matches!(
                        reason,
                        CommandRejection::NotAllowedForMarshal { flag: f }
                          | CommandRejection::GlobalFlagOnNonGlobalTarget { flag: f }
                          | CommandRejection::DriverSpecificFlagOnWrongTarget { flag: f }
                          if f == expected_flag
                    )
                } else {
                    true
                }
            }
            (EventMatcher::DiagnosticAlertRaised { panel }, DiagnosticAlertRaised { alert, .. }) => {
                panel.map_or(true, |p| alert.panel().raw() == p)
            }
            (
                EventMatcher::EcuNotified { car, flag },
                EcuNotified {
                    car: ev_car,
                    flag: ev_flag,
                    ..
                },
            ) => {
                car.map_or(true, |c| ev_car.raw() == c)
                    && flag.as_ref().map_or(true, |f| f == ev_flag)
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flag::YellowKind;
    use crate::{CommandRejection, DomainEvent, EventId, FlagState, PanelId};

    #[test]
    fn matcher_panel_state() {
        let m = EventMatcher::PanelStateChangedTo {
            flag: FlagState::Red,
            panel: Some(7),
        };
        let ev = DomainEvent::PanelStateChanged {
            id: EventId::new(),
            command_id: crate::CommandId::new(),
            panel: PanelId::new(7),
            from: FlagState::Off,
            to: FlagState::Red,
            timestamp: chrono::Utc::now(),
        };
        assert!(m.matches(&ev));
    }

    #[test]
    fn matcher_rejection_filters_by_flag() {
        let m = EventMatcher::CommandRejected {
            flag: Some(FlagState::Red),
        };
        let ev = DomainEvent::CommandRejected {
            id: EventId::new(),
            command_id: crate::CommandId::new(),
            reason: CommandRejection::NotAllowedForMarshal {
                flag: FlagState::Red,
            },
            timestamp: chrono::Utc::now(),
        };
        assert!(m.matches(&ev));

        let other = DomainEvent::CommandRejected {
            id: EventId::new(),
            command_id: crate::CommandId::new(),
            reason: CommandRejection::NotAllowedForMarshal {
                flag: FlagState::Yellow(YellowKind::Single),
            },
            timestamp: chrono::Utc::now(),
        };
        assert!(!m.matches(&other));
    }

    #[test]
    fn serde_scenario_roundtrip() {
        let s = Scenario::new("smoke")
            .with_description("just a smoke test")
            .with_setup(ScenarioSetup {
                panels: vec![PanelLayout::new(1, 7, 1, 0.0)],
                marshals: vec![7],
                cars: vec![CarSetup::new(44, Some(7))],
                race_control: true,
            })
            .push(ScenarioStep::mark("start"))
            .push(ScenarioStep::wait_ms(100))
            .push(ScenarioStep::AssertPanelState {
                panel: 1,
                expected: FlagState::Off,
            });
        let json = serde_json::to_string(&s).unwrap();
        let back: Scenario = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }
}
