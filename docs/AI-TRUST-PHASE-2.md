# AI trust Phase 2 — source authority, freshness and conflicts

## Status and scope

**IMPLEMENTED / LOCALLY VERIFIED for the deterministic rules below. The release-gate blocker was subsequently repaired; final local checks are green. See `AI-TRUST-RELEASE-REPAIR.md`.** Not infrastructure verified, staging certified, or production certified. No deployment, production migration, paid provider activation, or live transactions. No analytics project or weekly automation started.

Continues `AI-TRUST-AVAILABILITY-SLICE.md`. Phase 1 availability checks, safe escalation, history, feedback, access controls, and outage-versus-coverage distinction remain. The index guard is strengthened to compare actual versus declared chunk counts, including loss of only one passage within a source.

This is not a universal natural-language contradiction detector. Conflict coverage depends on human-reviewed, scoped claims. Unknown source modification times are retained as unknown, never replaced with invented author dates. These boundaries prevent a claim of universally verified current information.

## Architecture and deterministic rules

The existing `ai_knowledge_sources` / `ai_knowledge_chunks`, sync service, website retriever, answer composer, support handoff, audit log and knowledge dashboard are reused. No second knowledge store or retrieval pipeline.

### Authority

An authorized administrator assigns the tier while reviewing an exact fingerprint:

1. Approved official policies / service documentation (`legal_document`, `website_doc`).
2. Approved product/service/catalogue source records (`product`, `service`, `catalog_page`). Numeric prices still come from the existing live catalogue service, not from indexed documents.
3. Approved technical documentation (`website_doc`).
4. Approved FAQs / support articles (`faq`, `website_doc`).
5. Historical documentation (explicit historical marker; never selected as current evidence).
6. Unreviewed/unverified content (also the effective tier of an unreviewed source regardless of its stored requested tier).

Relevant current sources at the strongest eligible tier are selected before lexical/page composition. Lower tiers cannot outscore them through lexical bonuses. Equal-tier evidence retains deterministic lexical ranking. A lower-tier contradictory source is discarded as a whole; the system never merges a winning claim into losing prose or invents replacement evidence when the winner was not retrieved.

No migration or sync automatically sets human approval. Existing unreviewed published content remains usable at tier 6 if synchronized/current under the rules below. This is compatibility behavior, NOT a claim that such content is verified policy. User-generated guesses and AI answers are not promoted to approved sources.

### Freshness and revisions

Existing source ID, source type/kind, fingerprint (content revision), sync status and last successful sync are retained. Migration 0101 adds source modification time when supplied by extraction, content-observation time, explicit approval status, approved revision/reviewer/time, optional validity expiry, historical marker and reviewed claims.

- Missing successful sync, inactive/excluded/not-indexed state or chunk-count mismatch: unsynchronized, not eligible.
- Last successful sync older than seven days, implausibly future sync, or expired explicit validity: stale, not eligible.
- Known source modification newer than successful sync: unsynchronized.
- Previously approved source with a changed fingerprint: revision-unapproved, not eligible until reviewed again.
- Historical and rejected sources are not eligible as current evidence.
- An unchanged successful sync now refreshes last successful sync; it does not renew human approval, extend validity expiry, or approve a changed revision.

`source_modified_at` is nullable when the extractor cannot establish an author timestamp. `content_observed_at` is a separate database observation, not an invented author timestamp. Migration backfills observation time from the existing row timestamp; fingerprint remains the content revision.

### Conflicts

Administrators normalize facts into explicitly scoped keys, for example `product.plan.usd.monthly.region`. Values must be normalized consistently by the reviewer. Keys must include dimensions needed to distinguish different facts; unlike prices/terms must not be compared as if identical. Review metadata is not a content publishing API and is not used to generate new policy prose.

For relevant retrieved claim keys, the database also loads active, nonexcluded peer records carrying those keys, even if those peers were outside lexical search results.

- Prefer current approved evidence over stale/historical/revision-unapproved evidence.
- For a given key, conflicting weaker-tier values lose to the strongest current approved tier.
- Different values at that strongest tier are unresolved. A newer timestamp alone does not establish supersession or truth.
- Unresolved conflict, missing metadata or no eligible current relevant evidence causes safe technical escalation before reviewed fallback or model phrasing. No evidence-backed answer is fabricated and no documentation gap is recorded for that technical handoff.
- Claim values, keys, source bodies, fingerprints and raw exceptions are not added to customer responses or retrieval audit metadata.

### Live pricing

The existing public catalogue service remains the numeric pricing authority (published/public records only). A discovered composer defect could repeat an indexed price excerpt alongside current pricing. Pricing answers now omit indexed prose and bypass optional model phrasing, using deterministic live facts instead. Unavailable live facts never cause fallback to historical indexed prices. Pricing-only changes do not alter any provider configuration or activate a provider.

### Transparency and permissions

The support decision carries an internal trace of relevant retrieved source IDs, selected IDs, effective authority, approval and freshness states, conflicting record IDs/status, retrieval outcome and technical escalation reason. The route removes this internal trace before returning the customer decision and records it in existing audit metadata. Metadata contains no prompt, claim values/keys, source text or backend exception.

Early no-coverage rejection records candidate IDs and `no_match`; authority/freshness have not been assessed in that early path. Non-retrieval guard-rail decisions do not invent retrieval traces.

Existing staff/admin/super-admin knowledge read permissions remain. The new `PATCH /api/v1/admin/ai-support/knowledge/sources/:id/trust` endpoint requires existing admin/super-admin authorization with the database's current role/status check, strict input validation, source-type-compatible tier, and matching indexed fingerprint. Changed revisions are rejected. Reviews emit `AI_KNOWLEDGE_TRUST_REVIEWED` with actor, source identity and safe summary metadata. Staff cannot review. Source contents and published policies are not edited by this endpoint.

### Existing dashboard

The existing knowledge overview gains real database trust inventory, healthy synchronization count, unavailable/stale/conflicting counts, conflicting record IDs and all-time human-escalation event count. The UI distinguishes synchronization health from human approval and labels conflict coverage limits. Existing source inventory, failed sync jobs/runs, unanswered questions, feedback and coverage-gap views remain. Empty documentation gaps no longer falsely imply that every question was answered. These are operational trust-health additions, not a new analytics/reporting system.

## Files changed (relative to branch base; includes retained uncommitted Phase 1)

Under `cloudhost247-node/`:

- `database/migrations/0101_ai_source_trust.sql` — additive source trust metadata and claim index; no automatic approval.
- `src/ai-website/knowledge-trust.ts` — safe failure taxonomy/customer wording (Phase 1 plus Phase 2 categories).
- `src/ai-website/source-trust.ts` — deterministic authority/freshness/conflict assessment, peer lookup and live inventory.
- `src/ai-website/website-knowledge-repo.ts` — source timestamps and strengthened index readiness guard.
- `src/ai-website/knowledge-sync.ts` — source modification metadata and unchanged-success timestamp refresh.
- `src/ai-website/retrieval.ts` — Phase 1 failure distinction plus trust selection before composition and selected-subject coverage check.
- `src/ai-website/answer-composer.ts` — fail-closed trust escalation and live-only deterministic pricing.
- `src/services/ai-support-operator.ts` — safe technical handoff before reviewed fallback; internal trace propagation.
- `src/routes/ai-support.ts` — safe internal audit/redaction and retained outage-feedback gap guard.
- `src/routes/ai-knowledge-admin.ts` — RBAC-protected trust inventory and fingerprint-bound human reviews.
- `frontend/src/pages/AdminAiKnowledgePage.tsx` — operational trust health in existing dashboard; honest empty-gap wording.
- `tests/unit/ai-source-trust.test.ts` — 17 Phase 2 tests, including synthetic live-versus-indexed pricing tests.
- `tests/integration/ai-source-trust.test.ts` — 3 Phase 2 migrated-SQL/real-route tests.
- `frontend/tests/unit/admin-ai-knowledge-trust.test.tsx` — 2 presentation/error-state tests (mock API, not infrastructure evidence).
- `tests/unit/ai-knowledge-trust.test.ts` — retained 11 Phase 1 tests.
- `tests/integration/ai-knowledge-trust.test.ts` — retained 2 Phase 1 tests, strengthened for a single missing passage.
- `tests/unit/ai-support-operator.test.ts` — retained explicit healthy readiness fixture.
- `tests/integration/ai-website-publish.test.ts` — retained correction from unsupported `deploy` trigger to supported `event`; original answer assertions retained.

Documentation: `docs/AI-TRUST-AVAILABILITY-SLICE.md` (Phase 1 historical scope/results) and this report.

## Initial Phase 2 verification (historical)

The results in this section preserve the initial blocked attempt. Subsequent repair and final-tree results are in `AI-TRUST-RELEASE-REPAIR.md`; the release gate is no longer blocked.

Commands run locally, not against deployed infrastructure:

| Check | Actual result |
| --- | --- |
| `npx vitest run tests/unit/ai-*.test.ts tests/integration/ai-*.test.ts frontend/tests/unit/admin-ai-knowledge-trust.test.tsx` | **217 passed, 16 files**, exit 0; 838.42 seconds |
| `npm run typecheck` | exit 0 |
| `npx tsc -p frontend/tsconfig.json --noEmit` | exit 0 |
| `npm run build` | exit 0, including script typecheck, catalogue check, server, frontend and tools builds |
| `git diff --check` | exit 0 |
| `python3 scripts/validate-migrations.py` | exit 0 (repository module migration validator; not a substitute for PostgreSQL migration testing) |
| `PATH="$PWD/scripts/php-wasm:$PATH" PHP_LINT_JOBS=4 bash scripts/release-candidate-check.sh` | **exit 1 — BLOCKED** |

SQL migration 0101 was actually applied in throwaway PGlite databases through the full normal migration runner in the integration tests. It has not been applied to staging/production PostgreSQL.

The AI suite includes authority versus outdated FAQ; current versus historical pricing; stale, modified-after-sync and revision-unapproved records; current conflicting approved peers outside search results; real route human handoff and audit privacy; unavailable/failed sync; zero/missing sources' passages and loss of one passage; historical-price nonfallback; dashboard read RBAC; staff review denial; stale-fingerprint review rejection; existing tenant isolation, prompt injection, model grounding and AI control-plane regressions.

During development, initial new tests exposed an incorrect test import, an expected 422 versus the repository's actual validation status 400, and unavailable frontend matcher helpers; fixtures/imports/assertion syntax were corrected without weakening rejection or security assertions. A pre-final website regression run had 126 passes and that one validation-status fixture failure; the final all-AI run above is green.

The initial release gate was red on suite wiring and baseline website visual/cache-stamp checks. Its outer security group ran 468 tests with 2 failures and 2 skips; the nested clean-clone verification reports 697 tests with 6 failures, 2 errors and 10 skips. Cache-stamp reports name site CSS, metals CSS and motion JS. These unrelated gate failures were not repaired in the initial Phase 2 attempt. They were subsequently fixed, not hidden or disabled; see the repair report. Full local log: `/tmp/trust-phase2-release-gate.log`. AI/typecheck/build logs: `/tmp/trust-phase2-all-ai.log`, `/tmp/trust-phase2-server-typecheck.log`, `/tmp/trust-phase2-frontend-typecheck.log`, `/tmp/trust-phase2-build.log`. Temporary logs are workspace-session evidence, not durable external certification.

## Security evidence and known limits

- Verified anonymous overview rejection (401), customer overview denial (403), staff read access, staff trust-review denial (403), admin successful review and stale-fingerprint rejection (400).
- Verified unresolved conflicts persist a real support handoff, produce no selected evidence, retain audit source identities internally, reveal no internal trace to the customer and create no documentation gap.
- Phase 1 tests retain feedback/history and transcript access protection; existing AI isolation/injection suites are green.
- No credentials, private prompts, fabricated production metrics or external provider responses were used. Test prices/users are explicitly synthetic.
- Conflict detection covers normalized reviewer claims only. Missing/mis-scoped claims, prose-only contradictions and semantically equivalent differently formatted values are not generally detected. No automatic claim extractor or policy publisher was introduced.
- Unknown source-author timestamps remain unknown. Seven-day sync recency measures index observation, not a guarantee that upstream published content is itself correct or recently authored. No independently verified live staging site was available.
- Existing unreviewed content remains tier-6 eligible. Initial production rollout would require real authorized human reviews/claim normalization; tests do not supply those approvals.
- Candidate generation remains bounded lexical search. Peer lookup covers shared reviewed keys, not every prose source in the corpus. Conservative whole-source/tier exclusion can reduce answer coverage.
- Readiness, search and trust metadata reads are separate SQL statements, not a transaction-wide immutable snapshot against concurrent sync/review. Claim checks and admin review audit follow existing query/audit conventions; no new distributed transaction guarantee is claimed.
- Dashboard escalation count is all-time audit events, not unique customers or proof a human answered. Source inventory includes excluded/skipped records as unavailable for answering, not necessarily an infrastructure outage.
- The initial Phase 2 attempt did not run broad non-AI Node regressions. The repair subsequently passed all backend/frontend unit suites plus AI integration suites. Other integration suites, external database performance certification and deployed browser E2E remain untested. No staging/production certification.

## Branch and commit

Branch: `arena/f2942a04-cloudhost247`; base HEAD `5a15e0c187ddc6a8c8f90f791a5a90afc19e87cc`.

**Initial attempt:** no new commit or push because the repository-wide release gate failed.

**Subsequent repair:** source verification, broad Node regressions, typechecks, build and local rendered-template checks pass. The exact commit identity, if committed after final acceptance, is recorded by Git and the session completion message. No push/deployment or external certification is implied; trust coverage limitations above remain unchanged. No dashboard analytics or weekly automated reporting was started.
