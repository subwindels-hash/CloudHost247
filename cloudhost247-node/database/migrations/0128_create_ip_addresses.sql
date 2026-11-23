-- Migration: 0128_create_ip_addresses.sql
-- Purpose: Add IP address inventory for VPS/IP management (E12 — E VPS).
--
-- Design notes:
--   * Creates an ip_addresses table that tracks the platform's IP address pool:
--     each row is a single IPv4/IPv6 address with a status (free/assigned/reserved)
--     and an optional link to the server and customer it is assigned to.
--   * No external provider is called — this is an internal inventory only. IP
--     allocation from a real provider is not yet configured.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS ip_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address varchar(64) NOT NULL,
  version varchar(4) NOT NULL CHECK (version IN ('ipv4', 'ipv6')),
  status varchar(20) NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'assigned', 'reserved')),
  server_id uuid NULL REFERENCES servers (id) ON DELETE SET NULL,
  customer_id uuid NULL,
  assigned_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ip_addresses_address_unique UNIQUE (address)
);

CREATE INDEX IF NOT EXISTS ip_addresses_status_idx ON ip_addresses (status);
CREATE INDEX IF NOT EXISTS ip_addresses_server_id_idx ON ip_addresses (server_id);
CREATE INDEX IF NOT EXISTS ip_addresses_customer_id_idx ON ip_addresses (customer_id);
