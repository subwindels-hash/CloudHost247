# CloudHost247 Email Marketing Platform

Module: `modules/addons/cloudhost247_marketing` (version 1.1.0, in build — SESSIONS 1–3 of 12 complete).
Native WHMCS addon — no separate application, no separate frontend, no
duplicate SMTP/credential infrastructure. Delivery credentials live
exclusively in the central CloudHost247 API & Integrations vault under the
provider key **`cpanel_smtp`** (encrypted by `CH247_INTEGRATIONS_KEY`,
decrypted server-side only).

Audit: `docs/independent-rebuild/EMAIL-MARKETING-AUDIT.md` (SESSION 0) is the
authoritative map of what existed, what is reused, and why the layout below
differs from the original proposal only where repository conventions are
stronger.

## Architecture (as built)

```
Admin → Marketing menu (hooks.php, AdminAreaMainMenu)
        │
        ▼
modules/addons/cloudhost247_marketing
 ├─ cloudhost247_marketing.php   registration / activation (MigrationRunner) / admin dispatch
 ├─ bootstrap.php                PSR-4 autoloader + defensive core/integrations requires
 ├─ hooks.php                    Admin → Marketing menu; (automation triggers land in SESSION 10)
 ├─ lib/Domain                   closed state enums (Campaign/Subscriber/Queue/Result/Event/Suppression,
 │                               ConsentStatus, SubscriberSource) + SegmentField / SegmentOperator
 │                               closed catalogs (SESSION 3)
 ├─ lib/Repositories             SettingsRepository, SubscriberRepository, ListRepository,
 │                               TagRepository, SuppressionRepository, SegmentRepository,
 │                               ClientDirectoryRepository (read-only WHMCS facts, SESSION 3)
 ├─ lib/Services                 SubscriptionService (subscribe/unsubscribe/bounce/suppression),
 │                               ImportService, ExportService, SegmentService (live evaluation, fail-closed);
 │                               campaign/queue/automation services land in later sessions
 ├─ lib/Http                     AdminController / AdminView (dashboard, Delivery Settings,
 │                               Subscribers, Segments, Lists, Import, Suppression List)
 ├─ lib/Security                 InputValidator
 ├─ migrations/V100.php          16 mod_cloudhost247_marketing_* tables (additive, hasTable-guarded)
 ├─ migrations/V110.php          tags + subscriber_tags (SESSION 2, additive, hasTable-guarded)
 └─ docs → this file

Delivery chain (built in SESSION 6/7):
   Campaign → Recipients (suppression-filtered, deduplicated) → mod_cloudhost247_marketing_email_queue
            → crons/cloudhost247_marketing.php (batched worker, rate limits, backoff, idempotent claims)
            → cpanel_smtp (IntegrationManager credentials + integrations SmtpClient) → relay
             events → mod_cloudhost247_marketing_email_events → analytics
```

## Safety model

* **No credentials in this module.** Provider config/test/rotate/screens are
  the existing `Super Admin → API & Integrations` pages (deep links are shown
  in **Marketing → Delivery Settings**). The module never calls
  `SecretVault::decrypt` itself; sending (SESSION 6/7) receives credentials
  from `IntegrationManager::credentials()` inside the provider class only.
* **Marketing ≠ transactional.** Campaigns never go through WHMCS's
  `SendEmail`/mail configuration; the queue worker is the only send path.
* **Real-state interface.** The dashboard renders database counters only
  (zero is shown as zero); the SMTP section shows *Not configured* until a
  `cpanel_smtp` integration exists in the active environment, and *Never
  tested* until the central connection test has run.
* **Closed vocabularies.** Campaign/Subscriber/Queue/Event/Suppression
  statuses are final-class constant sets — unknown states can never appear.
  Queue `sent` is labeled **Accepted by relay**, never "delivered" (spec #23).
* **Foundation security.** Every admin action requires
  `AdminGuard::requireAdmin()`; mutations require POST + WHMCS CSRF token and
  the matching `marketing.*` capability (five capabilities: `settings.manage`,
  `campaigns.manage`, `subscribers.manage`, `sending.manage`,
  `analytics.view`; policy-editable in Foundation with the role allowlist
  that now includes this module). Settings changes are audit-logged with
  before/after (redacted) via `AuditLogger`.
* **Migration discipline.** `V100` creates 16 tables with `hasTable` guards,
  no drops/renames, no core tables, no foreign keys (indexed bigint columns,
  repo convention), unique constraints on `email`, `(campaign_id,email)`,
  `idempotency_key`, `tracking_token`, `(list_id,subscriber_id)`,
  `(automation_id,context_key)` and the migration validator pins
  `'cloudhost247_marketing':['1.0.0']`.

## Database (v1.0.0)

| Table | Purpose |
|---|---|
| `…_campaigns` | campaign records (subject/sender/reply-to/audience/status/schedule/idempotency key) |
| `…_campaign_recipients` | materialized, suppression-filtered, deduplicated audience (unique campaign+email) |
| `…_subscribers` | subscriber profiles incl. consent status/timestamp/source (unique email) |
| `…_lists` / `…_list_members` | named lists + many-to-many membership (unique pair) |
| `…_segments` | dynamic rule definitions (evaluated, never pre-copied) |
| `…_templates` | builder templates (builtin/custom/campaign-derived) |
| `…_email_queue` | per-message queue: status, attempts, `next_attempt_at`, claim lock, `idempotency_key`/`tracking_token` unique |
| `…_email_events` | insert-only tracking event ledger (indexed by campaign/type/time/queue/subscriber) |
| `…_suppressions` | global suppression list (unique email + reason) |
| `…_automations` / `…_automation_steps` / `…_automation_runs` | automation definitions + idempotent in-flight runs |
| `…_imports` | import audit records |
| `…_links` | registered campaign links for click tracking (unique campaign+url_hash) |
| `…_settings` | operational settings (throttle, retries, toggles, identity, footer) |

## Session log

| Session | Status | Notes |
|---|---|---|
| 0 — Repository audit | **DONE** | `EMAIL-MARKETING-AUDIT.md` — no code modified |
| 1 — Foundation | **DONE** | addon registration, `AdminAreaMainMenu` menu (10 sections), 16-table guarded migration, capability policy support, settings repository + Delivery Settings UI, dashboard with real counters, `cpanel_smtp` catalog provider, docs, CI wiring. Tests: 12 behavior (PHP 7.4 + 8.2) + 11 static invariants — all green |
| 2 — Subscribers/lists/import | **DONE** | `SubscriberRepository`/`ListRepository`/`TagRepository`/`SuppressionRepository`; `SubscriptionService` (consent recorded as given, suppression always wins, idempotent unsubscribe, hard/soft bounce rules, two-step release + resubscribe); `ImportService` (CSV/TSV/semicolon/one-per-line, header detection + mapping suggestion, dry-run preview bound to the apply by a payload hash, import audit record, suppressed rows reported as skipped); `ExportService` (audited CSV, spreadsheet-formula neutralisation); admin screens for Subscribers (+detail), Lists, Import and Suppression List; migration `1.1.0` adds the two tag tables. Tests: 17 new behavior cases in `tests/marketing/session2.php` (29 in the suite after this session) + static invariants green |
| 3 — Segments | **DONE** | `SegmentField`/`SegmentOperator` closed catalogs (subscriber columns, list/tag membership, six read-only `client.*` facts); `SegmentService` validates and canonicalises definitions on save and on evaluation, evaluates live in 500-row batches with no membership copy, indexes memberships per referenced key, and fails closed when a customer fact cannot be verified (reported as `unverified`, never invented); `subscriberIds()` refuses archived, truncated or unverifiable segments so the send path can never overshoot; `SegmentRepository` stores the canonical JSON and a timestamped display count only, clearing it whenever rules change; `ClientDirectoryRepository` reads only the whitelisted `tblclients`/`tblhosting`/`tbldomains` columns in batches keyed by e-mail. Admin: Segments tab with list/create/edit, rule builder, refresh-count and archive actions behind `marketing.campaigns.manage`. Tests: 14 new behavior cases in `tests/marketing/session3.php` (43 total in the suite) + static invariants green |
| 4 — Templates + builder | planned | block catalog → email-safe table HTML, sanitizer, previews, template library |
| 5 — Campaigns | planned | CRUD → validation checklist → test email → schedule/pause/resume/cancel |
| 6 — cPanel SMTP | planned | shared `SmtpClient` (integrations), provider class, sender-domain validation, test panel |
| 7 — Queue + delivery | planned | recipient materialization, claim locking, throttling, backoff, cron worker |
| 8 — Tracking | planned | pixel/click endpoints, suppression/unsubscribe flows, bounce ingestion |
| 9 — Analytics | planned | rates from the event ledger only, click map, recipient activity |
| 10 — Automation | planned | triggers via WHMCS hooks, wait/email steps, idempotent runs |
| 11 — Security review | planned | CSRF/XSS/auth/upload/tracking-abuse/redirect review |
| 12 — Production QA | planned | full matrix incl. SMTP failure taxonomy, queue concurrency, soak tests |

## Testing

* `tests/marketing/run.php` — SESSION 1 behavior suite (activation idempotency,
  seeding, settings persistence/audit/capability denial, dashboard honesty,
  catalog registration, enum closures, validator) plus the SESSION 2 file below;
  runs under PHP 7.4 and 8.2 in CI.
* `tests/marketing/session3.php` — SESSION 3 behavior suite (14 cases): the closed
  DSL refuses unknown fields, mismatched operators, bad enum/date/day values and
  21-rule definitions; canonicalisation of JSON input, lower-cased enums,
  deduplicated lists, `is_set` value-less rules, bare rule lists; reference keys
  must exist at save time but stored definitions stay readable; save/update/
  archive/reactivate audits and cache invalidation; live re-evaluation with no
  membership copy (members appear and disappear without touching the segment);
  all/any precedence; `is one of` / `is none of` / `is present` / `is missing`
  membership semantics; relative date rules; read-only customer facts batched by
  e-mail with `unverified` accounting; fail-closed refusals from `subscriberIds()`
  ('cannot be resolved', 'could not be verified', archived); and the admin POST
  flow for create / count / archive with CSRF and capability guards.
* `tests/marketing/session2.php` — SESSION 2 behavior suite (17 cases): tag-table
  migration idempotency, consent recorded exactly as given, suppressed addresses
  refused and audited, idempotent unsubscribe + suppression, soft/hard bounce
  rules, two-step suppression release and resubscribe, list keying/idempotent
  membership/archiving, tag normalisation, filtered pagination (status, search,
  list, tag), import parsing (quoted CSV, semicolons, one-per-line, row limit),
  preview-writes-nothing, apply + audit record + suppressed skip, export
  formula-injection neutralisation + export audit, capability-gated screens,
  CSRF on every mutation, and the preview→apply hash binding.
* `tests/marketing/test_static.py` — structure/migration/security/no-duplicate-
  infrastructure/no-placeholder invariants.
* CI: appended to the PHP suite chain in
  `.github/workflows/independent-foundation.yml`; `scripts/release-candidate-
  check.sh` covers the module path automatically (lint + migration rules),
  and the proprietary-integrity manifest stays 2,535/2,535.
