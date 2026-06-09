//! Executable example that runs a scenario and prints a structured report.
//!
//! Usage:
//!
//! ```text
//! # Run a built-in scenario:
//! cargo run -p tsp-simulator --example run_scenario -- --builtin yellow_to_safety_car
//!
//! # Run a YAML or JSON scenario from disk:
//! cargo run -p tsp-simulator --example run_scenario -- path/to/scenario.yaml
//! ```
//!
//! Built-ins: `yellow_to_safety_car`, `red_flag_restart`, `vsc_cycle`,
//! `psu_undervoltage_fault`, `multi_zone_yellow`, `marshal_red_rejected`.

use anyhow::{bail, Context, Result};
use tracing_subscriber::EnvFilter;

use tsp_simulator::library;
use tsp_simulator::loader;
use tsp_simulator::runner::{ScenarioRunner, TimeMode};
use tsp_simulator::scenario::Scenario;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("tsp=info,info")),
        )
        .init();

    let args: Vec<String> = std::env::args().collect();
    let scenario = parse_args(&args).context("parsing CLI args")?;

    let runner = ScenarioRunner::new(TimeMode::Real);
    let report = runner.run(&scenario).await?;

    println!("\n=== Scenario report: {} ===", report.name);
    println!("steps executed : {}", report.steps_executed);
    println!("events observed: {}", report.events_observed);
    println!("marks          : {}", report.marks.len());
    for m in &report.marks {
        println!(
            "  • t+{:>6} ms  [step {:>3}]  {}",
            m.virtual_offset_ms, m.step_index, m.label
        );
    }
    println!("{}", report.assertions);

    if !report.assertions.all_passed() {
        std::process::exit(1);
    }
    Ok(())
}

fn parse_args(args: &[String]) -> Result<Scenario> {
    let mut iter = args.iter().skip(1);
    let arg = match iter.next() {
        Some(a) => a,
        None => {
            print_help();
            bail!("no scenario given");
        }
    };
    match arg.as_str() {
        "--builtin" => {
            let name = iter.next().context("--builtin requires a name")?;
            resolve_builtin(name)
        }
        "--help" | "-h" => {
            print_help();
            std::process::exit(0);
        }
        other if !other.starts_with("--") => loader::load_from_path(other)
            .with_context(|| format!("loading scenario file {other}")),
        other => bail!("unknown argument {other:?}"),
    }
}

fn resolve_builtin(name: &str) -> Result<Scenario> {
    Ok(match name {
        "yellow_to_safety_car" => library::yellow_to_safety_car(),
        "red_flag_restart" => library::red_flag_restart(),
        "vsc_cycle" => library::vsc_cycle(),
        "psu_undervoltage_fault" => library::psu_undervoltage_fault(),
        "multi_zone_yellow" => library::multi_zone_yellow(),
        "marshal_red_rejected" => library::marshal_red_rejected(),
        other => bail!("unknown builtin scenario {other:?}"),
    })
}

fn print_help() {
    eprintln!(
        "Usage:\n  run_scenario --builtin <name>\n  run_scenario <path/to/scenario.(yaml|json)>\n\n\
         Built-ins:\n  yellow_to_safety_car\n  red_flag_restart\n  vsc_cycle\n  \
         psu_undervoltage_fault\n  multi_zone_yellow\n  marshal_red_rejected"
    );
}
