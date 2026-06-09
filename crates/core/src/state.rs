//! Pure state machine — no I/O, no `tokio`. Takes a [`Panel`] + a
//! [`PanelCommand`] and returns either a list of [`DomainEvent`]s plus the new
//! panel state or a structured rejection.
//!
//! The machine is the single source of truth for the FIA priority hierarchy:
//!
//! ```text
//! Race Control overrides > Marshal local input > Off
//! ```
//!
//! Keeping it pure means we can:
//!
//! * unit-test it exhaustively without spinning up actors,
//! * fuzz it with `proptest`,
//! * and **replay** an event log deterministically (Phase 2).

use chrono::{DateTime, Utc};

use crate::command::{CommandSource, CommandTarget, PanelCommand};
use crate::error::CommandRejection;
use crate::event::{DomainEvent, EventBuilder};
use crate::flag::FlagState;
use crate::panel::Panel;

/// Resolve which flag a panel must currently display, given Race Control's
/// override, the marshal's local state, and any system-driven follow-up
/// state (e.g. the FIA "green after yellow" rule).
///
/// FIA priority: `RC override > marshal local > system follow-up > Off`.
/// Returning `FlagState` (not `Option`) keeps callers branch-free.
pub fn resolve_effective_state(
    override_from_rc: Option<FlagState>,
    local_state: Option<FlagState>,
    follow_up_state: Option<FlagState>,
) -> FlagState {
    override_from_rc
        .or(local_state)
        .or(follow_up_state)
        .unwrap_or(FlagState::Off)
}

/// Apply a command to a panel.
///
/// Returns the **new panel state** and the **events** that the actor system
/// must publish + persist. The command itself is validated here against the
/// FIA matrix (see [`validate`]).
///
/// `now` is injected to keep the function deterministic and easy to test —
/// production callers pass `Utc::now()`, tests pass a fixed timestamp.
pub fn apply_command(
    panel: Panel,
    cmd: &PanelCommand,
    now: DateTime<Utc>,
) -> Result<(Panel, Vec<DomainEvent>), (Panel, CommandRejection)> {
    if let Err(reason) = validate(panel.zone, cmd) {
        return Err((panel, reason));
    }

    let original = panel.clone();
    let builder = EventBuilder::new(now);
    let mut events = Vec::with_capacity(2);
    let mut next = panel;

    let previous_effective = next.effective_state;

    match cmd.source {
        CommandSource::RaceControl { .. } => {
            // RC sets / clears its override. A "clear" is encoded as
            // `FlagState::Off` issued globally.
            let new_override = if cmd.flag == FlagState::Off && cmd.target.is_global() {
                None
            } else {
                Some(cmd.flag)
            };
            next.override_from_rc = new_override;
        }
        CommandSource::Marshal { .. } => {
            let new_local = if cmd.flag == FlagState::Off {
                None
            } else {
                Some(cmd.flag)
            };
            next.local_state = new_local;
        }
        CommandSource::System => {
            // System commands operate on the system-level `follow_up_state`
            // bucket — strictly *below* both the RC override and the marshal
            // local input. Used by the FIA "green after yellow" propagator
            // so an upstream marshal yellow lights up the next zone green
            // without ever masking that zone's own commands.
            next.follow_up_state = if cmd.flag == FlagState::Off {
                None
            } else {
                Some(cmd.flag)
            };
        }
    }

    let new_effective = resolve_effective_state(
        next.override_from_rc,
        next.local_state,
        next.follow_up_state,
    );

    if !is_transition_allowed(previous_effective, new_effective) {
        // Reject *and* fully revert. We can't leave the override/local state
        // partially updated or the next command would build on top of a
        // ghost mutation that never produced a `PanelStateChanged` event.
        return Err((
            original,
            CommandRejection::InvalidTransition {
                from: previous_effective,
                to: new_effective,
            },
        ));
    }

    // Now that the transition is accepted we can emit the auxiliary "state
    // tracking" event the actor system uses to drive UI badges, before the
    // main `PanelStateChanged` (or `CommandAccepted` for no-ops).
    match cmd.source {
        CommandSource::RaceControl { .. } => {
            events.push(DomainEvent::RaceControlOverrideSet {
                id: crate::ids::EventId::new(),
                panel: next.id,
                flag: next.override_from_rc,
                timestamp: now,
            });
        }
        CommandSource::Marshal { .. } => {
            events.push(DomainEvent::MarshalLocalStateSet {
                id: crate::ids::EventId::new(),
                panel: next.id,
                flag: next.local_state,
                timestamp: now,
            });
        }
        CommandSource::System => {
            events.push(DomainEvent::FollowUpStateSet {
                id: crate::ids::EventId::new(),
                panel: next.id,
                flag: next.follow_up_state,
                timestamp: now,
            });
        }
    }

    next.effective_state = new_effective;
    next.last_updated = now;

    if new_effective != previous_effective {
        events.push(builder.panel_state_changed(cmd, next.id, previous_effective, new_effective));
    } else {
        events.push(builder.accepted(cmd));
    }

    Ok((next, events))
}

/// Static validation of a command against the FIA matrix.
///
/// This is separate from [`apply_command`] so the WS gateway can short-circuit
/// obviously malformed inputs (e.g. a marshal trying to wave a red flag) before
/// they touch any actor.
pub fn validate(
    panel_zone: crate::ids::ZoneId,
    cmd: &PanelCommand,
) -> Result<(), CommandRejection> {
    // Marshals cannot issue RC-only flags.
    if cmd.source.is_marshal() && cmd.flag.is_race_control_only() {
        return Err(CommandRejection::NotAllowedForMarshal { flag: cmd.flag });
    }

    // Global-only flags (Red, Chequered) must target everyone.
    if cmd.flag.is_global_only() && !cmd.target.is_global() {
        return Err(CommandRejection::GlobalFlagOnNonGlobalTarget { flag: cmd.flag });
    }

    // Driver-specific flags must target a single panel.
    if cmd.flag.target_car().is_some() && !matches!(cmd.target, CommandTarget::Panel(_)) {
        return Err(CommandRejection::DriverSpecificFlagOnWrongTarget { flag: cmd.flag });
    }

    // A marshal can only command its own zone / a panel inside it. Panel-level
    // targeting is allowed if the caller is sure the panel belongs to the zone.
    if let CommandSource::Marshal { .. } = cmd.source {
        match cmd.target {
            CommandTarget::Global | CommandTarget::Sector(_) => {
                return Err(CommandRejection::MarshalOutOfZone);
            }
            CommandTarget::Zone(zone) if zone != panel_zone => {
                return Err(CommandRejection::MarshalOutOfZone);
            }
            _ => {}
        }
    }

    Ok(())
}

/// Whether a transition between two displayed flags is allowed at the panel
/// level.
///
/// The FIA matrix only really forbids one transition outright:
/// `Chequered → anything other than Off` (the session must be reset first).
/// Everything else is permitted in real operations: a yellow can upgrade to
/// double-yellow, can be cleared with green, etc.
pub const fn is_transition_allowed(from: FlagState, to: FlagState) -> bool {
    match (from, to) {
        (FlagState::Chequered, FlagState::Off) | (FlagState::Chequered, FlagState::Chequered) => {
            true
        }
        (FlagState::Chequered, _) => false,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{CommandSource, CommandTarget};
    use crate::flag::YellowKind;
    use crate::ids::{OperatorId, PanelId, PostId, SectorId, ZoneId};
    use crate::panel::{TrackPosition, TrackSide};

    fn make_panel(zone: u32) -> Panel {
        Panel::powered_up(
            PanelId::new(1),
            ZoneId::new(zone),
            SectorId::new(1),
            TrackPosition::new(0.0, TrackSide::Outside),
            Utc::now(),
        )
    }

    #[test]
    fn resolver_prefers_rc_override() {
        assert_eq!(
            resolve_effective_state(Some(FlagState::Red), Some(FlagState::Green), None),
            FlagState::Red
        );
        assert_eq!(
            resolve_effective_state(None, Some(FlagState::Yellow(YellowKind::Single)), None),
            FlagState::Yellow(YellowKind::Single)
        );
        assert_eq!(resolve_effective_state(None, None, None), FlagState::Off);
    }

    #[test]
    fn resolver_falls_back_to_follow_up_state() {
        // No RC, no marshal — system follow-up (e.g. auto-green) wins.
        assert_eq!(
            resolve_effective_state(None, None, Some(FlagState::Green)),
            FlagState::Green
        );
        // Marshal yellow beats the system follow-up green — a marshal who
        // sees a fresh incident in their own zone is never masked by the
        // upstream auto-green.
        assert_eq!(
            resolve_effective_state(
                None,
                Some(FlagState::Yellow(YellowKind::Single)),
                Some(FlagState::Green),
            ),
            FlagState::Yellow(YellowKind::Single)
        );
    }

    #[test]
    fn marshal_yellow_is_accepted() {
        let panel = make_panel(7);
        let cmd = PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(7),
            },
            CommandTarget::Zone(ZoneId::new(7)),
            FlagState::Yellow(YellowKind::Single),
        );
        let (next, events) = apply_command(panel, &cmd, Utc::now()).expect("accepted");
        assert_eq!(next.effective_state, FlagState::Yellow(YellowKind::Single));
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn marshal_cannot_issue_red() {
        let panel = make_panel(7);
        let cmd = PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(7),
            },
            CommandTarget::Zone(ZoneId::new(7)),
            FlagState::Red,
        );
        let err = apply_command(panel.clone(), &cmd, Utc::now()).unwrap_err();
        assert!(matches!(
            err.1,
            CommandRejection::NotAllowedForMarshal { .. }
        ));
        assert_eq!(err.0.effective_state, FlagState::Off);
    }

    #[test]
    fn rc_red_overrides_marshal_yellow() {
        let mut panel = make_panel(3);
        panel.local_state = Some(FlagState::Yellow(YellowKind::Double));
        panel.effective_state = FlagState::Yellow(YellowKind::Double);

        let rc_red = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Global,
            FlagState::Red,
        );
        let (next, _events) = apply_command(panel, &rc_red, Utc::now()).expect("accepted");
        assert_eq!(next.effective_state, FlagState::Red);
        assert_eq!(next.override_from_rc, Some(FlagState::Red));
        assert_eq!(next.local_state, Some(FlagState::Yellow(YellowKind::Double)));
    }

    #[test]
    fn red_on_zone_is_rejected() {
        let panel = make_panel(2);
        let cmd = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Zone(ZoneId::new(2)),
            FlagState::Red,
        );
        let err = apply_command(panel, &cmd, Utc::now()).unwrap_err();
        assert!(matches!(
            err.1,
            CommandRejection::GlobalFlagOnNonGlobalTarget { .. }
        ));
    }

    #[test]
    fn black_flag_requires_panel_target() {
        let panel = make_panel(1);
        let bad = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Global,
            FlagState::BlackForDriver(crate::ids::CarNumber::new(44)),
        );
        let err = apply_command(panel.clone(), &bad, Utc::now()).unwrap_err();
        assert!(matches!(
            err.1,
            CommandRejection::DriverSpecificFlagOnWrongTarget { .. }
        ));

        let good = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Panel(panel.id),
            FlagState::BlackForDriver(crate::ids::CarNumber::new(44)),
        );
        let (next, _) = apply_command(panel, &good, Utc::now()).expect("accepted");
        assert_eq!(
            next.effective_state,
            FlagState::BlackForDriver(crate::ids::CarNumber::new(44))
        );
    }

    #[test]
    fn chequered_to_green_is_rejected() {
        let mut panel = make_panel(1);
        panel.override_from_rc = Some(FlagState::Chequered);
        panel.effective_state = FlagState::Chequered;

        let cmd = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Panel(panel.id),
            FlagState::Green,
        );
        let err = apply_command(panel, &cmd, Utc::now()).unwrap_err();
        assert!(matches!(err.1, CommandRejection::InvalidTransition { .. }));
    }

    #[test]
    fn rc_off_globally_clears_override() {
        let mut panel = make_panel(1);
        panel.override_from_rc = Some(FlagState::Red);
        panel.effective_state = FlagState::Red;

        let clear = PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Global,
            FlagState::Off,
        );
        let (next, _events) = apply_command(panel, &clear, Utc::now()).expect("accepted");
        assert!(next.override_from_rc.is_none());
        assert_eq!(next.effective_state, FlagState::Off);
    }

    #[test]
    fn marshal_off_clears_local_state() {
        let mut panel = make_panel(4);
        panel.local_state = Some(FlagState::Yellow(YellowKind::Single));
        panel.effective_state = FlagState::Yellow(YellowKind::Single);

        let clear = PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(4),
            },
            CommandTarget::Zone(ZoneId::new(4)),
            FlagState::Off,
        );
        let (next, _events) = apply_command(panel, &clear, Utc::now()).expect("accepted");
        assert!(next.local_state.is_none());
        assert_eq!(next.effective_state, FlagState::Off);
    }
}
