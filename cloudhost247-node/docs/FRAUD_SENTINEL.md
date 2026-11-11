# Fraud Sentinel — Advisory Fraud Detection & Risk Intelligence

Fraud Sentinel is CloudHost247's fraud-detection and investigation module. It reads the activity the
platform **already records** — payments, invoices, orders, the billing ledger, authentication and
administrative audit trails, webhook deliveries, provisioning jobs, support sessions and tool-abuse
events — projects it into an idempotent event ledger, scores every active subject against a catalogue
of 40 reviewed rules, raises alerts for human review, and keeps an append-only record of what each
reviewer concluded.

It is **advisory only, by construction**. The module observes and reports. It performs no enforcement
action of any kind: it cannot approve or reject a payment, issue a refund, transfer money, change a
customer balance, seize funds, suspend an account, change a service entitlement, bypass WHMCS
authorization or override a financial control. Those capabilities do not exist anywhere in
`src/fraud-sentinel/` — not behind a flag, not behind a permission, not in a code path that is merely
never called. Every API payload that could be mistaken for a verdict carries the same advisory
contract the backend defines (`ADVISORY_ONLY` in `src/fraud-sentinel/types/index.ts`), and every screen
renders it in the server's own words rather than paraphrasing it.

Scores are **deterministic**. They are the documented sum of capped rule weights over stored rows, with
human-readable reasons and evidence references persisted beside the score. No model produces a number.
AI assistance is an optional, off-by-default summary *beside* a deterministic score, and every
assessment records whether such text is present (`ai_assisted`, `ai_engine`, `ai_summary` are
all-or-none under a database CHECK).

## Architecture

| Layer | Location |
| --- | --- |
| Migration | `database/migrations/0101_create_fraud_sentinel.sql` (additive: 9 tables, 43 indexes, 1 sequence, 40 seeded rules, 16 seeded settings) |
| Backend module | `src/fraud-sentinel/` (`controllers/`, `services/`, `repositories/`, `rules/`, `jobs/`, `notifications/`, `types/`, `utils/`) |
| API | `/api/admin/fraud-sentinel/*` — registered in `src/app.ts` by `registerFraudSentinelRoutes(app, env, pool)` |
| Worker integration | `src/worker/main.ts` → `runFraudSentinelCycle(db)` on a 5-minute sweep; each job is gated by its own schedule bucket |
| Frontend | `frontend/src/pages/fraud-sentinel/`, `frontend/src/components/fraud-sentinel/`, `frontend/src/lib/fraud-sentinel-api.ts` |
| Tests | `tests/unit/fraud-sentinel-rules.test.ts`, `tests/integration/fraud-sentinel-{migration,detection,api}.test.ts`, `frontend/tests/unit/fraud-sentinel-api.test.tsx` |
| Design record | `docs/FRAUD_SENTINEL_PLAN.md` |

### Tables (all prefixed `fraud_sentinel_`)

- `events` — the detection ledger: a normalized, redacted, **idempotent** projection of source rows.
  `dedupe_key = '<source_table>:<source_id>:<observable state>'` with a unique index, so re-ingesting a
  row in the same state inserts nothing while a genuine state change (a payment moving
  `pending → failed`) is a new observable event with its own row. `id` is derived from the dedupe key,
  so the same observable state always yields the same id.
- `rules` — the configured rule set (code, version, weight, severity, family, enabled, JSON
  parameters, recommendation, data sources, applicable subject types).
- `rule_history` — **append-only**. Every change stores a full snapshot, the change type
  (`created | updated | enabled | disabled | parameters_changed | reseeded`), who made it and the
  reason they gave. There is no UPDATE or DELETE path against this table.
- `assessments` — one scored result per subject per pass: score, level, confidence, the triggered
  rules with their weights *and* capped weights, per-family contributions, evidence references,
  recommendations, data-quality flags, the rule-set fingerprint and the window examined. A new
  assessment supersedes the previous one (`status: active | superseded`); nothing is overwritten.
- `alerts` — raised when a result is alertable. `alert_number` is `FS-` + an 8-digit sequence. A
  **partial** unique index over `dedupe_key WHERE status IN ('new','under_review','escalated')`
  guarantees one open alert per (subject, primary rule): a re-detection updates the open alert and
  increments `recurrence_count` instead of creating a duplicate. Assignment and resolution columns are
  constrained in pairs (`assigned_reviewer_id` and `assigned_at` are both null or both set).
- `investigations` — the reviewer timeline. `actor_type` is `staff` or `system`, so a scheduled pass is
  never mistaken for a person, and `action` is constrained to the 12-value vocabulary.
- `risk_history` — the score trail per subject, for trend reading.
- `false_positives` — one report per alert (unique), with a reason category, the rules the reviewer
  named and an explanation of at least 15 characters.
- `runs` — run history **and** the concurrency lock: a unique `run_key` makes the database the lock,
  exactly as `revenue_guardian_automation_runs` does.

Settings live in the existing `platform_settings` table under `fraud_sentinel.*` keys. Audits go to the
existing `audit_logs` via `src/lib/audit.ts`. Reviewer notifications ride the existing
`user_notifications` + `notification_outbox` pipeline (`src/services/notification-service`). No second
RBAC engine, no second settings store, no second notification path.

### Data flow

```
source rows (read-only)  ──ingest──▶  fraud_sentinel_events  ──assess──▶  fraud_sentinel_assessments
      11 tables                          dedupe_key unique                    │  score = Σ min(raw, cap)
                                                                               ▼
                                                     alertable? ──▶ fraud_sentinel_alerts ──▶ investigations
                                                        │                    ▲                     │
                                                        └── notify reviewers ┘        false_positives┘
```

Ingestion reads 11 source tables: `payments`, `invoices`, `orders`, `billing_ledger`,
`auth_audit_log`, `audit_logs`, `webhook_events`, `customer_services`, `provisioning_jobs`,
`admin_support_sessions`, `tool_abuse_events`. A source that cannot be read (a table absent from an
older deployment, a permission error) is **reported, never ignored**: it appears in
`ingestion.skippedSources` on the scan report and in the run notes, and the assessment records a
data-quality flag, because a score computed without a source is a weaker score and the reviewer is
entitled to know.

Subjects are enumerated from where the platform actually records the actor. `auth_audit_log` rows for
actor-authentication events carry `actor_id`, so those subjects are enumerated as actors; rows typed
`customer` are enumerated as customers. No source row is projected as `subject_type = 'ip'` — an IP
address is something many tables *record* rather than a row type of its own — so IP subjects are
derived during the scan from the ledger itself, with a floor of 5 recorded events before an address is
worth assessing (`IP_SUBJECT_MIN_EVENTS`). That derivation is the only way the two IP-subject rules
(`ACC_IP_FAILURE_SPRAY`, `ACC_SHARED_REGISTRATION_CLUSTER`) are reachable.

## Rule catalogue — 40 rules, 12 scoring families

Each rule names the rows it reads, the points it is worth, its severity, the subject types it applies
to and the recommendation it produces. Weights are reviewed defaults stored in the database, so an
operator can tune them; the table below is what a fresh migration installs.

### A. Payment fraud (category `payment`)

| Code | Family | Weight | Severity | Applies to | Reads |
| --- | --- | --- | --- | --- | --- |
| `PAY_REPEATED_FAILURES` | payment_failures | 12 | medium | customer | payments |
| `PAY_FAILURE_BURST` | payment_failures | 18 | high | customer | payments |
| `PAY_SUCCESS_AFTER_FAILURES` | payment_failures | 22 | **critical** | customer | payments |
| `PAY_DUPLICATE_ATTEMPT` | payment_integrity | 14 | medium | customer | payments, invoices |
| `PAY_METHOD_CHURN` | payment_integrity | 10 | medium | customer | payments |
| `PAY_UNUSUAL_FREQUENCY` | payment_value | 10 | medium | customer | payments |
| `PAY_UNUSUAL_VALUE` | payment_value | 16 | high | customer | payments, invoices |
| `PAY_AMOUNT_MISMATCH` | payment_integrity | 14 | high | customer | payments, invoices, billing_ledger |
| `PAY_CURRENCY_MISMATCH` | payment_integrity | 12 | medium | customer | payments, invoices, orders |
| `PAY_REFUND_REVERSAL` | payment_integrity | 12 | medium | customer | billing_ledger, payments, invoices |
| `PAY_REFUND_VELOCITY` | payment_integrity | 16 | high | customer | billing_ledger, payments |

### B. Account security (category `account_security`)

| Code | Family | Weight | Severity | Applies to | Reads |
| --- | --- | --- | --- | --- | --- |
| `ACC_LOGIN_FAILURE_CLUSTER` | account_auth | 14 | medium | customer, actor | auth_audit_log |
| `ACC_IP_FAILURE_SPRAY` | account_auth | 20 | high | **ip** | auth_audit_log |
| `ACC_NEW_GEO_LOGIN` | account_auth | 12 | medium | customer, actor | auth_audit_log |
| `ACC_NEW_DEVICE_LOGIN` | account_auth | 10 | medium | customer, actor | auth_audit_log |
| `ACC_IMPOSSIBLE_TRAVEL` | account_auth | 18 | high | customer, actor | auth_audit_log |
| `ACC_ACCESS_FREQUENCY_ANOMALY` | account_auth | 8 | low | customer, actor | auth_audit_log |
| `ACC_RECOVERY_REQUEST_BURST` | account_recovery | 14 | medium | customer, actor | auth_audit_log |
| `ACC_RECOVERY_AFTER_FAILURES` | account_recovery | 20 | high | customer, actor | auth_audit_log |
| `ACC_STEP_UP_VERIFICATION_FAILURES` | account_recovery | 12 | medium | customer, actor | auth_audit_log, audit_logs |
| `ACC_CONTEXT_CHANGE_AFTER_NEW_LOGIN` | account_change | 16 | high | customer, actor | auth_audit_log, users |
| `ACC_MFA_TAMPERING` | account_change | 22 | **critical** | customer, actor | auth_audit_log |
| `ACC_SHARED_REGISTRATION_CLUSTER` | account_cluster | 16 | high | **ip** | auth_audit_log, users |

### C. Order & service abuse (category `order_service`)

| Code | Family | Weight | Severity | Applies to | Reads |
| --- | --- | --- | --- | --- | --- |
| `ORD_ORDER_VELOCITY` | order_velocity | 12 | medium | customer | orders, order_items |
| `ORD_REPEAT_IDENTICAL_PURCHASE` | order_velocity | 14 | medium | customer | orders, order_items |
| `ORD_HIGH_VALUE_NEW_ACCOUNT` | order_value | 22 | **critical** | customer | orders, users |
| `ORD_UNPAID_ACCUMULATION` | order_value | 10 | medium | customer | orders, invoices |
| `ORD_PROVISIONING_BURST` | service_abuse | 12 | medium | customer | provisioning_jobs, orders |
| `ORD_CANCEL_REFUND_PATTERN` | service_abuse | 16 | high | customer | customer_services, billing_ledger, orders |
| `SVC_TOOL_ABUSE` | service_abuse | 14 | medium | customer, ip | tool_abuse_events |

`ORD_UNPAID_ACCUMULATION` is the one rule that deliberately compares a snapshot against live state: it
reads the current `orders` rows rather than only the ledger, and reports the divergence as
`SNAPSHOT_VS_LIVE_STATE` when the two disagree. Reading present-tense state is otherwise avoided,
because the ledger is what the module can reproduce a score from.

### D. Administrative & API activity (category `admin_api`)

| Code | Family | Weight | Severity | Applies to | Reads |
| --- | --- | --- | --- | --- | --- |
| `ADM_PRIVILEGED_ACTION_BURST` | admin_activity | 14 | medium | **actor** | audit_logs |
| `ADM_PERMISSION_CHANGE` | admin_activity | 14 | high | **actor** | auth_audit_log, users |
| `ADM_PERMISSION_CHANGE_BURST` | admin_activity | 22 | **critical** | **actor** | auth_audit_log, users |
| `ADM_STAFF_AUTH_FAILURES` | admin_activity | 16 | high | **actor** | auth_audit_log, users |
| `ADM_SUPPORT_SESSION_FANOUT` | admin_activity | 12 | medium | **actor** | admin_support_sessions |
| `ADM_OFF_HOURS_SENSITIVE` | admin_activity | 8 | low | **actor** | audit_logs |
| `ADM_SENSITIVE_CONFIG_CHANGE` | admin_activity | 12 | medium | **actor** | audit_logs |
| `ADM_MANUAL_PAYMENT_BURST` | admin_activity | 20 | **critical** | **actor** | auth_audit_log, payments, billing_ledger |
| `API_WEBHOOK_REJECT_BURST` | webhook_integrity | 16 | high | **gateway** | webhook_events |
| `API_WEBHOOK_REPLAY` | webhook_integrity | 20 | **critical** | **gateway** | webhook_events |

The administrative rules take the *actor's own account* as their subject, which is why a staff or admin
account can appear in the queue: insider-activity detection has no other subject to attach to. A
`gateway` subject is a payment-provider name, not a row id, so it is carried in `subject_label` /
`channel` (varchar 64) rather than forced into a uuid column.

## Scoring

```
raw_family   = Σ weights of the rules that fired in that family
credited     = min(raw_family, family_cap)          ← heaviest-rule-first allocation
risk_score   = clamp(0, 100, Σ credited over all families)
```

Thresholds (defaults): **medium ≥ 25, high ≥ 50, critical ≥ 75**. Family caps (defaults):

| Family | Cap | Family | Cap |
| --- | --- | --- | --- |
| payment_failures | 30 | account_cluster | 18 |
| payment_integrity | 28 | order_velocity | 22 |
| payment_value | 20 | order_value | 24 |
| account_auth | 30 | service_abuse | 22 |
| account_recovery | 22 | admin_activity | 30 |
| account_change | 24 | webhook_integrity | 22 |

The cap is the reason one noisy family cannot dominate a score: three declined payments and a
successful one is a strong signal, but forty declined payments is not forty times stronger. Each
assessment stores `family_contributions` (`raw`, `capped`, `cap`) so the breakdown remains
self-describing **after** an administrator retunes the caps — the row answers "why did this family stop
at 30?" without needing the configuration that existed at the time.

**Confidence** is derived, never asserted: `high` when there are ≥ 8 evidence rows *and* ≥ 3 triggered
rules; `medium` when ≥ 3 evidence rows *or* ≥ 2 rules; otherwise `low`. Any data-quality flag of
severity `material` downgrades it one step. An assessment carries at most 40 stored evidence rows.

**Reproducibility.** `rule_set_version` is the first 16 hex characters of a SHA-256 over every rule's
`code@version:weight:enabled`, plus the thresholds and the caps. Two assessments with the same
fingerprint were scored by the same configuration; a change to any weight, enable flag, threshold or
cap produces a new fingerprint. Changing a rule never recomputes a stored score — old assessments keep
the configuration they were computed with, which is what makes them still explainable.

**Alerting.** A result is alertable when its level reaches `alert_min_level` (default `high`), **or**
when a single `critical`-severity rule fired with a credited weight above zero and
`alert_on_critical_rule` is on (default). The second path exists because one very strong signal — many
declines then an approval, an MFA removal, a permission-change burst, a webhook replay — deserves a
reviewer even when the capped total is still below the level threshold. Results that are stored but not
alertable are still assessments, and are visible on the Assessments screen: "we looked and it did not
reach the threshold" is a different fact from "we never looked".

The alert title is derived, not free text:
`<PRIMARY_CODE>: <LEVEL> risk (<score>/100) on <subject> +N other signal(s)`. The explanation lists each
fired rule with its version, severity, capped points and reason, then the family contributions, the
total, the confidence, any data-quality notes, and the advisory sentence.

## Alert lifecycle

```
new            → under_review | escalated | resolved | false_positive
under_review   → escalated | resolved | false_positive | new
escalated      → under_review | resolved | false_positive
resolved       → under_review | new            (reopen)
false_positive → under_review | new            (reopen)
```

That adjacency list is `allowedTransitions()` in `src/fraud-sentinel/rules/transitions.ts`, it is what
the integration suite asserts, and it is published on `GET /meta` so the UI builds its buttons from the
state machine instead of duplicating it. A move the map does not allow is refused with **409
`ILLEGAL_ALERT_TRANSITION`** naming the allowed next statuses; no status may transition to itself. A
closed alert can be reopened — a conclusion can be superseded — but the timeline entries and the
false-positive report that recorded the first conclusion are never edited away.

- Applying any transition **auto-assigns** the alert to the caller when it is unassigned: an alert with
  no reviewer is nobody's problem, so the first person to touch it owns it.
- Closing (`resolved`, `false_positive`) requires a note of at least **10** characters → otherwise 400.
- A false-positive report requires a reason category and an explanation of at least **15** characters;
  a second report on the same alert is refused (409) — reopen it first. The report survives either way
  and feeds the rule-feedback table.
- Assignment accepts only an **active** account holding `admin` or `super_admin` (400 otherwise);
  `reviewerId: null` unassigns.
- Notes are ≥ 3 characters (enforced by the route schema) and are appended to the timeline, never
  edited.

## Security & authorization

Roles remain the platform's canonical `super_admin / admin / staff / customer`, **re-read from the
database on every request** (never trusted from the JWT claim alone). `src/fraud-sentinel/permissions.ts`
maps them to eight explicit permissions:

| Permission | super_admin | admin | staff | customer |
| --- | :-: | :-: | :-: | :-: |
| `fraud_sentinel.view` | ✓ | ✓ | — | — |
| `fraud_sentinel.investigate` | ✓ | ✓ | — | — |
| `fraud_sentinel.assign` | ✓ | ✓ | — | — |
| `fraud_sentinel.rules` | ✓ | ✓ | — | — |
| `fraud_sentinel.run_scan` | ✓ | ✓ | — | — |
| `fraud_sentinel.export` | ✓ | ✓ | — | — |
| `fraud_sentinel.view_all_customers` | ✓ | ✓ | — | — |
| `fraud_sentinel.settings` | ✓ | — | — | — |

There is deliberately **no staff tier** in this module. Unlike Revenue Guardian, where a staff member
works their own portfolio, Fraud Sentinel's evidence view is a concentrated picture of payment
declines, login origins and administrative activity across the whole platform — so staff and customers
hold no permission at all and receive 403 before any handler runs. Settings are super-administrator
only because they include the retention horizons (which drive deletion of evidence) and the scoring
configuration (which changes how every future score is computed).

- **Scoping is a parameter, not a convention.** Every read takes an explicit `FraudScope`
  (`{unrestricted, customerIds}`) and an empty scope is a **closed** scope that matches nothing — the
  contract `src/email-trace/access-control.ts` established. Filter clauses are alias-qualified, because
  the scoped queries join `users`, which has its own `customer_id` and `status` columns.
- **"Exists but outside your scope" is a 404**, never a 403: `Alert not found`, `Assessment not found`,
  `Customer not found`, `Rule not found`. Existence is not disclosed to someone who may not read it.
- **A missing permission is a 403** naming the permission (`Missing permission: fraud_sentinel.settings`).
- **A disabled account is a 401** (`Account is not active`) — the session is dead, not unauthorized.
- **No secrets in evidence.** Evidence stores references to real rows plus a redacted, whitelisted
  projection of them. `utils/redaction.ts` scrubs PANs (Luhn-gated masking), passwords and hashes,
  JWTs and refresh tokens, MFA secrets, passkey credentials, API keys, private keys and long base64
  blobs — on the way **in**, at ingestion. On the way **out** every description is re-checked
  (`safeEvidence` / `withEvidenceIntegrity`): if one ever fails, that single description is replaced
  with an explicit placeholder and the payload reports it in `evidenceIntegrity.withheld`, rather than
  either leaking it or failing the whole request. The UI says a piece of evidence exists and was not
  returned, so a gap is never read as "nothing recorded".
- **Everything privileged is audited** to the existing `audit_logs`, with singular snake_case resource
  types (`fraud_sentinel_alert`, `_assessment`, `_rule`, `_run`, `platform_setting`) and dotted
  lowercase actions (`fraud_sentinel.alert_<status>`, `.alert_assigned`, `.alert_unassigned`,
  `.rule_<changeType>`, `.rules_synced`, `.settings_updated`, `.alerts_exported`, `.scan_run`,
  `.job_run`, `.customer_assessed`). A CSV export is audited with its row count, its filters and the
  window it applied — or `window: null`, recording honestly that none was applied.
- **Input is zod-validated everywhere**; all SQL is parameterized inside the repositories. A boolean
  query parameter is parsed from an explicit enum, never coerced: `Boolean('false')` is `true`, so
  `?unassigned=false` would otherwise return exactly the rows the caller asked to exclude.

## Financial integrity (non-negotiable, and tested)

1. **No financial writes, ever.** The module's only writes are to `fraud_sentinel_*` tables plus
   `audit_logs`, `user_notifications`/`notification_outbox` and its own `platform_settings` keys.
   `payments`, `invoices`, `orders`, `order_items`, `billing_ledger`, `customer_services` and `users`
   are read-only inputs. `billing_ledger` additionally carries the platform's `no_update`/`no_delete`
   triggers, so it could not be written even by accident.
2. **No duplicated systems.** Authorization, settings, audit and notifications all reuse the existing
   platform facilities rather than a parallel implementation.
3. **The ledger decides what is recorded.** Amounts follow `src/lib/money.ts`: non-negative
   `numeric(12,2)` magnitudes, with direction carried by the column or entry meaning, never by sign.
4. **No fabricated data.** Every score is a documented sum over stored rows with reasons and evidence
   persisted beside it, and the advisory contract travels with the payload.

The integration suite proves (1) two ways: a **snapshot diff** of `payments`, `invoices`, `orders`,
`order_items`, `billing_ledger`, `customer_services` and `users` taken before and after a full scan, a
complete alert lifecycle and a retention pass is byte-identical; and a **static scan** of every module
source file asserting it imports no payment, billing, WHMCS, order or subscription service and contains
no `INSERT INTO` / `UPDATE` / `DELETE FROM` against a financial table.

## Retention

`applyRetention` prunes on three horizons, all configurable and all applied to the module's own tables
only:

| Setting | Default | Prunes |
| --- | --- | --- |
| `retention_event_days` | 180 | projected rows in `fraud_sentinel_events` |
| `retention_history_days` | 730 | `fraud_sentinel_risk_history` |
| `retention_superseded_assessment_days` | 365 | assessments already marked `superseded` |

Alerts, investigations, false-positive reports and rule history are **never** pruned: they are the
accountability record. An active assessment is never pruned either. The source rows the events were
projected from are untouched — retention here shortens the module's own memory, not the platform's.

## Configuration

Sixteen keys under `fraud_sentinel.*` in `platform_settings`, all readable from
**Admin → Fraud Sentinel → Operations & Settings** and writable only by a super administrator:

`enabled` (true), `lookback_days` (30), `risk_thresholds` ({25,50,75}), `family_caps` (see above),
`alert_min_level` ("high"), `alert_on_critical_rule` (true), `notify_reviewer_roles`
(["super_admin","admin"]), `scan_batch_size` (200), `event_batch_limit` (2000), `ingest_batch_limit`
(5000), `scheduler_interval_minutes` (15), `retention_event_days` (180), `retention_history_days`
(730), `retention_superseded_assessment_days` (365), `ai_assist_enabled` (**false**), `ai_engine`
("deterministic").

Values are clamped on both write and read (`sanitizeSettings`): an out-of-range number falls back to
the reviewed default, and an inverted threshold ladder is forced monotonic — `{medium:90, high:10,
critical:5}` becomes `{90,90,90}`. The audit row records **both** the requested value and the stored
one, so a clamp is visible instead of looking like a change that silently did not take effect. Changing
any of `riskThresholds`, `familyCaps`, `alertMinLevel` or `alertOnCriticalRule` requires a stated
reason, because those keys change how every future score is computed. A rule weight change requires a
reason too, and is bounded to 1–30 so the family caps keep their meaning.

`POST /rules/sync` inserts catalogue rules the database is missing and **never** overwrites one an
operator has tuned: a redeploy must not silently reset a weight.

## Jobs & concurrency

Four jobs (`src/fraud-sentinel/jobs/definitions.ts`), all idempotent, all running in the existing
worker loop and never inside an HTTP request:

| Job | Purpose |
| --- | --- |
| `fraud_sentinel_ingest` | Projects newly recorded platform rows into the ledger. |
| `fraud_sentinel_scan` | Ingests, then assesses every active subject and raises/updates alerts. |
| `fraud_sentinel_retention` | Prunes what the three horizons have expired. |
| `fraud_sentinel_rule_sync` | Inserts catalogue rules the database lacks. |

Locking is the database. A scheduled pass claims `run_key = '<job>:sched:<bucket>'` (the bucket is
per-interval for ingest/scan, daily for retention, hourly for rule sync) with
`INSERT … ON CONFLICT (run_key) DO NOTHING RETURNING *`; a null result means another worker owns that
bucket and the pass is skipped. A manual run uses `'<job>:manual:<ISO minute>'`, so pressing Run twice
in the same minute returns `locked` — which is not an error, it is the lock working. A `running` row
older than 60 minutes is reclaimed by the next sweep and left marked `failed`; its `run_key` is
deliberately **not** freed, so the same bucket is never processed twice.

`POST /scan` is different on purpose: it assesses synchronously so the caller sees exactly what the
pass did (per-table ingestion, skipped sources, per-subject failures), and it writes **no** run row
because nothing was queued. An alert raised by an API-initiated scan records `actor_type = 'staff'`
with the caller's id; only a scheduled pass records `'system'`.

## API

Base `/api/admin/fraud-sentinel`. Every route authenticates, re-verifies the role against the database
and asserts a named permission.

| Method & path | Permission | Purpose |
| --- | --- | --- |
| `GET /overview` | view | Dashboard aggregates, derived only from stored rows |
| `GET /meta` | view | The vocabulary, the transition map, the jobs, the note minimums, the advisory contract |
| `GET /alerts` | view | Filter, sort and page the queue |
| `GET /alerts/:id` | view | Alert + assessment + timeline + false-positive report + risk history |
| `POST /alerts/:id/transition` | investigate | Move status (state-machine enforced) |
| `POST /alerts/:id/assign` | assign | Assign/unassign a reviewer |
| `POST /alerts/:id/false-positive` | investigate | Record a false-positive report |
| `POST /alerts/:id/notes` | investigate | Append a note or an "evidence reviewed" marker |
| `GET /alerts/export.csv` | export | RFC-4180 CSV of the current filter (audited) |
| `GET /assessments`, `GET /assessments/:id` | view | Stored assessments and one full derivation |
| `GET /customers/:id/risk-profile` | view | Everything recorded about one account |
| `GET /customers/:id/events` | view | That account's projected event ledger |
| `POST /customers/:id/assess` | run_scan | Re-assess one subject on demand (audited) |
| `GET /investigations`, `GET /false-positives`, `GET /rule-feedback` | view | The accountability record and the tuning signal |
| `GET /rules`, `GET /rules/:code`, `GET /rules/catalogue`, `GET /rule-history` | view | Configured rules, drift, reviewed defaults, history |
| `PATCH /rules/:code`, `POST /rules/sync` | rules | Tune a rule (versioned) / insert missing defaults |
| `GET /settings`, `PATCH /settings` | view / **settings** | Read anyone, write super_admin only |
| `POST /scan`, `GET /runs`, `POST /jobs/:name/run` | run_scan / view / run_scan | Operations |

The frontend hardcodes none of it: statuses, levels, categories, subject types, false-positive reasons,
investigation actions, the transition map, the sortable columns, the job list and both note minimums
are all read from `GET /meta` at runtime, so a value the server adds appears in the UI without an SPA
redeploy and one it removes disappears.

## Notifications

A newly raised alert notifies the roles in `notify_reviewer_roles` (default `super_admin`, `admin`)
through the existing in-app notification pipeline, via `src/services/notification-service`. This is the
one import from outside the module and it is deliberate: the platform has exactly one notification
path, and a module that grew its own would produce a second inbox. **No customer is ever emailed about
a detection.** An alert is an internal request for a human look; telling a subject they are suspected
would both alarm an innocent customer and warn a guilty one.

## Running

```bash
npm run migrate          # applies 0101 (forward-only, additive)
npm run dev              # API + frontend
npm run worker           # background sweep (5 min); each job gated by its own schedule bucket
npm test                 # unit + integration + frontend suites (PGlite embedded Postgres)
```

Admin UI entry point: **/admin/fraud-sentinel**, linked from the Admin landing page.

## Rollback

The migration runner is deliberately forward-only and checksummed — `database/migrate.ts` has no
`down`. Because this migration is additive and self-contained, the reviewed rollback is a single
explicit operator-run script that drops only the objects it created, in dependency order:

```sql
DROP TABLE IF EXISTS fraud_sentinel_false_positives;
DROP TABLE IF EXISTS fraud_sentinel_investigations;
DROP TABLE IF EXISTS fraud_sentinel_alerts;
DROP TABLE IF EXISTS fraud_sentinel_risk_history;
DROP TABLE IF EXISTS fraud_sentinel_assessments;
DROP TABLE IF EXISTS fraud_sentinel_rule_history;
DROP TABLE IF EXISTS fraud_sentinel_rules;
DROP TABLE IF EXISTS fraud_sentinel_runs;
DROP TABLE IF EXISTS fraud_sentinel_events;
DROP SEQUENCE IF EXISTS fraud_sentinel_alert_number_seq;
DELETE FROM platform_settings WHERE key LIKE 'fraud_sentinel.%';
DELETE FROM schema_migrations WHERE version = '0101';
```

That script is **not** part of the migration file and is never executed by the application: dropping
tables is destructive and requires separate explicit authorization. It is recorded here (and in the
migration header, where the integration test reads and asserts it) so the rollback path is reviewed and
reproducible rather than improvised. Running it leaves every pre-existing table byte-identical.

To disable the module without removing it, set `fraud_sentinel.enabled = false`: ingestion, assessment
and alerting all stop, the API keeps serving what was already recorded, and no data is deleted.

## Limitations (stated plainly)

- **It is a detection aid, not an adjudicator.** A high score means recorded activity matched patterns
  that warrant a human look. It is not evidence of fraud and it is not a decision. False positives are
  expected; the module's own answer to them is the false-positive report and the rule-feedback table,
  which is the only honest tuning signal it can produce from its records.
- **No external intelligence, and no network calls at all.** There is no IP reputation feed, no BIN
  table, no device fingerprinting, no email-reputation service and no third-party fraud API. Every
  signal comes from rows this platform already wrote, resolved through data it already holds. The two
  geography rules (`ACC_NEW_GEO_LOGIN`, `ACC_IMPOSSIBLE_TRAVEL`) resolve an IP through the platform's
  **own local** geoip-lite database (`src/visitor-intelligence/geo.ts`) and do deterministic haversine
  arithmetic on the city-centre coordinates — no external service is called, ever. That accuracy is
  city-centre at best, so both rules say so in their reason text, `ACC_NEW_GEO_LOGIN` carries a
  `GEO_UNAVAILABLE` data-quality flag when an IP cannot be resolved (which also downgrades confidence),
  and `ACC_IMPOSSIBLE_TRAVEL`'s recommendation warns that a VPN or proxy exit node produces the same
  pattern. Where the data is thin the rule does not fire rather than guessing.
- **No model produces a score.** `ai_assist_enabled` is off by default; when an operator turns it on,
  model text appears *beside* the deterministic score and the assessment is flagged as AI-assisted. The
  score, the level, the confidence and the rule derivation are never model output.
- **Coverage follows the sources.** A deployment missing one of the 11 source tables loses the rules
  that read it, and the pass reports the skipped source rather than silently scoring without it.
- **Thresholds are judgement, not statistics.** The weights, caps and thresholds are reviewed defaults
  chosen to make single strong signals visible and noisy families bounded. They are not fitted to a
  labelled fraud dataset — this platform does not have one. Retuning is a human act, versioned,
  reasoned and audited.
- **The ledger is a projection with its own retention.** Evidence older than `retention_event_days` is
  pruned even though the source rows are not, so an old assessment can outlive the events that produced
  it. The stored evidence references and reasons remain, and the UI says when the assessment behind an
  alert is no longer readable.
- **Alerting is rate-limited by design.** One open alert per (subject, primary rule) means a continuing
  pattern increments `recurrence_count` rather than filling the queue — at the cost of one alert row
  representing many occurrences.
