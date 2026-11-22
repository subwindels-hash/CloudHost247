# Phase 8 — AI Operations Centre: local work in progress

**Status: IN PROGRESS / gate not met.** Started at the user's direction while Phases 2–7 remain incomplete. This is not staging, production, live-provider or independent security evidence.

## Initial increment: honest approval snapshots

The existing command centre already has approval, delayed-activity, workflow investigation and audit views. The decision inbox previously initialized pending approvals as an empty list and displayed an all-clear before loading completed or when loading failed. It also silently converted executed-history errors into an empty result. These states could mislead operators; no actual missed approval is established by this observation.

`frontend/src/pages/ai-os/AdminAiCommandPage.tsx` now distinguishes pending loading, failure and empty results, exposes a refresh, clears previous proposals and review checkboxes immediately on refresh, and ignores stale responses. A failed pending refresh leaves no actionable stale proposals. Executed history loads independently and explicitly reports its own loading, empty or unavailable state, without suppressing an available pending snapshot. The page describes the API's up-to-100 newest-created pending records and the 10 displayed executed records as bounded snapshots, not complete queues or verified outcomes. It no longer asserts that every tool call is audited, every external action is approved, or that the sweep drains all unprocessed events. A decision with an ambiguous response disables further decisions across tab changes in the mounted command page, with a warning.

**Limits:** These are client-side safeguards, not durable incident state, authorization, action fencing, paging, monitoring or reconciliation. The ambiguity lock is lost on page reload, navigation away or in another session; investigating remains necessary before any further action. Refresh is not real-time, requests may remain loading indefinitely, and concurrent updates can make any displayed snapshot stale. The backend's existing review fingerprint checks remain important. History is sorted by proposal creation, not execution time, and omits other statuses; neither it nor an empty snapshot proves no action or effect occurred. This increment does not establish complete permissions, audit coverage, accessibility or safe operator recovery, and the existing admin data may contain sensitive free text. No API or migration was added.

## Events and workflow snapshot follow-up

Held claims, recent events and workflows now load independently, each with explicit loading, error and empty states and its own refresh. A failure in one no longer masks successful results in the others. Claim refresh removes the previous actionable snapshot and workflow references until the new response arrives; request generations suppress late results, including old workflow-reference responses. Failed investigation requests clear the relevant claim or acknowledged-run snapshot and warn that the result may be unknown, requiring refresh and investigation. Refresh controls are disabled during the corresponding mutation. Event acknowledgements are labelled in words rather than a success checkmark, with a warning that processing status does not prove external outcome.

These changes do not make the views complete, live or durable. A refresh or tab remount can re-enable investigation actions, and a response may commit despite a reported error; the user must investigate rather than assume a retry is safe. Independent asynchronous snapshots do not describe a single point in time. Workflow references and errors are not a complete history, and privacy, accessibility and real role testing remain outstanding. No backend, migration or external effects were changed.

## Local verification

- Events/workflow follow-up: both focused UI suites **19/19** passed, including independent failure, stale claim and reference responses, and ambiguous investigation handling. Frontend typecheck, build and `git diff --check` passed; existing chunk-size warning remains.

- `npx vitest run frontend/tests/unit/admin-ai-delayed-approvals.test.tsx frontend/tests/unit/admin-ai-event-investigations.test.tsx --maxWorkers=1`: **15/15 passed**. Coverage includes loading and failure versus empty, separate history failure, refresh invalidation, stale response and tab-switch ambiguity behavior.
- `npx tsc -p frontend/tsconfig.json --noEmit`, `npm run build:frontend`, and `git diff --check` passed; the build retains its existing large-chunk warning.
- No full suite, browser E2E, accessibility audit, live integrations, deployment or independent review.

## Remaining gate

Review all operations views for scoped permissions, privacy and honest partial/error states; provide complete discoverability and navigation without mistaking counts for health, accessible operator workflows, durable uncertainty/reconciliation handling, alerting and retention; validate with real roles, browser/accessibility testing, realistic data and independent review. Phase 8 and all preceding incomplete gates remain open.
