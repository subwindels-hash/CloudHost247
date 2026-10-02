# CloudHost247 Email Marketing Platform

Module: `modules/addons/cloudhost247_marketing` (version 1.2.0, in build — SESSIONS 1–9 of 12 complete).
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
 │                               closed catalogs (SESSION 3) + TemplateBlock catalog (SESSION 4)
 │                               + CampaignAudience (SESSION 5)
 ├─ lib/Repositories             SettingsRepository, SubscriberRepository, ListRepository,
 │                               TagRepository, SuppressionRepository, SegmentRepository,
 │                               ClientDirectoryRepository (read-only WHMCS facts, SESSION 3),
 │                               TemplateRepository (SESSION 4), CampaignRepository (SESSION 5),
 │                               RecipientRepository + QueueRepository (SESSION 7), EventRepository (SESSION 8)
 ├─ lib/Services                 SubscriptionService (subscribe/unsubscribe/bounce/suppression),
 │                               ImportService, ExportService, SegmentService (live evaluation, fail-closed),
 │                               TemplateService (block rendering + builtin library, SESSION 4),
 │                               CampaignService + MessageTransport / UnavailableTransport (SESSION 5),
 │                               SmtpTransport + SenderPolicy (SESSION 6);
 │                               QueueService (SESSION 7), TrackingService + BounceParser (SESSION 8),
 │                               AnalyticsService (SESSION 9); the automation engine lands in session 10
 ├─ lib/Http                     TrackController (public pixel/click/unsubscribe, SESSION 8),
 │                               AdminController / AdminView (dashboard, Delivery Settings,
 │                               Campaigns, Subscribers, Segments, Templates, Lists, Import,
 │                               Suppression List)
 ├─ lib/Security                 InputValidator, HtmlSanitizer (rich-text subset + URL rules, SESSION 4)
 ├─ migrations/V100.php          16 mod_cloudhost247_marketing_* tables (additive, hasTable-guarded)
 ├─ migrations/V110.php          tags + subscriber_tags (SESSION 2, additive, hasTable-guarded)
 ├─ migrations/V120.php          templates.status (SESSION 4, additive, hasTable/hasColumn-guarded)
 └─ docs → this file

Delivery chain (built in SESSION 6/7):
   Campaign → Recipients (suppression-filtered, deduplicated) → mod_cloudhost247_marketing_email_queue
            → crons/cloudhost247_marketing.php (batched worker: freeze audience, queue once,
              claim with locks, rate limits, backoff, suppression re-check, campaign settle)
            → cpanel_smtp (IntegrationManager credentials + integrations SmtpClient) → relay
             events → mod_cloudhost247_marketing_email_events → analytics
   Recipient ← cloudhost247-marketing-track.php (open pixel / click redirect / one-click unsubscribe)
             → the same ledger, deduplicated per message and per link
```

## Safety model

* **Reporting never guesses.** A rate with no denominator is shown as "—", and
  the screens repeat that a relay-accepted message is not a human reading it.

* **Tracking is opt-in per deployment and privacy-safe.** Only opaque tokens
  travel in URLs; opens and clicks are counted, links can only redirect to URLs
  registered for that campaign, and a GET never changes a subscription.

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
| 4 — Templates + builder | **DONE** | `TemplateBlock` closed catalog (heading, paragraph, bullets, button, image, divider, spacer, legal — typed fields with bounds); `HtmlSanitizer` restricted rich-text subset (`b/strong/i/em/u/a/br` only, script/style/iframe stripped, balanced output) and absolute-URL rules (http(s)/mailto only; `javascript:`, `data:`, protocol-relative and userinfo forms refused); `TemplateService` renders each design to table-based inline-styled HTML plus a plain-text twin, skips unsafe or empty blocks with named warnings instead of approximating them, stores design + rendered output together, and seeds three builtin templates idempotently from activation; `TemplateRepository` + migration `1.2.0` add the `status` column so templates archive rather than disappear (builtins can never be deleted). Admin: Templates tab (library, create, block editor, add/remove block, preview as source + plain text, archive/activate/delete) behind `marketing.campaigns.manage`. Tests: 13 new behavior cases in `tests/marketing/session4.php` (56 total in the suite) + static invariants green |
| 5 — Campaigns | **DONE** | `CampaignAudience` (list / segment / all subscribed addresses, resolved live — never frozen); `CampaignRepository` with path-independent idempotency keys, status-owned timestamps (pause keeps `scheduled_at`, cancel keeps `started_at`) and a `due()` lookup for the worker; `CampaignService` with the pre-send checklist (name, single-line subject ≤150 chars, sender, reply-to, HTML **and** text content, non-empty audience; provider reported as advisory), an explicit transition map (draft→ready→scheduled→queued→sending→completed, with pause/resume/cancel/archive and per-state editability), local-time scheduling converted to UTC, audience previews that count subscribed members only and surface segment truncation/unverified rows, and a test send that goes through the same checklist and transport and audits refusals (`campaign.test_refused` / `failed` / `sent`) instead of pretending. Delivery itself is behind the new `MessageTransport` contract (`UnavailableTransport` until SESSION 6), which is what keeps sockets and credentials out of this module. Admin: Campaigns tab with status/search filters, counts, campaign detail (checklist, audience preview, lifecycle buttons, test send, content preview), edits returning an approved campaign to draft. Tests: 12 new behavior cases in `tests/marketing/session5.php` (68 total in the suite) + 13 static invariants |
| 6 — cPanel SMTP | **DONE** | Shared `SmtpClient` added to `cloudhost247_integrations` (`lib/Api/SmtpClient.php`): implicit-TLS/STARTTLS only, AUTH LOGIN, MAIL/RCPT/DATA with base64 MIME and a generated boundary, CR/LF header-injection guards, address validation, 250/4xx/5xx classification through `ResultCode`, relay queue-id capture, and a dialer seam for tests; `IntegrationManager::smtp()` builds it from the vault and `smtpIdentity()` returns the non-secret mailbox/from-address. Marketing's `SmtpTransport` (implements `MessageTransport` + `SenderPolicy`) resolves that client lazily, answers availability with a specific reason (addon missing / not configured / unreadable), forwards messages verbatim, reports relay failures to the integrations event history, and enforces the sender-domain rule ("mailbox domain or configured from-address domain") both in the checklist and again at send time. The campaign detail screen now shows the sending identity and a real test-send panel. Tests: 6 new SMTP-protocol cases in `tests/integrations/run.php` (106 total) and 10 new marketing cases in `tests/marketing/session6.php` (78 total) |
| 7 — Queue + delivery | **DONE** | `RecipientRepository` freezes the audience (`unique(campaign_id,email)`, whitelisted personalisation, pending/sent/failed/skipped); `QueueRepository` owns one row per message with a unique idempotency key, two-step claim locking, `releaseStaleLocks()` for workers that die mid-send, `release()` for paused campaigns (no retry spent), retry/permanent failure/skip transitions and the event ledger; `QueueService` runs one pass: release stale locks → `materialize()` (segment/list resolved once, suppression and consent applied) → `enqueue()` (idempotent) → `dispatch()` (claims, re-checks suppression, sends through `MessageTransport`, hard refusal ⇒ suppress, transient ⇒ backoff from settings, provider-session refusal ⇒ stop the run and hand unattempted messages back) → `settle()` (completed, or failed when nothing got out). Throttling is an allowance per pass (`batch_size`, `messages_per_minute`, rolling `hourly_limit`); the worker never sleeps in-request. `CampaignService::sendNow()` gives an approved campaign a deliberate "queue immediately" action — drafts still never send. Admin: delivery-queue panel with per-status counts, settings summary and a bounded "Run a worker pass now" button. `crons/cloudhost247_marketing.php` (CLI-only, `--campaign=N`, `--dry-run`, JSON summary, exit codes). Tests: 13 new cases in `tests/marketing/session7.php` (91 total) including a render smoke test over all 13 admin screens, which uncovered and fixed a latent fatal on the dashboard (missing `QueueStatus` import) |
| 8 — Tracking | **DONE** | `TrackingService` composes the real message: closed personalisation token set (`{{first_name}}`, `{{last_name}}`, `{{email}}`, `{{company}}`, `{{unsubscribe_url}}`, `{{physical_address}}`; unknown tokens are blanked, never echoed), campaign links registered in `…_links` and rewritten to click URLs, a 1×1 pixel, and an unsubscribe footer that is injected even when tracking is switched off. `EventRepository` is the single writer of the tracking ledger, with dedupe (one open per message, one click per link per message), per-campaign counts and retention pruning from the worker. `cloudhost247-marketing-track.php` (the module's only web-reachable file) serves `e=open` (gif), `e=click` (302, destination resolved from the campaign's own link rows — no open redirect), and `e=unsubscribe` (GET is a confirmation page; POST unsubscribes, including RFC 8058 `List-Unsubscribe=One-Click`; GET never changes state). Tokens are opaque 128-bit values; unknown/malformed tokens get a generic 404 and URLs never contain an address, campaign name or subscriber id. `BounceParser` reads only recipients and 5.x/4.x classification from a pasted DSN (never the message itself), and the campaign screen has a bounce-evidence panel that suppresses hard bounces and counts soft ones. `tracking_base_url` is a required, validated setting (the campaign checklist blocks sending without it) because the module never reads WHMCS core tables. Tests: 15 new cases in `tests/marketing/session8.php` (107 total) |
| 9 — Analytics | planned | rates from the event ledger only, click map, recipient activity |
| 10 — Automation | planned | triggers via WHMCS hooks, wait/email steps, idempotent runs |
| 11 — Security review | planned | CSRF/XSS/auth/upload/tracking-abuse/redirect review |
| 12 — Production QA | planned | full matrix incl. SMTP failure taxonomy, queue concurrency, soak tests |

## Testing

* `tests/marketing/run.php` — SESSION 1 behavior suite (activation idempotency,
  seeding, settings persistence/audit/capability denial, dashboard honesty,
  catalog registration, enum closures, validator) plus the SESSION 2 file below;
  runs under PHP 7.4 and 8.2 in CI.
* `tests/marketing/session9.php` — SESSION 9 behavior suite (10 cases):
  ledger-only summaries, rates that refuse a zero denominator, the click map
  (including clicks pointing at a link that no longer exists), bounded recipient
  activity, timeline bucketing with quiet days, the rolling deployment window
  (including events aged out of it), the read-only report screen, deployment-wide
  reporting with no campaigns at all, the dashboard panel, and a source-level
  proof that the service never writes.
* `tests/marketing/session8.php` — SESSION 8 behavior suite (15 cases):
  composition (personalisation, link registration/rewriting, pixel, footer), the
  closed token set, URL privacy, test sends carrying no token, the pixel and its
  one-open-per-message rule, click recording with registered-destination-only
  redirects (forged/foreign link ids are 404), generic 404s, the GET-confirm /
  POST-unsubscribe pair plus one-click, tracking after a campaign closes,
  tracking-off behaviour, the DSN parser (including unreadable evidence), bounce
  ingestion through the admin action, ledger retention pruning, and the blocking
  "public URL not configured" checklist item.
* `tests/marketing/session7.php` — SESSION 7 behavior suite (13 cases): audience
  freezing with suppression/consent skips, idempotent queueing, delivery and
  honest completion counters, stale-lock recovery after a worker dies mid-send,
  no double delivery across repeated passes, hard-bounce suppression, transient
  retries with backoff and exhaustion, provider-session refusal that stops the run
  and hands unattempted messages back, batch/per-minute/hourly throttle ceilings,
  no-provider behaviour, pause/resume and cancel, and a smoke test that renders
  every admin screen (`AdminView::render`) inside a fatal-catching harness.
* `tests/marketing/session6.php` — SESSION 6 behavior suite (10 cases): transport
  availability with reasons, verbatim forwarding and queue-id propagation,
  relay-failure reporting to the integrations event history, the sender-domain
  policy (mailbox domain, configured from-address domain, refused unrelated
  domain, malformed address), policy enforcement at send time as well as in the
  checklist, a blocked schedule naming the sender-domain failure, a real test
  send through the transport, and the module's refusal to hold credentials when
  the integrations addon is absent.
* `tests/marketing/session5.php` — SESSION 5 behavior suite (12 cases): campaign
  creation validation and idempotency, content copied (not referenced) from its
  template, the checklist and its blocking semantics, audience counting for lists
  and segments including uncertainty, the transition map with refusals, local→UTC
  scheduling and its refusals, edits returning an approved campaign to draft, test
  sends against a recording transport (accepted, provider-failed, unavailable),
  and the admin flow for create / ready / schedule / pause / cancel / deny.
* `tests/marketing/session4.php` — SESSION 4 behavior suite (13 cases): the block
  catalog refuses unknown types, undeclared fields, over-long copy, bad enums,
  out-of-range integers and unsafe URLs; canonicalisation fills catalog defaults
  and drops undeclared keys; rendering emits table markup with inline styles and
  no script surface, with a plain-text twin; the sanitizer keeps only the tiny
  rich-text subset and balances tags; URL rules cover http(s), localhost, mailto
  and refuse javascript:/data:/protocol-relative/userinfo forms; skipped blocks
  are warned about by name; saving stores the rendered bytes, audits create/
  update/delete and refuses missing required values; builtin templates seed
  idempotently and cannot be deleted; preview and storage are byte-identical;
  and the admin create/edit/preview/archive flow plus the field-allowlisting
  block editor are covered end to end.
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
