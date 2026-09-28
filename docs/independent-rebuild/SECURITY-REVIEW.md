# Independent rebuild security review

Date: 2026-09-27. Scope: CloudHost247 Foundation, Theme/CMS, Currency, OVH addon/server module, custom routes, cron and migrations. This is source/mock verified only.

| Risk | Control / finding | Status |
|---|---|---|
| Authentication bypass | Admin controllers call `AdminGuard::requireAdmin`; client routes bootstrap native WHMCS | Automated/static verified; runtime blocked |
| Authorization | WHMCS addon role access plus authenticated context; destructive service actions use WHMCS server callbacks | Partial: role behavior needs staging; granular custom capability UI remains |
| CSRF | Every admin POST controller calls `requirePostToken`; forms include WHMCS token | Static verified; runtime blocked |
| SQL injection | Capsule query builder and allowlisted column/cycle values; no raw dynamic SQL in owned source | Static verified |
| XSS | Admin/client plain fields escaped; CMS formatted body allowlisted; preview JSON escaped | Static verified; browser blocked |
| SSRF | OVH regions map to three hard-coded HTTPS endpoints; provider URLs fixed; API paths validated | Static verified |
| Redirect abuse | OVH/currency cURL redirects disabled; CMS URLs local-or-HTTPS validated | Static verified |
| Path traversal | OVH paths reject `..`/newlines; autoloaders map fixed namespaces | Unit/static verified |
| Command injection | No shell/process/eval/unserialize calls in owned modules | Static verified |
| Secret leakage | OVH secrets stay in encrypted WHMCS server fields; headers are not logged; recursive redactor | Unit/static verified; live logs blocked |
| Unsafe deserialization | JSON only, shape checks, no PHP `unserialize` | Static verified |
| API retries | OVH retries safe GET only; mutations are not automatically retried; ambiguous transport failures require reconciliation | Mock/static verified |
| Race/duplicates | Database leases, unique idempotency keys, cart/item checkpoints, uncertain mutation state | Static verified; concurrent DB test blocked |
| Unsafe financial writes | Currency writes current `tblcurrencies.rate` only. OVH pricing requires saved preview plus explicit confirmation and audits one allowlisted cycle. No invoice/transaction writes | Static verified; DB runtime blocked |
| Destructive synchronization | Unknown services skipped; sync never terminates or reassigns | Static verified |
| File operations | No uploads, archive extraction, dynamic includes, writes, deletes or permission changes in owned runtime | Static verified |
| Credential repository scan | No private-key markers or common cloud access-key forms in owned source | Static verified |
| Migrations | Namespaced tables, idempotent version ledger, no down/drop path | Static verified; MySQL/MariaDB blocked |

## Residual risks

* WHMCS internals (`decrypt`, server parameters, menu hooks and CSRF behavior) require the exact staging version.
* OVH API response fields/order semantics vary by region/product. Unknown responses stop or require intervention rather than guessing.
* Product-price application changes the current global WHMCS product price and can affect future renewals. It requires explicit confirmation and does not modify generated invoices.
* CMS sanitizer is an allowlist but should be browser-tested with the site's CSP and parent theme.
* Termination must be tested only on a disposable service. Synchronization never calls it.
* Real least-privilege consumer-key rules, rate limits, timeout ambiguity and log redaction need staging inspection.

No production-readiness claim is made.

## Authorization and staging-evidence update

CloudHost247 now layers optional per-operation role capabilities over WHMCS addon-role access. No policy means normal WHMCS addon authorization; a configured policy restricts the capability to explicit WHMCS role IDs. Theme content/settings, currency settings/rate execution, and OVH settings/operations/confirmed changes call this guard. Runtime role/session behavior remains **BLOCKED — STAGING REQUIRED**.

Read-only staging scripts require an explicit `CH247_STAGING_CONFIRM=YES`, reject web execution, output no row data or secrets, and provide environment metadata plus deterministic hashes for protected financial tables. Source/static findings remain IMPLEMENTED; browser/database/network assertions remain BLOCKED.

## Source management layer update (2026-09-27)

**Project state: SOURCE DEVELOPMENT → STAGING PENDING.** CloudHost247 now includes additive source foundations for confirmed hosting-product metadata, pricing comparison evidence, redacted searchable audit events, currency policy administration, OVH operational filtering/reconciliation evidence, safe customer service states, and audited CMS mutations. WHMCS remains authoritative for products, pricing, billing, ownership, and authentication.

- **IMPLEMENTED (source):** CSRF/role checks, explicit confirmation for consequential writes, namespaced metadata, current-versus-proposed pricing evidence, one-use price previews with stale-price rejection, audit filtering/pagination, bounded operational queries, reconciliation guidance that does not automatically repeat uncertain mutations, localization/preview fallback, output escaping, and secret redaction.
- **PARTIAL:** Product specifications require runtime UI validation; operational next-sync/rate-limit visibility depends on persisted provider evidence; customer lifecycle buttons remain limited to operations already authorized by the server module; visual presentation needs browser evidence.
- **BLOCKED — STAGING REQUIRED:** real migrations/database transactions, WHMCS hooks and client area, browser/accessibility rendering, cron, currency HTTP providers, OVH authentication/API calls, provisioning and lifecycle operations.
- **NOT IMPLEMENTED — API/PRODUCT DEPENDENCY:** provider capabilities not exposed by an authenticated OVH product/API are not guessed; unsafe mutation retry is intentionally unavailable.

Migration ordering is core `1.1.0`, currency `1.0.0 → 1.1.0`, theme `1.0.0 → 1.1.0`, and OVH `1.0.0 → 1.1.0 → 1.2.0 → 1.3.0 → 1.4.0 → 1.5.0`. All migrations are additive/idempotent and retain data on module deactivation. No WHMCS core schema is altered. Before upgrade, back up the database; rollback means restoring that backup and the prior source commit because additive tables/columns are deliberately retained.

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

## Post-freeze source completion batch

**IMPLEMENTED — SOURCE VERIFIED:** a WHMCS-native public hosting/VPS/dedicated catalog now reads only visible WHMCS products with CloudHost247 metadata marked `available` or `limited`, uses current WHMCS currency/pricing rows, presents verified specifications, and links into native WHMCS cart configuration. Missing prices and unknown service kinds fail safely as `NOT VERIFIED`. Client service presentation now includes the validated product kind. CMS localization has non-persistent draft preview with base fallback, and CMS administration includes bounded redacted audit history. Pricing preview evidence now displays current/proposed difference, conversion, margin, precision, rounding, component, cycle, correlation ID, and audit context. Shared safe errors expose only a correlation reference to customers and record bounded structured metadata without exception messages or traces.

**BLOCKED — STAGING REQUIRED:** WHMCS route/template resolution, real catalog prices, browser rendering, cart behavior, CMS runtime, translated preview rendering, administrator workflow, accessibility acceptance, migrations, currency/OVH calls, provisioning, lifecycle and reconciliation remain unverified. No visual drag-and-drop editor was added. No runtime PASS is claimed.

## Secure RDP source module

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** independent `modules/servers/RDP` implementation with allowlisted HTTPS provider client, encrypted WHMCS server-field token input, strict response schemas, 5/20-second network bounds, disabled redirects, 1 MiB response cap, namespaced `cloudhost247_rdp:1.0.0` migration, operation ledger, generation-aware idempotency, ownership checks, read-only reconciliation, redacted audit/error handling and secret-free responsive templates. No code from `RDP.zip` was copied; the archive remains unchanged and inactive.

**BLOCKED — STAGING/API AUTHORIZATION REQUIRED:** provider ownership/licensing, endpoint contract, bearer-token authorization, product IDs, permissions, real create/suspend/unsuspend/terminate semantics, WHMCS module activation, migration execution, UI, concurrency and disposable lifecycle tests. The module must not be activated until these pass. Required migration ordering adds RDP `1.0.0` after the existing Core, Currency, Theme and OVH sequences.

## Central API & Integrations centre

Full detail: [API-INTEGRATIONS.md](API-INTEGRATIONS.md). Repository-wide credential audit: [API-INVENTORY-AUDIT.md](API-INVENTORY-AUDIT.md).

| Risk | Control | Status |
|---|---|---|
| Credential storage | AES-256-GCM envelope per secret, 12-byte random IV, AAD bound to `integration id \| field key \| master-key fingerprint`; master key only from `CH247_INTEGRATIONS_KEY` / `$ch247_integrations_key`, stretched with HKDF-SHA256; no fallback key, fails closed | Unit/static verified; MySQL runtime blocked |
| Credential exposure | No secret is rendered to HTML, placed in a URL or query string, written to a log, or returned by a test; UI shows `••••••••••••` plus a keyed fingerprint prefix; admin screens emit no JavaScript; `Redactor` scrubs URLs and auth/cookie/token headers | Unit/static verified |
| Accidental credential loss | Blank credential inputs keep the stored value (`KEEP_EXISTING`); only an explicitly typed replacement rotates a secret; every rotation is audited by field name, never by value | Unit/static verified |
| SSRF via administrator endpoints | `UrlGuard::normalizeBase` enforces HTTPS, ≤512 chars, no userinfo/query/fragment/traversal/whitespace, per-provider host and port allowlists, and blocks private/loopback/link-local/reserved literals unless `CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS` is set; transport disables redirects, verifies peer and host, caps the body at 1 MiB | Unit/static verified |
| Information disclosure from connection tests | `ConnectionTester` maps every outcome to one of ten fixed classifications; no provider body, header, credential, exception message or trace is returned, stored or logged; a `200 OK` with a negative payload is a failure | Unit/static verified; live providers blocked |
| Fabricated health state | Dashboard renders only stored `status` / `last_checked_at` / `last_success_at` / `last_failure_at`; new and rotated integrations read `NOT VERIFIED` until a real test succeeds | Unit/static verified |
| Authorization | `AdminGuard::requireAdmin` plus eight discrete capabilities (`integrations.view/create/edit/rotate/toggle/test/delete/endpoint`) resolved through the Core capability policy | Static verified; role runtime blocked |
| CSRF | Every mutating submission calls `AdminGuard::requirePostToken` | Static verified |
| Test/production mixing | `(provider, environment)` is unique; the active environment comes from `CH247_PLATFORM_ENVIRONMENT` server-side only; production save/enable/rotate/test require a per-submission confirmation; declarative credential rules reject `sk_test_` in production, `sk_live_` outside it, and the equivalent Onfido `api_live` / `api_sandbox` rules; PayPal resolves distinct sandbox and live hosts | Unit/static verified |
| Unsafe failure handling | `IntegrationManager::client()` throws a controlled `IntegrationException` with a result code and correlation id instead of degrading to an unconfigured default; each failure writes a sanitized `runtime_failure` event; no fake success and no silent continue | Unit/static verified |
| Hard-coded credentials and endpoints | Repository-wide sweeps for credential literals, private keys and cloud access keys are now part of the release gate (`tests/integrations/test_static.py`). Owned code is clean. Two hard-coded secrets and one hard-coded third-party endpoint remain in manifest-protected vendor code — see API-INVENTORY-AUDIT.md §4.1 | Static verified; vendor remediation outstanding |
| Duplicate API configuration | The LTE proxy's four configuration builders collapsed to one; its hard-coded `api.cloudhost247.com` default removed everywhere; RDP, OVH and currency resolve endpoints through the registry | Static verified |

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** `modules/addons/cloudhost247_integrations` provides one Super Admin centre for every platform API: a provider registry of 27 real providers across RDP, hosting/provisioning, WHM/cPanel, registrars, DNS, edge, payments, email/SMTP, SMS, WhatsApp, Telegram, notifications, AI/LLM, exchange rates, storage, monitoring, KYC, network and SMM; per-provider field sets; an encrypted credential vault; environment-separated configuration; server-side connection testing with sanitized classifications; a real-state health dashboard; a sanitized event history; and an additive `cloudhost247_integrations:1.0.0` migration. RDP, OVH, the LTE proxy and the currency providers now resolve their endpoints and credentials through it, each with a documented legacy fallback. 99 PHP behavioural assertions (`tests/integrations/run.php`) and 29 static-policy assertions (`tests/integrations/test_static.py`) run on PHP 7.4 and 8.2 in the release gate.

**BLOCKED — STAGING / PROVIDER AUTHORIZATION REQUIRED:** real provider credentials, live connection-test outcomes per provider, MySQL migration execution, WHMCS role behaviour, browser rendering, cron scheduling, OpenSSL AES-256-GCM availability on the target host, and the end-to-end migration of each dependent module off its legacy credential source. No integration should be enabled in production until its connection test reports `Connected successfully` on staging. Required migration ordering adds Integrations `1.0.0` and OVH `1.6.0`.

## Super Admin Module Manager

Full detail: [MODULE-MANAGER.md](MODULE-MANAGER.md).

| Risk | Control | Status |
|---|---|---|
| Arbitrary code execution from an uploaded package | Nothing in the package is included, evaluated or shelled out to. `module.json` is parsed with `json_decode` and validated as data; there is no installer hook, post-install script or serialized payload. Unknown manifest keys are recorded and displayed as ignored, never acted on | Unit/static verified |
| Zip-slip, absolute paths, symlink escape | Entry names rejected on inspection (`../`, absolute, drive-letter, backslash, null byte, control characters); the destination is re-derived through `Paths::containedPath()` and re-verified per entry immediately before the write; symlinked destinations and parents are refused; `ZipArchive::extractTo()` is never called | Unit/static verified |
| Permission and ownership manipulation | setuid/setgid/sticky and any executable bit are rejected on inspection; every extracted file is written `0644` regardless of the mode stored in the archive | Unit verified |
| Malicious archive structure | Caps on entries (3000), uncompressed total (128 MiB), single entry (32 MiB), compression ratio (200:1), path length (200) and depth (12); duplicates, encrypted entries, devices/FIFOs and control files (`.htaccess`, `.user.ini`, `web.config`, `.git/`, `.env`, `node_modules/`) rejected; executable, binary, script, key and config file types are not installable | Unit verified |
| Unsafe destination | The install path is derived from the validated module type plus module id (`modules/<type>/<id>`); a package cannot name its own destination and platform ids are reserved | Unit verified |
| Upload abuse | `is_uploaded_file`, PHP upload-status mapping, `.zip` name check, 128 B–32 MiB size window (`CH247_MODULE_MAX_UPLOAD_BYTES`), ZIP signature bytes, `finfo` MIME allowlist, SHA-256 of the received bytes recorded against every later event | Unit verified |
| Silent overwrite / unintended downgrade | Existing version vs uploaded version is shown; the action becomes update, downgrade or reinstall; a downgrade requires a second explicit confirmation; changing an installed module's type is blocked | Unit verified |
| Partially installed module left active | Backup directory + `installation.json` snapshot before any write; extract → verify entry point and declared health files → register → commit; any failure rolls back, restores the previous version and raises `rollback_performed`. Installs are never auto-enabled | Unit verified |
| Undetected tampering after install | Per-file SHA-256 manifest recorded at install; `Verify` re-hashes on demand and after every install; states are `healthy / modified / missing_files / not_installed` | Unit verified |
| Privilege abuse | Seven capabilities (`modules.view/upload/install/update/toggle/uninstall/configure`) enforced per operation via `AdminGuard`, seeded Super-Admin-only at activation because the foundation default is permissive; the UI hides actions the role does not hold | Unit/static verified; role runtime blocked |
| CSRF and forged operations | Every mutating submission passes `AdminGuard::requirePostToken`; destructive actions need explicit confirmation, and uninstall additionally requires the module id to be typed | Unit/static verified |
| Data destruction | Uninstall removes only the files recorded in the installation manifest, never drops a declared table and never deletes customer or service data; disabling deletes nothing; dependent modules block disable and uninstall | Unit verified |
| Credential leakage | A manifest may not declare secret configuration fields — credentials must be declared as integrations and are stored in the encrypted API & Integrations vault; module logs record checksum, versions, admin id and peer IP only | Unit/static verified |
| Fabricated status | Every status is read from the database or the filesystem; storage availability, zip availability, health and integration configuration all report their real state | Unit/static verified |
| Package storage exposure | Storage resolved from `CH247_MODULE_STORAGE` / `$ch247_module_storage` / `$attachments_dir`, created `0700` with `.htaccess` deny rules, packages named by checksum; if the only writable path is inside the web root the page says so | Unit verified |

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** `modules/addons/cloudhost247_modules` provides the Super Admin Modules page: upload with full validation, pre-extraction archive inspection, manifest validation, live compatibility and dependency checks, an installation preview requiring confirmation, transactional installation with backup and rollback, per-file checksum registration, enable/disable with dependency protection, impact-scoped uninstall, health verification, a sanitized module log, a platform audit trail, and an additive `cloudhost247_modules:1.0.0` migration. Declared module integrations register into the central API & Integrations centre so credentials are vaulted centrally. 196 PHP behavioural assertions (`tests/modules/run.php`) and 29 static-policy assertions (`tests/modules/test_static.py`) run on PHP 7.4 and 8.2 in the release gate.

**BLOCKED — STAGING REQUIRED:** MySQL migration execution, WHMCS addon activation, real administrator role behaviour, browser rendering of the admin screens, real filesystem permissions and ownership on the target host, and an end-to-end install of a real third-party package. No module should be enabled in production until its installation preview, install log and health check have been reviewed on staging. Required migration ordering adds Module Manager `1.0.0`.

## Super Admin Website Builder

Full detail: [WEBSITE-BUILDER.md](WEBSITE-BUILDER.md).

| Risk | Control | Status |
|---|---|---|
| Script injection into a published page | There is no raw-HTML and no script widget in the 37-entry catalogue. Rich text passes `HtmlSanitizer` (tag/attribute allowlist; scripted elements are removed with their contents before `strip_tags`); every other value is escaped at render; URLs pass `UrlPolicy` | Unit/static verified |
| Custom JavaScript / CSS abuse by an ordinary admin | Custom CSS is a PRIVILEGED capability (`builder.css`), separate from `builder.pages`; CSS passes `CssSanitizer`; the builder never accepts admin-supplied JavaScript | Unit/static verified |
| Unpublished content reaching the internet | `saveDraft()` never writes `published_json`; `unpublish()` nulls it; scheduled pages are gated on time by `PageResolver`, so the cron is not load-bearing; drafts are reachable only with a valid preview token, stored as SHA-256 and always `noindex,nofollow` | Unit verified |
| Preview diverging from the live page | Preview and published output are produced by the same `Renderer` from the same document and asserted byte-identical; the editor differs only by `data-ch247-*` hooks | Unit verified |
| Fabricated pricing or availability | Business widgets read `tblproducts`/`tblproductgroups`/`tblpricing`/`tbldomainpricing`/`tblcurrencies` through `WhmcsDataSource`. A `-1` price renders "Price not published for this billing cycle", never `0`; a failed lookup returns `null`, so the editor shows a notice and the published page omits the block. A static test greps currency-and-digit literals out of the renderer, data source, catalogue and starters | Unit/static verified |
| Uploaded media executing as code | Allowlist jpg/jpeg/png/gif/webp/ico/mp4/webm/pdf; SVG, PHP, HTML and JS refused with an explanation. Pipeline: upload-status → size → extension → double extension → `finfo` MIME → magic bytes → `getimagesize` → SHA-256 dedupe → `slug-<checksum10>.ext` → contained write → `chmod 0644`. The media directory gets `.htaccess` with `php_flag engine off` and `Options -Indexes -ExecCGI` | Unit verified |
| Template import executing code | Package format `cloudhost247-template/v1` is parsed with `json_decode` and validated as data against the schema; two-step inspect → import; ≤1 MiB; nothing is included, evaluated or written to disk | Unit verified |
| Form spam and forged submissions | HMAC-signed token (`<ts>.<hmac>`, key auto-generated into settings and never displayed), honeypot field, minimum fill time, per-IP-hash rate limit. The submission is stored before any notification is attempted | Unit verified |
| Credential leakage through forms | The builder stores no SMTP or API credentials. Notifications go through `localAPI('OpenTicket')` / `localAPI('SendAdminEmail')`; anything else must come from the central API & Integrations vault | Static verified |
| Privilege abuse | Ten capabilities (`builder.view/pages/publish/delete/templates/theme/media/forms/settings/css`) enforced per view, per admin action and per editor API operation via `AdminGuard`, seeded Super-Admin-only. `publish`, `css`, `settings` and `delete` are PRIVILEGED | Unit/static verified |
| CSRF | Every mutating admin action and every writing editor API operation passes `AdminGuard::requirePostToken()` | Unit/static verified |
| Overwriting proprietary theme files | The builder adds `builder-page.php` and `templates/cloudhost247/cloudhost247-builder-page.tpl` only. `templates/hostx/**`, `modules/addons/hostx*` and `modules/addons/soyoustart/**` are untouched and the integrity manifest is unchanged | Manifest verified |
| Weakening authentication | Theme Builder edits login/registration **layout** only; no authentication code path is modified, and client-only pages check the real WHMCS session in `PageResolver` | Static verified |

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** `modules/addons/cloudhost247_builder` provides the Super Admin Website Builder: a versioned page schema (`cloudhost247-page/v1`) driving the editor, preview renderer, published renderer, template import/export and revision history; a drag-and-drop editor; 37 catalogue entries across layout/content/business/site; per-device responsive styling; Theme Builder parts with display conditions; a template library with nine seeded starters; a validating media library; a visual form builder; and an additive `cloudhost247_builder:1.0.0` migration creating eleven `mod_cloudhost247_builder_*` tables. 307 PHP behavioural assertions (`tests/builder/run.php`) and 46 static-policy assertions (`tests/builder/test_static.py`) run on PHP 7.4 and 8.2 in the release gate. The addon ships inactive; `builder-page.php` serves nothing while it is deactivated.

**BLOCKED — STAGING REQUIRED:** MySQL migration execution, WHMCS addon activation, real administrator role behaviour, browser drag-and-drop against a real WHMCS admin session, real `tblproducts`/`tbldomainpricing` data, real upload permissions and ownership, and live ticket/email delivery from a form submission. Required migration ordering adds Website Builder `1.0.0` (17 migrations total).

## Pre-existing defects observed during verification (2026-09-28)

Neither defect is introduced by the Website Builder work and neither is fixed here; both are recorded so the decision is deliberate.

| Ref | Location | Finding | Impact | Recommendation |
|---|---|---|---|---|
| PRE-1 | `modules/addons/cloudhost247_theme/lib/ThemeRepository.php:159` | `safeRelativeOrHttpsUrl()` uses `#` as the delimiter but leaves `#` unescaped inside the `[?#]` character class, so the pattern terminates early. PHP raises `preg_match(): Unknown modifier ']'` and the call returns `false` for **every** input | **Not a security hole — it fails closed.** The broken branch was the one that *allowed* a URL, so control falls through to the stricter absolute-HTTPS test. The functional effect is that legitimate relative links (`/about`, `contact.php`) in theme CMS content are rewritten to `href="#"`, plus a PHP warning on every call | **Fixed.** The `#` is now escaped as `[?\#]`, and the relative branch gained a `(?![/\\])` lookahead — see the note below. Covered by five regression tests in `tests/foundation/run.php` |
| PRE-2 | `tests/ovh/run.php` (`MockTransport::send`) | The double returns `array_shift($this->responses)`, which yields `null` once the queued responses are exhausted. `Client::request()` then reads `$r['status']` / `$r['body']` off `null`, producing `Warning: Trying to access array offset on value of type null` and a `json_decode(): Passing null` deprecation | Test-only noise. A real `Transport` always returns an array, so there is no production defect. The OVH suite's own assertions all pass | Have `MockTransport` return a documented default (or fail loudly) when its queue is drained, so the warnings stop masking real ones |

### PRE-1 remediation: fixing the pattern re-opened a branch that had never run

Repairing the delimiter is a one-character change, but it is not a one-character
review. Because the pattern had *always* returned `false`, the `return true`
branch behind it was dead code that had never executed against real input in
production. Restoring it therefore had to be treated as introducing new
acceptance logic rather than as restoring known-good behaviour.

That mattered, because the branch begins `^/`. A literal repair would have
started accepting `//evil.example/x` — a protocol-relative URL that sends the
visitor off-site — along with `/\evil.example`, since browsers fold backslashes
to forward slashes when parsing URLs. Neither had ever been reachable while the
pattern was broken, so neither was covered by a test. The fix adds a negative
lookahead, `/(?![/\\])`, to keep both out.

Verified behaviour after the change (`tests/foundation/run.php`):

| Input | Result |
| --- | --- |
| `/`, `/cart.php`, `/clientarea.php?action=details`, `index.php`, `order.php?a=1`, `page.php#top` | accepted |
| `https://good.example/x` | accepted (absolute-HTTPS branch) |
| `http://bad.example/x`, `javascript:alert(1)`, `data:text/html;base64,…` | rejected |
| `//evil.example/x`, `/\/evil.example`, `/\evil.example` | rejected |

`preg_match()` now raises no warnings, and the practical effect is that internal
links in theme CMS content resolve instead of degrading to `href="#"`. One of
the five new tests — the protocol-relative one — passed *vacuously* before the
fix, since the broken pattern rejected everything; it only became meaningful
once the branch started running.

**Verification note:** `@php-wasm/cli`, the runtime used for local PHP in this environment, does not propagate PHP's exit code — `exit(1)`, fatal errors and a failing `php -l` all return shell status `0`. `scripts/release-candidate-check.sh` relies on `set -e` and is therefore only meaningful under a real PHP binary, which is what GitHub Actions uses. Local runs in a php-wasm environment must assert on command **output**, not exit status, or they will report success unconditionally.
