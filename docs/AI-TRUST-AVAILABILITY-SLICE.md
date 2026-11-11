# AI trust layer: availability versus coverage

## Status

IMPLEMENTED and LOCALLY VERIFIED only. No deployment, paid provider calls, infrastructure certification, or production approval.

This bounded slice distinguishes an unavailable/incomplete index or failed search from a healthy index with no matching evidence. It does not implement source authority ranking, freshness verification, conflict resolution, or a weekly reporting scheduler.

## Behavior

- Read readiness counts and latest sync status in one SQL statement. Require a successful latest sync, at least one active derived indexed source with chunks, and no active pending/failed sources or indexed sources without chunks. Excluded/skipped sources do not block readiness.
- Fail closed on readiness-query, lexical-search, or title-search failure. Customer responses use safe categories, never raw exceptions.
- Escalate unavailability before model phrasing or reviewed-procedure fallback, preserving the existing conversation and human handoff.
- Record safe failure categories in escalation audit metadata. Do not turn operational outages into documentation gaps, including when a customer downvotes the outage response. Feedback itself is retained.
- Healthy no-match questions retain their existing coverage-gap behavior.

The guard is deliberately corpus-wide: even an unrelated incomplete source blocks retrieval. It is not topic-level health or freshness proof. Readiness and search are separate statements, not an atomic snapshot across concurrent changes. Missing chunks within an otherwise chunk-bearing source are not independently detected by this guard.

## Local evidence

- Final server `npm run typecheck`: exit 0.
- Initial targeted trust/operator/integration run: 19 passed across 3 files.
- Existing website regression run: 89 passed, 1 failed across 5 files. Publishing fixture used unsupported `trigger: 'deploy'`, causing the database to reject the diagnostic ledger insert; the new guard correctly refused retrieval without a successful ledger. Fixture corrected to the existing supported `event` trigger, without removing assertions or relaxing the readiness guard.
- Final targeted run including the full publishing suite: 24 passed across 4 files. Includes failed sync, all chunks missing, a single source missing chunks, retrieval outage, safe audit metadata, persisted handoff, unauthorized transcript access, and feedback without gap pollution.
- The other four existing website suites passed in the earlier regression run; they were not rerun after the final missing-chunk guard adjustment. No full repository regression, build, or release gate was run for this slice.

## Pending

Source hierarchy; timestamps/freshness/deletion/conflict verification; sensitive-claim evidence requirements; heuristic-confidence labeling/calibration; knowledge dashboard quality extensions; weekly reporting and separately authorized scheduling/delivery/privacy/retention. Existing admin permissions and knowledge dashboard are unchanged. Never auto-promote customer guesses or AI outputs to authoritative policy.

Staging and production certification remain unestablished. Historical release-gate failures are not resolved by these tests.
