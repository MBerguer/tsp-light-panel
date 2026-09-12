//! End-to-end smoke tests for the actor system.
//!
//! These tests exercise the full pipeline:
//!
//! 1. Spin up a [`World`] with a few panels.
//! 2. Drive it through a [`MarshalHandle`] / [`RaceControlHandle`].
//! 3. Verify that the [`EventBus`] published the expected events and that the
//!    event store recorded the same history.
//!
//! They run on the multi-thread tokio runtime so the actors and the subscriber
//! make actual progress in parallel.

use std::time::Duration;

use tokio::time::timeout;
use tsp_core::{
    CarNumber, CommandSource, CommandTarget, DomainEvent, FlagState, OperatorId, PanelId, PostId,
    YellowKind, ZoneId,
};
use tsp_server::{
    actors::panel::Fault,
    diagnostic::DiagnosticConfig,
    World,
};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn marshal_yellow_propagates_to_panel_ecu_and_store() {
    let world = World::in_memory();
    let _panels = world
        .bootstrap_circuit(&[(1, 7, 1, 0.0), (2, 7, 1, 50.0), (3, 8, 1, 200.0)])
        .await;
    let car = world.spawn_ecu(CarNumber::new(44), Some(ZoneId::new(7))).await;
    let marshal = world.spawn_marshal(PostId::new(7));

    let mut sub = world.bus.subscribe();

    let cmd = tsp_core::PanelCommand::new(
        CommandSource::Marshal {
            post: PostId::new(7),
        },
        CommandTarget::Zone(ZoneId::new(7)),
        FlagState::Yellow(YellowKind::Double),
    );
    let accepted = marshal.submit(cmd).await.expect("dispatched");
    assert_eq!(accepted, 2, "two panels in zone 7 should accept");

    let mut saw_state_change = false;
    let mut saw_ecu_notified = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        let Ok(Ok(ev)) = timeout(Duration::from_millis(200), sub.recv()).await else {
            break;
        };
        match ev {
            DomainEvent::PanelStateChanged { to, .. } => {
                if to == FlagState::Yellow(YellowKind::Double) {
                    saw_state_change = true;
                }
            }
            DomainEvent::EcuNotified { car: c, flag, .. } => {
                if c == CarNumber::new(44) && flag == FlagState::Yellow(YellowKind::Double) {
                    saw_ecu_notified = true;
                }
            }
            _ => {}
        }
        if saw_state_change && saw_ecu_notified {
            break;
        }
    }
    assert!(saw_state_change, "panel state change event not observed");
    assert!(saw_ecu_notified, "ECU did not receive the flag");

    let logged = world.store.read_all().await.expect("read_all");
    assert!(
        logged
            .iter()
            .any(|e| matches!(e, DomainEvent::PanelStateChanged { to, .. } if *to == FlagState::Yellow(YellowKind::Double))),
        "event store does not contain the state change"
    );
    assert!(
        logged
            .iter()
            .any(|e| matches!(e, DomainEvent::EcuNotified { .. })),
        "event store does not contain the ECU notification"
    );
    drop(car);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn race_control_red_overrides_local_yellow_globally() {
    let world = World::in_memory();
    world
        .bootstrap_circuit(&[(1, 7, 1, 0.0), (2, 8, 1, 200.0), (3, 9, 2, 700.0)])
        .await;
    let marshal = world.spawn_marshal(PostId::new(7));
    let rc = world.spawn_race_control(OperatorId::new());

    marshal
        .submit(tsp_core::PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(7),
            },
            CommandTarget::Zone(ZoneId::new(7)),
            FlagState::Yellow(YellowKind::Single),
        ))
        .await
        .unwrap();

    rc.submit(tsp_core::PanelCommand::new(
        CommandSource::RaceControl {
            operator: OperatorId::new(),
        },
        CommandTarget::Global,
        FlagState::Red,
    ))
    .await
    .unwrap();

    for h in world.hub.all_handles().await {
        let snap = h.snapshot().await;
        assert_eq!(
            snap.effective_state,
            FlagState::Red,
            "panel {} did not show Red",
            snap.id
        );
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn diagnostic_supervisor_detects_psu_undervoltage() {
    let world = World::in_memory();
    let panels = world.bootstrap_circuit(&[(1, 7, 1, 0.0)]).await;
    let supervisor = world
        .build_diagnostic(DiagnosticConfig {
            poll_interval: Duration::from_millis(10_000),
            ..Default::default()
        })
        .await;

    panels[0].inject_fault(Fault::SetPsuVoltage(40.0)).await;

    let mut sub = world.bus.subscribe();
    supervisor.tick().await;

    let mut got_alert = false;
    for _ in 0..16 {
        let Ok(Ok(ev)) = timeout(Duration::from_millis(50), sub.recv()).await else {
            break;
        };
        if let DomainEvent::DiagnosticAlertRaised { alert, .. } = ev {
            assert_eq!(alert.panel(), PanelId::new(1));
            got_alert = true;
            break;
        }
    }
    assert!(got_alert, "diagnostic supervisor did not raise PSU alert");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn marshal_red_flag_is_rejected_and_logged() {
    let world = World::in_memory();
    world.bootstrap_circuit(&[(1, 7, 1, 0.0)]).await;
    let marshal = world.spawn_marshal(PostId::new(7));

    let err = marshal
        .submit(tsp_core::PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(7),
            },
            CommandTarget::Zone(ZoneId::new(7)),
            FlagState::Red,
        ))
        .await
        .expect_err("marshal must not be allowed to raise red");

    assert!(matches!(
        err,
        tsp_core::CommandRejection::NotAllowedForMarshal { .. }
    ));

    let logged = world.store.read_all().await.unwrap();
    assert!(
        logged
            .iter()
            .any(|e| matches!(e, DomainEvent::CommandRejected { .. })),
        "rejection should be in the event store"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn world_reset_session_clears_all_flags() {
    let world = World::in_memory();
    world.bootstrap_circuit(&[(1, 7, 1, 0.0), (2, 8, 1, 50.0)]).await;
    let marshal = world.spawn_marshal(PostId::new(7));
    let rc = world.spawn_race_control(OperatorId::new());

    // 1. Marshal sets local yellow on post 7
    let _ = marshal
        .submit(tsp_core::PanelCommand::new(
            CommandSource::Marshal {
                post: PostId::new(7),
            },
            CommandTarget::Zone(ZoneId::new(7)),
            FlagState::Yellow(YellowKind::Single),
        ))
        .await
        .expect("marshal yellow accepted");

    // 2. RC sets global SC
    let _ = rc
        .submit(tsp_core::PanelCommand::new(
            CommandSource::RaceControl {
                operator: OperatorId::new(),
            },
            CommandTarget::Global,
            FlagState::SafetyCar,
        ))
        .await
        .expect("rc sc accepted");

    // Verify panel 1 has both override and local state
    let snap1_before = world.hub.panel_handle(PanelId::new(1)).await.unwrap().snapshot().await;
    assert_eq!(snap1_before.override_from_rc, Some(FlagState::SafetyCar));
    assert_eq!(snap1_before.local_state, Some(FlagState::Yellow(YellowKind::Single)));

    // 3. Reset session
    world.reset_session().await;

    // Verify all panels are completely clear and Off
    let snap1_after = world.hub.panel_handle(PanelId::new(1)).await.unwrap().snapshot().await;
    assert_eq!(snap1_after.override_from_rc, None);
    assert_eq!(snap1_after.local_state, None);
    assert_eq!(snap1_after.effective_state, FlagState::Off);

    let snap2_after = world.hub.panel_handle(PanelId::new(2)).await.unwrap().snapshot().await;
    assert_eq!(snap2_after.override_from_rc, None);
    assert_eq!(snap2_after.local_state, None);
    assert_eq!(snap2_after.effective_state, FlagState::Off);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn gateway_marshal_roster_tracks_presence() {
    use std::sync::Arc;
    let world = Arc::new(World::in_memory());
    let scenarios = Arc::new(tsp_server::ScenarioController::new(world.clone(), OperatorId::new()));
    let gw = tsp_server::gateway::GatewayState::new(world, scenarios);

    assert!(gw.current_roster().is_empty());

    gw.update_marshal_presence(PostId::new(3), "Carlos P3".into(), true);
    gw.update_marshal_presence(PostId::new(7), "Pedro P7".into(), true);

    let roster = gw.current_roster();
    assert_eq!(roster.len(), 2);
    let p3 = roster.iter().find(|e| e.post == PostId::new(3)).unwrap();
    assert_eq!(p3.name, "Carlos P3");
    assert!(p3.online);

    gw.mark_marshal_offline(PostId::new(3));
    let roster_after = gw.current_roster();
    let p3_after = roster_after.iter().find(|e| e.post == PostId::new(3)).unwrap();
    assert!(!p3_after.online);
    let p7_after = roster_after.iter().find(|e| e.post == PostId::new(7)).unwrap();
    assert!(p7_after.online);
}

