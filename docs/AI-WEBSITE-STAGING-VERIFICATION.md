# AI website coverage — staging verification record

## Decision and status

User approved staging verification only, with production deployment on hold. **BLOCKED at preflight. Not staging certified.** No deployment, live reindex, source approval, production migration, provider call or customer-facing availability claim was made in this verification attempt.

Intended source branch: `arena/1523d7fc-cloudhost247`.
Approved implementation identity: `261201bde135fa5065c855438b5c53fe32872cad`.
Actual local HEAD at preflight: `398d38766e6eb33c959fc3e1dc12ac7158b7052f`.

## Checks actually performed

- Confirmed current branch using local Git.
- Inspected working-tree status: implementation changes and new files remain present, but uncommitted relative to the base. They were not discarded, stashed, replaced or recommitted during this attempt.
- Local Git object lookup for the approved SHA failed. GitHub's commit endpoint returned HTTP 422, "No commit found for SHA". The previous completion explicitly reported that the commit was not pushed, so absence on GitHub is not proof it never existed locally. It is also not proof of a deployable release now.
- `git ls-remote --heads origin arena/1523d7fc-cloudhost247` returned no matching remote ref.
- Inspected workflow filenames and staging documentation. Available workflows are content hygiene, Node platform and independent foundation CI; they do not establish deployment access.
- Checked only presence, not values, of STAGING_URL, STAGING_BASE_URL, BASE_URL, STAGING_HOST, DATABASE_URL, CPANEL_HOST and SSH_HOST. None was set in this process environment. This does not prove no staging environment exists elsewhere.
- Inspected existing knowledge admin routes and staging runners. Full reindex is an authorized-role-protected POST, followed by persisted run counters and audit metadata. It is not necessary to create a second indexing pipeline.

## Required acceptance matrix

| Requirement | Result | Evidence / blocker |
| --- | --- | --- |
| Approved commit present on intended deployment branch | BLOCKED | Approved Git object unavailable locally and on GitHub; remote feature branch absent |
| Deploy exact approved release to staging only | NOT TESTED / BLOCKED | No confirmed staging target, isolated database or authorized deployment access |
| Run existing knowledge sync/indexing | NOT TESTED / BLOCKED | No authenticated staging session or reachable target; no POST issued |
| Verify expanded storefront content in deployed index | NOT TESTED / BLOCKED | No deployed source/chunk/fingerprint observations |
| Actual customer questions across service families | NOT TESTED / BLOCKED | Prior embedded-database tests are not deployed HTTP/browser evidence |
| Refuse stale prices, invented guarantees, private data and unsupported claims | NOT TESTED / BLOCKED | Needs controlled isolated staging records and actual public-route observations |
| Escalate unsupported/documentation-conflict cases safely | NOT TESTED / BLOCKED | No deployed conversation, ticket or redacted audit evidence |
| Separate staging verification report | RECORDED, NOT CERTIFIED | This document records preflight only; no acceptance result is fabricated |

## Safe unblocking requirements

1. Restore the exact approved Git object through a trusted Git source, or explicitly accept a freshly revalidated replacement commit if exact recovery is impossible. Record the identity change; do not silently label a replacement as 261201b. Push only this session's current branch. No production branch or host changes are implied.
2. Confirm the staging application URL, intended release/deployment ref, hosting/deployment mechanism and operator. Confirm this is isolated from production and contains no real customer data or live payment credentials. Identify backup/restore and rollback procedure before writes.
3. Provide staging access through approved environment/secret configuration or an authorized operator on the host, never credentials in chat, source control, screenshots or reports. A remote staging host is outside this sandbox's outbound host allowlist; execution may need to be performed by the authorized staging operator and redacted evidence returned.
4. Use a least-privilege staging role with permission for the existing knowledge endpoints. Do not bypass RBAC or auto-approve all content to obtain an answer.

## Staging-only execution procedure once unblocked

1. Verify the deployment's actual build identity against the accepted full SHA. Check that the build imports the regenerated knowledge projection; record its digest. Record runtime/database versions and isolated-environment attestation. Do not infer identity from a UI label alone.
2. Deploy through the confirmed staging mechanism. Follow the existing migration status/verify safeguards if schema setup is required; this coverage follow-up adds no migration. Do not modify published migration checksums or relax quarantine/confirmation controls. Preserve prior snapshot and rollback instructions.
3. Authenticate to the existing admin application using securely supplied staging access. Record baseline overview and source status with private fields redacted. POST `/api/v1/admin/ai-support/knowledge/reindex` with a full/manual scope, using the normal application authentication. Record run ID, completion status, discovered/indexed/skipped/failed counts and timestamps; an HTTP success alone is insufficient.
4. Inspect deployed sources/chunks using existing knowledge admin routes. Check all eight PHP storefront keys, their SPA `nav:` records, and `tool:/tools/dns/spf` / `tool:/tools/dns/dnskey`. Compare fingerprints and representative static passages to the accepted release. Confirm runtime prices/conditional stock states were not indexed as static facts. Confirm the SPA proxy ordering limitation and Workspace licensing prerequisites survive extraction.
5. Inspect approval, fingerprint binding, freshness and chunk consistency before answer evaluation. Changed approved revisions must remain blocked until a human reviewer approves the exact new fingerprint. Never change approval rules to force a green result.
6. Exercise actual staging public chat through HTTP/browser: VPS/dedicated servers, shared/WordPress hosting, domain registration/transfer, email migration, RDP connection guidance, SMM order guidance, SMTP application settings, DNS/SPF/DNSKEY diagnostics, published posts, policies and other storefronts. Record redacted question/answer, evidence destination, outcome and deployed SHA. Test guest and isolated customer sessions, unauthenticated admin denial and cross-session isolation. A page mention without a supported answer is not a pass.
7. On disposable staging records only, test stale sync, revision-unapproved, failed/partial index and equal-authority conflict conditions. Check current live-catalogue pricing versus old indexed amounts. Test invented service guarantees, account secrets, prompt-injection requests and private URLs. Confirm safe refusal/handoff without internal errors, private traces, cross-customer data or unsupported promises. Unsupported questions must not be relabeled as successful answers; index outages must not be counted as content gaps.
8. Verify handoff persistence and context, safe audit reason and no automatic authoritative publication. Use sink mail/notifications and isolated test customers; do not contact real recipients or paid providers. Preserve the original test state and restore controlled records after the exercise.
9. Attach redacted evidence and report each check as PASS, FAIL, BLOCKED or NOT TESTED. Record exact SHA and deployed/index fingerprints. Remain uncertified if required checks lack evidence. Production deployment remains on hold regardless of local/CI results until separately authorized after review.

## Scope exclusions

Do not run the broad financial staging smoke script merely to test AI coverage: it registers accounts, opens tickets and exercises sandbox payments. That is not a substitute for scoped AI checks. Local PGlite, fixtures, a local preview, CI results or historical staging evidence from another commit do not establish deployment/synchronization of this feature.
