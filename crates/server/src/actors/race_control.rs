//! `RaceControlActor` — single instance that mirrors the role of the race
//! director console. Owns no panel state itself; it just authenticates the
//! source as Race Control and forwards the command to the dispatch
//! [`crate::dispatch::Hub`].

use tokio::sync::{mpsc, oneshot};
use tracing::{info, instrument, warn};

use tsp_core::{CommandRejection, OperatorId, PanelCommand};

use crate::dispatch::HubHandle;

#[derive(Debug)]
pub enum RaceControlMessage {
    /// Submit a command on behalf of the active operator.
    Submit {
        command: PanelCommand,
        reply: oneshot::Sender<Result<usize, CommandRejection>>,
    },
    Shutdown,
}

#[derive(Debug, Clone)]
pub struct RaceControlHandle {
    pub operator: OperatorId,
    tx: mpsc::Sender<RaceControlMessage>,
}

impl RaceControlHandle {
    pub async fn submit(&self, command: PanelCommand) -> Result<usize, CommandRejection> {
        let (reply, rx) = oneshot::channel();
        let _ = self
            .tx
            .send(RaceControlMessage::Submit { command, reply })
            .await;
        rx.await.expect("race control actor dropped")
    }
}

pub struct RaceControlActor {
    operator: OperatorId,
    hub: HubHandle,
    rx: mpsc::Receiver<RaceControlMessage>,
}

impl RaceControlActor {
    pub fn spawn(operator: OperatorId, hub: HubHandle) -> RaceControlHandle {
        let (tx, rx) = mpsc::channel(64);
        let actor = RaceControlActor { operator, hub, rx };
        tokio::spawn(actor.run());
        RaceControlHandle { operator, tx }
    }

    #[instrument(skip(self), fields(operator = %self.operator))]
    async fn run(mut self) {
        info!("race control actor started");
        while let Some(msg) = self.rx.recv().await {
            match msg {
                RaceControlMessage::Submit { command, reply } => {
                    if !command.source.is_race_control() {
                        warn!("non-RC command reached race control actor");
                    }
                    let result = self.hub.dispatch(command).await;
                    let _ = reply.send(result);
                }
                RaceControlMessage::Shutdown => break,
            }
        }
        info!("race control actor stopped");
    }
}
