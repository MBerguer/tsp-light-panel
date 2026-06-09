//! Actor implementations.
//!
//! Each actor runs in its own `tokio::task` and owns its mutable state. Owners
//! communicate with an actor through its `*Handle` (cheap to clone). The
//! handle wraps an [`tokio::sync::mpsc::Sender`] for the actor's inbox.
//!
//! The supervisor in [`crate::dispatch`] holds all the handles and is the
//! only place that "knows" the panel ↔ zone ↔ sector mapping at runtime.

pub mod ecu;
pub mod marshal;
pub mod panel;
pub mod race_control;

pub use ecu::{EcuActor, EcuHandle, EcuMessage};
pub use marshal::{MarshalActor, MarshalHandle, MarshalMessage};
pub use panel::{PanelActor, PanelHandle, PanelMessage};
pub use race_control::{RaceControlActor, RaceControlHandle, RaceControlMessage};
