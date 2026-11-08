# Email Trace Centre — Repository Audit and Architecture Proposal

**Status: architecture agreed; Slice 1 implemented (storage + parsers only).**

| Slice | Scope | Status |
| --- | --- | --- |
| 1 | Migration 0089, repository, Exim/queue parsers, normaliser, status resolver, dedupe, fixtures | IMPLEMENTED — NOT LIVE-VERIFIED (see §15) |
| 2 | Collector, adapter, capability probe, runs, worker sweep | IMPLEMENTED — NOT LIVE-VERIFIED against a real host |
| 3 | Customer + admin endpoints, RBAC, tenant isolation | IMPLEMENTED AND VERIFIED (17 API integration tests) |
| 4 | Admin + customer UI | IMPLEMENTED (9 page tests; live preview not exercised against a mail server) |
| 5 | Agent `mail.trace` operation | IMPLEMENTED AND VERIFIED as a component (12 agent tests); live verification BLOCKED — needs a real host with a readable Exim log |

The delivery report with the exact per-capability classification, the security decisions as shipped
and the remaining unverified surface is `docs/EMAIL-TRACE-CENTRE-REPORT.md`.

> **Freeze boundaries that this proposal must not cross**
> - The WHMCS integration is read-only today (`cloudhost247-node/src/whmcs/*`); this feature does not
>   read or write WHMCS tables, modules or templates, and does not touch `modules/`, `crons/` or any
>   `*.php` file at the repository root.
> - The financial freeze and the production-deploy freeze recorded in
>   `docs/ARCHITECTURE-DECISION-RECORD.md` (§7) and `docs/DEPLOYMENT-GUIDE.md` remain in force. No
>   paid service is activated, no billing path is touched, no Exim configuration is modified and no
>   mail service is restarted by anything described here.
> - Adding the collection capability to the on-server agent is a **separate, explicitly approved
>   infrastructure action**. Until that approval exists, the collector cannot produce live data
>   (see §12).

---

## 1. Repository audit findings

The platform is two codebases in one repository:

| Layer | Location | Stack |
| --- | --- | --- |
| Legacy marketing/account overlay | repository root (`*.php`, `modules/`, `crons/`, `templates/`) | WHMCS + PHP |
| Independent platform | `cloudhost247-node/` | Fastify + TypeScript API, React/Vite SPA, worker, server agent |

Everything below was verified by reading the code in this checkout.

### 1.1 Backend

| Fact | Evidence |
| --- | --- |
| 55 Fastify route modules, each exporting `register*Routes(app, env, overridePool?)` and registered in `src/app.ts` | `cloudhost247-node/src/routes/*.ts`, `src/app.ts` |
| Request validation is `zod` schemas with a local `parseOrThrow` helper; errors are typed (`ValidationError`, `NotFoundError`, `ForbiddenError`) and rendered by a central error handler | `src/routes/admin-domain-services.ts:52-59`, `src/lib/errors.ts`, `src/app.ts:150-165` |
| Pagination convention is `limit`/`offset` with a hard cap (200) | `src/routes/audit.ts:24-25`, `src/routes/admin-customers.ts:50,145` |
| Auth: JWT → `authenticate()`; role checks re-read the user from the database on every call, never trusting the JWT claim | `src/lib/require-auth.ts`, `src/lib/require-role.ts` |
| Roles in use: `customer`, `staff`, `admin`, `super_admin` | `src/layout/Header.tsx` role arrays, `src/routes/admin-*.ts` |
| Per-route rate limiting via `@fastify/rate-limit` (`config: { rateLimit: { max, timeWindow } }`), plus a generous global default | `src/app.ts:296-302`, `src/tools/routes.ts` |
| Append-only audit trail: `audit_logs` (migration 0038) with `recordAudit`, `recordAuditBestEffort`, `auditRequest` | `src/lib/audit.ts`, `database/migrations/0038_create_audit_logs.sql` |
| Credentials are AES-256-GCM envelopes with key versioning; `server_credentials` already allows `agent_secret`, `whm_api_token`, `cpanel_api_token`, `ssh_key`, `kubernetes_kubeconfig` | `database/migrations/0028_create_servers_server_credentials.sql`, `src/lib/crypto.ts`, `src/lib/keyring.ts` |
| Infrastructure inventory: `servers` (`server_type` ∈ VPS/DEDICATED/CPANEL/KUBERNETES/SHARED, plus `cpanel_enabled`, `agent_id`, capacity, status) | migration 0028 |
| 88 sequential SQL migrations, one concern each, with the reasoning written into the file header; runner supports PGlite | `database/migrations/`, `database/migrate.ts` |

### 1.2 Hosting-account and ownership model

There is **no** dedicated `hosting_accounts` table, and inventing one would duplicate identities.
The relationship already exists:

| Table | Fields that matter here |
| --- | --- |
| `customer_services` | `user_id`, `server_id`, `domain`, `username`, `status`, `external_reference`, `product_id`/`plan_id` — one row per hosting account/service on a server |
| `customer_domains` | `user_id`, `domain_name`, `verification_status`, `ssl_status` |
| `servers` | which machine the account lives on, and whether it is a cPanel host |

**Consequence:** a hosting account for email-trace purposes is `customer_services` joined to
`servers`. Customer ownership is `customer_services.user_id`; domain ownership is
`customer_domains.user_id`. Both are server-side facts and are the only acceptable basis for
authorisation. A `customerId`, `accountId` or domain supplied by the browser is a *filter*, never a
grant.

### 1.3 Scheduling and background work

| Fact | Evidence |
| --- | --- |
| A separate worker process runs interval sweeps and claims a database lease so cron cannot run two cycles at once | `src/worker/main.ts`, `src/worker/worker-lease.ts`, `src/worker/runtime.ts` |
| Existing sweeps: subscriptions, security numbers/PINs, health checks, OS lifecycle, notifications, auth-recovery mail, domain services, Cloudflare, FX, AI, tools monitors | `src/worker/sweeps.ts`, `src/worker/*-sweep.ts` |
| Platform settings live in `platform_settings` (`getSetting`/`setSetting`) and there is an existing trim/retention precedent (`trimServerMetrics`) | `src/db/ops-tables.ts` |
| Deployment jobs use `deployment_jobs` + `processNextJob`; this is a Docker deployment queue, not a general job queue | `src/worker/handlers.ts` |

**Consequence:** collection should be a **sweep with a lease**, using `platform_settings` for its
cadence and retention, not a new job system.

### 1.4 The secure on-server agent (the key existing asset)

`server-agent/` is a zero-dependency Node service that runs next to the server's workloads and
exposes **one fixed, allowlisted** operation set over HMAC-SHA256-signed HTTP:

- It is the only component that touches the host; the control plane never holds a shell.
- Per-server secret stored encrypted in `server_credentials` (`agent_secret`), rotatable, revocable.
- Every request is signed over `agentId \n timestamp \n nonce \n METHOD \n path \n sha256(body)`,
  with ±60 s skew and replay protection (`src/deployments/agent-protocol.ts`, `src/routes/agent.ts`).
- Today its operations are Docker/Traefik lifecycle only — **there is no mail operation yet**.

**Consequence:** the correct transport for Exim evidence is a new *fixed* agent operation, not SSH,
not arbitrary commands, and not a customer-reachable HTTP hook. See §4.2.

### 1.5 What already exists for email and DNS (must be reused, not rebuilt)

| Capability | Where | Notes |
| --- | --- | --- |
| SPF check (with include graph) | `src/tools/dns/email-auth.ts` → `spfCheck()` | real DNS through `src/tools/dns/*` |
| DMARC check and policy draft | `email-auth.ts` → `dmarcCheck()`, `dmarcGenerate()` | includes multiple-record detection |
| DKIM selector check | `email-auth.ts` → `dkimCheck()` | selector list input, no false "missing" claims |
| BIMI / MX / PTR / DNSSEC health | `src/tools/dns/health.ts` (`DnsHealthResult`, PASS/WARNING/ERROR/NOT_CHECKED/UNKNOWN + `notCovered[]`) | already states what it did **not** examine |
| SMTP banner, EHLO capabilities, STARTTLS handshake, AUTH mechanisms | `src/tools/developer/smtp.ts` | SSRF-guarded TCP via `src/tools/core/ssrf.ts`; deliberately has no "send mail" mode |
| Honest capability reporting | `src/tools/core/capabilities.ts` (`capabilityReport`) | the pattern to copy for mail-server capabilities |
| Continuous domain monitoring | `src/tools/worker/sweep.ts`, `tools_monitors` | existing scheduler hook |
| Domain Health UI | `frontend/src/pages/DomainHealthPage.tsx`, `frontend/src/lib/tools-api.ts` | sections incl. "E-mail authentication" |

**Consequence:** Step 11 of the specification (SPF/DKIM/DMARC/MX/PTR/SMTP health) is largely
**already implemented and in production use** as Tools Center features. The Email Trace Centre must
*consume* them and must not create a second DNS checker.

### 1.6 Messaging, mailers and delivery vocabulary already in the schema

| Fact | Evidence |
| --- | --- |
| Exactly one outbound mailer: `sendTransactionalEmail()` posts to `NOTIFICATION_EMAIL_WEBHOOK_URL`; with no transport configured it returns `manual`, never a fake `sent` | `src/lib/transactional-email.ts` |
| Notifications queue in `notification_outbox` and are delivered by the worker | `src/services/notification-outbox-service.ts` |
| The Unified Inbox already has a delivery vocabulary on `inbox_messages.delivery_status`: `received, queued, sent, delivered, failed, read, manual, not_applicable` | migrations 0078, 0081; `src/inbox/inbox-service.ts` |
| A PIN verification mail queue exists with its own retry/status lifecycle | migration 0085, `src/services/security-pin-email-service.ts` |

**Consequence:** the trace statuses are a *transport-event* vocabulary, not a replacement for
`inbox_messages.delivery_status`. The relationship must be documented (mapping in §4.5) so a future
reader does not merge two different meanings into one column, and so the Email Trace Centre never
becomes a second inbox or a second mailer.

### 1.7 Frontend conventions

| Fact | Evidence |
| --- | --- |
| Pages are flat files in `frontend/src/pages/` (`AdminXxxPage.tsx`, `AccountXxxPage.tsx`, `DashboardXxxPage.tsx`) | `frontend/src/pages/` |
| Routes are declared in one file; admin pages sit inside a `<RequireRole roles={['staff','admin','super_admin']}>` group | `frontend/src/App.tsx:388+` |
| API clients are per-domain modules in `frontend/src/lib/*-api.ts` built on `apiFetch` (relative URLs, typed errors, 401 → session invalidation) | `frontend/src/lib/api.ts`, `frontend/src/lib/dns-api.ts` |
| Data loading hook `useApiResource` handles loading/error/empty | `frontend/src/lib/useApiResource.ts` |
| Public navigation is generated from `shared/site/registry.json` into `registry.generated.ts`; a link-integrity test fails if a registry path has no route | `shared/site/registry.json`, `scripts/site/generate.mjs`, `frontend/tests/unit/link-integrity.test.ts` |
| Staff shortcuts live in the account sub-nav in `frontend/src/layout/Header.tsx` | `Header.tsx` `ACCOUNT_LINKS` / admin links |

### 1.8 What does **not** exist today

Verified absent — these are the gaps this feature must fill:

1. Any Exim, mail-log, mail-queue or delivery-trace code, table or endpoint (`grep -ri "exim|email_trace|mail_queue"`
   returns only the PIN mail queue, the inbox and unrelated copy).
2. Any SSH/remote-exec facility in the Node app (no `ssh2` dependency; `src/tools/network/reachability.ts`
   is TCP-only). The agent is the only remote-exec path, and it has no mail operation.
3. Any cPanel/WHM **API client** — `src/control-panels/adapters/cpanel.ts` is install metadata only
   (ports, install commands, capabilities). `whm_api_token`/`cpanel_api_token` credential *types* exist
   in the schema, but no code consumes them yet.
4. Any mail-server capability model ("does this host even run Exim?").

---

## 2. Where email delivery information actually comes from

### 2.1 The physical source of truth

On a cPanel/WHM host, delivery evidence is produced by **Exim** and written to:

| Artefact | Typical location | What it proves |
| --- | --- | --- |
| Main log | `/var/log/exim_mainlog` (rotated, often compressed) | submission (`<=`), routing decisions, remote acceptance (`=>`), extra deliveries (`->`), completion (`**`), deferrals (`==` with a reason), bounces (`*>`), rejections (`<*`) — each with the message ID, sender, recipient, SMTP code and remote host |
| Reject log | `/var/log/exim_rejectlog` | the SMTP conversation that produced a rejection |
| Panic log | `/var/log/exim_paniclog` | Exim's own failures — operational, not per-message |
| Queue | `exim -bpc` (count), `exim -bp` (listing) — read-only | messages currently undelivered, their age and last error |

WHM's *Mail Delivery Reports* screen is a UI over these same logs. Its HTTP API surface is **not
guaranteed across cPanel versions**, so it cannot be the primary contract; it can only be an optional
transport after being probed on the real host.

### 2.2 What we can and cannot claim

- A submission event (`<=`) proves the sending server accepted the message. It does **not** prove
  delivery. Status: `ACCEPTED` / `QUEUED`.
- A remote acceptance (`=>` with a 2xx SMTP reply from the destination) proves the **receiving server
  accepted** the message. Status: `DELIVERED`. It does **not** prove inbox placement, and never
  proves it was read.
- `==` is a temporary failure (4xx / timeouts / greylisting). Status: `DEFERRED`, with the reason.
- `*>` is a bounce generated by the local MTA for a permanently failed message. Status: `BOUNCED`.
- `<*` is a rejection at submission. Status: `REJECTED`.
- Anything incomplete or malformed → `UNKNOWN`, displayed as incomplete. Evidence is never invented
  and incomplete traces are explicitly labelled as still being collected.

### 2.3 Server variance is a first-class concern

Not every host in `servers` runs Exim, and not every Exim host exposes the same paths or binaries
(Plesk runs Postfix; some hardened hosts restrict log ownership; cPanel rotates and compresses logs).
The design therefore requires every source to publish a **capability report** (same shape as
`capabilityReport`) with `available | unavailable | unsupported` plus a human-readable reason, and
the UI must render "not supported on this server" rather than an empty table that looks like silence.

---

## 3. Proposed backend architecture

New module: `cloudhost247-node/src/email-trace/` (a sibling of `src/inbox/` and `src/domain-services/`).

```
src/email-trace/
  types.ts                     statuses, raw event, capability report, checkpoint (pure types)
  exim/mainlog-parser.ts       mainlog/rejectlog line -> RawTraceEvent[]        (pure, no I/O)
  exim/queue-parser.ts         `exim -bp` output -> QueueSnapshot               (pure, no I/O)
  exim/normalizer.ts           raw -> NormalisedEvent (domains, truncation, redaction)
  status-resolver.ts           (eventType, smtpCode, flags) -> DeliveryStatus   (pure, table-driven)
  dedupe.ts                    sha256 source_event_hash construction            (pure)
  capability.ts                adapter probe -> TraceCapability
  adapters/types.ts            EmailTraceAdapter interface
  adapters/agent-adapter.ts    EximTraceAdapter over the server agent (preferred)
  adapters/whm-api-adapter.ts  optional WHM API transport (probing only; see §12)
  adapters/unsupported.ts      honest no-op adapter
  trace-service.ts             EmailTraceService  (orchestrates a collection run)
  trace-repository.ts          EmailTraceRepository (all SQL for the three tables)
  access-control.ts            EmailTraceAccessControl (tenant + role resolution)
  audit.ts                     EmailTraceAuditService (wraps src/lib/audit.ts)
  retention.ts                 retention sweep + investigation holds
  routes/customer.ts           /api/v1/email-trace*
  routes/admin.ts              /api/v1/admin/email-trace*
```

Mapping to the names required by the specification:

| Required component | Proposed file |
| --- | --- |
| `EmailTraceService` | `trace-service.ts` |
| `EmailTraceRepository` | `trace-repository.ts` |
| `EmailTraceCollector` | `trace-service.ts` (`runCollection`) + `src/worker/email-trace-sweep.ts` |
| `EmailTraceParser` | `exim/mainlog-parser.ts`, `exim/queue-parser.ts` |
| `EmailTraceNormalizer` | `exim/normalizer.ts` |
| `EmailTraceStatusResolver` | `status-resolver.ts` |
| `EmailTraceAccessControl` | `access-control.ts` |
| `EmailTraceAuditService` | `audit.ts` |
| `EximTraceAdapter` | `adapters/agent-adapter.ts` (implements `EmailTraceAdapter`) |

### 3.1 Collection flow (one source, one run)

1. Sweep selects sources that are `collection_enabled`, whose `next_run_at` is due, and whose server
   is `status = 'active'`.
2. Acquire the worker lease, open an `email_trace_collection_runs` row (`started_at`, `status='running'`).
3. `adapter.probe(server)` → capability. `unsupported`/`unavailable` ends the run honestly (no events).
4. `adapter.collect(server, checkpoint)` returns raw events + a new checkpoint + warnings.
5. Parser → normalizer (domain extraction, truncation of free-text fields, control-character
   stripping) → status resolver.
6. Reject records that fail validation (missing message ID, impossible timestamp, non-address
   recipient) and count them in `records_rejected` — never silently drop.
7. Insert with `ON CONFLICT (source_server_id, source_event_hash) DO NOTHING`; the affected-row count
   is `records_collected`.
8. Update `email_trace_sources` checkpoint + `last_success_at`; close the run row with counts,
   `result` and `error_class`.
9. On a recoverable error, keep the previous checkpoint, record the error (sanitised), and let the
   next cycle retry. On repeated failure the source flips to `error` and the admin dashboard shows it.

**Hard rules encoded in the design:** the collector never deletes or truncates a source log, never
runs `exim -M*` (retry/force/delete), never edits Exim configuration, never restarts a service, never
accepts a command from HTTP, and never stores message bodies or attachments.

### 3.2 What the collector sends over the agent

One new fixed operation on the agent, no parameters that select a shell command:

```
POST /v1/mail/trace      body: { since: "2026-11-08T10:00:00Z", maxEvents: 5000 }
                         ->    { capability, serverTime, events: [...], queue: {...}, nextSince, warnings }
```

The agent side runs a **fixed, compiled-in** collector (read the rotated mainlog from a configured
path, `stat` for growth, tail from the checkpoint, optional `exim -bpc`). There is no generic exec,
no path interpolation from the request body, and no way to ask for arbitrary files. The response is
redacted on the agent (no headers beyond what §4.1 lists, no body, no credentials, no local paths).

---

## 4. Data model

Three tables, one migration (`database/migrations/0089_create_email_trace_centre.sql`), following the
repository's header-comment convention (why, what it deliberately does not store, and what it
assumes). UUID primary keys, `timestamptz`, `jsonb` only where the shape is genuinely open.

### 4.1 `email_trace_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `trace_id` | varchar(128) not null | the message identity the trace is grouped by (Exim message ID, normalised; `-…` suffix stripped) |
| `provider_message_id` | varchar(255) null | the raw source identifier, kept for cross-referencing with a server operator |
| `hosting_account_id` | uuid null → `customer_services(id)` ON DELETE SET NULL | resolved at collection time from recipient domain + server; null when it cannot be attributed |
| `customer_id` | uuid null → `users(id)` ON DELETE SET NULL | denormalised owner for fast tenant filters; always derived server-side |
| `domain_id` | uuid null → `customer_domains(id)` ON DELETE SET NULL | when the domain is a registered customer domain |
| `sender` | varchar(320) not null | full address, truncated to RFC length |
| `recipient` | varchar(320) not null | |
| `sender_domain` / `recipient_domain` | varchar(255) not null | lower-cased, used for filters and ownership resolution |
| `event_type` | varchar(32) not null | `submission, routing, delivery, deferral, bounce, rejection, completion, queue_snapshot` |
| `delivery_status` | varchar(16) not null | `ACCEPTED, QUEUED, PROCESSING, DEFERRED, DELIVERED, BOUNCED, REJECTED, FAILED, UNKNOWN` (CHECK) |
| `smtp_response_code` | integer null | 0–599 CHECK |
| `smtp_response_text` | varchar(500) null | truncated, control characters stripped |
| `remote_hostname` | varchar(255) null | destination MX/FQDN as logged |
| `event_timestamp` | timestamptz not null | from the log line, in UTC; never `now()` |
| `source_server_id` | uuid not null → `servers(id)` ON DELETE CASCADE | the source of the evidence |
| `source_event_hash` | char(64) not null | sha256 of `server|message_id|event_type|timestamp|recipient|smtp_code` |
| `retention_hold` | boolean not null default false | set when a trace is part of an investigation; blocks the retention sweep |
| `created_at` | timestamptz not null default now() | |

Constraints and indexes:

```sql
UNIQUE (source_server_id, source_event_hash)                  -- deduplication, the whole point
INDEX (trace_id, event_timestamp)                              -- timeline
INDEX (recipient_domain, event_timestamp DESC)                 -- domain view
INDEX (sender, event_timestamp DESC)                           -- "did we send from this address"
INDEX (hosting_account_id, event_timestamp DESC)               -- customer isolation
INDEX (source_server_id, event_timestamp DESC)                 -- per-server view
INDEX (delivery_status, event_timestamp DESC) WHERE delivery_status IN
       ('DEFERRED','BOUNCED','REJECTED','FAILED')              -- the "problems" dashboard
CHECK (length(recipient) > 3 AND position('@' in recipient) > 1)
```

**Deliberately not stored:** message bodies, attachments, full headers, SMTP AUTH credentials,
tokens, IP-level routing internals, raw log lines, or anything from a mail account that is not
CloudHost247 infrastructure.

### 4.2 `email_trace_sources`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `server_id` | uuid not null → `servers(id)` ON DELETE CASCADE, UNIQUE | one source row per server |
| `provider_type` | varchar(32) not null | `exim_cpanel`, `exim_standalone`, `postfix` (reported unsupported), `unknown` |
| `collection_method` | varchar(24) not null | `agent`, `whm_api`, `none` |
| `capability` | jsonb not null default `'{}'` | last probe: which evidence classes are available, and why not |
| `checkpoint` | jsonb not null default `'{}'` | `{ inode, offset, lastTimestamp, lastMessageId }` |
| `collection_enabled` | boolean not null default false | opt-in per server, never implied |
| **`last_success_at`** | timestamptz null | |
| **`last_failure_at`** | timestamptz null | |
| `last_error_code` | varchar(64) null | classification, e.g. `agent_unreachable`, `permission_denied`, `parse_failed` |
| `last_error_message` | varchar(500) null | sanitised; never contains a path, host key or credential |
| **`status`** | varchar(24) not null default `not_configured` | `not_configured, ok, degraded, error, disabled` |
| `config_reference` | varchar(64) null | *which* stored credential to use (`agent_secret`, `whm_api_token`) — a reference, never a secret |
| `retention_days_override` | integer null | per-server override of the global setting |
| `created_at` / `updated_at` | timestamptz | |

No credential, token, password or key is stored in this table; secrets stay in `server_credentials`
(encrypted, write-only, rotation-audited). `config_reference` is only a *name*.

### 4.3 `email_trace_collection_runs`

`id`, `source_id` → sources, `server_id` → servers, `started_at`, `completed_at`, `status`
(`running, ok, partial, failed, skipped`), `records_seen`, `records_collected`, `records_rejected`,
`error_class`, `error_message` (sanitised), `checkpoint_after` (jsonb), `lease_holder`,
`duration_ms`. Indexed on `(source_id, started_at DESC)` and `(status, started_at DESC)`, trimmed by
retention.

### 4.4 Retention

| Class | Default | Control |
| --- | --- | --- |
| Raw source logs | untouched, on the server | the platform never deletes them; the host's own rotation policy governs them |
| Normalised events | 30 days | `platform_settings` key `email_trace.retention_days` (+ per-source override) |
| Collection runs | 90 days | `email_trace.runs_retention_days` |
| Audit records | per existing `audit_logs` policy | unchanged |

`retention_hold = true` rows are never swept. The sweep reports how many rows it held back, so a
silent gap cannot appear during an investigation.

### 4.5 Status vocabulary alignment (why not reuse `inbox_messages.delivery_status`)

`inbox_messages.delivery_status` describes **an outbound reply the platform wrote** (`received,
queued, sent, delivered, failed, read, manual, not_applicable`). `email_trace_events.delivery_status`
describes **a transport event observed on a mail server**. They answer different questions:

| Trace status | Meaning | Inbox equivalent |
| --- | --- | --- |
| `ACCEPTED` | our MTA accepted the submission | `queued` |
| `QUEUED` | message is in the queue (snapshot) | `queued` |
| `PROCESSING` | delivery attempt in progress | — |
| `DEFERRED` | temporary failure, will retry | — |
| `DELIVERED` | the receiving server accepted it | `delivered` (but see §2.2: not inbox placement) |
| `BOUNCED` | returned as undeliverable | `failed` |
| `REJECTED` | refused at submission | `failed` |
| `FAILED` | permanent processing failure | `failed` |
| `UNKNOWN` | evidence insufficient | — |

The two are linked by message ID where possible; neither table overwrites the other.

---

## 5. API surface

Two route modules, both registered in `src/app.ts`, both returning plain JSON with the repo's typed
errors and `limit`/`offset` pagination (cap 200).

### 5.1 Customer (`src/email-trace/routes/customer.ts`)

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /api/v1/email-trace` | customer or staff | list, scoped to the caller's own `customer_services` / `customer_domains` |
| `GET /api/v1/email-trace/summary` | customer or staff | counts by status for the caller's scope, with `scope` echoed back |
| `GET /api/v1/email-trace/:traceId` | customer or staff | detail; 404 (not 403) when the trace belongs to someone else |
| `GET /api/v1/email-trace/:traceId/timeline` | customer or staff | ordered events + `complete: boolean` |
| `GET /api/v1/email-trace/domains/:domainId` | customer or staff | requires ownership of that domain |
| `GET /api/v1/email-trace/health` | customer or staff | capability/health of *their* sources, phrased without infrastructure detail |

`traceId` is validated against `^[A-Za-z0-9._-]{6,128}$` before it touches SQL (bound parameters
regardless). Filters: `sender`, `recipient`, `domain`, `messageId`, `status`, `smtpCode`, `from`,
`to`, `limit`, `offset`. Rate limit: 120/minute per user.

### 5.2 Administrator (`src/email-trace/routes/admin.ts`)

| Route | Role | Notes |
| --- | --- | --- |
| `GET /api/v1/admin/email-trace` | staff, admin, super_admin | cross-account list with account/domain/server filters |
| `GET /api/v1/admin/email-trace/queue` | staff+ | latest queue snapshots per server |
| `GET /api/v1/admin/email-trace/summary` | staff+ | dashboard counters + collection health |
| `GET /api/v1/admin/email-trace/collection-runs` | staff+ | run history, filters by source/status |
| `POST /api/v1/admin/email-trace/collect` | **admin, super_admin** | manual run for one source; rate limited to 1/5 min per source; audited |
| `GET /api/v1/admin/email-trace/sources` | **super_admin** | source configuration + capability (no secrets) |
| `PUT /api/v1/admin/email-trace/sources/:id` | **super_admin** | enable/disable, method, retention override; audited |

No endpoint returns a log line, a file path, a host credential or a shell result. Errors are
classified (`agent_unreachable`, `capability_unsupported`, `parse_failed`, `permission_denied`) with
a customer-safe message.

---

## 6. Frontend architecture

| File | Purpose |
| --- | --- |
| `frontend/src/lib/email-trace-api.ts` | typed client over `apiFetch` (types mirror the API; no `any`) |
| `frontend/src/pages/AdminEmailTracePage.tsx` | `/admin/email-trace` — dashboard counters, filters, trace table, collection health strip |
| `frontend/src/pages/AdminEmailTraceDetailPage.tsx` | `/admin/email-trace/:traceId` — metadata, timeline, SMTP evidence, source server, completeness banner |
| `frontend/src/pages/AccountEmailTracePage.tsx` | `/account/email-trace` — customer search + timeline, domain filter |
| `frontend/src/components/email-trace/TraceTimeline.tsx` | shared timeline (status chips, SMTP code, remote host, deferral/bounce reason) |
| `frontend/src/components/email-trace/TraceFilters.tsx` | shared filter bar with URL-synced state |
| `frontend/src/components/email-trace/CollectionHealth.tsx` | "last successful collection / degraded / not supported", worded honestly |

Routes are added to the existing admin `<RequireRole>` group and to the account group in
`frontend/src/App.tsx`. Navigation entries are added to `shared/site/registry.json` (then
`node scripts/site/generate.mjs`) only for customer-visible paths; the staff shortcuts go into the
account sub-nav in `Header.tsx`. The link-integrity test enforces that every registry path is served.

UI honesty rules, enforced in the components: an empty list says *why* it is empty (no source
configured / collection failing / no messages in range); a partial trace shows "still being
collected"; a missing field renders as `Not available` rather than blank; the word "delivered" is
never rendered without a `DELIVERED` event behind it.

---

## 7. Server permissions required (infrastructure, not application)

| Need | Why | Least-privilege shape |
| --- | --- | --- |
| Read access to Exim logs | the evidence | dedicated group `ch247-mailtrace` with read (not write) on `/var/log/exim_mainlog*` and `/var/log/exim_rejectlog*`; no access to `exim_paniclog` in the customer path |
| `exim -bpc` / `exim -bp` (read-only queue listing) | queue monitoring | a sudoers entry pinned to those exact commands, `NOPASSWD`, no shell, or a small setuid-free wrapper |
| Agent runtime + HMAC secret | secure transport | existing `agent_secret`; new agent version deployed with the `mail.trace` operation allowlisted |
| cPanel/WHM API token (optional path) | only if the host's WHM exposes Mail Delivery Reports over API | existing `server_credentials.whm_api_token`; read-only scope; probed, never assumed |
| No write permissions | by design | the collector needs no write access to mail configuration, queues or logs |

Nothing here is applied automatically. A server that has not been granted these permissions reports
`unavailable` with a reason, and the feature stays honest about it.

---

## 8. Security and privacy controls

| Control | Implementation |
| --- | --- |
| Role-based access | `requireRole` on every route; role re-read from the database per request |
| Tenant isolation | customer queries always join through `customer_services`/`customer_domains` for the authenticated `userId`; ownership filters are added server-side, never by the client |
| IDOR resistance | detail lookups return **404** for traces outside the caller's scope; message IDs are validated, never concatenated into SQL |
| No raw log exposure | the API only ever returns normalised events; raw lines never leave the server |
| Query validation | zod on every query/param/body; whitelisted `ORDER BY` columns; `limit` capped at 200 |
| Rate limiting | per-route `@fastify/rate-limit` on list (120/min), manual collect (1 per source per 5 min) |
| Log-injection safety | control characters stripped from `smtp_response_text`/reasons at normalisation time; React escapes on render; server logs never interpolate recipient addresses at info level |
| Credentials | reuse `server_credentials` + `src/lib/keyring.ts` (AES-256-GCM, key versions); nothing new stored in plaintext; no secret ever returned by an endpoint |
| Audit | source enable/disable, manual collection, retention changes and any future queue action are written to `audit_logs` with actor, IP and user agent |
| Email metadata sensitivity | full addresses are stored only because tracing requires them; retention 30 days by default; a `masked` display mode (local part partly hidden for non-owner staff) is proposed for approval; exports are not offered in phase 1 |
| SSRF / remote calls | any outbound probe reuses `src/tools/core/ssrf.ts`; the collector path is outbound-only to registered servers, never to a caller-supplied host |
| Failure handling | errors are classified and sanitised; a failed collection never leaks a path, host key or stack |

---

## 9. Testing strategy

New tests follow the existing layout (`tests/unit`, `tests/integration`, `frontend/tests/unit`), run
with `npx vitest run` from `cloudhost247-node/`.

**Unit (fixtures, clearly labelled as fixtures)**
`tests/unit/email-trace-mainlog-parser.test.ts`, `…-queue-parser.test.ts`,
`…-status-resolver.test.ts`, `…-normalizer.test.ts`, `…-dedupe.test.ts`,
`…-retention.test.ts`.
Fixtures live in `tests/fixtures/email-trace/*.log` with a header line stating they are synthetic
lines modelled on Exim's documented format — **not** captures from a live server, and not evidence
that live parsing works.

**Integration (PGlite + `buildApp`, the existing harness)**
`tests/integration/email-trace-collection.test.ts` (fake adapter → repository → timeline),
`…-isolation.test.ts` (cross-customer and cross-account attempts, IDOR on `traceId`, 404 not 403),
`…-rbac.test.ts` (customer/staff/admin/super_admin matrix, manual collect refused to staff),
`…-failure-recovery.test.ts` (adapter error, interrupted run, checkpoint preserved, re-collection
deduplicates), `…-retention.test.ts` (sweep respects `retention_hold`).

**Security**
Malformed message IDs, oversized inputs, SQL-injection strings in filter fields, log-injection
payloads inside SMTP text, credential-leak assertions (no secret in any response body or audit
metadata), and rate-limit behaviour.

**Frontend**
`frontend/tests/unit/admin-email-trace-page.test.tsx` (dashboard, filters, empty/error states),
`…-trace-timeline.test.tsx`, `…-account-email-trace-page.test.tsx`, plus the design-system and
admin-RBAC tests that already exist.

**Verification commands** (unchanged from the repo's conventions):

```bash
cd cloudhost247-node
npx tsc -p tsconfig.json --noEmit          # backend types
npx tsc -p frontend/tsconfig.json --noEmit  # frontend types
npx vitest run                             # unit + integration + frontend
```

Live verification additionally requires a mail server (see §12) and is not part of the automated
suite.

---

## 10. Exact files to create or modify

### Create

| File | Slice |
| --- | --- |
| `database/migrations/0089_create_email_trace_centre.sql` | 1 — **done** |
| `src/db/email-trace.ts` (`EmailTraceRepository` + row types — this is the repository; there is no separate `src/email-trace/trace-repository.ts`) | 1 — **done** |
| `src/email-trace/types.ts`, `status-resolver.ts`, `dedupe.ts`, `exim/mainlog-parser.ts`, `exim/queue-parser.ts`, `exim/normalizer.ts` | 1 — **done** |
| `src/email-trace/trace-service.ts`, `access-control.ts`, `audit.ts`, `capability.ts`, `collector.ts`, `adapters/exim-agent.ts` | 2 — **done** (retention SQL lives in `src/db/email-trace.ts`) |
| `src/worker/email-trace-sweep.ts` | 2 |
| `src/email-trace/routes/customer.ts`, `src/email-trace/routes/admin.ts` | 3 |
| `frontend/src/lib/email-trace-api.ts` | 4 |
| `frontend/src/pages/AdminEmailTracePage.tsx`, `AdminEmailTraceDetailPage.tsx`, `AccountEmailTracePage.tsx` | 4 |
| `frontend/src/components/email-trace/{TraceTimeline,TraceFilters,CollectionHealth}.tsx` | 4 |
| `tests/unit/email-trace-*.test.ts`, `tests/integration/email-trace-*.test.ts`, `tests/fixtures/email-trace/*` | 1–3 |
| `frontend/tests/unit/email-trace-*.test.tsx` | 4 |
| `docs/EMAIL-TRACE-CENTRE.md` (operator guide, verification status, capability matrix) | 5 |

### Modify

| File | Change |
| --- | --- |
| `src/app.ts` | register the two route modules |
| `src/worker/main.ts` | schedule the trace sweep (interval + lease), gated by a setting |
| `src/config/env.ts` | one non-secret flag (`EMAIL_TRACE_ENABLED`, default off) |
| `frontend/src/App.tsx` | two admin routes (inside `RequireRole`) + one account route |
| `frontend/src/layout/Header.tsx` | staff shortcut in the account sub-nav |
| `shared/site/registry.json` (+ regenerate `frontend/src/navigation/registry.generated.ts`) | customer nav entry, if approved |
| `server-agent/src/server.js` (+ tests) | **the fixed `mail.trace` operation** — separate approval, separate release |
| `server-agent/README.md` | document the new operation and its permissions |

Nothing under `modules/`, `crons/`, `templates/`, any `*.php`, `src/whmcs/`, `src/billing*`,
`src/payments*` or `platform/` is touched.

---

## 11. Implementation slices (each one stops for review)

| Slice | Content | Ends with |
| --- | --- | --- |
| **1** | Migration + repository + parser/normalizer/resolver + unit fixtures | `IMPLEMENTED — NOT LIVE-VERIFIED`; no server contact, no UI |
| **2** | Collector, adapter interface, capability probe, runs, dedupe, worker sweep + integration tests with a fake adapter | `IMPLEMENTED — NOT LIVE-VERIFIED` |
| **3** | Customer + admin endpoints, RBAC, tenant isolation, audit, rate limits + security tests | `IMPLEMENTED — NOT LIVE-VERIFIED` |
| **4** | Admin and customer UI, timeline, filters, empty/error states + frontend tests | `UI ONLY` until slice 5 supplies data |
| **5** | Agent `mail.trace` operation + permissions runbook + live verification on one authorised host | the only slice that can produce `IMPLEMENTED AND VERIFIED` |
| **6** | Domain diagnostics page wiring (reuses the existing Tools Center checks) | `IMPLEMENTED AND VERIFIED` for DNS parts, `BLOCKED` for SMTP banner checks against servers we may not probe |

---

## 12. Features that cannot be verified without a connected mail server

These will be reported as `IMPLEMENTED — NOT LIVE-VERIFIED` or `BLOCKED`, never as verified:

1. That the Exim mainlog parser matches the format produced by the cPanel version actually deployed
   (log formats drift between Exim builds and cPanel releases).
2. Real message IDs, real SMTP response codes and real remote hostnames (fixtures prove the code
   path, not the production format).
3. Rotated/compressed log handling (`.1`, `.gz`, inode change mid-run) on a real host.
4. Queue counts and oldest-message age from `exim -bpc`/`-bp` under real load.
5. Whether the deployed WHM exposes Mail Delivery Reports through a stable API call — this must be
   probed per host before any WHM adapter is written; the function name and payload are **unverified**
   and will not be guessed in code.
6. Actual permission grants (log group membership, sudoers entry) on a managed server.
7. Incremental checkpoint behaviour across a log rotation while the worker is stopped.
8. Whether a given customer's mail actually flows through the traced server (split-routing, external
   relays and remote mailboxes are out of scope and must be shown as "not traced here").
9. Any claim about inbox placement, reading or opening — permanently out of scope, by design.

---

## 13. Capability classification of what exists today

| Item | Classification | Note |
| --- | --- | --- |
| SPF / DKIM / DMARC / MX / PTR / DNSSEC checking | **IMPLEMENTED AND VERIFIED** | Tools Center, in the shipped product (`src/tools/dns/*`, `DomainHealthPage.tsx`) |
| SMTP banner / STARTTLS / AUTH capability probing | **IMPLEMENTED AND VERIFIED** | `src/tools/developer/smtp.ts` (targets public MX hosts) |
| Domain email-auth health UI | **IMPLEMENTED AND VERIFIED** | `frontend/src/pages/DomainHealthPage.tsx` |
| Server inventory, encrypted credentials, agent transport | **IMPLEMENTED AND VERIFIED** | migrations 0028, `server-agent/`, `src/routes/agent.ts` |
| Audit trail, RBAC, rate limiting, worker lease | **IMPLEMENTED AND VERIFIED** | `src/lib/audit.ts`, `src/lib/require-role.ts`, `src/app.ts`, `src/worker/worker-lease.ts` |
| Exim collection, trace tables, trace endpoints, trace UI | **NOT IMPLEMENTED** | this proposal |
| `mail.trace` agent operation | **NOT IMPLEMENTED** | needs approval + release |
| WHM Mail Delivery Reports transport | **BLOCKED** | no verified API contract; requires a live host to probe |
| Live end-to-end verification | **BLOCKED** | requires an authorised mail server and the permissions in §7 |

---

## 14. Decisions needed before Session 2 starts

1. **Approve the agent extension.** `server-agent` is the only safe transport; adding a fixed
   `mail.trace` operation changes a released component and needs a version + rollout plan.
2. **Approve what may be stored.** Full addresses (needed for tracing, 30-day retention) versus
   masked addresses (safer, less useful for a real investigation). Recommendation: full addresses,
   staff and owner visibility only, mask in list views for non-owner staff.
3. **Approve default retention** (events 30 days, runs 90 days) and the per-server override.
4. **Confirm customer visibility scope**: own `customer_services` accounts and own `customer_domains`
   only — nothing keyed on a browser-supplied customer ID.
5. **Confirm the WHMCS boundary** for the record: no PHP, no WHMCS database access, no billing or
   provisioning side effects; the feature reads CloudHost247 infrastructure logs only.
6. **Confirm which servers count as mail servers** (all `server_type IN ('CPANEL','SHARED')`, or an
   explicit per-server opt-in). Recommendation: opt-in per server, default off.

Until items 1 and 6 are settled, slices 1–4 can be built and tested entirely offline (fixtures and a
fake adapter) without touching any live infrastructure, which is the intended order.


---

## 15. Slice 1 delivery report

**Scope delivered:** storage schema, data access, source-record parsing, normalisation, status
resolution and event identity. Nothing in Slice 1 contacts a server, issues SQL from a route, or is
reachable by a user.

### 15.1 Files

| File | What it contains |
| --- | --- |
| `cloudhost247-node/database/migrations/0089_create_email_trace_centre.sql` | `email_trace_events`, `email_trace_sources`, `email_trace_collection_runs`; dedupe unique index; tenant/status indexes; CHECK constraints for statuses, event types, SMTP code range, address shape, hash length, retention overrides |
| `cloudhost247-node/src/db/email-trace.ts` | Repository: insert with `ON CONFLICT DO NOTHING`, scoped list/detail/summary, sources, collection runs, latest queue snapshots, retention trims |
| `cloudhost247-node/src/email-trace/types.ts` | Status/event vocabulary, parsed and normalised shapes, queue snapshot shape |
| `cloudhost247-node/src/email-trace/status-resolver.ts` | Flag → status mapping with an explanation per decision |
| `cloudhost247-node/src/email-trace/dedupe.ts` | Deterministic 64-char event identity |
| `cloudhost247-node/src/email-trace/exim/mainlog-parser.ts` | Single-line and whole-file Exim message-log parsing |
| `cloudhost247-node/src/email-trace/exim/queue-parser.ts` | `exim -bp` parsing, ages, deferred detection |
| `cloudhost247-node/src/email-trace/exim/normalizer.ts` | Address parsing, control-character stripping, secret redaction, truncation, hashing |
| `cloudhost247-node/tests/fixtures/email-trace/*` | Synthetic fixtures + a README stating they are synthetic |
| `cloudhost247-node/tests/unit/email-trace-*.test.ts` | 45 unit tests across parser, resolver, normaliser, dedupe, queue |
| `cloudhost247-node/tests/integration/email-trace-repository.test.ts` | 14 tests against PGlite with the real migration runner |

### 15.2 Rules encoded (and why)

- **Deduplication is a constraint**, not an application convention: a re-collected window returns
  `{ inserted: 0, duplicates: n }` instead of double-counting.
- **`DELIVERED` never means "inbox".** The resolver's explanation literally says transport, not
  placement, and a delivery line carrying a 5xx degrades to `UNKNOWN`.
- **`**` splits into `BOUNCED` (remote 5xx) and `FAILED` (no SMTP reply).** Mapping taken from
  Exim's documented message-log flag table; **still to be confirmed against a live host**, because
  flag semantics are the single most consequential thing a real log can disprove.
- **Nothing is invented:** a line without a message id, without a recipient, or without a known
  sender is rejected and counted, never stored with a placeholder.
- **Log-injection boundary:** control characters are stripped from free text, and `A=<auth>` /
  `password=` / `Bearer` shapes are redacted before storage.
- **Tenant scope is a parameter:** an empty scope means "matches nothing", not "no filter".
- **Retention respects investigations:** `retention_hold` rows are counted as held, never deleted.

### 15.3 Verification

```bash
cd cloudhost247-node
npx tsc -p tsconfig.json --noEmit            # clean
npx vitest run tests/unit/email-trace-*.test.ts tests/integration/email-trace-repository.test.ts
# → 6 files, 59 tests passed
```

Regression check that the new migration does not disturb existing suites (both of these run all 89
migrations from scratch on PGlite):

```bash
npx vitest run tests/integration/auth-flow.test.ts tests/integration/agent-deployments-api.test.ts
# → included in: 7 files, 70 tests passed
```

### 15.4 Classification

| Capability | Classification | Evidence |
| --- | --- | --- |
| Schema, constraints, indexes, retention without deleting held rows | **IMPLEMENTED AND VERIFIED** | PGlite integration tests run the real migration |
| Deduplication of re-collected events | **IMPLEMENTED AND VERIFIED** | `insertEmailTraceEvents` twice → 0 inserted, n duplicates |
| Tenant scoping / IDOR resistance at the query layer | **IMPLEMENTED AND VERIFIED** | scope tests; foreign trace returns `null` |
| Status resolution rules (incl. refusing contradictions) | **IMPLEMENTED** | unit tests; **not** verified against real log semantics |
| Exim mainlog + queue parsing | **IMPLEMENTED — NOT LIVE-VERIFIED** | synthetic fixtures only |
| Anything reading a mail server | **NOT IMPLEMENTED** | Slice 2+ |
| Any HTTP endpoint or UI | **NOT IMPLEMENTED** | Slices 3–4 |


---

## 16. Slices 2–5 as built (deltas from the proposal)

Where the implementation departed from this document, and why:

1. **No separate `src/email-trace/adapters/whm.ts`.** The WHM API transport is BLOCKED (see the delivery
   report): no verifiable function name exists in this repository and the WHMCS integration is frozen.
   The adapter interface has one implementation, `agent`, and a future transport must be added
   deliberately rather than appearing as a branch inside collection logic.
2. **`access-control.ts` exposes two scope functions, not one.** `scopeForOwnMail()` always returns the
   caller's own id (never `{}`, even for an admin on the customer page) and `scopeForAdminConsole()` is
   the only way to obtain an unrestricted scope. A single function that switched on role was rejected
   because an administrator opening `/account/email-trace` would then have seen the whole platform.
3. **Run status describes the collection, not the mail.** A window full of connection-level spam
   rejections is `ok`; a window that could not be read, or where nothing at all could be stored, is
   `partial`. Rejected lines are still counted and displayed per run.
4. **Attribution uses `customer_domains` only.** `customer_services` has no domain column, so
   `hosting_account_id` stays `NULL` rather than being guessed. Unattributed events are stored (staff
   only) instead of being dropped or shown to everybody.
5. **The agent is a new module, not a new generic endpoint.** `server-agent/src/mail-trace.js` reads one
   allowlisted log with an 8 MiB cap and line alignment, and runs exactly `exim -bp`. A requested path
   outside the allowlist causes the whole call to read nothing, so a caller cannot probe the filesystem.
6. **Customer route vocabulary endpoint added:** `GET /api/v1/email-trace/statuses` publishes labels and
   explanations so the UI cannot invent its own wording.
7. **DNS diagnostics are reused, not reimplemented.** `src/email-trace/diagnostics.ts` composes the
   Tools Center's own `spfCheck`, `dmarcCheck`, `dkimCheck`, `mxLookup` and `smtpTest` behind one
   ownership-checked endpoint (`GET /api/v1/email-trace/domains/:domainId/diagnostics`). No second
   DNS or SMTP implementation exists. The independent lookups run concurrently under a per-check
   timeout, and a check that cannot run is `NOT_CHECKED` — never `PASS`.
8. **Retention controls exist.** `PATCH /api/v1/admin/email-trace/events/:eventId` pins/releases a
   row (`retention_hold`), audited before the change, and the admin page carries both the pin control
   and the per-server `retention_days_override`. Releasing a hold deletes nothing; it only stops
   protecting the row from the next sweep.
