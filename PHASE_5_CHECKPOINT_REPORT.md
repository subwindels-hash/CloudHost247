# Phase 5 Checkpoint Report — 5A remediation, 5B audit, 5C audit

**Date:** 2026-09-29 · **Branch:** `arena/01a0e9c8-cloudhost247` · **Status: STOPPED, awaiting your decision.**

Financial development is frozen. No Phase 5D/5E/5F/5G work was started, no payment behaviour was
changed, no gateway credentials exist, nothing was deployed, and no PR touching commerce/billing/
payments was merged. No `git reset`, no force-push, no branch deletion, no history rewrite, no
whole-PR revert. Phase 5B and 5C were **audited only** — no code in them was modified.

| Part | Scope | Result |
| --- | --- | --- |
| 1 | Phase 5A — defects, fixes, limitations | **FAIL → remediated, pending your review** |
| 2 | Phase 5B — financial integrity, migration/data risk | **PASS with gaps** (4 defence-in-depth gaps) |
| 3 | Phase 5C — payment security, provider/sandbox limits | **FAIL — 1 critical defect, unfixed** |

**Evidence base:** 274/274 repo tests across 34 files, plus 125 independent adversarial probe
assertions executed against **real PostgreSQL 18.4** (not a stub, not an emulator).

---

## 0. Established facts (item 2) — recorded before anything else

### 0.1 Exact commits

| Thing | SHA |
| --- | --- |
| `origin/main` **and** the PR #11 merge commit | `cca731a4a9178ba784b408265da65ab5bacd9d49` |
| ↳ merge parent 1 (`main` before) | `d0b85334d0f5e594009e68ec16fbad61b910973c` |
| ↳ merge parent 2 (the feature branch tip) | `c2d308679eec5e8315c7f08325a6c57ce94b2c41` |
| Phase 5A | `3033349a3498a90c5a52dc76dc6d20f2d6fe4bf2` |
| Phase 5B | `9361062e40e36aa73d8a257e96b0dcd6707d4ce0` |
| Phase 5C | `c2d308679eec5e8315c7f08325a6c57ce94b2c41` |
| Phase 4 (last approved) | `c6e2e6a405aafd50aae8efe10caaf2503d9ec066` |
| 5A fix #1 (this session) | `8806b9d10d5068c858c065c60c1368446b27e0fa` |
| 5A fix #2 (this session) | `d0afa16` |

PR #11 `state=MERGED`, `mergedAt=2026-09-28T20:47:05Z`, `mergedBy=app/arena-ai-coding-agent`.
PR #12 (the 5A remediation) is **OPEN and unmerged**: https://github.com/subwindels-hash/CloudHost247/pull/12

### 0.2 Migrations through 5C — 22 total, provenance verified per file

| Migration | Introduced by |
| --- | --- |
| `0001`–`0013` | pre-5A (Phases 1–4) |
| `0014_create_carts`, `0015_create_cart_items`, `0016_create_orders`, `0017_create_order_items` | **5A** `3033349` |
| `0018_create_invoices`, `0019_create_billing_ledger`, `0020_create_payments` | **5B** `9361062` |
| `0021_add_payment_confirmation_fields`, `0022_extend_auth_audit_log_event_types_for_payments` | **5C** `c2d3086` |

All 22 apply cleanly to real PostgreSQL 18.4 with zero checksum drift. `0021` is a pure additive
`ADD COLUMN IF NOT EXISTS`; none of the nine Phase 5 migrations drops or rewrites an existing column.

### 0.3 Has anything actually been migrated, activated or deployed?

Every answer below is **no**, each established by inspection rather than assumption:

- **No deployment pipeline exists.** The only two CI workflows (`independent-foundation.yml`,
  `node-platform.yml`) run on `push`/`pull_request` and do build + test only. No deploy job, no
  ssh/rsync/ftp step, no deployment secrets. The single `DATABASE_URL` in CI is the dummy literal
  `postgresql://user:pass@localhost:5432/cloudhost247` used by a production-build smoke test.
- **Migrations never run automatically.** `migrateUp` is referenced only by the
  `database/migrate.ts` CLI and by tests. `server.js` (the cPanel Passenger entry point) only
  `require`s `dist/src/server.js` — it contains no migration call. A migration therefore only ever
  runs if a human runs it.
- **No credentials exist in the repository or on disk.** No `.env` file is present; only
  `cloudhost247-node/.env.example` is tracked. `SANDBOX_GATEWAY_WEBHOOK_SECRET` and
  `MANUAL_PAYMENT_INSTRUCTIONS` are unset, so the sandbox gateway cannot even sign a payload.
- **No external provider is activated.** The gateway registry contains exactly two entries,
  `manual` and `sandbox`. `stripe`, `paypal`, `flutterwave` and `paystack` are all rejected with
  400 (verified adversarially). There is no SDK, no HTTP client, and no outbound call to any
  payment provider anywhere in the codebase.
- **No webhook receiver exists at all** (see Part 3), so no external system can reach this app.

**Limitation — stated explicitly, not glossed over:** the above is established for *this repository
and its CI only*. Your actual production host and its database are not reachable from this
sandbox, so I **cannot** verify whether *your* server has had migrations applied or holds real
financial data. To confirm that yourself, on the production host:

```bash
# 1. Has anything from Phase 5 been migrated?
psql "$DATABASE_URL" -c "SELECT version, applied_at FROM schema_migrations ORDER BY version;"
#    Any row >= 0014 means Phase 5 schema is present.

# 2. Does any real financial data exist?
psql "$DATABASE_URL" -c "SELECT
  (SELECT count(*) FROM orders)         AS orders,
  (SELECT count(*) FROM invoices)       AS invoices,
  (SELECT count(*) FROM payments)       AS payments,
  (SELECT count(*) FROM billing_ledger) AS ledger_entries;"

# 3. Has any payment ever been confirmed?
psql "$DATABASE_URL" -c "SELECT id, provider, status, amount, currency, completed_at
  FROM payments WHERE status <> 'pending' ORDER BY created_at;"

# 4. Which build is actually deployed?
cat /path/to/deployed/app/.git-commit 2>/dev/null || git -C /path/to/deployed/app rev-parse HEAD
```

If **(1)** returns nothing at or above `0014`, none of Phase 5 has ever touched your database and
Recovery Option B below is available at essentially zero data risk. If **(2)** or **(3)** return
non-zero rows, Option C applies instead.

---

## Part 1 — Phase 5A: defects, fixes, limitations → **FAIL, then remediated**

### 1.1 Correcting the premise

You described the defect as *"an existing quantity of 20 updated to 5 produces a 500 and a
quantity of 25."* That conflates two deliberately different endpoints. Measured against real
PostgreSQL:

| Endpoint | Semantics | 20 → request 5 | Verdict |
| --- | --- | --- | --- |
| `POST /api/v1/cart/items` | **additive** ("add to cart") | 20 + 5 = 25 → violated `cart_items_quantity_positive_check` → **unhandled 500** | **This was the real defect** |
| `PATCH /api/v1/cart/items/:id` | **absolute set** ("set quantity to N") | **200, stored quantity = 5** | Was already correct |

So the endpoint you described was never broken, and the endpoint that *was* broken is a different
one. The underlying complaint was nonetheless valid and the defect was real and confirmed.

### 1.2 Defect 1 — unhandled 500 on cumulative add (fixed, `8806b9d`)

`addCartItem` upserted with `quantity = cart_items.quantity + EXCLUDED.quantity` and no cap, so any
add that pushed the line past 20 hit the database CHECK constraint and surfaced as a 500.

The fix enforces the cap **inside the same single `ON CONFLICT DO UPDATE ... WHERE` statement**
rather than as a separate `SELECT`-then-`UPDATE`, because a read-then-write check leaves a
time-of-check/time-of-use gap through which two concurrent adds could both pass. `MAX_CART_ITEM_QUANTITY`
in `src/config/billing.ts` is now the single source of truth shared by the zod schemas and the
upsert guard; the database CHECK constraints are unchanged and remain the backstop. **No schema
change, no migration.**

Files: `src/config/billing.ts`, `src/db/carts.ts`, `src/services/commerce-service.ts`,
`src/routes/commerce.ts`, `tests/integration/commerce-api.test.ts`.

### 1.3 Defect 2 — `money.ts` accepted negative amounts (fixed, `d0afa16`)

You asked whether negatives should be rejected at the primitive boundary rather than only by
upstream guards. **Decision: yes, rejected at the boundary.** Justification, established by
inspection rather than preference:

- `billing_ledger` is `CHECK (amount > 0)` — it stores **magnitudes**, with direction carried by
  `entry_type` (`charge`/`payment`/`refund`/`credit`).
- `orders.discount_amount` is a **positive** number that is subtracted, `CHECK (>= 0)`.
- Every other monetary column carries a `>= 0` or `> 0` CHECK.
- `money.ts` is imported **only** by Phase 5A commerce code — 5B and 5C pass numeric strings
  straight through — so tightening it cannot affect billing or payment behaviour.

There is therefore no legitimate negative monetary value anywhere in the platform, and a negative
reaching these primitives means an upstream invariant is already broken. `toCents`, `fromCents`,
`multiplyCents` and `sumCents` now reject negatives, `NaN`/`Infinity`, empty strings (which
`Number('')` would otherwise silently turn into a free item), fractional cents, and values that
would overflow `numeric(12,2)` as an unhandled 500. The invariant is documented at the top of
`src/lib/money.ts`, including the instruction that a future signed-arithmetic requirement must add
an explicitly-named signed helper rather than relax these guards.

### 1.4 Acceptance criteria you set

| Requirement | Result | Evidence |
| --- | --- | --- |
| Setting quantity to 5 yields **5, not 25** | ✅ | 200, stored 5, subtotal recomputed; re-read from the DB, not trusted from the write response |
| Invalid quantities → 4xx | ✅ | `0, -1, -20, 21, 1000, 1.5, "5", null, true, [], {}` all 4xx; stored value unchanged after every rejection |
| DB constraint violations never leak as unhandled 500 | ✅ | the cumulative-add path now returns 400 with an actionable message |
| Concurrent updates never create wrong quantities | ✅ | 5 concurrent absolute sets → one requested value, one row, never the sum; 2 concurrent additive adds of 15 against a cap of 20 → exactly `[201, 400]`, stored 15 |
| Regression tests: set / increase / decrease / concurrent | ✅ | 6 new integration tests + 16 new `money.ts` unit tests |
| `money.ts` negative handling decided, tested, documented | ✅ | §1.3 |
| Real PostgreSQL verification of the `pg.Pool` branch | ✅ | §1.5 |
| No modification of historical order snapshots or financial records | ✅ | no migration, no data-touching change; verified a later price change still does not alter an issued invoice or an order-item snapshot |

**Test totals:** 274/274 passing across 34 files (was 252/252 across 33 — **+22 tests**).
Backend and frontend typecheck clean; production build clean.

### 1.5 Real-PostgreSQL verification — the earlier limitation is now **removed**

My previous report recorded that the production `pg.Pool` transaction branch could not be verified
against real PostgreSQL. That limitation no longer applies: PostgreSQL **18.4** was installed and
run (embedded, port 55432) and the branch was exercised directly. **11/11 passed:**

- all 22 migrations apply cleanly; `verify()` reports zero checksum drift;
- `withTransaction` COMMITs on success;
- `withTransaction` ROLLs BACK **both** `orders` and `order_items` on a throw, and re-throws the
  original error unchanged;
- **genuine connection binding proved** — a row written inside an open transaction is invisible to
  a *different* pooled connection (this is what a stub or emulator cannot demonstrate);
- no connection leak (`idle=2 total=2` after the run);
- 40 truly-parallel inserts produced 40 distinct `CH-XXXXXXXX` order numbers, confirmed unique by
  the database itself.

### 1.6 Remaining Phase 5A limitations (not fixed, not hidden)

- No browser/visual verification was performed — no browser was run. All Phase 5A evidence is
  API- and database-level.
- The `MAX_CART_ITEM_QUANTITY = 20` cap is a product decision inherited from the implementing
  session; I verified it is enforced consistently, not that 20 is the right number for your business.

---

## Part 2 — Phase 5B: financial integrity → **PASS with gaps**

Audited against the merged commit `9361062`, not against its own summary. **42/46 adversarial
assertions passed** on real PostgreSQL.

### 2.1 What genuinely holds

| Area | Finding |
| --- | --- |
| Invoice schema + numbering | `INV-00000001` from a Postgres sequence with a **unique index**; `invoices_order_id_unique_idx` makes a second invoice for the same order impossible (verified: rejected). |
| Ledger immutability | **Genuinely enforced by the database**, not by convention: `BEFORE UPDATE` and `BEFORE DELETE` triggers raise `billing_ledger is append-only`. Verified adversarially — and incidentally proved when the trigger blocked my own probe's cleanup `DELETE`. No `updateLedgerEntry`/`deleteLedgerEntry` function exists anywhere in the codebase. |
| Payment schema + statuses | 7 valid statuses enforced by CHECK; `amount > 0`; partial unique index on `(provider, provider_reference)` prevents duplicate provider records (verified: rejected). |
| Amount/currency consistency | invoice total == order total == ledger amount == sum of `order_items` line totals, exactly (`3 × 19.99 = 59.97`, not `59.969999…`); currency identical across all three tables. |
| Transactional consistency | Order + invoice + opening `charge` ledger entry are one atomic unit. Forced a failure at the invoice step with an injected trigger: **the entire checkout rolled back**, no orphan order, a 500 rather than a fake success, and the customer's cart was preserved. |
| Authorization / ownership | Another customer gets **404, never 403**; unauthenticated 401; list endpoints scoped to the caller; malformed id → 400, not 500. |
| No client-writable financial routes | `POST`/`PUT`/`PATCH`/`DELETE` on `/api/v1/invoices[/:id]` all 404 — invoices and ledger entries are produced **only** as a side effect of checkout. |
| No fabricated values | Invoices open `unpaid`, never pre-paid; no payment row is created at checkout; `discount`/`tax` are genuine zeros (no tax/discount system exists yet), not invented numbers. |
| Interaction with 5A snapshots | A later price change does **not** retroactively alter an issued invoice or an order-item price snapshot. |

### 2.2 Gaps found — 4, all the same class

None of these is currently exploitable: `createInvoice`, `createPayment` and `recordLedgerEntry`
each have **exactly one call site** in `src/services/`, and all of them derive `user_id`,
`currency` and `amount` from the invoice itself. These are missing **defence-in-depth**, and they
matter because Phase 5D's webhook receiver would be a *second* writer into exactly these tables.

| # | Gap | Severity | Fixable without a migration? |
| --- | --- | --- | --- |
| B1 | A `payments` row may carry a **different currency** from its invoice | Medium | Service-layer assertion: **yes, no migration**. Database-level: needs a **new additive** migration (trigger or denormalised FK). |
| B2 | A `payments` row may carry a `user_id` **different from** `invoices.user_id` | Medium | Same as B1 — service-layer yes; DB-level needs a new additive migration. |
| B3 | A `billing_ledger` row may carry a `user_id` different from its invoice's | Medium | Same as B1. |
| B4 | A payment amount **far exceeding** the invoice total is accepted (`999999.00` against a `59.97` invoice) | Medium | Service-layer yes; DB-level needs a new additive migration. Note a real overpayment/partial-payment policy is a product decision, not just a constraint. |

Files: `database/migrations/0018–0020`, `src/db/{invoices,billing-ledger,payments}.ts`,
`src/services/billing-service.ts`, `src/routes/billing.ts`.

### 2.3 One honest caveat on ledger immutability

The append-only triggers stop any application-level `UPDATE`/`DELETE`. They do **not** stop a
database **owner/superuser**, who can `ALTER TABLE billing_ledger DISABLE TRIGGER USER` first — I
verified this is possible. That is a property of PostgreSQL privileges, not a code defect, but it
means the immutability guarantee is only as strong as your production database role separation:
the application's runtime role should not own these tables. Worth deciding before any deployment.

### 2.4 Migration/data risk for 5B

Low. `0018`–`0020` are three pure `CREATE TABLE`/`CREATE INDEX` migrations that add new tables and
touch no existing data. If they have never been applied to your database (see §0.3), removing them
carries no data risk at all.

---

## Part 3 — Phase 5C: payment security → **FAIL (one critical defect)**

Audited against the merged commit `c2d3086`. **67/68** adversarial assertions passed in the main
sweep — but one of those passes was a **false pass** that a stress test then disproved, and that is
the critical finding.

### 3.1 🔴 CRITICAL — concurrent manual confirmations double-credit an append-only ledger

**Where:** `src/services/payment-service.ts#confirmManualPayment` +
`src/db/payments.ts#updatePaymentStatus`.

**Mechanism:** `confirmManualPayment` reads the payment and checks `status === 'pending'`
**outside** its transaction, then updates with `WHERE id = $5` and **no `AND status = 'pending'`
guard**. Two staff requests (or one double-clicked button, or a retried request) that both complete
the read before either commits will both proceed to completion, and each appends its own `payment`
ledger entry.

**Reproduced, twice, on real PostgreSQL:**

```
A. HTTP stress: 25 rounds x 6 concurrent confirms
   worst case: 6 simultaneous 200s, 6 payment ledger entries on one invoice
   => DOUBLE-CREDIT REPRODUCED over HTTP

B. Forced interleave (both reads before either write — exactly what the code permits)
   confirmations that succeeded : 2/2
   payment ledger entries       : 2  (expected 1)
   ledger payment total         : 39.98  vs invoice total 19.99
   => DOUBLE-CREDIT CONFIRMED: the invoice is recorded as paid twice
```

**Why this is the worst possible place for this bug:** the ledger is *append-only by design*, and
the triggers work. The bogus rows therefore **cannot be deleted** — correcting a double-credit
requires issuing compensating reversal entries, so the error is permanently visible in financial
history. A 6× duplicate means an invoice's ledger says it was paid six times.

**Note on my own method:** a single 5-way concurrent run **passed**, and had I stopped there I
would have reported this path as safe. It only reproduced under a 25-round stress and a forced
interleave. I am flagging that explicitly because it is exactly the kind of false pass that makes
a green test suite misleading on financial code.

**Fix shape (NOT applied — payment behaviour is frozen):** add `AND status = 'pending'` to the
`UPDATE` in `updatePaymentStatus` (or `SELECT ... FOR UPDATE` inside the transaction) and treat a
zero-row result as "already resolved". This is a **code-only change, no migration**. I have not
made it, and will not, without your approval.

### 3.2 🟠 The signed webhook has no receiver — your item 5 requirement cannot be satisfied

You required verification that *"the signed webhook passes through the real application
verification and payment-processing pipeline."* **No such pipeline exists.**

- `grep -rn webhook src/routes/ src/app.ts` yields only explanatory comments.
- `POST` to `/api/v1/webhooks/sandbox`, `/api/v1/payments/webhook`, `/webhooks/sandbox` and
  `/api/v1/payments/webhooks/sandbox` with a **valid** signature all return **404**.
- `buildSignedWebhookPayload` has **no production consumer** — its only reference in the whole
  repository is `tests/integration/payments-schema.test.ts`.
- `verifySignature` is **never called by any route**.
- A correctly-signed "payment successful" webhook therefore changes nothing: the payment stays
  `pending` (verified).

Consequence: signature verification, replay/duplicate-event rejection, webhook idempotency, and
wrong-amount/wrong-currency/bad-reference rejection **cannot be tested end-to-end and must be
reported as UNVERIFIED**, because there is nothing to test them against. The 5C documentation is
honest about this (it defers the receiver to 5D), but it means a substantial part of what "payment
integration" normally implies is absent.

### 3.3 What *is* implemented and verified

| Requirement | Result |
| --- | --- |
| Sandbox unmistakable for a real provider | ✅ references are `sandbox_<24 hex>`, method `sandbox_demo`, instructions state *"No real money moves"* |
| Sandbox cannot self-confirm | ✅ stays `pending`; staff confirm path explicitly **refuses** non-`manual` payments (400) |
| No invented credentials or provider claims | ✅ manual gateway's fallback text explicitly says instructions are not configured rather than inventing a bank account or reference number |
| Real cryptographic signing | ✅ genuine HMAC-SHA256: 64-hex digest, independently recomputed and matched; fails under a wrong secret, on a tampered amount, and on a garbage/truncated signature; uses `timingSafeEqual`, and fails closed on length mismatch rather than throwing; refuses to sign with no secret configured or for a non-sandbox payment |
| Signed webhook through the real pipeline | ❌ **UNVERIFIED — no pipeline exists** (§3.2) |
| Invalid signature / wrong amount / currency / reference rejected | ⚠️ the **primitive** rejects all of them; **no endpoint** consumes it, so end-to-end is unverified |
| Duplicate + replayed events rejected | ⚠️ **UNVERIFIED** — no receiver; the `(provider, provider_reference)` unique index is the right groundwork and does reject duplicates at the schema level |
| Idempotency + transaction boundaries | ❌ **defective on the one live path** (§3.1); sequential replay *is* correctly rejected (400, still exactly one ledger entry) |
| Manual entries require authorized staff + auditable record | ✅ customer 403, anonymous 401, other customer 403; admin succeeds; records `confirmed_by_user_id`, `completed_at`, and an `auth_audit_log` row naming the acting staff member and the target customer |
| No customer/browser can mark an order paid | ✅ every attempted route 403/404/405; client-supplied `status`, `amount`, `provider`, `confirmedByUserId` are all ignored; after every attempt **zero** invoices were anything but `unpaid` |
| No secret exposed to frontend, logs, or repo | ✅ webhook secret and JWT secret absent from every response body checked; no `.env` in the repo; no secret in the built frontend bundle |
| No real provider activated | ✅ `stripe`/`paypal`/`flutterwave`/`paystack` all 400; only `manual` + `sandbox` exist in the database |
| Correct ledger/invoice/order effects on confirmation | ✅ invoice → `paid`, order `payment_status` → `paid` with fulfillment `status` untouched, exactly one `payment` ledger entry **in the sequential case** |
| Rejection path | ✅ requires a reason (400 without one); records **no** ledger entry (nothing was charged); invoice stays `unpaid` |

### 3.4 5C migration/data risk

Low. `0021` is an additive `ADD COLUMN IF NOT EXISTS confirmed_by_user_id`; `0022` extends an
audit-log event-type constraint. Neither rewrites or destroys data.

---

## Part 4 — Safe recovery plan (recommended, **not executed**)

Nothing below has been performed. Each option preserves Phase 4 functionality, Phase 5A historical
order data, and any legitimate financial records.

### Option A — Keep the merged work, fix forward with additive changes *(recommended)*

Justification: the audit found the 5B/5C **foundations sound** — real transactional integrity,
real database-enforced ledger immutability, real cryptography, real authorization, no fabricated
data, no activated provider. The problem is a **process** failure plus **one** concurrency defect
that is a code-only fix. Reverting would discard a large amount of correct work to solve a problem
that a single `AND status = 'pending'` clause solves.

Sequence, each step reviewed and approved by you before the next:

1. **Merge PR #12** (5A remediation, `8806b9d` + `d0afa16`) — code-only, no migration, 274/274.
2. **Fix 5C §3.1** — add the status guard to `updatePaymentStatus`
   (`cloudhost247-node/src/db/payments.ts:99–113`), plus a concurrency regression test that fails
   against today's code. Code-only, **no migration**.
3. **Close 5B gaps B1–B4** as service-layer assertions in
   `cloudhost247-node/src/services/payment-service.ts` — code-only, **no migration**.
4. *(Optional, later)* Promote B1–B4 to database constraints in one **new additive** migration
   `0023`. Additive only; never edit `0018`–`0022`, which may already have been applied.
5. **Only then** consider authorizing 5D, with the webhook receiver built against the now-verified
   signing primitives.

> **Update:** both the 5C fix and Option B are now **prepared as verified, unapplied patches** in
> `recovery/` (see `recovery/README.md`). Each was applied temporarily, tested against real
> PostgreSQL 18.4, and reverted; the revert was itself verified by re-reproducing the §3.1 defect.
> The 5C fix takes the double-credit from **6 ledger entries down to 1** under the same 25-round
> stress that exposed it, with 58/58 payment+billing tests still passing. Option B verified 14/14:
> payment endpoints gone, Phase 4 / 5A / 5B intact, all financial history and tables preserved.
> **Neither is applied.** No Phase 5B or 5C source file is modified on this branch.

### Option B — Narrowly scoped disablement *(prepared only, awaiting approval)*

If you judge 5B/5C unacceptable regardless of correctness, the **minimum** intervention is to
disable the customer-facing surface without deleting anything:

- Comment out `registerPaymentsRoutes` and `registerAdminBillingRoutes` in
  `cloudhost247-node/src/app.ts` — this removes every payment endpoint while leaving invoices,
  ledger, schema and history completely intact.
- Optionally also remove `registerBillingRoutes` to hide invoice reads.
- **Do not** revert the merge commit `cca731a`: 5A is entangled with 5B in
  `src/services/commerce-service.ts` (checkout issues the invoice inside its transaction), so a
  whole-PR revert would take working Phase 5A commerce with it.
- **Do not** drop migrations `0018`–`0022` unless §0.3 step 1 confirms they were never applied.

I have prepared this but **not executed it**, per your instruction.

### Option C — If migrations already ran or financial records exist

Run §0.3 first. If `schema_migrations` contains anything ≥ `0014`, **or** any row exists in
`orders`/`invoices`/`payments`/`billing_ledger`:

1. **Back up before anything else:** `pg_dump --format=custom` of the full database, verified restorable.
2. **Do not drop or alter any Phase 5 table.** Data preservation outranks schema tidiness.
3. **Audit for the §3.1 double-credit** before any code change:
   ```sql
   SELECT invoice_id, count(*) AS entries, sum(amount) AS credited
   FROM billing_ledger WHERE entry_type = 'payment'
   GROUP BY invoice_id HAVING count(*) > 1;
   ```
   Any row here is a real double-credit. Because the ledger is append-only, correct it with a
   compensating `refund`/`credit` entry — **never** by deleting rows, which the triggers rightly
   forbid anyway.
4. Apply Option A's fixes forward; disable routes per Option B if you need an immediate stop.
5. Treat any `payments` row with `status <> 'pending'` as a real financial event requiring
   reconciliation against your bank records before any further change.

---

## Part 5 — What I changed, and what I deliberately did not

**Changed (Phase 5A remediation + documentation only):**

| Commit | Files |
| --- | --- |
| `8806b9d` | `src/config/billing.ts`, `src/db/carts.ts`, `src/services/commerce-service.ts`, `src/routes/commerce.ts`, `tests/integration/commerce-api.test.ts` |
| `d0afa16` | `src/lib/money.ts`, `tests/unit/money.test.ts` (new), `tests/integration/commerce-api.test.ts` |
| this commit | `docs/NODE_PLATFORM_STATUS.md`, `PHASE_5_CHECKPOINT_REPORT.md` (new) |

**Deliberately not done:** no Phase 5D/5E/5F/5G; no change to any 5B or 5C source file; no fix for
the §3.1 critical defect; no new migration; no modification of any historical order snapshot or
financial record; no gateway credentials; no deployment; no merge of any commerce/billing/payment
PR; no `git reset --hard`, force-push, branch deletion, history rewrite or whole-PR revert.

`docs/NODE_PLATFORM_STATUS.md` now records 5B and 5C as **merged before required approvals, not
accepted, not production-ready**, with a per-section status banner so the implementing session's
own write-ups cannot be mistaken for an acceptance record.

---

## Decision required

1. **Phase 5A / PR #12** — merge the remediation, change it, or reject it?
2. **The 5C critical defect (§3.1)** — authorize the code-only fix, or leave it frozen?
3. **Recovery path** — Option A (fix forward), Option B (disable routes), or Option C (data-preserving
   remediation, if §0.3 shows migrations already ran)?
4. **The 5B gaps (B1–B4)** — service-layer assertions now, a new additive migration later, or defer?

I am stopping here and taking no further action until you decide.

---

# ADDENDUM — Authorized remediation (commit `7a46ebd`)

Added after your decisions of 2026-09-29. Scope was limited to exactly what you authorized: the 5C
concurrency defect and the four 5B cross-row gaps. **Webhook work was not touched. No migration was
added. No historical financial record was modified or deleted. Nothing was deployed. PR #12 remains
open and unmerged.**

## A. 5C double-credit defect — FIXED and independently verified

**Root cause:** `confirmManualPayment` checked `status === 'pending'` outside its transaction, then
updated with `WHERE id = $1` and no status guard. Two requests that both completed the read before
either committed would both proceed, each appending a `payment` ledger entry.

**Fix** (`src/db/payments.ts`, `src/services/payment-service.ts` — code only):

- `updatePaymentStatus` takes `expectedCurrentStatus`, folded into the `UPDATE`'s own `WHERE`
  clause (`AND ($6::text IS NULL OR status = $6)`). Check and write are now one atomic
  database-enforced statement. Under `READ COMMITTED` the loser re-evaluates the predicate against
  the committed row, matches nothing, and updates zero rows.
- The loser receives a deterministic **409 Conflict** and its entire transaction is abandoned — no
  ledger entry, no invoice update, no order update.
- The pre-transaction guard now also raises **409** instead of 400, so "already processed" is one
  answer regardless of whether the duplicate arrives a millisecond or a day late. *(This changes two
  existing assertions in `payments-api.test.ts` from 400 to 409 — a deliberate, behaviour-visible
  change, made because you required a deterministic conflict response.)*

**Verification against real PostgreSQL 18.4:**

| Check | Before | After |
| --- | --- | --- |
| Forced interleave (both reads before either write) | 2/2 succeeded, ledger 39.98 vs invoice 19.99 | **1/2 succeeded, 1 × 409, ledger 19.99 = invoice** |
| Stress 40 rounds × 8 concurrent | up to **8 × 200, 6 ledger entries** | **max 1 × 200, max 1 ledger entry, 0 non-409 losers** |
| Invoices over-credited afterwards | present | **0** |
| Invoices with duplicate payment entries | present | **0** |
| Successful payments whose invoice isn't `paid` | — | **0** |
| Ledger-write failure mid-transaction | — | payment stays `pending`, invoice `unpaid`, retry succeeds |

**Four permanent regression tests** added to `tests/integration/payments-api.test.ts`: simultaneous
confirmations, repeated bursts with a global over-credit invariant, a confirm-vs-reject race, and
atomic rollback on ledger failure. **Three of the four fail against the pre-fix code** (the fourth
covers transaction rollback, which was already correct — stated plainly rather than overclaimed):

```
× commits exactly one confirmation when several arrive simultaneously
    AssertionError: expected [200,200,200,200,200,200,…(2)] to have a length of 1 but got 8
× keeps the ledger total equal to the invoice total under repeated concurrent bursts
    AssertionError: expected [ …(5) ] to have a length of 1 but got 5
× lets a confirmation and a rejection race without producing both outcomes
    AssertionError: expected [ 200, 400 ] to deeply equal [ 200, 409 ]
```

## B. 5B gaps B1–B4 — ALL FOUR FIXED, no migration required

| # | Invariant | File · function | Enforcement |
| --- | --- | --- | --- |
| B1 | payment currency == invoice currency | `src/db/payments.ts` · `createPayment` | derived from the invoice row |
| B2 | payment `user_id` == invoice `user_id` | `src/db/payments.ts` · `createPayment` | derived from the invoice row |
| B3 | ledger `user_id`/currency == invoice's | `src/db/billing-ledger.ts` · `recordLedgerEntry` | derived from the invoice row |
| B4 | payment amount <= invoice total | `src/db/payments.ts` · `createPayment` | `AND $6 <= i.total_amount` in the same statement |

Both writers now use `INSERT ... SELECT ... FROM invoices` so the invoice is read **inside the
caller's transaction**, under the same snapshot and locks as the write. A separate `SELECT`
followed by an `INSERT` would have reintroduced exactly the race that caused the 5C defect. A
defensive post-insert assertion catches any caller whose assumptions have drifted.

**No migration was needed** — the enforcement lives in the write path and is transaction-safe.
Promoting these to database CHECK/trigger constraints would additionally protect against direct SQL
access, but that requires a **new additive** migration `0023`; per your instruction I have **not**
written it and will request approval separately if you want it.

**Seven regression tests** in `tests/integration/billing-schema.test.ts` cover each invariant, a
positive control (exact-total, partial, invoice-less entries all still work), rollback of a valid
write beside a rejected one, and a payment against a non-existent invoice. **Six of the seven fail
against the pre-fix code**; the positive control passes both before and after, confirming the fix
blocks only what it should.

## C. Webhook pipeline — UNCHANGED and FROZEN

No receiver route was added. `verifySignature` is still called by no route. **The sandbox payment
pipeline is not end-to-end functional and is not claimed to be.** No provider was activated, no
credential added. Proposed scope: `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` — not authorized, not
started.

## D. Have duplicate entries already been written anywhere persistent?

**Not in anything I can reach — and I did not connect to production.** The only database in this
sandbox is an ephemeral PostgreSQL 18.4 instance created for the audit; the duplicates it briefly
contained were produced by my own pre-fix reproduction and the tables were cleared afterwards.
Current state: **0 invoices with duplicate payment ledger entries, 0 over-credited invoices.**

Your production database cannot be reached from here, so only you can answer this. Run
`recovery/check-production-state.sql` (read-only, verified: all 8 statements execute cleanly and
the `READ ONLY` transaction genuinely rejects writes). **Sections 5 and 6 detect exactly this
condition** — run against the audit database those queries correctly identified 25 affected
invoices, so the detection is demonstrated rather than assumed.

**If either section returns a row, stop and send me the output.** I will not insert reversal
entries or modify any financial record without an approved reconciliation plan.

## E. Verification summary

| Item | Result |
| --- | --- |
| Full suite (working copy) | **285/285 across 34 files** (was 274/274 across 34) |
| Full suite (**clean clone**, fresh `npm ci`) | **285/285 across 34 files** |
| Typecheck (backend + frontend) | clean, both copies |
| Production build | clean, both copies |
| Adversarial probe vs real PostgreSQL 18.4 | **21/21** |
| New tests verified to fail pre-fix | 9 of 11 (the other 2 are positive/rollback controls) |
| Migrations added | **none** — still 22, unchanged |
| Historical financial records modified | **none** |

**Commits this session:** `8806b9d` (5A cart fix) · `d0afa16` (5A money.ts) · `8120af1` (checkpoint
report + governance) · `50a1c47` (prepared recovery patches) · `3b12c49` (production check script) ·
**`7a46ebd`** (authorized 5C + 5B fixes).

`recovery/5c-fix-concurrent-manual-confirm.patch` is now **superseded** by `7a46ebd`, which
implements the same fix plus the 409 determinism and the regression tests.
`recovery/option-b-disable-payment-routes.patch` remains prepared and **unapplied**.

## F. Remaining limitations — stated, not hidden

1. **No phase is accepted.** 5A, 5B and 5C remain unaccepted and not production-ready.
2. **The webhook pipeline does not exist.** Signature verification, replay rejection and webhook
   idempotency remain **UNVERIFIED end-to-end** because there is nothing to verify against.
3. **No browser/visual verification** was performed at any point — no browser was run.
4. **Production state is unknown to me.** Every "nothing deployed" statement covers this repository
   and its CI only.
5. **B1–B4 are enforced in the write path, not by database constraints.** Direct SQL access bypasses
   them; that would need additive migration `0023`, which I have not written.
6. **Ledger immutability is privilege-dependent** — a table owner can disable the triggers. The
   application's runtime role should not own these tables in production.

**Stopping here and awaiting your explicit acceptance.**

---

# ADDENDUM 2 — Gap closure after re-reading the directive (commit `3fc4a9d`)

Re-reading your requirements line by line against what commit `7a46ebd` actually contained found
two items only partially met. Both are now closed.

## 1. "Deterministic concurrency tests with forced interleaving"

`7a46ebd`'s concurrency tests raced with `Promise.all`. That is realistic but **nondeterministic** —
the interleaving that triggers the defect may or may not occur on any given run. The barrier-based
forced interleave existed only in a throwaway probe, not in the repository.

Now committed as `DETERMINISTIC forced interleave: both callers read 'pending' before either
writes` in `tests/integration/payments-api.test.ts`. A `Queryable` proxy holds every caller at the
point just past the pre-transaction status read until **all** callers have passed it, so the test
asserts `arrived === 2` — proving both genuinely observed `pending` — before either transaction
writes. One must commit; the other must receive **409** and write nothing.

Verified against the pre-fix code (files restored from `3b12c49`):

```
× DETERMINISTIC forced interleave: both callers read `pending` before either writes
    AssertionError: expected [ { status: 'fulfilled', …(1) }, …(1) ] to have a length of 1 but got 2
```

## 2. "Test … concurrent operations" for the 5B gaps

The B1–B4 tests in `7a46ebd` were all sequential. Two concurrency tests are now added to
`tests/integration/billing-schema.test.ts`:

- **`holds every invariant under concurrent writes against the same invoice`** — issues two
  legitimate and three invariant-violating payments simultaneously; each must resolve according to
  its own validity, and only the two legitimate rows may persist.
- **`never lets concurrent ledger writes attribute an entry to the wrong owner`** — a legitimate
  and a misattributed ledger write race; only the legitimate one may survive, which matters
  especially here because the ledger is append-only and a wrong row would be permanent.

Both fail against the pre-fix code:

```
× holds every invariant under concurrent writes against the same invoice
    AssertionError: wrong-currency should have failed: expected 'fulfilled' to be 'rejected'
× never lets concurrent ledger writes attribute an entry to the wrong owner
    AssertionError: expected 'fulfilled' to be 'rejected'
```

## Correction to Addendum 1's evidence

While re-verifying, I found that one pre-fix check in the previous round used
`git stash push <paths>` on files that had **no uncommitted changes** (the fix was already
committed). That stashed nothing, so the "pre-fix" run still had the fix in place and proved
nothing. The earlier checks in that round were valid — the changes were genuinely uncommitted at
the time — but this one was not, and the run that produced it should be disregarded.

All pre-fix verification is now done by explicitly restoring the file versions from `3b12c49`, the
last commit before the fix, which cannot silently no-op.

## Updated totals

| Item | Result |
| --- | --- |
| Full suite (working copy) | **288/288 across 34 files** (was 285) |
| Full suite (**clean clone**, fresh `npm ci`) | **288/288 across 34 files** |
| Typecheck + production build | clean, both copies |
| New tests this round | 3, **all three verified to fail pre-fix** |
| Cumulative new tests since the audit began | 14 |
| Migrations | **22, unchanged — none added** |
| Historical financial records modified | **none** |

**Commits:** `8806b9d` · `d0afa16` · `8120af1` · `50a1c47` · `3b12c49` · `7a46ebd` · **`3fc4a9d`**

Everything else in Addendum 1 stands: webhook work untouched and frozen, no phase marked accepted,
PR #12 open and unmerged, nothing deployed.

---

# ADDENDUM 3 — Production-check correctness fix (commit pending)

## A latent bug in the production check, found and fixed

Section D of your directive asks specifically whether **migrations 0018–0022** have been applied.
The check script answered that only indirectly (`WHERE version >= '0014'`), so an explicit
per-migration check was added. On verification it reported **"not applied" for all five against a
database where all five WERE applied.**

Cause: `schema_migrations.version` stores the four-digit prefix (`'0018'`), not the full filename
(`'0018_create_invoices'`). Matching on filenames never matches.

This mattered more than a normal bug: it fails in the **dangerous direction**. It would have told
you Phase 5 never reached production when it had — and per the script's own interpretation notes,
that answer routes you to "Option B is available at essentially zero data risk."

Fixed, and verified in **both** directions, which is what the original check lacked:

```
--- against a database where they ARE applied (must all say APPLIED) ---
  APPLIED      0018_create_invoices
  APPLIED      0019_create_billing_ledger
  APPLIED      0020_create_payments
  APPLIED      0021_add_payment_confirmation_fields
  APPLIED      0022_extend_auth_audit_log_event_types_for_payments
--- against a database where they are NOT applied (must all say not applied) ---
  not applied  0018 / 0019 / 0020 / 0021 / 0022
```

All 9 statements in the file execute cleanly; the `READ ONLY` transaction still rejects writes.

## Sandbox snapshot restore — recovered without reset or force-push

The environment was restored from a snapshot mid-session: `HEAD` reverted to `cca731a` and all nine
session commits were absent locally, though present on `origin`. The working tree was verified
**byte-identical** to the pushed tip `bb083e3` (`git diff --cached bb083e3` empty) before anything
was touched, then recovered with `fetch --unshallow` + `stash -u` + `merge --ff-only bb083e3`.

**No `git reset --hard`, no force-push, no branch deletion, no history rewrite.** Local now matches
`origin/arena/01a0e9c8-cloudhost247` exactly at `bb083e3`, all nine commits intact, tree clean.
`node_modules`, `/tmp` probes and the PostgreSQL instance were also wiped and have been rebuilt;
the full suite was re-run on the recovered checkout: **288/288 across 34 files.**

## On the remaining migration-dependent gap (item B, "document any gap that cannot safely be fixed without a migration")

B1–B4 are fixed by transaction-safe enforcement in the write path, with **no migration**. Two
things remain that *would* require one, and I am **requesting approval rather than writing them**:

1. **Promoting B1–B4 to database constraints** (additive migration `0023`). The current enforcement
   binds every write that goes through `createPayment`/`recordLedgerEntry` — which is every write
   the application makes — but not direct SQL access.
2. **A database-level guarantee of at most one `payment` ledger entry per invoice** (a partial
   unique index). Today that is guaranteed by the fixed conditional transition, not by the schema.
   **Caveat worth your attention:** such an index would permanently forbid legitimate partial
   payments, which the schema currently allows. I do not recommend it without a product decision on
   whether partial payments are ever in scope.

Neither has been written. Both are additive-only if approved; `0018`–`0022` would not be edited.

---

# ADDENDUM 4 — A defect in my own B1–B4 fix, found by re-verification

## What happened

The 21-check adversarial probe cited earlier in this report was evidence from a sandbox the
platform later destroyed. Rather than keep citing a run that no longer existed, I rebuilt it as a
28-check probe against real PostgreSQL 18.4 and added one thing the original lacked: a
**whole-database consistency sweep** at the end, rather than per-test assertions only.

The sweep failed. One invoice carried **two** `payment` ledger entries totalling **99.98 against a
49.99 total**. Both rows came from probe checks that had just reported **PASS — correctly
rejected**.

## Cause — my own code, commit `7a46ebd`

The B1–B4 remediation enforced the cross-row invariants as an assertion **after** the INSERT:

```ts
const { rows } = await tx.query(`INSERT INTO billing_ledger ... SELECT ... FROM invoices WHERE i.id = $2`);
const row = rows[0];
if (input.invoiceId && (row.user_id !== input.userId || row.currency !== input.currency)) {
  throw new Error(`Ledger/invoice mismatch ...`);   // the row is ALREADY WRITTEN
}
```

The INSERT derives `user_id`/`currency` from the invoice, so it always succeeds; the mismatch is
then detected and thrown. Inside a transaction the rollback erases the row and the behaviour looks
correct — which is why every existing test passed. But `tx` is typed `Queryable`, and a plain
`pg.Pool` satisfies it. Called that way, under autocommit, **the row is committed and then the
function throws**: the caller is told the write was rejected while an immutable, undeletable entry
sits in the ledger, over-crediting the invoice.

`createPayment` in `src/db/payments.ts` had the identical shape.

In an append-only table this is the worst available failure mode: the safety net was writing
exactly the row it existed to prevent, and nothing can delete it afterwards.

**Reachability — stated precisely.** All three current callers (`billing-service.ts:35`,
`payment-service.ts:166`, `payment-service.ts:76`) pass `tx` from inside `withTransaction`, so
**this was not reachable through the application as it stands today, and no production path could
have produced a phantom credit.** It was a latent trap for the next caller, and the code comment
claiming the invariant was "structurally impossible to violate" was simply false.

## Fix (code-only, no migration)

The invariant moved into the `WHERE` clause, so a mismatch matches no row and nothing is written:

```sql
FROM invoices i
WHERE i.id = $2
  AND i.user_id = $6
  AND i.currency = $7
```

On zero rows both functions now read the invoice back to distinguish "does not exist" from
"mismatch" and throw accordingly. The guarantee no longer depends on the caller being inside a
transaction.

## Evidence

Five regression tests added to `tests/integration/billing-schema.test.ts`, each calling with the
connection directly rather than a transaction. Proven to fail against `7a46ebd`:

```
× writes no ledger row when the caller misattributes the entry to a non-owner
× writes no ledger row when the caller asserts the wrong currency
× never lets a sequence of rejected ledger writes over-credit an invoice
× writes no payment row when the caller misattributes the payment to a non-owner
× writes no payment row when the caller asserts the wrong currency
  AssertionError: expected '249.95' to be null
```

That last line is five consecutive rejected writes crediting **249.95** to a 49.99 invoice.

| Check | Result |
| --- | --- |
| Full suite | **293/293 across 34 files** (288 + 5) |
| Adversarial probe vs real PostgreSQL 18.4 | **28/28**, including the whole-DB sweep |
| Typecheck | clean |
| Migrations added | **none** — still 22 |
| Historical financial records modified | **none** |

## What this says about the earlier verdict

My previous report stated B1–B4 were closed and independently verified. That was **overstated**.
The invariants held for every caller that existed, but the enforcement was not structural in the
way the code and the report both claimed. It took a whole-database sweep — not per-test assertions
— to expose it, which is worth remembering when judging the rest of this audit: **passing
adversarial tests demonstrated that each call behaved correctly, not that the database was left in
a consistent state.** I have not re-derived every other conclusion in this report under that
stricter standard, and I am not claiming it here.

Phase 5B remains **NOT ACCEPTED**, and nothing here changes that.

---

# ADDENDUM 5 — Finding B5: an invoice could be attributed to the wrong customer

Addendum 4 closed with an admission: I had not re-derived the rest of the audit under the stricter
"sweep the database, not just the call" standard. Doing that produced a second finding.

## The anti-pattern hunt

First I searched every repository module for the shape that caused the Addendum 4 defect — a write
whose invariant is asserted *after* it. The two I had already fixed were the only instances; no
other module writes first and validates second. That part of the codebase is clean.

## Finding B5

`createInvoice` inserted the caller's values with **no reference to the parent order at all**:

```sql
INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, ...)
VALUES ($1, $2, $3, $4, $5, ...)
```

Nothing tied `user_id`, `currency` or any amount to the order being invoiced. The whole-database
sweep caught it immediately: an invoice persisted against an order owned by a different user.

**Why this one matters more than Addendum 4's.** `listInvoicesForUser` scopes by
`invoices.user_id`, and both the ledger entry and the payment row derive their owner *from the
invoice*. A single wrong `user_id` at invoice creation would therefore carry an entire financial
chain — invoice, opening charge, payment, payment ledger entry — to the wrong customer, and the
ledger half of that chain is append-only and undeletable.

**Reachability, stated precisely.** The only caller, `issueInvoiceForOrder`
(`src/services/billing-service.ts:23`), copies the order's own fields verbatim, so **the invariant
held in practice and no misattributed invoice could have been produced by the application.** As in
Addendum 4, the gap was that it was never *enforced*.

## Two false passes in my own probe

The first run of the rewritten probe reported that the currency and total cases were correctly
rejected. They were not. All three cases reused the same order, and
`invoices_order_id_unique_idx` allows one invoice per order — so after the first case inserted its
row, the next two were rejected by the **unique index**, for a reason unrelated to the invariant
under test. Only the owner case was genuinely exercised. Each case now uses its own order, in both
the probe and the committed tests.

This is the same failure mode as the `git stash` no-op disclosed in Addendum 2: a check that
appears to pass while testing nothing. It is worth stating plainly that two of the three have now
been caught only because something else forced a closer look.

## Fix (code-only, no migration)

`createInvoice` now derives `user_id` and `currency` from the order and requires every amount to
equal the order's, all in the `WHERE` clause, so a disagreement matches no row and nothing is
written:

```sql
SELECT $1, o.id, o.user_id, o.currency, $4, $5, $6, $7
FROM orders o
WHERE o.id = $2 AND o.user_id = $3 AND o.currency = $8
  AND o.subtotal_amount = $4 AND o.discount_amount = $5
  AND o.tax_amount = $6 AND o.total_amount = $7
```

Ten existing tests failed against this, all for the same reason: they paired a fixture order of
49.99 with a fixture invoice of 10.00, amounts that were never related because nothing required
them to be. No assertion depended on the mismatch — it was incidental fixture data — so the
fixtures were aligned rather than the constraint weakened.

## Evidence

| Check | Result |
| --- | --- |
| Full suite | **298/298 across 34 files** (293 + 5) |
| Invariant probe vs real PostgreSQL 18.4 | **49/49**, including a 16-query whole-DB sweep |
| Pre-fix proof | all 4 adversarial B5 tests fail against `104cd6f`; the legitimate case passes both before and after |
| Typecheck | clean |
| Migrations added | **none** — still 22 |
| Historical financial records modified | **none** |

## The probe is now committed

`recovery/verify-financial-invariants.ts` is in the repository so this is reproducible by you
rather than a claim about a sandbox you cannot inspect:

```
cd cloudhost247-node && LOG_LEVEL=silent npx tsx ../recovery/verify-financial-invariants.ts
```

It creates and drops its own throwaway database and never contacts production.

## Standing assessment

Two latent integrity gaps in two rounds of deeper review, both in code I had already reported as
verified. Neither was reachable through the application, and I have no evidence of any incorrect
financial record — but the rate at which this standard keeps finding things is itself the most
useful result here. **Phase 5B remains NOT ACCEPTED**, and I would not treat the billing foundation
as settled on the strength of the current evidence.

---

# ADDENDUM 6 — Phase 5C authorization and secret exposure, under the sweep standard

The one substantial area not yet re-derived under the "sweep the database, not just the call"
standard was the directive's hardest security requirement: **no customer or browser request may
mark an order paid without verified authorization.** This addendum closes that.

**No new defect was found here.** After two rounds that each found one, that is worth stating
plainly rather than padding.

## Authorization matrix — 39/39

`recovery/verify-payment-authorization.ts` (committed) drives the real Fastify app from
`src/app.ts` against real PostgreSQL 18.4, through the real auth middleware, with nothing mocked.
It attacks all six financial routes:

```
GET  /api/v1/invoices                                GET  /api/v1/payments/:id
GET  /api/v1/invoices/:id                            POST /api/v1/admin/payments/:id/confirm-manual
POST /api/v1/invoices/:id/payments                   POST /api/v1/admin/payments/:id/reject-manual
```

with five unauthorized callers: no credentials; a garbage bearer token; **a token signed with the
wrong secret**; another logged-in customer; and the invoice owner's own valid token against the
staff routes. Every combination is rejected with 401/403/404.

Critically — and this is the part a normal route test omits — the probe snapshots invoice,
payment, ledger, paid-invoice, paid-order, successful-payment counts and the ledger sum before the
matrix and re-compares afterwards:

```
PASS  financial state is byte-for-byte unchanged after every rejected request
PASS  no customer-side request moved the invoice to paid
PASS  no customer-side request produced a successful payment
PASS  no customer-side request produced a payment ledger entry
PASS  the payment amount came from the invoice, not the request body
```

Client-supplied `status: 'successful'` and `amount: '0.01'` in the initiation body are both
ignored — the amount is taken from the invoice.

The control cases confirm this is not simply a broken endpoint: an admin **can** confirm, it
**does** mark the invoice paid, it writes **exactly one** ledger entry, and it leaves an
`auth_audit_log` record naming the acting staff member. A replayed confirmation is refused with a
4xx and adds no ledger entry.

## Two more false passes in my own probe, caught before reporting

1. The first run's checkout used a non-existent endpoint, so `invoiceId` was `undefined` and six
   routes were being called as literally `/undefined`. They "passed" — a rejection that proves
   nothing about authorization. The probe now **aborts** on bad fixtures rather than reporting
   meaningless passes.
2. Five control checks failed because the probe's own later initiations had cancelled the payment
   it was about to confirm — `initiatePaymentForInvoice` cancels other pending attempts so a
   customer can abandon a stale one. Correct product behaviour, misread as a defect; the control
   now uses a fresh attempt.

That is four self-inflicted false results across this audit (the `git stash` no-op, the reused
order, and these two). Each was caught only by looking again at something that already said PASS.

## Secret exposure — clean, verified rather than asserted

Three secrets exist: `JWT_SECRET`, `CRON_JOB_TOKEN`, `SANDBOX_GATEWAY_WEBHOOK_SECRET`.

| Check | Result |
| --- | --- |
| Referenced anywhere in `frontend/src` | no |
| Present in the built browser bundle (`public/assets/*.js`, 249,591 bytes) | **no** — all three identifiers absent, as are `createHmac`, `signPayload`, `DATABASE_URL`, `postgresql://` |
| `confirm-manual` route referenced in the bundle | **no** — the frontend has no notion of the staff route |
| Committed to the repository (`.env`, `*.pem`) | none tracked |
| Passed to any log call | none |
| **Empirically** logged on a request carrying a bearer token | **0 occurrences** — the logger records only method, url, host, remoteAddress; headers are never serialized |

The last row was measured, not inferred: a request with a known sentinel token was injected and the
captured log output searched for it.

**One observation, not fixed.** There is no `redact` configuration on the logger
(`src/lib/logger.ts`). Nothing currently logs a secret, so the requirement is met in fact — but it
is met by every call site happening to be careful, not by a structural guarantee. That is the same
"held in practice, never enforced" shape as findings B5 and Addendum 4. I have **not** changed it:
it is outside the financial scope this remediation was authorized for, and the logger affects the
whole application. **Recommended as a small separate change, awaiting your approval.**

## Evidence

| Check | Result |
| --- | --- |
| Authorization matrix vs real PostgreSQL | **39/39** |
| Financial invariant probe | **49/49** |
| Full suite | **298/298 across 34 files** |
| Typecheck + production build | clean |
| Migrations added | **none** — still 22 |
| Production contacted | never |

Both probes are committed and reproducible by you:

```
cd cloudhost247-node
LOG_LEVEL=silent npx tsx ../recovery/verify-financial-invariants.ts
LOG_LEVEL=silent npx tsx ../recovery/verify-payment-authorization.ts
```

## Standing assessment

Phase 5C's authorization boundary is the strongest-looking part of this work: it held under every
adversarial combination tried, including the database-state check that caught defects elsewhere.
**That is not the same as accepting it.** The webhook pipeline remains frozen and unverified end
to end, no real provider is activated, and **Phase 5B and 5C remain NOT ACCEPTED.**

---

# ADDENDUM 7 — Re-verifying the recovery plan itself

The recovery artifacts in `recovery/` are the safety net for this whole situation, and they had
not been re-checked since the code moved underneath them. A rollback plan that silently stopped
working is worse than no plan, because it is trusted. Both were re-tested against the current tip
`81c515c`.

## `5c-fix-concurrent-manual-confirm.patch` — obsolete, and now says so

It no longer applies. `git apply --check` fails on both `src/db/payments.ts` and
`src/services/payment-service.ts`: the authorized fix in `7a46ebd` changed the same lines. This is
expected — the patch was superseded by the real fix — but nothing in `recovery/` said so, and a
reader reaching for it in an incident would have hit a confusing error.

It is now marked **OBSOLETE, DO NOT APPLY** at the top of `recovery/README.md`, kept unmodified as
a record of what was proposed before the fix was authorized.

## `option-b-disable-payment-routes.patch` — still valid, re-verified 12/12

The original 14/14 verification was against `50a1c47`. A great deal has changed since (the 5C
concurrency fix, findings B1–B5), so it was re-run rather than assumed. Applied to a throwaway
clone of `81c515c`:

```
git apply --check   : passes
tsc --noEmit        : exit 0

PASS  5A: add-to-cart still works
PASS  5A: checkout still creates an order
PASS  5B: checkout still issues an invoice
PASS  5B: the opening charge ledger entry is still written
PASS  5B: the customer can still read their invoices
PASS  5B: the customer can still read one invoice
PASS  5C: POST /api/v1/invoices/:id/payments is switched off
PASS  5C: GET /api/v1/payments/:id is switched off
PASS  5C: POST /api/v1/admin/payments/:id/confirm-manual is switched off
PASS  5C: POST /api/v1/admin/payments/:id/reject-manual is switched off
PASS  no financial table was dropped
PASS  migrations 0018-0022 remain applied (no schema rollback)
```

Option B still does exactly what it claims: Phase 5A and 5B keep working, the four Phase 5C
endpoints return 404, and nothing is dropped, reverted or deleted.

## A consequence that had never been recorded

**Applying Option B makes 19 tests fail.** Measured on the patched tree:

```
Test Files  1 failed | 33 passed (34)
     Tests  19 failed | 279 passed (298)
```

Every one is in `tests/integration/payments-api.test.ts`, and they fail *because they test the
endpoints the patch deliberately switches off*. **No test outside that file fails** — Phase 4, 5A
and 5B suites all stay green, which is the property that actually matters.

This is the patch working, not breaking. But had you applied Option B during an incident and
watched CI go red with 19 failures, that is a genuinely alarming thing to discover with no
warning. `recovery/README.md` now states it up front and recommends skipping that one file in the
same change, so the suite stays honest rather than red-and-ignored.

## Evidence

| Check | Result |
| --- | --- |
| Option B applies to `81c515c` | yes, `git apply --check` clean |
| Option B patched tree typechecks | exit 0 |
| Option B functional verification | **12/12** |
| Option B effect on the suite | 279/298, failures confined to `payments-api.test.ts` |
| Obsolete 5C patch | confirmed non-applying, now labelled |
| Unpatched branch state | untouched — the patch was applied only in a throwaway clone, never here |
| Migrations added | **none** — still 22 |

Nothing in `recovery/` has been applied to this branch. Option B remains **prepared and awaiting
your approval**, exactly as instructed.

---

# ADDENDUM 8 — The 5C signing primitive, audited adversarially

The remaining 5C requirement not re-derived under this standard was the directive's: *sandbox
signing must use real cryptographic signatures; the sandbox must be unmistakable for a real
provider; report what is implemented vs tested vs unverified.*

**Scope note:** webhook work is frozen. This audit builds, wires and enables **nothing**. It tests
the signing primitive in isolation and asserts the **absence** of a receiver.

## Result — 47/47, no defect

`recovery/verify-webhook-signing.ts` (committed, runnable by you).

**The signature is real cryptography, not a placeholder.** It matches an independently computed
`createHmac('sha256', ...)` digest byte for byte, is a 64-character hex digest, changes when the
secret changes, and changes when one byte of the body changes. It is demonstrably not a hash of
the body alone.

**Verification fails closed under every attack tried** — tampered body, amount raised to 9999.99,
currency swapped, wrong secret, empty signature, truncated signature, single flipped byte,
over-long signature, non-hex garbage, odd-length hex, empty body. None throws; all return `false`.
`timingSafeEqual` is used rather than `===`, guarded by the length check that would otherwise make
it throw.

**The sandbox cannot be mistaken for a real provider:** id `sandbox`, reference prefixed
`sandbox_`, method `sandbox_demo`, and customer-facing text that says both "simulated" and "no
real money". No `stripe`/`paypal`/`adyen`/`braintree`/`square`/`flutterwave`/`paystack` gateway
resolves. `buildSignedWebhookPayload` refuses to sign for a non-sandbox payment and refuses to
sign at all when no secret is configured.

**The receiver does not exist, and the probe asserts that it does not** — no webhook route file,
no route path containing "webhook", `verifySignature` called by no route or service, and nothing
that moves a `sandbox` payment out of `pending`. If a future change quietly adds a receiver, that
group starts failing. That is deliberate.

## One real finding — in the proposal, not the code

The proposed 5D scope said replay protection would *"reject an event id already processed"*.
**There is no event id.** `SandboxWebhookPayload` carries `provider`, `providerReference`,
`paymentId`, `outcome`, `amount`, `currency`, `occurredAt` — nothing unique per event.

This matters because Phase 5C committed to that payload as "a known-correct shape for 5D to start
from". Discovering the omission mid-build would mean changing the one thing that was supposed to
be settled. `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md` now carries the correction and three honest
options; my recommendation is to dedupe on a hash of the exact raw body, which needs no change to
anything already written and no payload redesign. **No code was changed — the work remains
frozen.**

## Implemented vs tested vs unverified — the accurate statement

| | Status |
| --- | --- |
| HMAC-SHA256 signing (`signPayload`) | implemented, **tested** (47/47 adversarial) |
| Signature verification (`verifySignature`) | implemented, **tested**; called by nothing |
| Sandbox gateway initiation | implemented, **tested**; cannot reach a terminal state |
| Signed example payload | implemented, **tested** |
| Webhook receiver / route | **does not exist** |
| Signed webhook through the real verification + payment pipeline | **UNVERIFIED — no pipeline exists** |
| Replay / duplicate-event rejection | **UNVERIFIED — nothing to replay against**; design gap above |
| Real provider | **none activated**, none registered, no credentials |

The honest claim about Phase 5C is: **the signing groundwork is sound and well tested; the payment
pipeline it is groundwork for does not exist and is therefore unverified end to end.** That is
unchanged from my earlier reports, and nothing here should be read as moving 5C closer to
acceptance. **Phase 5B and 5C remain NOT ACCEPTED.**
