# Phase 31 — Staging Blocker Closure and Release Governance

## Decision and scope

**PRODUCTION NO-GO. No B1–B4 staging blocker is closed in full.** Genuine local PostgreSQL and browser evidence reduces uncertainty, but does not replace provider certification, a deployed WHMCS/cPanel staging host, or an observed scheduler cycle. A report alone does not close a blocker.

Opening repository: `subwindels-hash/CloudHost247`, `/home/user/CloudHost247`; branch `arena/b55a0c26-cloudhost247`; opening HEAD `4cddb33fe1a479578f421e78249916d312c43bfd` (Phase 30 report commit). Phase 30's actual runtime-tested commit was `0f599e5f6ebd2711af772da735c289dae822b9d1`; these are not interchangeable. The working tree already contained Phase 31 retrieval work and subsequent AI-adapter remediation. Historical Phase 30 evidence is preserved in `cloudhost247-node/docs/STAGING_CERTIFICATION_PHASE30.md`.

## Opening procedure and execution permissions

Before this continuation's edits: verified cwd/branch/HEAD and dirty status, read the Phase 30 certificate including its four blocker definitions, inspected surviving evidence, checked running PostgreSQL/server processes and scheduler availability, and checked available environment variable names without printing values. No AI/provider, WHMCS/cPanel or payment credential variable names were present in the shell. This does not prove that a remote deployment has no secrets.

`gh secret list` returned **exit 1 / HTTP 403 Resource not accessible by integration**. Remote secrets are not inspectable with this integration; absence must not be inferred. GitHub PR read operations work. Local repository edits and throwaway database operations are permitted. No production connection, staging host identity, or external provider credentials were supplied. Outbound access is restricted to the sandbox's documented package/GitHub hosts; model/hosting/payment hosts are not available simply because source configuration names them.

`command -v crontab` found no executable. `/etc/cron.d` contains a system maintenance entry, not CloudHost247 scheduling. The cPanel cron command is documented at `docs/CPANEL_DEPLOYMENT.md` §9; documentation is not an installed schedule.

Plan carried out: stop B1/B2 certification for missing dependencies; classify existing worker/browser evidence honestly; fix retrieval without bypassing escalation/security; preserve evidence under `docs/staging/evidence/phase31/`; run affected tests and source release gate; do not merge or deploy.

## B1–B4 evidence matrix

| Blocker | Highest evidenced layer | Staging closure | Missing prerequisite |
|---|---|---|---|
| B1 — AI provider | **IMPLEMENTED / LOCALLY VERIFIED** adapter contracts using explicitly mocked HTTP in unit tests | **BLOCKED** | Authorized endpoint/model/key, permitted outbound route, real sandbox request and sanitized provider audit evidence |
| B2 — WHMCS/cPanel | Source/configuration inspected; external connectivity/auth/sync/webhook/payment tests **NOT TESTED** in this continuation | **BLOCKED** | Genuine non-production host, authorized WHMCS/cPanel API credentials/permissions, callback endpoints and sandbox-only payment secrets |
| B3 — scheduled worker | **REAL INFRASTRUCTURE VERIFIED** underlying leases, retries/backoff/terminal failure on local PG; real `--once` entry point executed manually | **BLOCKED** for actual scheduled execution | Installed staging schedule plus evidence it fired the deployed command; host permissions/process monitoring |
| B4 — deployed browser E2E | **REAL INFRASTRUCTURE VERIFIED (local, limited)** real Chromium against a local production-mode build and PostgreSQL; not mocked browser output | **BLOCKED** for deployed staging | Deployed staging URL, authorized customer/admin test identities, integrations; full customer/admin workflows, not just authorization refusal |

No API keys were invented, no live transactions initiated, no new paid provider activated, no provider switched silently, no production configuration changed.

### B1 supported adapters and remediation

Website generation uses `src/builders/ai/registry.ts` / `llm-provider.ts` with OpenAI-compatible or Anthropic request shapes and `AI_LLM_*` environment secrets. Support's optional phrasing adapter is `src/ai-website/grounded-model.ts`; logo suggestions have a separate OpenAI-compatible path. AI OS uses a database-backed router. They do not share one universal provider execution path.

URL-shape validation is **not endpoint allowlisting**. This phase adds no provider allowlist or secret-store integration; environment-key configuration exists, but deployed secret management and external-network authorization remain unverified. Detailed trace and scoped backend changes are recorded in `AI-REQUEST-REJECTION-INVESTIGATION.md`. Genuine model behavior, latency, content rejection, retries, and provider audit logging remain unverified. Existing support null-on-failure behavior and logo diagnostics remain limitations. No live model was contacted.

### B3 observations and correction of earlier wording

Prior local entry-point command: harness executing `node dist/src/worker/main.js --once` with local PG, production-mode environment, valid ephemeral encryption/JWT configuration. Two runs returned exit 0. Preserved runtime logs: `evidence/phase31/worker-entrypoint-run1.log` and `worker-entrypoint-run2.log`.

Observed earlier in this session: genuinely failing healthcheck (`NO_INSTALLATION`) moved attempts 1→2 of 3, with `run_after` 10 seconds later (22:11:52.605 → 22:12:02.616 in the recorded run). A future-dated job remained untouched, and a ceiling job became terminal failed 3/3. Test deployments were removed; the continuation confirms zero `phase31-%` deployment rows. These database observations came from prior executed probes; the retained worker text logs alone do not encode all those row values.

Fresh continuation lease probe against PG 18.6: acquire A true; B while held false; C after expiry true; non-holder release leaves E acquisition false; holder release permits F true. Probe exit 0. This directly invokes lease functions and is classified as underlying lease verification, **not scheduler evidence**.

**Correction:** earlier conversation called B3 fully real-infrastructure verified. The component tests were real, but manually invoking a cron harness is not proof of a scheduler firing. No actual cPanel scheduler cycle has been observed. B3 stays open.

One earlier parallel harness failed startup with DATABASE_URL/JWT_SECRET absent (`cronB.log`, exit 1); it is not duplicate-prevention evidence. Provider/resolver probes in retained worker logs include failures, expected with unavailable network/integrations, not green external-provider checks.

### B4 observations and limits

Historical local browser run: 7/7 checks recorded in `/tmp/e2e/results2.json`, sanitized durable outcomes in `evidence/phase31/local-browser-summary.json`. API-based register 201/login 200 in browser context; customer account view h1 Account; no admin navigation; customer `/admin` h1 Not available; admin customers API 403; identity API 200; session persists across navigation. Fresh SQL confirms 3 test customer users active. Prior SQL also confirmed registration, verification-request and login audit records.

This used real Chromium, `dist` + built `public/`, local port 8080, and real PostgreSQL. It did **not** test login-form interaction, successful admin workflows, payment/infrastructure integrations, mobile layout, or the final committed code tree. Earlier screenshots showing the login page on both private routes were invalid evidence and are not retained as proof. Local screenshots remain ephemeral under `/tmp/e2e/shots/`; there is no durable staging screenshot set. No staging certification is claimed.

## Retrieval remediation

Underlying defect: additive lexical scoring combines unrelated matches; Email Hosting mentions mobile clients and a different page mentions phone support. Typo correction also rewrote real words (`cell`→`call`, `sim`→`sit`). Neither proves the site sells mobile phone plans.

Changes in `cloudhost247-node/`:

- `src/ai-website/query-understanding.ts`: protect real query words; share question-scaffolding terms.
- `src/ai-website/retrieval.ts`: verify coverage on the winning page, not the combined candidate set; preserve specifically named offerings and title anchors; retain payment acceptance as an intent-bearing relationship. A meaningful subject with zero coverage is refused. This is a lexical guard, not a claim of general semantic understanding.
- `tests/unit/ai-website-audit-regressions.test.ts`: unsupported-subject regressions plus real-service counterexamples.
- `tests/integration/ai-website-knowledge.test.ts`: verify refused-injection handoff/transcript persistence separately from active-decision history safety. Mandatory escalation remains intact; tests no longer assume an escalated conversation returns another AI decision.

Early strict chunk-coherence versions failed legitimate Kubernetes publishing queries and the injection test; those failures were real and not suppressed. Final affected run: **47 passed / 3 files / exit 0**, including the Kubernetes publishing suite and injection tests. Repeated targeted unit attempts first failed PayPal refusal (16 passed, 1 failed); the final gate accounts for the acceptance relation and passes that regression.

Local PostgreSQL benchmark: **76 queries, 71 identical result lists, 5 changed to refusals**. Changed queries and before/after URLs are in `evidence/phase31/retrieval-comparison.json`. This bounded comparison is evidence against those observed regressions, not proof of perfect relevance on all questions.

Projection freshness: `node scripts/site/generate-ai-knowledge.mjs --check`, exit 0, **410 documents**. Fresh PG sync discovered 410, unchanged 407, excluded 3, failed 0, status succeeded. The DB has 407 source rows, not 410 indexed sources; exclusions must not be counted as indexed successes. Source counts include 9 skipped website pages and 1 skipped tool.

## Command ledger and verification

All paths/commands are from repository root unless stated. Sensitive values and complete prompts are not copied into this report.

| Command / action | Actual result |
|---|---|
| `pwd`; `git branch --show-current`; `git rev-parse HEAD` | exit 0; repository/branch/opening commit above |
| Read Phase 30 certificate; inspect process/scheduler evidence | completed; local PG and API process running; no CloudHost247 installed scheduler established |
| `gh secret list` | exit 1, HTTP 403; remote secret access unavailable |
| `gh pr view 114 --json state,mergeable,headRefName` | exit 0; OPEN; mergeability temporarily UNKNOWN in opening query (previous continuation saw CONFLICTING) |
| Initial retrieval-edit Python command using duplicate application prefix | FileNotFoundError; no edit applied; corrected path before retry |
| Initial targeted retrieval test attempts | exit 1; PayPal refusal regression, 16 pass / 1 fail; repaired, not hidden |
| `npx vitest run tests/unit/ai-website-audit-regressions.test.ts tests/integration/ai-website-publish.test.ts tests/integration/ai-website-knowledge.test.ts` (application cwd) | exit 0; 47 passed, 3 files; `/tmp/phase31-affected.log` |
| `npx tsx bench.tmp.ts after` (application cwd; historical probe) | exit 0; 76-query comparison above |
| Real PG version/source/user/cleanup queries | exit 0; PG 18.6, 407 sources, 3 active test customers, zero remaining phase31 deployment probes |
| `syncWebsiteKnowledge` using actual `PgClient` | exit 0; discovered 410 / unchanged 407 / excluded 3 / failed 0 |
| `npx tsx lease.tmp.ts` (application cwd; historical probe) | exit 0; fresh lease outcomes above; not scheduled execution |
| `npx tsc -p frontend/tsconfig.json --noEmit` (application cwd) | exit 0 |
| `npm run typecheck` (application cwd) | exit 0 |
| AI provider contract + model-grounding unit tests (previous slice) | exit 0; 59 tests passed, mocked HTTP only |
| `npm run build:server` (previous slice) | exit 0 |
| Complete Node `npm test` supplemental run | stopped before completion after partial integration execution; NOT a passing full-suite run; `/tmp/phase31-full-node.log` |
| `npx vitest run tests/unit` (application cwd) | exit 0; **165 files / 2,371 tests passed**; `/tmp/phase31-unit.log` |
| `npm run build` (application cwd) | exit 0; server/frontend/tools build plus script typecheck and catalog check; `/tmp/phase31-node-build.log` |
| `PATH=/tmp/staging/scripts/php-wasm:$PATH bash scripts/release-candidate-check.sh` | first pass **exit 0** on `7f9e59fd58c7412894926b37c01014900b47f559`; rendered-site audit explicitly skipped due to absent Smarty; `/tmp/phase31-release-gate.log` |
| `PATH=/tmp/staging/scripts/php-wasm:$PATH bash scripts/verify-rendered-site.sh --fetch` | exit 0; pinned/hash-verified Smarty 4.5.6 fetched; **235 rendered pages**, 935 images, 56,882 links, canonical/hero/tool resolution passed; deprecation notices recorded; `/tmp/phase31-rendered-site.log` |

## Remaining dependencies and release decision

1. Authorized live/sandbox AI credentials and reachable allowed endpoint, validated secret management, genuine provider request/error/timeout/audit evidence.
2. Real WHMCS/cPanel staging host and API permissions; sandbox payment credentials, callback paths and external connectivity.
3. Installed scheduler and observed trigger against the deployed staging build.
4. Staging URL, permitted admin/customer test accounts, successful authorized admin/customer workflows and integration persistence evidence.
5. Independent review of this evidence and completion of the supplemental full Node suite (not completed here). Passing mocked tests does not satisfy any external dependency.

**NOT MERGED · NOT FULLY STAGING CERTIFIED · NOT PRODUCTION CERTIFIED · PRODUCTION NO-GO.** Phase 30 remains historical partial local staging evidence, not automatically transferred certification of this changed tree. PR #114 was **CONFLICTING** on the final pre-push GitHub query, so the branch is **NOT MERGEABLE as observed**, independent of passing source tests. The final report-only commit is rechecked with the complete source gate; its exact hash and exit status are emitted by the execution wrapper and reported in the final response without changing that tested tree. No merge, production deploy, live payment or production infrastructure change is authorized or performed in this phase.

## Verification scope and cleanup

The repository source release gate is `scripts/release-candidate-check.sh`. It is not the same as the separate Node CI job's full `npm test`. The former completed; the latter was stopped and remains incomplete. The full unit suite and both affected integration suites are passing. No full CI-green claim is made. The report-only final commit is subjected to the source gate again with `PHP_LINT_JOBS=4` (same target list/checks, parallel lint only); the final outcome must be taken from the actual execution result, not inferred from the first pass.

Pinned Smarty was subsequently installed in the ignored local cache, so the final gate can execute the previously skipped render audit. PHP emitted template-plugin deprecation notices; these were not suppressed and are not interpreted as failures or as production compatibility certification. This continuation uses the existing PHP-WASM CLI, not a repeat of Phase 30's two-version certification.

Scratch probes were moved to `/tmp/phase31-scratch/`, outside Git. Durable evidence contains sanitized outcomes only. The local API preview was stopped; the PostgreSQL throwaway cluster remains available. Production build output is ignored and is not committed. No existing historical certification report was overwritten.
