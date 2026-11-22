# Agentic AI phase 1 — workflow completion safety slice

Date: 2026-11-22
Status: implemented and tested locally; not deployed. This is one safety slice, not completion of phase 1 or of the agentic AI platform.

## Scope and files

- **Inspected:** `cloudhost247-node/src/ai-os/workflows/engine.ts`, `src/ai-os/repositories/{events-repo,tasks-repo}.ts`, `src/ai-os/runtime/executor.ts`, `src/ai-os/jobs/sweep.ts`, `src/ai-os/registry/seed.ts`, `database/migrations/0066_create_ai_control_plane.sql`, and the existing AI control-plane integration tests. The earlier architectural audit is `docs/AGENTIC-AI-REPOSITORY-AUDIT-AND-PLAN.md`.
- **Changed:** `cloudhost247-node/src/ai-os/workflows/engine.ts`, `cloudhost247-node/tests/integration/ai-control-plane.test.ts`.
- **New:** `cloudhost247-node/tests/integration/ai-workflow-safety.test.ts` and this report.
- **Reused:** existing event/workflow records, task idempotency key, registry seeding, run status, audit persistence, and PGlite test harness. No parallel agent platform was created.

## Behavior

A workflow run is `succeeded` only if all steps report success. It stops before later steps when one is awaiting approval, queued, running, cancelled, failed, or otherwise not successful. Pending, running, queued and uncertain outcomes are represented by the **existing** `partial` workflow status; see individual step status for detail. A failure before any progress is `failed`; a failure after progress is `partial`. Conflicting success/task/approval information is `outcome_unknown`. An exception is recorded as an unknown step without persisting the exception text. A replay encountering an existing task uses its stored status; it does not restart it, including when it is queued. Empty/invalid definitions and repeated agent slugs are rejected, because the current task idempotency key identifies steps by agent slug.

This intentionally changes existing multi-step workflow behavior: later steps no longer execute after an incomplete or failed step. A `partial` run's `completed_at` reflects completion of this dispatch attempt, **not** completion of the customer or business action. No automatic resume or reversal is implied. Operators must review/reconcile uncertain tasks; they must not blindly resend external actions.

## Schema, API and security

- **Database migrations:** none added; existing status schema is reused. Tests applied existing migrations only to in-memory PGlite databases.
- **API:** no new routes or response shape. Existing workflow-run listing can now return `partial` for pending/uncertain workflows where it previously could return `succeeded`; step entries may include `outcome_unknown` and `reused`.
- **Security:** no new permissions, external calls, tools, customer-facing actions or production writes. Avoids placing exception strings in this dispatcher's failure audit or interrupted-step record. This change is not a general guarantee that other logs or stored customer text contain no secrets.

## Verification

Commands executed from `cloudhost247-node/`:

| Command | Result |
| --- | --- |
| `npx vitest run tests/integration/ai-workflow-safety.test.ts --maxWorkers=1` | 16 passed. Covers complete, pending, failed, cancelled, interrupted, contradictory result, duplicate delivery, missing agent and invalid definitions. Uses isolated PGlite and stubbed task runners. |
| `npx vitest run tests/integration/ai-control-plane.test.ts tests/unit/ai-control-plane.test.ts --maxWorkers=1` | 37 passed before the final extra workflow-status assertion was added. |
| `npx vitest run tests/integration/ai-control-plane.test.ts -t 'routes an emitted invoice.overdue' --maxWorkers=1` | Updated real-handler regression passed (1 test; 13 skipped). |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed, including script typecheck, catalogue consistency, server, frontend and tools builds. Vite warned about chunks over 500 kB. |

The first run of the new suite failed before any tests ran due to a misspelled test adapter import; corrected and rerun successfully. Full test suite and browser E2E were not run. No staging or production environment was contacted.

## Limitations and remaining blockers

- This is not a durable workflow engine: no resume after approval, checkpoint lease, atomic event claim, retry scheduling or cancellation has been added. Concurrent event dispatch can still create multiple workflow-run records, and the broader engine needs an independently tested concurrency and crash-recovery design. A database/persistence error may leave a run `running` and the event processed; manual investigation is necessary.
- Approving an existing action does not automatically resume a partial workflow or update that workflow run to success. Existing task idempotency and approval handling are not sufficient evidence for exactly-once external writes.
- A task reported `succeeded` is relied on as the existing handler's status; this change does not independently verify upstream business outcomes. No WHMCS order/payment/provisioning is implemented or verified.
- Existing customer support and AI control-plane paths remain separate. Tenant-safe orchestration, tool deadlines, approval reauthorization, privacy/retention controls, read-only WHMCS integration and an interactive customer workflow remain future work. Do not enable sensitive writes on the strength of this patch.
- Production settings, migrations, customer accounts, orders and external systems were untouched; any staging or production actions still require explicit authorization.
