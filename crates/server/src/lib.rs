//! `tsp-server` — runtime that wires the domain into a working backend.
//!
//! The crate is organised in three layers:
//!
//! 1. [`bus`]        — global broadcast channel for [`DomainEvent`]s.
//! 2. [`actors`]     — one actor per domain concept (panels, marshals, race
//!    control, ECUs).
//! 3. [`dispatch`]   — central `Hub` that routes [`PanelCommand`]s to the
//!    right `PanelActor`(s) based on the command target.
//!
//! The [`diagnostic`] supervisor and the (Phase 3) `http`/`ws` gateway live
//! alongside.

#![deny(rust_2018_idioms)]
#![warn(clippy::all)]

pub mod actors;
pub mod bus;
pub mod car_registry;
pub mod circuits;
pub mod diagnostic;
pub mod dispatch;
pub mod flag_propagator;
pub mod gateway;
pub mod scenario_library;
pub mod scenario_runtime;
pub mod topology;
pub mod udp_broadcast;
pub mod world;

pub use bus::EventBus;
pub use car_registry::CarRegistry;
pub use dispatch::{Hub, HubHandle};
pub use gateway::{GatewayState, ws_upgrade};
pub use scenario_runtime::{ScenarioController, ScenarioNotification};
pub use topology::{CircuitTopology, PanelTopology, ZoneTopology};
pub use world::World;
