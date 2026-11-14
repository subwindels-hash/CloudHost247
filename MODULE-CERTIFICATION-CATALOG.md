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
| **SSL (issuance/renewal/install/revocation)** | `ssl-firewall-api` | ✔ | ✔ (zod + directory/contact config gate) | ✔ (`ssl_certificates`, `acme_accounts`, `acme_challenges`; issuance only on a CA `valid`) | ✔ owner-only, cross-tenant id = 404 | ✔ no CA → 503 `SSL_ISSUANCE_NOT_CONFIGURED`; CA refusal recorded verbatim; never a fabricated certificate | ✔ one ACME account per directory, single-use nonces, in-flight guard | Internally tested — **real ACME issuance built 2026-11-13**; public-CA runtime = CT-04 | `ssl-firewall-api.test.ts` + `tests/integration/ssl-acme-issuance.test.ts` (11) |
| **VPS/Dedicated (soyoustart_vps, ovh)** | modules/servers + adapter WP | ✔ (installer) | ✔ | ✔ | ✔ admin | ✔ fail-closed A13 termination | ✔ | Internally tested at boundaries; provider runtime = CT-06 | `hosting-mode-selector.test.ts`, PHASE-9 COMING-SOON |
| **RDP** | modules/servers/RDP | ✔ | ✔ | ✔ | ✔ admin | ✔ fail-closed, order surfaced from COMPLETED-CHECKOUT 201 | ✔ | Implemented; provisioning unit suite (provisioner 41/41); provider runtime = CT-06 | `leasing.test.ts` (leasing rerun clean), modules/servers/RDP |
| **Proxies (LTE 4G proxy)** | marketplace-installations, `cloudhost247_lteproxy` | ✔ | ✔ | ✔ | ✔ | ✔ capability COMING-SOON, only by accountable staff; only-one-active bound | ✔ | Internally tested (lifecycle suite green); provider runtime = CT-06 | `marketplace-installations.test.ts`, PHASE-9 |
| **Virtual numbers (phoneservices_*)** | phoneservices sms/voip/esim/numbers modules | ✔ | ✔ | ✔ | ✔ admin | ✔ (no host mapping for unmapped numbers) | ✔ | Implemented; provisioning suite (41/41); provider runtime = CT-06 | `leasing.test.ts` |
| **SMM** | modules smmprovisioning + `cloudhost247_smm` | ✔ | ✔ | ✔ | ✔ admin | ✔ fail-closed | ✔ | Implemented at source level; provisioning units green; provider runtime = CT-06 | codebase modules + partial suites |
| **Billing (wallets/invoices/refunds/reconciliation)** | admin-billing + billing-ledger | ✔ | ✔ | ✔ append-only w/ trigger | ✔ BILLING_STAFF_ROLES | ✔ (409 mismatch, refund guidance) | ✔ global refund-key identity | **Internally certified financial integrity** (Phase 14–16); provider reconciliation = CT-05 | 170/170 + 8/8 real-PG probes |
| **Administration (RBAC/audit/config)** | admin-suite | ✔ | ✔ | ✔ (audit log 0002) | ✔ super-admin-only integrity closures | ✔ (audit on every action) | ✔ | Internally tested | admin-role-guard-hardening.test.ts + P3–P9 regressions |
| **Support (tickets/replies/escalation/attachments)** | account.ts tickets + `TicketAttachments`/`TicketAttachmentPicker` | ✔ | ✔ (zod + magic-number sniff + 5 MiB cap enforced twice) | ✔ (`support_ticket_attachments`, 0106; cascade on delete) | ✔ owner-only on customer routes, staff-guarded on admin routes; cross-ticket id = 404 | ✔ 404-not-403, named 400/413, no orphaned bytes on refusal | ✔ one file per request, per-message cap enforced in-transaction | Internally tested — **attachments built 2026-11-13** | `phase17-support-journey.test.ts` + `tests/integration/support-ticket-attachments.test.ts` (10) |

## Ordered backlog for the P1 external work streams (untouched here)

CT-01 WHMCS+cPanel · CT-02 staging ops · CT-03 PostgreSQL backup/restore · CT-04 email relay +
TLS+DANE · CT-05 payment sandbox · CT-06 DNS/compute · CT-07 browser runtime · CT-08 super-admin
drill. Their completion converts "Internally tested" rows into "Provider-certified".

## Genuine unfinished items acknowledged (not hidden)

~~Support attachments: not implemented.~~ **Built 2026-11-13** — migration `0106_create_support_ticket_attachments.sql`,
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


## SSL certificate issuance — what was built and what it deliberately is not

The SSL row previously covered CRUD plus a *simulated* issue/renew path: it wrote `ISSUED` and a
`+90 days` expiry without ever contacting a certificate authority. That was the gap. It is now a real
RFC 8555 (ACME) client, and the row is worded so it cannot be read as more than it is.

| Junction | How it is held |
|---|---|
| Front door | `POST /ssl/certificates/:id/issue` requires a session; the certificate must belong to the caller |
| Validation | Ordered names are normalised, de-duplicated and sorted; a CSR is built and its self-signature verified; the CA's directory and contact email are configuration, not constants |
| DB state | `ssl_certificates` only reaches `ISSUED` when the CA returned a certificate whose SANs cover **every** ordered name; `expires_at` is the certificate's own `notAfter`, never `now + 90d`; `acme_accounts` holds one encrypted JWK per directory; `acme_challenges` holds the HTTP-01 tokens |
| Permissions | Ownership is enforced in SQL, so a foreign certificate is 404 rather than 403; a pasted `CUSTOM` certificate cannot be "issued" (409) — it is already real material |
| Honest failure | No `ACME_DIRECTORY_URL` → 503 `SSL_ISSUANCE_NOT_CONFIGURED` with `configurationRequired: true` and **zero** rows written; a CA refusal → `FAILED` carrying the CA's own `detail`; an invalid authorization never becomes an issuance; revocation reports `revokedAtCa` and says so when the CA was not contacted |
| No-dup retry | One ACME account per directory (`newAccount` once, then `kid`), every nonce single-use, and a second `issue` call resumes the existing order instead of creating another |

**How it is proven.** `tests/helpers/mock-acme-server.ts` is an independent implementation of the
server half of the protocol over `node:http`/`node:crypto` — it verifies JWS signatures, enforces
single-use nonces and `kid`-vs-`jwk`, and issues genuine X.509 signed by a throwaway CA. Our client
talks to it over real HTTP with **no test branches in production code**. Certificates are then
re-parsed with `node:crypto`'s `X509Certificate` and with `openssl x509`, and every stored field
(`serialNumber`, `fingerprint256`, `expires_at`, `sans`) is compared against those bytes rather than
against what the code computed.

**What this is not:** a publicly trusted certificate. No external CA was reachable from this
environment, so the row stays *Internally tested* and **provider-certified is CT-04's job** (an
`ACME_DIRECTORY_URL` pointing at a real CA, an outbound HTTP-01 reachable from the internet, and a
domain that actually resolves). Nothing in this repository or in the API claims otherwise.

**Two real bugs this work found and fixed** — both invisible to a lenient fake:
1. `buildCsr` emitted `[0] { SEQUENCE { OID, SET { Extension } } }`, omitting the
   `Extensions ::= SEQUENCE OF Extension` wrapper. OpenSSL still reported the self-signature as OK
   and simply dropped the extension, so the CSR looked fine while carrying no SANs at all. Now
   verified against `openssl req -text`, which shows the same shape OpenSSL itself produces.
2. The mock CA emitted a zero-padded serial number. DER forbids non-minimal INTEGER content, so the
   whole certificate was unparseable (`openssl asn1parse`: `BAD INTEGER`). Fixed by minimal-encoding.

**Deliberately not implemented:** no DNS-01 automation (the challenge type is recorded and refused
explicitly rather than silently downgraded — publishing TXT records needs provider credentials this
deployment does not hold), no wildcard issuance for the same reason, no certificate *installation*
onto a hosting node (that is CT-01/CT-06 runtime), and no OCSP/CRL checking.

## Phase 19 additions
Operational ownership / failure dependency / customer impact per module: `docs/module-operations-matrix.md`. Runtime config matrix (96 env keys): `docs/runtime-configuration-matrix.md`. Verdict additions are evidence-linked; no state changes.
