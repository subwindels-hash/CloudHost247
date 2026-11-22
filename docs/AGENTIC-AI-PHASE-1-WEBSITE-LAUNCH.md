# Agentic AI phase 1 — read-only website launch slice

Date: 2026-11-22
Status: implemented locally, feature-flagged **off by default**, not deployed. This is a narrow first customer workflow, not completion of the agentic AI platform.

## Scope

An eligible customer asking to launch/build a website in the existing support conversation is asked to choose WordPress, business, or general website hosting. A recognized choice starts a `sales.website_launch` task through the existing AI-OS executor. Its dedicated `website-launch-assistant` agent has only `ai.catalog.read` and one customer-usable, read-only tool: `lookup_launch_orderability`.

The tool validates a fixed service-key allowlist and uses the existing checksummed WHMCS product map, client, catalogue loader and orderability decision. Successful orderability results are schema-checked before a price or WHMCS cart link is offered. Missing integration, upstream errors, disabled agents or invalid/contradictory results yield an honest unavailable response. The lookup may use a catalogue cached for up to one minute; WHMCS revalidates the cart. No order, payment or provisioning is made or claimed. The existing support guardrails for human requests, account actions, security issues, billing and knowledge trust run first. Exact category choices are intentionally narrow; unrecognized follow-ups return to normal support handling.

The support conversation's persisted message intent supplies the short multi-turn state; lookup task/run/step/tool records are stored by the existing AI-OS. Task context stores only the selected service key, not the free-text chat. The response and support transcript still use the existing support storage and access model. The frontend permits HTTPS WHMCS-cart links to navigate normally while retaining internal SPA navigation.

## Files and interfaces

- **Inspected:** `src/routes/{ai-support,whmcs-public}.ts`, `src/services/ai-support-operator.ts`, `src/ai-website/{retrieval,source-trust,knowledge-trust,answer-composer}.ts`, `src/whmcs/{client,config,orderability,product-map,cart}.ts`, `src/ai-os/{runtime/executor,registry/agent-catalog,registry/tool-catalog,registry/seed,tools/implementations,agents/handlers,permissions}.ts`, `frontend/src/components/AiSupportWidget.tsx`, existing AI-control-plane and website-knowledge tests (paths under `cloudhost247-node/`).
- **Changed:** `src/routes/ai-support.ts`, `src/config/env.ts`, `src/ai-os/agents/handlers.ts`, `src/ai-os/registry/{agent-catalog,tool-catalog}.ts`, `src/ai-os/tools/implementations.ts`, `frontend/src/components/AiSupportWidget.tsx`, `scripts/tools-preview-server.ts`, `.env.example`. The preview script builds a knowledge index only in its disposable in-memory database when the feature is explicitly enabled.
- **New:** `src/services/ai-website-launch.ts`, `src/whmcs/agent-orderability.ts`, `tests/integration/ai-website-launch.test.ts`, `tests/unit/ai-launch-orderability.test.ts`, this report.
- **Reused:** support conversation, safety/escalation and website-knowledge handling; AI-OS registry, executor, task/run/step/tool-call/audit records; WHMCS catalogue client, map validation, orderability and cart URL builder. No separate chatbot or billing system was introduced.
- **Configuration:** `AI_WEBSITE_LAUNCH_ENABLED` defaults to false. No production setting was changed. The flag controls the support-conversation entry point; existing authorized admin AI task mechanisms remain separate.
- **Migrations:** none added or applied to a live database. Existing migrations and a test-only knowledge sync ran in disposable in-memory PGlite instances.
- **API:** no new route. Existing support message decisions may now contain the intents `website_launch_requirements`, `website_launch_options`, or `website_launch_unavailable`, with existing follow-up and links fields when the flag is enabled. Existing AI admin views can inspect the corresponding task and tool call.

## Security and reliability

- The agent has no account, payment, order or infrastructure write grants. It uses an allowlisted server-side category; neither the customer nor a model can supply a price, product ID or URL. Existing per-message support rate limits apply. The WHMCS client uses its configured per-request timeouts, bounded read retries and circuit breaker; this slice does **not** add an overall task deadline.
- Existing support conversation authorization scopes multi-turn state; no customer identifiers are accepted from the message. Tests cover separate visitor tokens. The support transcript itself remains subject to existing privacy, retention and free-text secret-handling limitations; this work does not claim to solve those.
- The orderability tool is audited by the existing executor. A completed lookup task is not a completed customer purchase. Schema/consistency checks prevent the agent from presenting malformed prices, unsafe URL protocols or contradictory orderable results. No general-purpose model planning or arbitrary tool invocation was enabled.
- Existing source-trust checks and escalation are not bypassed. If knowledge is unavailable, the existing support flow can escalate before this workflow starts. This slice does not provide general knowledge-grounded recommendations or independently establish that the customer's chosen category is suitable.

## Tests and checks

All commands ran locally in `cloudhost247-node/`, with WHMCS mocked in the conversation integration tests and no network access to staging or production.

| Command | Result |
| --- | --- |
| `npx vitest run tests/integration/ai-website-launch.test.ts tests/unit/ai-launch-orderability.test.ts --maxWorkers=1` | 11 passed after final changes: conversation and task/tool execution, feature flag, disabled agent, human escalation, visitor isolation, injection-like extra instructions, unavailable/invalid upstream, no binding, allowlist and checked-in map. |
| `npx vitest run tests/integration/ai-website-launch.test.ts tests/unit/ai-launch-orderability.test.ts tests/integration/ai-control-plane.test.ts tests/integration/ai-workflow-safety.test.ts --maxWorkers=1` | 40 passed before the final added disabled-agent test and small cache-fingerprint/text changes. |
| `npx vitest run tests/unit/ai-control-plane.test.ts tests/unit/ai-registry-boot.test.ts tests/unit/ai-support-operator.test.ts --maxWorkers=2` | 39 passed. |
| `npm run typecheck` | Passed after final application changes. |
| `npm run typecheck:scripts` | Passed after the preview-only change. |
| `npm run build` | Passed before the final cache-fingerprint, answer-text and preview changes; Vite warned about large chunks. |
| Local preview HTTP smoke test | With the flag enabled only in the disposable preview, a launch request returned a requirements prompt, then a WordPress choice returned the honest unavailable response. No real WHMCS was contacted. |

The initial conversation test run failed because its isolated database had no knowledge index, so existing trust guardrails correctly escalated. The fixture was updated to run knowledge synchronization only in the in-memory test database; the rerun passed. No production reindex occurred. Full test suite and browser E2E were not run.

## Limitations and next work

- No natural-language planner, durable interactive task/approval lifecycle, domain availability, authenticated WHMCS account access, order verification, write action or production deployment is implemented. Suggested categories are selected by the user, not a validated suitability analysis. Unsupported requests continue through existing support behavior.
- The repository's WHMCS mapping currently has no bound services. No staging or live WHMCS responses were tested; actual checkout/prices and account integration remain unverified. No real customer account or external service was touched.
- Run state is recorded for the lookup, not a single resumable multi-turn task. Existing workflow concurrency, approval execution, task timeout, memory minimization, retention and secret-in-free-text limitations remain. This slice must not be used as evidence that sensitive autonomous actions are safe.
- Before any environment enables the feature, independently review privacy/security and map/currency/cart behavior, verify staging only with explicit authorization, and plan monitoring/rollback. Production changes and real customer operations still require separate authorization.
