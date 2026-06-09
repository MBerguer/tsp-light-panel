//! Curated library of scenarios. These are used by the example binaries,
//! by integration tests and by the WS gateway in Phase 3 to power a
//! *"replay incident"* button in the Race Control UI.
//!
//! All scenarios share a tiny demo circuit:
//!
//! ```text
//! Sector 1: panel 1 (zone 7, dist 0), panel 2 (zone 7, dist 50)
//! Sector 1: panel 3 (zone 8, dist 200)
//! Sector 2: panel 4 (zone 9, dist 700)
//! Sector 2: panel 5 (zone 10, dist 900)
//! ```

use tsp_core::flag::YellowKind;
use tsp_core::{CommandTarget, FlagState};
use tsp_core::Fault;

use crate::scenario::{
    CarSetup, EventMatcher, PanelLayout, Scenario, ScenarioSetup, ScenarioStep,
};

fn demo_setup() -> ScenarioSetup {
    ScenarioSetup {
        panels: vec![
            PanelLayout::new(1, 7, 1, 0.0),
            PanelLayout::new(2, 7, 1, 50.0),
            PanelLayout::new(3, 8, 1, 200.0),
            PanelLayout::new(4, 9, 2, 700.0),
            PanelLayout::new(5, 10, 2, 900.0),
        ],
        marshals: vec![7, 8, 9, 10],
        cars: vec![CarSetup::new(44, Some(7)), CarSetup::new(16, Some(9))],
        race_control: true,
    }
}

/// Standard yellow → SC escalation.
///
/// 1. Marshal at zone 7 waves a single yellow.
/// 2. After 1 s upgrades to double yellow.
/// 3. After 2 s Race Control deploys SC globally.
/// 4. Verify all panels show SafetyCar.
pub fn yellow_to_safety_car() -> Scenario {
    Scenario::new("yellow_to_safety_car")
        .with_description(
            "Incident in zone 7: marshal escalates yellow, race control deploys SC.",
        )
        .with_setup(demo_setup())
        .push(ScenarioStep::mark("incident"))
        .push(ScenarioStep::MarshalCommand {
            post: 7,
            target: CommandTarget::Zone(zone(7)),
            flag: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::wait_ms(1_000))
        .push(ScenarioStep::MarshalCommand {
            post: 7,
            target: CommandTarget::Zone(zone(7)),
            flag: FlagState::Yellow(YellowKind::Double),
        })
        .push(ScenarioStep::AssertPanelState {
            panel: 1,
            expected: FlagState::Yellow(YellowKind::Double),
        })
        .push(ScenarioStep::wait_ms(2_000))
        .push(ScenarioStep::mark("sc_deployed"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::SafetyCar,
        })
        .push(ScenarioStep::wait_ms(50))
        .push(ScenarioStep::AssertEffectiveStateGlobal {
            expected: FlagState::SafetyCar,
        })
        .push(ScenarioStep::AssertEventOccurred {
            matcher: EventMatcher::PanelStateChangedTo {
                flag: FlagState::SafetyCar,
                panel: None,
            },
        })
        .push(ScenarioStep::AssertEventOccurred {
            matcher: EventMatcher::EcuNotified {
                car: Some(44),
                flag: Some(FlagState::SafetyCar),
            },
        })
}

/// Hard-stop red flag and a clean restart sequence.
pub fn red_flag_restart() -> Scenario {
    Scenario::new("red_flag_restart")
        .with_description("Race Control issues red flag and later clears with green.")
        .with_setup(demo_setup())
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Red,
        })
        .push(ScenarioStep::wait_ms(20))
        .push(ScenarioStep::AssertEffectiveStateGlobal {
            expected: FlagState::Red,
        })
        .push(ScenarioStep::wait_ms(5_000))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        })
        .push(ScenarioStep::wait_ms(20))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        })
        .push(ScenarioStep::wait_ms(20))
        .push(ScenarioStep::AssertEffectiveStateGlobal {
            expected: FlagState::Green,
        })
}

/// VSC deploy, then VSC ending, then clear.
pub fn vsc_cycle() -> Scenario {
    Scenario::new("vsc_cycle")
        .with_description("Virtual Safety Car phase: deploy, prepare-to-resume, clear.")
        .with_setup(demo_setup())
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::VirtualSafetyCar,
        })
        .push(ScenarioStep::wait_ms(20))
        .push(ScenarioStep::AssertEffectiveStateGlobal {
            expected: FlagState::VirtualSafetyCar,
        })
        .push(ScenarioStep::wait_ms(3_000))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::VscEnding,
        })
        .push(ScenarioStep::wait_ms(2_000))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        })
        .push(ScenarioStep::wait_ms(20))
        .push(ScenarioStep::AssertEffectiveStateGlobal {
            expected: FlagState::Green,
        })
}

/// PSU under-voltage on a single panel triggers a critical diagnostic.
pub fn psu_undervoltage_fault() -> Scenario {
    Scenario::new("psu_undervoltage_fault")
        .with_description("Inject low PSU voltage on panel 3 and expect a critical alert.")
        .with_setup(demo_setup())
        .push(ScenarioStep::InjectFault {
            panel: 3,
            fault: Fault::SetPsuVoltage(38.0),
        })
        .push(ScenarioStep::DiagnosticTick)
        .push(ScenarioStep::AssertEventOccurred {
            matcher: EventMatcher::DiagnosticAlertRaised { panel: Some(3) },
        })
        .push(ScenarioStep::AssertActiveAlerts {
            panel: 3,
            expected_min: 1,
        })
        .push(ScenarioStep::InjectFault {
            panel: 3,
            fault: Fault::SetPsuVoltage(48.0),
        })
        .push(ScenarioStep::DiagnosticTick)
}

/// Two independent marshals raise yellow in different zones; RC overrides
/// only one with green; the other yellow should survive.
pub fn multi_zone_yellow() -> Scenario {
    Scenario::new("multi_zone_yellow")
        .with_description("Two marshals raise yellows in different zones; only one is cleared.")
        .with_setup(demo_setup())
        .push(ScenarioStep::MarshalCommand {
            post: 7,
            target: CommandTarget::Zone(zone(7)),
            flag: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::MarshalCommand {
            post: 9,
            target: CommandTarget::Zone(zone(9)),
            flag: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::wait_ms(50))
        .push(ScenarioStep::AssertPanelState {
            panel: 1,
            expected: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::AssertPanelState {
            panel: 4,
            expected: FlagState::Yellow(YellowKind::Single),
        })
        // Clear only zone 7 (marshal 7 issues Off).
        .push(ScenarioStep::MarshalCommand {
            post: 7,
            target: CommandTarget::Zone(zone(7)),
            flag: FlagState::Off,
        })
        .push(ScenarioStep::wait_ms(50))
        .push(ScenarioStep::AssertPanelState {
            panel: 1,
            expected: FlagState::Off,
        })
        .push(ScenarioStep::AssertPanelState {
            panel: 4,
            expected: FlagState::Yellow(YellowKind::Single),
        })
}

/// Marshal tries to issue red flag — must be rejected and logged.
pub fn marshal_red_rejected() -> Scenario {
    Scenario::new("marshal_red_rejected")
        .with_description("Marshal attempts a red flag; the command machine must reject it.")
        .with_setup(demo_setup())
        .push(ScenarioStep::MarshalCommand {
            post: 7,
            target: CommandTarget::Zone(zone(7)),
            flag: FlagState::Red,
        })
        .push(ScenarioStep::wait_ms(20))
        .push(ScenarioStep::AssertEventOccurred {
            matcher: EventMatcher::CommandRejected {
                flag: Some(FlagState::Red),
            },
        })
}

fn zone(z: u32) -> tsp_core::ZoneId {
    tsp_core::ZoneId::new(z)
}
