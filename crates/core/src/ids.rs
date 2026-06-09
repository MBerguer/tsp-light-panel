//! Strongly-typed identifiers used across the domain.
//!
//! We deliberately use newtypes so that mixing up, say, a `PanelId` with a
//! `ZoneId` is a compile error. All ids implement `Copy` where possible to keep
//! the actor message paths cheap.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(feature = "ts-rs")]
use ts_rs::TS;

macro_rules! u32_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[cfg_attr(
            feature = "ts-rs",
            derive(TS),
            ts(export, export_to = "../../../web/src/types/ids.ts", type = "number")
        )]
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub u32);

        impl $name {
            pub const fn new(value: u32) -> Self {
                Self(value)
            }

            pub const fn raw(self) -> u32 {
                self.0
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}#{}", stringify!($name), self.0)
            }
        }

        impl From<u32> for $name {
            fn from(value: u32) -> Self {
                Self(value)
            }
        }
    };
}

macro_rules! uuid_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[cfg_attr(
            feature = "ts-rs",
            derive(TS),
            ts(export, export_to = "../../../web/src/types/ids.ts", type = "string")
        )]
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub const fn from_uuid(id: Uuid) -> Self {
                Self(id)
            }

            pub const fn raw(self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }
    };
}

u32_id!(PanelId, "Stable id of a physical light panel.");
u32_id!(ZoneId, "Local marshalling zone (post). One marshal device per zone.");
u32_id!(SectorId, "Track sector grouping multiple zones (mini-sector or official sector).");
u32_id!(PostId, "Marshal post id. Conceptually paired with one [`ZoneId`].");
u32_id!(LedId, "Index of an individual LED inside a panel matrix.");
u32_id!(CarNumber, "F1-style car number (1..=99).");

uuid_id!(CommandId, "Id of a command issued by Race Control or a marshal.");
uuid_id!(EventId, "Id of a domain event recorded in the event store.");
uuid_id!(OperatorId, "Id of a Race Control operator (race director, deputy, etc.).");
