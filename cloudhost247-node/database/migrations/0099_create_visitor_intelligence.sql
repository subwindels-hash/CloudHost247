-- Migration: 0099_create_visitor_intelligence.sql
-- First-party, consent-aware visitor sessions, pageviews and live tab presence.
-- Additive only: no customer, auth, billing or existing marketing table is modified.
-- Raw IP addresses and raw User-Agent strings are deliberately not represented in this schema.

CREATE TABLE IF NOT EXISTS visitor_intelligence_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 7 AND 365),
  idle_after_seconds integer NOT NULL DEFAULT 120 CHECK (idle_after_seconds BETWEEN 60 AND 3600),
  online_timeout_seconds integer NOT NULL DEFAULT 120 CHECK (online_timeout_seconds BETWEEN 60 AND 600),
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO visitor_intelligence_settings (id, enabled, retention_days, idle_after_seconds, online_timeout_seconds)
VALUES (1, false, 90, 120, 120)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS visitor_sessions (
  session_id uuid PRIMARY KEY,
  visitor_id uuid NOT NULL,
  consent_session_id uuid NOT NULL REFERENCES marketing_consent_sessions(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  first_page_path varchar(512) NOT NULL,
  referrer_host varchar(255) NULL,
  country_name varchar(96) NULL,
  country_code char(2) NULL,
  region_name varchar(128) NULL,
  city_name varchar(128) NULL,
  -- Rounded GeoIP city-centre coordinates only; never a browser/GPS or street-level location.
  latitude double precision NULL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude double precision NULL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  timezone varchar(64) NULL,
  device_category varchar(16) NOT NULL DEFAULT 'unknown'
    CHECK (device_category IN ('desktop', 'mobile', 'tablet', 'unknown')),
  browser_family varchar(40) NOT NULL DEFAULT 'Other',
  os_family varchar(40) NOT NULL DEFAULT 'Other',
  CONSTRAINT visitor_sessions_country_code_check CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$')
);

CREATE INDEX IF NOT EXISTS visitor_sessions_visitor_first_seen_idx
  ON visitor_sessions (visitor_id, first_seen_at);
CREATE INDEX IF NOT EXISTS visitor_sessions_first_seen_idx
  ON visitor_sessions (first_seen_at DESC);
CREATE INDEX IF NOT EXISTS visitor_sessions_last_seen_idx
  ON visitor_sessions (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS visitor_sessions_geo_idx
  ON visitor_sessions (country_code, city_name, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS visitor_pageviews (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES visitor_sessions(session_id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL,
  page_path varchar(512) NOT NULL,
  referrer_host varchar(255) NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitor_pageviews_occurred_idx
  ON visitor_pageviews (occurred_at DESC);
CREATE INDEX IF NOT EXISTS visitor_pageviews_page_occurred_idx
  ON visitor_pageviews (page_path, occurred_at DESC);
CREATE INDEX IF NOT EXISTS visitor_pageviews_visitor_occurred_idx
  ON visitor_pageviews (visitor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS visitor_pageviews_session_occurred_idx
  ON visitor_pageviews (session_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS visitor_presence (
  tab_id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES visitor_sessions(session_id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL,
  current_page_path varchar(512) NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS visitor_presence_heartbeat_idx
  ON visitor_presence (heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS visitor_presence_visitor_heartbeat_idx
  ON visitor_presence (visitor_id, heartbeat_at DESC);
CREATE INDEX IF NOT EXISTS visitor_presence_session_heartbeat_idx
  ON visitor_presence (session_id, heartbeat_at DESC);

COMMENT ON TABLE visitor_sessions IS
  'Anonymous consent-bound sessions. Contains no raw IP, raw User-Agent, account id, email or authentication credential.';
COMMENT ON TABLE visitor_pageviews IS
  'Sanitized origin-relative paths and referrer hostnames only; query strings and fragments are never stored.';
COMMENT ON TABLE visitor_presence IS
  'One row per open browser tab, refreshed by heartbeat; stale rows are excluded at read time and pruned by the worker.';
