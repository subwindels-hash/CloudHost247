-- Migration: 0122_create_agency_tables.sql
-- Purpose: Agency / reseller hosting backend (W10, J Agency core).
--
-- Design notes:
--   * An agency is a reseller account that can manage multiple client accounts under one
--     umbrella. Clients are regular user accounts linked to an agency via agency_clients.
--   * Reseller packages are product templates an agency can offer to its clients; they are
--     catalogue descriptions only — no pricing or provisioning is activated here (D2 freeze).
--   * Agencies and clients are staff-managed: creation and updates require staff/admin
--     roles. This is the backend surface for agency hosting pages; the frontend pages that
--     consume it are part of the website redesign (W Website workstream).
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY,
  name varchar(255) NOT NULL,
  slug varchar(120) NOT NULL UNIQUE,
  contact_email varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agencies_status_check CHECK (status IN ('active', 'suspended', 'disabled'))
);

CREATE INDEX IF NOT EXISTS agencies_slug_idx ON agencies (slug);
CREATE INDEX IF NOT EXISTS agencies_status_idx ON agencies (status);

CREATE TABLE IF NOT EXISTS agency_clients (
  id uuid PRIMARY KEY,
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(32) NOT NULL DEFAULT 'client',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_clients_role_check CHECK (role IN ('owner', 'client', 'billing')),
  CONSTRAINT agency_clients_unique_user_per_agency UNIQUE (agency_id, user_id)
);

CREATE INDEX IF NOT EXISTS agency_clients_agency_idx ON agency_clients (agency_id);
CREATE INDEX IF NOT EXISTS agency_clients_user_idx ON agency_clients (user_id);

CREATE TABLE IF NOT EXISTS reseller_packages (
  id uuid PRIMARY KEY,
  name varchar(255) NOT NULL,
  slug varchar(120) NOT NULL UNIQUE,
  description text NULL,
  price_cents integer NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reseller_packages_status_check CHECK (status IN ('active', 'disabled', 'archived'))
);

CREATE INDEX IF NOT EXISTS reseller_packages_slug_idx ON reseller_packages (slug);
CREATE INDEX IF NOT EXISTS reseller_packages_status_idx ON reseller_packages (status);

-- Staff-facing comment: reseller_packages.price_cents is display-only under the D2 financial
-- freeze; no order or payment flow is activated by this migration.
