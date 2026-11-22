# Agentic AI customer service and operations: repository audit and phased plan

Date: 2026-11-22
Scope: repository inspection, local baseline tests and development proposals only. No production or staging system was contacted, configured or modified. This is not a security certification or a claim of live integration readiness.

## Executive assessment

CloudHost247 already has substantial AI infrastructure. The recommended path is to **extend the existing AI control plane and customer-support experience**, connecting them to the existing website-knowledge and WHMCS services. Do not create a second chatbot, a second billing authority, or an unrestricted model-to-tool bridge.

The current system is not yet the requested end-to-end agentic customer workflow. In particular, the support widget and customer AI control-plane assistant follow different execution paths; the latter uses deterministic intent handlers and mainly Node-platform records. The existing workflow engine is event-oriented, not a durable, interactive customer task planner. A WHMCS client and identity bridge exist, but their presence does not establish that customer account reads, order verification, or writes are connected to this assistant or verified against a live installation. The checked-in WHMCS product map contains **zero bound services and 59 unmapped services**. This is repository state, not a statement about any live environment.

**Safest first implementation slice:** a feature-flagged, read-only customer workflow that uses the existing support conversation and trust-aware knowledge retrieval, records concise progress in the AI control plane, and makes WHMCS-backed recommendations only when live orderability is verified. Otherwise it says it cannot verify and offers support. No customer-affecting AI writes in this slice.

## 1. Files inspected and reusable components

Paths below are under `cloudhost247-node/` unless noted. This is a targeted audit, not an exhaustive review of every module.

| Area | Inspected | What exists / reuse |
| --- | --- | --- |
| Customer support | `src/routes/ai-support.ts`, `src/services/ai-support-operator.ts`, `frontend/src/components/AiSupportWidget.tsx` | Conversation access is scoped by authenticated identity or an opaque visitor token; recent messages feed the decision layer; dedicated route rate limits, human escalation, feedback and unanswered-question tracking exist. Account-specific actions currently escalate rather than being executed through general chat. |
| AI control plane | `src/ai-os/runtime/{executor,types}.ts`, `src/ai-os/types.ts`, `src/ai-os/controllers/routes.ts`, `src/ai-os/permissions.ts`, `src/ai-os/registry/{agent-catalog,tool-catalog}.ts`, `src/ai-os/agents/handlers.ts`, `src/ai-os/models/router.ts` | Agent and tool registry, per-agent grants, customer-usable gate, argument validation, task/run/step records, approvals, audit and deterministic handlers already exist. Customer assistant routes provide a server-derived customer scope. An executive board can run child agents. Model routing is not itself a general-purpose AI planner. |
| Workflows and memory | `src/ai-os/workflows/engine.ts`, `src/ai-os/repositories/{tasks-repo,approvals-repo,memory-knowledge-repo}.ts` | Event-driven workflow dispatch, task idempotency keys, approval decisions and scoped memory primitives exist. They require hardening and extension before interactive, resumable, customer-facing operations. |
| Knowledge | `src/ai-website/{retrieval,knowledge-sync,knowledge-trust,source-trust,live-facts,grounded-model,unanswered}.ts`, `src/ai/knowledge.ts`, `src/routes/ai-knowledge-admin.ts`, `frontend/src/pages/AdminAiKnowledgePage.tsx` | Website retrieval, sync, source trust, conflict/currentness handling, unanswered tracking and an admin centre exist. Optional model phrasing labels evidence as untrusted and checks its output. Existing AI-OS `search_knowledge` uses a separate keyword search over active knowledge sources: reuse the website trust path for customer answers rather than assuming both paths have identical trust guarantees. |
| Catalogue and WHMCS | `src/whmcs/{client,cart,catalogue,orderability,idempotency,sso}.ts`, `src/routes/{whmcs-public,account-whmcs}.ts`, `config/whmcs/product-map.json`, `docs/WHMCS-C1-CLOSURE-REPORT.md` | Client has timeouts, a circuit breaker and read-only retry policy; orderability checks live WHMCS products/prices against mapping; checkout URL builder defers cart/checkout to WHMCS; identity-link/SSO routes exist. The operation ledger can record idempotency and ambiguous outcomes; it is not proof that an agent write adapter is safe or exists. The closure report expressly states no live staging verification. |
| Administration | `frontend/src/pages/ai-os/AdminAiCommandPage.tsx`, `frontend/src/pages/{AdminAiSupportPage,AdminAiKnowledgePage}.tsx`, `src/ai-os/controllers/routes.ts` | Existing AI command, support and knowledge administration surfaces expose tasks, agents, tools, approvals, events, workflows, findings and audits. Extend and link these rather than build an unrelated operations dashboard. |
| Schema and tests | `database/migrations/{0057_create_ai_support_operator,0066_create_ai_control_plane,0086_create_whmcs_operations,0087_create_whmcs_identity,0088_create_whmcs_sso_rate_limits,0100_ai_website_knowledge,0102_ai_source_trust,0105_community_ai_knowledge}.sql`; relevant `tests/unit/` and `tests/integration/` suites | Existing schema and PGlite tests are starting points. Actual schema extensions require a new migration and independent review, not modification of applied migrations. |

The Node website knowledge's `live-facts.ts` reads the **Node public catalogue and domain offering tables**, while WHMCS orderability reads WHMCS. These sources must not be conflated. For a WHMCS checkout recommendation, use an explicitly mapped, live WHMCS orderability result, including currency and billing cycle; if unavailable or mismatched, do not assert that the Node price is the WHMCS checkout price.

## 2. Gaps and safety review priorities

These are observations and risks for follow-up, not claims of an exploitable production incident.

1. **Two customer entry paths.** `ai-support` calls `decideSupportResponse`; `/api/v1/account/ai/assistant` creates an AI-OS task using a deterministic `customer.assistant_query` handler. There is no demonstrated shared, multi-turn task lifecycle across them. Preserve the support conversation as the customer-facing entry point and reuse the control plane behind it.
2. **Planning and recovery.** `runTask` is synchronous and runs registered handlers. Event workflows iterate configured steps. Neither establishes a durable, interactive plan with customer follow-up, checkpoints, safe resumption and action verification. In `workflows/engine.ts`, only `failed` step outcomes increment failure count; an `awaiting_approval` outcome is not itself counted as a failure and can therefore yield a workflow marked `succeeded`. Also, caught workflow exceptions are audited before the event is marked processed. Review and test those semantics before using this engine for customer workflows.
3. **Tool enforcement boundary.** The registry defines argument metadata, permissions, risk and approval policy. The inspected `ToolDefinition` does not specify a per-tool timeout or verification contract. `handlers.ts` also contains direct `ctx.db.query` observations, so the executor is not literally the sole boundary for every read. New customer workflows must use reviewed, scoped tool interfaces; inventory and remediate bypasses before claiming complete tool mediation.
4. **Approval execution.** `decideApproval` atomically transitions pending decisions, but `executeApprovedApproval` loads an approved row, calls the implementation and only then marks it executed. Its reconstructed execution context has `customerScopeUserId: null`, and the execution path does not visibly repeat all registry-grant/agent-status/customer-scope gates. An atomic execution claim, preserved immutable customer scope, reauthorization at execution, expiry/cancellation and crash reconciliation need design and concurrency tests before sensitive actions are enabled. Existing decision-claim tests do not prove safe replay after process interruption.
5. **Secret and privacy minimization.** `redactForStorage` masks sensitive *object keys* and truncates strings; it does not establish removal of secrets embedded in free text. Support messages are stored as message bodies. Define allowed structured audit fields, minimize or redact free text, and establish retention/deletion controls before broadening memory or feeding customer information to a provider. Avoid placing executable arguments only in a redacted audit copy: redact-for-display and protected, minimal execution state have distinct purposes.
6. **Identity and authority.** A linked WHMCS identity/SSO is not by itself proof of authorization for every resource or operation. Verify link freshness, user ownership and supported WHMCS API behavior for each account read, using authenticated server-derived identity; never accept customer IDs from a model as authority. Existing AI-OS Node invoices and tickets must not be labelled WHMCS invoices or tickets.
7. **Verification and uncertainty.** A successful tool invocation is not necessarily a verified business outcome. Define per-adapter response validation and authoritative read-back. A timeout after a write is `unknown / reconciliation required`, not a failure that can be blindly retried. Never infer payment or provisioning from an order response.
8. **Prompt injection and data handling.** Existing grounded-model prompts treat retrieved text as untrusted, but prompts alone are not an authorization boundary. Model output, documents, tickets and provider responses are untrusted proposals/data. Server-side policy must constrain agent, tool, identity, resource, arguments and result; external model use also requires a reviewed provider/data-processing policy and approval.
9. **Current WHMCS evidence is limited.** The checked-in mapping and `docs/WHMCS-C1-CLOSURE-REPORT.md` describe local readiness only. No live orderability, account access, ticket operation, checkout completion, payment or provisioning is established by this audit.

## 3. Proposed target architecture

**Single experience:** existing support widget/conversation API → intent and policy router → existing AI-OS executive/task runtime → narrowly scoped specialized handlers and tools → evidence/result verifier → concise progress and final answer in the same conversation. Retain existing human handoff and knowledge feedback. Do not expose hidden reasoning; persist only action summaries and evidence references.

**Specializations, with independent allowlists:**

- **Executive coordinator:** classifies and delegates bounded tasks, resolves dependency/conflict rules, tracks state; cannot grant itself a tool or perform account writes.
- **Support/knowledge:** trust-aware website and reviewed-procedure retrieval; report conflicts, stale sources and unanswered questions; hand off to humans. Existing support and knowledge components are the primary implementation.
- **Sales/domain:** ask for requirements, use verified WHMCS orderability/cart and supported domain providers only; present source, currency, cycle and freshness. Domain availability must distinguish provider error from unavailable.
- **Hosting/technical:** ownership-scoped service/status and approved diagnostics; no arbitrary commands, raw logs or infrastructure access. Return sanitized evidence or escalate.

These are roles in the existing registry, not separate visible personalities. The model, if introduced, can propose intent, a bounded plan and candidate arguments only. A deterministic server validator and policy engine select approved transitions and execute tools. Unknown, out-of-scope or malformed proposals fail closed.

**Tool contract to add per adapter:** typed input and output schemas; allowed principal and agent; customer/resource ownership; risk and approval rules; deadline/abort support and bounded resource use; read-only retry policy; idempotency/reconciliation policy for writes; least-privilege implementation; allowlisted, sanitized audit fields; evidence provenance/freshness; explicit result-verification predicate. SSRF protections and bounded diagnostics are required for DNS/SSL tools. Enforce permissions on execution and again on resume, not merely when an action was proposed.

**Task lifecycle proposal:** `understanding → gathering_information → checking_services → preparing_recommendation → awaiting_customer_approval / awaiting_staff_approval → executing → verifying → completed`, with explicit `failed`, `escalated`, `cancelled`, and `outcome_unknown` states. A task cannot complete while any mandatory step is pending, failed or unverified. A cancellation prevents new work but must not claim to reverse a request already dispatched. Store a minimal structured plan, step transitions, deadlines, approvals, evidence references and redacted user-visible summaries—not chain-of-thought.

**Approval design:** bind each authorization to the authenticated approver, task, tenant/customer, resource, exact canonical action and parameters, price/currency where applicable, version and expiry. Customer consent and staff approval are separate controls when both are required. Atomically claim execution, recheck ownership/policy/approval, and record a stable idempotency key. For ambiguous writes, hold and reconcile with the authoritative upstream system; do not auto-resubmit. Maintain an explicit no-write default until a particular adapter and operational runbook are approved.

**Memory:** bind conversations and tasks to server-derived customer or opaque visitor scope; never merge visitor history into an account without an explicit secure linking procedure. Store only necessary context, explicit opt-in preferences and evidence references; prohibit credentials/payment data, set TTL and deletion policies, and restrict admin access. Define how secrets in customer free text are handled before claiming the system does not store them. Log access and prevent cross-customer reads, including resumed/child tasks.

## 4. Proposed phased implementation and release gates

All work below is proposed, not implemented. Database changes are additive new migrations when needed, developed and exercised against isolated test databases only. Each phase must report inspected/changed files, reused/new components, migrations, API and security changes, test commands/results, limitations and blockers.

### Phase 1 — Safety foundation and read-only workflow

- Review existing execution and workflow semantics; add a durable, concurrency-safe task/step lifecycle and enforce pending/failure/unknown states. Preserve scope across children, resume and approval; add central authorization, deadlines and minimal audit schemas. Fix or fence direct DB reads before routing customer tasks through them.
- Connect existing support conversations and trust-aware website knowledge to the existing AI-OS via a disabled-by-default feature flag. Keep current escalation as fallback. Begin with a bounded website-launch workflow: ask requirements, retrieve relevant approved sources, check WHMCS orderability when configured, present verified options or an honest unavailable status, and guide to an existing WHMCS cart only when allowed. Do not create or verify real orders in this phase.
- Likely touch `src/routes/ai-support.ts`, `src/services/ai-support-operator.ts`, `src/ai-os/{runtime,workflows,registry,agents,repositories}`, existing widget and relevant tests; evaluate a new additive migration for conversation/task associations, checkpoint/lease state and constraints. Exact schema/API is subject to implementation review.
- **Gate:** mocked provider + isolated DB tests for tenant isolation, prompt injection, missing/stale/conflicting knowledge, cancelled/interrupted tasks, parallel execution, no unverified price/availability, and escalation; existing chat remains usable with feature flag off.

### Phase 2 — Authenticated, read-only WHMCS and diagnostics

- After verifying supported WHMCS APIs and the identity bridge, add one narrowly scoped read adapter at a time for own services, invoices, orders or renewals. Read tenant identity from the server, verify ownership on every call, sanitize responses, enforce rate/timeout controls, and never label Node billing records as WHMCS.
- Reuse existing WHMCS live catalogue/orderability and cart builders. Add domain availability or diagnostics only through reviewed, supported providers and SSRF-safe tool implementations. Do not imply an order or payment exists from a redirect.
- **Gate:** mocks covering response schemas, mismatched identity, stale links, provider outage, timeouts, currency/cycle mismatch, unverified pricing and cross-tenant access. No external staging calls without separate authorization.

### Phase 3 — Human-in-the-loop, first limited write

- Design explicit customer consent, staff approval where needed, atomic claims, idempotency, audit minimization and reconciliation. First candidate is an explicitly approved support-ticket action **only if** its backing ticket system and semantics are verified; do not silently equate Node and WHMCS tickets.
- For each write: verify upstream acceptance and, where available, authoritative read-back; expose pending/unknown outcomes. Test duplicates, approval revocation/expiry, unauthorized replay, crash before/after upstream response, contradictory responses and concurrent requests. Support safe cancellation where the upstream semantics permit it.
- **Gate:** written security review, isolated integration tests and explicit operational authorization before any staging use. Ordering, refunds, DNS, production deployments and destructive actions remain disabled.

### Phase 4 — Operations centre and observability

- Extend existing AI command, support and knowledge pages with filtered task progress, approvals, escalations, tool evidence, integration health and feedback; scope customer views and minimize admin-visible data. Include error rates, unknown outcomes, stalled tasks, trust failures and alerts without logging secrets.
- **Gate:** role/tenant access tests, audit/retention review, accessible UI tests and proof that pending or unknown actions are never displayed as complete.

### Phase 5 — Further integrations and controlled release

- Only add a specific order or other write after its upstream API, billing rules, identity mapping, exact approval payload, idempotency and reconciliation have been independently verified. The ledger is a primitive, not authorization to send writes. Never equate order creation with payment or provisioning.
- Staging access, migrations, reindexing and production deployment each require explicit separate authorization, a rollback/recovery plan and monitoring. Start disabled and advance with measured feature flags. No live customer data or production effects are covered by this plan.

## 5. Verification performed in this audit

All commands ran locally in `cloudhost247-node/`. Tests used mocks or isolated PGlite databases; no WHMCS endpoint or staging environment was contacted.

| Check | Result |
| --- | --- |
| `npx vitest run tests/unit/ai-control-plane.test.ts tests/unit/ai-support-operator.test.ts tests/unit/ai-website-intelligence.test.ts tests/unit/ai-knowledge-trust.test.ts tests/unit/whmcs-client.test.ts tests/unit/whmcs-orderability.test.ts tests/unit/whmcs-cart.test.ts --maxWorkers=2` | Passed: 7 files, 93 tests. |
| `npx vitest run tests/integration/ai-control-plane.test.ts tests/integration/whmcs-idempotency.test.ts --maxWorkers=1` | Passed: 2 files, 20 tests. PGlite migrations used isolated in-memory databases. |
| `npm run typecheck && npm run typecheck:scripts` | Passed. |
| `npm run build:frontend && npm run build:tools` | Passed during local preview startup earlier in this session; Vite warned about large chunks. This is not the full production build. |

Not run: full test suite, full production build, browser end-to-end suite, live WHMCS or external provider tests, staging and production checks. Passing the selected tests does not prove the proposed new workflows or all existing security controls.

## 6. Phase 0 delivery record

- **Files inspected:** listed in §1 and cited in §2; targeted, not exhaustive.
- **Files changed / new components:** this audit and plan only; no application component was added or changed.
- **Existing components reused:** identified in §1; no runtime integration changes in this phase.
- **Database migrations / API changes:** none in repository or production; test-only migrations ran in disposable in-memory PGlite databases.
- **Security implications:** existing gaps requiring review are listed in §2; no production permissions or configuration changed.
- **Tests and results:** §5.
- **Known limitations:** no live configuration or integration was inspected; repository documentation and mock/in-memory tests cannot establish production readiness. The local preview contains demo data and is not production evidence.
- **Remaining blockers:** approval to begin implementation; verified WHMCS mappings, supported API/identity behavior and independent evidence; security, privacy and operational review; explicit authorization for any staging or production activity.
