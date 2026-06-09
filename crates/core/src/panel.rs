//! [`Panel`] aggregate and its hardware health model.
//!
//! Each physical panel keeps three pieces of state:
//!
//! 1. `override_from_rc`: an active Race Control override (top priority).
//! 2. `local_state`: the latest input from the marshal device serving the panel.
//! 3. `effective_state`: cached result of [`crate::state::resolve_effective_state`].
//!
//! The aggregate also carries [`HardwareHealth`] used by the diagnostic
//! supervisor (Phase 1.7) — PSU voltage, temperature, individual LED faults,
//! handshake watermark and the rear "repeater" strip status.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

use crate::flag::FlagState;
use crate::ids::{LedId, PanelId, SectorId, ZoneId};

/// Which side of the racing line the panel is mounted on.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/TrackSide.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TrackSide {
    /// Inside of the corner / inside line.
    Inside,
    /// Outside of the corner / outside line.
    Outside,
    /// Both sides — typically at start/finish gantries.
    Both,
}

/// Coarse position of a panel along the racing line, used by the UI to draw it
/// on top of the SVG track and by the ECU mapper to know which car is "in
/// range".
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/TrackPosition.ts"))]
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TrackPosition {
    /// Curvilinear distance from the start/finish line, in metres.
    pub distance_m: f32,
    /// Side of the track.
    pub side: TrackSide,
}

impl TrackPosition {
    pub const fn new(distance_m: f32, side: TrackSide) -> Self {
        Self { distance_m, side }
    }
}

/// Hardware-level health of a single panel. Populated by the diagnostic
/// supervisor through periodic handshakes.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/HardwareHealth.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HardwareHealth {
    /// LED indices that failed to light up at last self-test.
    pub led_failures: Vec<LedId>,
    /// PSU voltage in volts. Nominal: ~48.0 V, alert below 45.0 V.
    pub psu_voltage: f32,
    /// Temperature in Celsius. Nominal: < 70 °C, alert above 85 °C.
    pub temperature_c: f32,
    /// Last successful handshake with the master server.
    pub last_handshake: DateTime<Utc>,
    /// Whether the rear-facing repeater strip is currently lit.
    pub repeater_active: bool,
}

impl HardwareHealth {
    /// Build a "nominal / freshly powered up" health snapshot anchored at
    /// `now`.
    pub fn nominal(now: DateTime<Utc>) -> Self {
        Self {
            led_failures: Vec::new(),
            psu_voltage: 48.0,
            temperature_c: 35.0,
            last_handshake: now,
            repeater_active: false,
        }
    }

    /// Conservative thresholds. The diagnostic supervisor uses these to decide
    /// whether to raise a [`crate::event::DiagnosticAlert`].
    pub const PSU_MIN_VOLTAGE: f32 = 45.0;
    pub const PSU_MAX_VOLTAGE: f32 = 52.0;
    pub const TEMP_WARN_C: f32 = 75.0;
    pub const TEMP_CRIT_C: f32 = 85.0;
    pub const HANDSHAKE_TIMEOUT_MS: i64 = 2_000;

    pub fn is_psu_healthy(&self) -> bool {
        (Self::PSU_MIN_VOLTAGE..=Self::PSU_MAX_VOLTAGE).contains(&self.psu_voltage)
    }

    pub fn is_temperature_healthy(&self) -> bool {
        self.temperature_c < Self::TEMP_WARN_C
    }

    pub fn is_handshake_healthy(&self, now: DateTime<Utc>) -> bool {
        let elapsed = now.signed_duration_since(self.last_handshake);
        elapsed.num_milliseconds() < Self::HANDSHAKE_TIMEOUT_MS
    }
}

/// The light panel aggregate.
/// Snapshot of a car for the UI overlay.
#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/Car.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Car {
    pub number: crate::ids::CarNumber,
    pub zone: Option<crate::ids::ZoneId>,
    pub last_flag: crate::flag::FlagState,
    pub last_updated: chrono::DateTime<chrono::Utc>,
}

#[cfg_attr(feature = "ts-rs", derive(TS), ts(export, export_to = "../../../web/src/types/Panel.ts"))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Panel {
    pub id: PanelId,
    pub zone: ZoneId,
    pub sector: SectorId,
    pub position: TrackPosition,
    /// Currently displayed flag (cached from [`Self::override_from_rc`],
    /// [`Self::local_state`] and [`Self::follow_up_state`]).
    pub effective_state: FlagState,
    /// Marshal-driven state (lower priority than Race Control overrides).
    pub local_state: Option<FlagState>,
    /// Race Control override; highest priority. `None` means RC is hands-off.
    pub override_from_rc: Option<FlagState>,
    /// System-driven *follow-up* state, used by the FIA "green after yellow"
    /// rule and similar propagated signals. Strictly lower priority than
    /// both Race Control overrides and the marshal's own input — so a
    /// downstream auto-green will never mask an active local yellow or red.
    #[serde(default)]
    pub follow_up_state: Option<FlagState>,
    pub hardware: HardwareHealth,
    /// Timestamp of the last command (RC or marshal) that touched this panel.
    pub last_updated: DateTime<Utc>,
}

impl Panel {
    /// Build a freshly powered-up panel with no commanded state.
    pub fn powered_up(
        id: PanelId,
        zone: ZoneId,
        sector: SectorId,
        position: TrackPosition,
        now: DateTime<Utc>,
    ) -> Self {
        Self {
            id,
            zone,
            sector,
            position,
            effective_state: FlagState::Off,
            local_state: None,
            override_from_rc: None,
            follow_up_state: None,
            hardware: HardwareHealth::nominal(now),
            last_updated: now,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nominal_hardware_passes_all_thresholds() {
        let now = Utc::now();
        let hw = HardwareHealth::nominal(now);
        assert!(hw.is_psu_healthy());
        assert!(hw.is_temperature_healthy());
        assert!(hw.is_handshake_healthy(now));
        assert!(hw.led_failures.is_empty());
    }

    #[test]
    fn powered_up_panel_starts_off() {
        let now = Utc::now();
        let p = Panel::powered_up(
            PanelId::new(7),
            ZoneId::new(3),
            SectorId::new(1),
            TrackPosition::new(123.5, TrackSide::Outside),
            now,
        );
        assert_eq!(p.effective_state, FlagState::Off);
        assert!(p.local_state.is_none());
        assert!(p.override_from_rc.is_none());
    }
}
