//! Flag states displayed by a light panel.
//!
//! The catalogue matches the FIA sporting regulations and the signalling
//! capabilities listed in FIA 3504-2019 §4 + Appendix 2 (flag display modes).
//! A few notes:
//!
//! * Yellow flags can be **single-waving** (slow down, no overtaking until clear)
//!   or **double-waving** (be prepared to stop, marshals or obstruction on track).
//! * The yellow/red striped flag warns about a slippery surface — *not* a
//!   combination of "yellow + red" sectors. It is **different** from `Rain`,
//!   which is a static rain warning (originally a FIM/MotoGP signal but part of
//!   the FIA homologated panel modes). On the physical EM Motorsport controller
//!   `Rain` is triggered by holding the SLIPPERY button for ≥5 seconds.
//! * Black, black/orange-disc and black/white-diagonal flags are **driver
//!   specific** (only Race Control can issue them and they target a specific
//!   `CarNumber`).
//! * `SafetyCar`, `VirtualSafetyCar` and `VscEnding` are panel signals, not
//!   flags strictly speaking, but they are part of the same display surface.
//! * `FullCourseYellow`, `Code60`, `SlowZone` and `NextSlow` are
//!   speed-restriction procedures common to endurance racing (WEC, ELMS,
//!   24H Series). FCY is 80 km/h global, Code 60 is 60 km/h global, SlowZone
//!   is a local 80 km/h zone, and NextSlow warns the preceding zone.
//! * `PitEntryOpen` / `PitEntryClosed` are static informational signals.
//! * `StandingStart` / `RollingStart` describe a restart procedure.
//! * `CustomBlue` is a championship-configurable variant of blue.

use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

use crate::ids::CarNumber;

/// The set of signals a panel can show.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/FlagState.ts"))]
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum FlagState {
    /// Panel is off (no warning active). Equivalent to "no flag".
    #[default]
    Off,
    /// Green flag — track is clear / end of yellow zone.
    Green,
    /// Yellow flag (single or double waving).
    Yellow(YellowKind),
    /// Blue flag — faster car about to overtake (typically targets a `CarNumber`
    /// but on trackside panels it is broadcast in the affected zone).
    Blue,
    /// White flag — slow vehicle on track.
    White,
    /// Yellow with red stripes — slippery surface (oil, water, debris).
    YellowRedStriped,
    /// Static rain warning. Distinct from `YellowRedStriped`: this signals
    /// generalised wet conditions, not a localised slippery spot. On the
    /// EM Motorsport marshal controller it is raised by holding the
    /// SLIPPERY button for ≥5 seconds (hidden long-press shortcut).
    Rain,
    /// Red flag — session stopped. Always global.
    Red,
    /// Chequered flag — end of session. Always global, only Race Control.
    Chequered,
    /// Safety Car deployed.
    SafetyCar,
    /// Virtual Safety Car deployed.
    VirtualSafetyCar,
    /// VSC about to end (boards show "VSC ENDING").
    VscEnding,
    /// Full Course Yellow — global 80 km/h restriction, no overtaking
    /// (endurance racing). Less severe than a Safety Car deployment.
    FullCourseYellow,
    /// Code 60 — global 60 km/h restriction, purple panel showing "60"
    /// (24H Series, club racing, sometimes WEC).
    Code60,
    /// Local Slow Zone — 80 km/h within the affected zone, panel shows
    /// "SZ" with a flashing yellow border (WEC / ELMS).
    SlowZone,
    /// Aviso "Next Slow" — desplegado en la zona inmediatamente anterior
    /// a una Slow Zone activa, para que los pilotos anticipen el frenado.
    NextSlow,
    /// Pit lane open — informational static signal.
    PitEntryOpen,
    /// Pit lane closed — informational static signal (typical bajo SC o
    /// procedimientos de start).
    PitEntryClosed,
    /// Standing start procedure — la grilla larga parada.
    StandingStart,
    /// Rolling start procedure — la grilla larga detrás del Safety Car.
    RollingStart,
    /// Championship-configurable blue variant (e.g. F2/F3, IndyCar).
    CustomBlue,
    /// Black flag for a specific car (disqualification / return to pits).
    BlackForDriver(CarNumber),
    /// Black flag with orange disc — mechanical issue, car must return to pits.
    BlackOrangeDisc(CarNumber),
    /// Black/white diagonal flag — unsportsmanlike behaviour warning.
    BlackWhiteDiagonal(CarNumber),
}

/// Single vs double waving yellow.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/YellowKind.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum YellowKind {
    Single,
    Double,
}

impl FlagState {
    /// Whether this flag can only ever be issued by Race Control.
    ///
    /// Per FIA 3504-2019 §5.2 the marshal control device cannot raise red,
    /// chequered or driver-specific black flags — those are race-director
    /// exclusive. We extend this list with the global endurance procedures
    /// (FCY, Code 60, Pit Entry, Starts) and `CustomBlue`, none of which a
    /// trackside marshal raises locally.
    pub const fn is_race_control_only(self) -> bool {
        matches!(
            self,
            FlagState::Red
                | FlagState::Chequered
                | FlagState::SafetyCar
                | FlagState::VirtualSafetyCar
                | FlagState::VscEnding
                | FlagState::FullCourseYellow
                | FlagState::Code60
                | FlagState::PitEntryOpen
                | FlagState::PitEntryClosed
                | FlagState::StandingStart
                | FlagState::RollingStart
                | FlagState::CustomBlue
                | FlagState::BlackForDriver(_)
                | FlagState::BlackOrangeDisc(_)
                | FlagState::BlackWhiteDiagonal(_)
        )
    }

    /// Whether this flag, when issued by Race Control, must apply globally
    /// (overriding any local marshal input across the whole circuit).
    pub const fn is_global_only(self) -> bool {
        matches!(
            self,
            FlagState::Red
                | FlagState::Chequered
                | FlagState::FullCourseYellow
                | FlagState::Code60
                | FlagState::StandingStart
                | FlagState::RollingStart
        )
    }

    /// Whether this flag targets a specific car (driver-specific signals).
    pub const fn target_car(self) -> Option<CarNumber> {
        match self {
            FlagState::BlackForDriver(c)
            | FlagState::BlackOrangeDisc(c)
            | FlagState::BlackWhiteDiagonal(c) => Some(c),
            _ => None,
        }
    }

    /// Whether this flag is *informational* and does not block normal racing
    /// (used by the diagnostic UI and ECU mapping).
    pub const fn is_informational(self) -> bool {
        matches!(self, FlagState::Off | FlagState::Green | FlagState::White)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn red_and_chequered_are_global_only() {
        assert!(FlagState::Red.is_global_only());
        assert!(FlagState::Chequered.is_global_only());
        assert!(!FlagState::Yellow(YellowKind::Double).is_global_only());
    }

    #[test]
    fn driver_specific_flags_carry_car_number() {
        let car = CarNumber::new(44);
        assert_eq!(FlagState::BlackForDriver(car).target_car(), Some(car));
        assert_eq!(FlagState::Yellow(YellowKind::Single).target_car(), None);
    }

    #[test]
    fn rc_only_flags_match_fia_catalogue() {
        assert!(FlagState::Red.is_race_control_only());
        assert!(FlagState::Chequered.is_race_control_only());
        assert!(FlagState::SafetyCar.is_race_control_only());
        assert!(!FlagState::Yellow(YellowKind::Single).is_race_control_only());
        assert!(!FlagState::Green.is_race_control_only());
    }

    #[test]
    fn serde_roundtrip() {
        let original = FlagState::Yellow(YellowKind::Double);
        let json = serde_json::to_string(&original).unwrap();
        let back: FlagState = serde_json::from_str(&json).unwrap();
        assert_eq!(original, back);
    }
}
