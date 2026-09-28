# CloudHost247 Secure RDP server module

Status: **IMPLEMENTED — SOURCE/MOCK VERIFIED; API AUTHORIZATION AND RUNTIME BLOCKED — STAGING REQUIRED**

The supplied `RDP.zip` remains byte-for-byte unchanged as an inactive functional reference. Its code was not copied or activated. CloudHost247 independently implemented `modules/servers/RDP/` with PHP 7.4/8.2-compatible source, namespaced persistence, authenticated provider transport, idempotency, reconciliation, ownership checks and secret-safe templates.

## Provider API contract and authorization prerequisites

Activation is prohibited until the provider documents and authorizes the API, licence/redistribution position, test account, endpoint host, product identifiers, permissions, lifecycle semantics and response schemas. Configure the exact provider hostname in the WHMCS server hostname field, the provider bearer token in WHMCS's encrypted Access Hash field, and the same hostname in server-side `CH247_RDP_ALLOWED_HOSTS`. HTTPS is mandatory. No endpoint is hard-coded.

Expected API contract:

- `GET /me` — authenticated connection test.
- `POST /services` — create using `product_id`, `client_reference`, and `Idempotency-Key`.
- `GET /services/{reference}` — verified safe service state.
- `POST /services/{reference}/suspend`
- `POST /services/{reference}/unsuspend`
- `POST /services/{reference}/terminate`

Mutation responses must provide an allowlisted status and provider `operation_id`; creation must provide a validated service ID and reach `active` before WHMCS receives success. Unknown, timeout, malformed, HTTP 5xx, or inconsistent mutation outcomes enter reconciliation/intervention rather than being retried blindly.

## Security model

- Bearer token remains server-side; it is never placed in URLs, bodies, client output, ledger evidence or logs.
- Endpoint must be an explicitly allowlisted HTTPS origin with no URL credentials, query or fragment.
- TLS peer/host verification is enabled; redirects are disabled; connect/total timeouts are 5/20 seconds; responses are capped at 1 MiB.
- Only GET requests may retry once. Mutations never automatically retry after transport uncertainty.
- Provider response fields are schema validated and reduced to safe service metadata.
- No RDP password is generated, accepted, stored, emailed or displayed. Access recovery requires an independently designed provider-authorized secure delivery channel.
- Client overview validates authenticated WHMCS user and binding ownership. Lifecycle entry points remain WHMCS server-module/admin operations.
- Customer errors contain only a safe message and correlation ID. No raw response, exception, stack, path or secret is exposed.
- No WHMCS core table is directly written by the module.

## Persistence, idempotency and reconciliation

Migration `cloudhost247_rdp:1.0.0` creates only:

- `mod_cloudhost247_rdp_operations` — operation ID, idempotency key, safe provider reference/status, timestamps and sanitized error code.
- `mod_cloudhost247_rdp_services` — WHMCS/client binding, unique provider service ID, verified state and allowlisted safe details.

Create uses a stable service idempotency key. Lifecycle keys include the last verified binding generation, preventing duplicate retries while permitting a later legitimate state transition. Completed duplicates are no-ops; running or uncertain duplicates require reconciliation. Read-only reconciliation compares local and provider state and reports mismatch without performing a mutation.

## WHMCS configuration and flows

1. Install/activate CloudHost247 Foundation first so the shared migration repository, audit and safe-error services exist.
2. Add a WHMCS server using module `RDP`, exact authorized hostname, HTTPS port if nonstandard, and encrypted Access Hash token.
3. Set the exact provider product ID in product module settings.
4. Test connection and permissions before assigning disposable staging services.
5. Create, suspend, unsuspend and terminate return success only for the exact confirmed provider state.
6. Client overview displays only status, hostname, username, IP, location, product and last verification; unknown values show `NOT VERIFIED`.

## Failure states

- `failed`: provider explicitly rejected the operation; administrator may diagnose before a deliberate new action.
- `reconciliation_required`: mutation may have reached provider or state is not confirmed; no automatic retry.
- `intervention_required`: internal/provider state cannot safely be classified.
- `completed`: provider returned and schema validation confirmed the exact expected state.

## Verification status

PHP behavior/mock tests cover success/failure for create, suspend, unsuspend and terminate; timeout ambiguity; duplicate create prevention; ownership rejection; reconciliation mismatch; malformed JSON; HTTPS/host allowlist; redirect rejection; and credential placement. Real API authentication, licensing, provisioning, lifecycle effects, concurrency, WHMCS UI and migration execution remain **BLOCKED — STAGING REQUIRED**. The module must remain inactive until those checks pass with disposable resources.
