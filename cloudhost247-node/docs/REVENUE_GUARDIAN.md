# Revenue Guardian — Revenue Recovery Management

Revenue Guardian is CloudHost247's native revenue-recovery module: it monitors unpaid and
upcoming revenue, opens and tracks recovery cases, schedules staff follow-ups, records payment
promises, assigns customer ownership, automates reminders, and reports on recovery performance.

It is a **management layer over the existing billing engine** — it never duplicates billing
data. Invoices, payments, the append-only `billing_ledger`, orders, subscriptions, services and
domains remain the single source of financial truth; Revenue Guardian stores only recovery
workflow state.

## Architecture

| Layer | Location |
| --- | --- |
| Migration | `database/migrations/0054_create_revenue_guardian.sql` |
| Backend module | `src/revenue-guardian/` (`controllers/`, `services/`, `repositories/`, `rules/`, `jobs/`, `reports/`, `notifications/`, `types/`, `utils/`) |
| API | `/api/admin/revenue-guardian/*` (registered in `src/app.ts`) + customer-facing `/api/v1/account/revenue-health` |
| Worker integration | `src/worker/main.ts` → `src/revenue-guardian/jobs/scheduler.ts` |
| Frontend | `frontend/src/pages/revenue-guardian/`, `frontend/src/components/revenue-guardian/`, `frontend/src/lib/revenue-guardian-api.ts` |
| Tests | `tests/unit/revenue-guardian-rules.test.ts`, `tests/integration/revenue-guardian-api.test.ts` |

### Tables (all prefixed `revenue_guardian_`)

- `recovery_cases` — one open case per invoice (DB-enforced partial unique index). Statuses:
  `new → contact_required/contacted → awaiting_customer / payment_promised / payment_pending →
  partially_recovered → recovered`, plus `escalated`, `disputed`, `closed`, `written_off`.
- `follow_ups` — staff tasks; "overdue" is derived (`pending` + past schedule), never stored.
- `payment_promises` — commitments; resolved **only** by ledger reconciliation.
- `assignments` — one active owner per customer per role (`account_manager`, `sales_rep`,
  `collections`, `customer_success`); history preserved via `ended_at`, never rewritten.
- `assignment_rules` / `automation_rules` — declarative JSON conditions validated by zod
  (`rules/rule-schemas.ts`). No executable code is ever stored in the database.
- `automation_runs` — run history **and** concurrency lock (unique `run_key`).
- `activity_log` — append-only module activity (staff + system).
- `communication_log` — every queued email/WhatsApp with its honest status and dedupe key.

Settings live in the existing `platform_settings` table under `revenue_guardian.*` keys and are
all editable from **Admin → Revenue Guardian → Settings** (thresholds, reminder windows,
escalation ladder, aging buckets, risk/high-value thresholds, scheduler interval, timezone,
WhatsApp provider, email template overrides).

## Financial integrity rules (non-negotiable invariants)

1. **The ledger decides.** A case can become `recovered` only when the invoice has zero
   outstanding balance in the ledger; `partially_recovered` requires an actual ledger payment
   since the case opened. The API refuses staff attempts otherwise (`services/case-service.ts`).
2. **Promises are never fulfilled by a click.** `reconcilePromise` compares ledger payments
   recorded after the promise was created against the promised amount; there is no
   "mark fulfilled" endpoint.
3. **Paid invoices are never chased.** Payment-type emails check invoice status at send time;
   the overdue job only sees `unpaid` invoices; reconciliation closes cases for voided invoices.
4. **Write-off** requires the elevated `revenue_guardian.write_off` permission (super_admin), a
   reason, and is audited. It never deletes invoices or payment history.
5. **No fabricated data.** Every risk score is a documented, unit-tested sum of factors over
   stored data, with human-readable reasons persisted next to the score. Reports label every
   money column as `ACTUAL / RECOVERED / OUTSTANDING / AT_RISK / PROJECTED`.
6. **Currencies never blend.** All aggregates are per-currency; the configured reporting
   currency is a label, not a silent conversion.

## RBAC

Roles remain the platform's canonical `super_admin / admin / staff / customer` (re-read from the
database on every request). `src/revenue-guardian/permissions.ts` maps them to explicit
`revenue_guardian.*` permissions:

- **super_admin** — everything, including `write_off`.
- **admin** — everything except `write_off`.
- **staff** — `view`, `followups`, `promises` only, and every query is scoped to the staff
  member's own portfolio (their active assignments + cases assigned to them). Staff never see
  other staff members' performance data.

The customer endpoint `/api/v1/account/revenue-health` exposes only the customer's own unpaid
invoices, service periods, and payment arrangements — never internal notes, risk scores, or
assignments.

## Automation

Jobs (all idempotent, all in `jobs/definitions.ts`): `process_overdue_invoices`,
`process_upcoming_invoices`, `process_payment_promises`, `process_renewals`,
`process_pre_suspension`, `process_pre_termination`, `recalculate_revenue_risk`,
`reconcile_recovery_state`, `run_assignment_rules`.

- They run inside the **existing worker** (`npm run worker`), never inside HTTP requests.
- Locking/idempotency: the unique `run_key` (`<job>:sched:<bucket>`) makes the database the
  lock — overlapping workers conflict on INSERT and skip. Entity-level idempotency comes from
  the unique open-case-per-invoice index, follow-up `dedupe_key`s, and communication
  `dedupe_key`s. Running any job twice creates nothing the second time (covered by tests).
- "Run Now" (`POST /automation/jobs/:name/run`, permission `revenue_guardian.manual_run`) is
  locked per minute against double-fire and returns the run counters.
- Every run is recorded with counters/duration/error and shown on **Automation Runs**.

## Notifications

- **Email** rides the existing `user_notifications` + `notification_outbox` pipeline (one SMTP
  path platform-wide). The communication log records `queued` — never "sent" — and joins the
  outbox's real delivery state for display. Templates are code defaults with admin overrides and
  `{{variable}}` substitution; a disabled template logs `suppressed`.
- **WhatsApp** is optional and **fails closed**: without complete provider configuration
  (Twilio or Meta Cloud API) every send returns `WHATSAPP_CONFIGURATION_REQUIRED` and is logged
  as such. Credentials are write-only (never returned to the browser).

## Running

```bash
npm run migrate          # applies 0054 (forward-only, additive)
npm run dev              # API + frontend
npm run worker           # background automation (5-min sweep; jobs gated by schedule buckets)
npm test                 # unit + integration suites (PGlite embedded Postgres, full migrations)
```

Admin UI entry point: **/admin/revenue-guardian** (linked from the Admin landing page).

## Exports

Reports export as CSV (opens in Excel) with an honest metadata header (who/when/period/value
classifications); the Reports page offers a print view for PDF. True XLSX/PDF serializers can be
added later by swapping the serializer in `reports/report-service.ts` — the module deliberately
does not hand-fabricate binary office formats.
