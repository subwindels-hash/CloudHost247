-- Migration: 0120_create_incidents.sql
-- Purpose: Customer-facing incident / status notifications (K07).
--
-- Design notes:
--   * An incident is a publicly-declared service event created by an operator
--     (admin / super_admin). Customers see it on the public status page and, for
--     major / critical incidents, receive an in-app + email notification.
--   * Nothing here is auto-detected. `monitored: false` stays permanent on the
--     status page: incidents are operator-declared, not the output of a monitor
--     this deployment does not run. Declaring an incident is an explicit act,
--     never an inference.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS incidents (
  id uuid PRIMARY KEY,
  incident_number varchar(32) NOT NULL UNIQUE,
  title varchar(255) NOT NULL,
  body text NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'investigating',
  severity varchar(32) NOT NULL DEFAULT 'minor',
  started_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incidents_status_check CHECK (
    status IN ('investigating', 'identified', 'monitoring', 'resolved')
  ),
  CONSTRAINT incidents_severity_check CHECK (
    severity IN ('minor', 'major', 'critical')
  )
);

-- Public list reads: most recent first, usually filtered to active incidents.
CREATE INDEX IF NOT EXISTS incidents_status_started_idx
  ON incidents (status, started_at DESC);

-- Public single-incident read by human-readable number.
CREATE INDEX IF NOT EXISTS incidents_incident_number_idx
  ON incidents (incident_number);
