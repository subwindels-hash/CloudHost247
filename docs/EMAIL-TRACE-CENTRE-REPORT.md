# Email Trace Centre — delivery report

**Feature:** native Email Trace Centre (no external email-tracking API)
**Branch:** `arena/b4931f08-cloudhost247`
**Commits:** `c9f134e` (schema + parsers) · `4cd8afb` (collector, agent op, API, sweep) · `e1c75ea` (UI, navigation, this report)
**Date:** 2026-11-08

---

## 1. What exists now

A customer can open **`/account/email-trace`** and see, for their own domains only, what the mail
server recorded about their messages: submission, delivery, deferral, bounce and rejection events,
with the SMTP reply that caused each one. An administrator can open **`/admin/email-trace`** and see
per-server collection health, read-only queue snapshots taken at collection time, the collection-run
history, and every event including the ones the platform could not attribute to a customer.

Behind those two pages:

| Layer | Where | State |
| --- | --- | --- |
| Schema | `database/migrations/0089_create_email_trace_centre.sql` | 3 tables, dedupe unique index, 8 indexes, CHECK guard rails |
| Repository | `src/db/email-trace.ts` | every SQL statement for the feature |
| Parsing | `src/email-trace/exim/{mainlog-parser,normalizer,queue-parser}.ts` | Exim message log + `exim -bp` |
| Status rules | `src/email-trace/status-resolver.ts` | flag → status, contradictions → UNKNOWN |
| Identity | `src/email-trace/dedupe.ts` | deterministic 64-char event hash |
| Access | `src/email-trace/access-control.ts` | own-scope vs admin-scope, domain ownership |
| Capability | `src/email-trace/capability.ts` | what this host can/cannot show, always with caveats |
| Collection | `src/email-trace/collector.ts` | checkpoint → read → parse → attribute → insert → advance |
| Transport | `src/email-trace/adapters/exim-agent.ts` + `server-agent/src/mail-trace.js` | signed, allowlisted, bounded, line-aligned |
| API | `src/routes/email-trace-customer.ts`, `src/routes/email-trace-admin.ts` | role + tenant scoped, audited |
| Scheduling | `src/worker/email-trace-sweep.ts` | every 5 min + retention trims |
| UI | `frontend/src/pages/EmailTracePage.tsx`, `AdminEmailTracePage.tsx` | both routes registered in `App.tsx` |

---

## 2. Classification

Required format: **IMPLEMENTED AND VERIFIED** / **IMPLEMENTED — NOT LIVE-VERIFIED** / **UI ONLY** /
**BLOCKED** / **NOT IMPLEMENTED**.

### 2.1 IMPLEMENTED AND VERIFIED

Verified means: exercised by a test that runs the real code against a real PostgreSQL engine (PGlite
with the real migration runner) or a real Node process — not against a mock of the thing under test.

| Capability | Evidence |
| --- | --- |
| Migration 0089 applies cleanly on top of all 88 existing migrations | `tests/integration/email-trace-repository.test.ts`, plus `auth-flow` and `agent-deployments-api` suites re-run after the migration was added |
| Event deduplication (same window collected twice stores nothing new) | repository + collector tests: `{inserted: 0, duplicates: n}` |
| Tenant isolation at the query layer; an empty scope matches nothing | repository scope tests; API tests for 404-instead-of-403 |
| Retention deletes past-window events but **never** deletes `retention_hold` rows | `trimEmailTraceEvents` test → `{deleted: 1, held: 1}` |
| Collection run bookkeeping (seen / stored / rejected / queue / error) | collector tests |
| Failure handling: agent unreachable leaves the checkpoint untouched | collector test asserts `checkpoint = {}` after a failed run |
| Collections are opt-in; a disabled source opens no run and reads nothing | collector + API tests |
| API authorisation: customer routes scoped to the caller, admin routes 403 for non-admins | 17 API integration tests |
| Reads are audited, addresses are **not** written into the audit log | API test comparing `audit_logs.metadata` |
| Raw log lines never reach a client | API test greps the serialised response for `P=esmtpa`, `A=dovecot_login`, a subject |
| Agent refuses any log path outside its allowlist and reads nothing in that case | `server-agent/tests/mail-trace.test.js` |
| Agent read is byte-capped and always ends on a line boundary | same suite (partial-line and 8 MiB cap tests) |
| Queue access is only ever `exim -bp` (no `-Mrm`, no shell) | same suite asserts the captured `args` are exactly `['-bp']` |
| Both pages render the server's wording and never claim inbox placement / opens | `frontend/tests/unit/email-trace-pages.test.tsx` |

### 2.2 IMPLEMENTED — NOT LIVE-VERIFIED

Correct and tested against synthetic fixtures, but **no real mail server has been read**. The Exim
log format, flag semantics and queue output are all taken from documented behaviour and hand-written
fixtures; a live host is the only thing that can confirm them.

| Capability | What remains unproven |
| --- | --- |
| Exim mainlog parsing | a real log's exact spacing, aliasing and multi-line deferral shapes |
| Status mapping, especially `**` → BOUNCED (5xx) vs FAILED (no reply) | the flag table has not been checked against a live Exim on this fleet |
| `exim -bp` queue parsing, ages and deferral detection | real queue output, including messages with many recipients |
| Normaliser redaction (`A=`, `password=`, bearer tokens) | a real log's credential-bearing lines |
| Capability probe (which log path exists, whether it is readable) | whether the agent's account can read `/var/log/exim_mainlog` on a real cPanel host, which is a permissions decision nobody has made yet |
| Rotation detection (inode/size) | an actual logrotate cycle |
| Attribution of events to customers | depends on `customer_domains` being accurate; unattributed events are stored but shown only to staff |
| End-to-end collection through the worker sweep | needs an agent paired with a server and collection enabled |

### 2.3 UI ONLY

Nothing in the shipped UI falls in this bucket: every number, badge and table on both pages is
rendered from an API response produced by the code above. There is no placeholder data, no mock
provider and no hard-coded delivery status anywhere in the frontend. The DNS diagnostics panel on the
customer page is a thin caller of the existing Tools Center endpoints (`/api/tools/spf-checker`,
`/api/tools/dkim-checker`, `/api/tools/dmarc-checker`); if those tools are unavailable the panel says
`NOT_CHECKED` rather than showing a green tick.

### 2.4 BLOCKED

| Item | Why |
| --- | --- |
| WHM API / cPanel "Mail Delivery Reports" transport | No WHM API function name for historical delivery reports can be verified from this repository, and the frozen WHMCS integration must not be modified. Inventing a function name would be fabrication, so this path is **not implemented**; the agent transport is the supported one. |
| Live end-to-end verification | Requires a server with the agent installed, an Exim log the agent can read, and collection enabled — none of which exist in this environment. |
| Pre-existing Postfix/other-MTA hosts | Only Exim is implemented (`provider_type = exim_cpanel | exim_standalone`). A Postfix adapter is future work; the source row reports `postfix` as unsupported rather than pretending. |

### 2.5 NOT IMPLEMENTED

- **Retention configuration UI** — the window is server-side (`EMAIL_TRACE_RETENTION_DAYS`, per-source
  `retention_days_override` via `PATCH /api/v1/admin/email-trace/sources/:id`, exercised by tests) but
  there is no form control for the override on the admin page yet.
- **Per-message "pin" action** for `retention_hold` — the column and the retention behaviour exist and
  are tested; no endpoint or button toggles it.
- **Cross-run sender carry-forward** — a delivery line whose submission line fell outside the read
  window is rejected (counted, never guessed). Deliberate: the alternative is inventing a sender.
- **Hosting-account attribution** — `hosting_account_id` is always `NULL` today because
  `customer_services` carries no domain, so there is no honest link from a message to a service.
  Attribution uses `customer_domains` only.
- **Notifications** (e.g. "your message bounced") — not part of this feature.
- **Inbox placement, spam-folder placement, open/read tracking** — never implemented, and cannot be:
  no log on the sending host contains that information.

---

## 3. Security and privacy decisions, as shipped

1. **No arbitrary shell, no arbitrary path over HTTP.** The only mail-related operation on the agent
   is `POST /v1/mail/trace`, whose request has no field for a command. The log path is validated
   against the agent's own allowlist (`CH247_MAIL_MAINLOG_PATHS`), reads are capped at 8 MiB and end
   on a line boundary, and the queue command is invoked as `exim -bp` with no shell.
2. **Read-only by construction.** There is no code path that deletes, freezes, retries or forces a
   queued message, edits Exim configuration, or restarts a service.
3. **No bodies, no attachments, no subjects, no credentials.** The parser drops `T="subject"` and
   `A=<auth>` before an event exists; free-text fields are control-character-stripped, secret-redacted
   and truncated; raw lines are never stored or returned.
4. **Tenant isolation is a parameter, not a filter.** `scopeForOwnMail()` always returns exactly the
   caller's own id — never an unrestricted scope, even for an administrator opening the customer
   page — and the repository treats an empty scope as "matches nothing". A foreign trace returns 404,
   never 403, so the API cannot confirm another customer's message exists.
5. **Administrators are audited, not silent.** Every admin list/read/collect/config change writes an
   `audit_logs` row; collection and source changes are audited *before* they run and fail closed if
   the audit write fails. Customer reads of a trace are audited best-effort, so an audit outage cannot
   turn a customer's own history into a 500.
6. **Frozen integration respected.** Nothing in `modules/`/WHMCS was touched; no paid service was
   activated; no billing code changed.

---

## 4. Evidence

```bash
cd cloudhost247-node
npx tsc -p tsconfig.json --noEmit            # clean
npx tsc -p frontend/tsconfig.json --noEmit   # clean

npx vitest run tests/unit tests/integration/email-trace-repository.test.ts \
               tests/integration/email-trace-collector.test.ts \
               tests/integration/email-trace-api.test.ts
# unit suite green (includes 45 parser/resolver/normaliser/queue tests,
# 20 access-control + capability tests)
# integration: 14 + 10 + 17 = 41 tests green

npx vitest run frontend/tests               # full frontend suite green (includes 9 new page tests)
cd ../server-agent && npm test              # 83 tests green (12 new mail-trace tests)
```

What these numbers do **not** mean: no test in this repository has read a real Exim log, contacted a
real agent, or verified a real queue listing. Every fixture used by the unit tests is synthetic and
labelled as such in `tests/fixtures/email-trace/README.md`; the collector tests inject a fake adapter
named `FakeEximAdapter`; the API tests seed rows through the repository.

---

## 5. Honest summary for the customer-facing copy

> Statuses in this centre come from SMTP replies in our mail servers' logs. They show whether the
> receiving server accepted a message, deferred it, or rejected it. They do not show whether a message
> reached an inbox, whether it landed in spam, or whether anyone read it — no sending-side log
> contains that information, and this platform will not guess.

---

## 6. Suggested next steps (in order)

1. Pair one real server agent, enable collection for it, and re-run the four "live-unverified"
   assertions in §2.2 against its actual log. This is the single highest-value remaining action.
2. Decide the log-permission policy (does the agent's account get read access to
   `/var/log/exim_mainlog`, or is a copy made for it?) — the capability report currently surfaces this
   as `unavailable` and refuses to escalate.
3. Add the retention-override and `retention_hold` controls to the admin page (backend already
   supports both).
4. Consider a module-scoped `email_trace` permission if staff accounts should see trace data without a
   full admin role.
