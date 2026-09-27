# Phase 1 delivery report

Date: 2026-09-27

## Implemented

* Four independently named addons: shared foundation plus theme, currency and OVH foundations.
* Transactional, ordered, idempotent migration runner and migration ledger.
* Twelve new `mod_cloudhost247_*` tables for migrations, logs, capabilities, theme settings/content, currency providers/runs/history, and OVH endpoints/mappings/jobs.
* Non-destructive activation/deactivation behavior. No WHMCS or original-vendor table is dropped, renamed or overwritten.
* Administrator authentication, CSRF and role-capability primitives.
* Structured logging with correlation IDs and recursive credential redaction.
* Runtime capability dashboard and safe activation errors.
* Standalone unit/static tests and GitHub Actions syntax/test workflow.
* Automated scan ensuring replacement PHP does not reference known vendor licensing entry points.

## Test results

* Python static safety suite: **4 passed, 0 failed** locally.
* SHA-256 original-file manifest remains present and original in-scope files were not edited by Phase 1.
* Local PHP lint/unit tests: **blocked**, because the execution environment has no PHP binary. The committed GitHub Actions job runs these on PHP 7.4.
* WHMCS activation/schema/admin tests: **blocked pending staging**.

## Incomplete by design

Phase 1 does not claim theme, exchange-rate or OVH business-feature parity. The schemas and security infrastructure are functional foundations for those phases. No network provider, price mutation or OVH lifecycle call is enabled yet.

## Staging acceptance checklist

Activate in documented order; capture before/after schemas; verify repeat activation is a no-op; verify deactivation retains rows; test allowed/denied admin roles and CSRF failure; write a synthetic log containing fake secrets and verify redaction; verify no legacy row count changes; then restore the staging backup.
