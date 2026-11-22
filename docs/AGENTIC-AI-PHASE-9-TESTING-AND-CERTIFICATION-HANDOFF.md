# Phase 9 — Testing & Certification: local work in progress

**Status: IN PROGRESS / NOT CERTIFIED.** Started at the user's direction while Phases 2–8 remain incomplete. Local tests do not establish staging, production, independent security, accessibility or provider certification. No external provider operations, deployed migration, staging or production changes were performed.

## Local regression baseline

Run from `cloudhost247-node` before the additional matrix test was added:

```
npx vitest run tests/unit/ai-*.test.ts tests/unit/whmcs-*.test.ts tests/integration/ai-*.test.ts tests/integration/whmcs-*.test.ts frontend/tests/unit/admin-ai-*.test.tsx frontend/tests/unit/customer-ai-activity.test.tsx --maxWorkers=1
```

Result: **46 files passed, 1 file skipped; 653 tests passed, 36 skipped**. The skipped file is the opt-in disposable PostgreSQL suite, which was run separately below. This selection covers named AI/WHMCS unit, integration and relevant component files, not the entire application test suite or all cross-module tests. PGlite and mocked/injected integrations are not live WHMCS, actual model or provider verification. Some tests within this selection exercise website knowledge/support as well as AI-OS; passing does not prove all paths or permissions are safe.

The opt-in `tests/integration/ai-orchestrator-local-postgres.test.ts` suite was run with `RUN_ISOLATED_AI_POSTGRES_TESTS=1` against the existing designated socket-only disposable PostgreSQL cluster: **36/36 passed**. The suite verifies its local data directory, server socket, user and database before running; the cluster was stopped afterwards. This is not a deployed database, production-scale performance test, or proof all crash boundaries are covered.

## Operations authorization matrix

Added a Fastify/PGlite integration test in `tests/integration/ai-control-plane.test.ts` exercising anonymous, customer, staff and admin reads for the approval and event/workflow snapshot endpoints. It checks unauthorized attempts on the three relevant investigation/decision routes, role downgrade on a still-valid admin token, and suspension. The test uses nonexistent mutation targets to check route-level authorization, not side effects on real records or concurrent revocation; existing targeted tests cover other cases. Current policy permits staff to read workflows and workflow runs while restricting approvals, event snapshots and mutation routes. This test documents current behavior, **not** a determination that the data returned to staff is appropriately minimized; review that scope and other routes independently.

After adding the test, `npx vitest run tests/integration/ai-control-plane.test.ts --maxWorkers=1` passed **29/29**; this is a rerun of one file from the 653-test baseline plus the new test, not an additional independent 29-test population. Server, script and frontend typechecks and `git diff --check` passed. The latest Phase 8 frontend build passed with the existing large-chunk warning.

## Authorization adversarial follow-up

An additional PGlite/Fastify test exercises unauthenticated, customer, staff and downgraded-admin attempts against existing eligible held-event and acknowledged-run investigations and a verified pending approval (both approval and rejection). It checks that no investigation, decision audit, tool call or notification appears, and that the claim and run remain unchanged. The complete control-plane file passed **30/30** locally.

A disposable PostgreSQL test starts a role downgrade under a row lock, submits both investigation operations, then commits the downgrade. Both deny and leave no investigation or matching audit. The full socket-only PostgreSQL suite passed **37/37** and the cluster was stopped. This demonstrates the revocation-wins ordering for these helpers only; it does not prove every concurrent interleaving, enforce revocation after a completed check, fence external effects, or validate production database/deployment behavior. No provider, staging or production calls were made.

## Open certification work

- Run and assess the complete relevant application suite, browser E2E and accessibility checks, cross-module interactions and realistic concurrency/load; document any failures rather than excluding them.
- Establish a reviewed test matrix for authorization, tenant isolation, sensitive-data retention/redaction, workflow crash/recovery, mixed-version migration/rollout, operator uncertainty and downstream effect reconciliation. Coverage of selected cases is not comprehensive.
- Obtain independent security review and explicit, separately authorized staging and production validation. Verify real provider contracts and outcomes without unsafe retries or real customer writes absent authorization. Checked-in WHMCS mappings remain unbound; no live provider evidence exists here.
- Resolve the open Phase 2–8 gates and obtain required owner sign-offs; do not represent a local test pass as certification or approval for deployment.
