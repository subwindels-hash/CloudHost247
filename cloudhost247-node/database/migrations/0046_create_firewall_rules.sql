-- ============================================================================
-- Migration 0046: Server Firewall & Security Baseline Rules
-- ============================================================================

CREATE TABLE IF NOT EXISTS firewall_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  protocol varchar(16) NOT NULL DEFAULT 'tcp',
  port_range_start integer NOT NULL,
  port_range_end integer NOT NULL,
  direction varchar(16) NOT NULL DEFAULT 'INBOUND',
  source_cidr varchar(64) NOT NULL DEFAULT '0.0.0.0/0',
  action varchar(16) NOT NULL DEFAULT 'ALLOW',
  description text NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firewall_rules_protocol_check CHECK (protocol IN ('tcp', 'udp', 'icmp', 'any')),
  CONSTRAINT firewall_rules_direction_check CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  CONSTRAINT firewall_rules_action_check CHECK (action IN ('ALLOW', 'DROP', 'REJECT')),
  CONSTRAINT firewall_rules_status_check CHECK (status IN ('ACTIVE', 'DISABLED', 'APPLYING', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS firewall_rules_server_idx ON firewall_rules (server_id, status);
