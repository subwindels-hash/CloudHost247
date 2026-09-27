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
