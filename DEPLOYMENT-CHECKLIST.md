# CloudHost247 Deployment Checklist — Phase 16 release packaging

**Gate rule:** every checkbox must carry dated execution evidence. Nothing here authorizes
production by itself; production remains NO-GO until CT-01..CT-08 close with verifier signatures.

## Pre-flight (must all be closed before any deploy)

- [ ] CT-03 authorized managed PostgreSQL reachable; `migrateUp` applied (currently 94 migrations) with checksum verify OK
- [ ] Quarantined migrations 0023/0024/0025/0041 explicitly reviewed + owner-authorized or still skipped
- [ ] CT-01/CT-02 WHMCS + cPanel staging certified (transaction IDs captured)
- [ ] CT-04 email relay certified (delivery + bounce + retry evidence)
- [ ] CT-05 payment sandbox certified per provider (Stripe/PayPal/Paystack/Blockonomics)
- [ ] CT-06 compute/registrar/DNS providers certified
- [ ] CT-07 browser ceremonies executed (Playwright report attached)
- [ ] CT-08 super-admin drill signed off
- [ ] Second independent reviewer appointed; reviews of P13-01/P14/P15 evidence signed

## Environment (values come from secure configuration — never committed)

- [ ] `DATABASE_URL` (managed PG TLS), `JWT_SECRET` (rotatable), `CREDENTIAL_ENCRYPTION_KEY(S)` (ring)
- [ ] `SERVER_AGENT_SHARED_SECRET`, webhook secrets per provider, SMTP credentials
- [ ] Egress allowlist updated for certified providers only; inbound webhook IP verification on
- [ ] Log redaction verified live (`authorization`, cookies, secrets, IPs redacted — see OPERATIONAL-READINESS)

## Deploy steps

1. Back up production-class database; record archive checksum (pg_dump -Fc; verified format in Phase 11).
2. Apply migrations with `CONFIRM_MIGRATION=yes` only after checklist pre-flight passes.
3. Deploy API+SPA; smoke `/health` + auth login + read-only customer dashboard fetch.
4. Provisioning drill: one free-app install; confirm installation status truthful end-to-end.
5. Financial drill: create test invoice → sandbox payment → webhook → ledger; refund via UI (auto idempotency key) → replay → confirm single entry.
6. Rollback drill: force a deployment failure; confirm rolled_back state + no billing drift.
7. Restore drill on staging: pg_restore into fresh target; verify table/checksum equality.

## Post-deploy verification

- [ ] 30-min watch: error rate, queue depth, outbox lag, webhook dedupe counters
- [ ] Financial spot-check: ledger totals vs provider sandbox balances (CT-05 evidence)
- [ ] Audit-log sanity: staff actions all carry actor + metadata

## Rollback plan

- Application: redeploy previous image; migrations are additive (no down-migration; review diff per release).
- Database: point-in-time or restore from pre-deploy archive (procedure tested Phase 11).
- Kill switch: disable checkout routes + provider webhooks env-side while investigating anomalies.
