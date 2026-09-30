-- ============================================================================
-- Migration 0044: DNS Zones and Authoritative DNS Records Management
-- ============================================================================

CREATE TABLE IF NOT EXISTS dns_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain_name varchar(255) NOT NULL,
  provider varchar(64) NOT NULL DEFAULT 'INTERNAL',
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  nameservers varchar(255)[] NOT NULL DEFAULT ARRAY['ns1.cloudhost247.com', 'ns2.cloudhost247.com']::varchar(255)[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dns_zones_status_check CHECK (status IN ('ACTIVE', 'PENDING', 'SUSPENDED', 'DELETED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS dns_zones_domain_idx ON dns_zones (lower(domain_name));
CREATE INDEX IF NOT EXISTS dns_zones_user_idx ON dns_zones (user_id);

CREATE TABLE IF NOT EXISTS dns_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES dns_zones(id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  type varchar(16) NOT NULL,
  content text NOT NULL,
  ttl integer NOT NULL DEFAULT 3600,
  priority integer NULL,
  proxied boolean NOT NULL DEFAULT false,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dns_records_type_check CHECK (
    type IN ('A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR', 'SOA')
  ),
  CONSTRAINT dns_records_status_check CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE INDEX IF NOT EXISTS dns_records_zone_idx ON dns_records (zone_id);
CREATE INDEX IF NOT EXISTS dns_records_name_type_idx ON dns_records (zone_id, lower(name), type);
