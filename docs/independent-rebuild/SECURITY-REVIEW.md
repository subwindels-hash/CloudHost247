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
