# CloudHost247 Email Marketing Platform — SESSION 0 Repository Audit

Date: 2026-09-29 · Branch: `arena/01a0ee05-cloudhost247` · Scope: native email
marketing + campaign builder inside this WHMCS repository, cPanel SMTP as the
first delivery provider. **No code was modified in this session** — this is the
mandatory audit. Every claim below names the file that proves it.

---

## 1. Existing Functionality (what the repository already has)

| Capability | Where | Notes |
|---|---|---|
| Central credential vault (AES encrypt/decrypt, envelope AAD) | `modules/addons/cloudhost247_integrations/lib/Security/SecretVault.php` | Master key from `CH247_INTEGRATIONS_KEY` env var or WHMCS `$CH247_INTEGRATIONS_KEY` global (`lib/Security/MasterKey.php`); never stored in DB |
| Provider catalog + registry | `…/cloudhost247_integrations/lib/Registry/ProviderCatalog.php`, `ProviderRegistry.php`, `ProviderDefinition.php` | Statically self-loading registry; per-provider `fields` (option/column/secret), `auth` types, `base_url`, `health` checks |
| **SMTP integration type already defined** | ProviderCatalog `messaging()` → key **`smtp`** | host / port / encryption (`tls` = STARTTLS, `ssl` = implicit TLS) / username (column) / password (secret) / from_address; `auth ⇒ type: smtp`; `health ⇒ method: SMTP` |
| **Real SMTP handshake probe** | `…/integrations/lib/Api/SmtpProbe.php` | DNS→TCP→greeting→EHLO→STARTTLS→re-EHLO→AUTH LOGIN→QUIT; explicit `ResultCode` classification (`INVALID_CONFIGURATION`, `PROVIDER_UNAVAILABLE`, `INVALID_ENDPOINT`, …); dialer-injection test seam; **never sends a message, never logs the password** |
| Connection tester | `…/integrations/lib/Services/ConnectionTester.php` | `check(definition, config, secrets)` dispatches `health.method === 'SMTP'` to `checkSmtp()` → `SmtpProbe`; returns `{code, detail, latency_ms}` |
| Integration manager API | `…/integrations/lib/Services/IntegrationManager.php` | `installed()`, `configuration($key)`, `credentials($key)` (decrypted, server-side), `client($key)`, `test($id)`, `recordRuntimeFailure()`, `overview($env)`; rows per `(provider_key, environment)` |
| Environments | `…/integrations/lib/Support/Environment.php` | development/staging/production; defaults to production |
| Result codes | `…/integrations/lib/Support/ResultCode.php` | `connected`, `authentication_failed`, `invalid_endpoint`, `timeout`, `provider_unavailable`, `invalid_configuration`, `permission_denied`, `not_configured`, … + `fromHttpStatus` / `fromTransportKind` |
| Integrations admin UI (configure/test/rotate/events) | `…/integrations/lib/Services/AdminController.php` (+ Services/AdminView) | Deep-linkable: `addonmodules.php?module=cloudhost247_integrations&view=configure&integration=<key>`, `&view=events&provider_key=<key>`; `rotate` op; event log table `mod_cloudhost247_integration_events` |
| Foundation security | `modules/addons/cloudhost247_core/lib/Security/AdminGuard.php` | `requireAdmin()`, `requirePostToken()` (WHMCS CSRF token), `requireCapability($module,$cap)` backed by `mod_cloudhost247_capabilities` role policies |
| Foundation audit + logs | `…/cloudhost247_core/lib/Support/AuditLogger.php`, `AuditRepository.php`, `Logger.php` | `mod_cloudhost247_audit*` (CoreAuditMigration), `Logger::write($module,$level,$event,$context)` → `mod_cloudhost247_logs` + `Logger::correlationId()` |
| Migration infrastructure | `…/cloudhost247_core/lib/Database/MigrationRunner.php`, `Contracts/Migration.php` | `run($module, [migrations])`; repository table; every module's success is pinned in `scripts/validate-migrations.py` |
| Capability allowlist | `cloudhost247_core.php` output (admin UI + validation) | Currently permits: theme, currency, ovh, integrations, modules, builder, broker — **marketing must be appended** (one-line additive edit, audited) |
| Module layout convention (first-party) | `modules/addons/cloudhost247_broker/` / `cloudhost247_builder/` | `bootstrap.php` (PSR-4 autoloader + defensive sibling requires), `lib/Repositories|Services|Http|Security|Domain`, `migrations/Vnnn.php`, `templates/` (client area), AdminView echoing WHMCS admin markup |
| Admin asset conventions | `modules/addons/cloudhost247_builder/assets/{css,js}/` | `admin.css`, `editor.css`, `editor.js`, `runtime.css/js`; served by `AdminController::serveAsset()` through `addonmodules.php?module=…&asset=…` with a **whitelist map** + content types (`lib/Admin/AdminController.php:996`) |
| Drag-drop editor precedent | `…/builder/assets/js/editor.js` + `lib/Admin/AdminView.php:998` | The Website Builder ships a working block editor; campaign builder follows its conventions (vanilla JS, deferred script, module-scoped namespace, no external SaaS) |
| Cron convention | `crons/cloudhost247_integrations.php` (also builder/currency/ovh/smm) | CLI-only guard, `require init.php + module bootstrap`, JSON summary to STDOUT, exit codes 0/1/2; `AfterCronJob` hook precedent in `cloudhost247_currency/hooks.php` |
| Hook convention | `modules/addons/<module>/hooks.php` | WHMCS `add_hook` (client navbar: `ClientAreaPrimaryNavbar` in domain_lookup; head/footer output in builder/theme) |
| Admin addon page | every `cloudhost247_*` module file | `_config/_activate/_deactivate/_output`; capability-guarded POST ops; HTML echo |
| Client-area module pages | broker `cloudhost247_broker_clientarea()` | `index.php?m=<module>` array return: `pagetitle`, `breadcrumb`, `templatefile`, `vars`, `requirelogin => true` |
| Public (no-login) root pages | `domain-brokerage-terms.php`, `refund-policy.php`, … | `define('CLIENTAREA', true)` + `ClientArea->initPage()` + theme tpl; **the pattern for the public unsubscribe page**; each file is individually listed in the CI lint step |
| Client data access (read) precedent | broker `DomainDeliveryService` (localAPI Read), builder `LiveDataSource`/`WhmcsDataSource` (Capsule reads) | Repository modules never write core tables; WHMCS reads happen via Capsule or localAPI |
| Email PROVISIONING products | `modules/servers/cloudhost247_email/`, `modules/servers/Smtphosting/`, `modules/servers/cloudhost247_email_hosting/` | Mailbox/account provisioning (IMAP/SMTP hosting, Microsoft 365, Google Workspace, ModulesGarden SMTP-hosting reseller) — **sell mailboxes; none send campaigns** |
| Transactional send example | `modules/addons/phoneservices/lib/Interfaces/EmailProviderInterface.php` + `Providers/SendgridProvider.php` | SendGrid transactional interface (`sendEmail`, `getEmailStatus`) — good shape reference for a provider contract; it is notification-scoped, not marketing |
| Notification (customer) helper | broker `NotificationService` → `localAPI('SendEmail')` | Uses WHMCS transactional mailer — **marketing must NOT send campaigns through this path** (would conflate marketing with transactional and bypass rate-limit/bounce/marketing-suppression rules) |
| Test infrastructure | `tests/broker/{fakes.php,run.php,test_static.py}` | Fake Capsule query builder, fake `localAPI`, seeded globals; static invariants in Python; reproduced per-module (`tests/marketing/*`) |
| CI gate | `.github/workflows/independent-foundation.yml`, `scripts/release-candidate-check.sh`, `scripts/validate-migrations.py` | Real PHP 7.4 + 8.2 matrix; `find` already covers `modules/addons/cloudhost247_* modules/servers/* tests scripts crons/cloudhost247_*.php`; root PHP files are **individually listed** (new public endpoints must be appended) |

## 2. Reusable Components (use; never rebuild)

1. **Credential storage:** `SecretVault` + `MasterKey` (`CH247_INTEGRATIONS_KEY`) — SMTP password encrypted at rest, decrypted server-side only.
2. **SMTP configuration schema + admin UI:** a new catalog provider in the existing `messaging()` section — admin uses the same Configure/Test/Rotate/Logs screens; no second SMTP settings page.
3. **SMTP connection test:** `ConnectionTester`→`SmtpProbe` — the *Test SMTP Connection* button for campaigns deep-links into the central integrations screen (same code path, same result taxonomy as spec #15).
4. **Security:** `AdminGuard` (admin + CSRF + capability), `check_token('WHMCS.default')`, `InputValidator`-style validation (broker precedent), whitelist asset serving.
5. **Migrations + validator:** `MigrationRunner` contract + `scripts/validate-migrations.py` (marketing versions get pinned there).
6. **Audit/logging:** Foundation `AuditLogger` + `Logger` with `correlationId()` — spec #42/#41 logging without new tables beyond the module's own data.
7. **CRUD/view conventions:** broker's `lib/Repositories` + `AdminView` echo pattern, builder's `assets/` + whitelist serving, `ClientArea` page + theme tpls for the public unsubscribe page.
8. **Cron:** `crons/cloudhost247_marketing.php` following the integrations cron exactly (CLI guard, JSON summary, exit codes).
9. **Tests:** copy `tests/broker` skeleton → `tests/marketing` (fake Capsule, fake socket dialer for SMTP sends, fake `localAPI`).
10. **Builder block-editor know-how:** `builder/assets/js/editor.js` conventions (vanilla JS, no build step) — campaign builder is a *new, purpose-built* editor using the same conventions (different data model: email-safe table HTML, not site pages).

## 3. Conflicting / Careful-Interaction Modules

| Module | Interaction decision |
|---|---|
| `crons/emailSend.php` | Misnamed legacy OVH `seenMessage` maintenance script (whole body commented/`exit`) — **not an email sender**; ignore, do not delete (tracked separately) |
| `modules/servers/cloudhost247_email`, `Smtphosting`, `cloudhost247_email_hosting` | Provision mailboxes for customers; marketing consumes *no* code from them; cPanel SMTP credentials for campaigns come from the integrations vault, not these products |
| `phoneservices/SendgridProvider` | Transactional notifications only; marketing does not reuse it (different concern), but its interface shape is a reference |
| broker `NotificationService` / `localAPI('SendEmail')` | **Marketing campaigns never use WHMCS `SendEmail`** (transactional pipeline; spec #39 separation) |
| Central `smtp` integration row | The shared transactional relay. Marketing gets its **own provider key** (below) so sender identity, rotation and failures never disturb transactional mail — while reusing 100% of the vault/probe/tester/UI code |
| Legacy ionCube-protected theme and currency addons | Proprietary, covered by the 2,535-file integrity manifest — untouched except for documented branding-only overrides |

## 4. Missing Capabilities (must be built new)

1. Campaign/subscriber/list/segment/template/automation domain (repositories, services, statuses, dashboards).
2. **SMTP *sending* client** — `SmtpProbe` only probes; nothing in the repo performs `MAIL FROM/RCPT/DATA`. A small, real SMTP submitter is required (see §7 design: shared `integrations/lib/Api/SmtpClient.php`, dialer-seamed like the probe).
3. Visual email campaign builder (purpose-built blocks → email-safe table HTML; reuse builder assets conventions only).
4. Queue engine: recipient materialization, batching, rate limiting, retry/backoff, idempotency, pause/resume, worker locking (`select … for update` is MySQL-portable here; also add a `GET_LOCK` fast-path with graceful fallback).
5. Tracking endpoints (pixel/click/unsubscribe/preferences) — no public endpoint infrastructure exists for marketing yet; two new root pages using the established public-page pattern.
6. Bounce ingestion: cPanel provides DSNs to the *From/Return-Path mailbox* — a small IMAP (socket-level, extension-free) poller + DSN parser; honest "not configured" state when unset. (Feature-detect; never fabricate.)
7. Open/click analytics + click map, suppression engine, unsubscribe flows, automation engine + triggers via WHMCS hooks.
8. `AdminAreaMainMenu` top-menu hook — **no existing precedent**; new but standard WHMCS hook (not a duplication).
9. XLSX import (feature-gated on `ZipArchive`); XLS (binary) declined with honest guidance.

## 5. Required New Files (target layout — adjusted to repo conventions; spec tree modified only where the repo has a stronger convention)

```
modules/addons/cloudhost247_marketing/
├── cloudhost247_marketing.php        registration (_config/_activate/_deactivate/_output/_clientarea)
├── bootstrap.php                     PSR-4 autoloader + core/integrations defensive requires
├── hooks.php                         AdminAreaMainMenu 'Marketing' menu; WHMCS event hooks for automation triggers
├── lib/
│   ├── Domain/                       CampaignStatus, SubscriberStatus, QueueStatus, EventType, ResultKind
│   ├── Repositories/                 CampaignRepository, SubscriberRepository, ListRepository, SegmentRepository,
│   │                                 TemplateRepository, QueueRepository, EventRepository, SuppressionRepository,
│   │                                 AutomationRepository, SettingsRepository, ImportRepository
│   ├── Services/                     CampaignService, SubscriberService, ListService, SegmentService,
│   │                                 TemplateService, BuilderService (blocks→email-safe HTML + sanitizer),
│   │                                 PersonalizationService, QueueService, DeliveryService, DeliveryProvider (interface),
│   │                                 CpanelSmtpProvider, TrackingService, BounceService, SuppressionService,
│   │                                 ComplianceService, AutomationService, AnalyticsService, ValidationService,
│   │                                 ImportService, ExportService, QueueWorker, BounceWorker, AutomationWorker,
│   │                                 TokenService (HMAC, no-PII), DnsAuthChecker (SPF/DKIM/DMARC read-only status)
│   ├── Delivery/                     SmtpMessage (builder), header hygiene, text-part generation
│   ├── Http/                         AdminController, AdminView, asset serving (whitelist)
│   ├── Security/                     ClientArea/Public guards, tracking-token validation, redirect allowlist, upload validation
│   └── Integrations/                 bridge: resolve cpanel_smtp credentials+config from IntegrationManager (server-side only)
├── migrations/V100.php               v'1.0.0' — all tables, hasTable-guarded
├── templates/                        client-area: unsubscribed.tpl, preferences.tpl
├── assets/{css,js}/                  admin.css, builder.css, builder.js, analytics.js
└── docs (linked into docs/independent-rebuild/EMAIL-MARKETING.md)

crons/cloudhost247_marketing.php      CLI worker: queue|bounces|automations|maintenance (JSON summaries)
email-tracking.php                    PUBLIC root endpoint (pixel GIF, click redirect with allowlist)
email-unsubscribe.php                 PUBLIC ClientArea page (unsubscribe confirm, manage-preferences, RFC 8058 POST)
tests/marketing/{fakes.php,run.php,test_static.py}
modules/addons/cloudhost247_integrations/ (2 additive edits)
    lib/Registry/ProviderCatalog.php  + provider 'cpanel_smtp' in messaging()
    lib/Api/SmtpClient.php            + real minimal SMTP submitter, dialer-seamed
modules/addons/cloudhost247_core/cloudhost247_core.php  (1 additive edit: allow capability policies for cloudhost247_marketing)
scripts/validate-migrations.py        + 'cloudhost247_marketing':['1.0.0']
.github/workflows/independent-foundation.yml  + lint email-tracking.php, email-unsubscribe.php
README.md, docs/independent-rebuild/EMAIL-MARKETING.md
```

## 6. Required Database Tables (`mod_cloudhost247_marketing_*`; validator enforces the prefix — spec's `mod_ch247_*` names are **rejected** as off-convention)

| Table | Key columns/indexes |
|---|---|
| `…_campaigns` | id, name, subject, from_name, from_email, reply_to, template_id?, design_json, html, text, audience_type (list/segment/all), audience_ref, status idx, scheduled_at, started_at, completed_at, sent_by, idempotency_key **unique**, timestamps |
| `…_subscribers` | id, email **unique**, first_name, last_name, company, phone, country, fields_json, status idx (subscribed/unsubscribed/pending/bounced/suppressed), consent_* (status/ts/source/ip-less), bounce info, source (manual/import/wqmcs-member), client_id? idx, timestamps (no plaintext secrets) |
| `…_lists` (+`…_list_members`) | list id/name/description/status; member (list_id, subscriber_id) **unique pair**, added_at |
| `…_segments` | id, name, definition_json (typed rule DSL), cached_count?, timestamps; evaluated live, never copied to subscribers |
| `…_templates` | id, name, category, design_json, html, text, source (builtin/custom/campaign), timestamps |
| `…_campaign_recipients` | id, campaign_id idx, subscriber_id?, email idx, **unique (campaign_id,email)**, personal_json (pre-resolved), status; materialized at queue-build time WITH suppression filtering |
| `…_email_queue` | id, campaign_id idx, recipient_id?, email, **idempotency_key unique**, provider_key, status idx (queued/sending/sent/failed/skipped), attempts, next_attempt_at idx, locked_until idx, locked_by, message_id, tracking_token **unique**, sent_at, last_error(kind+detail sanitized), scheduled_at idx, timestamps. Composite idx `(status, next_attempt_at)` |
| `…_email_events` | id, campaign_id idx, queue_id?, subscriber_id?, type idx (queued/sent/failed/open/click/unsubscribe/bounce/complaint/skipped), meta_json (sanitized; links: url hash+text only), created_at idx. Insert-only |
| `…_suppressions` | id, email **unique**, reason (unsubscribed/hard_bounce/complaint/admin/invalid), source, created_at |
| `…_automations` (+ `…_automation_steps`, `…_automation_runs`) | trigger_key, status, steps (step_no, type [email/wait], params_json); runs (automation_id, subscriber context, cursor, due_at idx, status) — idempotent claim |
| `…_imports` | id, filename?, mapping_json, totals (valid/invalid/duplicates/existing), status, admin_id, timestamps — import audit |
| `…_settings` | setting_key unique, setting_value (rate limits, batch size, retry policy, bounce threshold, footer address, timezone, tracking toggles) |
| `…_links` | id, campaign_id idx, url_hash, url, label, clicks rollup |

No foreign keys (repo convention: indexed unsigned bigints); no core-table writes; all `create()` hasTable-guarded; repeat-activation is a no-op; deactivation retains data.

## 7. Integration Points

1. **cPanel SMTP = new catalog provider `cpanel_smtp`** in `ProviderCatalog::messaging()`: same field family as the shared `smtp` type (host/port/encryption/username/password) **plus** `from_name`, `from_email`, `reply_to` option fields; `auth ⇒ type: smtp`; `health ⇒ method: SMTP`; `used_by ⇒ modules/addons/cloudhost247_marketing`. Admin configures/tests/rotates it from **Super Admin → API & Integrations** (existing screens; spec #16 satisfied). The marketing Delivery Settings page only deep-links + shows non-secret status (`integrationSummary` pattern).
2. **`IntegrationManager::credentials('cpanel_smtp')`** supplies decrypted secrets *inside* `CpanelSmtpProvider` at send time; nothing reaches UI/JS/logs (existing `configuration()` returns non-secret shape only).
3. **`SmtpClient` (new, integrations/lib/Api)** — sends exactly one RFC 5321 message per `send()`: `MAIL FROM`, `RCPT TO`, `DATA`, dot-terminating, 8BITMIME-safe, result classified `{accepted:bool, code:ResultCode, kind:temporary|permanent|auth|rate_limited|invalid_recipient|provider_unavailable, enhanced?, message_id?}` from real server responses; same dialer-injection seam as `SmtpProbe`; password only ever on the socket.
4. **Foundation**: `AdminGuard`+capability policies (`marketing.campaigns.manage`, `marketing.subscribers.manage`, `marketing.sending.manage`, `marketing.settings.manage`, `marketing.analytics.view`), `AuditLogger`, `Logger`.
5. **WHMCS hooks**: `AdminAreaMainMenu` (nav), plus automation triggers (ClientAdd, AfterModuleCreate, AcceptOrder/InvoicePaid, …) — wired defensively in `hooks.php` (no-ops when module tables absent).
6. **Cron/batch**: `crons/cloudhost247_marketing.php <queue|bounces|automations>`; admins schedule via system cron — same ops model as integrations cron.
7. **CI/gates**: validator pin, workflow lint list (+2 root files), `release-candidate-check.sh` auto-covers the module path; `tests/marketing` added to workflow suite list.
8. **Products/personalization origins**: read-only Capsule reads of `tblclients`/`tblhosting`/`tbldomains` (+ product groups for content blocks) limited to whitelisted columns salted by compliance rules; segments cache nothing PII-heavy.
9. **Builder module pattern only** (not coupling): marketing ships its own purpose-built editor; zero runtime dependency on `cloudhost247_builder`.
10. **DNS auth status (#33)**: read-only `dns_get_record` (native, no external API) for the sender domain → SPF/DKIM(selectors probed)/DMARC = Detected/Missing/Unknown + instructions; never claims configured unless actually detected.

## 8. Risks & Decisions

| Risk | Mitigation |
|---|---|
| **Duplicate send** (spec #22) | `idempotency_key` unique + `(campaign_id,email)` unique on recipients; worker claim = single conditional `UPDATE … status='sending', locked_until=…, locked_by=uuid WHERE id=? AND status='queued'` then verify affected rows; crash-expired locks re-claim only after backoff; MySQL `GET_LOCK` batch lease with fallback to conditional updates on non-MySQL |
| **Worker concurrency** | Same conditional-claim protocol; cron CLI re-entry guard; rate-limit counters per provider+window in settings table with atomic `UPDATE value=value+n` compare |
| **Idempotency across retries** | Every side effect (recipient materialization, queue insert, event insert, unsubscribe) keyed; replayed operations short-circuit (broker precedent) |
| **Recipient set explosion** (100k+) | Materialize recipients in chunks (indexed cursor by subscriber id); queue inserts chunked 500/round; admin UI never loads lists fully (server-side pagination everywhere) |
| **"Delivered" honesty** (#23) | cPanel SMTP has no delivery webhook: UI says **Accepted by relay** vs **Confirmed delivery unavailable**; bounce=only real negative signal; analytics labels state this verbatim |
| **Open tracking honesty** (#24) | Pixel events labeled *tracking events*, prefetch-filtered heuristically (UA/Imap-Id silhouettes, dedup window); never "human read" claims |
| **Credential leakage** | Secrets never leave `SecretVault` except into the smtp socket; audit/log redaction (no password/body logging; store headers-only sanitized results); tracking tokens = random 32-byte + HMAC context, carry **email hash** not email |
| **XSS in builder/admin** | Builder JSON→HTML pipeline with allowlist tags/attributes/CSS properties; admin preview in sandboxed iframe with CSP; custom-HTML mode sanitized same pipeline + honest warning |
| **Open redirects** (#25) | Click tokens bind to `…_links` rows; redirect only to registered campaign URLs; unknown token → 400, no redirect |
| **Tracking endpoint abuse** | Per-IP token-bucket (settings-backed, best-effort in-process + DB counter), rate-limited 429, no enumeration signals (uniform 1×1 GIF/404) |
| **File upload security (import)** | MIME+extension allowlist, size cap, parse in-memory only (never move_uploaded_file to webroot), formula-cell sanitization for CSV export (=,+,−,@ prefix) |
| **cPanel rate limits unknown** | Defaults conservative (e.g., 25/batch, 500/hour, 3 retries w/ 5m/30m/2h backoff) all admin-configurable; `rate_limited` classified from real 4xx codes |
| **Bounce mailbox optional** | Honest states everywhere; when IMAP not configured the Bounces page explains requirements instead of simulating |
| **XLS/XLSX fidelity** | CSV/TXT/paste: full fidelity; XLSX: feature-detected ZipArchive reader of first sheet; XLS binary: declined with instruction (documented, honest) |
| **WHMCS version drift** | No WHMCS core edits, no core table writes; hooks guarded; token API (`generate_token`/`check_token`) as in existing modules |
| **Scope creep vs spec tree** | Deviations from the suggested tree only to follow stronger repo conventions (root `crons/`, `mod_cloudhost247_` prefix, `lib/Http` naming) — recorded here for review |

## Session Plan Confirmation

Sessions 1–12 per spec, with the following anchor decisions fixed by this audit:
module name `cloudhost247_marketing`; namespace `CloudHost247\Marketing`;
provider key `cpanel_smtp`; shared `SmtpClient` integration artefact;
workers in root `crons/`; public endpoints `email-tracking.php` +
`email-unsubscribe.php`; domain enums closed sets (DRAFT/READY/SCHEDULED/
QUEUED/SENDING/PAUSED/COMPLETED/CANCELLED/FAILED/ARCHIVED etc.);
all tables `mod_cloudhost247_marketing_*`; tests `tests/marketing/*`;
docs `docs/independent-rebuild/EMAIL-MARKETING.md` (created in SESSION 1).

**SESSION 0 COMPLETE — no code modified.**
