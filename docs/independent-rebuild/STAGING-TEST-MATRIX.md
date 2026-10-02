# Executable staging test and evidence matrix

Every row starts **BLOCKED — STAGING REQUIRED**. Replace status only after execution on the recorded environment. Evidence must contain: test ID, UTC time, exact commit, WHMCS/PHP/database versions, administrator/test-client identity (non-sensitive ID only), action, expected result, actual result, PASS/FAIL/PARTIAL/BLOCKED, redacted logs/API evidence, screenshot path where applicable, before/after database impact, and cleanup/rollback result.

## Environment record

| Field | Value |
|---|---|
| Commit | |
| Staging hostname/System URL | |
| WHMCS exact version | |
| PHP/FPM and CLI versions | |
| Database/version/sql_mode | |
| Browser/device matrix | |
| OVH region/test-account label | |
| Backup IDs and restore proof | |
| Tester and UTC window | |

## WHMCS and client area

| ID | Test | Expected | Status |
|---|---|---|---|
| W-001 | Login/logout, valid and invalid credentials | Native WHMCS authentication/session behavior; no bypass | BLOCKED — STAGING REQUIRED |
| W-002 | Registration and email validation | Native validation/CSRF and expected account state | BLOCKED — STAGING REQUIRED |
| W-003 | Password reset request/token/change | Native expiry, one-use token and no account disclosure | BLOCKED — STAGING REQUIRED |
| W-004 | Client dashboard | Correct native counts/data and authorization | BLOCKED — STAGING REQUIRED |
| W-005 | Services and service details | Only owned services visible | BLOCKED — STAGING REQUIRED |
| W-006 | Domains and domain details | Only owned domains/actions visible | BLOCKED — STAGING REQUIRED |
| W-007 | Invoices, transactions and payment view | Values/status unchanged by theme | BLOCKED — STAGING REQUIRED |
| W-008 | Quotes | Supported quote list/view/accept behavior | BLOCKED — STAGING REQUIRED |
| W-009 | Tickets and knowledgebase | Ownership, submission CSRF, search/view | BLOCKED — STAGING REQUIRED |
| W-010 | Profile, contacts and payment methods | Native authorization/validation | BLOCKED — STAGING REQUIRED |
| W-011 | Product configuration | Options, cycles, totals and validation | BLOCKED — STAGING REQUIRED |
| W-012 | Checkout/test gateway/3DS path | Test-only order completes; no production gateway | BLOCKED — STAGING REQUIRED |

## Theme and CMS

| ID | Test | Expected | Status |
|---|---|---|---|
| T-001 | Homepage/settings | Branding, hero, announcement and CSS settings visibly apply | BLOCKED — STAGING REQUIRED |
| T-002 | Navigation/mobile navigation | Ordered/nested links, keyboard/touch behavior | BLOCKED — STAGING REQUIRED |
| T-003 | Pages/landing pages/publication | Published visible; drafts/unpublished return 404 | BLOCKED — STAGING REQUIRED |
| T-004 | Localized content and fallback | Selected locale overrides fields; missing translation uses base | BLOCKED — STAGING REQUIRED |
| T-005 | Safe preview | Sanitized preview renders without saving/publishing | BLOCKED — STAGING REQUIRED |
| T-006 | Banners/testimonials/sections/footer | Correct order/content and escaped plain fields | BLOCKED — STAGING REQUIRED |
| T-007 | SEO/Open Graph | Correct title/description/OG with escaped content | BLOCKED — STAGING REQUIRED |
| T-008 | Sitemap | XML-valid; only published CMS pages; correct staging URL | BLOCKED — STAGING REQUIRED |
| T-009 | 404 behavior | Unknown/unpublished slug gives HTTP 404 | BLOCKED — STAGING REQUIRED |
| T-010 | Responsive/a11y | 320/768/1024/1440 widths, no overflow; keyboard/focus/labels | BLOCKED — STAGING REQUIRED |

## Currency

| ID | Test | Expected | Status |
|---|---|---|---|
| C-001 | Provider connectivity and TLS | Valid rates or bounded redacted error | BLOCKED — STAGING REQUIRED |
| C-002 | Primary failure/fallback | Secondary used; warning and successful atomic run | BLOCKED — STAGING REQUIRED |
| C-003 | Manual update | Enabled current rates/history update transactionally | BLOCKED — STAGING REQUIRED |
| C-004 | Scheduled/CLI update and frequency | Due execution only; timestamps/logs correct | BLOCKED — STAGING REQUIRED |
| C-005 | Margin/precision/rounding/conversion | Matches independently calculated examples | BLOCKED — STAGING REQUIRED |
| C-006 | Malformed/missing provider symbol | Whole run fails; no partial rates | BLOCKED — STAGING REQUIRED |
| C-007 | Concurrent invocations/stale lock | One owner; second exits; stale lease recovers | BLOCKED — STAGING REQUIRED |
| C-008 | Financial-table invariant | Invoices/items/transactions/tblpricing checksums unchanged | BLOCKED — STAGING REQUIRED |

## OVH

| ID | Test | Expected | Status |
|---|---|---|---|
| O-001 | Credential validation and `/me` | Least-privilege auth succeeds; secrets absent from logs | BLOCKED — STAGING REQUIRED |
| O-002 | Catalog/normalization/source price | Raw retained; only returned fields normalized; ambiguous price not used | BLOCKED — STAGING REQUIRED |
| O-003 | Product/configurable-option mapping | Exact suggestions; explicit mapping; duplicates rejected | BLOCKED — STAGING REQUIRED |
| O-004 | Pricing preview/apply | Source/conversion/margin/rounding shown; explicit one-cycle update/audit | BLOCKED — STAGING REQUIRED |
| O-005 | Provision disposable service | Checkpointed cart/item/order; pending binding state | BLOCKED — STAGING REQUIRED |
| O-006 | Duplicate CreateAccount | No second cart/item/order | BLOCKED — STAGING REQUIRED |
| O-007 | Fail after cart/item and retry | Checkpoint resume or reconciliation stop; no duplicate | BLOCKED — STAGING REQUIRED |
| O-008 | Lost checkout response | `reconciliation_required`; unique cart match only; no blind checkout | BLOCKED — STAGING REQUIRED |
| O-009 | Order polling/service binding | Pending→completed, unique service ID bound once | BLOCKED — STAGING REQUIRED |
| O-010 | Existing-service search/preview/link | Read-only search; explicit confirmation/audit; duplicate rejected | BLOCKED — STAGING REQUIRED |
| O-011 | Status/details/IP and IPv6 | Correct normalized values and ownership | BLOCKED — STAGING REQUIRED |
| O-012 | Reboot and VPS start/stop | Supported test resource transitions; audited errors | BLOCKED — STAGING REQUIRED |
| O-013 | Suspend/unsuspend semantics | VPS stop/start only as documented; unsupported type rejected | BLOCKED — STAGING REQUIRED |
| O-014 | Reverse DNS set/delete | Supported block only; validation and explicit confirmation | BLOCKED — STAGING REQUIRED |
| O-015 | Read-only service sync/cron concurrency | Known bindings updated; unknown skipped; no destructive action | BLOCKED — STAGING REQUIRED |
| O-016 | Termination disposable resource | Explicit WHMCS action only; no sync termination | BLOCKED — STAGING REQUIRED |

## Security and rollback

| ID | Test | Expected | Status |
|---|---|---|---|
| S-001 | Addon roles and CloudHost247 capabilities | Unauthorized roles denied; allowed roles work | BLOCKED — STAGING REQUIRED |
| S-002 | CSRF/replayed/missing token | Every admin mutation rejected | BLOCKED — STAGING REQUIRED |
| S-003 | XSS/SQLi/SSRF/path payload corpus | Encoded/rejected; fixed endpoints; no query alteration | BLOCKED — STAGING REQUIRED |
| S-004 | Secret/log inspection | No app secret, consumer key, signature, DB/WHMCS credentials | BLOCKED — STAGING REQUIRED |
| S-005 | Migration idempotency and protected row counts | Second activation no-op; no protected deletion/corruption | BLOCKED — STAGING REQUIRED |
| S-006 | Full rollback rehearsal | Proven backup restores files/DB and stock theme operation | BLOCKED — STAGING REQUIRED |

## Per-test evidence template

```text
Test ID:
Status: PASS | FAIL | PARTIAL | BLOCKED
UTC timestamp:
Commit / environment versions:
Preconditions and sanitized record IDs:
Action performed:
Expected:
Actual:
Redacted logs/API evidence path:
Screenshot/video path:
Database before/after query and result:
Cleanup/rollback performed:
Defect/next step:
Tester:
```

## Release-candidate freeze procedure (2026-09-27)

Status: **SOURCE FOUNDATION COMPLETE → RELEASE CANDIDATE → STAGING PENDING**.

The mandatory staging comparison sequence is:

1. Deploy frozen baseline `3a9fbb9` to a positively identified non-production environment.
2. Prove backup restoration and record exact WHMCS, PHP, database, web-server, and extension versions.
3. Clear caches and execute the complete baseline matrix before configuring disposable OVH access.
4. Capture database, browser, cron, financial, client-area, and operation evidence.
5. Upgrade to the final release-candidate commit reported with this batch; do not substitute an unreviewed branch tip.
6. Execute ordered CloudHost247 migrations, repeat affected tests, and compare evidence to baseline.
7. Use only disposable least-privilege OVH resources. Never submit credentials through chat or commit them.

The CI-level `scripts/release-candidate-check.sh` verifies syntax, behavior tests, static/security tests, migration ordering/additive policy, preserved proprietary checksums, embedded-secret patterns, core-schema policy, and diff cleanliness on PHP 7.4 and 8.2. This is source evidence only. Real migrations, WHMCS integration, browser behavior, cron, provider updates, and OVH lifecycle operations remain **BLOCKED — STAGING REQUIRED**.

## Machine-readable evidence gates

Every test row must reference an artifact, UTC timestamp, exact commit, operator, and result. The acceptance generator requires real evidence sections for browser, accessibility, security, currency, OVH, provisioning/lifecycle, reconciliation, and CMS/theme. `NOT RUN`, absent evidence, a failed restore proof, or any unexplained financial/customer-table mutation produces `FAIL`. Static/mock CI is recorded separately and never satisfies a runtime row.

Capture financial snapshots immediately before and after every financial-impacting test. Changes require an explicit allowlist entry and non-empty reason in `approved-changes.json`; invoice, invoice-item, transaction, client-credit, service, and domain changes are unexpected unless the individual disposable test explicitly predicted them. Re-run the comparison after rollback as well.

## Post-freeze source completion batch

**IMPLEMENTED — SOURCE VERIFIED:** a WHMCS-native public hosting/VPS/dedicated catalog now reads only visible WHMCS products with CloudHost247 metadata marked `available` or `limited`, uses current WHMCS currency/pricing rows, presents verified specifications, and links into native WHMCS cart configuration. Missing prices and unknown service kinds fail safely as `NOT VERIFIED`. Client service presentation now includes the validated product kind. CMS localization has non-persistent draft preview with base fallback, and CMS administration includes bounded redacted audit history. Pricing preview evidence now displays current/proposed difference, conversion, margin, precision, rounding, component, cycle, correlation ID, and audit context. Shared safe errors expose only a correlation reference to customers and record bounded structured metadata without exception messages or traces.

**BLOCKED — STAGING REQUIRED:** WHMCS route/template resolution, real catalog prices, browser rendering, cart behavior, CMS runtime, translated preview rendering, administrator workflow, accessibility acceptance, migrations, currency/OVH calls, provisioning, lifecycle and reconciliation remain unverified. No visual drag-and-drop editor was added. No runtime PASS is claimed.

## Secure RDP source module

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** independent `modules/servers/RDP` implementation with allowlisted HTTPS provider client, encrypted WHMCS server-field token input, strict response schemas, 5/20-second network bounds, disabled redirects, 1 MiB response cap, namespaced `cloudhost247_rdp:1.0.0` migration, operation ledger, generation-aware idempotency, ownership checks, read-only reconciliation, redacted audit/error handling and secret-free responsive templates. **SUPERSEDED IN THE TREE 2026-10-02:** at the owner's explicit direction the vendor archive was extracted over this module path and then deleted, so `modules/servers/RDP/RDP.php`, `templates/error.tpl` and `templates/overview.tpl` are now the vendor RDP Arena files (hard-coded `https://www.rdparena.com/payments/resellerapi.php`, redirects followed, no TLS verification option set, no response cap, no idempotency ledger, RDP passwords displayed and emailed, direct writes to `tblcustomfields`/`tblcustomfieldsvalues`/`tblemailtemplates`), and the implementation described in this paragraph remains in the tree but inert — nothing loads `bootstrap.php`, `lib/Api/*`, `lib/Contracts/*`, `lib/Operations/*` or `migrations/V100.php`. It is what should be restored before any staging or production use; see `RDP-SECURE-REBUILD-WORK-ITEM.md` for the cited deltas and the one-command restore.

**BLOCKED — STAGING/API AUTHORIZATION REQUIRED:** provider ownership/licensing, endpoint contract, bearer-token authorization, product IDs, permissions, real create/suspend/unsuspend/terminate semantics, WHMCS module activation, migration execution, UI, concurrency and disposable lifecycle tests. The module must not be activated until these pass. Required migration ordering adds RDP `1.0.0` after the existing Core, Currency, Theme and OVH sequences.

## CloudHost247 Email Hosting — public page and provisioning module

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** CloudHost247 Email Hosting uses the independent WHMCS server module at `modules/servers/cloudhost247_email_hosting`; the WHMCS module ID is `cloudhost247_email_hosting` and no vendor identifier survives in the module source, schema, webhook headers, session keys or client-area form fields. It provides Professional Email, Microsoft Graph, and Google Workspace adapters behind one contract, a public `email-hosting.php` page reading only live WHMCS products/pricing for `servertype = cloudhost247_email_hosting`, a client-area overview with ownership + CSRF enforcement and DNS copy buttons, versioned schema with idempotency/reconciliation ledger, authenticated webhook endpoint, bounded cron, redacted structured logging, and 59 mock diagnostics in `tests/cloudhost247_email/run.php`.

**BLOCKED — STAGING / TENANT AUTHORIZATION REQUIRED:** every row below. Mock transport results never satisfy a runtime row.

| # | Test | Evidence required | Status |
|---|---|---|---|
| CH247E-01 | Module appears in *Servers → type* and saves credentials encrypted | WHMCS server list screenshot; `tblservers.password`/`accesshash` are ciphertext | NOT RUN |
| CH247E-02 | **Test connection** against a real Microsoft 365 tenant | Graph `/organization` + `/subscribedSkus` success; admin screenshot | NOT RUN |
| CH247E-03 | **Test connection** against a real Google Workspace tenant with domain-wide delegation | Token exchange success; `isAdmin` true for the delegated admin | NOT RUN |
| CH247E-04 | **Test connection** against the Professional Email provisioning API | `/plans` response; correct auth style | NOT RUN |
| CH247E-05 | Product configuration: provider/tier/SKU/usage location saved and read back | Product screenshot + `tblproducts.configoption1..8` | NOT RUN |
| CH247E-06 | Order → payment → approval → `CreateAccount` provisions exactly one mailbox | WHMCS module log, provider admin console, `mod_cloudhost247_email_hosting_accounts` row | NOT RUN |
| CH247E-07 | Licence availability refusal when the tenant has no free seat | No remote user created; WHMCS error text captured | NOT RUN |
| CH247E-08 | Licence assignment verified in the provider console | Microsoft `assignedLicenses` / Google licence assignment screenshot | NOT RUN |
| CH247E-09 | Duplicate/replayed `CreateAccount` creates no second account | `mod_cloudhost247_email_hosting_operations` single `succeeded` row; provider user count unchanged | NOT RUN |
| CH247E-10 | Suspend → sign-in blocked; Unsuspend → restored | Provider console + failed/successful sign-in evidence | NOT RUN |
| CH247E-11 | Password change succeeds (cloud-only tenant) and is refused with guidance on a federated tenant | Both outcomes captured | NOT RUN |
| CH247E-12 | Terminate releases the licence *then* deletes the user | Ordered API log; seat count returned to the pool | NOT RUN |
| CH247E-13 | Ownership: client B cannot view or act on client A's service | HTTP 200 with access-denied view; `clientarea.ownership_denied` log entry | NOT RUN |
| CH247E-14 | CSRF: POST without/with a stale token is refused | Captured request/response pair | NOT RUN |
| CH247E-15 | DNS records rendered from Graph for a real domain; values match the Microsoft 365 portal exactly | Side-by-side screenshots | NOT RUN |
| CH247E-16 | DNS copy / copy-all buttons work in Chrome, Firefox and mobile Safari | Browser evidence | NOT RUN |
| CH247E-17 | DNS verification only reports "verified" after the records resolve publicly | `dig` output + UI state before/after | NOT RUN |
| CH247E-18 | Webhook: valid HMAC accepted; tampered, stale and replayed events rejected | 4 request/response captures + `mod_cloudhost247_email_hosting_webhooks` rows | NOT RUN |
| CH247E-19 | Webhook: Google callback refused with 501 | Response capture | NOT RUN |
| CH247E-20 | Cron: `DailyCronJob`/`AfterCronJob` run bounded batches without overlapping | Two concurrent runs; lock row; log timings | NOT RUN |
| CH247E-21 | API failure/timeout after send marks `needs_reconcile` and the reconciler adopts or clears it | Injected timeout on staging; ledger + account transitions | NOT RUN |
| CH247E-22 | Secret redaction in live logs (WHMCS module log + `mod_cloudhost247_email_hosting_log`) | Log export grepped for secret material | NOT RUN |
| CH247E-23 | `email-hosting.php` renders real prices/availability in two currencies | Page screenshots + `tblpricing` rows | NOT RUN |
| CH247E-24 | "Get Started" reaches the correct WHMCS cart configuration and completes checkout | Order flow capture | NOT RUN |
| CH247E-25 | Page accessibility (landmarks, headings, focus, contrast) and responsive layout at 360/768/1440 | axe report + screenshots | NOT RUN |
| CH247E-26 | Existing hosting, OVH, currency, authentication, checkout and dashboard flows unchanged | Baseline regression matrix re-run | NOT RUN |
| CH247E-27 | Migrations apply cleanly on MySQL and MariaDB; re-run is a no-op | `cron.php migrate` output twice; schema diff | NOT RUN |
| CH247E-28 | Vendor-identifier rename migration: an installation still bound to the pre-rebrand module ID is moved to `cloudhost247_email_hosting` with every row preserved | `scripts/migrate-legacy-names-to-cloudhost247.sql` verification output (all MUST-BE-ZERO rows 0); before/after row counts for the eight renamed tables; `cron.php status` shows the same account totals; one provisioning action succeeds | NOT RUN |
| CH247E-29 | No The-Retired-Brand identifier is visible in the admin provisioning-module picker, server list, product module dropdown, module log or client area | Admin screenshots of each surface; `scripts/branding-audit.py` output | NOT RUN |

Required migration ordering: `cloudhost247_email_hosting 1.0.0` after the existing Core, Currency, Theme, OVH and RDP sequences, and after `scripts/migrate-legacy-names-to-cloudhost247.sql` has renamed any installation that was still bound to the vendor module ID (see CH247E-28). The module creates only `mod_cloudhost247_email_hosting_*` tables and never writes to WHMCS core tables other than the documented `tblhosting.password` update for a generated mailbox password.
