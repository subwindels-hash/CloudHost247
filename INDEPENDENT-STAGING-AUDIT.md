# CloudHost247 — Independent Staging Evidence Audit (Phase 4, 2026-11-09)

Scope: independent re-audit of the Phase 3 certification (commit `9e693a28`). Method: source
re-inspection of every route/service the evidence claims about, internal-consistency checks on
the evidence artifacts, and a **from-scratch probe suite** (`scripts/staging/independent-audit-probes.mjs`)
that reuses nothing from the Phase 3 runner — fresh accounts, own TOTP implementation, own HMAC
signer, locally minted forgery vectors. Probe evidence: `docs/staging/phase4-independent-probe-evidence-2026-11-09.json` — **23/23 PASS**.

Phase 3 evidence files re-inspected:
- `scripts/staging/smoke-staging.mjs` (33 steps)
- `docs/staging/staging-evidence-2026-11-09.json`
- `STAGING-CERTIFICATION-REPORT.md`

## 1. Evidence integrity

- 33 results, **strictly monotonic timestamps** (09:24:13.489Z → 09:24:17.226Z), each step with
  discrete HTTP status matching its claim.
- Every PASS was re-matched to the runner's `check()` predicate and to the route's zod schema —
  no PASS rests on a guessed payload. (During Phase 3 development, 10/10 original failures were
  payload-contract mismatches in the *script*, all traced to route schemas before passing.)
- Rate-limit bucket artifacts in this environment are real, not spurious: repeated probe runs
  hit persistent 429s (login 10/min, reset 5/15min, MFA verify 10/15min) and **both the reset
  429s were byte-identical for known/unknown emails** — the limiter does not leak enumeration
  either. Clean runs require a fresh server process (in-memory counters; `tsx watch` reload does
  NOT reset them — full restart does — verified both ways).

## 2. Per-step verification matrix (33/33 re-checked)

F = functional (asserts a state transition or data content); A = availability-limited (proves
endpoint+auth only, content only shallowly). The audit's question — "which tests merely prove
availability" — is answered here explicitly.

| # | Step | Verdict | Class | Independent note |
|---|------|---|---|---|
|1|register 201|VALID|F|JWT + user row created; duplicate path distinct|
|2|duplicate → 409|VALID|F|conflict semantics, not generic 400|
|3|wrong pw → 401|VALID|F|denial path exercised|
|4|login → token|VALID|F|token then auth'd 200s all run|
|5|reset uniform 202|VALID|F|byte-identical known/unknown; reproduced by probes (P-1)|
|6|TOTP enroll|VALID|F|password-confirmed; otpauth URL parsed for secret|
|7|TOTP confirm|VALID|F|real RFC-6238 code; DB `enabled=true` asserted next step|
|8|MFA status enabled|VALID|F|`enabled:true,recoveryCodesRemaining:10` from DB|
|9|login → 202 challenge|VALID|F|no session minted (token absent asserted)|
|10|MFA verify → session|VALID|F|fresh-window code; replay behavior separately proven by probes P-5|
|11|passkey options|VALID|F|challenge issued; attestation honestly flagged browser-only|
|12|PATCH profile|VALID|F|write + 200|
|13|GET services|VALID|A|200 + array; no content invariant|
|14|GET domains|VALID|A|same — honest empty state (no providers)|
|15|GET tickets|VALID|A|same|
|16|ticket + message 201×2|VALID|F|rows exist; message linked to ticket id|
|17|catalog browse|VALID|F|≥1 product asserted; anonymous|
|18|plans resolve w/ prices|VALID|F|server-side pricing path|
|19|cart add 201|VALID|F|server-priced|
|20|checkout 201|VALID|F|order + unpaid invoice atomic; invoice id extracted from invoice list|
|21|invoice list unpaid|VALID|F|status=unpaid asserted (note: `total` extraction cosmetic artifact)|
|22|initiate payment 201 pending|VALID|F|provider ref pattern + honest instructions|
|23|signed webhook settles|VALID|F|invoice unpaid→paid re-read|
|24|replay dedup|VALID|F|ledger row count pinned before/after|
|25|tampered 401|VALID|F|signature byte tampered|
|26|stale 401|VALID|F|10-min-old timestamp refused|
|27|wrong amount 400, unpaid|VALID|F|invoice re-read stays unpaid|
|28|failed outcome 200 unpaid|VALID|F|payment failed, invoice unpaid|
|29|ledger 2 charges + 1 payment|VALID|F|entry-shape + count assertion on real rows|
|30|tenant isolation 404|VALID|F|Phase-3 used the REAL route `/api/v1/invoices/:id` (audit confirmed — my first probe draft used a wrong path and its 404 was worthless; Phase-3's is genuine)|
|31|admin 403 / anon 401|VALID|F|one admin route; probes P-8 extend to three routes|
|32|login 429 on 11th|VALID|F|limiter reached, exactly at bound+1|
|33|public surfaces|VALID|A|liveness + tools count; extensions 200/empty honestly|

**Result: 30/33 functional, 3/33 availability-limited (13,14,15 — all read-list endpoints whose
content assertions are honest-empty by design). No fake PASS. No step fails scrutiny on status,
body, auth context, tenancy, or state-transition grounds.**

## 3. Reproducibility (independent probes, 23/23)

The Phase-4 probe suite re-derived every security-relevant claim from zero:
forged-role 403 · expired/wrong-secret/wrong-sv JWT 401s · logout revocation 401 · TOTP replay
401 / single-use 401 / out-of-window 401 / fresh-window 200 · passkey honest failures ·
cross-tenant read **and** payment-initiation both 404 · admin boundary 403×3 / 401 anonymous ·
webhook timestamp-omitted replay deduped without double settlement · no ambient cookies.

## 4. Limitations of the Phase 3 certification (carried forward honestly)

1. The Phase-3 ledger step counts rows of a user-scoped view; cross-user global reconciliation is
   suite-covered, not live-covered (see PAYMENT-SECURITY-AUDIT.md).
2. Live refund execution was NOT possible (super_admin bootstrap correctly refused) — refund path
   is code-verified + suite-tested only.
3. Admin/super-admin *functional* breadth (staff CRUD, catalog writes) is suite-covered; live
   staging proved only the deny boundaries.
4. Rate limits are per-instance in-memory — fleet deployments need edge-level limiting (ops note).
5. Visual/responsive and WebAuthn attestation halves remain B-1.
6. tsx-watch reload does not reset limiter buckets (dev-only quirk; documented).

**Verdict: Phase 3 certification is independently reproducible, internally consistent, and its
claims match the implementation. 33/33 PASS stands; the 3 availability-limited steps are
documented as such everywhere they are cited.**
