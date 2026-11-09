# GA4 server-side purchase — staging certification evidence

**Status: NOT STAGING-VERIFIED; PURCHASE DELIVERY DISABLED IN CODE.** No authorized Google staging property, staging environment, Google credentials or Google-side results were available to this session. No event was sent to Google and no production setting/property was changed. This document is an evidence plan and empty record, not proof of a staging run. Production activation requires separate authorization.

## A–F certification summary

| Area | Status | Evidence / limitation |
|---|---|---|
| A. Automated implementation tests | PARTIAL locally | With the actual hard stop, two unmocked interlock tests and five multi-process PostgreSQL tests passed; six historical enabled-sender PostgreSQL tests are now skipped. The preserved sender/client-ID suites use an explicit test-only mock that bypasses the interlock and are not evidence that dispatch is enabled or safe. The consent, checkout, Meta and browser-runtime regression run passed 139 tests; lint, frontend TypeScript and production build passed. Earlier 133 focused tests passed; the delivery suite passed 21 tests after two additional cases; 35 checkout/config/Meta/webhook regression tests passed (30 additional webhook tests filtered out). Backend lint, frontend TypeScript and production build passed. See the implementation report for exact commands. The existing tests use simulated Google responses and embedded PGlite. An additional six-test suite used real local PostgreSQL 17.6 and separate Node processes with synthetic data and a fake transport; no request went to Google. |
| B. Google staging delivery acceptance | NOT RUN | No authorized staging property or secret available. HTTP status alone cannot establish processing; syntactically plausible but revoked credentials may not be identifiable locally. |
| C. DebugView confirmation | NOT RUN | No Google property access or event observed. |
| D. GA4 reporting confirmation | NOT RUN | DebugView and reporting are separate checks; neither is inferred from the other or from HTTP. |
| E. Security verification | PARTIAL | Local tests cover consent withdrawal, consent expiry/obsolete policy, duplicates, amounts/currencies, missing IDs, locally invalid credentials, simulated 401, timeout, interruption and embedded-database restore. Five new local PostgreSQL multi-process tests verified the unmocked disabled path, including withdrawal, restart and a terminated database connection. Earlier tests reproduced the race with the hard stop bypassed; the sender has not been remediated and strict withdrawal/dispatch coordination is not certified. Staging concurrency, secret redaction and Google behavior remain unverified. |
| F. Outstanding limitations | OPEN | Manual Node payments only; no WHMCS purchase or cross-platform deduplication; no automatic retry of unknowns; the legacy sender’s final-check-to-network race, currently contained by the non-configurable hard stop; no Google receipt proof or production certification. |

## Current safety decision and coordination design review

The authorized decision was **keep purchase delivery disabled**, rather than make withdrawals fail while an uncertain authorization remains unresolved. `src/marketing/ga4-purchase-safety.ts` is a non-configurable code interlock returning false. The worker does not claim rows or call transport, payment hooks do not enqueue new rows, and browser bootstrap does not advertise or store purchase client IDs, even if both delivery environment flags are true. The validator, consent revision, encrypted-storage schema and order-keyed outbox remain in place. This is containment, **not a fix or independent certification of the enabled legacy sender**. No database-backed dispatch coordination has been implemented. Enabling later requires a separately reviewed coordination design, code change, full race/failure tests, and explicit staging authorization. No Google events were sent.

Evaluation: a transaction-scoped row lock can order ordinary withdrawal against a worker's authorization, but PostgreSQL releases its lock on connection loss; a paused stale worker could then resume and initiate HTTP after withdrawal commits. A durable `armed` state could prevent withdrawal commit while initiation is uncertain without holding a database lock indefinitely, but a crash or partition could leave withdrawal unavailable pending verified reconciliation. That availability trade-off was not chosen. A database commit alone is not an external network fence. No new coordination locks or lock timeouts were introduced in this containment; existing consent/database locking and their deployment-level timeouts remain as before and are not certified as bounded by this change.

Disabled-state transitions (existing data only):

```text
new payment  -- interlock -->  no new GA4 outbox row
queued       -- worker ---->  queued (no claim / no request)
queued       -- withdrawal -> cancelled
sending      -- withdrawal -> unknown (potentially delivered; never auto-retry)
unknown / http_accepted / cancelled -> unchanged by disabled worker
```

Previously queued rows remain dormant and are **not** automatically replayed or aged into success; existing `sending` rows are not automatically recovered by the disabled worker and require a separately reviewed reconciliation. Withdrawal continues to remove identifiers and mark queued/sending rows as above. A previously initiated network request cannot be recalled. The stop applies only to processes actually running the updated code: before any authorized deployment, operationally stop all old API/worker instances and prevent their resumption, account for already initiated requests, and verify the updated version on every instance. A rolling/mixed-version rollout or a suspended old worker does not satisfy the guarantee. This checkout has not been deployed.

Five unmocked PostgreSQL 17.6 tests passed using separate worker processes and fake transport: six competing workers could not claim/send, withdrawal committed while workers were stopped by the interlock, restarting a worker did not send a queued row, terminating a worker's database connection did not permit dispatch, and withdrawal changed a pre-existing sending claim to unknown. Six historical enabled-sender PostgreSQL tests are explicitly skipped rather than reported as passing under the disabled path. The existing client-ID and delivery suites use a test-only mock to exercise preserved legacy behavior; their passing results must not be mistaken for an enabled production feature or a concurrency fix. Further independent design review, bounded-lock/failure-injection testing of any future enabled path, and actual authorized Google verification remain mandatory before staging readiness.

## Local multi-process evidence and remaining internal blocker

Six synthetic tests passed against a private Unix-socket PostgreSQL 17.6 instance, in randomly named disposable schemas. Six separate Node worker processes competed for one order: exactly one fake transport invocation occurred. Additional tests showed withdrawal committed before the final check prevented dispatch, an in-flight response was recorded truthfully after withdrawal, queued work survived worker replacement, and an interrupted in-flight claim remained unknown with no retry after another worker started. All transport calls were test fakes; no Google event was sent. PostgreSQL emitted existing nested-transaction warnings while applying migration 0048, which contains its own BEGIN/COMMIT; these were not GA4 worker failures, but migration atomicity was not certified by this test. This is local evidence, not staging certification or proof for every schedule.

**Historical enabled-path blocker (contained, not fixed):** another deterministic test suspended a worker immediately after its successful final eligibility query, committed withdrawal in a separate connection, then resumed the worker. The worker invoked the fake transport **after withdrawal had committed**. The `unknown` state remained truthful until a response, but the strict control “no new dispatch after withdrawal” is not established. The gap can persist while the worker is suspended, not merely for a negligible fixed duration. Do not mark the milestone STAGING-VERIFIED or claim that an authorized property is the only outstanding dependency until a consent/dispatch coordination design is implemented and independently reviewed, or the authorized privacy owner explicitly resolves this acceptance criterion. Requests already in flight cannot be retracted. No broadening of payment eligibility or automatic retry is justified by this finding.

The opt-in test file is `cloudhost247-node/tests/integration/ga4-purchase-postgres.test.ts`, with a fake-transport helper in `tests/helpers/ga4-purchase-postgres-worker.ts`. Default test runs skip it. On a **disposable, isolated local test PostgreSQL** accepting a private socket on port 55439 and a local OS-matching database user, explicitly run from `cloudhost247-node`:

```sh
GA4_PG_TEST_CONFIRM=disposable GA4_PG_TEST_SOCKET=/tmp/<private-test-socket-dir> \
  npx vitest run tests/integration/ga4-purchase-postgres.test.ts --maxWorkers=1
```

The suite creates and drops randomly named `ga4_cert_…` schemas and runs the normal migrations inside them; never point it at a production, shared, or valuable database. The sample socket path is illustrative, not a command to connect to an existing service. The temporary PostgreSQL binary/cluster used here was not committed. Normal staging must still independently confirm isolation, local secret handling, concurrency, Google receipt, DebugView and reporting.

## Mandatory authorization before any external request

The following is a future checklist only: **do not configure credentials or run it while the code interlock is active.** An authorized operator must complete and sign these items in a restricted operational record, **not in Git or chat**. Do not proceed if any is unknown or false:

- [ ] Written scope, approver and time window specifically authorize synthetic staging measurement; production activation is not authorized by this milestone.
- [ ] The GA4 property and web stream are explicitly approved and staging-only, with a staging-only Measurement ID distinct from production. Record an access-controlled property reference and verify separation independently. The code cannot establish that an ID is a staging property.
- [ ] Staging application, worker, database and secrets are isolated from production and contain synthetic test data only. `NODE_ENV` alone is not proof of isolation.
- [ ] GA4 admin configuration matches the staging hostname and ID; the required external privacy reviews have been performed. Make all config changes before browser consent/capture; a subsequent revision change invalidates earlier attribution.
- [ ] A server-only staging MP API secret and the credential encryption keyring are available via the deployment secret store to both API and worker. Never paste secrets, request URLs, client IDs, cookies, ciphertext or customer data into evidence, logs, Git or chat. Audit application, proxy and telemetry redaction; MP puts the secret in the outgoing URL query.
- [ ] A future independently reviewed fix removes the hard stop, and both `GA4_PURCHASE_DELIVERY_ENABLED` and `GA4_PURCHASE_STAGING_AUTHORIZED` are explicitly enabled only in isolated staging. The second flag is an **operator attestation**, not a verification of ownership or isolation; the default is false. Leave both off in production.
- [ ] A synthetic customer's real Google `client_id` is obtained from the tag after current analytics consent and stored encrypted before that customer's authenticated checkout. Do not invent a client ID. Avoid collecting it in the evidence.
- [ ] A synthetic order is independently confirmed by an authorized staff operator using the **manual** staging payment path. No sandbox or unreviewed provider is eligible. Confirm the payment only after consent, capture and checkout.
- [ ] A correlation ID is documented in the access-controlled test record: the generated **synthetic Node order UUID** is both `ga4_purchase_outbox.order_id` and the GA4 purchase `transaction_id`. Do not reuse a real customer order, manufacture an order ID or put a linkable ID in public documentation. Separately record an opaque evidence case reference for public summaries.

## Authorized lifecycle and evidence checklist

Only an operator with access to the isolated staging deployment and property may execute this procedure. Do not change or create a live Google property.

1. Before the run, verify there are no other GA/GTM/WHMCS purchase sources for the same synthetic transaction, configure the staging stream's privacy settings as documented in the runbook, and enable GA4 test mode **in the staging configuration**. `debug_mode` still sends a real event to the chosen property; it is not a sandbox.
2. In a clean staging browser, grant analytics consent. Verify browser capture uses `gtag('get', ...)` and same-origin CSRF; record only that the encrypted row exists, not the identifier or ciphertext. Confirm no capture before opt-in. If capture has not completed, stop: checkout cannot be retroactively attributed.
3. On isolated staging, perform the authenticated synthetic checkout. Record the synthetic order UUID as the restricted correlation ID. Verify an encrypted checkout snapshot exists, without exporting the ID or ciphertext. A paused staging-only worker can make the queued state observable; coordinate the pause with the staging operator and do not disrupt production workers.
4. Independently confirm the synthetic manual payment as an authorized staff user. Capture only redacted evidence of confirmation, actual test currency/value, current consent/config revision and the outbox's queued state. Do not manually insert or edit financial/consent/outbox rows.
5. Resume the staging worker. Using a restricted read-only database account and a bound synthetic order UUID, inspect only `order_id`, `payment_id`, `status`, `http_status`, `created_at` and `updated_at` in `ga4_purchase_outbox`. Record the case reference, correlation ID in restricted storage, timestamp/time zone, status and numeric HTTP status. `http_accepted`/2xx is transport evidence only. `unknown` is ambiguous; do not replay or reset the tombstone. For `cancelled` investigate without sending that order again.
6. Independently inspect GA4 DebugView for the `purchase` associated with the same synthetic `transaction_id`, expected currency and value; record observation time and a redacted evidence reference. DebugView visibility may depend on Google processing/session requirements; its absence is not proof that replay is safe.
7. Separately inspect GA4 reporting/Explorations after Google's processing delay and record observation time, date range, event, transaction correlation, currency/value and redacted evidence reference. Absence may reflect processing delay or reporting thresholds; do not infer success from DebugView. Avoid making configuration changes or exports in a live property.
8. Verify duplicates and failure cases using separate authorized synthetic cases, not customer transactions. Record the local result and Google-side observation independently. Simulated 401/timeout in local tests is not proof of Google's behavior with revoked credentials. Repeat worker/process restart and PostgreSQL concurrency with the staging operator; address the local post-check withdrawal race before claiming strict withdrawal behavior. A request already sent cannot be recalled upon withdrawal.
9. Disable both staging flags and stop any dedicated staging worker after testing. Protect/delete test artifacts under the approved retention policy, leaving the durable outbox tombstones intact. An authorized reviewer must examine all evidence before changing this document's status.

## Evidence record (unfilled)

- Approval / scope / staging property reference / operator / timestamps: **NOT PROVIDED**
- Isolated application + database verification and staging-only Measurement ID confirmation: **NOT PROVIDED**
- Synthetic case reference and restricted order-UUID correlation evidence: **NOT PROVIDED**
- Consent + encrypted capture + checkout + independent payment confirmation: **NOT RUN**
- Outbox queued and subsequent numeric HTTP status: **NOT RUN**
- Google Measurement Protocol validation and transport acceptance: **NOT RUN**
- DebugView correlation / time / redacted evidence: **NOT RUN**
- Separate GA4 reporting correlation / time / redacted evidence: **NOT RUN**
- Withdrawal, duplicates, expiry, invalid inputs/credentials, timeout, interruption and real restart security evidence: **NOT RUN**
- Reviewer / decision: **NOT REVIEWED — NOT STAGING-VERIFIED**

The Google [Measurement Protocol validation guide](https://developers.google.com/analytics/devguides/collection/protocol/ga4/validating-events) and [protocol reference](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference?client_type=gtag) describe validation separately from collection. The validation endpoint does not itself establish a reported purchase. Never copy secret-bearing query URLs into the evidence.
