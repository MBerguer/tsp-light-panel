# Stage 1: Build Frontend (Vite + React)
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Build Backend (Rust / Axum)
FROM rust:1.80-slim-bookworm AS backend-builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ ./crates/
RUN cargo build --release -p tsp-server

# Stage 3: Lightweight Runtime Image
FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=backend-builder /app/target/release/tsp-server /app/tsp-server
COPY --from=backend-builder /app/crates/server/circuits /app/circuits
COPY --from=frontend-builder /app/web/dist /app/web/dist

ENV TSP_BIND=0.0.0.0:8080
ENV TSP_STATIC_DIR=/app/web/dist
ENV TSP_CIRCUITS_DIR=/app/circuits
ENV TSP_CIRCUIT=el_pinar_n13
ENV RUST_LOG=tsp=info,info

EXPOSE 8080

CMD ["/app/tsp-server"]
