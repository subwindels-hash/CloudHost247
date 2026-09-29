-- Migration: 0028_create_servers_server_credentials.sql
-- Purpose: Phase 6 — server registry (spec §5) and encrypted server credentials (spec §6).
--
-- servers is the admin-managed inventory of every piece of infrastructure CloudHost247 can
-- deploy onto: VPS, dedicated servers, cPanel/WHM servers, Kubernetes nodes, and shared hosting
-- racks. `agent_id` is the stable identity the server agent authenticates with; `agent_secret`
-- and every other credential live ONLY in server_credentials, encrypted at rest
-- (src/lib/crypto.ts, AES-256-GCM with key_version for rotation) — never in this table, never
-- in plaintext anywhere.
--
-- Capacity columns (cpu_cores/memory_mb/storage_mb) are the *allocatable* capacity the operator
-- registers for the server; deployment scheduling subtracts active installation limits from
-- them (src/services/scheduling-service.ts).

CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY,
  name varchar(255) NOT NULL,
  hostname varchar(255) NOT NULL,
  ip_address varchar(64) NULL,
  server_type varchar(16) NOT NULL,
  provider varchar(64) NULL,
  region varchar(64) NULL,
  status varchar(24) NOT NULL DEFAULT 'active',
  agent_id varchar(64) NULL,
  agent_version varchar(32) NULL,
  agent_last_seen_at timestamptz NULL,
  cpu_cores integer NOT NULL DEFAULT 1 CHECK (cpu_cores > 0),
  memory_mb integer NOT NULL DEFAULT 1024 CHECK (memory_mb > 0),
  storage_mb integer NOT NULL DEFAULT 10240 CHECK (storage_mb > 0),
  docker_enabled boolean NOT NULL DEFAULT false,
  kubernetes_enabled boolean NOT NULL DEFAULT false,
  cpanel_enabled boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT servers_server_type_check CHECK (
    server_type IN ('VPS', 'DEDICATED', 'CPANEL', 'KUBERNETES', 'SHARED')
  ),
  CONSTRAINT servers_status_check CHECK (
    status IN ('active', 'provisioning', 'maintenance', 'offline', 'retired')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS servers_agent_id_unique_idx ON servers (agent_id) WHERE agent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS servers_server_type_idx ON servers (server_type);
CREATE INDEX IF NOT EXISTS servers_status_idx ON servers (status);

CREATE TABLE IF NOT EXISTS server_credentials (
  id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
  credential_type varchar(32) NOT NULL,
  -- AES-256-GCM envelope: v<keyVersion>:<iv>:<tag>:<ciphertext>, see src/lib/crypto.ts.
  encrypted_secret text NOT NULL,
  key_version integer NOT NULL DEFAULT 1 CHECK (key_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NULL,
  CONSTRAINT server_credentials_type_check CHECK (
    credential_type IN ('agent_secret', 'whm_api_token', 'cpanel_api_token', 'ssh_key', 'kubernetes_kubeconfig')
  )
);

-- One live credential of each type per server; rotation overwrites the row in place and bumps
-- key_version/rotated_at so audit history in audit_logs can trace who rotated what, when.
CREATE UNIQUE INDEX IF NOT EXISTS server_credentials_server_type_unique_idx
  ON server_credentials (server_id, credential_type);
