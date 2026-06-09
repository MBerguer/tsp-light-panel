//! Fuzz / property-based tests for the FIA priority hierarchy.
//!
//! We generate arbitrary sequences of operator inputs (mix of RC commands and
//! marshal commands for several panels and zones) and replay them through
//! the pure state machine. After each replay we check three invariants:
//!
//! * **Race Control supremacy**: while any panel has a non-`Off` RC override,
//!   its `effective_state` equals that override regardless of marshal input.
//! * **Marshal scoping**: marshal commands for a foreign zone never alter a
//!   panel's state.
//! * **No silent corruption**: the state machine returns either an `Ok`
//!   transition (in which case the new effective state matches the FIA
//!   resolver) or a structured rejection (in which case the panel is
//!   completely unchanged).

use chrono::Utc;
use proptest::prelude::*;

use tsp_core::flag::YellowKind;
use tsp_core::{
    apply_command, resolve_effective_state, CarNumber, CommandSource, CommandTarget, FlagState,
    OperatorId, Panel, PanelCommand, PanelId, PostId, SectorId, TrackPosition, TrackSide, ZoneId,
};

const PANEL_COUNT: u32 = 4;
const ZONE_COUNT: u32 = 3;

fn arb_flag(allow_rc_only: bool) -> impl Strategy<Value = FlagState> {
    let base = prop_oneof![
        Just(FlagState::Off),
        Just(FlagState::Green),
        Just(FlagState::Yellow(YellowKind::Single)),
        Just(FlagState::Yellow(YellowKind::Double)),
        Just(FlagState::Blue),
        Just(FlagState::White),
        Just(FlagState::YellowRedStriped),
    ];
    let rc_only = prop_oneof![
        Just(FlagState::Red),
        Just(FlagState::Chequered),
        Just(FlagState::SafetyCar),
        Just(FlagState::VirtualSafetyCar),
        Just(FlagState::VscEnding),
        (1u32..=99).prop_map(|n| FlagState::BlackForDriver(CarNumber::new(n))),
    ];
    if allow_rc_only {
        prop_oneof![base, rc_only].boxed()
    } else {
        base.boxed()
    }
}

#[derive(Debug, Clone)]
struct Step {
    panel: u32,
    cmd: PanelCommand,
}

fn arb_step() -> impl Strategy<Value = Step> {
    let source = prop_oneof![
        (1u32..=ZONE_COUNT).prop_map(|p| CommandSource::Marshal {
            post: PostId::new(p),
        }),
        Just(CommandSource::RaceControl {
            operator: OperatorId::new()
        }),
    ];
    (
        1u32..=PANEL_COUNT,
        source,
        1u32..=ZONE_COUNT,
        any::<bool>(),
    )
        .prop_flat_map(|(panel, source, zone, prefer_panel_target)| {
            let allow_rc_only = matches!(source, CommandSource::RaceControl { .. });
            arb_flag(allow_rc_only).prop_map(move |flag| {
                let target = if flag.target_car().is_some() {
                    CommandTarget::Panel(PanelId::new(panel))
                } else if flag.is_global_only() {
                    CommandTarget::Global
                } else if prefer_panel_target {
                    CommandTarget::Panel(PanelId::new(panel))
                } else {
                    CommandTarget::Zone(ZoneId::new(zone))
                };
                Step {
                    panel,
                    cmd: PanelCommand::new(source, target, flag),
                }
            })
        })
}

fn make_panel(id: u32) -> Panel {
    Panel::powered_up(
        PanelId::new(id),
        // panel id 1..=4 maps to alternating zones 1,2,1,2 so the test covers
        // both same-zone and cross-zone marshal commands.
        ZoneId::new(((id - 1) % ZONE_COUNT) + 1),
        SectorId::new(1),
        TrackPosition::new(id as f32 * 100.0, TrackSide::Outside),
        Utc::now(),
    )
}

proptest! {
    #[test]
    fn random_sequences_preserve_invariants(steps in prop::collection::vec(arb_step(), 1..40)) {
        let mut panels: Vec<Panel> = (1..=PANEL_COUNT).map(make_panel).collect();

        for step in steps {
            let idx = (step.panel - 1) as usize;
            let panel_zone = panels[idx].zone;
            let panel_id = panels[idx].id;

            // Decide if the command's target actually matches this panel —
            // mirror the runtime hub's behaviour.
            let panel_is_target = match step.cmd.target {
                CommandTarget::Global => true,
                CommandTarget::Sector(s) => s == panels[idx].sector,
                CommandTarget::Zone(z) => z == panel_zone,
                CommandTarget::Panel(p) => p == panel_id,
            };
            if !panel_is_target {
                continue;
            }

            let before = panels[idx].clone();
            match apply_command(panels[idx].clone(), &step.cmd, Utc::now()) {
                Ok((next, _events)) => {
                    let expected = resolve_effective_state(
                        next.override_from_rc,
                        next.local_state,
                        next.follow_up_state,
                    );
                    prop_assert_eq!(next.effective_state, expected,
                        "state machine output diverged from resolver");
                    panels[idx] = next;
                }
                Err((unchanged, _reason)) => {
                    prop_assert_eq!(unchanged.effective_state, before.effective_state,
                        "rejection mutated effective state");
                    prop_assert_eq!(unchanged.local_state, before.local_state,
                        "rejection mutated local state");
                    prop_assert_eq!(unchanged.override_from_rc, before.override_from_rc,
                        "rejection mutated override");
                    panels[idx] = unchanged;
                }
            }

            // Race Control supremacy invariant.
            if let Some(rc) = panels[idx].override_from_rc {
                prop_assert_eq!(panels[idx].effective_state, rc,
                    "RC override should always win");
            }
        }
    }

    #[test]
    fn marshal_only_touches_its_own_zone(
        marshal_zone in 1u32..=ZONE_COUNT,
        panel_zone in 1u32..=ZONE_COUNT,
        flag in arb_flag(false),
    ) {
        prop_assume!(marshal_zone != panel_zone);
        let mut p = make_panel(1);
        p = Panel {
            zone: ZoneId::new(panel_zone),
            ..p
        };
        let before = p.clone();
        let cmd = PanelCommand::new(
            CommandSource::Marshal { post: PostId::new(marshal_zone) },
            CommandTarget::Zone(ZoneId::new(marshal_zone)),
            flag,
        );
        let result = apply_command(p, &cmd, Utc::now());
        prop_assert!(result.is_err(), "marshal command on foreign zone must be rejected");
        let (after, _) = result.unwrap_err();
        prop_assert_eq!(after.effective_state, before.effective_state);
        prop_assert_eq!(after.local_state, before.local_state);
    }
}
