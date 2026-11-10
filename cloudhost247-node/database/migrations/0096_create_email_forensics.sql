-- Migration: 0096_create_email_forensics.sql
-- Purpose: storage for the native Email Trace & Forensics Analyzer — a defensive header-analysis
-- feature that works without any external email-tracing or IP-lookup API.
--
-- What this schema is for
--   One analysis row per customer-submitted email (uploaded .eml or pasted raw headers). The
--   stored data is *normalised evidence extracted from the headers* — sender, recipient, subject,
--   message-id, sending domain, source-IP candidates, route hops, authentication results, and a
--   confidence/trust classification for each candidate. No message bodies and no attachments are
--   stored.
--
-- What it deliberately does not store
--   * No raw email body, no attachments, no full MIME parts. Only header-derived fields are kept,
--     which is also why there is no column that could leak customer content later.
--   * No SMTP credentials, tokens, or server keys.
--   * No invented evidence: every IP candidate carries the exact header it was extracted from and
--     its position in the Received chain; every route hop carries its source header and trust class.
--
-- Tenant isolation
--   `user_id` references `users(id)` and is denormalised so tenant filters stay cheap. Every read
--   is scoped to the authenticated caller's user id; a cross-tenant read returns "not found",
--   never "forbidden", so this API never confirms that another customer's analysis exists.
--
-- Retention
--   `expires_at` holds the configurable retention deadline. A worker sweep deletes analyses past
--   their expiry (and the cascade removes candidates/hops/auth rows). `analysis_status` records
--   pending/complete/failed so the UI can show honest state rather than guessing.
--
-- Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

-- ---------------------------------------------------------------------------------------------
-- 1. Analyses — one row per customer-submitted email
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_forensic_analyses (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  analysis_reference varchar(64) NOT NULL,
  original_filename varchar(255) NULL,
  message_id varchar(512) NULL,
  subject varchar(1000) NULL,
  sender varchar(320) NULL,
  sender_domain varchar(255) NULL,
  recipient varchar(320) NULL,
  received_at timestamptz NULL,
  analysis_status varchar(32) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT email_forensic_analyses_status_check CHECK (
    analysis_status IN ('pending', 'complete', 'failed')
  ),
  CONSTRAINT email_forensic_analyses_reference_check CHECK (length(analysis_reference) BETWEEN 8 AND 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_forensic_analyses_reference_unique_idx
  ON email_forensic_analyses (analysis_reference);

-- Customer's own history, newest first.
CREATE INDEX IF NOT EXISTS email_forensic_analyses_user_idx
  ON email_forensic_analyses (user_id, created_at DESC);

-- Retention sweep target.
CREATE INDEX IF NOT EXISTS email_forensic_analyses_expires_idx
  ON email_forensic_analyses (expires_at)
  WHERE analysis_status <> 'failed';

-- ---------------------------------------------------------------------------------------------
-- 2. Source IP candidates — every IP found in the headers, classified
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_forensic_ip_candidates (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES email_forensic_analyses (id) ON DELETE CASCADE,
  ip_address varchar(128) NOT NULL,
  ip_version varchar(8) NOT NULL,
  source_header varchar(128) NOT NULL,
  hop_number integer NULL,
  address_class varchar(32) NOT NULL,
  trust_classification varchar(32) NOT NULL,
  confidence_level varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_forensic_ip_candidates_ip_version_check CHECK (
    ip_version IN ('ipv4', 'ipv6')
  ),
  CONSTRAINT email_forensic_ip_candidates_address_class_check CHECK (
    address_class IN ('private', 'reserved', 'loopback', 'multicast', 'public', 'unavailable')
  ),
  CONSTRAINT email_forensic_ip_candidates_trust_class_check CHECK (
    trust_classification IN ('trusted_receiving_server', 'unverified_upstream', 'private_internal', 'public_candidate', 'hidden_unavailable')
  ),
  CONSTRAINT email_forensic_ip_candidates_confidence_check CHECK (
    confidence_level IN ('high', 'medium', 'low', 'none')
  )
);

CREATE INDEX IF NOT EXISTS email_forensic_ip_candidates_analysis_idx
  ON email_forensic_ip_candidates (analysis_id);

CREATE INDEX IF NOT EXISTS email_forensic_ip_candidates_public_idx
  ON email_forensic_ip_candidates (analysis_id, address_class)
  WHERE address_class = 'public';

-- ---------------------------------------------------------------------------------------------
-- 3. Route hops — reconstructed Received-header chain
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_forensic_route_hops (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES email_forensic_analyses (id) ON DELETE CASCADE,
  hop_number integer NOT NULL,
  hostname varchar(512) NULL,
  ip_address varchar(128) NULL,
  received_timestamp timestamptz NULL,
  tls_information varchar(1000) NULL,
  header_source text NOT NULL,
  trust_classification varchar(32) NOT NULL,
  anomaly_flag varchar(64) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_forensic_route_hops_trust_class_check CHECK (
    trust_classification IN ('verified_receiving_server', 'unverified_upstream', 'private_network_hop', 'public_network_hop', 'origin_ip_unavailable')
  )
);

CREATE INDEX IF NOT EXISTS email_forensic_route_hops_analysis_idx
  ON email_forensic_route_hops (analysis_id, hop_number);

-- ---------------------------------------------------------------------------------------------
-- 4. Authentication results — SPF / DKIM / DMARC as reported vs independently checked
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_forensic_auth_results (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES email_forensic_analyses (id) ON DELETE CASCADE,
  authentication_type varchar(16) NOT NULL,
  reported_result varchar(32) NULL,
  independently_verified boolean NOT NULL DEFAULT false,
  explanation text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_forensic_auth_results_auth_type_check CHECK (
    authentication_type IN ('spf', 'dkim', 'dmarc', 'return_path', 'reply_to', 'message_id', 'tls')
  ),
  CONSTRAINT email_forensic_auth_results_reported_check CHECK (
    reported_result IS NULL OR reported_result IN (
      'pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror',
      'present_not_verified', 'missing', 'malformed', 'unavailable'
    )
  )
);

CREATE INDEX IF NOT EXISTS email_forensic_auth_results_analysis_idx
  ON email_forensic_auth_results (analysis_id, authentication_type);

-- ---------------------------------------------------------------------------------------------
-- 5. Local IP intelligence database versions
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_forensic_database_versions (
  id uuid PRIMARY KEY,
  database_provider varchar(128) NOT NULL,
  database_name varchar(255) NOT NULL,
  version varchar(64) NULL,
  last_updated_at timestamptz NULL,
  status varchar(32) NOT NULL DEFAULT 'not_configured',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_forensic_database_versions_status_check CHECK (
    status IN ('not_configured', 'available', 'outdated', 'error', 'disabled')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS email_forensic_database_versions_provider_unique_idx
  ON email_forensic_database_versions (database_provider);

-- ---------------------------------------------------------------------------------------------
-- 6. Audit logs for the forensics feature
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_forensic_audit_logs (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  analysis_id uuid NULL REFERENCES email_forensic_analyses (id) ON DELETE SET NULL,
  action varchar(128) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_forensic_audit_logs_user_idx
  ON email_forensic_audit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS email_forensic_audit_logs_analysis_idx
  ON email_forensic_audit_logs (analysis_id);
