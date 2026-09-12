//! Built-in library of scenarios shipped with the productive server.
//!
//! These scenarios are explicitly authored against the
//! [`crate::topology::CircuitTopology::demo`] layout (12 panels, zones 1-6,
//! sectors 1-3). Picking a scenario from the UI populates the runner with
//! one of these, executes it against the *live* `World`, and broadcasts the
//! same `DomainEvent`s every connected client already subscribes to.

use tsp_core::flag::YellowKind;
use tsp_core::scenario::{EventMatcher, Scenario, ScenarioStep};
use tsp_core::{CommandTarget, Fault, FlagState, ZoneId};

const ALL_ZONES: [u32; 6] = [1, 2, 3, 4, 5, 6];

fn zone(z: u32) -> ZoneId {
    ZoneId::new(z)
}

/// Yellow-flag escalation at zone 3 → SC deployment.
pub fn yellow_to_sc() -> Scenario {
    Scenario::new("yellow_to_sc")
        .with_description(
            "Zone 3 marshal raises single, escalates to double, RC deploys SC.",
        )
        .push(ScenarioStep::mark("incident"))
        .push(ScenarioStep::MarshalCommand {
            post: 3,
            target: CommandTarget::Zone(zone(3)),
            flag: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::wait_ms(1500))
        .push(ScenarioStep::MarshalCommand {
            post: 3,
            target: CommandTarget::Zone(zone(3)),
            flag: FlagState::Yellow(YellowKind::Double),
        })
        .push(ScenarioStep::wait_ms(2500))
        .push(ScenarioStep::mark("sc_deployed"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::SafetyCar,
        })
        .push(ScenarioStep::wait_ms(4000))
        .push(ScenarioStep::mark("sc_clearing"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        })
        .push(ScenarioStep::wait_ms(800))
        .push(ScenarioStep::MarshalCommand {
            post: 3,
            target: CommandTarget::Zone(zone(3)),
            flag: FlagState::Off,
        })
}

/// Big-hit red flag and clean restart.
pub fn red_flag_restart() -> Scenario {
    Scenario::new("red_flag_restart")
        .with_description("RC raises red flag, holds, then restarts under green.")
        .push(ScenarioStep::mark("red_flag"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Red,
        })
        .push(ScenarioStep::wait_ms(4000))
        .push(ScenarioStep::mark("clearing"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        })
        .push(ScenarioStep::wait_ms(600))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        })
}

/// VSC deploy → ending → clear.
pub fn vsc_cycle() -> Scenario {
    Scenario::new("vsc_cycle")
        .with_description("Virtual Safety Car phase across the field.")
        .push(ScenarioStep::mark("vsc_deployed"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::VirtualSafetyCar,
        })
        .push(ScenarioStep::wait_ms(3000))
        .push(ScenarioStep::mark("vsc_ending"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::VscEnding,
        })
        .push(ScenarioStep::wait_ms(2000))
        .push(ScenarioStep::mark("green"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        })
        .push(ScenarioStep::wait_ms(800))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        })
}

/// Two simultaneous incidents on opposite parts of the track.
pub fn multi_zone_yellow() -> Scenario {
    Scenario::new("multi_zone_yellow")
        .with_description("Two independent zones run yellow at the same time.")
        .push(ScenarioStep::MarshalCommand {
            post: 2,
            target: CommandTarget::Zone(zone(2)),
            flag: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::MarshalCommand {
            post: 5,
            target: CommandTarget::Zone(zone(5)),
            flag: FlagState::Yellow(YellowKind::Double),
        })
        .push(ScenarioStep::wait_ms(3500))
        .push(ScenarioStep::mark("zone_2_clear"))
        .push(ScenarioStep::MarshalCommand {
            post: 2,
            target: CommandTarget::Zone(zone(2)),
            flag: FlagState::Off,
        })
        .push(ScenarioStep::wait_ms(2500))
        .push(ScenarioStep::mark("zone_5_clear"))
        .push(ScenarioStep::MarshalCommand {
            post: 5,
            target: CommandTarget::Zone(zone(5)),
            flag: FlagState::Off,
        })
}

/// Mexican-wave of single-yellow across every zone, finishing on green.
pub fn rolling_yellow_wave() -> Scenario {
    let mut s = Scenario::new("rolling_yellow_wave")
        .with_description("Sweep yellow through every zone, then return to green globally.")
        .push(ScenarioStep::mark("wave_start"));
    for z in ALL_ZONES {
        s = s
            .push(ScenarioStep::MarshalCommand {
                post: z,
                target: CommandTarget::Zone(zone(z)),
                flag: FlagState::Yellow(YellowKind::Single),
            })
            .push(ScenarioStep::wait_ms(700));
    }
    s = s.push(ScenarioStep::mark("wave_end"));
    for z in ALL_ZONES {
        s = s.push(ScenarioStep::MarshalCommand {
            post: z,
            target: CommandTarget::Zone(zone(z)),
            flag: FlagState::Off,
        });
    }
    s.push(ScenarioStep::RaceControlCommand {
        target: CommandTarget::Global,
        flag: FlagState::Green,
    })
    .push(ScenarioStep::wait_ms(600))
    .push(ScenarioStep::RaceControlCommand {
        target: CommandTarget::Global,
        flag: FlagState::Off,
    })
}

/// Inject a critical hardware fault and clear it.
pub fn psu_undervoltage() -> Scenario {
    Scenario::new("psu_undervoltage")
        .with_description("PSU dips below 40V on panel 7, triggers a critical alert, recovers.")
        .push(ScenarioStep::mark("fault_injected"))
        .push(ScenarioStep::InjectFault {
            panel: 7,
            fault: Fault::SetPsuVoltage(38.0),
        })
        .push(ScenarioStep::wait_ms(1200))
        .push(ScenarioStep::AssertEventOccurred {
            matcher: EventMatcher::DiagnosticAlertRaised { panel: Some(7) },
        })
        .push(ScenarioStep::wait_ms(2000))
        .push(ScenarioStep::mark("recovery"))
        .push(ScenarioStep::InjectFault {
            panel: 7,
            fault: Fault::SetPsuVoltage(48.0),
        })
        .push(ScenarioStep::wait_ms(1200))
}

/// **2024 Italian Grand Prix** — best-effort reconstruction.
///
/// Visual playback of the GP with the **20-driver grid circulating
/// continuously** around real Monza, plus the headline incidents reproduced
/// at the right approximate lap.
///
/// Rendering trick: F1 race-control panels go **OFF** between events (no
/// global green override stays latched, that's not how the FIA system
/// works). We therefore mirror reality: RC issues GREEN once at lights-out,
/// then immediately releases it so the panels go dark — that way the local
/// marshal yellows raised during the incidents actually **paint the panels
/// yellow** instead of being masked by a stale RC override.
///
/// Compression: the real GP was ~71 min (53 laps × ~81 s). This scenario
/// compresses it to ~90 s of sim time by simulating 7 representative laps
/// (one per major event window) at ~10 s/lap, with cars advancing through
/// the 11 zones in formation.
///
/// **Verified events** (Wikipedia "2024 Italian Grand Prix" + f1-fansite
/// race report): Norris pole-to-lead, Russell lockup T1 lap 1, Ricciardo
/// forces Hülkenberg off T1 (5 s penalty), Piastri overtakes Norris at the
/// 2nd chicane lap 1, Hülkenberg-Tsunoda collision lap 5, Hülkenberg pits
/// lap 6, Tsunoda retires lap 7 (floor damage), Magnussen-Gasly contact mid
/// race (Magnussen 10 s penalty), Leclerc wins, no SC, no VSC, chequered at
/// lap 53.
///
/// **Approximated**: which exact marshal post raised each flag (FIA Race
/// Director Notes V4 ships as a partly-scanned PDF) and the precise lap
/// timing for the Magnussen-Gasly contact (sources don't pin a lap number).
pub fn italian_gp_2024() -> Scenario {
    italian_gp_2024_inner()
}

fn italian_gp_2024_inner() -> Scenario {
    // ------------------------------------------------------------------
    // Driver numbers in qualifying order (P1 first).
    // ------------------------------------------------------------------
    const GRID_ORDER: [u32; 20] = [
        4,  // NOR pole
        81, // PIA
        63, // RUS
        16, // LEC
        55, // SAI
        44, // HAM
        1,  // VER
        11, // PER
        23, // ALB
        27, // HUL
        14, // ALO
        3,  // RIC
        20, // MAG
        10, // GAS
        31, // OCO
        22, // TSU
        18, // STR
        43, // COL
        77, // BOT
        24, // ZHO
    ];
    const TSUNODA: u32 = 22;
    const HULKENBERG: u32 = 27;
    // Marshal post numerical IDs (see crates/server/circuits/monza_2024.json):
    //   1 = F1.1  → zone 1
    //   2 = F1.2  → zone 1
    //   3 = F2.1  → zone 2  (Variante del Rettifilo, T1)
    //   4 = F2.2  → zone 2
    //   7 = F4.1  → zone 4  (Variante della Roggia)
    //   9 = F6.1  → zone 5  (Curva Grande / Lesmo entry)
    //  13 = F8.2  → zone 7  (Variante Ascari entry)
    //  16 = F10.1 → zone 8  (Rettilineo Ascari)
    //  18 = F11.1 → zone 9  (Curva Alboreto / Parabolica in)
    //  22 = F0.0  → zone 11 (start/finish rostrum)
    const POST_F11: u32 = 1;
    const POST_F12: u32 = 2;
    const POST_T1: u32 = 3;
    const POST_T1B: u32 = 4;
    const POST_ROGGIA: u32 = 7;
    const POST_LESMO: u32 = 9;
    const POST_ASCARI: u32 = 13;
    const POST_ASCARI_OUT: u32 = 16;
    const POST_PARABOLICA: u32 = 18;
    const POST_START: u32 = 22;

    // --- Timeline builder ---------------------------------------------
    // Each entry is `(t_ms, step)`. We then sort by `t_ms`, intercalate
    // `Wait`s and emit the final Scenario.
    let mut timed: Vec<(u64, ScenarioStep)> = Vec::new();

    // ------------------------------------------------------------------
    // Pacing (in scenario-millis at 1x). The full race body is ~77 s at 1x
    // (≈ 13 s/lap × 7 reprenstative laps), which feels like a watchable
    // demo: cars visibly travel between zones, yellow flags hold long
    // enough to register, and at 5x the whole thing collapses to ~15 s.
    // ------------------------------------------------------------------
    let total_laps = 7u64;
    let zones_per_lap = 11u64;
    let zone_dt = 1100u64; // ms between zone advances → ~12 s per lap × 7 = ~84 s race body
    let lap_dt = zone_dt * zones_per_lap;
    let race_body_ms = total_laps * lap_dt;

    // ---------- Pre-race ----------------------------------------------
    let mut t: u64 = 0;
    timed.push((t, ScenarioStep::Mark { label: "formation_lap".into() }));
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        },
    ));
    // Position the grid at the start/finish straight (Z11).
    for &car in &GRID_ORDER {
        timed.push((t, ScenarioStep::EnterZone { car, zone: 11 }));
    }
    t += 2500;

    timed.push((t, ScenarioStep::Mark { label: "grid_forming".into() }));
    // Release the RC override BEFORE the race so marshal yellows can paint
    // the panels later. This mirrors the real FIA procedure.
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        },
    ));
    t += 1500;

    // ---------- Lights out --------------------------------------------
    timed.push((t, ScenarioStep::Mark { label: "lights_out".into() }));
    // One brief global green at lights-out, then release.
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        },
    ));
    timed.push((
        t + 600,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        },
    ));
    let race_start_ms = t;

    // ---------- Continuous car movement: every car advances one zone
    //            per tick, starting from its grid position. Some cars
    //            launch a few ticks late so the field stretches out.
    // ------------------------------------------------------------------
    for (rank, &car) in GRID_ORDER.iter().enumerate() {
        let launch_offset = (rank as u64) * 60; // back of grid leaves later
        for lap in 0..total_laps {
            for zone_idx in 0..zones_per_lap {
                // Zones visited in order: 1, 2, 3, ..., 11.
                let zone = (zone_idx as u32) + 1;
                let when = race_start_ms + launch_offset + lap * lap_dt + zone_idx * zone_dt;
                timed.push((when, ScenarioStep::EnterZone { car, zone }));
            }
        }
    }


    // ---------- Lap-1: Russell lockup + Ricciardo→Hülk gravel at T1
    // Two marshal posts (F2.1 + F2.2) raise yellow across the whole of
    // zone 2 for ~7 s. Double yellow comes in after 1.5 s to reflect the
    // Hülkenberg gravel excursion.
    let l1_t1_ms = race_start_ms + zone_dt + 100;
    timed.push((l1_t1_ms, ScenarioStep::Mark { label: "l1_russell_lockup_t1".into() }));
    timed.push((
        l1_t1_ms + 1500,
        ScenarioStep::Mark { label: "l1_ricciardo_hulk_t1_gravel".into() },
    ));
    push_yellow_window(
        &mut timed,
        l1_t1_ms,
        7000,
        &[(POST_T1, 2), (POST_T1B, 2)],
        Some(1500),
    );

    // ---------- Lap-1 Roggia: Piastri jumps Norris (mark only)
    let l1_roggia_ms = race_start_ms + zone_dt * 3 + 200;
    timed.push((
        l1_roggia_ms,
        ScenarioStep::Mark { label: "l1_piastri_passes_norris_roggia".into() },
    ));

    // ---------- Lap 2: backmarker spin at Lesmo (single yellow, 6 s)
    let l2_lesmo_ms = race_start_ms + lap_dt + zone_dt * 5;
    timed.push((
        l2_lesmo_ms,
        ScenarioStep::Mark { label: "l2_backmarker_spin_lesmo".into() },
    ));
    push_yellow_window(&mut timed, l2_lesmo_ms, 6000, &[(POST_LESMO, 5)], None);

    // ---------- Lap 3: debris at Roggia chicane (5 s)
    let l3_roggia_ms = race_start_ms + 2 * lap_dt + zone_dt * 3;
    timed.push((
        l3_roggia_ms,
        ScenarioStep::Mark { label: "l3_debris_roggia".into() },
    ));
    push_yellow_window(&mut timed, l3_roggia_ms, 5000, &[(POST_ROGGIA, 4)], None);

    // ---------- Lap 4: Stroll off at Parabolica entry (6 s)
    let l4_parab_ms = race_start_ms + 3 * lap_dt + zone_dt * 8;
    timed.push((
        l4_parab_ms,
        ScenarioStep::Mark { label: "l4_stroll_off_parabolica".into() },
    ));
    push_yellow_window(&mut timed, l4_parab_ms, 6000, &[(POST_PARABOLICA, 9)], None);

    // ---------- Lap 5: Hülkenberg locks T1 → collides with Tsunoda (8 s,
    // both posts in zone 2, escalates to double after 2 s).
    let l5_t1_ms = race_start_ms + 4 * lap_dt + zone_dt;
    timed.push((
        l5_t1_ms,
        ScenarioStep::Mark { label: "l5_hulk_tsunoda_collision_t1".into() },
    ));
    push_yellow_window(
        &mut timed,
        l5_t1_ms,
        8000,
        &[(POST_T1, 2), (POST_T1B, 2), (POST_F12, 1)],
        Some(2000),
    );

    // ---------- Lap 6: Hülkenberg pits (park + rejoin, no flag)
    let l6_ms = race_start_ms + 5 * lap_dt;
    timed.push((l6_ms, ScenarioStep::Mark { label: "l6_hulk_pits".into() }));
    timed.push((l6_ms, ScenarioStep::ParkCar { car: HULKENBERG }));
    timed.push((
        l6_ms + 800,
        ScenarioStep::EnterZone { car: HULKENBERG, zone: 1 },
    ));

    // ---------- Lap 6: Magnussen-Gasly contact at Ascari (7 s, double
    // posts F8.2 + F9.1).
    let l6_ascari_ms = race_start_ms + 5 * lap_dt + zone_dt * 6;
    timed.push((
        l6_ascari_ms,
        ScenarioStep::Mark { label: "l6_magnussen_gasly_contact_ascari".into() },
    ));
    push_yellow_window(
        &mut timed,
        l6_ascari_ms,
        7000,
        &[(POST_ASCARI, 7), (POST_ASCARI_OUT, 8)],
        Some(2500),
    );

    // ---------- Lap 7: Tsunoda retires (floor damage) — yellow at T1 for
    // 6 s while marshals recover the car.
    let l7_ms = race_start_ms + 6 * lap_dt + zone_dt;
    timed.push((l7_ms, ScenarioStep::Mark { label: "l7_tsunoda_retires".into() }));
    timed.push((l7_ms, ScenarioStep::ParkCar { car: TSUNODA }));
    push_yellow_window(
        &mut timed,
        l7_ms + 200,
        6000,
        &[(POST_T1, 2), (POST_T1B, 2), (POST_F11, 1), (POST_F12, 1)],
        None,
    );
    timed.push((
        l7_ms + 6200,
        ScenarioStep::Mark { label: "tsunoda_car_recovered".into() },
    ));

    // ---------- Last lap: white flag at start/finish gantry
    let last_lap_ms = race_start_ms + race_body_ms;
    timed.push((
        last_lap_ms,
        ScenarioStep::Mark { label: "lap_53_white_flag_warning".into() },
    ));
    timed.push((
        last_lap_ms,
        ScenarioStep::MarshalCommand {
            post: POST_START,
            target: CommandTarget::Zone(zone(11)),
            flag: FlagState::White,
        },
    ));

    // ---------- Chequered (global by FIA rule)
    let chequered_ms = last_lap_ms + 2200;
    timed.push((
        chequered_ms,
        ScenarioStep::Mark { label: "leclerc_takes_chequered".into() },
    ));
    timed.push((
        chequered_ms,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Chequered,
        },
    ));

    // ---------- Cooldown
    let cooldown_ms = chequered_ms + 3000;
    timed.push((cooldown_ms, ScenarioStep::Mark { label: "race_over".into() }));
    timed.push((
        cooldown_ms,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        },
    ));

    build_timed_scenario("italian_gp_2024", timed)
        .with_description(
            "GP de Italia 2024 — formación, lights out, 7 vueltas representativas con los 20 autos circulando, incidentes T1 (Russell L1, Ricciardo-Hülk L1, Hülk-Tsu L5), pit-stop Hülk L6, retiro de Tsunoda L7, Magnussen-Gasly contact en Ascari, chequered global lap 53 (Leclerc).",
        )
}

/// Push a multi-post yellow window onto a `(time_ms, ScenarioStep)` queue.
///
/// Each `(post_id, zone_id)` pair raises a single yellow at `start_ms` and
/// clears at `start_ms + window_ms`. If `escalate_at_ms` is set, the same
/// posts re-raise to *double* yellow at `start_ms + escalate_at_ms`.
fn push_yellow_window(
    timed: &mut Vec<(u64, ScenarioStep)>,
    start_ms: u64,
    window_ms: u64,
    posts: &[(u32, u32)],
    escalate_at_ms: Option<u64>,
) {
    for &(post, z) in posts {
        timed.push((
            start_ms,
            ScenarioStep::MarshalCommand {
                post,
                target: CommandTarget::Zone(ZoneId::new(z)),
                flag: FlagState::Yellow(YellowKind::Single),
            },
        ));
    }
    if let Some(esc_dt) = escalate_at_ms {
        for &(post, z) in posts {
            timed.push((
                start_ms + esc_dt,
                ScenarioStep::MarshalCommand {
                    post,
                    target: CommandTarget::Zone(ZoneId::new(z)),
                    flag: FlagState::Yellow(YellowKind::Double),
                },
            ));
        }
    }
    for &(post, z) in posts {
        timed.push((
            start_ms + window_ms,
            ScenarioStep::MarshalCommand {
                post,
                target: CommandTarget::Zone(ZoneId::new(z)),
                flag: FlagState::Off,
            },
        ));
    }
}

/// Sort `events` by time and produce a [`Scenario`] with `Wait` steps
/// interleaved so that each step fires at its target millisecond offset
/// from the start of the scenario.
fn build_timed_scenario(name: &str, mut events: Vec<(u64, ScenarioStep)>) -> Scenario {
    events.sort_by_key(|(t, _)| *t);
    let mut s = Scenario::new(name);
    let mut cursor: u64 = 0;
    for (when, step) in events {
        if when > cursor {
            s = s.push(ScenarioStep::Wait { duration_ms: when - cursor });
            cursor = when;
        }
        s = s.push(step);
    }
    s
}

/// **TCR World Tour — El Pinar 2024, Race 2** — best-effort reconstruction.
///
/// The infamous "chaotic Race 2" of the joint FIA TCR World Tour + TCR South
/// America round at Autódromo Víctor Borrat Fabini on 4 August 2024:
///
/// * Pole-sitter **Ma Qing Hua (#155)** stalls on the formation lap — his
///   Lynk & Co 01 dies completely.
/// * The car is pushed aside, lights go out, but **yellow lights flash at the
///   same time** due to a signaling controller fault.
/// * Race Control throws a **red flag** while the signaling system is
///   repaired (several minutes of real-world delay).
/// * **Restart** with Cardoso (#43, started P2) leading.
/// * **Urrutia-Guerrieri contact** in the opening stages, at the Bicheón
///   esses (Z3).
/// * **Björk (#111)** carves through, passes Filippi (#127) in Sector 2,
///   reels in Cardoso and takes the lead in the closing laps.
/// * Lap 22: chequered with Björk +1.281 s. Cardoso P2, Urrutia P3 on track.
/// * **Post-race**: Urrutia DQ'd hours later for switching the anti-lag
///   system on manually while the engine was running (FIA TCR World Tour
///   Tech Reg 6.4). Final classification: Björk · Cardoso · Guerrieri.
///
/// Verified sources: FIA TCR World Tour press release, AutoHebdo race
/// report, TouringCarTimes ("The second race was crazy!" + Urrutia DQ
/// article), TheThirdTurn results table (22 L, 76.89 km, 32:07.780, MoV
/// 1.281 s, Björk led 7 laps, Cardoso 14, Guerrieri 1).
///
/// Approximated: precise lap counts for each on-track incident (FIA Race
/// Director Notes for the round are not publicly archived) and the order
/// in which secondary battles unfolded mid-pack.
pub fn el_pinar_race2_2024() -> Scenario {
    el_pinar_race2_2024_inner()
}

fn el_pinar_race2_2024_inner() -> Scenario {
    // ------------------------------------------------------------------
    // 25-car grid in approximate Race 2 starting order (Cardoso effective
    // P1 after Ma Qing Hua's stall, then world-tour entries, then SA grid).
    // ------------------------------------------------------------------
    const GRID_ORDER: [u32; 25] = [
        43,  // CDR Cardoso — effective leader (pole-sitter stalled)
        111, // BJK Björk — would carve to the front
        186, // GUE Guerrieri
        127, // FIL Filippi — Björk's first overtake target
        105, // MIC Michelisz
        196, // AZC Azcona
        112, // URR Urrutia — home race, eventual DQ
        168, // EHR Ehrlacher — collapses to last
        129, // GIR Girolami
        62,  // BOR Borković
        199, // BUT Butti
        77,  // REI Reis
        28,  // OSM Osman
        37,  // RSL Reischl
        7,   // VIV Vivacqua
        3,   // BAP Baptista
        60,  // CAS Casella
        34,  // CSG Casagrande
        15,  // MAG Maglione
        8,   // SUZ Suzuki
        17,  // ROS Rossi
        16,  // RSO Rosso
        18,  // SLV Silva
        47,  // FON Fontana
        155, // MQH Ma Qing Hua — back of grid after stall
    ];
    const MA_QING_HUA: u32 = 155;
    const EHRLACHER: u32 = 168;

    // El Pinar AUVO marshal post IDs (see crates/server/circuits/el_pinar_n13.json):
    //    1 = F0.0 rostrum (Z1, Meta / S/F)
    //    2 = F1.1 (Z2, Recta Principal)
    //    3 = F2.1 (Z3, Entrada Curva 1)
    //    4 = F2.2 (Z4, Curva 1 Sur)
    //    5 = F2.3 (Z5, Gonzalo Rodríguez Oeste)
    //    6 = F2.4 (Z6, Gonzalo Rodríguez Norte)
    //    7 = F3.1 (Z7, El Bicheón)
    //    8 = F4.1 (Z8, Acceso Sector Ancap)
    //    9 = F4.2 (Z9, Ápice Sector Ancap)
    //   10 = F5.1 (Z10, El Tobogán)
    //   11 = F6.1 (Z11, Recta Opuesta Alta)
    //   12 = F6.2 (Z12, Recta Opuesta Media)
    //   13 = F6.3 (Z13, Recta Opuesta Frenaje)
    //   14 = F7.1 (Z14, Horquilla del Fondo)
    //   15 = F8.1 (Z15, Entrada a La S)
    //   16 = F9.1 (Z16, El Cajón)
    const POST_START: u32 = 1;
    const POST_GRID: u32 = 2;
    const POST_C1_A: u32 = 3;
    const POST_C1_B: u32 = 4;
    const POST_BICHEON: u32 = 7;
    const POST_BECO_A: u32 = 8;
    const POST_BECO_B: u32 = 9;
    const _POST_TOBOGAN: u32 = 10;
    const POST_PASAJERO: u32 = 12;
    const POST_FONDO: u32 = 14;

    let mut timed: Vec<(u64, ScenarioStep)> = Vec::new();

    // Pacing: the real race ran 22 laps in 32:07.780. We compress it to 8
    // representative laps with continuous car movement puesto por puesto (1..=16)
    // at 500ms per post (~8.0 s per lap), plus a ~15 s pre-race red-flag drama
    // and a ~5 s post-chequered cooldown.
    let total_laps = 8u64;
    let posts_per_lap = 16u64;
    let post_dt = 500u64; // 500 ms per post = 8.0 s per lap
    let lap_dt = post_dt * posts_per_lap;
    let race_body_ms = total_laps * lap_dt;

    // ---------- Pre-race: formation + Ma Qing Hua stalls --------------
    let mut t: u64 = 0;
    timed.push((t, ScenarioStep::Mark { label: "formation_lap".into() }));
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        },
    ));
    // Position the 25-car grid at the start/finish straight (Z1).
    for &car in &GRID_ORDER {
        timed.push((t, ScenarioStep::EnterZone { car, zone: 1 }));
    }
    t += 2000;

    // Pole sitter dies on the grid.
    timed.push((
        t,
        ScenarioStep::Mark { label: "ma_qing_hua_stalls_on_grid".into() },
    ));
    // Marshal at the start gantry waves single yellow.
    push_yellow_window(
        &mut timed,
        t,
        4500,
        &[(POST_START, 1), (POST_GRID, 2)],
        Some(1000), // escalate to double almost immediately
    );
    // Take Ma's car out of the picture for now; he'll rejoin at the back.
    timed.push((t + 500, ScenarioStep::ParkCar { car: MA_QING_HUA }));
    t += 4500;

    // ---------- Confused start: lights out + flashing yellow --------------
    timed.push((
        t,
        ScenarioStep::Mark { label: "lights_out_attempt_1".into() },
    ));
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        },
    ));
    t += 600;
    timed.push((
        t,
        ScenarioStep::Mark { label: "signaling_fault_yellow_during_start".into() },
    ));
    // The whole circuit flashes yellow due to the controller fault.
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Yellow(YellowKind::Double),
        },
    ));
    t += 1500;

    // ---------- Red flag — signaling repair ---------------------------
    timed.push((t, ScenarioStep::Mark { label: "red_flag_signaling_failure".into() }));
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Red,
        },
    ));
    t += 5000; // long pause representing "many minutes" of repair

    timed.push((
        t,
        ScenarioStep::Mark { label: "signaling_repaired_field_reforms".into() },
    ));
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        },
    ));
    t += 1500;

    // ---------- Ma Qing Hua rejoins at the back (back of zone 1) -----
    timed.push((t, ScenarioStep::EnterZone { car: MA_QING_HUA, zone: 1 }));

    // ---------- Lights out (for real this time) -----------------------
    timed.push((t, ScenarioStep::Mark { label: "lights_out_attempt_2".into() }));
    timed.push((
        t,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        },
    ));
    timed.push((
        t + 700,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        },
    ));
    let race_start_ms = t;

    // Driver constants for incidents:
    const GUERRIERI: u32 = 186;
    const CASAGRANDE: u32 = 34;
    const VIVACQUA: u32 = 7;

    // Incident timing matched to when cars reach each incident post:
    // Lap 1: Guerrieri (P3, rank 2) arrives at Post 7 (Bicheón)
    let l1_bicheon_ms = race_start_ms + 6 * post_dt + 30;
    // Lap 4: Casagrande (rank 17) arrives at Post 14 (Horquilla)
    let l4_fondo_ms = race_start_ms + 3 * lap_dt + 13 * post_dt + 375;
    // Lap 6: Vivacqua (rank 14) arrives at Post 8 (Sector Ancap)
    let l6_beco_ms = race_start_ms + 5 * lap_dt + 7 * post_dt + 285;

    // ---------- Continuous car movement puesto por puesto (1..=16) -----
    // Cars move in 3 realistic packs (Lead, Midfield, Chase).
    // Cars involved in incidents come to a complete stop at that post
    // while the yellow flag is displayed!
    for (rank, &car) in GRID_ORDER.iter().enumerate() {
        let base_offset = if rank < 7 {
            (rank as u64) * 15
        } else if rank < 16 {
            180 + ((rank - 7) as u64) * 15
        } else {
            360 + ((rank - 16) as u64) * 15
        };

        let mut car_t = race_start_ms + base_offset;

        for lap in 0..total_laps {
            for post_idx in 0..posts_per_lap {
                let zone = (post_idx as u32) + 1;
                timed.push((car_t, ScenarioStep::EnterZone { car, zone }));

                let mut step_dt = post_dt;

                // 1) Guerrieri stops at Post 7 on Lap 1 during the 4.5s yellow flag
                if car == GUERRIERI && lap == 0 && zone == 7 {
                    step_dt += 4500;
                }
                // 2) Casagrande spins and stops at Post 14 on Lap 4 during 3.5s yellow flag
                if car == CASAGRANDE && lap == 3 && zone == 14 {
                    step_dt += 3500;
                }
                // 3) Vivacqua has contact and stops at Post 8 on Lap 6 during 3.5s yellow flag
                if car == VIVACQUA && lap == 5 && zone == 8 {
                    step_dt += 3500;
                }

                car_t += step_dt;
            }
        }
    }

    // ---------- Lap 1 — Urrutia-Guerrieri contact at Bicheón (Post 7 / Z7) -----
    timed.push((
        l1_bicheon_ms,
        ScenarioStep::Mark { label: "l1_urrutia_guerrieri_contact_bicheon".into() },
    ));
    push_yellow_window(
        &mut timed,
        l1_bicheon_ms,
        4500,
        &[(POST_BICHEON, 7)],
        None,
    );

    // ---------- Lap 2 — Björk overtakes Filippi at El Tobogán (Post 10 / Z10) ----
    // No flag — mark only (clean pass).
    let l2_tobogan_ms = race_start_ms + lap_dt + post_dt * 9;
    timed.push((
        l2_tobogan_ms,
        ScenarioStep::Mark { label: "l2_bjork_passes_filippi_tobogan".into() },
    ));

    // ---------- Lap 3 — debris at C1 from earlier contact (Posts 3 & 4) ----
    let l3_c1_ms = race_start_ms + 2 * lap_dt + post_dt * 2;
    timed.push((
        l3_c1_ms,
        ScenarioStep::Mark { label: "l3_debris_c1".into() },
    ));
    push_yellow_window(
        &mut timed,
        l3_c1_ms,
        4000,
        &[(POST_C1_A, 3), (POST_C1_B, 4)],
        None,
    );

    // ---------- Lap 4 — backmarker spin at Horquilla (Post 14 / Z14) ----
    timed.push((
        l4_fondo_ms,
        ScenarioStep::Mark { label: "l4_backmarker_spin_horquilla_fondo".into() },
    ));
    push_yellow_window(
        &mut timed,
        l4_fondo_ms,
        3500,
        &[(POST_FONDO, 14)],
        None,
    );

    // ---------- Lap 5 — Ehrlacher's race unravels (mark only) ----
    let l5_ms = race_start_ms + 4 * lap_dt + post_dt * 6;
    timed.push((
        l5_ms,
        ScenarioStep::Mark { label: "l5_ehrlacher_drops_to_back".into() },
    ));

    // ---------- Lap 6 — second Urrutia "bumper-pass" at Sector Ancap (Posts 8 & 9)
    timed.push((
        l6_beco_ms,
        ScenarioStep::Mark { label: "l6_urrutia_bumper_pass_beco".into() },
    ));
    push_yellow_window(
        &mut timed,
        l6_beco_ms,
        3500,
        &[(POST_BECO_A, 8), (POST_BECO_B, 9)],
        None,
    );

    // ---------- Lap 7 — Björk catches Cardoso at Recta Opuesta (Post 12 / Z12) ----
    let l7_pasajero_ms = race_start_ms + 6 * lap_dt + post_dt * 11;
    timed.push((
        l7_pasajero_ms,
        ScenarioStep::Mark { label: "l7_bjork_overtakes_cardoso_recta_opuesta".into() },
    ));
    // Marshals wave a single yellow briefly to caution about the dive.
    push_yellow_window(
        &mut timed,
        l7_pasajero_ms,
        2500,
        &[(POST_PASAJERO, 12)],
        None,
    );

    // ---------- Lap 8 — last lap white flag at start/finish ----
    let last_lap_ms = race_start_ms + 7 * lap_dt;
    timed.push((
        last_lap_ms,
        ScenarioStep::Mark { label: "lap_22_last_lap_white_flag".into() },
    ));
    timed.push((
        last_lap_ms,
        ScenarioStep::MarshalCommand {
            post: POST_START,
            target: CommandTarget::Zone(zone(1)),
            flag: FlagState::White,
        },
    ));

    // ---------- Chequered (global, FIA rule) ----
    let chequered_ms = race_start_ms + race_body_ms;
    timed.push((
        chequered_ms,
        ScenarioStep::Mark { label: "bjork_takes_chequered_+1281ms".into() },
    ));
    timed.push((
        chequered_ms,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Chequered,
        },
    ));

    // ---------- Post-race: stewards bulletin — Urrutia DQ'd ----
    let dq_ms = chequered_ms + 3000;
    timed.push((
        dq_ms,
        ScenarioStep::Mark { label: "stewards_urrutia_disqualified_antilag".into() },
    ));

    // ---------- Acknowledge Ehrlacher's collapse ----
    timed.push((
        dq_ms,
        ScenarioStep::ParkCar { car: EHRLACHER }, // visualises the championship hit
    ));

    // ---------- Cooldown: global Off ----
    let cooldown_ms = chequered_ms + 5000;
    timed.push((cooldown_ms, ScenarioStep::Mark { label: "race_over".into() }));
    timed.push((
        cooldown_ms,
        ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        },
    ));

    build_timed_scenario("el_pinar_race2_2024", timed)
        .with_description(
            "El Pinar 2024 — Carrera 2 caótica: pole Ma Qing Hua se atasca, \
             arranque confuso con bandera roja por falla de señalización, \
             restart, 8 vueltas representativas con los 25 autos circulando, \
             contacto Urrutia-Guerrieri en Bicheón, Björk pasa a Filippi en \
             El Tobogán, debris en C1, Urrutia se abre paso a topetazos en \
             Beco, Björk supera a Cardoso en El Pasajero al final, chequered \
             en lap 22 (Björk +1.281s), post-carrera Urrutia DQ por anti-lag.",
        )
}

/// Marshal tries to raise red — must be rejected.
pub fn marshal_red_rejected() -> Scenario {
    Scenario::new("marshal_red_rejected")
        .with_description("Marshal attempts a red flag — state machine must reject it.")
        .push(ScenarioStep::MarshalCommand {
            post: 4,
            target: CommandTarget::Zone(zone(4)),
            flag: FlagState::Red,
        })
        .push(ScenarioStep::wait_ms(500))
}

/// Incident in El Cajón (Circuito N° 13): spin at El Cajón hairpin (Zone 9),
/// local yellow waved by post 16 (F9.2), escalation to double yellow, VSC deploy, clear.
pub fn el_pinar_cajon_incident() -> Scenario {
    Scenario::new("el_pinar_cajon_incident")
        .with_description(
            "El Pinar C13 — Despiste en la horquilla de El Cajón: banderillero F9.2 \
             eleva amarilla local, escala a doble amarilla, Race Control despliega VSC \
             mientras rescate retira el vehículo, VSC Ending y retorno a verde.",
        )
        .push(ScenarioStep::mark("incident_cajon"))
        .push(ScenarioStep::MarshalCommand {
            post: 16,
            target: CommandTarget::Zone(zone(9)),
            flag: FlagState::Yellow(YellowKind::Single),
        })
        .push(ScenarioStep::wait_ms(1500))
        .push(ScenarioStep::MarshalCommand {
            post: 16,
            target: CommandTarget::Zone(zone(9)),
            flag: FlagState::Yellow(YellowKind::Double),
        })
        .push(ScenarioStep::wait_ms(2000))
        .push(ScenarioStep::mark("vsc_deployed"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::VirtualSafetyCar,
        })
        .push(ScenarioStep::wait_ms(3500))
        .push(ScenarioStep::mark("car_recovered"))
        .push(ScenarioStep::MarshalCommand {
            post: 16,
            target: CommandTarget::Zone(zone(9)),
            flag: FlagState::Off,
        })
        .push(ScenarioStep::wait_ms(1000))
        .push(ScenarioStep::mark("vsc_ending"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::VscEnding,
        })
        .push(ScenarioStep::wait_ms(2000))
        .push(ScenarioStep::mark("green"))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Green,
        })
        .push(ScenarioStep::wait_ms(1500))
        .push(ScenarioStep::RaceControlCommand {
            target: CommandTarget::Global,
            flag: FlagState::Off,
        })
}

/// Returns the full catalogue. Order is shown as-is in the UI dropdown.
pub fn catalogue() -> Vec<Scenario> {
    vec![
        italian_gp_2024(),
        el_pinar_race2_2024(),
        el_pinar_cajon_incident(),
        yellow_to_sc(),
        red_flag_restart(),
        vsc_cycle(),
        multi_zone_yellow(),
        rolling_yellow_wave(),
        psu_undervoltage(),
        marshal_red_rejected(),
    ]
}

/// Find a scenario by name.
pub fn find(name: &str) -> Option<Scenario> {
    catalogue().into_iter().find(|s| s.name == name)
}
