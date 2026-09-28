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
