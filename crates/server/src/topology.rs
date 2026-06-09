//! Static description of the circuit topology served to the UI.
//!
//! While [`tsp_core::Panel`] carries the runtime state of a panel, the
//! topology answers the *"where do I draw it?"* question: SVG coordinates,
//! racing-line tangent, zone colour, sector grouping. The default layout
//! shipped with the binary is an oval-with-chicane that fits a 1200×600
//! viewport — concrete F1 circuits (Spa, Monza, …) are interchangeable by
//! providing a different [`CircuitTopology`] JSON.

use std::f32::consts::PI;

use serde::{Deserialize, Serialize};

use tsp_core::{CarNumber, PanelId, PostId, SectorId, ZoneId};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CircuitTopology {
    pub name: String,
    /// Optional human label (e.g. "Autodromo Nazionale Monza — GP Italia 2024").
    /// Falls back to `name` if absent.
    #[serde(default)]
    pub label: Option<String>,
    pub viewport: Viewport,
    /// Curvilinear length of the racing line.
    pub track_length_m: f32,
    /// Sampled centre-line of the racing line, used by the UI to draw the
    /// SVG path. Each point is `(x, y)` in viewport coordinates.
    pub racing_line: Vec<[f32; 2]>,
    pub zones: Vec<ZoneTopology>,
    pub panels: Vec<PanelTopology>,
    /// Marshal posts as published in the FIA Event Notes. Optional — when
    /// absent the binary will spawn one marshal per distinct `zone.id` for
    /// backwards-compatibility with the built-in procedural circuits.
    #[serde(default)]
    pub posts: Vec<MarshalPostTopology>,
    /// Driver / car roster for the event. Optional — when absent the binary
    /// keeps the legacy two-car demo grid (CarNumber 16 + 44).
    #[serde(default)]
    pub drivers: Vec<DriverEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Viewport {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZoneTopology {
    pub id: ZoneId,
    pub sector: SectorId,
    pub label: String,
    /// Hue (0..=359) used by the UI to colour-code zones.
    pub hue: u16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PanelTopology {
    pub id: PanelId,
    pub zone: ZoneId,
    pub sector: SectorId,
    pub distance_m: f32,
    /// SVG coordinates derived from the racing line.
    pub x: f32,
    pub y: f32,
    /// Tangent angle in degrees at this point on the racing line. The UI
    /// uses it to rotate the panel rectangle to "face the cars".
    pub bearing_deg: f32,
    /// Side of the racing line the panel sits on.
    pub side: tsp_core::TrackSide,
}

/// One marshal post as defined in the FIA Event Notes circuit map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarshalPostTopology {
    pub id: PostId,
    /// FIA label like `F2.1` (flag post 1 at turn 2) or `T11.3` (track post
    /// 3 at turn 11). See FIM 2024 numbering scheme.
    pub label: String,
    pub sector: SectorId,
    /// Primary zone this post oversees — used to subscribe the marshal
    /// actor to events for "its" panels.
    pub zone: ZoneId,
    pub distance_m: f32,
    pub x: f32,
    pub y: f32,
    #[serde(default)]
    pub kind: PostKind,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PostKind {
    /// Flag marshal — raises waved / standing flags.
    #[default]
    Flag,
    /// Track marshal — physically recovers cars / cleans debris.
    Track,
    /// LED panel controller — manually drives a light panel when comms fail.
    LedController,
}

/// One driver entry for an event. Pure presentation metadata: runtime state
/// is keyed on [`CarNumber`] only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriverEntry {
    pub number: CarNumber,
    /// 3-letter code, e.g. "VER".
    pub code: String,
    pub name: String,
    pub team: String,
    /// Hex string `#RRGGBB`.
    pub team_color: String,
    /// Optional initial zone for the demo grid.
    #[serde(default)]
    pub initial_zone: Option<ZoneId>,
}

impl CircuitTopology {
    /// Default oval-with-chicane layout used by the binary.
    pub fn demo() -> Self {
        crate::circuits::demo_oval()
    }

    /// Display label — falls back to `name` when no explicit `label` is set.
    pub fn display_label(&self) -> String {
        self.label.clone().unwrap_or_else(|| self.name.clone())
    }

    #[doc(hidden)]
    pub fn _legacy_demo() -> Self {
        let viewport = Viewport {
            width: 1200.0,
            height: 600.0,
        };
        let (racing_line, total_length) = oval_racing_line(viewport);

        // 12 panels distributed around the circuit, split across 6 zones and
        // 3 sectors.
        let panel_specs: Vec<(u32, u32, u32, f32)> = vec![
            (1, 1, 1, 0.10),
            (2, 1, 1, 0.18),
            (3, 2, 1, 0.28),
            (4, 2, 1, 0.34),
            (5, 3, 2, 0.42),
            (6, 3, 2, 0.50),
            (7, 4, 2, 0.58),
            (8, 4, 2, 0.66),
            (9, 5, 3, 0.74),
            (10, 5, 3, 0.82),
            (11, 6, 3, 0.90),
            (12, 6, 3, 0.96),
        ];

        let panels = panel_specs
            .iter()
            .map(|&(id, zone, sector, t)| {
                let (x, y, bearing) = sample_racing_line(&racing_line, t);
                PanelTopology {
                    id: PanelId::new(id),
                    zone: ZoneId::new(zone),
                    sector: SectorId::new(sector),
                    distance_m: total_length * t,
                    x,
                    y,
                    bearing_deg: bearing,
                    side: tsp_core::TrackSide::Outside,
                }
            })
            .collect();

        let zones = (1u32..=6)
            .map(|z| ZoneTopology {
                id: ZoneId::new(z),
                sector: SectorId::new((z - 1) / 2 + 1),
                label: format!("Z{z}"),
                hue: (z as u16) * 60,
            })
            .collect();

        Self {
            name: "demo-oval".into(),
            label: None,
            viewport,
            track_length_m: total_length,
            racing_line,
            zones,
            panels,
            posts: Vec::new(),
            drivers: Vec::new(),
        }
    }
}

fn oval_racing_line(viewport: Viewport) -> (Vec<[f32; 2]>, f32) {
    let cx = viewport.width / 2.0;
    let cy = viewport.height / 2.0;
    let rx = viewport.width * 0.40;
    let ry = viewport.height * 0.36;
    let samples = 256;
    let mut points = Vec::with_capacity(samples);
    let mut length = 0.0;
    let mut prev: Option<[f32; 2]> = None;
    for i in 0..samples {
        let theta = (i as f32 / samples as f32) * 2.0 * PI;
        let x = cx + rx * theta.cos();
        let mut y = cy + ry * theta.sin();
        // Inject a gentle chicane on the back straight (theta around PI).
        if (theta - PI).abs() < 0.5 {
            let t = (theta - PI).abs() / 0.5;
            y -= 60.0 * (1.0 - t);
        }
        if let Some(p) = prev {
            let dx = x - p[0];
            let dy = y - p[1];
            length += (dx * dx + dy * dy).sqrt();
        }
        points.push([x, y]);
        prev = Some([x, y]);
    }
    // Close the loop.
    if let (Some(first), Some(last)) = (points.first(), points.last()) {
        let dx = first[0] - last[0];
        let dy = first[1] - last[1];
        length += (dx * dx + dy * dy).sqrt();
    }
    (points, length)
}

/// Sample the racing line at `t ∈ [0, 1]` and return `(x, y, bearing_deg)`.
fn sample_racing_line(points: &[[f32; 2]], t: f32) -> (f32, f32, f32) {
    if points.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let t = t.clamp(0.0, 0.999_999);
    let n = points.len();
    let pos = t * n as f32;
    let idx = pos.floor() as usize;
    let frac = pos - idx as f32;
    let p0 = points[idx];
    let p1 = points[(idx + 1) % n];
    let x = p0[0] + (p1[0] - p0[0]) * frac;
    let y = p0[1] + (p1[1] - p0[1]) * frac;
    let bearing = (p1[1] - p0[1]).atan2(p1[0] - p0[0]).to_degrees();
    (x, y, bearing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_topology_has_consistent_panels_and_zones() {
        let t = CircuitTopology::demo();
        assert_eq!(t.panels.len(), 12);
        assert_eq!(t.zones.len(), 6);
        for panel in &t.panels {
            assert!(panel.x >= 0.0 && panel.x <= t.viewport.width);
            assert!(panel.y >= 0.0 && panel.y <= t.viewport.height);
        }
    }

    #[test]
    fn racing_line_has_positive_length() {
        let t = CircuitTopology::demo();
        assert!(t.track_length_m > 0.0);
        assert!(t.racing_line.len() > 10);
    }
}
