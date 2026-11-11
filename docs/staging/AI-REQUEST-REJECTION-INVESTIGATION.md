# AI request rejection — investigation slice 1

## Decision

**INVESTIGATING / NOT FIXED / NOT PRODUCTION VERIFIED.** No incident root cause has been established. Do not substitute the code defects below for evidence about the reported incident.

Inspected repository HEAD: `4cddb33fe1a479578f421e78249916d312c43bfd`, branch `arena/b55a0c26-cloudhost247`, with pre-existing uncommitted Phase 31 retrieval changes. PR #114 is OPEN; `gh pr view 114 --json number,state,mergeable,headRefName` returned `mergeable: CONFLICTING` (exit 0). No merge, deployment, or paid provider call was performed.

The reported sentence, “The AI service rejected this request. Please adjust your message or attachments and try again.”, was not found by source searches in this checkout. Its originating deployment/component is unknown. Absence in this checkout does not prove absence in the deployed application, a gateway, or a different build.

## Traced paths

Paths below are relative to `cloudhost247-node/`.

| Feature | Input / serialization | Backend / orchestration | Provider / parsing | Failure display |
|---|---|---|---|---|
| Customer website support | `frontend/src/components/AiSupportWidget.tsx`: JSON `{message}`, conversation token header | `src/routes/ai-support.ts`: trimmed 1–10,000 character message; conversation authorization; `src/services/ai-support-operator.ts`; retrieval and `src/ai-website/answer-composer.ts` | `src/ai-website/grounded-model.ts`: optional `AI_LLM_*` model phrasing, OpenAI or Anthropic; reads choices/content text | Widget reads JSON message; composer uses deterministic retrieval if model returns null. Escalation transfers conversation to human queue. |
| Website creation | `frontend/src/pages/platform/AiBuilderPage.tsx`, `frontend/src/lib/api.ts`: JSON project brief then engine request | `src/routes/builder.ts`, `src/builders/ai/generation-service.ts`: authenticated ownership, allowance, generation ledger | `src/builders/ai/registry.ts`, `llm-provider.ts`: rules or external provider, JSON plan parsing and section validation | `src/builders/ai/types.ts` safe messages; failed ledger entry and structured generation result; configuration exceptions handled at route |
| Logo palette suggestions | Logo Maker project API | `src/routes/logo-maker.ts`, `src/logo-maker/logo-service.ts::suggestPalette`: ownership, ledger | Separate fetch path; OpenAI compatible only; Anthropic explicitly rejected; JSON palette response | All caught failures become a generic unreachable-provider ForbiddenError; ledger gets PROVIDER_ERROR |
| Administrative AI OS / copilot and agents | AI OS controllers | `src/ai-os/controllers/routes.ts`, `runtime/executor.ts` | `src/ai-os/models/router.ts`: database model configuration and deterministic handlers; not the website-generation registry | ModelResolutionError CONFIGURATION_REQUIRED; external-model metadata is not proof of a working outbound provider integration |
| General tools | Tool registry/capability architecture in `src/tools/core/registry.ts` | Per-tool handlers | No universal AI provider router identified by this trace | Must identify the affected tool before attributing an incident to these LLM adapters |

The three inspected outbound LLM adapters send ordinary non-streaming JSON requests, not attachment/multipart or SSE requests. These paths do not establish supported file-input or streaming capabilities. Attachment and streaming requirements remain unverified, not passing or implicitly supported.

## Confirmed source defects and risks (not incident attribution)

1. `grounded-model.ts` returns null on non-2xx, JSON errors, timeouts, and other exceptions. The cause/status/provider reference is lost. This can mask a configured model failure behind deterministic retrieval. Do not remove grounding validation to address it.
2. `llm-provider.ts::classifyHttpStatus` includes up to 200 characters of raw provider response text in its exception; generation-service persists this message. Logo suggestions do the same. Such text is not guaranteed sanitized and must not be copied to telemetry or customers.
3. Website generation classifies 429, 401/403 and general errors, but lacks distinct model/request/content/size categories. Malformed transport JSON is caught as a generic retryable provider error, rather than INVALID_RESPONSE.
4. Anthropic URL construction appends `/v1/messages` to the configured base. A base already ending in `/v1` yields `/v1/v1/messages`. This is a reproducible construction risk, **not evidence that the incident used that configuration**. OpenAI construction expects an API-root base and appends `/chat/completions`.
5. Model-specific parameter capabilities are not validated: generation requests send `temperature` and `response_format`; support sends `temperature` and `max_tokens`. Whether these are rejected depends on the configured model and gateway, which have not been observed.
6. Logo suggestion code slices supplied brief text for storage and outbound prompts. This conflicts with the new requirement not to silently truncate user input.
7. Support widget sets a busy state and restores input after failure, but the send handler does not itself guard `busy`. Ambiguous failures after backend persistence have no demonstrated idempotency guarantee. Do not add blind retries.
8. The prior-turn injection integration test currently fails because the planted turn now escalates and changes the conversation to WAITING_FOR_HUMAN; a subsequent post returns `{accepted:true,humanActive:true}`, not a decision. Do not weaken mandatory escalation or reset the queue merely to force an ANSWER assertion.

## Incident evidence / prerequisites

No AI credential environment variable names were found in the current shell. This does not establish the configuration of a deployed server. No authorized provider sandbox, deployed incident logs, failed request capture, or production host was supplied in this slice. Outbound access from this workspace is restricted; a configured hostname alone does not establish executable provider connectivity.

| Required incident field | Observed value |
|---|---|
| Affected feature and URL | Unknown |
| Deployed build / commit | Unknown |
| Provider and model | Unknown |
| Provider HTTP status and error code | Not captured |
| Sanitized provider error | Not captured |
| Request correlation ID / timestamp | Not supplied |
| Attachment metadata, if involved | Not supplied |

Minimum next evidence: affected page/feature, approximate failure timestamp with timezone, failing API URL and HTTP status, and correlation/reference ID if present. Obtain sanitized server-side diagnostics through an authorized deployment channel. Never request API keys, authorization headers, full prompts, private attachments, or an unredacted HAR in chat.

## Verification executed in this slice

- Source searches and inspections described above: completed. No runtime code changed for this new investigation.
- `npx vitest run tests/unit/ai-website-model-grounding.test.ts tests/unit/ai-registry-boot.test.ts`: **exit 0, 34 tests passed**. These are deterministic local tests, not live-provider verification. Output: `/tmp/ai-rejection-trace-tests.log` (ephemeral workspace log).
- Full release gate, builds, complete requested 20-case matrix, frontend browser checks, streaming, attachments, live provider integration, health-dashboard implementation, staging and production verification: **NOT EXECUTED in this slice**.
- Prior Phase 31 retrieval changes and their unresolved test failures remain in the working tree; this report does not certify them.

## Ordered implementation plan after incident evidence

1. Reproduce the identified feature failure with a sanitized provider contract fixture. Establish status/code and actual failing boundary before choosing a correction.
2. Reuse the existing provider abstractions; standardize endpoint validation and safe structured failure metadata across the existing adapters, not a parallel AI system. Preserve the unsupported-claim scrubber, permissions, strict boolean parser and palette gate.
3. Correct the proven request/configuration defect; test each API style and model capability without silently changing provider/model. Do not infer attachment or streaming support.
4. Propagate correlation IDs and safe categories into protected telemetry, APIs and frontend; do not retain raw provider bodies or customer prompts in telemetry. Review existing ledgers separately for sensitive persisted payloads.
5. Add bounded transient-only retry only with demonstrated duplicate/billing protection and cancellation; respect Retry-After. Never retry configuration or invalid-input failures.
6. Run the requested regression matrix, build/typecheck and final release gate; obtain authorized sandbox evidence separately. Add protected health aggregates without exposing existing prompt-bearing ledger records.
7. Resolve PR conflicts and require independent review before merging. Production deployment requires separate explicit authorization.

This slice adds only this report. It does not claim a permanent fix, provider certification, or readiness to merge.

## Implementation slice 2 — confirmed adapter defects

Status: **IMPLEMENTED / LOCALLY VERIFIED**, not incident-resolved, staging-certified or production-certified. The slice-1 observations above describe the pre-change state.

Changed files (relative to `cloudhost247-node/`):

- `src/builders/ai/provider-endpoint.ts` (new): common URL construction for the existing adapters. Anthropic origin and versioned-root forms both resolve to a single `/v1/messages`; gateway prefixes are preserved. Invalid protocols and embedded credentials/query/fragment are rejected. This is URL-shape validation, not a new network allowlist or a change to existing security controls.
- `src/builders/ai/llm-provider.ts`: endpoint validation before website-generation fetch; safe HTTP categories for 400/422, 413, 404, auth, rate limits and server errors; numeric HTTP status on provider errors; raw HTTP error body discarded rather than persisted; malformed transport JSON/envelopes become non-retryable INVALID_RESPONSE. Transport/section-validation exception text is no longer retained. Existing section validation remains mandatory.
- `src/builders/ai/types.ts`: INVALID_REQUEST and REQUEST_TOO_LARGE categories and safe customer messages; optional HTTP status metadata.
- `src/builders/ai/registry.ts`: exact engine matching. Previously an explicitly requested `anthropic` engine could resolve to an `llm` adapter under OpenAI configuration. Mismatched requests now fail closed rather than silently selecting a different API style. Engine picker lists the configured style as before.
- `src/ai-website/grounded-model.ts`: uses the same endpoint construction. Existing null-on-failure behavior remains a diagnostic gap; no claim of fixing observability here.
- `src/logo-maker/logo-service.ts`: reuses endpoint construction for its existing OpenAI-compatible request; no provider expansion. Existing error classification and truncation gaps remain open.
- `tests/unit/ai-provider-contract.test.ts` (new): 35 deterministic tests for URL roots, pre-fetch rejection, safe status classification, missing credentials, malformed JSON/envelopes, timeout, transport redaction, successful response parsing for both styles, and explicit engine selection/no fallback.

Actual verification:

- Initial `npm run typecheck` was mistakenly invoked from the repository root: **exit 254**, no root package.json. Corrected working directory to `cloudhost247-node/`.
- `npm run typecheck` from the application directory: **exit 0**.
- Final `npm run build:server`: **exit 0**.
- Final `npx vitest run tests/unit/ai-provider-contract.test.ts tests/unit/ai-website-model-grounding.test.ts`: **exit 0**, **2 files / 59 tests passed** (35 new + 24 existing). All provider HTTP responses are mocked; no paid/live model request. Workspace output: `/tmp/ai-provider-slice2-tests.log`.
- `git diff --check`: **exit 0** before the final safe validation-message edit; no whitespace errors observed.

No automatic retries were added. No provider/model fallback, credentials, authentication/authorization changes, frontend changes, health dashboard, or production deployment were introduced. HTTP status metadata is available on adapter errors but is not yet persisted end-to-end with feature/correlation telemetry. Numeric statuses do not establish provider error codes: a 404 may mean endpoint or model, and 400 may mean several contract/content errors; no guessed provider cause is recorded.

Remaining work: actual incident capture, protected correlation telemetry across adapters, logo error normalization and input preservation, frontend/idempotency/cancellation verification, supported-input capability decisions, full requested regression matrix, unresolved Phase 31 retrieval tests, final release gate, PR conflicts and independent review. **The reported recurring rejection is not yet certified fixed.**
