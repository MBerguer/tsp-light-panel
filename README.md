# tsp-light-panel

Simulador web del sistema de paneles luminosos trackside de Fórmula 1
(**FIA Standard 3504-2019**). Backend en Rust con modelo de actores sobre
`tokio`, máquina de estados con jerarquía `Race Control > Marshal > Panel`,
event sourcing para replay determinístico, WS gateway tipado, y UI React
con trazado SVG + 3 dashboards operativos.

> Estado actual: **Fase 4 — Scenario player live conectado a la UI**.

Ver [`docs/architecture.md`](docs/architecture.md) para el diseño completo.

## Workspace

```
crates/
├── core/         # Dominio puro (tipos, state machine, mensajes WS, ts-rs export)
├── eventstore/   # Append-only event log + snapshots
├── server/       # axum + actores tokio + WS gateway + topology API (binario)
└── simulator/    # Scenarios + replay + proptest fuzz

web/              # React + Vite + TS + Tailwind + Zustand UI
scripts/          # Smoke tests de WS y autorización
```

## Quick start

```bash
# Backend (terminal 1)
cargo run -p tsp-server

# Frontend dev mode (terminal 2)
cd web && npm install && npm run dev   # http://localhost:5173

# O bien build de producción + serve desde el backend
cd web && npm run build
cargo run -p tsp-server                # http://localhost:7878
```

## Endpoints (server)

| Método | Path                | Descripción                                            |
| ------ | ------------------- | ------------------------------------------------------ |
| GET    | `/health`           | Health check                                           |
| GET    | `/api/topology`     | `CircuitTopology` para que la UI dibuje la pista       |
| GET    | `/api/snapshot`     | Snapshot consolidado de todos los paneles              |
| GET    | `/api/sim/library`  | Catálogo de scenarios built-in                         |
| POST   | `/api/sim/run`      | Arranca un scenario (`{ name?, scenario?, speed? }`)   |
| POST   | `/api/sim/stop`     | Para el scenario corriente                             |
| POST   | `/api/sim/reset`    | Para + apaga todos los paneles (Off)                   |
| GET    | `/ws`               | WebSocket bidireccional (`tsp_core::wire`)             |
| GET    | `/*`                | `web/dist` estático (fallback)                         |

## Tests

```bash
cargo test --workspace                                # 50+ tests
cargo clippy --workspace --all-targets -- -D warnings # 0 warnings
cargo test -p tsp-core --features ts-rs               # regenera bindings TS
cd web && npm run typecheck                           # tipa el frontend
node scripts/smoke_ws.mjs                             # end-to-end RC → 12 paneles
node scripts/smoke_auth.mjs                           # rechazo de spectator
node scripts/smoke_scenario.mjs                       # corre el scenario yellow_to_sc
```

## Roles + autorización

| Rol               | Capacidades                                                        |
| ----------------- | ------------------------------------------------------------------ |
| `RaceControl`     | Global / sector / zone / panel; comandos `Source::RaceControl`     |
| `Marshal { post }`| Solo su `Zone(post)` o `Panel`; flags locales (Y, YY, Y/R, W, B)   |
| `EngineeringRoom` | Read-only — health, alertas, replay                                |
| `Spectator`       | Read-only — feed básico                                            |

La validación se hace **dos veces**: en el gateway (rol vs. fuente declarada)
y en el state machine de `tsp_core` (FIA priority hierarchy). Una marshal
intentando setear RED es rechazada por el dominio aunque la UI deje pulsarla.

## Scenario library

Built-in y ejecutables desde la vista *Scenarios* o via REST:

| Scenario               | Descripción                                                   |
| ---------------------- | ------------------------------------------------------------- |
| `yellow_to_sc`         | Escalación yellow → double yellow → SC global                 |
| `red_flag_restart`     | Red flag global, hold, restart en green                       |
| `vsc_cycle`            | Deploy VSC → VSC ending → green                               |
| `multi_zone_yellow`    | Dos zonas yellow simultáneas, clear escalonado                |
| `rolling_yellow_wave`  | Mexican-wave de yellow por las 6 zonas, return a green        |
| `psu_undervoltage`     | Inyección de PSU 38V → alerta diagnostic crítica → recovery   |
| `marshal_red_rejected` | Marshal intenta red flag — state machine lo rechaza           |

## Roadmap

- [x] Fase 1 — Arquitectura, state machine, event store, tests propiedad.
- [x] Fase 2 — Simulador declarativo, replay, fuzz testing, library de scenarios.
- [x] Fase 3 — WS gateway, REST APIs, ts-rs bindings, UI React (RC / Marshal / Engineering).
- [x] Fase 4 — Live scenario player en UI + REST /api/sim, refactor de Scenario a `tsp_core`.
- [ ] Fase 5 (futuro) — Cars overlay con movimiento real sobre la pista, replay scrub del event log, scenario editor visual.

## Referencias

- FIA Standard 3504-2019 — Light Panels for Motor Racing.
- EM Motorsport T2 brochure.
