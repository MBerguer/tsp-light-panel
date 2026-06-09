//! Property-based tests for the panel state machine.
//!
//! These tests check FIA invariants that *must* hold regardless of the
//! particular sequence of commands:
//!
//! 1. **RC supremacy**: while Race Control holds a non-`Off` override, the
//!    effective state always equals that override.
//! 2. **Marshal cannot raise RC-only flags**: red, chequered, SC/VSC and
//!    driver-specific blacks issued by a marshal must always be rejected.
//! 3. **Idempotency of clears**: clearing an already-clear panel is a no-op.
//! 4. **Resolver definition**: `resolve_effective_state` matches its semantic
//!    specification (RC override > marshal > Off) for any input.

use chrono::Utc;
use proptest::prelude::*;

use tsp_core::{
    apply_command, resolve_effective_state, CommandSource, CommandTarget, FlagState, OperatorId,
    Panel, PanelCommand, PostId, SectorId, TrackPosition, ZoneId,
};

fn arb_flag() -> impl Strategy<Value = FlagState> {
    use tsp_core::flag::YellowKind;
    use tsp_core::CarNumber;
    prop_oneof![
        Just(FlagState::Off),
        Just(FlagState::Green),
        Just(FlagState::Yellow(YellowKind::Single)),
        Just(FlagState::Yellow(YellowKind::Double)),
        Just(FlagState::Blue),
        Just(FlagState::White),
        Just(FlagState::YellowRedStriped),
        Just(FlagState::Red),
        Just(FlagState::Chequered),
        Just(FlagState::SafetyCar),
        Just(FlagState::VirtualSafetyCar),
        Just(FlagState::VscEnding),
        (1u32..=99).prop_map(|n| FlagState::BlackForDriver(CarNumber::new(n))),
        (1u32..=99).prop_map(|n| FlagState::BlackOrangeDisc(CarNumber::new(n))),
        (1u32..=99).prop_map(|n| FlagState::BlackWhiteDiagonal(CarNumber::new(n))),
    ]
}

fn fresh_panel(zone: u32) -> Panel {
    Panel::powered_up(
        tsp_core::PanelId::new(1),
        ZoneId::new(zone),
        SectorId::new(1),
        TrackPosition::new(0.0, tsp_core::TrackSide::Outside),
        Utc::now(),
    )
}

proptest! {
    #[test]
    fn resolver_matches_specification(
        rc in proptest::option::of(arb_flag()),
        local in proptest::option::of(arb_flag()),
        follow_up in proptest::option::of(arb_flag()),
    ) {
        let resolved = resolve_effective_state(rc, local, follow_up);
        let expected = match (rc, local, follow_up) {
            (Some(r), _, _) => r,
            (None, Some(l), _) => l,
            (None, None, Some(f)) => f,
            (None, None, None) => FlagState::Off,
        };
        prop_assert_eq!(resolved, expected);
    }

    #[test]
    fn marshal_rc_only_flags_are_always_rejected(
        flag in arb_flag().prop_filter("rc-only", |f| f.is_race_control_only()),
        zone in 1u32..50,
    ) {
        let panel = fresh_panel(zone);
        let cmd = PanelCommand::new(
            CommandSource::Marshal { post: PostId::new(zone) },
            CommandTarget::Zone(ZoneId::new(zone)),
            flag,
        );
        let res = apply_command(panel, &cmd, Utc::now());
        prop_assert!(res.is_err(), "marshal should never be able to raise {:?}", flag);
    }

    #[test]
    fn rc_global_flag_supersedes_any_marshal_state(
        marshal_flag in arb_flag().prop_filter("not rc-only", |f| !f.is_race_control_only()),
        zone in 1u32..50,
    ) {
        let panel = fresh_panel(zone);

        let marshal_cmd = PanelCommand::new(
            CommandSource::Marshal { post: PostId::new(zone) },
            CommandTarget::Zone(ZoneId::new(zone)),
            marshal_flag,
        );
        let (panel, _) = apply_command(panel, &marshal_cmd, Utc::now())
            .expect("marshal cmd accepted");

        let rc_cmd = PanelCommand::new(
            CommandSource::RaceControl { operator: OperatorId::new() },
            CommandTarget::Global,
            FlagState::Red,
        );
        let (panel, _) = apply_command(panel, &rc_cmd, Utc::now())
            .expect("rc red accepted");

        prop_assert_eq!(panel.effective_state, FlagState::Red);
    }

    #[test]
    fn clearing_off_panel_is_idempotent(zone in 1u32..50) {
        let panel = fresh_panel(zone);
        let cmd = PanelCommand::new(
            CommandSource::Marshal { post: PostId::new(zone) },
            CommandTarget::Zone(ZoneId::new(zone)),
            FlagState::Off,
        );
        let (next, _) = apply_command(panel.clone(), &cmd, Utc::now())
            .expect("clear accepted");
        prop_assert_eq!(next.effective_state, FlagState::Off);
        prop_assert_eq!(next.local_state, None);
    }
}
