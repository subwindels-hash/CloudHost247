# CloudHost247 — Module Integrity Report (2026-11-09)

Branch: `arena/fe9b2088-cloudhost247` (HEAD `c578ff2f`)
Method: static + behavioral verification of every module group — PHP lint (both 7.4/8.2
legs via the repo's WASM shim), 19 PHP behavioural suites, 232 vitest files
(2,901 tests, all passing), 678 Python static tests, full release-candidate gate (exit 0),
production build, rendered-site audit. Runtime activation against licensed WHMCS and live
providers is out of sandbox scope (see Blocked items at the end).

Statuses: **Verified** = inspected + executed evidence · **Structural** = static/lint/behavioural
suite only (runtime needs WHMCS) · **Vendor-frozen** = byte-hash verified, not linted (documented
exclusion) · **Superseded** = replaced module retained for reference · **Gap** = actionable
coverage/integrity finding.

---

## 1. Node platform (`cloudhost247-node/`)

62 API route files registering **365 endpoint handlers**; 84 page components; 199 SPA route
literals (+55 marketing, +18 legal, +14 docs pages); 92 migrations (all applied in dev,
`migrate:verify`-checked, validated by `scripts/validate-migrations.py`). Typecheck 0 errors;
build passes.

Route-level integration evidence (dedicated test files unless noted):
account, account-security, account-identity, account-whmcs, auth, billing, admin-billing,
admin-customers, admin-cloudflare, admin-domain-services, admin-google-ads, admin-marketing,
admin-tiktok, admin-tools, admin-platform(-services), admin-users, agent, ai-support,
app-installations, audit, builder (via platform-services-api), business-tools, catalog-admin,
catalog-public, cloudflare, commerce, control-panels, currency, deployments, dns,
domain-brokerage, domain-services, domains, email-trace-admin, email-trace-customer,
experts (platform-services-api), firewall, health, inbox, infrastructure, licenses,
logo-maker (platform-services-api), marketing, marketing-services (platform-services-api),
marketplace, marketplace-admin (apps via marketplace-installations + categories/manifests via the dedicated G-1 suite), monitoring,
mrz-tools, navigation, payments, provisioning, seo, servers, services, social, ssl, store,
tiktok, visitor-ip, webhooks, whmcs-public (orderability; fail-closed map checksum verified).

| Sub-module (src/) | Test evidence (files) | Status |
|---|---|---|
| ai, ai-os (AI control plane/registry) | 5 + 4 | Verified |
| builders (website builder service) | platform-services-api, marketing tests | Verified |
| commerce (cart/orders) | commerce-api, commerce-schema, billing-schema… | Verified |
| config (env validation, check-env) | env:check gate + all boot tests | Verified |
| control-panels | control-panels-api | Verified |
| currency (display-only FX) | currency-geo-hint + gates (fail-closed) | Verified |
| db (query layer) | 62 files; 92 migration runs | Verified |
| deployments (engine, agent protocol) | agent-deployments-api, conformance suite | Verified |
| dns (zones, Cloudflare) | dns-api, cloudflare-api | Verified |
| domain-brokerage | domain-services-notifications | Verified |
| domain-services | domain-services-api (5 files) | Verified |
| dto | via route schemas | Verified |
| email-trace | email-trace-api (+collector, admin) | Verified |
| experts | platform-services-api | Verified |
| inbox (unified inbox) | 1 file + fail-closed webhook test | Verified |
| infrastructure (provider adapters) | 21 files incl. undeclared-adapter fail-closed | Verified |
| integrations | 3 files | Verified |
| lib (crypto, jwt, rate-limit…) | 57 files | Verified |
| logo-maker | platform-services-api | Verified |
| marketing (+consent, GA4/Google Ads/TikTok runtime) | marketing-consent-api, marketing-conversions, tiktok-pixel-api, google-ads-config-api | Verified |
| marketing-services | platform-services-api | Verified |
| marketplace (apps catalog/install) | marketplace-installations, app-installations | Verified |
| navigation | navigation-links + generate gate | Verified |
| payments (5C/5D gateways, webhooks) | payments-api + authorization matrix | Verified |
| plugins | rate-limit unit | Verified |
| revenue-guardian | 2 files | Verified |
| services | 23 files | Verified |
| social | 1 file | Verified |
| store (online store builder) | via commerce/store suites | Verified |
| tiktok | tiktok-pixel-api, tiktok-integration | Verified |
| tools (75-tool execution engine) | tools-api, business-tools-engines, mrz + `node tests/tools/local.test.mjs` | Verified |
| whmcs (client, orderability, catalogue-map) | 16 files + whmcs:map/doctor/validate tooling | Verified |
| worker (deployment sweeps) | 9 files; one-shot lease behavior | Verified |

Frontend: 72 unit test files over 84 pages; link-integrity statically scans **every** tsx link
(0 unresolved, 0 placeholder anchors); e2e browser halves (19 specs) blocked (B-1).

## 2. WHMCS addon modules (`modules/addons/`, 23)

| Module | Lint files | Behavioural suite | Status |
|---|---|---|---|
| cloudhost247_core | 13 | foundation | Verified |
| cloudhost247_theme (public pages/content store) | 16 | theme + website + rendered-site | Verified |
| cloudhost247_currency | 17 | currency | Verified |
| cloudhost247_smm | 36 | smm | Verified |
| cloudhost247_tools | 18 | tools (+ `tools:catalog:check`) | Verified |
| cloudhost247_ovh | 48 | ovh | Verified |
| cloudhost247_integrations | 27 | integrations | Verified |
| cloudhost247_builder | 48 | builder | Verified |
| cloudhost247_broker | 49 | broker | Verified |
| cloudhost247_marketing | 56 | marketing | Verified |
| cloudhost247_cart_recovery | 21 | cart_recovery | Verified |
| cloudhost247_passkey | 33 | passkey | Verified |
| cloudhost247_payments | 17* | payments | Verified |
| cloudhost247_modules (module manager) | 28 | modules (real ZIP pipeline) | Verified |
| cloudhost247_email (inactive reference) | 17* | cloudhost247_email | Verified |
| phoneservices | 70 | phoneservices | Verified |
| customaffiliate | 20 | customaffiliate | Verified |
| digitalproducts | 21 | digitalproducts static | Structural |
| dnschecker | 14* | tools/tests + static | Structural |
| tools_center | 18 | static + API suite reference | Structural |
| cloudhost247_domain_lookup | 14 | tools domain suites | Structural |
| soyoustart (admin suite, vendor WGS-OVH) | n/a | ovh suite + structural | Vendor-derived |
| smmaddon | 11 | static; superseded by cloudhost247_smm | Superseded |
| xtreme_currency_rates (ionCube) | 0 | static only | Vendor-frozen (documented) |

`*` grouped lint counts; the 842-target list covers every first-party file.

## 3. Payment gateway (`modules/gateways/`)

Blockonomics v1.9.8 (`blockonomics.php`, library, `callback/blockonomics.php`): linted; payment
callback/webhook behavior covered by tests/payments; live Bitcoin/USDT settlement intentionally
untested here (B-4). Status: **Structural** (runtime live-payment verification is B-2/B-4).

## 4. Provisioning modules (`modules/servers/`, 14)

cloudhost247_email_hosting (34 lint files, 4 test refs), cloudhost247_lteproxy (16, 2 refs),
RDP (16, 11 refs → tests/rdp), cloudhost247_ovh (ovh suite), cloudhost247_smm (smm suite),
phoneservices_esim/numbers/sms/voip (structural presence assertion in tests/modules),
soyoustart + soyoustart_vps (vendor-derived, ovh suite),
Smtphosting (637 vendor files — documented lint exclusion, structural verification recorded,
superseded by cloudhost247_email_hosting), smmprovisioning (superseded by cloudhost247_smm),
cloudhost247_email (inactive reference, owns its table).
Status: **Structural** for real-server provisioning (B-2); all idempotency/fail-closed logic
verified in suites.

## 5. Themes & order forms (`templates/`)

cloudhost247 (twenty-one child), cloudhost247_legacy (~130 tpl pages, 2,014 files), order forms
cloudhost247/cloudhost247_legacy/ovh_cart. Evidence: theme/website suites + **rendered-site
audit** (67 pages rendered via real Smarty 4.5.6; heading/link/canonical/hero-artwork checks
clean) + visual-regression statics + `test_theme_palette.py`. Status: **Verified (static+render)**.

## 6. Root PHP pages, crons, lang, tools surface, server agent

- 84 root pages: inventory-verified (0 orphaned / 0 dangling / 0 duplicate canonicals), linted.
  Notable intentional oddities confirmed: `dedeicated-server.php` is a documented **301 shim**
  to the correctly spelled page; `comingsoon.php` renders only a published content-store entry,
  else an honest 404 (no placeholder).
- `crons/` (4 scripts): linted; behavior in ovh/customaffiliate suites.
- `lang/overrides/` (27 files): linted (CRLF tolerated per gate).
- `tools/` front controller: 265 published paths resolve 1:1 (rendered-site audit).
- `server-agent/`: 20/20 node tests (HMAC, skew, replay) + **cross-implementation conformance**
  against `cloudhost247-node/src/deployments/agent-protocol.ts`.

## 7. Findings (integrity review)

- **G-1 (Gap, low — CLOSED 2026-11-09):** `marketplace-admin.ts` —
  `/api/v1/admin/app-categories` and `/api/v1/admin/manifests/*` had no dedicated automated
  tests. Added `tests/integration/marketplace-admin-categories.test.ts` (6 tests, all passing
  against real embedded Postgres + real auth): 401/403 boundaries, category CRUD + duplicate/invalid
  rejection (409/400), honest manifest validation (real manifest passes, broken YAML names its
  errors), manifest import → admin catalog visibility, idempotent category seeding, server-side
  enforcement of the app approval workflow (draft→published refused) and super_admin-only delete.
- **G-2 (Gap, environment):** Playwright e2e (19 specs) unrun on this host (B-1).
- **G-3 (Observation):** `dedeicated-server.php` filename typo is deliberate compatibility shim — keep.
- **G-4 (Observation):** dev catalog honesty — pages show empty states instead of fabricated
  prices when the product catalog is unseeded (by design; documented in the seed header).
- No placeholder UI, no dummy endpoints, no dead SPA links (0 unresolved across all sources),
  no double implementations (the single intentional duplication, agent protocol, is pinned by a
  conformance suite), no unverified financial paths.

## 8. Security & authorization controls (verified, not weakened)

JWT auth (min-32-char secret, fail-loud), MFA/TOTP fail-closed until encryption key set,
security-PIN HMAC+AES-GCM domain separation, password hashing, per-customer tenant isolation
enforced in route tests (billing/commerce suites), admin role gates (admin-* suites), webhook
signature verification per provider + sandbox HMAC + replay protection (worker leases, idempotent
provisioning), agent HMAC/skew/replay (server-agent tests + conformance), CSRF-safe cookie usage
(token header auth), SQL via parameterized pg queries, XSS escaping (theme statics + React),
append-only financial ledger with whole-DB invariant sweeps, embedded-secret scan
(test_security.py) and branding scan both green, dependency audit 0 vulnerabilities.
