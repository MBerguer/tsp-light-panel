# `web/` — Phase 3 UI

React + Vite + TypeScript + Tailwind frontend for the F1 Trackside Light
Panel simulator. Three role-based views (Race Control, Marshal Console,
Engineering Room) communicate with the Rust backend through a single
WebSocket described in `tsp_core::wire`.

## Quick start

```bash
# 1. Run the backend (workspace root)
cargo run -p tsp-server

# 2. Generate / refresh TS bindings (anytime the wire protocol changes)
cargo test -p tsp-core --features ts-rs

# 3. Run the frontend in dev mode
cd web && npm install && npm run dev
```

The Vite dev server proxies `/api` and `/ws` to the backend on
`127.0.0.1:7878`. Override with `TSP_BACKEND` if needed:

```bash
TSP_BACKEND=http://localhost:9000 npm run dev
```

## Production bundle

```bash
cd web && npm run build
# then run the backend — it auto-serves web/dist if present
cargo run -p tsp-server
```

## Type bindings

`src/types/` is generated from `crates/core` via `ts-rs`. Do not edit
those files by hand — re-run `cargo test -p tsp-core --features ts-rs`
instead. Only `src/lib/topology.ts` is hand-authored because the
`CircuitTopology` struct lives in `tsp_server`.
