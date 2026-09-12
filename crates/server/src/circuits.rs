//! Library of pre-defined circuit topologies.
//!
//! Each circuit is a parametric racing line sampled into ~256 SVG points,
//! plus a fixed-cardinality layout (12 panels, 6 zones, 3 sectors) so the
//! same [`crate::scenario_library`] keeps working regardless of which
//! circuit is loaded.
//!
//! New circuits can be added either:
//! * **programmatically** by writing a new `builder()` function below; or
//! * **declaratively** by dropping a JSON file in `crates/server/circuits/`
//!   that deserialises into [`CircuitTopology`] (see
//!   [`load_from_disk`]).

use std::f32::consts::PI;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tsp_core::{PanelId, SectorId, TrackSide, ZoneId};

use crate::topology::{CircuitTopology, PanelTopology, Viewport, ZoneTopology};

/// One named circuit in the catalogue.
#[derive(Debug, Clone)]
pub struct CircuitEntry {
    pub id: String,
    pub label: String,
    pub build: CircuitBuilder,
}

#[derive(Clone)]
pub enum CircuitBuilder {
    /// Procedural builder compiled into the binary.
    Procedural(fn() -> CircuitTopology),
    /// Topology already parsed from a JSON file on disk.
    Loaded(CircuitTopology),
}

impl std::fmt::Debug for CircuitBuilder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitBuilder::Procedural(_) => f.write_str("Procedural(<fn>)"),
            CircuitBuilder::Loaded(t) => f.debug_tuple("Loaded").field(&t.name).finish(),
        }
    }
}

impl CircuitBuilder {
    pub fn build(&self) -> CircuitTopology {
        match self {
            CircuitBuilder::Procedural(f) => f(),
            CircuitBuilder::Loaded(t) => t.clone(),
        }
    }
}

static DISK_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Register the directory the binary should scan for `*.json` circuit files.
/// Idempotent — only the first call takes effect.
pub fn register_disk_dir(dir: PathBuf) {
    let _ = DISK_DIR.set(Some(dir));
}

fn disk_entries() -> Vec<CircuitEntry> {
    let Some(Some(dir)) = DISK_DIR.get().map(Option::as_ref) else {
        return Vec::new();
    };
    load_from_disk(dir)
        .into_iter()
        .map(|(id, topology)| {
            let label = topology.display_label();
            CircuitEntry {
                id,
                label,
                build: CircuitBuilder::Loaded(topology),
            }
        })
        .collect()
}

/// Built-in catalogue, ordered for the UI dropdown. JSON files dropped in the
/// registered disk directory are prepended so user content shows up at the top.
pub fn builtin() -> Vec<CircuitEntry> {
    let mut out = disk_entries();
    out.extend(vec![
        CircuitEntry {
            id: "demo_oval".into(),
            label: "Demo Oval".into(),
            build: CircuitBuilder::Procedural(demo_oval),
        },
        CircuitEntry {
            id: "monza_like".into(),
            label: "Monza-like (procedural)".into(),
            build: CircuitBuilder::Procedural(monza_like),
        },
        CircuitEntry {
            id: "interlagos_like".into(),
            label: "Interlagos-like (procedural)".into(),
            build: CircuitBuilder::Procedural(interlagos_like),
        },
    ]);
    out
}

pub fn find(id: &str) -> Option<CircuitTopology> {
    builtin().into_iter().find(|c| c.id == id).map(|c| c.build.build())
}

/// Try to read every `*.json` file from `dir` and merge them into the
/// catalogue. Silently ignores I/O / parse errors so the binary never fails
/// to start because of a malformed user file.
pub fn load_from_disk(dir: &Path) -> Vec<(String, CircuitTopology)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return out;
    };
    for e in entries.flatten() {
        let path = e.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let Ok(topology) = serde_json::from_slice::<CircuitTopology>(&bytes) else {
            continue;
        };
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("custom")
            .to_string();
        out.push((id, topology));
    }
    out
}

// ---------- builders ----------------------------------------------------

fn standard_viewport() -> Viewport {
    Viewport {
        width: 1200.0,
        height: 600.0,
    }
}

fn standard_panel_specs() -> Vec<(u32, u32, u32, f32)> {
    vec![
        (1, 1, 1, 0.06),
        (2, 1, 1, 0.16),
        (3, 2, 1, 0.24),
        (4, 2, 1, 0.32),
        (5, 3, 2, 0.40),
        (6, 3, 2, 0.48),
        (7, 4, 2, 0.56),
        (8, 4, 2, 0.64),
        (9, 5, 3, 0.72),
        (10, 5, 3, 0.80),
        (11, 6, 3, 0.88),
        (12, 6, 3, 0.96),
    ]
}

fn standard_zones() -> Vec<ZoneTopology> {
    (1u32..=6)
        .map(|z| ZoneTopology {
            id: ZoneId::new(z),
            sector: SectorId::new((z - 1) / 2 + 1),
            label: format!("Z{z}"),
            hue: (z as u16) * 60,
        })
        .collect()
}

fn build_from_racing_line(
    name: &str,
    racing_line: Vec<[f32; 2]>,
) -> CircuitTopology {
    let viewport = standard_viewport();
    let length = polyline_length(&racing_line);
    let panels = standard_panel_specs()
        .iter()
        .map(|&(id, zone, sector, t)| {
            let (x, y, bearing) = sample(&racing_line, t);
            PanelTopology {
                id: PanelId::new(id),
                zone: ZoneId::new(zone),
                sector: SectorId::new(sector),
                distance_m: length * t,
                x,
                y,
                bearing_deg: bearing,
                side: TrackSide::Outside,
            }
        })
        .collect();
    CircuitTopology {
        name: name.to_string(),
        label: None,
        viewport,
        track_length_m: length,
        racing_line,
        zones: standard_zones(),
        panels,
        posts: Vec::new(),
        drivers: Vec::new(),
    }
}

/// Oval with a soft chicane on the back straight — the original demo.
pub fn demo_oval() -> CircuitTopology {
    let viewport = standard_viewport();
    let cx = viewport.width / 2.0;
    let cy = viewport.height / 2.0;
    let rx = viewport.width * 0.40;
    let ry = viewport.height * 0.36;
    let samples = 256;
    let mut points = Vec::with_capacity(samples);
    for i in 0..samples {
        let theta = (i as f32 / samples as f32) * 2.0 * PI;
        let x = cx + rx * theta.cos();
        let mut y = cy + ry * theta.sin();
        if (theta - PI).abs() < 0.5 {
            let t = (theta - PI).abs() / 0.5;
            y -= 60.0 * (1.0 - t);
        }
        points.push([x, y]);
    }
    build_from_racing_line("demo_oval", points)
}

/// Monza-like: long straight on top, gentle turn 1, "lesmos" wiggle,
/// parabolica on the bottom-right.
pub fn monza_like() -> CircuitTopology {
    let viewport = standard_viewport();
    let cx = viewport.width / 2.0;
    let cy = viewport.height / 2.0;
    let samples = 320;
    let mut points = Vec::with_capacity(samples);
    for i in 0..samples {
        let t = i as f32 / samples as f32;
        let theta = t * 2.0 * PI;
        // Stretched ellipse — long horizontal main straight.
        let mut x = cx + 470.0 * theta.cos();
        let mut y = cy + 220.0 * theta.sin();
        // Chicane (variante della Roggia) on the upper right.
        if (0.10..0.20).contains(&t) {
            let s = (t - 0.10) / 0.10;
            y += 40.0 * (s * PI * 2.0).sin();
        }
        // Lesmos S — second chicane.
        if (0.25..0.40).contains(&t) {
            let s = (t - 0.25) / 0.15;
            y += 50.0 * (s * PI * 3.0).sin();
        }
        // Parabolica — flatten the bottom of the ellipse.
        if (0.55..0.85).contains(&t) {
            let s = (t - 0.55) / 0.30;
            x -= 30.0 * (s * PI).sin();
            y += 30.0 * (s * PI).sin();
        }
        points.push([x, y]);
    }
    build_from_racing_line("monza_like", points)
}

/// Interlagos-like: anti-clockwise, descending hairpin, "Senna S" double
/// turn, "Reta Oposta" back straight and complex final sector.
pub fn interlagos_like() -> CircuitTopology {
    let viewport = standard_viewport();
    let cx = viewport.width / 2.0;
    let cy = viewport.height / 2.0;
    let samples = 320;
    let mut points = Vec::with_capacity(samples);
    for i in 0..samples {
        let t = i as f32 / samples as f32;
        let theta = -t * 2.0 * PI; // anti-clockwise
        let mut x = cx + 420.0 * theta.cos();
        let mut y = cy + 210.0 * theta.sin();
        // Senna S after start/finish.
        if (0.05..0.18).contains(&t) {
            let s = (t - 0.05) / 0.13;
            x -= 60.0 * (s * PI * 2.0).sin();
            y += 40.0 * (s * PI * 2.0).sin();
        }
        // Mid-section "Descida do Lago" — descending sweeper.
        if (0.35..0.55).contains(&t) {
            let s = (t - 0.35) / 0.20;
            y -= 30.0 * (s * PI).sin();
        }
        // Complex final sector: Mergulho / Junção / Subida.
        if (0.78..0.96).contains(&t) {
            let s = (t - 0.78) / 0.18;
            x += 40.0 * (s * PI * 2.0).sin();
            y -= 20.0 * (s * PI * 2.0).sin();
        }
        points.push([x, y]);
    }
    build_from_racing_line("interlagos_like", points)
}

fn polyline_length(points: &[[f32; 2]]) -> f32 {
    if points.is_empty() {
        return 0.0;
    }
    let mut total = 0.0;
    for i in 1..points.len() {
        let dx = points[i][0] - points[i - 1][0];
        let dy = points[i][1] - points[i - 1][1];
        total += (dx * dx + dy * dy).sqrt();
    }
    let dx = points[0][0] - points.last().unwrap()[0];
    let dy = points[0][1] - points.last().unwrap()[1];
    total + (dx * dx + dy * dy).sqrt()
}

fn sample(points: &[[f32; 2]], t: f32) -> (f32, f32, f32) {
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
    fn every_procedural_circuit_has_12_panels() {
        for c in builtin() {
            // Skip any JSON-loaded circuits in the test — they may legitimately
            // have a different cardinality (e.g. monza_2024 ships 22 panels).
            let CircuitBuilder::Procedural(f) = c.build else {
                continue;
            };
            let topology = f();
            assert_eq!(topology.panels.len(), 12, "{}", c.id);
            assert_eq!(topology.zones.len(), 6);
            assert!(topology.track_length_m > 0.0);
        }
    }

    #[test]
    fn el_pinar_n13_disk_topology_is_valid() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("circuits/el_pinar_n13.json");
        if !path.exists() {
            return;
        }
        let bytes = std::fs::read(&path).expect("read el_pinar_n13.json");
        let topology: CircuitTopology =
            serde_json::from_slice(&bytes).expect("deserialize el_pinar_n13.json");
        assert_eq!(topology.name, "el_pinar_n13");
        assert_eq!(topology.track_length_m, 4000.0);
        assert_eq!(topology.zones.len(), 16);
        assert_eq!(topology.panels.len(), 16);
        assert_eq!(topology.posts.len(), 16);
        assert!(!topology.racing_line.is_empty());
    }
}
