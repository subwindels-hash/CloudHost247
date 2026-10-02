# CloudHost247 Email Marketing Platform

Module: `modules/addons/cloudhost247_marketing` (version 1.2.0, in build — SESSIONS 1–12 complete).
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
 ├─ hooks.php                    Admin → Marketing menu (the menu is cosmetic; triggers fire in SubscriptionService)
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
 │                               AnalyticsService (SESSION 9), AutomationService (SESSION 10)
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

* **An automation is a way of filling the queue, not a second delivery path.**
  Every journey message is a queue row, and the three ways a journey stops are
  enforced before it is queued and again when it is delivered.

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
| 9 — Analytics | **DONE** | `AnalyticsService` (read-only) turns the event ledger into the numbers the operator asked for — per campaign: audience frozen, accepted by the relay, failed/skipped, still queued, opens, clicks, bounces, unsubscribes, plus open / click / click-to-open / bounce / unsubscribe rates; deployment-wide rolling windows (7/30/90/365 days) with the busiest campaigns, campaign-state counts, a click map per registered link (clicks attributed through the event's `link_id`, unattributable clicks reported rather than hidden), bounded per-recipient activity, and a 14-day daily timeline that fills quiet days with zeroes. Every figure is a count of recorded events — nothing is estimated — and a rate with a zero denominator is `null`, rendered as "—", never as a comforting 0%. The screen states that "accepted" means the relay took the message and that opens are pixel events that can include client prefetching. A 30-day panel sits on the dashboard, and a static invariant proves the report view issues no writes and reads no core table. Tests: 10 new cases in `tests/marketing/session9.php` (117 total) |
| 10 — Automation | **DONE** | A journey is a list of `wait` / `send_email` steps and a run is one subscriber walking it. Three rules shape the engine: **nothing is delivered by the automation code** — a send step puts a row on the same queue campaigns use, so suppression, throttling, retries, tracking and the ledger apply unchanged; **one live journey per subscriber** (the enrolment key is unique, so a retried trigger cannot enrol twice, and re-enrolment only happens when the operator allowed it, as a new run); **stopping always works** — unsubscribing, a hard bounce, an admin suppression or archiving the automation cancels the live runs, and a queued message is re-checked at delivery. A run advances at most one step per cron pass, so a burst of send steps is spread over successive passes instead of fired in a loop. Triggers (`subscriber_added`, `list_joined`, `manual`) fire inside `SubscriptionService`, so an import or an API call starts a journey exactly like the admin form. Each automation owns one long-lived container campaign (`origin='automation'`, status `sending`) that holds its links and ledger rows while never appearing in the Campaigns list, never being due and never being settled — automation sends reuse the whole campaign pipeline, and Analytics reports them under "Automation: …". The queue row freezes which run and which step it belongs to, so the delivery pass composes the step's own template even if the run has moved on, and a step whose template was archived mid-flight is skipped with a reason rather than sent wrong. Tests: 14 new cases in `tests/marketing/session10.php` (131 total) |
| 11 — Security review | **DONE** | Nine findings reviewed, three fixed, six verified with tests (details below). **Fixed:** (1) personalisation values were substituted raw into the HTML part, so a subscriber could put markup — or a phishing link — into somebody else's email by editing their own name; HTML-context substitutions are now escaped (`personalise(..., $htmlContext)`), while the text part and the subject stay literal. (2) Campaign and step subjects were never personalised at all (a `{{first_name}}` subject went out literally); the composer now personalises the subject in text context. (3) CSV export neutralised `=`/`+`/`-`/`@` formulas but not tab/CR/LF-prefixed ones, which spreadsheets trim before executing. Also: `%` and `_` are stripped from search terms so a search box cannot become a table scan. **Verified with tests:** hostile link schemes (`javascript:`, `data:`, `vbscript:`, `file:`, `ftp:`, protocol-relative) are refused at registration, never rewritten into tracking links and never redirected to; every mutating admin branch refuses a POST without a valid token (and with a bad token nothing changes); templates with `<script>`/`onerror`/`<iframe>` are sanitised on save and a `javascript:` button URL is refused outright; hostile subscriber values render escaped on the admin screens; the module stores no credentials and reads no WHMCS core table (credentials come from the integrations vault); repeated opens count once and a GET on the unsubscribe route changes nothing (mail scanners follow links); unknown/malformed tokens get the same 404 body (no enumeration); display names and subjects containing CRLF cannot inject a header line into the SMTP conversation (proved on the wire in the integrations suite); the analytics service and the admin reporting view have no write path, and the worker is CLI-only. Tests: 13 new cases in `tests/marketing/session11.php` (144 total) plus 3 new static invariants and 2 new wire-level checks in `tests/integrations/run.php` (108) |
| 12 — Production QA | **DONE** | The last session asked the questions an operator asks on a bad day, and one more defect fell out. **Failure taxonomy, end to end:** a hard bounce fails the row, suppresses the address and writes one `bounced` event; a timeout keeps the row queued with a future retry and one attempt spent; a relay that will not authenticate stops the pass after the single row it attempted and leaves the other eleven untouched for the next pass — nothing is lost, and nothing is marked permanently failed for a problem an operator can fix. The transport now hands the queue the provider `code` it always had (`SmtpTransport::send()` used to drop it), so the classification above is the queue's decision from a code, never from message text. **Concurrency:** two workers on one queue delivered all 30 messages exactly once — 30 `sent` rows, 30 `sent` events, 30 messages on the wire. **Soak:** 120 messages over six passes, every one delivered exactly once, ledger, queue, campaign status and analytics agreeing; reporting stays honest when there is nothing to report (open/click rate 0% where the denominator is known, click-to-open `null` where it is not). **The whole chain in one pass:** list → campaign → queue → delivery → open, click, one-click unsubscribe → suppression → analytics, and the next campaign skips the address. **Deployment:** activating twice is idempotent, re-running the newest migration is safe, deactivation keeps every table and row, an import cannot resurrect a suppressed address, and an export never lists one. **Finding, fixed:** a repeated unsubscribe POST wrote a second `unsubscribed` event — the SESSION 8 suite had even asserted the double count while its comment called it idempotent. The ledger now records an unsubscribe only when the request changed something, so the number the operator reads is people, not clicks. Tests: 8 new cases in `tests/marketing/session12.php` (152 total) plus 1 static invariant |

## Security review (SESSION 11)

Nine questions were asked of the module's own attack surface; three answers were
wrong and are fixed, the other six are now covered by tests rather than trust.

| Question | Verdict |
|---|---|
| Can a subscriber inject markup into somebody else's email? | **Fixed.** Personalisation values were substituted raw into the HTML part. `personalise()` now takes an HTML-context flag; the HTML part escapes, the text part and the subject stay literal. |
| Is the subject line personalised? | **Fixed.** It was not — `{{first_name}}` in a subject went out literally. The composer personalises it in text context (a header is not an HTML context). |
| Can an export deliver a spreadsheet formula? | **Fixed.** `=`/`+`/`-`/`@` were neutralised; tab/CR/LF-prefixed payloads were not, and a spreadsheet trims those before running the formula. |
| Can a malicious link be tracked, rewritten or redirected to? | Verified: only absolute `http(s)` URLs register or redirect (`javascript:`, `data:`, `file:`, `ftp:`, protocol-relative targets are refused), and a forged link id 404s because destinations are resolved per campaign from the database. |
| Is every admin mutation behind POST + CSRF + capability? | Verified by test: a bad token on any mutating view throws before anything changes. Capability names are all `marketing.*` capabilities, never a core role check. |
| Is template HTML safe? | Verified: `<script>`, `onerror` and `<iframe>` are stripped on save, and a `javascript:` button URL is refused instead of stored. |
| Are credentials stored here? | Verified: the module keeps no SMTP credentials and reads no WHMCS core table; the relay identity comes from the integrations vault (`IntegrationManager::smtpIdentity()`). |
| Can the public endpoint be abused? | Verified: opens dedupe to one event per message, clicks only reach registered destinations, a GET never changes a subscription (mail scanners follow links), and unknown or malformed tokens share one 404 body. |
| Can a name or subject smuggle a header? | Verified on the wire: `SmtpClient` strips CR/LF from display names and encodes headers, and a subject containing a line break is refused before the relay is spoken to. |


## Production QA (SESSION 12)

| Question | Verdict |
|---|---|
| What happens to the rest of the batch when the relay refuses the session? | Verified: the pass stops after the one message it attempted, reports the reason once, and the untouched rows stay queued with no attempt spent. |
| Does a hard bounce suppress the address, and does a timeout retry? | Verified: hard bounce → `failed` + suppression + one `bounced` event; timeout → still queued, `attempts` up by one, `next_attempt_at` in the future, then a permanent refusal on the retry stops the row. |
| Can two workers send the same message? | Verified: 30 messages, 30 rows, 30 events, no duplicates. |
| Does a long run stay exactly-once? | Verified across six passes and 120 messages: queue, ledger, campaign totals and analytics all agree. |
| Is the unsubscribe event counted once? | **Fixed.** A repeat POST wrote a second event; now only a request that changes the suppression or subscriber state is recorded. |
| Is activating, upgrading or deactivating safe? | Verified: double activation is idempotent, re-running the newest migration changes nothing, deactivation keeps every table and row. |
| Can an import or export move a suppressed address back in? | Verified: imports skip and never create it; exports never list it. |


## Testing

* `tests/marketing/run.php` — SESSION 1 behavior suite (activation idempotency,
  seeding, settings persistence/audit/capability denial, dashboard honesty,
  catalog registration, enum closures, validator) plus the SESSION 2 file below;
  runs under PHP 7.4 and 8.2 in CI.
* `tests/marketing/session12.php` — SESSION 12 production QA suite (8 cases):
  the failure taxonomy over scripted transports (bounce, timeout, broken
  session), the provider-code regression, two workers on one queue, a 120-message
  soak proving exactly-once, the whole chain from list to unsubscribe in one
  pass, double activation / migration re-run / retention-only deactivation, and
  an import that cannot resurrect a suppressed address.
* `tests/marketing/session11.php` — SESSION 11 security suite (13 cases):
  HTML-context escaping of personalisation (and literal text/subject values),
  test sends escaped the same way, hostile link schemes refused/never rewritten,
  forged click ids and unknown tokens refused, POST+CSRF refusal across every
  mutating view with nothing changed, template sanitisation and a refused
  `javascript:` button URL, escaped rendering of hostile subscriber values, CSV
  formula neutralisation, "no credentials and no core tables", the
  guarded-entry-point/pure-declaration split, and endpoint abuse limits (opens
  dedupe, GET unsubscribe is inert, identical 404s).
* `tests/marketing/session10.php` — SESSION 10 behavior suite (14 cases):
  authoring and the pre-activation checks, the container campaign (hidden from
  the campaign list and never due), step removal renumbering the journey,
  one-live-journey enrolment and controlled re-enrolment, refusals for addresses
  that left/bounced/were suppressed, the one-step-per-tick engine (send, wait,
  resume, complete), same-pass delivery from the step's own template, unsubscribe
  cancelling a journey before its queued message can go out, bounce/suppression
  stopping journeys, pause holding and archive cancelling, a mid-flight archived
  template being skipped with a reason, trigger hooks for new subscribers and
  list joins, the CSRF/capability-guarded automations screen, and analytics
  attribution to the container.
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
