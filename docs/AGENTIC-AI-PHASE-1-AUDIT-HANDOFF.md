# Agentic AI — Phase 1: Existing System Audit and Handoff

Date: 2026-11-22
Branch: `arena/0e5bea4e-cloudhost247`; base/HEAD at audit: `c764224e956b75460e85c2bdb86142316f4e772c`, with the uncommitted working-tree changes from prior agentic-AI slices.
**Disposition: Phase 1 repository audit completed locally.** This is a targeted engineering audit and handoff, not an exhaustive security certification or evidence of a working live WHMCS connection.

## Scope and boundaries

Audited the existing AI customer experience, AI control plane, knowledge retrieval/trust, WHMCS client and routes, database migrations, and repository-supplied infrastructure. The prior detailed audit remains available at [`AGENTIC-AI-REPOSITORY-AUDIT-AND-PLAN.md`](AGENTIC-AI-REPOSITORY-AUDIT-AND-PLAN.md). That report describes an earlier five-part proposal; the ten-phase sequence below supersedes its phase numbering, not its safety findings.

No production or staging configuration, customer account, order, payment, production migration or live knowledge index was changed. PGlite migration and knowledge-sync operations were limited to disposable local test databases. The local preview contains demo data and is not production evidence.

## 1. Existing implementation inventory

Paths in this table are relative to `cloudhost247-node/` unless stated otherwise. These are source observations, not claims that every feature is production-ready.

| Area | Files inspected | Existing components to reuse | Current limitations |
| --- | --- | --- | --- |
| Support experience | `src/routes/ai-support.ts`, `src/services/ai-support-operator.ts`, `frontend/src/components/AiSupportWidget.tsx` | Visitor-token/account conversation scoping, rate limits, transcript, existing knowledge decision, escalation, feedback. | General support chat is separate from the account AI-OS assistant; a complete shared, durable multi-turn task lifecycle is not demonstrated. The existing transcript stores free text, so secrets and retention need review. |
| Orchestration / agents | `src/ai-os/runtime/{executor,types}.ts`, `src/ai-os/{types,permissions}.ts`, `src/ai-os/registry/{agent-catalog,tool-catalog,seed}.ts`, `src/ai-os/agents/handlers.ts`, `src/ai-os/models/router.ts`, `src/ai-os/workflows/engine.ts` | Existing agent/tool registry, deterministic handlers, task/run/step records, agent-specific permissions, workflow dispatch, model configuration and approval/audit facilities. | Runtime is not a complete general-purpose planner; event workflows are not a durable interactive workflow engine. Some existing handlers directly query the database rather than going through a tool. End-to-end timeouts, recovery and complete tool mediation need further work. |
| Knowledge / trust | `src/ai-website/{retrieval,knowledge-sync,knowledge-trust,source-trust,grounded-model,unanswered,live-facts}.ts`, `src/routes/ai-knowledge-admin.ts`, `frontend/src/pages/AdminAiKnowledgePage.tsx` | Website indexing, retrieval, freshness and scoped verified-claim conflict checks, knowledge health, feedback/unanswered questions and optional grounded phrasing. | The source-trust conflict check compares reviewer-normalized claims; it is not a general contradiction detector. The separate AI-OS keyword search must not be assumed to have identical website-trust guarantees. Node catalogue facts are not automatically WHMCS prices. |
| WHMCS | `src/whmcs/{client,catalogue,orderability,product-map,cart,sso,idempotency,discovery}.ts`, `src/routes/{whmcs-public,account-whmcs}.ts`, `config/whmcs/product-map.json`, root `docs/WHMCS-C1-CLOSURE-REPORT.md` | Read-oriented catalogue client with timeouts/retry policy/circuit breaker, checksummed map, orderability decision, WHMCS cart handoff, identity link/SSO and an operation ledger. | The checked-in map has **0 bindings and 59 unmapped entries**. Existing documentation states that C1 was not verified against a live staging installation. The ledger alone does not make order writes safe. Account/service/invoice/order reads and writes require individual identity, authorization and upstream-behavior verification before use. |
| Customer launch slice already built | `src/services/ai-website-launch.ts`, `src/whmcs/agent-orderability.ts`, AI-OS registry/handler/tool files, `src/routes/ai-support.ts`, `scripts/tools-preview-server.ts` | A feature-flagged, read-only website-launch conversation using a dedicated registry agent and the WHMCS orderability decision. | `AI_WEBSITE_LAUNCH_ENABLED` defaults to false. The local preview explicitly enables it only for its disposable database. It cannot create or verify an order or payment; no live price or availability was verified. This is partial work toward later phases, not completion of them. |
| Approval safety already built | `src/ai-os/runtime/executor.ts`, `src/ai-os/repositories/approvals-repo.ts`, `database/migrations/0108_ai_approval_execution_claim.sql` | Atomic task/approval claims, checks on current grants and customer scope, no blind replay of pending or interrupted executions. | Migration 0108 exists in the working tree and was applied only to disposable PGlite databases. `running`/`executing` interruption requires human reconciliation. Real multi-worker PostgreSQL and downstream idempotency are not certified. |
| Admin / API surface | `src/app.ts`, `src/ai-os/controllers/routes.ts`, `src/routes/{ai-support,ai-knowledge-admin,whmcs-public,account-whmcs}.ts`, `frontend/src/pages/ai-os/AdminAiCommandPage.tsx`, `frontend/src/pages/AdminAiSupportPage.tsx`, `frontend/src/pages/AdminAiKnowledgePage.tsx` | Existing admin AI command, support and knowledge pages, and registered customer/admin endpoints. | The requested integrated operations centre, user-visible task lifecycle and full approval/recovery UX remain incomplete. |
| Infrastructure | Root `README.md`, `docs/VPS_DEPLOYMENT.md`, `infrastructure/vps/{nginx,systemd,scripts}/`, `.github/workflows/{node-platform,vps-stack}.yml`, `cloudhost247-node/package.json` | Documented Ubuntu VPS deployment, Nginx, Node/worker systemd units, backup/restore/deploy scripts and CI configuration. | Inspection of repository files is not a production infrastructure audit. WHMCS core/license/database are not included in this checkout. Actual running versions, configuration, secrets, failover, monitoring and provider permissions were not inspected. |

## 2. Architecture and safety gaps for Phase 2

1. Define one customer-facing orchestration contract that uses the existing support conversation and AI-OS rather than creating another chatbot. Keep existing human and knowledge-trust guardrails ahead of any planning.
2. Design durable task/step state, a truthful progress model, bounded execution, cancellation, restart/reconciliation and concurrency behavior. A successful tool call is not automatically a verified business outcome. No hidden chain-of-thought should be stored or displayed.
3. Bind every customer task, child task, memory entry, tool call and approval to a server-derived customer or isolated visitor scope. Require explicit authorization for sensitive actions, with reauthorization and action-specific ownership checks at execution.
4. Add per-tool input/output validation, timeout and result-verification contracts; resolve existing direct-database handler bypasses. Treat retrieved text, model output and upstream responses as untrusted data, not authorization.
5. Reuse website knowledge synchronization, trust and feedback; preserve distinctions between missing, stale, conflicting and unavailable evidence. Define data minimization, retention and secret-handling rules before expanding memory.
6. Keep WHMCS authoritative for billing and customer account data. Use only verified, mapped, currency/cycle-specific results for WHMCS checkout; separate Node catalogue facts from WHMCS facts. Never infer payment, provisioning or order success.
7. Keep ambiguous writes in an unknown/reconciliation state; no blind retry. Current idempotency and approval records are primitives, not proof of exactly-once external effects. Require separate approval and verification for every write adapter.
8. Extend the existing AI admin pages with appropriately redacted task, tool, approval, escalation and integration-health views. Do not expose customer credentials or raw secrets.

These are design and verification requirements. Phase 1 does not authorize a production deployment, real orders, live customer changes, production reindex, or staging access.

## 3. Ten-phase delivery sequence and gates

Each phase gets its own files-inspected/changed, components-reused/new, migration/API/security changes, tests/results, limitations and blockers handoff before the next phase. Prior partial code does not automatically satisfy a phase gate.

| Phase | Name | Next exit evidence required |
| --- | --- | --- |
| 1 | Existing System Audit | **Local audit complete:** this handoff, the detailed audit and focused baseline below. External environment findings remain unverified. |
| 2 | Agentic AI Architecture | Reviewed central orchestrator/task-engine design and implementation on existing AI-OS; explicit state transitions, scoped authorization, recovery/timeout/verification boundaries and isolated tests. |
| 3 | Specialized AI Agents | Separately scoped support, sales, technical, domain and knowledge roles with verified grants, integration tests and one coherent customer entry point. |
| 4 | Tool & API Integration | Schema-validated, permitted, timed, audited read tools and verified integration contracts; mocked WHMCS first, no unapproved writes. |
| 5 | Agent Memory & Context | Tenant isolation, approved preference storage, minimum retention, deletion and free-text secret handling tested across conversations and tasks. |
| 6 | Autonomous Workflow Engine | Durable, bounded multi-step plans, safe resume, cancellation and reconciliation, with no unverified completion claims. |
| 7 | Human Approval & Security | Action-bound consent/approval, reauthorization, audited decisions, race/replay and interruption tests; independent security review. Existing partial hardening must be reviewed, not presumed complete. |
| 8 | AI Operations Centre | Existing admin surfaces extended with permission-scoped tasks, tool evidence, approvals, knowledge health, errors and redacted monitoring; UI/accessibility tests. |
| 9 | Testing & Certification | Documented full relevant test/build/E2E coverage, adversarial and isolation tests, integration evidence and independent review. Local tests alone cannot establish live provider readiness. |
| 10 | Deployment & Rollout | Explicitly authorized staging verification, operational readiness and rollback; separately authorized production release. No staging or production action is authorized by this report. |

## 4. Verification evidence

Current working-tree checks run locally from `cloudhost247-node/` for this handoff:

| Command | Result |
| --- | --- |
| `npx vitest run tests/integration/ai-approval-safety.test.ts tests/integration/ai-website-launch.test.ts tests/integration/ai-knowledge-trust.test.ts tests/integration/whmcs-idempotency.test.ts tests/unit/whmcs-orderability.test.ts tests/unit/whmcs-client.test.ts tests/unit/ai-source-trust.test.ts --maxWorkers=1` | **75 passed, 7 files.** WHMCS conversation tests use mocks; integration persistence uses disposable PGlite. Coverage includes approval isolation/replay, website launch, trust outages, WHMCS idempotency and orderability/client behavior. |
| `npm run typecheck && npm run typecheck:scripts` | **Passed.** |
| Repository product-map inspection | `services`: 0 bound; `unmapped`: 59. This is checked-in state, not a live WHMCS inspection. |

Previously in this branch, `npm run build` passed and focused workflow, control-plane and migration suites passed; see [`AGENTIC-AI-APPROVAL-HARDENING-AND-STATUS.md`](AGENTIC-AI-APPROVAL-HARDENING-AND-STATUS.md) for commands, results and the corrected initial migration-list failure. The full test suite, browser E2E, real PostgreSQL concurrency, live WHMCS and staging were not run for this audit.

## 5. Phase 1 delivery record

- **Files inspected:** inventory in §1 and source/test files in §4.
- **Files changed in this phase:** this handoff only. Existing uncommitted implementation changes from earlier turns remain in the working tree and are identified in §1; they were not silently reclassified as completed phases.
- **New components:** no runtime components added in this audit; this report is new.
- **Existing components reused:** AI-OS, support, knowledge and WHMCS components listed in §1 are candidates for subsequent work.
- **Database migrations:** no new migration created in this phase. Existing working-tree migration 0108 is unapplied outside isolated local databases.
- **API changes:** none in this phase.
- **Security implications:** no live permission change; unresolved risks and required controls in §2. PGlite tests do not establish multi-node or production security.
- **Tests / results:** §4.
- **Known limitations / blockers:** no licensed WHMCS installation or real provider/staging verification; product map unbound; architecture, durable workflows, privacy/retention, end-to-end authorization, independent security review and comprehensive release testing remain outstanding. Production/staging operations need explicit authorization.

## Handoff to Phase 2

Start with a design and testable implementation proposal for a single orchestrator and task engine using the existing AI-OS. Define the task/step state machine, actor and tenant provenance, agent/tool contract, approval boundary, evidence verification, timeouts and crash/reconciliation semantics before adding customer-affecting capabilities. Maintain the read-only, disabled-by-default launch slice until its phase-specific verification gates are met.
