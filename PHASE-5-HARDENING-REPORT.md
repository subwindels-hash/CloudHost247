# CloudHost247 — Phase 5 Hardening Report (2026-11-09)

**Scope rule: production certification NOT granted; nothing was deployed or activated.**
All work closed internally controllable blockers on branch `arena/fe9b2088-cloudhost247`.

## A. Audit findings closed

| Finding | Fix (executed) | Executable evidence |
|---|---|---|
| P4-F1 sandbox webhook timestamp optional | `x-cloudhost-timestamp` now REQUIRED, parseable, ≤300 s skew (sandbox-gateway.ts); missing/malformed → 401 | `webhook-hardening.test.ts` F1a/F1b; live probe P-9 (no-ts signed webhook → 401) |
| P4-F2 amount/unit ambiguity | Standardized: string = exact major units (`toCents`), number = integer cents only; fractional/missing → 400 malformed | suite F2a/F2b/F2c (settle with 1000; reject 10.5; reject absent) |
| P4-F3 webhook throttling | per-IP 300/min on both webhook routes (above any honest provider's retry cadence; idempotency never depends on it) | suite F3: 301st request/hour... minute → 429 |
| P4-F4 ambient rejection semantics | transient (not-found) vs terminal (parity/state-machine) split; terminal rejections persist DURABLY after rollback → redelivery short-circuits 200/`rejected`; transient ones remain reconcilable after the 60 s lease | suite F4a (rejected durable, reason logged, invoice stays unpaid, retry stops) + F4b (early delivery → 404 → payment appears → lease expiry → redelivery → settles, ledger 1 payment row) |
| D4-F1 recovery scope | recovery fingerprint extended to **all 221 tables byte-level** + schema/constraints/indexes/sequences | `docs/staging/db-recovery-evidence-full-2026-11-09.json`, 10/10 live PASS |
| OPS gap: rollback doc | CPANEL_DEPLOYMENT.md Appendix D (new) | doc (staging rehearsal requires cPanel account) |
| B-1 browser ceremonies | selector-accurate Playwright suite authored (CDP virtual WebAuthn) | prepared; **execution blocked** (no browser binary; CDN unreachable, re-verified today) |

## B. Regression surface after the code changes

- TypeScript: `tsc --noEmit` exit 0.
- Affected suites re-executed: `webhooks-api` (33 tests incl. existing concurrency/idempotency/SSRF/raw-byte suites) + `webhook-hardening` (9) = **42/42**; wider blast-radius set (billing lifecycle/schema, payments API/schema, authorization matrix, financial invariant sweep, provisioning lifecycle, admin billing, domain services ×2, platform services, revenue guardian, secret fail-closed) = **162/162**.
- Live re-execution on the hardened build: staging smoke **33/33**, independent probes **23/23** (P-9 now asserts the hardened behavior).

## C. Incidental defect found & fixed (audit value of the hardening)

`webhook_events.payment_id` was written at insert time from the provider-supplied
`cloudhostPaymentId` — a delivery arriving before initiation committed violated the FK and
surfaced as a generic 500 instead of the designed transient 404. Now the FK is only written
after the settlement transaction resolves the payment (existing code paths relink via
`updateWebhookEventStatus`). Covered by suite F4b. Behavior externally visible: none beyond the
404 fixing — no financial path used the early link.

## D. What Phase 5 deliberately did NOT do

No production deployment, no live payment, no production provider activation, no unauthorized
migration (0023/0024/0025/0041 remain excluded), no security control weakened (all changes are
pure strengthening or additive), no fabricated results (every claim above tied to an executed
run), no super_admin self-creation (OPS-2 live refund drill still awaits an authorized staging
role; refund logic itself is suite-verified: partial+full refund append-only ledger + audit +
refundable-cap — `admin-billing-api.test.ts`, `billing-lifecycle-e2e.test.ts`).

## E. Current blocker ledger (shrunk to truth)

- Internally controllable items: **zero remaining unhardened findings** from Phase 4 (P4-F1..F4,
  D4-F1 closed; OPS docs written; rollback documented).
- Browser execution: prepared suite, environment block (B-1) — needs any Chromium availability.
- Everything else = owner-side: credentials/licensing (WHMCS, providers, email relay, registrar),
  infrastructure (cPanel account, production Postgres service), owner authorizations (quarantined
  migrations, payout action), ops decisions (error sink, WAF, on-call).
  Full stratification with L1–L4 levels: FINAL-PRODUCTION-BLOCKERS.md (updated).
