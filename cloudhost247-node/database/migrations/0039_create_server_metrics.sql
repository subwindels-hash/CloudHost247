-- Migration: 0039_create_server_metrics.sql
-- Purpose: Phase 6 — monitoring snapshots (spec §51).
--
-- The server agent reports periodic metric samples (src/routes/agent.ts) and the worker's
-- healthcheck job records per-installation health (spec §52) on application_installations
-- itself (health_status / last_health_check_at columns, migration 0032). server_metrics keeps
-- the server-level time series: a lightweight ring of snapshots (retention trimmed by the
-- monitoring job) rather than a full metrics database — the right cost point for a control
-- plane, while agents can additionally feed Prometheus/Grafana deployed from the marketplace.

CREATE TABLE IF NOT EXISTS server_metrics (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT now(),
  cpu_percent numeric(5, 2) NULL CHECK (cpu_percent IS NULL OR (cpu_percent >= 0 AND cpu_percent <= 100)),
  load_1 numeric(8, 3) NULL,
  load_5 numeric(8, 3) NULL,
  load_15 numeric(8, 3) NULL,
  memory_used_mb integer NULL,
  memory_total_mb integer NULL,
  disk_used_mb integer NULL,
  disk_total_mb integer NULL,
  network_in_bytes bigint NULL,
  network_out_bytes bigint NULL,
  uptime_seconds bigint NULL,
  docker_containers integer NULL,
  docker_containers_healthy integer NULL
);

CREATE INDEX IF NOT EXISTS server_metrics_server_time_idx ON server_metrics (server_id, captured_at DESC);
