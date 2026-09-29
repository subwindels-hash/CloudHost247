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
