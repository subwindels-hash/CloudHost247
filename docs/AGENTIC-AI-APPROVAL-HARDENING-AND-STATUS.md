# Agentic AI: approval hardening and delivery status

Date: 2026-11-22. Local development and verification only; not deployed.

## Scope and phase interpretation

The agentic-AI plan in `AGENTIC-AI-REPOSITORY-AUDIT-AND-PLAN.md` describes five broad proposed phases, not a defined phase 1–10 sequence. The older repository-wide phase reports concern a different readiness effort. Therefore this report does **not** claim that ten agentic-AI phases were completed. The ten workstreams below are a status breakdown of the requested directive, not an invented list of completed project phases.

## Changes in this slice

- **Inspected:** `cloudhost247-node/src/ai-os/{runtime/executor,repositories/approvals-repo,repositories/tasks-repo,controllers/routes,registry/tool-catalog,tools/implementations,types}.ts`; `database/migrations/0066_create_ai_control_plane.sql`; `tests/integration/{ai-control-plane,migrate}.test.ts`.
- **Changed:** `src/ai-os/runtime/executor.ts`, `src/ai-os/repositories/approvals-repo.ts`, `src/ai-os/types.ts`, `src/services/ai-website-launch.ts`, `tests/integration/migrate.test.ts`.
- **New:** `database/migrations/0108_ai_approval_execution_claim.sql`, `tests/integration/ai-approval-safety.test.ts`, this report. No new service or second agent system.
- **Reused:** existing AI tasks, agent registry, tool contracts, authorization roles, approval records, audit trail and PGlite integration harness.
- **Database migration:** 0108 adds an `executing` approval state. It was applied only to disposable in-memory PGlite databases; it has not been applied to staging or production. Deployment requires a separately authorized migration and rollout plan.
- **API:** no new endpoints. Existing approval API may now expose `executing` while execution is claimed. Customer tasks with missing or mismatched persisted identity fail closed. Anonymous read-only launch tasks are marked `system` rather than a customer task with a missing customer ID.

### Safety behavior

1. A queued task is atomically claimed as `running`; duplicate callers cannot start its handler while it is running or awaiting approval. An interrupted task remains `running` for reconciliation instead of being automatically replayed.
2. Customer task scope is derived from persisted task identity and checked against the caller's supplied scope. Customer scope is propagated to child tasks rather than silently dropped. The agent's task type is checked against its current registry grant.
3. Tool arguments are validated before an approval is created; an explicitly different customer ID is rejected rather than sealed as a misleading request.
4. A decided approval is atomically claimed as `executing`, bound to its original deciding user and expiry. Before execution, the active approver role, active agent, current tool and permission grants, original task/run and customer scope are rechecked. Sealed arguments are revalidated; mismatched customer IDs are denied.
5. Concurrent claim attempts result in at most one claim. If execution is interrupted after a claim, the row remains `executing` and is **not automatically retried**. This is an unknown outcome requiring authorized human reconciliation, not proof that an external action failed or succeeded. An approval-pending task is no longer rerun as a fresh task.

These checks narrow the risk; they are not a production security certification. The reauthorization checks and downstream execution are not a single atomic transaction with role/configuration changes or external providers. Existing redaction of free-text arguments, action-specific ownership, verification of downstream effects, and write idempotency require further review. No new customer-facing sensitive action is enabled.

## Verification

Executed from `cloudhost247-node/` against disposable databases; mocks where indicated. No WHMCS/staging/production system was contacted.

| Check | Result |
| --- | --- |
| `npx vitest run tests/integration/ai-approval-safety.test.ts tests/integration/ai-website-launch.test.ts tests/unit/ai-control-plane.test.ts --maxWorkers=1` | 46 passed: includes 14 new approval/task safety tests, 9 launch tests with mocked WHMCS, and 23 existing unit tests. The concurrency test uses PGlite; it is not a multi-node or real-PostgreSQL certification. |
| `npx vitest run tests/integration/ai-control-plane.test.ts tests/integration/ai-workflow-safety.test.ts --maxWorkers=1` | 30 passed after the final task-claim change, including the existing real-handler approval flow. |
| `npx vitest run tests/integration/migrate.test.ts --maxWorkers=1` | 10 passed after adding the new migration to the expected list; only in-memory test databases used. |
| `npm run typecheck` and `npm run build` | Passed after final runtime changes. Build reports existing Vite large-chunk warnings. |
| Preview smoke test | Restarted disposable preview with the launch flag enabled. A launch question returned a requirements prompt; selecting WordPress returned unavailable, not a fabricated price or order. |

The first combined regression run had two migration-suite failures because its explicit expected migration list had not yet been updated for 0108. The list was updated and the migration suite passed on rerun. Full repository tests and browser E2E were not run.

## Ten requested workstreams: evidence-based status

| Workstream | Status | Evidence / remaining work |
| --- | --- | --- |
| 1. Orchestration and execution | **Partial** | Existing deterministic AI-OS plus atomic task claim and an initial launch workflow. No general planner, durable interactive workflow or complete recovery. |
| 2. Support and human escalation | **Partial** | Existing support/knowledge guardrails and escalation remain; not all requested ticket operations and workflows have been verified. |
| 3. Sales and checkout | **Partial / integration blocked** | Feature-flagged, read-only launch lookup and WHMCS cart handoff; checked-in map has no bound services and no live WHMCS has been tested. No order or payment is made or verified. |
| 4. Hosting and technical operations | **Partial** | Existing scoped Node-platform tools and diagnostics exist; no newly verified WHMCS service-status or approved production operation. |
| 5. Domains | **Incomplete** | Existing domain modules/knowledge are present; this agent workflow has no verified domain-availability or pricing tool. |
| 6. Knowledge and feedback | **Partial** | Existing source trust, retrieval, feedback and unanswered-question facilities are reused; no broad new knowledge coverage certification. |
| 7. Tool governance and isolation | **Partial** | Registry, validation, task scope and claim checks strengthened. Some existing handlers still perform direct DB reads; global tool deadlines and independent security review remain. |
| 8. Human approvals and recovery | **Partial** | Atomic claim and reauthorization added; no durable customer approval UI, cancellation/recovery workflow, automatic reconciliation or real-provider exactly-once guarantee. |
| 9. Admin centre and customer UX | **Partial** | Existing AI command/support/knowledge pages and launch conversation are reused. The complete requested operations centre and persistent visible multi-step progress are not built. |
| 10. Release and verification | **Blocked / incomplete** | Local focused tests and build passed; no full suite, browser E2E, live WHMCS, authorized staging or production certification. Release requires independent review and explicit operational authorization. |

## Remaining blockers / next safe work

Implement a durable, customer-scoped task/step model with explicit approval and cancellation lifecycle; protect and minimize conversation/memory data; remove or fence direct DB access by agent handlers; add bounded end-to-end tool deadlines and action-specific verification/reconciliation. Verify service identity mapping, orderability, read adapters and permissions using mocks first, then only separately authorized staging. Design a human runbook for stranded `running`/`executing` records; do not automatically retry ambiguous writes. No production settings, migrations, knowledge index, customer accounts, orders or payments were changed in this work.
