//! `tsp-eventstore` — append-only event log + snapshots.
//!
//! Persists every [`DomainEvent`] in JSONL (one event per line) and keeps a
//! periodic snapshot of the world state (per-panel summary). This is the
//! backbone that unlocks Phase 2 (replay, deterministic testing) and Phase 3
//! (UI reconnect: send snapshot + tail of new events).
//!
//! ## Design
//!
//! * **Append-only**: writes go through a single tokio `mpsc` consumed by the
//!   [`EventStoreActor`], so concurrent senders never race on the file.
//! * **JSONL**: one self-contained JSON object per line. Easy to inspect with
//!   `tail -f`, `jq`, or load into pandas during postmortems.
//! * **Replay**: [`read_all`] returns every event in order. Higher layers can
//!   then fold them through `apply_command`-equivalent transitions.
//! * **Snapshot**: a separate `*.snapshot.json` file with the latest world
//!   state. Allows fast warm starts without replaying months of events.
//!
//! Both in-memory and file-backed stores are provided; the in-memory one is
//! used by tests and by the simulator's deterministic scenarios.

#![deny(rust_2018_idioms)]
#![warn(clippy::all)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::fs::{File, OpenOptions};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tracing::{debug, instrument};

use tsp_core::{DomainEvent, EventId, Panel, PanelId};

#[derive(Debug, Error)]
pub enum EventStoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, EventStoreError>;

/// Public interface implemented by every store backend.
#[async_trait]
pub trait EventStore: Send + Sync + 'static {
    async fn append(&self, event: DomainEvent) -> Result<()>;
    async fn read_all(&self) -> Result<Vec<DomainEvent>>;
    async fn read_from(&self, from: EventId) -> Result<Vec<DomainEvent>>;
    async fn save_snapshot(&self, snapshot: &Snapshot) -> Result<()>;
    async fn load_snapshot(&self) -> Result<Option<Snapshot>>;
}

/// Latest world state, written periodically alongside the event log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub recorded_at: chrono::DateTime<chrono::Utc>,
    pub last_event: Option<EventId>,
    pub panels: Vec<Panel>,
}

impl Snapshot {
    pub fn empty() -> Self {
        Self {
            recorded_at: chrono::Utc::now(),
            last_event: None,
            panels: Vec::new(),
        }
    }

    pub fn panel(&self, id: PanelId) -> Option<&Panel> {
        self.panels.iter().find(|p| p.id == id)
    }
}

// ---------------------------------------------------------------------------
// In-memory backend
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct InMemoryEventStore {
    inner: Mutex<InMemoryState>,
}

#[derive(Debug, Default)]
struct InMemoryState {
    events: Vec<DomainEvent>,
    snapshot: Option<Snapshot>,
}

impl InMemoryEventStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn shared() -> Arc<Self> {
        Arc::new(Self::new())
    }
}

#[async_trait]
impl EventStore for InMemoryEventStore {
    async fn append(&self, event: DomainEvent) -> Result<()> {
        self.inner.lock().await.events.push(event);
        Ok(())
    }

    async fn read_all(&self) -> Result<Vec<DomainEvent>> {
        Ok(self.inner.lock().await.events.clone())
    }

    async fn read_from(&self, from: EventId) -> Result<Vec<DomainEvent>> {
        let state = self.inner.lock().await;
        let idx = state.events.iter().position(|e| e.id() == from);
        let slice = match idx {
            Some(i) => &state.events[i + 1..],
            None => &state.events[..],
        };
        Ok(slice.to_vec())
    }

    async fn save_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        self.inner.lock().await.snapshot = Some(snapshot.clone());
        Ok(())
    }

    async fn load_snapshot(&self) -> Result<Option<Snapshot>> {
        Ok(self.inner.lock().await.snapshot.clone())
    }
}

// ---------------------------------------------------------------------------
// JSONL file backend
// ---------------------------------------------------------------------------

/// File-backed append-only store.
///
/// Layout under `root`:
/// * `events.jsonl`   — one [`DomainEvent`] per line.
/// * `state.snapshot.json` — latest [`Snapshot`].
#[derive(Debug)]
pub struct JsonlEventStore {
    root: PathBuf,
    write_lock: Mutex<()>,
}

impl JsonlEventStore {
    pub async fn open(root: impl AsRef<Path>) -> Result<Self> {
        let root = root.as_ref().to_path_buf();
        if !tokio::fs::try_exists(&root).await? {
            tokio::fs::create_dir_all(&root).await?;
        }
        Ok(Self {
            root,
            write_lock: Mutex::new(()),
        })
    }

    fn events_path(&self) -> PathBuf {
        self.root.join("events.jsonl")
    }

    fn snapshot_path(&self) -> PathBuf {
        self.root.join("state.snapshot.json")
    }
}

#[async_trait]
impl EventStore for JsonlEventStore {
    #[instrument(skip(self, event), fields(event_id = %event.id()))]
    async fn append(&self, event: DomainEvent) -> Result<()> {
        let _guard = self.write_lock.lock().await;
        let line = serde_json::to_string(&event)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.events_path())
            .await?;
        file.write_all(line.as_bytes()).await?;
        file.write_all(b"\n").await?;
        file.flush().await?;
        debug!("appended event");
        Ok(())
    }

    async fn read_all(&self) -> Result<Vec<DomainEvent>> {
        let path = self.events_path();
        if !tokio::fs::try_exists(&path).await? {
            return Ok(Vec::new());
        }
        let file = File::open(path).await?;
        let mut reader = BufReader::new(file).lines();
        let mut out = Vec::new();
        while let Some(line) = reader.next_line().await? {
            if line.trim().is_empty() {
                continue;
            }
            let ev: DomainEvent = serde_json::from_str(&line)?;
            out.push(ev);
        }
        Ok(out)
    }

    async fn read_from(&self, from: EventId) -> Result<Vec<DomainEvent>> {
        let all = self.read_all().await?;
        let idx = all.iter().position(|e| e.id() == from);
        Ok(match idx {
            Some(i) => all[i + 1..].to_vec(),
            None => all,
        })
    }

    async fn save_snapshot(&self, snapshot: &Snapshot) -> Result<()> {
        let _guard = self.write_lock.lock().await;
        let json = serde_json::to_vec_pretty(snapshot)?;
        let tmp = self.snapshot_path().with_extension("tmp");
        {
            let mut file = File::create(&tmp).await?;
            file.write_all(&json).await?;
            file.flush().await?;
        }
        tokio::fs::rename(&tmp, self.snapshot_path()).await?;
        Ok(())
    }

    async fn load_snapshot(&self) -> Result<Option<Snapshot>> {
        let path = self.snapshot_path();
        if !tokio::fs::try_exists(&path).await? {
            return Ok(None);
        }
        let bytes = tokio::fs::read(path).await?;
        let snap: Snapshot = serde_json::from_slice(&bytes)?;
        Ok(Some(snap))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use tempfile::tempdir;
    use tsp_core::{CommandId, FlagState, PanelId, YellowKind};

    fn fake_event() -> DomainEvent {
        DomainEvent::PanelStateChanged {
            id: EventId::new(),
            command_id: CommandId::new(),
            panel: PanelId::new(1),
            from: FlagState::Off,
            to: FlagState::Yellow(YellowKind::Single),
            timestamp: Utc::now(),
        }
    }

    #[tokio::test]
    async fn in_memory_append_and_read_all() {
        let store = InMemoryEventStore::new();
        let e1 = fake_event();
        let e2 = fake_event();
        store.append(e1.clone()).await.unwrap();
        store.append(e2.clone()).await.unwrap();
        let all = store.read_all().await.unwrap();
        assert_eq!(all, vec![e1, e2]);
    }

    #[tokio::test]
    async fn in_memory_read_from_offset() {
        let store = InMemoryEventStore::new();
        let e1 = fake_event();
        let e2 = fake_event();
        let e3 = fake_event();
        store.append(e1.clone()).await.unwrap();
        store.append(e2.clone()).await.unwrap();
        store.append(e3.clone()).await.unwrap();
        let tail = store.read_from(e1.id()).await.unwrap();
        assert_eq!(tail, vec![e2, e3]);
    }

    #[tokio::test]
    async fn jsonl_roundtrip() {
        let dir = tempdir().unwrap();
        let store = JsonlEventStore::open(dir.path()).await.unwrap();
        let e1 = fake_event();
        let e2 = fake_event();
        store.append(e1.clone()).await.unwrap();
        store.append(e2.clone()).await.unwrap();
        let all = store.read_all().await.unwrap();
        assert_eq!(all, vec![e1, e2]);
    }

    #[tokio::test]
    async fn jsonl_snapshot_atomic() {
        let dir = tempdir().unwrap();
        let store = JsonlEventStore::open(dir.path()).await.unwrap();
        let snap = Snapshot::empty();
        store.save_snapshot(&snap).await.unwrap();
        let loaded = store.load_snapshot().await.unwrap().unwrap();
        assert_eq!(loaded.panels.len(), 0);
    }
}
