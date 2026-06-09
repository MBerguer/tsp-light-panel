//! `MarshalActor` — one per marshal post. Forwards local flag commands to
//! the dispatch hub after sanity-checking the post id matches the command
//! source.

use tokio::sync::{mpsc, oneshot};
use tracing::{info, instrument, warn};

use tsp_core::{CommandRejection, CommandSource, PanelCommand, PostId};

use crate::dispatch::HubHandle;

#[derive(Debug)]
pub enum MarshalMessage {
    Submit {
        command: PanelCommand,
        reply: oneshot::Sender<Result<usize, CommandRejection>>,
    },
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct MarshalHandle {
    pub post: PostId,
    tx: mpsc::Sender<MarshalMessage>,
}

impl MarshalHandle {
    pub async fn submit(&self, command: PanelCommand) -> Result<usize, CommandRejection> {
        let (reply, rx) = oneshot::channel();
        let _ = self.tx.send(MarshalMessage::Submit { command, reply }).await;
        rx.await.expect("marshal actor dropped")
    }
}

pub struct MarshalActor {
    post: PostId,
    hub: HubHandle,
    rx: mpsc::Receiver<MarshalMessage>,
}

impl MarshalActor {
    pub fn spawn(post: PostId, hub: HubHandle) -> MarshalHandle {
        let (tx, rx) = mpsc::channel(32);
        let actor = MarshalActor { post, hub, rx };
        tokio::spawn(actor.run());
        MarshalHandle { post, tx }
    }

    #[instrument(skip(self), fields(post = %self.post))]
    async fn run(mut self) {
        info!("marshal actor started");
        while let Some(msg) = self.rx.recv().await {
            match msg {
                MarshalMessage::Submit { command, reply } => {
                    if !matches!(command.source, CommandSource::Marshal { post } if post == self.post)
                    {
                        warn!(?command.source, "marshal received command from a different source");
                    }
                    let result = self.hub.dispatch(command).await;
                    let _ = reply.send(result);
                }
                MarshalMessage::Shutdown => break,
            }
        }
        info!("marshal actor stopped");
    }
}
