# RDP server module — independent secure rebuild work item

Status: **NOT IMPLEMENTED — SECURITY/API/LICENSING REVIEW REQUIRED**

The supplied root archive `RDP.zip` is retained as an inactive review artifact. None of its files are copied to `modules/servers`, loaded, activated, or referenced at runtime. Its apparent module layout is not authorization to use or redistribute it.

## Supplied files held inactive

- `RDP.php`
- `hooks.php`
- `lib/Helper.php`, `lib/index.php`
- `templates/error.tpl`, `templates/overview.tpl`
- `assets/index.php`
- `assets/css/admin-style.css`, `assets/css/client-style.css`, `assets/css/index.php`
- `assets/images/netlink.webp`
- `assets/js/admin-script.js`, `assets/js/client-script.js`, `assets/js/index.php`

## Preconditions for an independent implementation

1. Document API ownership, authorization, licensing, supported endpoints, schemas, permissions, and test resources.
2. Use allowlisted HTTPS destinations, TLS verification, bounded connect/response timeouts, response-size limits, and no unrestricted redirect following.
3. Store secrets only in WHMCS-protected encrypted configuration. Never expose passwords/tokens in HTML, JavaScript, URLs, logs, email, source, evidence, client responses, or unsafe WHMCS fields.
4. Validate every identifier, product, service ownership relationship, state, and response schema.
5. Implement PHP 7.4/8.2-compatible authenticated API transport with redacted structured errors and correlation IDs.
6. Implement authorization, CSRF where applicable, customer ownership checks, explicit destructive confirmation, redacted audit events, persistent idempotency, operation ledger, locking, and reconciliation.
7. Implement and verify real suspend, unsuspend, terminate, status, renewal, provisioning, and failure behavior. Never return success without verified evidence.
8. Treat lost/ambiguous mutation responses as reconciliation required; never blindly repeat a potentially successful remote mutation.
9. Add success/failure/timeout/ambiguity/concurrency/authorization/ownership/redaction tests for every lifecycle operation.
10. Complete real non-production staging tests before activation or any runtime claim.

The supplied implementation must not be installed unchanged because it exposes credentials to templates/JavaScript, logs raw diagnostics, directly mutates WHMCS records, follows redirects, has unsafe timeout behavior, lacks reconciliation/idempotency, reports unverified lifecycle success, and includes PHP syntax incompatible with PHP 7.4.
