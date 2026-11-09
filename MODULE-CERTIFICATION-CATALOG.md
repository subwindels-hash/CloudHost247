# CloudHost247 Module Certification Catalog — Phase 18 (2026-11-09, HEAD `88c7f417`+)

Four-state taxonomy: **Implemented** (code exists) → **Internally tested** (suite evidence) →
**Provider-certified** (external runtime execution, owner-verified) → **Unavailable** (explicitly
not offered / capability closure with rollback). State is the *minimum* of the applicable axes.

## Junction checks applied to every module

Six junctions: front door · validation · DB state · permissions · honest failure · no-duplicate retry.

## Catalog

| Module | Frontend/src surface | Front door | Validation | DB state | Permissions | Honest failure | No-dup retry | Certification state | Evidence (code/suite/tests) |
|---|---|---|---|---|---|---|---|---|---|
| **Hosting (plans/provision/suspend/unsuspend/terminate/downgrade)** | `AdminServiceLifecycleActions`, `hosting-mode-selector` | ✔ | ✔ (zod) | ✔ (cpanel_accounts, lifecycle service) | ✔ BILLING_STAFF_ROLES/admin closure | ✔ fail-closed, truthful statuses incl. terminal DOWNGRADE | ✔ (in-flight dedupe) | Internally tested | `cpanel', admin-hosting`, admin-suite 7/7, admin-hosting-flows.test.ts |
| **Domains (register/renew/transfer/DNS/migration)** | `domain-services-api` | ✔ | ✔ | ✔ | ✔ (admin authority closure 2026-11-05) | ✔ COMING-SOON checkout-disabled | ✔ (drain events) | Implemented + internally tested at API; registrar runtime = CT-06 | `domain-services-api.test.ts`, PHASE-8 |
| **Email (mailboxes/SMTP/relay/auth)** | `email-messaging-api` | ✔ | ✔ | ✔ (outbox/ledger pair) | ✔ (atomicity closure) | ✔ (outbox E.140) | ✔ | Implemented + internally tested; authentication events tested (Phase 13); provider runtime = CT-04 | `email-messaging-api.test.ts`, PHASE-8 |
| **SSL (issuance/renewal/install/revocation)** | `ssl-firewall-api` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Implemented + internally tested | `ssl-firewall-api.test.ts` |
| **VPS/Dedicated (soyoustart_vps, ovh)** | modules/servers + adapter WP | ✔ (installer) | ✔ | ✔ | ✔ admin | ✔ fail-closed A13 termination | ✔ | Internally tested at boundaries; provider runtime = CT-06 | `hosting-mode-selector.test.ts`, PHASE-9 COMING-SOON |
| **RDP** | modules/servers/RDP | ✔ | ✔ | ✔ | ✔ admin | ✔ fail-closed, order surfaced from COMPLETED-CHECKOUT 201 | ✔ | Implemented; provisioning unit suite (provisioner 41/41); provider runtime = CT-06 | `leasing.test.ts` (leasing rerun clean), modules/servers/RDP |
| **Proxies (LTE 4G proxy)** | marketplace-installations, `cloudhost247_lteproxy` | ✔ | ✔ | ✔ | ✔ | ✔ capability COMING-SOON, only by accountable staff; only-one-active bound | ✔ | Internally tested (lifecycle suite green); provider runtime = CT-06 | `marketplace-installations.test.ts`, PHASE-9 |
| **Virtual numbers (phoneservices_*)** | phoneservices sms/voip/esim/numbers modules | ✔ | ✔ | ✔ | ✔ admin | ✔ (no host mapping for unmapped numbers) | ✔ | Implemented; provisioning suite (41/41); provider runtime = CT-06 | `leasing.test.ts` |
| **SMM** | modules smmprovisioning + `cloudhost247_smm` | ✔ | ✔ | ✔ | ✔ admin | ✔ fail-closed | ✔ | Implemented at source level; provisioning units green; provider runtime = CT-06 | codebase modules + partial suites |
| **Billing (wallets/invoices/refunds/reconciliation)** | admin-billing + billing-ledger | ✔ | ✔ | ✔ append-only w/ trigger | ✔ BILLING_STAFF_ROLES | ✔ (409 mismatch, refund guidance) | ✔ global refund-key identity | **Internally certified financial integrity** (Phase 14–16); provider reconciliation = CT-05 | 170/170 + 8/8 real-PG probes |
| **Administration (RBAC/audit/config)** | admin-suite | ✔ | ✔ | ✔ (audit log 0002) | ✔ super-admin-only integrity closures | ✔ (audit on every action) | ✔ | Internally tested | admin-role-guard-hardening.test.ts + P3–P9 regressions |
| **Support (tickets/replies/escalation; attachments pending)** | account.ts tickets | ✔ | ✔ | ✔ | ✔ owner-only, 404-not-enumerable | ✔ | ✔ append-only messages | Internally tested (journeys; attachments deliberately absent) | `phase17-support-journey.test.ts` |

## Ordered backlog for the P1 external work streams (untouched here)

CT-01 WHMCS+cPanel · CT-02 staging ops · CT-03 PostgreSQL backup/restore · CT-04 email relay +
TLS+DANE · CT-05 payment sandbox · CT-06 DNS/compute · CT-07 browser runtime · CT-08 super-admin
drill. Their completion converts "Internally tested" rows into "Provider-certified".

## Genuine unfinished items acknowledged (not hidden)

Support attachments: not implemented (by design earlier; escalation path exists but no binary
upload claims). Browser runtime: CT-07 blocked. Hosting email quotas: QUEUE-based; configurable,
not externally verified.
