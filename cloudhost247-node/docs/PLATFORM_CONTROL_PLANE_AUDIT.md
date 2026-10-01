# CloudHost247 control plane audit

Date: 2026-10-01

This document maps the existing `cloudhost247-node` platform after repository inspection so further marketplace/control-plane work extends the current architecture instead of creating duplicate systems.

## Current architecture map

| Area | Existing implementation | Notes |
| --- | --- | --- |
| Runtime/API | `src/app.ts`, `src/server.ts` | Fastify API with static React SPA fallback. Binds to `0.0.0.0` for local/container previews and Passenger/cPanel compatibility. |
| Database | `database/migrations/*.sql`, `src/db/*` | PostgreSQL schema/migration runner. Deployment queue is PostgreSQL-backed with `FOR UPDATE SKIP LOCKED`; no parallel database has been introduced. |
| Auth/session | `src/routes/auth.ts`, `src/lib/jwt.ts`, `src/lib/require-auth.ts` | JWT authentication with DB-backed revocation, active-status checks, and password-change invalidation. |
| RBAC | `src/lib/require-role.ts`, migration `0027_create_roles_user_roles.sql` | Effective role remains `users.role`, mirrored to `roles`/`user_roles` for auditability. Admin/staff/customer routes re-check role from DB. |
| Security baseline | `src/plugins/security.ts`, `src/lib/crypto.ts`, `src/lib/keyring.ts` | Helmet/CORS/rate limiting plus AES-256-GCM envelope encryption for server credentials and installation secrets. |
| Public hosting/catalog | `src/routes/catalog-public.ts`, `src/routes/commerce.ts`, `src/services/catalog-service.ts` | Existing product/plan/pricing/order/invoice flow remains the billing foundation. |
| Billing/payments | `src/routes/billing.ts`, `src/routes/payments.ts`, `src/routes/webhooks.ts`, `src/services/payment-service.ts`, `src/services/provisioning-service.ts` | Provisioning starts from server-verified paid-order/webhook state, not client confirmation. |
| Marketplace registry | `manifests/*/manifest.yaml`, `src/marketplace/*`, `src/routes/marketplace*.ts`, `src/dto/marketplace.ts` | Database-driven manifest import/validation. Public API exposes only published apps/versions and never manifest secret values. |
| Customer install flow | `src/routes/app-installations.ts`, `src/services/installation-service.ts`, frontend `AppDetailPage.tsx`, `MyAppsPage.tsx`, `AppInstancePage.tsx` | Creates installation/order/invoice atomically; paid/free authorized flows enqueue jobs, not synchronous Docker operations. |
| Deployment engine | `src/deployments/engine.ts`, `src/db/deployments.ts`, `src/worker/*` | Durable job queue, step/event logs, idempotency keys, retries/backoff, rollback where possible, SSE log stream. |
| Docker adapter | `src/deployments/adapters/docker-adapter.ts`, `src/deployments/compose-generator.ts` | Worker renders Compose from one manifest contract and calls the server agent. No Docker socket is exposed to the control plane. |
| Server agent | top-level `server-agent/src/*` | HMAC-signed allowlisted operations for deploy/teardown/start/stop/restart/logs/health/backup/restore/metrics. |
| cPanel/WHM adapter | `src/deployments/adapters/cpanel-adapter.ts`, `cpanel-client.ts` | Separate adapter for WHM account provisioning and WordPress-on-cPanel; cPanel logic is not mixed into Docker. |
| Kubernetes adapter | `src/deployments/adapters/kubernetes-adapter.ts` | Experimental/off by default via `KUBERNETES_ADAPTER_ENABLED`; uses the same manifest contract. |
| Domains/DNS/SSL | `src/routes/domains.ts`, `dns.ts`, `ssl.ts`, `src/db/customer-domains.ts`, `dns.ts`, `ssl.ts` | Customer domain verification/attachment plus DNS/SSL management APIs. |
| Backups/metrics/audit | `src/db/ops-tables.ts`, migrations `0036`, `0038`, `0039`, `src/lib/audit.ts` | Backups, server metrics, platform settings, and append-only audit log tables/routes exist. |
| Frontend portals | `frontend/src/pages/*` | Public marketplace, customer app dashboard, deployment console, server/domain/SSL pages, and admin app/server/deployment/audit/settings pages. |

## Verified in this pass

- `npm ci` installs dependencies successfully.
- `npm run catalog:validate` validates all 52 manifests.
- `npm run typecheck` passes.
- Full `npm test` passed before the current marketplace-environment fix: 84 files, 650 tests.
- Targeted `npx vitest run tests/integration/marketplace-installations.test.ts` passes after the fix.

## Fix implemented in this pass

The marketplace API and installer UI now distinguish **customer-provided required values** from **server-generated/defaulted values** declared in manifests:

- Public app details expose safe metadata flags (`generated`, `defaultFromDomain`, `defaultFromUrl`, `customerProvided`, `default`) without exposing any secret value.
- The install wizard no longer blocks on blank generated secrets such as `N8N_ENCRYPTION_KEY`.
- Blank browser inputs are stripped before submit.
- The backend also treats blank values for generated/defaulted manifest fields as absent, preventing an empty encrypted override from replacing a generated secret during deployment.

## Worker-runtime completion — 2026-10-01

The original cPanel guide prohibited an unmanaged permanent Node worker, while this platform now
uses the worker for deployments, notifications, reconciliation, Cloudflare jobs and Revenue
Guardian. That gap is closed in source with a cPanel-safe execution mode:

- `npm run worker:once` runs one bounded cycle and exits; cPanel Cron invokes the compiled command
  once per minute rather than relying on an SSH-launched daemon.
- Migration `0058_create_worker_cycle_leases.sql` adds the durable `worker_cycle_leases` table.
  One-shot cycles acquire and renew this database-backed lease, so overlapping Cron runs skip while
  a healthy cycle is active and a later run recovers automatically after a crash.
- Per-deployment leases remain unchanged. The cycle lease only serializes periodic sweeps; it never
  weakens the row-level claim/recovery controls around provider actions.
- `tests/unit/worker-runtime.test.ts` covers one-shot mode, persistent idle polling and Cron-visible
  failures; `tests/integration/worker-lease.test.ts` proves exclusivity, renewal and expiry takeover
  against migrated PostgreSQL-compatible SQL.

This is source/test evidence only. A real cPanel staging run must still prove the host's exact Cron
node path, environment inheritance, log rotation and failure alerting before production use.

## Next controlled phases

1. Add optional Redis-backed caching/rate-limit/session primitives only if the deployment environment requires Redis; keep PostgreSQL as the current durable queue source of truth unless changed deliberately.
2. Extend end-to-end tests for paid webhook → install job → worker execution with generated secrets, using the existing adapter override seam.
3. Add operational runbooks for server-agent deployment, credential rotation, backup retention, restore verification, and incident rollback; the cPanel worker command is now documented separately.
4. Continue improving frontend install ergonomics: plan selection/pricing display, verified-domain picker, and compatibility explanations based on server capacity.
