# CloudHost247 — Complete Business Functionality Audit (Phase 7, 2026-11-09)

Rule applied throughout: **a page or API existing is not "operationally ready".** Each area is
scored on: UI presence · API/backend presence · tested flow · fulfillment path · external
dependency state. Categories per owner guidance: **READY (controlled release) · COMING SOON ·
RESTRICTED**.

| Business function | UI | Backend | Tested flow | Fulfillment | Verdict |
|---|---|---|---|---|---|
| Customer registration & authentication | ✅ | ✅ auth.ts | ✅ live (33/33, probes) | self-contained | **READY** |
| Customer dashboard (services/domains/tickets) | ✅ | ✅ account.ts | ✅ live | self-contained | **READY** |
| Support tickets | ✅ | ✅ (incl. unified inbox) | ✅ 201/201 live | self-contained | **READY** |
| Analytics & consent management | ✅ banner | ✅ marketing.ts | ✅ fail-closed live | pixels optional | **READY** |
| Security & account recovery | ✅ | ✅ | ✅ replay/revocation live | *email delivery pending relay* | **READY with relay-dependent delivery flagged** |
| Administrative management | ✅ | ✅ 14 admin modules | ✅ suites + boundary probes | authorized super_admin provisioning | **READY*** (needs authorized initial super_admin — owner action) |
| Super Admin controls | ✅ | ✅ role-gated, DB-fresh | ✅ 403/401 + suites | same gate | **READY*** |
| Billing & invoices (incl. manual/bank-transfer-style flows) | ✅ | ✅ billing-service | ✅ full lifecycle live | manual gateway needs staff confirm | **READY** (manual capture) |
| Refunds & reversals (execution) | ✅ admin | ✅ capped, append-only, audited | ✅ suites | live drill awaits authorized super_admin (OPS-2) | **RESTRICTED (execution)** |
| Payment processing (real money) | ✅ checkout | ✅ 4 receivers hardened | ✅ sandbox executed | **Stripe/PayPal/Paystack/Blockonomics uncertified (B-4)** | **RESTRICTED** until L3 |
| Domain registration & transfer | ✅ | ✅ + provenance gate | ✅ honest-empty live | **registrar absent (B-4b)** → cannot fulfill a paid domain today | **COMING SOON** |
| Domain management (records view) | ✅ | ✅ domain-services | ✅ | registrar-backed writes blocked | **COMING SOON** |
| Shared hosting | ✅ pages+catalog | ✅ provisioning (control-panel adapters) | ✅ suites | **cPanel/WHMCS upstream absent** | **COMING SOON** |
| WordPress hosting | ✅ | ✅ installer 'wordpress', health-gated | ✅ suites | needs compute + CPANEL/WHMCS hookup | **COMING SOON** |
| Cloud hosting | ✅ | ✅ aws/ovh adapters (code) | ✅ suites | creds B-4b | **COMING SOON** |
| VPS | ✅ | ✅ hetzner/do/vultr adapters (code) | ✅ suites | creds B-4b | **COMING SOON** |
| Dedicated servers | ✅ | ✅ contabo/ovh-soyoustart/openstack/bridge | ✅ suites | creds B-4b | **COMING SOON** |
| RDP services | ✅ PHP module + pages | PHP modules/servers/RDP (+Node provisioning core) | ✅ PHP suites | licensed WHMCS + Windows image legality | **COMING SOON** |
| Business email | ✅ PHP modules/pages | modules/servers/cloudhost247_email* | ✅ PHP suites | relay + WHMCS absent | **COMING SOON** |
| SMTP services | ✅ | modules/servers/Smtphosting | ✅ PHP suites | same | **COMING SOON** |
| SSL certificates | ✅ records UI | ✅ Node ssl.ts records CRUD | ✅ suite | **CA issuance integration absent** | **COMING SOON** (issuance) |
| Proxy services | ✅ pages | catalog 'service'; PHP lteproxy module | ✅ PHP suites | provider hookup absent | **COMING SOON** |
| SMM services | ✅ pages | modules smm/smmaddon/smmprovisioning | ✅ PHP suites | provider APIs absent | **COMING SOON** |
| Virtual numbers & SMS verification | ✅ pages | modules phoneservices_esim/numbers/sms/voip | ✅ PHP suites | provider APIs absent | **COMING SOON** |
| WHMCS integration | — | bridge read-only + PHP side complete | ✅ 18 suites | **license absent (B-2)** | **RESTRICTED/Coming-soon-class** |
| Provider provisioning (live) | ✅ admin infra | ✅ fail-closed, health-gated | ✅ 15 adapter suites | **creds B-4b** | **RESTRICTED** |
| Affiliate & referral | PHP customaffiliate ✅ / Node-side schema quarantined | PHP ✅ | ✅ discount-rounding suites | **0023/0024 quarantine — owner auth (B-5)** | **RESTRICTED (Node); PHP legacy separate decision** |

## Interpretation for customers (pre-launch truth policy)

- **READY** list above may be offered in a controlled release once the P1 infra (email relay for
  account mails; payments chosen: manual-only vs certified sandbox) is in place — with catalog
  merchandising intentionally excluding everything below READY.
- **COMING SOON** verticals have honest marketing/catalog presence and honest-empty operational
  surfaces; they must be listed as unavailable for checkout until their provider is certified,
  or a customer can pay for something undeliverable — the exact anti-goal the owner's
  three-category separation prevents.
- **RESTRICTED** items additionally carry authorization duties (payments L3, refunds drill,
  provisioning activation, affiliate schema, payouts).
