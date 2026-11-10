# Phase 8 — Granular Module Verification (2026-11-09)

Independent file-by-file inspection of the four highest-risk feature surfaces, performed against the
working tree immediately after the Phase-7 baseline (`4e0405a4`). Every claim is backed by a reading
of the source, not by its filename.

## Phase 8 Findings Register

| ID | Area | File(s) read (actual) | Result |
|---|---|---|---|
| A1 | cPanel / Control panels | `src/control-panels/adapters/cpanel.ts`, **`src/deployments/adapters/cpanel-adapter.ts` (488L read full)**, **`src/deployments/adapters/cpanel-client.ts` (WHM API 1 token-auth + UAPI confirmed)**, `src/routes/control-panels.ts`, `src/db/control-panels.ts` | **Genuine.** WHM API 1 token-auth client (`createacct`/`suspendacct`/`unsuspendacct`/`terminateacct`/`listaccts`) + UAPI (Mysql/Fileman/backup). Adapter honest: `restartApplication` and `applicationLogs` throw `UnsupportedOperationError` instead of faking success; `runHealthcheck` returns `health: 'unknown'`; `restoreBackup` validates archive path under `/home/<user>/`; simulation mode is explicit and logged. |
| A2 | Inbox | `src/routes/inbox.ts` (321L), **`src/inbox/inbox-service.ts` (866L read — connectors, scrubChannelConfig, refreshChannelHealth, conversations, labels)** | **Genuine.** Support-conversations product (not mailboxes). Connector registry `CHANNEL_CONNECTORS` is honest (`isConfigured` checks, non-secret scrub via `scrubChannelConfig` regex on secret/token/password/key). Customer reads enforce `visibility` in SQL. Outbound relay remains externally gated (Phase 6). |
| A3 | SSL | **`src/routes/ssl.ts` (fixed)**, `src/db/ssl.ts`, migration 0045 CHECK constraints | **DEFECT FOUND + FIXED (F8-SSL-1)** — see below. |
| A4 | PHP verticals (phoneservices + email) | `modules/addons/phoneservices/lib/API/Controllers` (6 controllers), `Middleware/AuthMiddleware.php`, `Core/` (Config/Crypto/Database/HttpClient/Logger/Security/Provisioning/Router), **`Providers/` (Abstract/Airalo/Truphone/Twilio/Vonage/Sendgrid/WhatsApp/Factory)**, **`api/webhooks/{twilio,vonage,whatsapp,sendgrid}.php`**, **`lib/Services/Cron.php` (reconciliation)**, `modules/servers/cloudhost247_email{,_hosting}` (38 PHP, all WHMCS lifecycle hooks) | **Genuine.** Twilio webhook verifies `X-Twilio-Signature` via `validateWebhookSignature` (403 on bad sig); Vonage/WhatsApp/SendGrid all signature-check. `Cron.php` performs real provider reconciliation (`calls_reconciled`/`messages_reconciled`). Email module implements `CreateAccount/SuspendAccount/UnsuspendAccount/TerminateAccount/ChangePassword/TestConnection/syncAccountStatus` wired to named M365/Google/Professional providers. Placeholders = vendored ModulesGarden Core TODOs + HTML form `placeholder=` attributes only (not dead code). |

## F8-SSL-1 — SSL fabrication defect (P2, FIXED, suite green)

**What was found.** `src/routes/ssl.ts` POST `/ssl/certificates` accepted any blob as
`certificatePem` and marked the row `ISSUED` with `expiresAt = now()+90d` **without parsing the
PEM**. POST `/ssl/certificates/:id/renew` unconditionally set `status='ISSUED'` + `expires_at =
now()+90d` with no CA/DV/new material — a fabricated renewal.

**Fix (in `src/routes/ssl.ts`, honest within migration 0045 CHECK statuses
PENDING/VALIDATING/ISSUED/EXPIRED/FAILED/REVOKED):**
1. Create-with-Pem now parses the blob with the Node platform `X509Certificate` parser — an
   unparseable blob is rejected with `ValidationError`; expiry is taken from the certificate's own
   `validTo`, never fabricated; a pasted cert defaults to provenance `CUSTOM` (it came from the
   customer, not the default issuer) unless stated otherwise.
2. Renew can no longer fabricate issuance: it now requires issued material (`certificate_pem`
   present and status ISSUED/EXPIRED, else 409), and marks the certificate **VALIDATING** —
   truthful re-validation-pending — never ISSUED with a synthetic expiry, until a real CA/ACME
   adapter completes issuance and records the certificate's own `notAfter`. Audit action renamed
   `SSL_CERTIFICATE_RENEWAL_REQUESTED`.

## Verification run-sets (this tree)

| Suite | Result |
|---|---|
| `tests/integration/ssl-firewall-api.test.ts` | **3/3 PASS** (post-fix) |
| `tests/integration/control-panels-api.test.ts` | **18/18 PASS** |
| `tests/unit/control-panel-adapters.test.ts` | **6/6 PASS** |
| `tests/integration/platform-services-api.test.ts` | PASS (incl. inbox-path coverage) |
| `tests/integration/contact-api.test.ts` (inbox intake) | PASS |
| `tests/unit/deployment-adapter-operations.test.ts` | 46/46 PASS (2-file group incl. email-trace) |
| `tsc --noEmit` (whole API) | exit 0 |
| **Aggregate across the four areas** | **77/77 PASS** |

## Constraints

- PHP verticals are not executed by the Node test runner; verified statically (source read +
  lifecycle-hook presence). Runtime coverage of those requires a WHMCS license (P1-1).
- No external provider endpoint was contacted (Phase-6 §7 allowlist result stands).
- Prepared-but-not-executed tests are still not marked passed anywhere.
