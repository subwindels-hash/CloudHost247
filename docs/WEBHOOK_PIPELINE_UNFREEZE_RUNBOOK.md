# Webhook pipeline & quarantined migrations — unfreeze runbook

**Status of this document: PREPARATION ONLY. It authorizes nothing.**
The standing restriction remains in force until the owner performs step 0 below:

> "Migrations 0023, 0024, 0025, and 0041: Prepared and tested migration artifacts only. **NOT
> authorized for production execution**; do not run against any production database until
> separately authorized." — `docs/NODE_PLATFORM_STATUS.md`, Standing restrictions

> `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` keeps its stamp **NOT AUTHORIZED · NOT IMPLEMENTED ·
> NOT DEPLOYED**. PR #12 is CLOSED and unmerged. No production database has been touched.

**Written 2026-10-03** on `arena/01a1027e-cloudhost247` so that the moment the owner decides to
proceed, the exact mechanics, pre-checks and rollback plan are already verified against the code —
nothing in this runbook is invented; every command below is read from `database/migrate.ts`,
`src/config/env.ts` and the gateway implementations.

---

## What is frozen, precisely

| Artifact | Content | Quarantine rule in `database/migrate.ts` |
|---|---|---|
| `0023_enforce_billing_invariants.sql` | Billing invariants B1–B4 (currency/user/amount agreement between `payments`, `billing_ledger` and `invoices`) enforced at database level | standalone; no dependents |
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

## Step 0 — Owner prerequisites (none of these can be skipped)

1. **Written owner authorization** naming which of 0023/0024/0025/0041 are authorized and for which
   database. The runbook does not supply this.
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

1. `migrate status` — confirm the highest applied version (production is expected to sit at 0040
   with the quarantined artifacts pending) and that no checksum drift is reported
   (`migrate verify`).
2. **0023 pre-check**: run the financial invariant sweep against the target database
   (`npm run verify:financial`, `CH247_PROBE_PG_*` pointing at the target — a throwaway database is
   created and dropped per run only in the probe's own fixtures; point it at the target schema
   read-only if adapting). If any of the B1–B4 invariants currently has a violating row, 0023's
   constraints will refuse mid-migration; reconcile those rows first. Expected result on a clean
   database: **49/49**.
3. `npm run verify:authorization` against the same environment — **39/39** expected; confirms no
   customer-side request path can produce a successful payment before the pipeline changes.

## Step 2 — Authorized migration run (staging first)

```bash
NODE_ENV=production \
AUTHORIZED_MIGRATIONS=0023,0024,0025,0041 \
node dist/database/migrate.js up --yes
```

- Authorize only what step 0 named; the runner applies the rest of the pending chain normally and
  reports anything still quarantined.
- Then `node dist/database/migrate.js verify` — every applied file's checksum must match.
- Repeat steps 1.2 and 1.3 on the migrated database: the invariants must still be 49/49 and the
  authorization matrix 39/39 **after** the constraints exist.

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
- 0023 adds constraints — removal is dropping those constraints, but **the point of 0023 is that it
  should not be removed**: if it fires, the correct response is to fix the violating write, not the
  guard.
- 0025 is an additive audit extension.
- In every case: `migrate verify` before and after, and a fresh `verify:financial` sweep after.

## After execution

- Update the stamp in `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` and the Standing restrictions
  section of `docs/NODE_PLATFORM_STATUS.md` with what was authorized, against which database, and
  the live-verification results — dated. This inventory (`docs/UNFINISHED-MODULES.md` §A9/§A10)
  records the closure the same way every other closure is recorded.
- Monitor `webhook_events` for stale leases and failed events; a stuck lease is visible after its
  60-second window and is taken over automatically on redelivery.
