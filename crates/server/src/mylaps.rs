//! MYLAPS Orbits / RMonitor TCP timing client integration.
//!
//! Connects to MYLAPS Orbits Scoreboard TCP feed (port 50000) to receive
//! live session status, lap counter, countdown timer and passing data.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MylapsDriver {
    pub position: u32,
    pub car: String,
    pub name: String,
    pub laps: u32,
    pub total_time: String,
    pub best_lap: String,
    pub last_lap: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MylapsState {
    pub connected: bool,
    pub session_name: String,
    pub current_lap: u32,
    pub total_laps: u32,
    pub elapsed_seconds: u32,
    pub remaining_seconds: u32,
    pub flag_code: u32,
    pub leader_car: Option<String>,
    pub leader_name: Option<String>,
    pub chequered_suggested: bool,
    pub top_drivers: Vec<MylapsDriver>,
    pub last_update: chrono::DateTime<chrono::Utc>,
}

impl Default for MylapsState {
    fn default() -> Self {
        Self {
            connected: false,
            session_name: "Sin sesión de cronometraje".into(),
            current_lap: 0,
            total_laps: 12,
            elapsed_seconds: 0,
            remaining_seconds: 0,
            flag_code: 1,
            leader_car: None,
            leader_name: None,
            chequered_suggested: false,
            top_drivers: Vec::new(),
            last_update: Utc::now(),
        }
    }
}

pub type SharedMylapsState = Arc<RwLock<MylapsState>>;

/// Spawns the background MYLAPS Orbits TCP listener.
pub fn spawn_mylaps_client(target_addr: String, state: SharedMylapsState) {
    tokio::spawn(async move {
        info!(%target_addr, "starting MYLAPS Orbits timing client loop");

        let mut competitors: HashMap<String, String> = HashMap::new();

        loop {
            match TcpStream::connect(&target_addr).await {
                Ok(stream) => {
                    info!(%target_addr, "connected to MYLAPS Orbits feed");
                    {
                        let mut w = state.write().await;
                        w.connected = true;
                        w.last_update = Utc::now();
                    }

                    let reader = BufReader::new(stream);
                    let mut lines = reader.lines();

                    while let Ok(Some(line)) = lines.next_line().await {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        parse_rmonitor_line(trimmed, &mut competitors, &state).await;
                    }

                    warn!(%target_addr, "MYLAPS Orbits connection closed, will reconnect");
                    {
                        let mut w = state.write().await;
                        w.connected = false;
                        w.last_update = Utc::now();
                    }
                }
                Err(err) => {
                    debug!(%target_addr, ?err, "MYLAPS server not reachable, retrying in 3s");
                    {
                        let mut w = state.write().await;
                        w.connected = false;
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
}

/// Helper to strip optional surrounding quotes: `"29"` -> `29`
fn clean_field(s: &str) -> String {
    s.trim().trim_matches('"').trim().to_string()
}

/// Parse a single RMonitor line: `$B`, `$COMP`, `$F`, `$G`, `$J`
pub async fn parse_rmonitor_line(
    line: &str,
    competitors: &mut HashMap<String, String>,
    state: &SharedMylapsState,
) {
    if !line.starts_with('$') {
        return;
    }

    // Split CSV tokens taking quotes into account
    let tokens = parse_csv_line(line);
    if tokens.is_empty() {
        return;
    }

    let record_type = &tokens[0];

    match record_type.as_str() {
        // $B: Run / Session Info: $B,RunID,"Run Description"
        "$B" => {
            if tokens.len() >= 3 {
                let desc = clean_field(&tokens[2]);
                let mut w = state.write().await;
                w.session_name = desc.clone();

                // Extract total laps from description if specified e.g. "12 Vueltas"
                if let Some(laps) = extract_laps_from_text(&desc) {
                    w.total_laps = laps;
                }
                w.last_update = Utc::now();
            }
        }

        // $COMP: Competitor info: $COMP,"RegID","Number","Transponder","FirstName","LastName",...
        "$COMP" => {
            if tokens.len() >= 6 {
                let car_num = clean_field(&tokens[2]);
                let first = clean_field(&tokens[4]);
                let last = clean_field(&tokens[5]);
                let full_name = format!("{first} {last}").trim().to_string();
                competitors.insert(car_num.clone(), full_name);
                if tokens.len() >= 2 {
                    let reg_id = clean_field(&tokens[1]);
                    competitors.insert(reg_id, format!("{first} {last}").trim().to_string());
                }
            }
        }

        // $F: Flags and session timer: $F,FlagCode,ElapsedSeconds,RemainingSeconds
        "$F" => {
            if tokens.len() >= 4 {
                let flag_code: u32 = clean_field(&tokens[1]).parse().unwrap_or(1);
                let elapsed: u32 = clean_field(&tokens[2]).parse().unwrap_or(0);
                let remaining: u32 = clean_field(&tokens[3]).parse().unwrap_or(0);

                let mut w = state.write().await;
                w.flag_code = flag_code;
                w.elapsed_seconds = elapsed;
                w.remaining_seconds = remaining;

                // Flag code 4 is Chequered/Finish
                if flag_code == 4 {
                    w.chequered_suggested = true;
                }
                w.last_update = Utc::now();
            }
        }

        // $G: Leaderboard entry: $G,Position,"RegID",LapsCompleted,"TotalTime","BestLap","LastLap"
        "$G" => {
            if tokens.len() >= 7 {
                let pos: u32 = clean_field(&tokens[1]).parse().unwrap_or(0);
                let car = clean_field(&tokens[2]);
                let laps: u32 = clean_field(&tokens[3]).parse().unwrap_or(0);
                let total_time = clean_field(&tokens[4]);
                let best_lap = clean_field(&tokens[5]);
                let last_lap = clean_field(&tokens[6]);

                let driver_name = competitors
                    .get(&car)
                    .cloned()
                    .unwrap_or_else(|| format!("Auto #{car}"));

                let driver = MylapsDriver {
                    position: pos,
                    car: car.clone(),
                    name: driver_name.clone(),
                    laps,
                    total_time,
                    best_lap,
                    last_lap,
                };

                let mut w = state.write().await;
                // If P1, update leader info
                if pos == 1 {
                    w.leader_car = Some(car.clone());
                    w.leader_name = Some(driver_name.clone());
                    w.current_lap = laps;

                    if w.total_laps > 0 && laps >= w.total_laps {
                        w.chequered_suggested = true;
                    }
                }

                // Update or insert into top_drivers list
                if let Some(existing) = w.top_drivers.iter_mut().find(|d| d.car == car) {
                    *existing = driver;
                } else {
                    w.top_drivers.push(driver);
                }
                w.top_drivers.sort_by_key(|d| d.position);
                w.last_update = Utc::now();
            }
        }

        _ => {}
    }
}

/// Helper to parse basic CSV with quotes: `a,"b,c",d` -> `[a, "b,c", d]`
fn parse_csv_line(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;

    for ch in line.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                current.push(ch);
            }
            ',' if !in_quotes => {
                tokens.push(current.trim().to_string());
                current.clear();
            }
            _ => {
                current.push(ch);
            }
        }
    }
    tokens.push(current.trim().to_string());
    tokens
}

/// Helper to extract e.g. "12" from "TURISMO AUVO C2 - CARRERA (30:00 o 12 Vueltas)"
fn extract_laps_from_text(text: &str) -> Option<u32> {
    let lower = text.to_lowercase();
    let parts: Vec<&str> = lower.split_whitespace().collect();
    for (i, &p) in parts.iter().enumerate() {
        if p.starts_with("vuelta") && i > 0 {
            if let Ok(num) = parts[i - 1].parse::<u32>() {
                return Some(num);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_parse_rmonitor_session_and_competitor() {
        let state = Arc::new(RwLock::new(MylapsState::default()));
        let mut comps = HashMap::new();

        parse_rmonitor_line(
            r#"$B,10,"TURISMO AUVO C2 - CARRERA (30:00 o 12 Vueltas)""#,
            &mut comps,
            &state,
        )
        .await;

        {
            let r = state.read().await;
            assert_eq!(r.total_laps, 12);
            assert!(r.session_name.contains("TURISMO AUVO C2"));
        }

        parse_rmonitor_line(
            r#"$COMP,"29","29","123456","Ignacio","Effinger","URY","Turismo AUVO C2""#,
            &mut comps,
            &state,
        )
        .await;

        assert_eq!(comps.get("29").unwrap(), "Ignacio Effinger");

        parse_rmonitor_line(
            r#"$G,1,"29",12,"25:29.731","2:06.309","2:06.884""#,
            &mut comps,
            &state,
        )
        .await;

        {
            let r = state.read().await;
            assert_eq!(r.current_lap, 12);
            assert_eq!(r.leader_car.as_deref(), Some("29"));
            assert_eq!(r.leader_name.as_deref(), Some("Ignacio Effinger"));
            assert!(r.chequered_suggested);
        }
    }
}
