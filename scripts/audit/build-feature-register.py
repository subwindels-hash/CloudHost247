#!/usr/bin/env python3
"""Build the CloudHost247 / Hostinger feature-parity register.

Phase 1 deliverable. This is a *curated* register, not a scraper: every row records what the
repository actually contains (with a path), what is missing, which external provider would be
needed, and how the feature would be accepted. Statuses are the six the project owner specified;
nothing is marked "Complete and verified" because a page, menu item or button exists.

Run:  python3 scripts/audit/build-feature-register.py
Out:  docs/feature-parity-register.csv  (QUOTE_ALL; safe to open in any spreadsheet)
"""
from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs' / 'feature-parity-register.csv'

HEADER = [
    'id', 'workstream', 'hostinger_capability', 'description',
    'cloudhost247_equivalent', 'status',
    'missing_backend', 'missing_frontend',
    'required_integrations_providers', 'dependencies_and_risks',
    'testing_and_acceptance_criteria', 'evidence',
]

NOCRED = 'Vault credentials + provider sandbox account; none configured; activation needs explicit authorisation'
NOPROD = 'Migrations 0023/0024/0025/0041 quarantined in cloudhost247-node/database/migrate.ts; no production DDL authorised'
STAGE = 'cPanel staging BLOCKED: no cPanel host or credentials'
V = 'Phase 1 run: docs/PHASE-1-VERIFICATION.md'
AD = 'docs/ACCEPTANCE-CRITERIA.md; docs/NODE_PLATFORM_STATUS.md'

STATUS = {
    'VER': 'Complete and verified',
    'IMP': 'Implemented but not fully verified',
    'PROG': 'In progress',
    'BLK': 'Blocked by external provider',
    'NONE': 'Not implemented',
    'NA': 'Not applicable',
}

rows: list[list[str]] = []


def R(id_: str, ws: str, cap: str, desc: str, equiv: str, code: str,
      mb: str = '', mf: str = '', integ: str = '', risks: str = '',
      tests: str = '', evid: str = V) -> None:
    rows.append([id_, ws, cap, desc, equiv, STATUS[code], mb, mf, integ, risks, tests, evid])


def GROUP(ws: str, desc: str, integ: str, risks: str, tests: str, evid: str,
          items: list[tuple]) -> None:
    """items: (id, capability, equivalent, code, missing_backend, missing_frontend)"""
    for t in items:
        padded = (list(t) + [''] * 6)[:6]
        id_, cap, equiv, code, mb, mf = padded
        R(id_, ws, cap, desc, equiv, code, mb, mf, integ, risks, tests, evid)


# ----------------------------------------------------------------------------- A: Hosting
GROUP('A Hosting', 'Hosting product ecosystem',
      'WHMCS product catalogue; cPanel/WHM; infrastructure provider adapters',
      NOPROD + '; no production prices; no provider credentials',
      'Matching vitest/PHP suite + honest catalogue-state test; never fabricate a price or a provisioning success',
      V, [
    ('A01', 'Shared web hosting',
     'Catalog products/plans/pricing/features (migrations 0004-0007); public catalog API; 55 generated marketing pages; PHP product pages',
     'IMP', 'No order-to-provisioning hand-off for shared hosting; catalog holds no published prices by default',
     'Pricing cards show honest loading/empty/no-price states; preview uses scripts/seed-preview-catalog.ts demo rows only'),
    ('A02', 'WordPress hosting & managed WordPress',
     'Marketing page + catalog family only; WP Toolkit is control-panel capability metadata',
     'NONE', 'No install/update/clone/stage/migrate API or worker; no WP-CLI bridge', 'No customer WP management UI'),
    ('A03', 'Cloud hosting', 'Catalog family + generated pages', 'IMP',
     'No cloud-specific provisioning/resource isolation backend', 'No comparison/pricing truthfulness beyond shared catalog'),
    ('A04', 'VPS hosting',
     'OS catalog (0041/0048/0051); 13 infrastructure adapters; provisioning jobs; reinstall/rescue/snapshot/console/resize; server-agent',
     'IMP',
     'P0 FIXED 2026-11-07: shared DB UUID contract (src/lib/identifier-contract.ts) accepts deterministic seeded ids without weakening shape validation; 12 route-touching test files / 71 tests pass. Live provider provisioning still unverified.',
     'Order form now returns 201 for a real seeded OS id; no live provider confirmation yet'),
    ('A05', 'Dedicated servers',
     'modules/servers/soyoustart/ + cloudhost247_ovh/ (addon + server); signed OVH API client; catalog import; reverse DNS',
     'IMP', 'Source-complete; live API mutations never staged', 'Admin + client views exist'),
    ('A06', 'Agency & reseller hosting',
     'Marketing page + reseller capability flags in 18 control-panel adapters', 'NONE',
     'No agency account model; no client/team tables or role scoping', 'No agency dashboard'),
    ('A07', 'Node.js application hosting',
     'Deployments domain (0029-0033, 0035); app installations; agent protocol; worker; compose generator', 'IMP',
     'Real deployment requires a connected server-agent; none registered here', 'AdminDeploymentsPage / AppInstancePage / MyAppsPage'),
    ('A08', 'PHP hosting',
     'php_version_switch capability flag in control-panel adapters; generated PHP marketing page', 'NONE',
     'No PHP config API; HONESTY RISK: src/control-panels/adapters/base.ts returns success:true from stub methods without provider calls (not wired to routes)',
     'No customer PHP settings screen'),
    ('A09', 'Email hosting',
     'modules/servers/cloudhost247_email_hosting/ (M365 / Google Workspace / Professional Email providers)', 'IMP',
     'Provider mutations require credentials; no live provision', 'WHMCS client views; no Node customer email UI'),
    ('A10', 'Business email', 'Same as A09 + WHMCS Smtphosting vendor module', 'BLK',
     'Live mailbox creation not exercised', 'Webmail not integrated'),
    ('A11', 'SSL certificates',
     'ssl_certificates table (0045); src/routes/ssl.ts CRUD + audit; autoRenew field', 'IMP',
     'No ACME client / no CA integration; issuance and renewal are record-only', 'SslManagementPage lists certificates; no issuance workflow'),
    ('A12', 'Domain registration & transfers',
     'src/domain-services/registration-service.ts + transfer-service.ts; GoDaddy/Namecheap/RDAP adapters; fail-closed registry', 'BLK',
     'Adapters implemented but no registrar credentials; no live availability/price/register call made',
     'Domain search/transfer/whois/extensions pages show honest unconfigured state'),
    ('A13', 'DNS management',
     'dns_zones/dns_records (0044); src/routes/dns.ts; src/dns/propagation.ts Cloudflare/Route53 fail-closed', 'VER',
     'None for internal zones; external zones need vault credentials', 'DnsManagementPage + admin views'),
    ('A14', 'Dedicated IP addresses', 'Capability metadata only; no allocation table', 'NONE',
     'No IP allocation/reconciliation service', 'No UI'),
    ('A15', 'Website migration', 'No migration service found', 'NONE',
     'No migration job; no source connector; no integrity verification', 'No wizard'),
])

R('A16', 'A Hosting', 'Preserve WHMCS + provisioning workflows',
  'Existing integrations must keep working',
  '23 addon modules; 14 server modules; 2 themes; 3 order forms; 84 root PHP pages; 838 PHP lint targets clean',
  'VER', 'None identified in syntax/structure; runtime behaviour needs licensed WHMCS core', 'n/a',
  'Licensed WHMCS 8.x core (absent from repo)',
  'WHMCS core and DB absent in sandbox; scripts/php-wasm/php used for syntax only',
  'bash scripts/php-lint-targets.sh | xargs scripts/php-wasm/php -l; python3 -m unittest tests/*',
  V + ' (838/838 lint clean on PHP 8.2 wasm)')

# ----------------------------------------------------------------------------- B: Builder
GROUP('B Builder', 'Website and application builder',
      'Approved LLM provider (AI_LLM_* env or vault); DNS + CA for custom domains',
      NOCRED + '; two builder implementations exist (Node + WHMCS) — architecture decision required',
      'tests/integration/platform-services-api.test.ts; tests/builder/run.php; negative validation tests',
      V, [
    ('B01', 'AI website builder (functional output)',
     'src/builders/ai/generation-service.ts; ledger 0073; rules-provider + OpenAI/Anthropic-compatible llm-provider; /api/v1/ai-builder/*; generation applied into real builder_pages',
     'IMP', 'External LLM unconfigured (fail-closed CONFIGURATION_REQUIRED); deterministic engine works',
     'AiBuilderPage; no section editor in Node SPA'),
    ('B02', 'Drag-and-drop website editor',
     'WHMCS modules/addons/cloudhost247_builder has drag/template/css support; Node builder has none', 'IMP',
     'Node sections API has no drag ordering endpoint', 'Node SPA has no visual canvas; WHMCS editor is PHP/Smarty'),
    ('B03', 'Professional website templates',
     'src/builders/templates.ts + /api/v1/builder/templates; WHMCS builder template library', 'IMP',
     'Template quality bar not audited', 'Template picker exists'),
    ('B04', 'Responsive page builder',
     'Section schema + published rendering /api/v1/public/sites/:slug/pages/:path', 'IMP',
     'No browser viewport verification (Chromium unavailable)', 'CSS media queries in design system'),
    ('B05', 'Landing-page builder', 'Generic page creation only; no landing preset', 'NONE',
     'No preset/goal workflow', 'No dedicated UI'),
    ('B06', 'Ecommerce website builder',
     'Separate online store (0074; src/store/store-service.ts; /api/v1/public/stores/:slug) — not integrated with builder pages',
     'IMP', 'No builder widget that embeds store products', 'StorefrontPage / StorePage are separate from builder sites'),
    ('B07', 'Blog & CMS functionality', 'No post/content model; builder pages only', 'NONE',
     'No posts/taxonomies/revisions beyond page revisions', 'No blog UI'),
    ('B08', 'Custom HTML/CSS/JS support',
     'WHMCS builder custom_css with validator; Node section whitelist forbids arbitrary script', 'IMP',
     'Node builder has no validated custom-code field', 'No code editor in Node SPA'),
    ('B09', 'Custom domain connection', 'No DNS/domain binding for builder sites', 'NONE',
     'No domain-to-site binding table or TLS automation', 'No UI'),
    ('B10', 'Website preview', 'WHMCS builder hashed expiring draft preview; Node builder has no separate preview endpoint',
     'IMP', 'Node builder draft preview missing', 'No preview button in Node SPA'),
    ('B11', 'One-click publishing',
     'src/routes/builder.ts publish/unpublish/publications; publication snapshot; /api/v1/public/sites/:slug', 'VER',
     'None', 'Publish controls in WHMCS builder; Node publish API available'),
    ('B12', 'Website cloning', 'No clone operation in Node builder', 'NONE',
     'No transactional clone of site+pages+media', 'No UI'),
    ('B13', 'Website staging', 'No staging concept (0 occurrences in both builders)', 'NONE',
     'No staging tables/workflow', 'No UI'),
    ('B14', 'Website migration in builder', 'No import service', 'NONE', 'No importer/validator', 'No UI'),
    ('B15', 'Backups & restoration',
     'server-agent/src/backups.js + backup-contents tests; app-instance backups with safety snapshots (0068-0070); no builder-site backup',
     'IMP', 'Builder-site backup/restore not wired', 'Backups tab exists for app instances only'),
    ('B16', 'Version history',
     'src/builders/site-service.ts listRevisions/getRevision/restoreRevision; /revisions routes', 'VER',
     'None for Node builder', 'Revision routes exposed; WHMCS builder revision screens'),
    ('B17', 'Website performance insights', 'No per-site analytics beyond store analytics and AI-OS findings', 'NONE',
     'No metrics collector for published sites', 'No dashboard'),
    ('B18', 'Public site actually served',
     '/api/v1/public/sites/:slug + /pages/:path; builder-page.php?slug= (WHMCS)', 'VER',
     'None', 'PublicSitePage'),
])

# ----------------------------------------------------------------------------- C: AI
GROUP('C AI', 'AI tools and automation',
      'Approved LLM provider; AI_LLM_BASE_URL / API_KEY / MODEL / API_STYLE',
      NOCRED + '; src/ai-os/models/router.ts fails closed with CONFIGURATION_REQUIRED; no silent fallback',
      'tests/integration/ai-control-plane.test.ts; tests/unit/ai-control-plane.test.ts; platform-services-api.test.ts',
      V, [
    ('C01', 'AI website creation', 'B01 generation service + rules/LLM providers', 'IMP',
     'See B01', 'AiBuilderPage'),
    ('C02', 'AI content generation', 'Only inside site plan generation; no standalone content API', 'NONE',
     'No content-generation endpoint with quotas', 'No UI'),
    ('C03', 'AI coding assistance', 'No coding assistant; AI-OS copilot intents cover platform operations only', 'NONE',
     'No code LLM route', 'No UI'),
    ('C04', 'AI website troubleshooting', 'src/services/ai-support-operator.ts + AI-OS diagnostic agents', 'IMP',
     'Deterministic handlers only; external engines seeded disabled', 'AdminAiCommandPage / AiAssistantPage'),
    ('C05', 'AI SEO recommendations', 'AI-OS agent catalog contains SEO agents; no site-crawl data source', 'IMP',
     'No crawler/sitemap analysis feeding recommendations', 'No dedicated SEO UI'),
    ('C06', 'AI image & design assistance', 'ai_site_image_suggestions stores search_terms/descriptions; no image generation', 'NONE',
     'No image provider; no generated assets', 'No UI'),
    ('C07', 'AI email marketing assistance', 'No LLM-backed campaign writer; WHMCS marketing has templates/visual builder', 'NONE',
     'No campaign generation route', 'No UI'),
    ('C08', 'AI customer support',
     'src/services/ai-support-operator.ts; ai-support routes; admin agent console; knowledge store', 'IMP',
     'Deterministic engine; no external LLM configured', 'AiSupportWidget in App shell; AdminAiSupportPage'),
    ('C09', 'AI hosting diagnostics', 'AI-OS agents + server/monitoring tool catalog', 'IMP',
     'Read-only against real data; no provider mutations', 'AdminAiCommandPage'),
    ('C10', 'AI-assisted migration / WordPress management', 'No implementation', 'NONE',
     'No migration or WP agent tools', 'No UI'),
])
R('C11', 'C AI', 'Usage limits; permissions; cost controls; audit logs',
  'Governance for all AI use',
  'src/builders/entitlements.ts DB-counted monthly allowance; ai_site_generations ledger; src/ai-os/permissions.ts; audit-repo; approvals-repo; fail-closed model router',
  'VER', 'Per-token cost accounting not implemented (no external model in use)',
  'Admin AI settings/console', 'LLM provider for cost data',
  'No silent fallback; unconfigured engine returns CONFIGURATION_REQUIRED',
  'platform-services-api.test.ts + ai-control-plane.test.ts (both passed)', V)

# ----------------------------------------------------------------------------- D: Control panel
GROUP('D Control panel', 'Customer hosting control panel (hPanel equivalent)',
      'WHM/cPanel UAPI; provider vault',
      STAGE + '; ' + NOCRED,
      'Matching vitest file + negative permission test; no fabricated success',
      V + '; ' + AD, [
    ('D01', 'Hosting overview', 'DashboardPage + ServicesPage + API-backed tiles', 'VER', '', 'Dashboard with quick actions'),
    ('D02', 'Website management', 'Builder sites/pages API (B11/B16)', 'IMP',
     'No unified website list joined to hosting service', 'Website list is builder-only'),
    ('D03', 'Domain management', 'customer_domains (0009); domains routes; DomainsPage', 'VER',
     'Live registrar ops blocked (A12)', 'Domain list/detail'),
    ('D04', 'DNS records', 'A13 DNS zones/records', 'VER', 'External provider credentials', 'DnsManagementPage'),
    ('D05', 'SSL management', 'A11 certificate record CRUD', 'IMP', 'No issuance/renewal', 'SslManagementPage'),
    ('D06', 'File manager', 'Only capability flag in control-panel adapters', 'NONE',
     'No file API; base adapter stub returns success:true', 'No UI'),
    ('D07', 'FTP/SFTP accounts', 'Only capability flags', 'NONE', 'No account API', 'No UI'),
    ('D08', 'Database management', 'Only capability flags', 'NONE', 'No DB API', 'No UI'),
    ('D09', 'PHP version & configuration', 'Only capability flags', 'NONE', 'No config API', 'No UI'),
    ('D10', 'Cron jobs', 'Only capability flags', 'NONE', 'No cron API', 'No UI'),
    ('D11', 'Email accounts', 'Only capability flags in Node; WHMCS email server module exists', 'BLK',
     'Provider credentials', 'No Node UI'),
    ('D12', 'Email forwarding', 'No Node implementation', 'NONE', 'No forwarder API', 'No UI'),
    ('D13', 'SPF/DKIM/DMARC management', 'TXT record support in DNS API only (no guided auth setup)', 'NONE',
     'No email-auth validator/publisher', 'No UI'),
    ('D14', 'Backups & restoration', 'App-instance backups via server-agent; safety snapshots', 'IMP',
     'No customer self-service restore for hosting accounts', 'Backups tab on app instances'),
    ('D15', 'Staging environments', 'None', 'NONE', 'No staging service', 'No UI'),
    ('D16', 'Website cloning', 'None in Node', 'NONE', 'No clone API', 'No UI'),
    ('D17', 'Application deployment', 'Deployments + app installations + worker', 'IMP',
     'Needs connected server-agent', 'AppInstancePage / AdminDeploymentsPage'),
    ('D18', 'Resource usage', 'server_metrics table (0039); monitoring routes; provider metrics adapters', 'IMP',
     'No live provider metrics', 'AdminMonitoringPage'),
    ('D19', 'Bandwidth & storage monitoring', 'server_metrics + provider metrics truth tests', 'IMP',
     'No live provider metrics', 'No customer chart'),
    ('D20', 'Security status', 'Audit logs (0038); MFA/passkeys; security headers; no aggregate score', 'IMP',
     'No unified security-status service', 'No customer security hub'),
    ('D21', 'Billing & invoices', 'invoices/ledger/payments (0018-0025); billing routes; customer + admin portals', 'IMP',
     NOPROD + '; webhooks frozen', 'BillingPage/InvoicesPage/InvoiceDetailPage'),
    ('D22', 'Support tickets', 'support_tickets/messages (0010-0011); SupportPage; admin ticket console', 'VER', '', 'SupportPage/SupportTicketPage'),
    ('D23', 'Subscription management', 'subscriptions (0037, 0079) + platform plans', 'IMP',
     'No live renewal scheduler verified', 'No dedicated subscription UI'),
    ('D24', 'cPanel reuse rather than rebuild', 'WHM/cPanel vault providers + 18 control-panel catalogue adapters', 'BLK',
     'No live WHM/cPanel API call exercised', 'ControlPanelDetailPage is catalogue/capability view'),
])

# ----------------------------------------------------------------------------- E: VPS
GROUP('E VPS', 'VPS and server management',
      'Hetzner/OVH/Contabo/DO/Vultr/AWS/OpenStack/Proxmox/SolusVM/Virtualizor/Generic HTTP adapters',
      NOCRED + '; ' + NOPROD + '; never simulate successful provisioning',
      'tests/integration/server-*.test.ts; tests/unit/provider-capability-truth.test.ts; undeclared-adapter-fail-closed.test.ts',
      V, [
    ('E01', 'VPS deployment', 'Server order -> payment -> provisioning job -> provider adapter', 'IMP',
     'P0 fixed (real seeded OS id now reaches 201 AWAITING_PAYMENT with zero provider jobs); no provider credentials', 'NewServerPage'),
    ('E02', 'Operating-system selection', 'operating_system_versions/images (0041/0048/0051); image resolver + shared DB UUID contract', 'IMP',
     'Seeded ids now satisfy the API contract; live provider image verification still pending', 'OperatingSystemSelector'),
    ('E03', 'Server provisioning', 'src/infrastructure/services/server-provisioner.ts; serialize ops (0052); fail-closed registry', 'IMP',
     'No provider confirmation in this environment', 'AdminProvisioningPage'),
    ('E04', 'Server monitoring', 'server_metrics; health-checker; reconciliation (0050)', 'VER',
     'Live metrics need provider', 'AdminMonitoringPage'),
    ('E05', 'Reboot & shutdown controls', 'queueOwnedAction + adapter operations', 'VER',
     'Live action needs provider', 'ServerDetailPage'),
    ('E06', 'Resource monitoring', 'provider metrics adapters with truth tests', 'IMP', 'No live provider', 'AdminMonitoringPage'),
    ('E07', 'SSH access information', 'customer_ssh_keys + access info generation', 'VER', '', 'ServerDetailPage'),
    ('E08', 'Firewall configuration', 'firewall_rules (0046); src/routes/firewall.ts', 'VER',
     'No upstream firewall sync', 'No dedicated customer firewall UI'),
    ('E09', 'Snapshot management', 'Adapter snapshot create/restore/delete + safety snapshot (0069)', 'IMP',
     'No provider confirmation', 'ServerDetailPage Snapshots tab'),
    ('E10', 'Backup management', 'backups (0036, 0068-0070); server-agent backups.js', 'IMP',
     'No live provider backup', 'Backups tab'),
    ('E11', 'Reverse DNS', 'PTR record type in DNS schema; OVH module has reverse DNS', 'IMP',
     'No dedicated rDNS workflow', 'No UI'),
    ('E12', 'IP management', 'provider getServerIP; no allocation/reconciliation table', 'NONE', 'No IP inventory', 'No UI'),
    ('E13', 'Server reinstall workflows', 'reinstallServer/rebuildServer adapters + acceptance tests', 'IMP',
     'P0 fixed: cross-customer reinstall now returns 404 rather than a 400 validation error; live provider reinstall unverified', 'ServerDetailPage'),
    ('E14', 'Application deployment & Docker', 'deployments + docker-enabled server flags; server-agent/docker.js', 'IMP',
     'Needs connected agent', 'AppInstancePage'),
    ('E15', 'Server security monitoring', 'firewall + audit + agent attestation', 'IMP',
     'No continuous detection pipeline', 'No customer view'),
])

# ----------------------------------------------------------------------------- F: Security
GROUP('F Security', 'Security and reliability',
      'Cloudflare; certificate authority; monitoring providers; SMTP for alerts',
      NOCRED + '; never advertise protection/uptime/backup coverage before verification',
      'ssl-firewall-api.test.ts; totp-mfa.test.ts; passkeys.test.ts; tests/website/test_catalogue_honesty.py',
      V + '; ' + AD, [
    ('F01', 'Free and paid SSL management', 'A11 certificate record CRUD', 'IMP',
     'No CA/ACME issuance or paid certificate order', 'SslManagementPage'),
    ('F02', 'Malware scanning', 'No file scanning service; tools/security has URL-level SSL/DNS checks only', 'NONE',
     'No scanner/engine', 'No UI'),
    ('F03', 'Website security monitoring', 'Audit logs + security headers; no site uptime/integrity monitor', 'NONE',
     'No monitor', 'No UI'),
    ('F04', 'Backup scheduling', 'Backups + worker leases; no customer-facing schedule config', 'IMP',
     'No schedule CRUD', 'No UI'),
    ('F05', 'On-demand backups', 'Backup engine + safety snapshot', 'IMP', 'No live provider', 'Backups tab'),
    ('F06', 'Disaster recovery', 'No DR runbook implementation or drill', 'NONE', 'No failover orchestration', 'No UI'),
    ('F07', 'Website restoration', 'App-instance restore; no hosting-site restore', 'IMP', 'No live provider', 'Backups tab'),
    ('F08', 'Account security', 'Auth + revoked tokens + audit log (0001-0003, 0022)', 'VER', '', 'AccountPage'),
    ('F09', 'Two-factor authentication', 'TOTP (0060) + recovery codes', 'VER', '', 'MFA login flow'),
    ('F10', 'Passkeys', 'WebAuthn (0061/0062); WHMCS cloudhost247_passkey addon', 'VER', '', 'Login/Account flow'),
    ('F11', 'Login notifications', 'No implementation found', 'NONE', 'No notification trigger', 'No UI'),
    ('F12', 'Session management', 'JWT + revoked tokens + logout; no device/session list', 'IMP',
     'No session enumeration/revocation UI', 'No UI'),
    ('F13', 'Abuse reporting', 'abuse@ references only', 'NONE', 'No intake/workflow', 'No UI'),
    ('F14', 'DDoS protection', 'Documented provider capability only', 'BLK', 'No provider-side rule management', 'No UI'),
    ('F15', 'CDN integration', 'Cloudflare integration + zones/analytics/features (0055)', 'BLK',
     'No Cloudflare credentials', 'AdminCloudflarePage'),
    ('F16', 'Security event logs', 'audit_logs (0038); auditRequest; AI-OS audit repo', 'VER', '', 'AdminAuditPage'),
    ('F17', 'Customer security alerts', 'notification outbox (0049) + notification centre', 'IMP',
     'No security-alert rule engine', 'NotificationsPage'),
    ('F18', 'No unverified protection claims', 'Catalogue honesty tests + fail-closed adapters', 'VER', '', 'Catalogue state banners'),
])

# ----------------------------------------------------------------------------- G: Email
GROUP('G Email', 'Email and marketing',
      'M365/Google Workspace/cPanel SMTP; mail provider; LLM provider',
      NOCRED + '; consent + unsubscribe + anti-abuse required before any send',
      'docs/independent-rebuild/EMAIL-MARKETING.md sessions 1-12; WHMCS marketing PHP suites',
      V + '; ' + AD, [
    ('G01', 'Professional business email', 'WHMCS email hosting module + Smtphosting vendor', 'BLK',
     'No live mailbox', 'No Node UI'),
    ('G02', 'Email account creation', 'Module create path exists', 'BLK', 'No provider confirmation', 'No Node UI'),
    ('G03', 'Webmail access', 'No webmail integration', 'NONE', 'No SSO/roundcube bridge', 'No UI'),
    ('G04', 'SMTP configuration', 'Vault smtp / cpanel_smtp providers; IntegrationClient/SmtpClient', 'IMP',
     'No live send in this environment', 'Admin integrations screen'),
    ('G05', 'SPF/DKIM/DMARC management', 'TXT records via DNS API only', 'NONE',
     'No guided DKIM key generation/publish', 'No UI'),
    ('G06', 'Email forwarding', 'No Node implementation', 'NONE', 'No forwarder API', 'No UI'),
    ('G07', 'Mailing lists', 'WHMCS cloudhost247_marketing lists/subscribers/segments', 'IMP',
     'PHP behaviour not re-run in Phase 1', 'Admin marketing screens'),
    ('G08', 'Email campaign builder', 'WHMCS marketing templates + block builder', 'IMP',
     'No AI copywriting', 'Admin marketing screens'),
    ('G09', 'Campaign templates', 'WHMCS marketing builtin template library', 'IMP',
     'Sanitizer verified per module docs', 'Admin screens'),
    ('G10', 'Contact & subscriber management', 'WHMCS marketing subscribers/tags/import/export/suppression', 'IMP',
     'CSV formula hardening delivered', 'Admin screens'),
    ('G11', 'Campaign scheduling', 'crons/cloudhost247_marketing.php; UTC state machine + queue worker', 'IMP',
     'Cron not scheduled in this environment', 'Admin screens'),
    ('G12', 'Delivery analytics', 'WHMCS marketing AnalyticsService (ledger-only rates; click map)', 'IMP',
     'No live delivery data', 'Analytics screen'),
    ('G13', 'Bounce & unsubscribe handling', 'cloudhost247-marketing-track.php; DSN; RFC 8058 one-click', 'IMP',
     'Live DSN ingestion not exercised', 'Tracking endpoint'),
    ('G14', 'Marketing integrations', 'No first-party Google Ads/Analytics/Meta Pixel connector', 'NONE',
     'No OAuth connector or pixel API', 'No UI'),
    ('G15', 'Consent management', 'WHMCS marketing suppression + consent references', 'IMP',
     'No country-specific legal consent model', 'No UI'),
    ('G16', 'Anti-abuse controls', 'SmtpTransport sender-domain policy; link-scheme checks; platform rate limiting', 'IMP',
     'No deliverability reputation monitoring', 'n/a'),
    ('G17', 'AI email marketing assistance', 'No LLM-backed campaign writer', 'NONE', 'No LLM route', 'No UI'),
    ('G18', 'Email marketing API for customers', 'No Node customer campaign API', 'NONE', 'No route', 'No UI'),
])

# ----------------------------------------------------------------------------- H: Ecommerce
GROUP('H Ecommerce', 'Ecommerce and business tools',
      'Payment gateways; analytics/social APIs',
      'FINANCIAL FREEZE: no gateway activation without authorisation; ' + NOCRED,
      'tests/integration/platform-services-api.test.ts + frontend/tests/unit/tools-integration.test.tsx (passed)',
      V, [
    ('H01', 'Ecommerce website creation', 'Online store (0074) separate from builder', 'IMP',
     'No builder integration', 'StorePage/StorefrontPage'),
    ('H02', 'Product catalogue management', '/api/v1/store/stores/:id/products; inventory; digital delivery', 'VER', '', 'StorePage'),
    ('H03', 'Shopping cart integration', 'Commerce cart (0014-0017); store public orders', 'VER', '', 'CartPage'),
    ('H04', 'Payment gateway integrations', 'WHMCS gateways (Blockonomics) + sandbox payment abstraction; store payment webhook', 'BLK',
     'Live gateways not activated', 'PaymentModal'),
    ('H05', 'Order management', 'Store orders + fulfil/cancel; commerce orders', 'VER', '', 'StorePage/AdminInvoicesPage'),
    ('H06', 'Store analytics', 'Store overview admin endpoint; no funnel analytics', 'IMP',
     'No analytics pipeline', 'Admin store overview'),
    ('H07', 'Custom domains for stores', 'No domain binding', 'NONE', 'No binding', 'No UI'),
    ('H08', 'Website marketing tools', 'marketing-services routes; logo maker; experts', 'IMP',
     'No external connectors', 'Platform hub pages'),
    ('H09', 'Analytics integrations', 'No first-party GA/GTM connector', 'NONE', 'No OAuth/consent layer', 'No UI'),
    ('H10', 'Google & social marketing integrations', 'No connectors', 'NONE', 'No connectors', 'No UI'),
    ('H11', 'Business tools suite', '79+ online tools; Tools Center; MRZ; business tools', 'VER', '', 'ToolsCenterPage/ToolPage'),
])

# ----------------------------------------------------------------------------- I: Domains
GROUP('I Domains', 'Domains and DNS',
      'GoDaddy/Namecheap/Gandi registrar APIs; Cloudflare/Route53 DNS',
      NOCRED + '; all domain operations must connect to a real registrar API',
      'tests/integration/domain-services-api.test.ts (passed); tests/security/test_domain_data_provenance.py; E2 sandbox round trip',
      V, [
    ('I01', 'Domain search', 'src/domain-services/search-service.ts + RDAP; fail-closed', 'BLK',
     'No registrar credentials', 'domains/SearchPage'),
    ('I02', 'Domain registration', 'registration-service + transactions', 'BLK', 'No live register call', 'Search/Transfer pages'),
    ('I03', 'Domain transfers', 'transfer-service', 'BLK', 'No live transfer call', 'TransferPage'),
    ('I04', 'Domain renewals', 'customer_domains expiry; no renewal job', 'NONE', 'No renewal scheduler', 'DomainsPage'),
    ('I05', 'Domain pricing', 'extensions-service reads enabled provider offerings; no TLD price literals', 'BLK',
     'No provider price feed', 'ExtensionsPage'),
    ('I06', 'WHOIS privacy', 'No implementation', 'NONE', 'No registrar privacy op', 'No UI'),
    ('I07', 'DNS zone management', 'A13 DNS zones/records', 'VER', 'External zone needs vault', 'DnsManagementPage'),
    ('I08', 'Nameserver management', 'NS records via DNS API; no registrar nameserver update', 'IMP',
     'No registrar call', 'DnsManagementPage'),
    ('I09', 'Domain locking', 'No implementation', 'NONE', 'No registrar lock op', 'No UI'),
    ('I10', 'Domain contact management', 'No implementation', 'NONE', 'No contact model', 'No UI'),
    ('I11', 'Expiry notifications', 'availability watches (0065) + notification outbox', 'IMP',
     'No domain expiry rule verified', 'NotificationsPage'),
    ('I12', 'Automatic renewal controls', 'subscriptions model exists; no domain autorenew toggle', 'NONE',
     'No toggle/backend', 'No UI'),
])

# ----------------------------------------------------------------------------- J: Agency
GROUP('J Agency', 'Agency and reseller hosting',
      'WHMCS reseller; cPanel reseller account',
      STAGE + '; RBAC isolation is a security boundary; do not duplicate H/J work',
      'frontend/tests/unit/admin-rbac.test.tsx (passed) + new agency isolation negative tests',
      V, [
    ('J01', 'Multiple client accounts', 'No agency model', 'NONE', 'No agency tables; no tenant scoping', 'No agency UI'),
    ('J02', 'Client access management', 'No delegated access model', 'NONE', 'No delegation', 'No UI'),
    ('J03', 'Website access sharing', 'No sharing model', 'NONE', 'No sharing', 'No UI'),
    ('J04', 'Reseller packages', 'Capability flags only', 'NONE', 'No package model', 'No UI'),
    ('J05', 'Resource allocation', 'Server allocation exists for admin; no agency quotas', 'NONE', 'No quotas', 'No UI'),
    ('J06', 'Client billing support', 'WHMCS client billing exists; no agency-level billing', 'NONE', 'No agency ledger', 'No UI'),
    ('J07', 'White-label branding', 'No white-label; branding audit enforces a single brand', 'NONE', 'No theming model', 'No UI'),
    ('J08', 'Website management for clients', 'Builder sites are per-user only', 'NONE', 'No cross-account access', 'No UI'),
    ('J09', 'Client activity monitoring', 'Audit log exists but is not agency-scoped', 'NONE', 'No scoped view', 'No UI'),
    ('J10', 'Team collaboration', 'No team/invite model; roles are staff roles only', 'NONE', 'No invites', 'No UI'),
    ('J11', 'Role-based permissions', 'users/roles (0027); requireRole; admin-rbac.test.tsx', 'VER', '', 'Admin console'),
])

# ----------------------------------------------------------------------------- K: Support
GROUP('K Support', 'Customer support and knowledge base',
      'Chat provider; email/SMTP; status provider',
      NOCRED + '; 24/7 support must not be promised without staffing',
      'tests/unit/ai-support-operator.test.ts + frontend/tests/unit/support-pages.test.tsx (passed)',
      V, [
    ('K01', '24/7 support workflows', 'No staffing model; must not advertise 24/7', 'NA',
     'No rota/escalation policy', 'No UI'),
    ('K02', 'Support tickets', 'support_tickets + messages; customer + admin consoles', 'VER', '', 'SupportPage/AdminTicketsPage'),
    ('K03', 'Live chat integration', 'No live chat', 'NONE', 'No chat service', 'No widget'),
    ('K04', 'Knowledge base', '13 generated docs + FAQ pages; no searchable KB product', 'IMP',
     'No search index or KB API', 'DocsPages/FaqPage'),
    ('K05', 'Searchable tutorials', 'No tutorial search', 'NONE', 'No index', 'No UI'),
    ('K06', 'Service status page', '/api/v1/public/status + /status route', 'IMP',
     'Status derived from DB check; no incident feed', 'Status linked in footer'),
    ('K07', 'Incident notifications', 'Notification outbox exists; no incident model', 'NONE',
     'No incident record/publish', 'No UI'),
    ('K08', 'AI support assistant', 'ai-support-operator + widget', 'IMP', 'Deterministic only', 'AiSupportWidget'),
    ('K09', 'Human support escalation', 'Admin AI support console with agent reply', 'IMP',
     'No SLA/routing', 'AdminAiSupportPage'),
    ('K10', 'Customer feedback & announcements', 'AnnouncementBar (5 truthful items); no feedback capture', 'IMP',
     'No feedback store', 'AnnouncementBar'),
])

# ----------------------------------------------------------------------------- L: Billing
GROUP('L Billing', 'Billing and subscriptions',
      'WHMCS billing; payment gateways; tax provider',
      'FINANCIAL FREEZE per PHASE_5_CHECKPOINT_REPORT.md and docs/NODE_PLATFORM_STATUS.md; ' + NOPROD,
      'tests/integration/payments-api.test.ts; billing-api.test.ts; financial-invariant-sweep.test.ts (passed); no live gateway',
      V, [
    ('L01', 'Shopping cart', 'carts/cart_items (0014-0015); commerce-service', 'VER', '', 'CartPage'),
    ('L02', 'Product configuration', 'Plan/pricing snapshots; WHMCS configurable options', 'VER', '', 'CartPage'),
    ('L03', 'Subscription management', 'subscriptions (0037, 0079); platform plans', 'IMP',
     'No renewal scheduler verified', 'No dedicated UI'),
    ('L04', 'Automatic renewals', 'No renewal worker', 'NONE', 'No scheduler', 'No UI'),
    ('L05', 'Invoices', 'invoices (0018); billing routes; printable receipt', 'VER', '', 'InvoicesPage/InvoiceDetailPage'),
    ('L06', 'Payment history', 'payments (0020) + ledger; customer billing page', 'VER', '', 'BillingPage'),
    ('L07', 'Refund workflows', 'Admin refund with append-only ledger + balance capping', 'VER', '', 'AdminInvoicesPage'),
    ('L08', 'Coupons and promotions', 'No coupon engine', 'NONE', 'No schema/route', 'No UI'),
    ('L09', 'Upgrade/downgrade workflows', 'Plan change not implemented', 'NONE', 'No proration', 'No UI'),
    ('L10', 'Service suspension & reactivation', 'Server suspend/terminate/unsuspend admin ops; no billing-driven suspension', 'IMP',
     'No automated dunning', 'Admin UI'),
    ('L11', 'Payment notifications', 'Notification outbox; webhook events table', 'IMP', 'Webhooks frozen', 'NotificationsPage'),
    ('L12', 'Tax & regional billing support', 'No tax model; tax-rate rows exist only in store', 'NONE',
     'No jurisdiction/rate engine', 'No UI'),
])

# ----------------------------------------------------------------------------- GX: Global
GROUP('GX Global', 'Global customer experience',
      'Geolocation service; ECB/Frankfurter rates; regional payment methods',
      NOCRED + '; display-only conversion must disclose the USD charge (brief section 3)',
      'frontend/tests/unit/currency-display.test.ts; currency-geo-fallback.test.tsx; tests/integration/display-fx.test.ts; currency-geo-hint.test.ts (all passed)',
      V, [
    ('GX01', 'Country detection', '/api/v1/currency/geo-country returns country:null by design', 'NONE',
     'No geolocation service; trusted-proxy validation not wired', 'CurrencySwitcher stays USD'),
    ('GX02', 'Currency & price formatting', 'BASE_CURRENCY USD; display_fx_rates (0083); display-currency.ts; Intl formatting', 'VER',
     'Display-only conversions; billing stays USD', 'CurrencySwitcher'),
    ('GX03', 'Language where translations exist', '13 reviewed locales + i18n message catalogues', 'VER', '', 'LanguageSwitcher'),
    ('GX04', 'Regional content', 'No regional content variants', 'NONE', 'No region content model', 'No UI'),
    ('GX05', 'Country-appropriate payment methods', 'No region-to-method mapping', 'NONE', 'No gateway selection', 'No UI'),
    ('GX06', 'Date & number formatting', 'Intl-based frontend/src/i18n/format.ts', 'VER', '', 'Global'),
    ('GX07', 'Regional contact/support info', 'No regional contact data', 'NONE', 'No data', 'ContactPage is generic'),
    ('GX08', 'Country-specific legal & tax info', '19 legal policies; no jurisdiction variants', 'NONE',
     'No jurisdiction engine', 'LegalPages'),
    ('GX09', 'Canonical price + honest FX disclosure',
     'display_fx_rates snapshot from WHMCS currency addon (ECB/Frankfurter); rate timestamp; USD-charge disclosure', 'IMP',
     'NGN and other target currencies not enabled; rounding rules documented but not independently re-verified',
     'Rate disclaimer in switcher'),
    ('GX10', 'Currency consistency across surfaces', 'CurrencyProvider + formatAmountInDisplayCurrency in catalog/pricing/cart/billing', 'IMP',
     'Not verified end-to-end on checkout/invoices (no live gateway)', 'Partial'),
])

# ----------------------------------------------------------------------------- W: Website
GROUP('W Website', 'Website redesign',
      'Static assets generated by scripts/site/generate.mjs',
      'Browser visual verification BLOCKED (no Chromium binary); ' + STAGE,
      'node scripts/site/generate.mjs --check; check-links.mjs; verify-website.py; hostinger-chrome.test.tsx; hostinger-homepage.test.tsx',
      V, [
    ('W01', 'Homepage', 'HomePage.tsx Hostinger-style funnel + hg-shell', 'VER', '', ''),
    ('W02', 'Product landing pages', '55 generated marketing pages; 67 registered PHP pages', 'VER', '', ''),
    ('W03', 'Hosting comparison pages', 'Generated comparison sections; no dedicated comparator tool', 'IMP',
     'No comparison data model', 'Static sections'),
    ('W04', 'Pricing pages', '/pricing + live catalog tabs with honest states', 'VER', '', ''),
    ('W05', 'Domain search page', 'domains/SearchPage + domain-services search (fail-closed)', 'BLK',
     'No registrar credentials', 'SearchPage'),
    ('W06', 'VPS & dedicated-server pages', 'HostingVpsPage/HostingDedicatedPage + PHP pages', 'VER', '', ''),
    ('W07', 'Website builder pages', 'platform/BuilderPage + platform/AiBuilderPage', 'VER', '', ''),
    ('W08', 'Business email pages', 'email-hosting.php + registry page', 'VER', '', ''),
    ('W09', 'Security pages', 'SSL/DNS/policy pages; no dedicated security hub', 'IMP', 'No security hub', 'Static pages'),
    ('W10', 'Agency hosting pages', 'Page exists; no product behind it (see J)', 'NONE', 'No agency backend', 'Static page only'),
    ('W11', 'Customer stories', 'Deliberately omitted (no genuine stories)', 'NA', 'n/a', 'n/a'),
    ('W12', 'Knowledge base', '13 generated docs + FAQ; no searchable KB', 'IMP', 'No search index', 'DocsPages'),
    ('W13', 'Contact & support pages', 'ContactPage/SupportPage + PHP contact', 'VER', '', ''),
    ('W14', 'About & company pages', 'AboutPage + aboutus.php', 'VER', '', ''),
    ('W15', 'Legal pages', '19 policies + generated legal index', 'VER', '', ''),
    ('W16', 'Shared chrome (menu/mega/footer)', 'Header.tsx + PlatformMegaMenu.tsx + Footer.tsx + hostinger-chrome.css', 'VER', '', ''),
    ('W17', 'Original design components/illustrations', '49 distinct hero scenes; design system; CSS-only visuals', 'VER', '', ''),
    ('W18', 'Responsive/accessible/SEO structures', 'check-accessibility-contract.py; generator; sitemap/robots; JSON-LD', 'VER',
     'Real-browser half (C4) is PARTIAL', 'Static contract only'),
])

# ----------------------------------------------------------------------------- AR: Architecture
GROUP('AR Architecture', 'Architecture and compatibility',
      'CH247_INTEGRATIONS_KEY + CH247_PLATFORM_ENVIRONMENT vault keys',
      STAGE + '; ' + NOCRED,
      'Generator --check; branding audit; PHP lint; typecheck; build; docs/ACCEPTANCE-CRITERIA.md',
      V, [
    ('AR01', 'Single source of navigation/route registry',
     'shared/site/registry.json -> scripts/site/generate.mjs -> SPA + PHP theme + sitemap', 'VER', '', ''),
    ('AR02', 'Shared design system',
     'shared/site/design-system.css canonical; generator copies to templates/cloudhost247/css/', 'VER', '', ''),
    ('AR03', 'PHP/WHMCS + React/Node consistency',
     'Generator projects nav/footer into both; two separate Node stacks exist', 'IMP',
     'Runtime parity not verified on a WHMCS host', 'Generator-level parity only'),
    ('AR04', 'No second implementation of an existing service',
     'BLOCKER: cloudhost247-node/ (Fastify/TypeScript) and platform/ (zero-dependency Node monolith) are two complete Node platforms; platform/README.md says it replaces cloudhost247-node',
     'IMP', 'DECISION MADE 2026-11-07: cloudhost247-node/ canonical; platform/ frozen read-only (docs/ARCHITECTURE-DECISION-RECORD.md). Convergence still a separate authorised project.',
     'Duplicated SPA surfaces remain; no new feature work in platform/'),
    ('AR05', 'Migration quarantine & payment freeze',
     'QUARANTINED_MIGRATIONS 0023/0024/0025/0041; PR #12 open; webhooks frozen', 'BLK',
     'No production DDL or payment change authorised', 'Admin flows exist but must not be activated'),
    ('AR06', 'cPanel deployment constraints',
     'docs/CPANEL_DEPLOYMENT.md 18-point checklist all unchecked', 'BLK',
     'No cPanel environment or credentials', 'No staging verification possible'),
    ('AR07', 'Provider credential governance',
     'modules/addons/cloudhost247_integrations vault (AES-256-GCM); 108 provider catalogue keys; per-environment config', 'VER', '', ''),
])


def main() -> None:
    bad = [r[0] for r in rows if len(r) != len(HEADER)]
    if bad:
        raise SystemExit(f'rows with wrong column count: {bad}')
    ids = [r[0] for r in rows]
    dupes = [i for i, c in Counter(ids).items() if c > 1]
    if dupes:
        raise SystemExit(f'duplicate ids: {dupes}')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(HEADER)
        w.writerows(rows)
    print(f'wrote {OUT.relative_to(ROOT)}: {len(rows)} features')
    for code, label in STATUS.items():
        print(f'  {label:<38} {sum(1 for r in rows if r[5] == label):>3}')


if __name__ == '__main__':
    main()
