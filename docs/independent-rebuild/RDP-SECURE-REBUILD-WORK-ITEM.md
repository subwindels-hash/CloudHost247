# CloudHost247 Secure RDP server module

Status: **SUPERSEDED IN THE TREE 2026-10-02 — the module path now holds the vendor archive's code and this rebuild is present but inert. API AUTHORIZATION AND RUNTIME BLOCKED — STAGING REQUIRED**

> **2026-10-02 — the vendor archive was extracted over this module, at the owner's explicit direction, and the two sentences that follow this note are no longer the state of the tree.** `RDP.zip` — SHA-256 `89bf89129458032ffe9efff4000f5c695d0534cc05e785b3a2602ec9784c5aa2`, the hash `tests/security/test_archive_integration.py` pins — was extracted into `modules/servers/RDP/` and then deleted from the tree. Three files were overwritten (`RDP.php`, `templates/error.tpl`, `templates/overview.tpl`) and eleven vendor files were added (`hooks.php`, `lib/Helper.php`, admin and client CSS and JS, four `index.php` guards, `assets/images/netlink.webp`). The rebuild's own ten files were left in place and are inert: the vendor entry point requires none of them, so `bootstrap.php`, `lib/Api/*`, `lib/Contracts/*`, `lib/Operations/*`, `migrations/V100.php` and `assets/css/client.css` are never loaded and the `cloudhost247_rdp:1.0.0` migration is never run.
>
> **What the module now active does, where it differs from the model documented below** (all of it readable in the extracted files, cited so it can be checked rather than trusted):
>
> - One hard-coded provider endpoint, `https://www.rdparena.com/payments/resellerapi.php` (`lib/Helper.php:29`). No allowlist, no `CH247_RDP_ALLOWED_HOSTS`, no configuration path.
> - Transport: `CURLOPT_TIMEOUT, 10000` with a comment claiming seconds (`lib/Helper.php:164`), `CURLOPT_FOLLOWLOCATION, 1` (`:165`), no `CURLOPT_SSL_VERIFYPEER`/`VERIFYHOST` set anywhere, and no response size cap. The rebuild set 5/20-second bounds, disabled redirects, verified peer and host, and capped responses at 1 MiB (`lib/Api/ProviderClient.php:16`).
> - Authentication: a `Cra-Token` header from `$params['serveraccesshash']`, falling back to a direct `Capsule::table('tblservers')->where('type','RDP')->value('accesshash')` read (`lib/Helper.php:27`, `:289`) — a raw column read, which returns the stored value rather than WHMCS's decrypted one.
> - RDP passwords are handled: base64-decoded from the provider response, packed into `customvars`, rendered in the client area behind a show/hide toggle whose `data-password` attribute carries the value (`RDP.php:88`, `:97`, `:222`, `:242`, `:300-304`), and emailed in clear text through a `tblemailtemplates` row the module inserts itself (`lib/Helper.php:259-264`, template "Welcome RDP Credentials Email", body includes `{$RDP_password}`).
> - WHMCS core tables are written directly: `tblcustomfields`, `tblcustomfieldsvalues` and `tblemailtemplates` (`lib/Helper.php:213-244`, `:259-260`).
> - `hooks.php` registers `AdminProductConfigFieldsSave`, so the module has an admin-area side effect on product configuration saves.
> - **PHP 8 only, and a parse error on PHP 7.4.** `RDP_ConfigOptions` uses named arguments — `trim(string: $stock->{'name '})`, and the same shape for `price ` and `inStockQuantity ` — which is PHP 8.0 syntax. On PHP 7.4, the version `scripts/release-candidate-check.sh` lints and the version the build notes name as a target (`docs/build-notes/dnschecker/BUILD.txt` records WHMCS 8.9.x on PHP 5.6–7.4), `php -l` reports a syntax error and WHMCS would hit a fatal include instead of loading the module. The vendor files are extracted byte-for-byte, so this is recorded rather than silently patched; `tests/rdp/test_static.py::test_vendor_php8_only_syntax_is_recorded_not_silent` fails if the syntax is ever changed without this paragraph being updated.
> - **The RDP password is written to a WHMCS core table in clear text.** `RDP_CreateAccount` runs `Capsule::table("tblhosting")->where("id",$params['serviceid'])->update(["username" => …, "password" => base64_decode($result['result'][0]->password)])` (`RDP.php`, in the create path). A direct Capsule write bypasses WHMCS's own encryption of that column, so the credential is stored as the provider sent it.
> - **Suspend, unsuspend and terminate are no-ops that report success.** `RDP_SuspendAccount`, `RDP_UnsuspendAccount` and `RDP_TerminateAccount` each `return true;` without constructing the helper or calling the provider, so WHMCS records a suspension or a termination that never happened at rdparena.com — a terminated service keeps running, and a suspended one stays reachable.
> - **The client template escapes nothing.** `templates/overview.tpl` contains no `|escape` filter at all and emits `data-password="{$encodedPassword}"`, so the provider's password value is interpolated into an HTML attribute unescaped; `assets/js/client-script.js` then reads that attribute and writes it into the page. The admin tab does escape, with `htmlspecialchars(…, ENT_QUOTES, "UTF-8")` in `RDP_AdminServicesTabFields`.
> - `RDP_TestConnection` can return an undefined `$success` and `$errorMsg` when the provider answers anything other than 200, and `RDP_ClientArea` leaves `$hostname` and `$status` undefined when the detail call fails.
> - No operation ledger, no idempotency key and no reconciliation state: a repeated `CreateAccount` after an uncertain outcome is not distinguishable from a first attempt.
>
> **Restoring the rebuild** is one command, because the overwritten files are still in git history: `git checkout f8df7de -- modules/servers/RDP/RDP.php modules/servers/RDP/templates/`, then delete the eleven added vendor files (`hooks.php`, `lib/Helper.php`, `lib/index.php`, `assets/index.php`, `assets/css/index.php`, `assets/js/index.php`, `assets/css/admin-style.css`, `assets/css/client-style.css`, `assets/js/admin-script.js`, `assets/js/client-script.js`, `assets/images/netlink.webp`). `tests/security/test_archive_integration.py` pins both states, so the gate reports which one the tree is in.
>
> **Licensing and provider authorization were prerequisites this extraction did not satisfy.** The activation rule below still stands as a requirement, not as a description of the tree: the provider has not documented and authorized the API, the licence/redistribution position of this third-party module is unrecorded, and no test account or endpoint allowlist exists. Nothing here has been run against a live provider.

The supplied `RDP.zip` remains byte-for-byte unchanged as an inactive functional reference. Its code was not copied or activated. CloudHost247 independently implemented `modules/servers/RDP/` with PHP 7.4/8.2-compatible source, namespaced persistence, authenticated provider transport, idempotency, reconciliation, ownership checks and secret-safe templates. *(Superseded 2026-10-02 by the extraction described above; kept as the record of the rebuild's design and of what restoring it means.)*

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
