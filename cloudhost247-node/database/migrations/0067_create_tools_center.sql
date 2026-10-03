-- Migration: 0067_create_tools_center.sql
-- Purpose: CloudHost247 Network & Developer Tools Center — the persistence layer for the native
-- DNS/IP/network/developer/webmaster/security/domain/productivity tool platform.
--
-- Design invariants (spec: CLOUDHOST247 — NATIVE DNS, IP, NETWORK & DEVELOPER TOOLS PLATFORM):
--  - No existing table is duplicated. The Tools Center READS the real platform tables (users,
--    roles/user_roles, customer_domains, dns_zones/dns_records, servers, ssl_certificates,
--    support_tickets, audit_logs, platform_settings, notification_outbox, ai_* if present) and
--    these tables only store what has no existing home: the tool registry overrides, provider
--    and resolver registries, execution/history/favorite/report state, short-lived diagnostic
--    cache and monitoring state.
--  - Provider credentials are AES-256-GCM envelopes produced by src/lib/crypto.ts. A plaintext
--    secret column does not exist in this schema by design.
--  - tool_execution_logs is append-only. tool_history is customer-visible and deletable.
--  - Nothing here fabricates data: a tool whose provider row is missing or disabled resolves to
--    CONFIGURATION_REQUIRED / SERVICE_UNAVAILABLE at read time (src/tools/core/registry.ts).
--  - All seeds are idempotent (ON CONFLICT DO NOTHING) so operator edits survive re-deploys.

-- ---------------------------------------------------------------------------------------------
-- 1. Tool categories (spec §3/§63). Seeded with the nine platform categories; operators may add
--    more or rename descriptions, but the seeded slugs are what the frontend groups by.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_categories (
  id uuid PRIMARY KEY,
  slug varchar(48) NOT NULL,
  name varchar(96) NOT NULL,
  description text NOT NULL DEFAULT '',
  icon varchar(48) NOT NULL DEFAULT 'tools',
  sort_order integer NOT NULL DEFAULT 100,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_categories_slug_unique_idx ON tool_categories (slug);

-- ---------------------------------------------------------------------------------------------
-- 2. Tool definition overrides (spec §60/§65/§72).
--    The canonical catalogue (name, description, category, capability requirements, default
--    limits) lives in code at src/tools/catalog.ts so API routes and the SPA cannot drift. This
--    table stores ONLY the operator override layer: enable/disable, maintenance, visibility,
--    rate-limit profile, timeout, cache duration, provider binding and feature flags. The
--    effective definition is `catalogue ⊕ override` (src/tools/core/registry.ts) — a row only
--    exists for a tool an operator has actually touched.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_definitions (
  id uuid PRIMARY KEY,
  slug varchar(96) NOT NULL,
  name varchar(160) NULL,
  category varchar(48) NULL,
  description text NULL,
  -- NULL = inherit the catalogue default.
  enabled boolean NULL,
  -- 'public' | 'customer' | 'admin'
  visibility varchar(16) NULL,
  -- Explicit operator state; NULL = derive from enabled/provider/capability.
  -- 'ACTIVE' | 'DISABLED' | 'MAINTENANCE' | 'CONFIGURATION_REQUIRED' | 'SERVICE_UNAVAILABLE'
  status_override varchar(24) NULL,
  maintenance_message text NULL,
  provider_slug varchar(64) NULL,
  -- 'light' | 'standard' | 'heavy' | 'restricted'  (-> src/tools/core/rate-limit.ts profiles)
  rate_limit_profile varchar(24) NULL,
  timeout_ms integer NULL,
  cache_seconds integer NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Structured abuse thresholds; validated on write by the admin route.
  abuse_thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  logging_enabled boolean NULL,
  updated_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_definitions_visibility_check CHECK (
    visibility IS NULL OR visibility IN ('public', 'customer', 'admin')
  ),
  CONSTRAINT tool_definitions_status_check CHECK (
    status_override IS NULL OR status_override IN (
      'ACTIVE','DISABLED','MAINTENANCE','CONFIGURATION_REQUIRED','SERVICE_UNAVAILABLE'
    )
  ),
  CONSTRAINT tool_definitions_profile_check CHECK (
    rate_limit_profile IS NULL OR rate_limit_profile IN ('light','standard','heavy','restricted')
  ),
  CONSTRAINT tool_definitions_timeout_check CHECK (timeout_ms IS NULL OR (timeout_ms >= 250 AND timeout_ms <= 60000)),
  CONSTRAINT tool_definitions_cache_check CHECK (cache_seconds IS NULL OR (cache_seconds >= 0 AND cache_seconds <= 86400))
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_definitions_slug_unique_idx ON tool_definitions (slug);

-- ---------------------------------------------------------------------------------------------
-- 3. External provider registry (spec §21 blacklist registry, §61 APIs & Integrations).
--    Every credential is an encrypted envelope; `configuration` holds non-secret options only.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_provider_configs (
  id uuid PRIMARY KEY,
  slug varchar(64) NOT NULL,
  name varchar(160) NOT NULL,
  -- DNSBL | GEOLOCATION | RDAP | WHOIS | BLACKLIST_API | DKIM_VERIFY | BIN | OCR | REVERSE_IP |
  -- AVAILABILITY | SERP | AI | OBJECT_STORAGE | SPEED_TEST | OTHER
  kind varchar(32) NOT NULL,
  description text NOT NULL DEFAULT '',
  endpoint varchar(512) NULL,
  enabled boolean NOT NULL DEFAULT false,
  needs_credentials boolean NOT NULL DEFAULT true,
  encrypted_api_key text NULL,
  encrypted_api_secret text NULL,
  -- Non-secret options: zone names, query templates, headers, parameters, ipv6 support flags…
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer NOT NULL DEFAULT 5000,
  rate_limit_per_minute integer NOT NULL DEFAULT 30,
  priority integer NOT NULL DEFAULT 100,
  health_status varchar(24) NOT NULL DEFAULT 'UNKNOWN',
  health_detail text NULL,
  last_checked_at timestamptz NULL,
  last_success_at timestamptz NULL,
  last_failure_at timestamptz NULL,
  last_error text NULL,
  quota_note text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_provider_kind_check CHECK (kind IN (
    'DNSBL','GEOLOCATION','RDAP','WHOIS','BLACKLIST_API','DKIM_VERIFY','BIN','OCR',
    'REVERSE_IP','AVAILABILITY','SERP','AI','OBJECT_STORAGE','SPEED_TEST','OTHER'
  )),
  CONSTRAINT tool_provider_health_check CHECK (
    health_status IN ('UNKNOWN','HEALTHY','DEGRADED','DOWN','CONFIGURATION_REQUIRED','DISABLED')
  ),
  CONSTRAINT tool_provider_timeout_check CHECK (timeout_ms >= 250 AND timeout_ms <= 30000),
  CONSTRAINT tool_provider_rate_check CHECK (rate_limit_per_minute >= 1 AND rate_limit_per_minute <= 6000)
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_provider_configs_slug_unique_idx ON tool_provider_configs (slug);
CREATE INDEX IF NOT EXISTS tool_provider_configs_kind_idx ON tool_provider_configs (kind, enabled);

-- ---------------------------------------------------------------------------------------------
-- 4. DNS resolver registry (spec §66). Real public resolvers, seeded disabled-by-exception:
--    every seeded row below is a publicly documented recursive resolver address. `country`,
--    `region` and `city` describe the operator's published registration/announced location for
--    the address — most of these are ANYCAST, so the physical datacentre that answers a given
--    query can be elsewhere. The propagation UI states this explicitly; it never claims the
--    location is where the answer was actually produced.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_resolvers (
  id uuid PRIMARY KEY,
  name varchar(96) NOT NULL,
  provider varchar(120) NOT NULL,
  ip_address varchar(64) NOT NULL,
  -- UDP | TCP | DOT | DOH
  protocol varchar(8) NOT NULL,
  version varchar(8) NOT NULL,
  country varchar(64) NULL,
  country_code char(2) NULL,
  region varchar(96) NULL,
  city varchar(96) NULL,
  latitude numeric(9,6) NULL,
  longitude numeric(9,6) NULL,
  -- DOH rows store the HTTPS template here; DOT/UDP/TCP rows may leave it NULL.
  endpoint varchar(255) NULL,
  anycast boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  health_status varchar(24) NOT NULL DEFAULT 'UNKNOWN',
  health_detail text NULL,
  last_checked_at timestamptz NULL,
  last_latency_ms integer NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_resolvers_protocol_check CHECK (protocol IN ('UDP','TCP','DOT','DOH')),
  CONSTRAINT tool_resolvers_version_check CHECK (version IN ('IPv4','IPv6')),
  CONSTRAINT tool_resolvers_health_check CHECK (
    health_status IN ('UNKNOWN','HEALTHY','DEGRADED','DOWN','DISABLED')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_resolvers_unique_idx ON tool_resolvers (ip_address, protocol);

-- ---------------------------------------------------------------------------------------------
-- 5. Execution log (append-only, spec §56/§82) and customer history (spec §56).
--    `target` is a redacted, human-readable label (domain/IP/URL host) — never a credential,
--    never a full URL query string, never email contents.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_execution_logs (
  id uuid PRIMARY KEY,
  tool_slug varchar(96) NOT NULL,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  actor_role varchar(32) NULL,
  ip_address varchar(64) NULL,
  target varchar(255) NULL,
  -- SUCCESS | ERROR | RATE_LIMITED | BLOCKED | CONFIGURATION_REQUIRED | SERVICE_UNAVAILABLE |
  -- TIMEOUT | INVALID_INPUT
  status varchar(32) NOT NULL,
  code varchar(48) NULL,
  duration_ms integer NULL,
  cache_hit boolean NOT NULL DEFAULT false,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_execution_logs_slug_idx ON tool_execution_logs (tool_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_execution_logs_user_idx ON tool_execution_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_execution_logs_created_idx ON tool_execution_logs (created_at DESC);

CREATE TABLE IF NOT EXISTS tool_history (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tool_slug varchar(96) NOT NULL,
  target varchar(255) NULL,
  status varchar(32) NOT NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_history_user_idx ON tool_history (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 6. Favorites (spec §57) and saved diagnostic reports (spec §77).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_favorites (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tool_slug varchar(96) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_favorites_unique_idx ON tool_favorites (user_id, tool_slug);

CREATE TABLE IF NOT EXISTS tool_reports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tool_slug varchar(96) NOT NULL,
  tool_name varchar(160) NOT NULL,
  target varchar(255) NOT NULL,
  status varchar(32) NOT NULL,
  -- The exact result payload the user saw, with credential-shaped keys already stripped by
  -- src/tools/core/redact.ts before insert.
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_reports_user_idx ON tool_reports (user_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 7. Rate limiting + abuse detection (spec §68/§70). Fixed-window counters keyed by
--    (scope, scope_id, tool, window_start). @fastify/rate-limit still protects the HTTP surface
--    globally; this table enforces the per-account/per-tool diagnostics budget that survives
--    process restarts and works across cPanel Passenger workers.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_rate_limits (
  scope varchar(16) NOT NULL,
  scope_id varchar(128) NOT NULL,
  tool_slug varchar(96) NOT NULL,
  window_start timestamptz NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, scope_id, tool_slug, window_start),
  CONSTRAINT tool_rate_limits_scope_check CHECK (scope IN ('ip','user','account','tool'))
);
CREATE INDEX IF NOT EXISTS tool_rate_limits_window_idx ON tool_rate_limits (window_start);

CREATE TABLE IF NOT EXISTS tool_abuse_events (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  ip_address varchar(64) NULL,
  tool_slug varchar(96) NOT NULL,
  kind varchar(48) NOT NULL,
  detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_abuse_events_created_idx ON tool_abuse_events (created_at DESC);
CREATE INDEX IF NOT EXISTS tool_abuse_events_ip_idx ON tool_abuse_events (ip_address, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 8. Optional short-lived diagnostic cache (spec §67). Only non-sensitive, publicly repeatable
--    lookups are ever cached; cache duration per tool comes from the catalogue/override, and
--    hidden ("view report") keys are never written for authenticated-only payloads.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_cache (
  cache_key varchar(200) PRIMARY KEY,
  tool_slug varchar(96) NOT NULL,
  value jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_cache_expiry_idx ON tool_cache (expires_at);

-- ---------------------------------------------------------------------------------------------
-- 9. Provider / resolver health history (spec §83/§84).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_health_checks (
  id uuid PRIMARY KEY,
  subject_type varchar(16) NOT NULL,
  subject_slug varchar(96) NOT NULL,
  status varchar(24) NOT NULL,
  latency_ms integer NULL,
  detail text NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_health_checks_subject_check CHECK (subject_type IN ('provider','resolver'))
);
CREATE INDEX IF NOT EXISTS tool_health_checks_subject_idx ON tool_health_checks (subject_slug, checked_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 10. Propagation runs (spec §4 / §65 dns_check_results). One row per user-initiated run; the
--     per-resolver answers live in `results` so a run is a single atomic artifact that can be
--     exported or attached to a support ticket.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_propagation_runs (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  domain varchar(253) NOT NULL,
  record_type varchar(16) NOT NULL,
  expected_value text NULL,
  match_mode varchar(16) NOT NULL DEFAULT 'exact',
  status varchar(24) NOT NULL,
  status_message text NULL,
  resolvers_queried integer NOT NULL DEFAULT 0,
  resolvers_answered integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_propagation_match_check CHECK (match_mode IN ('exact','contains','regex')),
  CONSTRAINT tool_propagation_status_check CHECK (
    status IN ('PROPAGATED','PARTIAL','NOT_PROPAGATED','INCONCLUSIVE','ERROR')
  )
);
CREATE INDEX IF NOT EXISTS tool_propagation_runs_user_idx ON tool_propagation_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_propagation_runs_domain_idx ON tool_propagation_runs (domain, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 11. Monitoring (spec §85 SSL expiry, §86 DNS change, §87 email configuration). The sweep in
--     src/worker/tools-sweep.ts evaluates these and notifies through the EXISTING notification
--     system (src/services/notification-service.ts) — never a second notification stack.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tool_monitors (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind varchar(24) NOT NULL,
  target varchar(255) NOT NULL,
  record_type varchar(16) NULL,
  expected_value text NULL,
  match_mode varchar(16) NOT NULL DEFAULT 'exact',
  enabled boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz NULL,
  last_status varchar(24) NOT NULL DEFAULT 'UNKNOWN',
  last_value text NULL,
  last_detail text NULL,
  -- Notified thresholds already sent (e.g. SSL: {"30":true,"14":true}) so a customer receives
  -- each threshold once per certificate lifetime, not once per sweep.
  notified jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_monitors_kind_check CHECK (kind IN ('SSL_EXPIRY','DNS_RECORD','EMAIL_CONFIG')),
  CONSTRAINT tool_monitors_match_check CHECK (match_mode IN ('exact','contains','regex'))
);
CREATE INDEX IF NOT EXISTS tool_monitors_user_idx ON tool_monitors (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tool_monitors_due_idx ON tool_monitors (enabled, last_checked_at);

CREATE TABLE IF NOT EXISTS tool_monitor_events (
  id uuid PRIMARY KEY,
  monitor_id uuid NOT NULL REFERENCES tool_monitors (id) ON DELETE CASCADE,
  status varchar(24) NOT NULL,
  previous_value text NULL,
  current_value text NULL,
  detail text NOT NULL DEFAULT '',
  notified_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tool_monitor_events_monitor_idx ON tool_monitor_events (monitor_id, created_at DESC);

-- ---------------------------------------------------------------------------------------------
-- 12. Seeds.
-- ---------------------------------------------------------------------------------------------

-- 12a. Categories.
INSERT INTO tool_categories (id, slug, name, description, icon, sort_order) VALUES
  (gen_random_uuid(), 'dns',        'DNS Tools',              'Query, validate and monitor DNS records, DNSSEC, and email authentication.', 'globe',        10),
  (gen_random_uuid(), 'ip',         'IP Tools',               'Look up IP ownership, reverse DNS, WHOIS and network ranges.',              'ip',           20),
  (gen_random_uuid(), 'network',    'Network Tools',          'Reachability, latency, ports, subnets and ASN information.',                'network',      30),
  (gen_random_uuid(), 'developer',  'Developer Tools',        'HTTP, TLS, SMTP, JSON, encoding and URL utilities for engineers.',          'code',         40),
  (gen_random_uuid(), 'webmaster',  'Webmaster & SEO Tools',  'Crawlability, link health, social previews and search appearance.',         'browser',      50),
  (gen_random_uuid(), 'security',   'Security Tools',         'Certificates, blacklists, password hygiene and card BIN data.',             'shield',       60),
  (gen_random_uuid(), 'domain',     'Domain Tools',           'IDN conversion, availability and registrar integration.',                   'at',           70),
  (gen_random_uuid(), 'productivity','Productivity Tools',    'QR codes, text utilities, colour conversion and time tracking.',            'grid',         80),
  (gen_random_uuid(), 'diagnostics','Diagnostics & Monitoring','Saved reports, scheduled monitoring and domain health centres.',           'activity',     90)
ON CONFLICT (slug) DO NOTHING;

-- 12b. Resolver registry. Every address below is a publicly documented recursive resolver.
--      `priority` orders the propagation sweep (lower = queried earlier).
INSERT INTO tool_resolvers
  (id, name, provider, ip_address, protocol, version, country, country_code, region, city, latitude, longitude, endpoint, anycast, enabled, priority) VALUES
  (gen_random_uuid(), 'Cloudflare 1.1.1.1',   'Cloudflare',      '1.1.1.1',              'UDP', 'IPv4', 'Australia',    'AU', 'New South Wales',   'Sydney',      -33.868820, 151.209290, NULL, true, true,  10),
  (gen_random_uuid(), 'Cloudflare 1.0.0.1',   'Cloudflare',      '1.0.0.1',              'UDP', 'IPv4', 'United States', 'US', 'California',        'Los Angeles', 34.052230, -118.243680, NULL, true, true,  11),
  (gen_random_uuid(), 'Cloudflare DoH',       'Cloudflare',      '1.1.1.1',              'DOH', 'IPv4', 'Australia',    'AU', 'New South Wales',   'Sydney',      -33.868820, 151.209290, 'https://cloudflare-dns.com/dns-query', true, true, 12),
  (gen_random_uuid(), 'Cloudflare DoT',       'Cloudflare',      '1.1.1.1',              'DOT', 'IPv4', 'Australia',    'AU', 'New South Wales',   'Sydney',      -33.868820, 151.209290, 'tls://1.1.1.1:853', true, true, 13),
  (gen_random_uuid(), 'Cloudflare 1.1.1.1 v6','Cloudflare',      '2606:4700:4700::1111','UDP', 'IPv6', 'Australia',    'AU', 'New South Wales',   'Sydney',      -33.868820, 151.209290, NULL, true, true,  14),
  (gen_random_uuid(), 'Google 8.8.8.8',       'Google Public DNS','8.8.8.8',             'UDP', 'IPv4', 'United States', 'US', 'California',       'Mountain View', 37.386051, -122.083855, NULL, true, true, 20),
  (gen_random_uuid(), 'Google 8.8.4.4',       'Google Public DNS','8.8.4.4',             'UDP', 'IPv4', 'United States', 'US', 'California',       'Mountain View', 37.386051, -122.083855, NULL, true, true, 21),
  (gen_random_uuid(), 'Google DoH',           'Google Public DNS','8.8.8.8',             'DOH', 'IPv4', 'United States', 'US', 'California',       'Mountain View', 37.386051, -122.083855, 'https://dns.google/dns-query', true, true, 22),
  (gen_random_uuid(), 'Google DoT',           'Google Public DNS','8.8.8.8',             'DOT', 'IPv4', 'United States', 'US', 'California',       'Mountain View', 37.386051, -122.083855, 'tls://8.8.8.8:853', true, true, 23),
  (gen_random_uuid(), 'Google 2001:4860:4860::8888','Google Public DNS','2001:4860:4860::8888','UDP','IPv6','United States','US','California','Mountain View',37.386051,-122.083855, NULL, true, true, 24),
  (gen_random_uuid(), 'Quad9 9.9.9.9',        'Quad9',           '9.9.9.9',              'UDP', 'IPv4', 'Switzerland',  'CH', 'Zurich',           'Zurich',       47.376888,   8.541694, NULL, true, true, 30),
  (gen_random_uuid(), 'Quad9 149.112.112.112','Quad9',           '149.112.112.112',      'UDP', 'IPv4', 'Switzerland',  'CH', 'Zurich',           'Zurich',       47.376888,   8.541694, NULL, true, true, 31),
  (gen_random_uuid(), 'Quad9 DoH',            'Quad9',           '9.9.9.9',              'DOH', 'IPv4', 'Switzerland',  'CH', 'Zurich',           'Zurich',       47.376888,   8.541694, 'https://dns.quad9.net/dns-query', true, true, 32),
  (gen_random_uuid(), 'Quad9 2620:fe::fe',    'Quad9',           '2620:fe::fe',          'UDP', 'IPv6', 'Switzerland',  'CH', 'Zurich',           'Zurich',       47.376888,   8.541694, NULL, true, true, 33),
  (gen_random_uuid(), 'OpenDNS 208.67.222.222','Cisco OpenDNS',  '208.67.222.222',       'UDP', 'IPv4', 'United States','US', 'California',        'San Francisco',37.774929, -122.419418, NULL, true, true, 40),
  (gen_random_uuid(), 'OpenDNS 208.67.220.220','Cisco OpenDNS',  '208.67.220.220',       'UDP', 'IPv4', 'United States','US', 'California',        'San Francisco',37.774929, -122.419418, NULL, true, true, 41),
  (gen_random_uuid(), 'AdGuard DNS',          'AdGuard',         '94.140.14.14',         'UDP', 'IPv4', 'Latvia',       'LV', 'Riga',             'Riga',         56.949650,  24.105186, NULL, true, true, 50),
  (gen_random_uuid(), 'AdGuard DNS 2',        'AdGuard',         '94.140.15.15',         'UDP', 'IPv4', 'Latvia',       'LV', 'Riga',             'Riga',         56.949650,  24.105186, NULL, true, true, 51),
  (gen_random_uuid(), 'DNS.WATCH',            'DNS.WATCH',       '84.200.69.80',         'UDP', 'IPv4', 'Germany',      'DE', 'Hesse',            'Frankfurt',    50.110924,   8.682127, NULL, false, true, 60),
  (gen_random_uuid(), 'DNS.WATCH 2',          'DNS.WATCH',       '84.200.70.40',         'UDP', 'IPv4', 'Germany',      'DE', 'Hesse',            'Frankfurt',    50.110924,   8.682127, NULL, false, true, 61),
  (gen_random_uuid(), 'CleanBrowsing Security','CleanBrowsing',  '185.228.168.9',        'UDP', 'IPv4', 'United States','US', 'Delaware',          'Wilmington',   39.744690,  -75.548752, NULL, true, true, 70),
  (gen_random_uuid(), 'Comodo Secure DNS',    'Comodo',          '8.26.56.26',           'UDP', 'IPv4', 'United States','US', 'New Jersey',        'Clifton',      40.858433,  -74.163757, NULL, true, true, 80),
  (gen_random_uuid(), 'Level3 4.2.2.1',       'Lumen/Level3',    '4.2.2.1',              'UDP', 'IPv4', 'United States','US', 'Colorado',          'Denver',       39.739235, -104.990250, NULL, true, true, 90),
  (gen_random_uuid(), 'Yandex DNS',           'Yandex',          '77.88.8.8',            'UDP', 'IPv4', 'Russia',       'RU', 'Moscow',           'Moscow',       55.755826,  37.617300, NULL, true, true, 100),
  (gen_random_uuid(), 'Verisign Public DNS',  'Verisign',        '64.6.64.6',            'UDP', 'IPv4', 'United States','US', 'Virginia',          'Reston',       38.958630,  -77.357002, NULL, true, true, 110)
ON CONFLICT (ip_address, protocol) DO NOTHING;

-- 12c. Blacklist providers (spec §21). These are REAL DNS-based blocklists. Public recursive
--      resolvers are frequently refused by these zones (several require the querying resolver to
--      be registered/paid), and this platform reports that honestly: a refused query is
--      ERROR/UNKNOWN, never "not listed". A blank DNS response is reported as "not listed by
--      this provider" only when the zone answered authoritatively.
INSERT INTO tool_provider_configs
  (id, slug, name, kind, description, endpoint, enabled, needs_credentials, configuration, rate_limit_per_minute, priority) VALUES
  (gen_random_uuid(), 'spamhaus-zen', 'Spamhaus ZEN', 'DNSBL',
   'Combined Spamhaus SBL+XBL+PBL zone. Query may be refused for public resolvers — see provider documentation.',
   'zen.spamhaus.org', true, false, '{"supportsIpv6": true, "listingReasonCodes": {"2":"SBL","3":"SBL CSS","4":"XBL CBL","5":"XBL CSS","6":"XBL PBL","7":"XBL PBL ISP","9":"SBL DROP","10":"XBL PBL","11":"XBL PBL ISP"}}'::jsonb, 10, 10),
  (gen_random_uuid(), 'spamcop', 'SpamCop Blocking List', 'DNSBL',
   'SpamCop SCBL. Reports a listing reason in the returned TXT record where the zone provides one.',
   'bl.spamcop.net', true, false, '{"supportsIpv6": false}'::jsonb, 10, 20),
  (gen_random_uuid(), 'sorbs', 'SORBS DNSBL', 'DNSBL',
   'SORBS aggregate zone (open relays, proxies, spam sources).',
   'dnsbl.sorbs.net', true, false, '{"supportsIpv6": false}'::jsonb, 10, 30),
  (gen_random_uuid(), 'uceprotect-level1', 'UCEPROTECT Level 1', 'DNSBL',
   'UCEPROTECT L1 — single-IP spam sources.', 'dnsbl-1.uceprotect.net', true, false, '{"supportsIpv6": false}'::jsonb, 10, 40),
  (gen_random_uuid(), 'spfbl', 'SPFBL', 'DNSBL',
   'SPFBL network reputation blocklist.', 'dnsbl.spfbl.net', false, false, '{"supportsIpv6": true}'::jsonb, 10, 50),
  (gen_random_uuid(), 'blocklist-de', 'blocklist.de', 'DNSBL',
   'blocklist.de attack-source list.', 'bl.blocklist.de', false, false, '{"supportsIpv6": true}'::jsonb, 10, 60),
  (gen_random_uuid(), 'barracuda', 'Barracuda Central', 'DNSBL',
   'Requires the querying resolver to be registered with Barracuda before it answers; enable only after registration.',
   'b.barracudacentral.org', false, false, '{"supportsIpv6": false, "requiresRegistration": true}'::jsonb, 10, 70),
  (gen_random_uuid(), 'ip-geolocation', 'IP geolocation provider', 'GEOLOCATION',
   'Optional external geolocation/ASN enrichment for IP tools. CloudHost247 ships no bundled geolocation database, so without this provider IP tools report ASN/country from the free DNS-based Team Cymru lookup and mark city/latitude/longitude NOT_CONFIGURED.',
   NULL, false, true, '{"requiredFor": ["city","region","timezone","latitude","longitude"], "supportsIpv6": true}'::jsonb, 30, 100),
  (gen_random_uuid(), 'reverse-ip', 'Reverse-IP data provider', 'REVERSE_IP',
   'Optional provider for reverse-IP (domains on an IP) lookups. No public DNS mechanism exists for this, so the tool returns CONFIGURATION_REQUIRED until an operator supplies an endpoint.',
   NULL, false, true, '{"responseShape": "text-or-json", "instructions": "Set endpoint to a provider URL that accepts an IP and returns the hosted hostnames."}'::jsonb, 10, 110),
  (gen_random_uuid(), 'bin-lookup', 'BIN/IIN data provider', 'BIN',
   'Optional issuer-identification provider for the BIN checker. CloudHost247 never accepts or stores a full card number — only a 6-8 digit BIN/IIN.',
   NULL, false, true, '{"acceptedInput": "6-8 digit BIN", "notes": "Endpoint must accept the BIN as a path/query parameter."}'::jsonb, 20, 120),
  (gen_random_uuid(), 'scan-ocr', 'Image-to-text (OCR) provider', 'OCR',
   'Optional OCR provider for the Image → Text tool. Uploaded images are sent only to the configured provider and are never written to platform storage.',
   NULL, false, true, '{"maxUploadBytes": 4194304, "acceptedTypes": ["image/png","image/jpeg","image/webp"]}'::jsonb, 5, 130),
  (gen_random_uuid(), 'dkim-verify', 'External DKIM verifier', 'DKIM_VERIFY',
   'Optional external DKIM signature verifier used by the SMTP tester to confirm a message actually validates. Without it, the DKIM checker validates the published record only, and says so.',
   NULL, false, true, '{}'::jsonb, 10, 140)
ON CONFLICT (slug) DO NOTHING;

-- 12d. Platform settings used by the Tools Center (read through src/db/ops-tables.ts).
INSERT INTO platform_settings (key, value, description) VALUES
  ('tools.enabled', 'true', 'Master switch for the Network & Developer Tools Center'),
  ('tools.anonymous_access', 'true', 'Whether signed-out visitors may run public tools'),
  ('tools.abuse_block_threshold', '25', 'Rate-limit/abuse rejections within an hour before an IP is temporarily blocked from diagnostic tools'),
  ('tools.abuse_block_minutes', '60', 'How long a temporarily blocked IP stays blocked'),
  ('tools.speed_test_max_bytes', '20971520', 'Maximum bytes transferred by a single speed-test measurement'),
  ('tools.speed_test_max_ms', '15000', 'Maximum duration of a single speed-test measurement'),
  ('tools.monitor_sweep_batch', '25', 'Number of due monitors evaluated per worker cycle'),
  ('tools.resolver_health_batch', '6', 'Number of DNS resolvers health-checked per worker cycle')
ON CONFLICT (key) DO NOTHING;
