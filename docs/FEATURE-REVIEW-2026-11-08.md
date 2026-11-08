# CloudHost247 feature review and ratings

**Review date:** 2026-11-08<br>
**Scope:** Current working tree, including the Node platform, available browser tests, server-agent tests, and WHMCS module suites runnable in this environment.<br>
**Overall assessment:** **6/10 for implementation maturity; 4/10 for production readiness.** These are informed judgments, not mathematical averages or certifications. A score reflects the observed implementation and test evidence, discounted for unverified or unsafe production behavior.

## Evidence and limitations

- Node build: `npm run build` passed, including server, frontend, tools build, and a 75-entry tools-catalog projection check.
- Node type check: `npm run typecheck` passed. Frontend type check failed at `frontend/tests/unit/footer-back-to-top.test.tsx:52` and `:62` (possibly undefined values); the GitHub Node workflow includes this check.
- Full Node Vitest suite: **179 files passed, 5 failed, 1 skipped; 2,343 tests passed, 6 failed, 6 skipped; 1 unhandled exception**. Run with `npx vitest run --maxWorkers=2 --reporter=dot`. Tests use embedded PGlite and mocks in many cases, not a live production system.
- Browser suite: **110 passed, 10 failed** of 120 Playwright/Chromium tests. All 10 failures were serious color-contrast findings in axe scans: two ID-card states and eight marketing pages. The browser suite serves a built frontend through Vite; several workflows deliberately mock API responses and do not prove live integrations.
- Server agent: **71/71 Node tests passed**. This is not a real remote-host or Docker deployment.
- PHP: **19 module/website `run.php` suites exited successfully** using the repository's PHP 8.2.33 WebAssembly shim. Native PHP, licensed WHMCS, cPanel, and real provider environments were not available; this does not establish live WHMCS compatibility.
- `npm audit --omit=dev`: **7 affected package entries** (1 high, 5 moderate, 1 low). `npm audit` for all dependencies reports **11 entries** (3 high, 7 moderate, 1 low). Advisory presence is not proof that a given application exploit is reachable; investigate the dependency paths and upgrade safely. Example: transitive `ip-address` has a high-severity advisory; see `npm audit` and GHSA-rxp7-6hxx-x8q5.
- Live Stripe/PayPal/Paystack, cloud/registrar/DNS providers, outbound mail, real cPanel/WHMCS, production PostgreSQL migrations, independently monitored uptime, and real backup restoration were **not tested**. The preview uses in-memory data and demo plans, and data is lost on restart.
- Existing `docs/feature-parity-register.csv` lists **211 benchmark capabilities** and `docs/FEATURE-PARITY-REGISTER.md` describes their historical assessments. These are useful inventories, but some details are stale; this review does **not** claim every individual capability was independently tested end-to-end. Ratings below group the product's feature families and include the major gaps explicitly.

## Feature-family ratings

| Feature area | Rating /10 | Evidence and remaining limitations |
| --- | ---: | --- |
| Public website, navigation, content, legal and SEO | 7 | Built and browser navigation/link tests passed. Serious contrast findings on 8 of the 10 scanned marketing pages; some header/design contract tests fail. Site content and compliance claims need business/legal review. |
| Hosting and pricing catalog | 6 | Catalog API, translation and commerce integration tests exist; browser fixture checkout passed. Two hosting/catalog unit tests failed and one unhandled catalog-render exception occurred in a test. Demo prices are seeded only for preview; shared-hosting order-to-provisioning is not established by this review. |
| WordPress, PHP, shared/agency/reseller hosting | 3 | Product pages and catalog do not by themselves prove WordPress management, hosting account provisioning, or reseller operations. Historical parity inventory identifies missing backend portions; no live hosting environment tested. |
| VPS and dedicated server lifecycle | 6 | Extensive tests for OS selection, orders, lifecycle, provisioning, termination, resize, rescue and adapters ran in the Node suite; provider execution remains unverified. One VPS frontend catalog test failed. |
| Provider integrations and infrastructure | 5 | Adapter and capability tests exist for multiple vendors, but no live provider was exercised. Configuration, available capabilities, billing, actual provisioning and deprovisioning require provider-specific staging. |
| Hosting control panels | 3 | Source contains a catalog and generated install scripts, but `BaseControlPanelAdapter` also returns successful/active/healthy results without making a provider call (`cloudhost247-node/src/control-panels/adapters/base.ts:152-183`). This is an operational truthfulness risk; do not represent these stub responses as real provisioning or health checks. |
| DNS and domain search/registration/transfer | 6 | Domain and DNS API, propagation and provider architecture tests ran; a real registrar or DNS provider was not tested. Registrations, transfers, renewals, nameserver changes and upstream failure recovery require staging evidence. |
| SSL certificate management | 2 | Routes store certificate records, but `src/routes/ssl.ts:91-112` marks a certificate issued and extends an expiry on renewal without a CA renewal call. Certificate issuance, deployment and renewal are **not verified**; this must not be presented as a real renewal. |
| Firewall, cloud security and monitoring | 5 | Firewall/authorization and provider tests exist; live network enforcement, malware protection, DDoS, and independent monitoring were not verified. Public status has a confirmed false-healthy database bug described below. |
| Authentication, account, RBAC, MFA and passkeys | 7 | Authentication, recovery, account, role authorization, TOTP and passkey tests are present and passed in the full suite. Live email recovery, configured WebAuthn origin/RP, abuse resistance and security assessment still require staging. |
| Commerce cart and orders | 7 | Commerce and authorization tests ran against embedded databases; a browser checkout flow passed with **mocked** endpoints. Real prices, service activation and upstream payment fulfillment still require end-to-end staging. |
| Billing, invoices, ledger, refunds and renewals | 6 | Billing lifecycle, ledger and financial invariant tests ran. Production database changes and real payment/reconciliation flows were not performed; historical documentation records migration/financial controls and feature gaps. |
| Payment gateways and webhooks | 5 | Gateway, signature, authorization and webhook tests exist; sandbox is simulated and real provider test accounts were not used. Do not enable real payments until migration, reconciliation and provider staging gates are satisfied. |
| Website builder and publishing | 6 | Builder/API tests and a browser published-route fixture passed; PHP builder suite also exited successfully. Live hosting, custom domains, complex editing, staging, migration and backup workflows are not proven end to end. |
| Online store and ecommerce | 6 | Store and platform service tests cover data flows; browser fixtures exercise cart workflows. Real payment processing, digital delivery, storefront fulfillment and production infrastructure were not verified. |
| AI website builder, AI support and AI control plane | 5 | AI control-plane/registry and support tests exist; browser support interaction passed with mocked API responses. External model provider, cost controls in real usage, output quality and human escalation were not live-tested. |
| Logo maker, expert marketplace and marketing services | 5 | Platform-service APIs and browser fixtures cover portions; external provider fulfillment, creative output quality and actual service delivery are not verified. |
| Unified inbox, notifications and email delivery | 5 | Outbox, notifications and platform-service tests exist; email and webhook integrations require configuration, and real delivery was not tested. |
| Email marketing and WHMCS email provisioning | 5 | PHP marketing and email module suites passed using PHP WASM. Actual SMTP delivery, deliverability, unsubscribe operations, webmail/account provisioning and WHMCS compatibility remain unverified in live staging. |
| Online developer/network tools | 7 | Tools API/security suites passed and catalog consistency check passed. Local/pure functionality is better evidenced than network/provider-backed tools, which require external connectivity and configuration. |
| Business tools, document generators, ID cards and MRZ | 7 | Most browser flow tests passed, including business generators, downloads, ID-card and MRZ scenarios. Both ID-card accessibility scans failed on contrast; results are not legal, payroll or identity-document certification. |
| Customer support and tickets | 6 | Support pages and API tests exist; browser widget test used mocked backend responses. Live staffing, actual email delivery, 24/7 support and external channels were not verified. |
| Internationalization, country and currency | 6 | Browser tests for regional currency suggestions and language persistence passed with rate fixtures. Country uses a browser-region estimate when trusted IP detection isn't configured; it is read-only and may be wrong. Currency conversion is display-only and billing remains USD. |
| Backups, restoration and deployments | 5 | Deployment/worker, backup and server-agent tests exist. Tests do not substitute for a real off-server backup, restore drill, credential setup, or deployment to a server. |
| WHMCS modules and legacy theme | 5 | All 19 runnable PHP suites exited successfully under WASM; staging against licensed WHMCS and cPanel, real databases and providers remains blocked. Encoded/vendor and superseded components need their own licensing and compatibility checks. |
| Accessibility and responsive behavior | 4 | Navigation and responsive spacing browser tests passed, but 10 axe checks failed for serious color contrast; broader keyboard, screen-reader and browser/device testing is incomplete. |
| Reliability and production operations | 4 | Server health and readiness endpoints respond in the preview, but status-page database reporting is demonstrably incorrect, releases have failing tests, staging has not been verified, and preview data is ephemeral. |

## Confirmed issues and test failures

1. **False database health in public status (reproduced):** `cloudhost247-node/src/routes/health.ts:37-44` ignores the boolean returned by `isDatabaseReachable`. With an injected database that rejects queries, `/ready` correctly returned 503 while `/api/v1/public/status` reported the database as operational. Fix the false result handling and add regression coverage before relying on status reporting.
2. **SSL renewal truthfulness (source finding):** `src/routes/ssl.ts:91-112` updates status/expiry without a CA call. Creation similarly assigns a 90-day expiry to supplied PEM content. Fail closed or integrate and verify real certificate lifecycle operations.
3. **Control-panel adapter truthfulness (source finding):** `src/control-panels/adapters/base.ts` includes stubbed success/health responses. Confirm call paths, prevent these from being surfaced as completed operations and replace or disable them until real upstream operations are implemented.
4. **Dependencies:** Address production audit findings, starting with the high-severity `ip-address` dependency path, assess actual exposure and verify upgrades. The wider development tree also has high-severity advisories.
5. **Accessibility:** Fix the serious contrast findings, including `.ch-kicker`, plan descriptions and `.ch247-page__hint`; rerun axe on all affected pages and verify manually.
6. **Full Vitest failures:** Two migration tests expect 83 migrations while the repository contains 84 (`0084_catalog_product_translations.sql`); update expectations only after reviewing the migration. Other failures are in design-system palette expectations, hosting hub/catalog UI and VPS fetch expectations, and header placement. The suite also reported an unhandled `catalog.data.products.length` exception in `hosting-catalog-page.test.tsx`; determine whether the malformed response is a test fixture problem or an application robustness issue rather than assuming either.
7. **Frontend CI:** Fix the two strict TypeScript errors in the footer test and rerun the actual CI command.
8. **Attribution:** The footer currently says GeoLite2 data was created by WIL, while the dependency's license identifies MaxMind and sets attribution terms. Have the appropriate owner review the data license and correct attribution before distribution.

## Recommended sequence

1. Block or clearly disable unverified SSL renewal and control-panel success paths; fix the public database-status bug.
2. Resolve production dependency advisories and rerun the audit; repair the failed Node tests and frontend type check.
3. Fix accessibility contrast and repeat the browser suite, then manually test keyboard, screen-reader, mobile and slow-network behavior.
4. Establish isolated staging with real PostgreSQL, controlled migration authorization, licensed WHMCS/cPanel and sandbox credentials. Exercise signup, catalog → order → payment → provisioning → cancellation/refund, domain/DNS, email, backup → restore, and failure/retry paths.
5. Validate deployment, backups, monitoring, security and GeoLite licensing with the responsible operators before accepting real customers or payments.

**Review note:** Scores do not certify security, legal compliance, operational capacity or feature completeness. Historical reports and passing tests are supporting evidence, not a replacement for production-like end-to-end verification.
