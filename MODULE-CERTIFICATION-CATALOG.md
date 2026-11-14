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
| **Support (tickets/replies/escalation/attachments)** | account.ts tickets + `TicketAttachments`/`TicketAttachmentPicker` | ✔ | ✔ (zod + magic-number sniff + 5 MiB cap enforced twice) | ✔ (`support_ticket_attachments`, 0103; cascade on delete) | ✔ owner-only on customer routes, staff-guarded on admin routes; cross-ticket id = 404 | ✔ 404-not-403, named 400/413, no orphaned bytes on refusal | ✔ one file per request, per-message cap enforced in-transaction | Internally tested — **attachments built 2026-11-13** | `phase17-support-journey.test.ts` + `tests/integration/support-ticket-attachments.test.ts` (10) |

## Ordered backlog for the P1 external work streams (untouched here)

CT-01 WHMCS+cPanel · CT-02 staging ops · CT-03 PostgreSQL backup/restore · CT-04 email relay +
TLS+DANE · CT-05 payment sandbox · CT-06 DNS/compute · CT-07 browser runtime · CT-08 super-admin
drill. Their completion converts "Internally tested" rows into "Provider-certified".

## Genuine unfinished items acknowledged (not hidden)

~~Support attachments: not implemented.~~ **Built 2026-11-13** — migration `0103_create_support_ticket_attachments.sql`,
customer + staff upload/download/delete routes, and the SPA surfaces; 10 integration tests over a
real embedded Postgres cover the six junctions plus the three refusals that matter (wrong bytes,
oversized file, someone else's ticket). See §"Support attachments" below.
Browser runtime: CT-07 blocked. Hosting email quotas: QUEUE-based; configurable, not externally
verified.

## Support attachments — what was built and what it deliberately is not

The capability was recorded here as "deliberately absent", so closing it is documented rather than
merely deleted from the list.

| Junction | How it is held |
|---|---|
| Front door | Both upload paths require a session; admin paths additionally require `admin`/`super_admin` |
| Validation | Declared type must be whitelisted *and* match the bytes' magic number; 5 MiB cap on decoded bytes; filename normalised from the detected type |
| DB state | `bytea` in the platform database (same model as `builder_media`, so backups capture it); `byte_size`/`checksum` are of the stored bytes; `ON DELETE CASCADE` from the ticket |
| Permissions | `findAttachment` is scoped by `ticket_id` in SQL, so no route can read a file by id alone; outsiders get 404, never 403 |
| Honest failure | Wrong type, oversized file and quota exhaustion each name the limit; a rejected upload leaves no ticket, no message and no row |
| No-dup retry | One file per request; the per-message cap is counted inside the insert's transaction |

**Deliberately not implemented, and why:** no public share links or tokens (an attachment must not
outlive the reader's session), no antivirus claim (there is no scanner in this deployment — the type
sniffing is structural, and the docs must not imply a malware guarantee), no multipart upload
(`@fastify/multipart` is not a dependency), and no deletion by staff of a customer's evidence (only
the uploader may remove their own file; staff removal would be an audit event of its own and is not
claimed here).

**Correction made while building it:** `src/lib/media-upload.ts` claimed markup was "rejected
outright". That was never true of the text branch — HTML bytes in a `.txt` are accepted as
`text/plain` (which is correct for a support attachment), and what prevents execution is the stored
type plus `nosniff` on every serving route, not the sniff. The comment now says that instead.


## Phase 19 additions
Operational ownership / failure dependency / customer impact per module: `docs/module-operations-matrix.md`. Runtime config matrix (96 env keys): `docs/runtime-configuration-matrix.md`. Verdict additions are evidence-linked; no state changes.
