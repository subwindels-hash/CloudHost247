# Webhook pipeline & quarantined migrations — unfreeze runbook

**Status of this document: PREPARATION ONLY — it authorizes nothing by itself.**
**AUTHORIZATION RECORDED 2026-10-04 (staging scope only).** The repository owner explicitly
authorized execution of all four quarantined migrations — **0023, 0024, 0025, 0041** — against the
**staging database to be provisioned** (step 0.2 below). **Production remains NOT authorized**, and
nothing has executed: the staging database (step 0.2) and the provider test secrets (step 0.3) do
not exist yet, so steps 1–4 below have not been run.
The production standing restriction remains in force until the owner lifts it there:

> "Migrations 0023, 0024, 0025, and 0041: Prepared and tested migration artifacts only. **NOT
> authorized for production execution**; do not run against any production database until
> separately authorized." — `docs/NODE_PLATFORM_STATUS.md`, Standing restrictions

> `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` keeps its historical stamp **NOT AUTHORIZED · NOT
> IMPLEMENTED · NOT DEPLOYED**, now with the dated 2026-10-04 staging-authorization status update
> recorded beneath it; per this runbook's own sequencing the stamp itself is updated after an
> authorized execution has happened. PR #12 is CLOSED and unmerged (re-verified 2026-10-04). No
> production database has been touched.

**Written 2026-10-03** on `arena/01a1027e-cloudhost247` so that the moment the owner decides to
proceed, the exact mechanics, pre-checks and rollback plan are already verified against the code —
nothing in this runbook is invented; every command below is read from `database/migrate.ts`,
`src/config/env.ts` and the gateway implementations.
**Amended 2026-10-04** on `arena/01a104fc-cloudhost247`: the owner's authorization (staging scope
only, all four versions) is now recorded in step 0.1; production remains not authorized.

---

## What is frozen, precisely

| Artifact | Content | Quarantine rule in `database/migrate.ts` |
|---|---|---|
| `0023_enforce_billing_invariants.sql` | Billing invariants B1–B5 (currency/user/amount agreement between `payments`, `billing_ledger` and `invoices`, and invoice↔order agreement) enforced by BEFORE INSERT/UPDATE triggers — historical data is not scanned | standalone; no dependents |
| `0024_create_webhook_events.sql` | The Phase 5D webhook event ledger (`webhook_events`) + `auth_audit_log` extension | standalone; no dependents |
| `0025_extend_auth_audit_log_for_admin_billing.sql` | Admin billing audit extension | standalone; no dependents |
| `0041_create_os_catalog_and_server_provisioning.sql` | OS catalog + server provisioning tables; extends `servers`, `deployments` | **dependents: 0042, 0043, 0047, 0048, 0049, 0051, 0052, 0054, 0056, 0059** — production cannot progress past 0040 until 0041 is authorized, and authorizing it unblocks the whole chain |

Enforcement is in code, not prose: on a production run (`NODE_ENV=production`), standalone
quarantined migrations are skipped and reported, and a run that would leave a dependent migration
pending refuses **before any DDL** (`tests/integration/migration-quarantine.test.ts`, 8 tests).
The only override is explicit, per-run: `AUTHORIZED_MIGRATIONS=<versions>` plus `--yes`
(or `CONFIRM_MIGRATION=yes`).

The pipeline itself is code-complete and fail-closed while frozen:

- Both webhook routes registered with raw-byte capture; signature verified **before** JSON parsing
  or any database access; SHA-256 payload hash; 60-second processing lease with takeover; single
  transaction — **73/73 integration tests**.
- Every gateway refuses unsigned or unconfigured-secret deliveries
  (`tests/unit/webhook-secret-fail-closed.test.ts`, 4 tests), so the pipeline cannot go live by
  accident: with no webhook secret configured, deliveries are rejected.

---

## Local rehearsal (2026-10-04) — throwaway PostgreSQL in the agent sandbox

Run to prove the mechanics below **execute**, not merely read correctly. Target: an **empty** database on a
throwaway PostgreSQL 18.4 cluster (embedded binaries, created outside the repository; throwaway credentials chosen
to match the probe defaults). **No staging or production database exists or was touched** — this rehearsal
authorizes nothing and changes nothing in step 0.

| Rehearsed step | Result |
|---|---|
| Unauthorized production run (`NODE_ENV=production`, no `AUTHORIZED_MIGRATIONS`) | **Refused before any DDL**, naming 0041 and its ten dependents; `schema_migrations` left with **0 rows** — nothing applied |
| Step 2's command verbatim (`AUTHORIZED_MIGRATIONS=0023,0024,0025,0041`) | **All 70 migrations applied**; `migrate verify` → *"OK: no checksum drift detected"* |
| Post-run objects | `webhook_events` created by 0024; 0023's **three validation triggers** present on `invoices`, `payments`, `billing_ledger` (alongside the two pre-existing `billing_ledger` no-update/no-delete guards — 5 in total); the `auth_audit_log` event-type CHECK now allows `admin_invoice_refunded` / `admin_invoice_cancelled` and `orders.payment_status` is `varchar(20)` (0025) |
| Step 1.3 six-query invariant sweep | **0 rows on all six**, before and after the authorized run |
| Step 1.4 probes against a real PostgreSQL | `verify:financial` **49/49**, `verify:authorization` **39/39** |
| `migrate status` on a production-shaped database | 0023/0024/0025/0041 marked `quarantined: true` with their reasons; all 70 listed |

Still unperformable without the real environment, and therefore still open: the staging database (0.2), the provider
test-mode secrets (0.3), CI (0.4), and steps 3–4 (live-gateway verification). Step 0.1's recorded scope is unchanged.

---

## Step 0 — Owner prerequisites (none of these can be skipped)

1. **Written owner authorization** naming which of 0023/0024/0025/0041 are authorized and for which
   database. **DONE — recorded 2026-10-04:** the owner authorized **all four** (0023, 0024, 0025,
   0041) against the **staging database to be provisioned**; production is explicitly excluded. The
   concrete staging database identity (host and database name, never credentials) is recorded here
   when step 0.2 is satisfied.
2. **A staging database** — a production-shaped clone or a disposable instance. Nothing here runs
   against production first.
3. **Provider credentials in test mode** (live-gateway verification has never been performed):
   - Stripe: a webhook endpoint + signing secret → `STRIPE_WEBHOOK_SECRET` (min 16 chars)
   - PayPal: a sandbox webhook → `PAYPAL_WEBHOOK_ID` (min 10 chars; signature verification goes
     through PayPal's verify-signature API)
   - Paystack: test secret key → `PAYSTACK_SECRET_KEY` (min 16 chars; `x-paystack-signature` HMAC)
   - The platform's own sandbox gateway: `SANDBOX_GATEWAY_WEBHOOK_SECRET` (min 16 chars)
4. **CI restored**: GitHub Actions currently rejects every job for account billing reasons, so no
   commit has CI signal. This is an account action, not a code fix; the local release-candidate
   gate is the executable verification until it is cleared.

## Step 1 — Pre-flight on the target database (read-only)

1. `migrate status` / `migrate verify` — confirm the highest applied version (production is
   expected to sit at 0040 with the quarantined artifacts pending) and that no checksum drift is
   reported.
2. **Know what 0023 does and does not do.** It installs BEFORE INSERT/UPDATE **triggers** on
   `invoices`, `payments` and `billing_ledger` — not CHECK constraints. Triggers never scan
   historical data, so the migration applies cleanly even when past rows violate an invariant; the
   consequence arrives later, as every **update** of a violating row (a refund, a status change, a
   reconciliation) failing with the trigger's exception. The pre-check below is therefore not about
   whether the migration will fail — it is about enumerating the rows that would block future
   writes, so they can be reconciled before authorization rather than discovered by a stuck refund.
3. **Run the violation sweep against the target, read-only** — one query per invariant, derived
   from the trigger functions in `0023_enforce_billing_invariants.sql`:

```sql
-- B5: every invoice must match its parent order exactly
SELECT i.id FROM invoices i JOIN orders o ON o.id = i.order_id
WHERE i.user_id <> o.user_id OR i.currency <> o.currency
   OR i.subtotal_amount <> o.subtotal_amount OR i.discount_amount <> o.discount_amount
   OR i.tax_amount <> o.tax_amount OR i.total_amount <> o.total_amount;
SELECT id FROM invoices i WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = i.order_id);

-- B1/B2/B4: every payment must agree with its invoice on user, currency and amount
SELECT p.id FROM payments p JOIN invoices i ON i.id = p.invoice_id
WHERE p.user_id <> i.user_id OR p.currency <> i.currency OR p.amount > i.total_amount;
SELECT id FROM payments p WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = p.invoice_id);

-- B3: every invoice-linked ledger entry must agree with that invoice on user and currency
SELECT l.id FROM billing_ledger l JOIN invoices i ON i.id = l.invoice_id
WHERE l.user_id <> i.user_id OR l.currency <> i.currency;
SELECT id FROM billing_ledger l
WHERE l.invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = l.invoice_id);
```

   All six queries must return zero rows. Any non-zero result is reconciled **before**
   authorization: after 0023 those rows cannot be updated until they agree.
4. **Run the executable probes once to confirm the tooling is green** — they execute against a
   throwaway database they create and drop per run, so they prove the checks and the commands work
   but do **not** read the target: `npm run verify:financial` → expect **49/49**,
   `npm run verify:authorization` → expect **39/39** (`CH247_PROBE_PG_*` env vars point the
   throwaway at any reachable PostgreSQL server).

## Step 2 — Authorized migration run (staging first)

```bash
NODE_ENV=production \
AUTHORIZED_MIGRATIONS=0023,0024,0025,0041 \
node dist/database/migrate.js up --yes
```

- Authorize only what step 0 named; the runner applies the rest of the pending chain normally and
  reports anything still quarantined.
- Then `node dist/database/migrate.js verify` — every applied file's checksum must match.
- Repeat step 1.3's six read-only queries on the migrated database (0023's triggers change no data,
  so the answers must be unchanged — all zero) and re-run step 1.4's probes (**49/49** and
  **39/39**) to confirm the financial surface is intact with the triggers in place.

## Step 3 — Configure secrets and deploy

1. Set the provider env vars from step 0.3. `src/config/env.ts` marks them optional **by design**:
   an unconfigured gateway refuses all deliveries rather than accepting unsigned ones.
2. Deploy the platform. Smoke-check the fail-closed behaviour first: POST a garbage body to each
   `/api/v1/webhooks/:gateway` route and confirm a 4xx rejection and an audit row before sending
   anything real.

## Step 4 — Live-gateway verification (the gate that has never been performed)

For **each** configured gateway, in test/sandbox mode:

1. Send a real test event through the provider's own tooling (Stripe CLI `stripe trigger`,
   PayPal sandbox notification replay, Paystack test-mode charge).
2. Assert the `webhook_events` row: signature verified, payload hash recorded, lease acquired and
   released, terminal processing state, corresponding billing movement exactly once.
3. **Redeliver the identical event** and assert idempotency: no duplicate ledger entry, no
   duplicate invoice state change.
4. **Tamper with one byte** of a captured payload and resend: rejection, no database write.
5. Send one event with the secret deliberately rotated away: rejection before parsing.

## Rollback plan

- 0024 and 0041 are additive (new tables/columns); rolling back means dropping exactly what they
  created, after confirming no application version still reads them.
- 0023 adds three validation triggers and their functions — removal is dropping exactly those, but
  **the point of 0023 is that it should not be removed**: if a trigger fires, the correct response
  is to fix the violating write, not the guard.
- 0025 is an additive audit extension.
- In every case: `migrate verify` before and after, and a fresh `verify:financial` sweep after.

## After execution

- Update the stamp in `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` and the Standing restrictions
  section of `docs/NODE_PLATFORM_STATUS.md` with what was authorized, against which database, and
  the live-verification results — dated. This inventory (`docs/UNFINISHED-MODULES.md` §A9/§A10)
  records the closure the same way every other closure is recorded.
- Monitor `webhook_events` for stale leases and failed events; a stuck lease is visible after its
  60-second window and is taken over automatically on redelivery.
