# Arquitectura — TSP Light Panel

Simulador del sistema de paneles luminosos trackside de Fórmula 1, modelado sobre la
**FIA Standard 3504-2019** (Light Panels for Motor Racing) y dispositivos T1/T2 reales
(EM Motorsport, MYLAPS).

## Fases del proyecto

| Fase | Alcance | Estado |
|------|---------|--------|
| 1 | Arquitectura y lógica de dominio (`core`, `eventstore`, esqueleto de actores) | en curso |
| 2 | Módulo de testing y simulación (replay, escenarios scriptables, time-virtual) | pendiente |
| 3 | I/O reales: WS gateway productivo + UI React con trazado y dashboards | pendiente |

## Stack

- **Backend:** Rust + `tokio` + `axum` + `serde` + `tracing` + `ts-rs`.
- **Concurrencia:** modelo de actores con canales `tokio::sync::mpsc` por entidad,
  bus global con `tokio::sync::broadcast`.
- **Persistencia:** event sourcing con log append-only en JSONL + snapshots.
- **Frontend (Fase 3):** React + Vite + Zustand + SVG.
- **Transporte UI ↔ Server (Fase 3):** WebSocket bidireccional.

## Crates

```
crates/
├── core/         # Dominio puro: tipos, state machine, mensajes (sin I/O)
├── eventstore/   # Append-only log + snapshots + replay
├── server/       # Actores tokio + axum WS gateway (binario)
└── simulator/    # Fase 2: scenarios, generadores de eventos, replay-runner
```

## Jerarquía de comandos (FIA 3504)

```
Race Control Software   (prioridad máxima — override global)
        │
        ▼
Marshal Control Device  (entrada local por zona)
        │
        ▼
Light Panel             (display físico + repeater + diagnóstico)
        │
        ▼
Car ECU / Steering      (telemetry loop bidireccional)
```

La función `core::resolve_effective_state(panel)` aplica esta prioridad de forma pura.

## Eventos y comandos

- **Comando:** intención externa (`PanelCommand { source, target, flag }`).
- **Evento:** hecho consumado (`DomainEvent::PanelStateChanged`, `DiagnosticAlertRaised`, …).
- Los actores **emiten eventos** y los **persisten** en el `EventStore` antes de
  notificar al bus de broadcast — esto da replay determinístico para Fase 2.

## Telemetry loop bidireccional

1. Marshal o Race Control envían comando → `PanelActor`.
2. `PanelActor` resuelve estado efectivo, persiste `PanelStateChanged`, emite al bus.
3. `EcuActor` (uno por auto) consume el evento y enciende la luz del volante
   correspondiente según la zona del auto.
4. `DiagnosticSupervisor` polea cada panel periódicamente (handshake) y emite
   `DiagnosticAlert` en caso de PSU/temperatura/LED fuera de rango.

## Diagrama de componentes

Ver `plan` original o `crates/server/README.md`. Reproducimos el flujo principal:

```
UI (React)
   │  WS
   ▼
axum gateway ──► RaceControlActor ──► PanelActor (×N) ──► EventBus (broadcast)
                  ▲                          │                  │
                  │                          ▼                  ├──► EcuActor (×N)
                MarshalActor (×N)       EventStore               └──► UI subscribers
                                                                       │
                                                                       └──► DiagnosticSupervisor
```

## Testing strategy

- **Unit tests** del state machine (transiciones válidas / inválidas, prioridades).
- **Property-based tests** con `proptest`: invariantes (ej. "tras `Red` global, todos
  los paneles devuelven `Red` independiente del marshal").
- **Integration smoke test**: marshal triggerea yellow → panel cambia → ECU recibe →
  event store contiene el evento.
- **Fase 2:** scenarios reproducibles con `tokio::time::pause`, replay de logs
  reales, fuzz testing.
