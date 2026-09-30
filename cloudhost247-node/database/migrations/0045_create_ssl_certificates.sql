-- ============================================================================
-- Migration 0045: SSL Certificates Management & ACME Lifecycle
-- ============================================================================

CREATE TABLE IF NOT EXISTS ssl_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id uuid NULL REFERENCES servers(id) ON DELETE SET NULL,
  domain_id uuid NULL REFERENCES customer_domains(id) ON DELETE SET NULL,
  domain_name varchar(255) NOT NULL,
  sans varchar(255)[] NOT NULL DEFAULT ARRAY[]::varchar(255)[],
  issuer varchar(64) NOT NULL DEFAULT 'LETS_ENCRYPT',
  certificate_pem text NULL,
  private_key_encrypted text NULL,
  expires_at timestamptz NULL,
  status varchar(32) NOT NULL DEFAULT 'PENDING',
  challenge_type varchar(32) NOT NULL DEFAULT 'HTTP_01',
  auto_renew boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ssl_certificates_issuer_check CHECK (issuer IN ('LETS_ENCRYPT', 'ZERO_SSL', 'CUSTOM', 'SELF_SIGNED')),
  CONSTRAINT ssl_certificates_status_check CHECK (status IN ('PENDING', 'VALIDATING', 'ISSUED', 'EXPIRED', 'FAILED', 'REVOKED')),
  CONSTRAINT ssl_certificates_challenge_type_check CHECK (challenge_type IN ('HTTP_01', 'DNS_01', 'MANUAL'))
);

CREATE INDEX IF NOT EXISTS ssl_certificates_user_idx ON ssl_certificates (user_id);
CREATE INDEX IF NOT EXISTS ssl_certificates_domain_idx ON ssl_certificates (lower(domain_name));
CREATE INDEX IF NOT EXISTS ssl_certificates_server_idx ON ssl_certificates (server_id);
CREATE INDEX IF NOT EXISTS ssl_certificates_status_idx ON ssl_certificates (status, expires_at);
