# Phase 6 — Marketplace, Manifests, and the Deployment Pipeline

This document covers the application marketplace (spec §22–§54 of the independent-rebuild
scope): the manifest-driven catalog, the async deployment queue, the worker, the deployment
engines/adapters, and the Server Agent. For billing (orders/invoices/webhooks) see
`API_BILLING.md` / `API_PAYMENTS.md`; for the customer app shell see `API_CUSTOMER_APP.md`.

## The five rules this phase is built on

1. **The catalog lives in the database.** No application is ever installed by a name hardcoded
   in code. Every app is a row in `applications` + `application_versions`, created by importing
   a YAML manifest (`manifests/<slug>/manifest.yaml`), and the engine reads the manifest at
   deploy time. Adding an application = adding a manifest. There is no per-app deployment code
   anywhere in the platform.
2. **All infrastructure work is async.** Nothing — install, update, backup, restore, uninstall,
   suspend — runs inside an HTTP request. Actions enqueue rows in the `deployments` queue; a
   worker process (`npm run worker`) claims and executes them with retry, backoff, lease
   expiry recovery, and rollback.
3. **Provisioning is gated on money.** A marketplace install creates an order + unpaid invoice.
   The `install` deployment is only enqueued by the paid-order hook
   (`src/services/provisioning-service.ts`) after a verified payment webhook — or immediately
   for a zero-total order, but still through the queue, never synchronously. The engine's first
   step re-verifies the order's `payment_status` from the database again (defense in depth).
4. **The Docker socket never leaves the server.** The control plane talks to a tiny
   Server Agent over HMAC-signed HTTP with a fixed operation set (see `SERVER_AGENT.md`).
5. **Credentials are encrypted at rest and shown once.** Agent secrets, WHM tokens, and
   per-installation environment values are AES-256-GCM encrypted (`server_credentials`,
   `application_environment`); GET endpoints return keys/metadata only. Rotation is
   first-class, and rotating a key re-encrypts every envelope.

## Data model (migrations 0026–0040)

| Table | Purpose |
| --- | --- |
| `applications`, `application_versions`, `application_categories` | the catalog; versions carry the manifest JSONB |
| `application_installations` | a customer's running copy (status, health, limits, `container_project`) |
| `application_environment` | per-installation env values, encrypted; `application_volumes` |
| `deployments`, `deployment_steps`, `deployment_events` | the async job queue + per-step pipeline + append-only event log |
| `servers`, `server_credentials`, `server_metrics` | the server registry, encrypted credentials, agent metrics |
| `customer_domains` (0034) + `application_domains` | domain verification (DNS TXT) and attach/detach |
| `backups` | archive metadata (checksum, size, storage provider, restore linkage) |
| `subscriptions` (0037) | billing lifecycle for installations (suspend/terminate hooks) |
| `audit_logs` (0038) | every security-relevant action, append-only |
| `platform_settings` (0040) | the admin-configurable whitelist |

## Manifest format (short form)

```yaml
id: n8n
name: n8n
category: automation
description: Fair-code workflow automation with 400+ integrations.
deployment:
  engine: docker-compose        # docker-compose | cpanel | kubernetes
supportedHostingTypes: [docker, vps, dedicated]
requirements: { cpu: 2, memory: 4096, storage: 20480 }
services:
  app:
    image: n8nio/n8n           # the version entry pins the exact tag
    port: 5678
    volumes: [/home/node/.n8n]
environment:
  required:
    - { key: N8N_ENCRYPTION_KEY, secret: true, generate: random_32 }
  optional:
    - { key: N8N_HOST, defaultFromDomain: true }
domain: { enabled: true, primaryRequired: false }
ssl: { enabled: true }
backup: { enabled: true, includes: [volumes] }
versions:
  - { version: 1.98.0, image: n8nio/n8n:1.98.0, stable: true }
```

Full schema: `src/marketplace/manifest-schema.ts` (zod — the single source of truth, also used
to re-validate the stored JSONB before every deployment). Authoring tool: `tools/build-manifests.py`
(generates all 52 shipped manifests). Validation without touching the DB:

```bash
npm run catalog:validate   # npx tsx scripts/validate-catalog.ts
npm run catalog:import     # npx tsx scripts/import-catalog.ts  (after migrations)
```

In production the admin routes do the same: `POST /api/v1/admin/manifests/validate` and
`POST /api/v1/admin/manifests/import` (imports leave apps/versions in `draft` — the approval
workflow publishes them).

## Application workflow (spec §47)

```
draft → validating → testing → approved → published → suspended → deprecated
```

Enforced server-side (`src/routes/marketplace-admin.ts`): illegal transitions are 409s, and
publishing an app requires at least one published version. Version workflow:
`draft → published → deprecated`, exactly one `is_stable` per app (marking one stable demotes
the rest). The public marketplace only ever shows `published` apps/versions; unpublished apps
404 identically to nonexistent ones.

## Deployment pipeline

```
customer action → deployments row (status=queued, idempotency_key unique)
                       │
                       ▼  worker claims: FOR UPDATE SKIP LOCKED (status→running, lease, attempts+1)
              jobHandlers[action]  (src/worker/handlers.ts — registry, one handler per action)
                       │
                       ▼
       executeDeployment (src/deployments/engine.ts)
         • re-validates the stored manifest
         • builds the step pipeline for the action (install = validate order → validate app
           → validate server/capacity → generate env+secrets → create volumes → create
           containers → domain routing → SSL → health check → mark online)
         • each step: 1 immediate retry; structured failures fail the job
         • infra steps have rollback; failure rolls back completed steps in reverse
         • every step and outcome is an event in deployment_events (the live console feed)
```

- **Actions**: `install reinstall start stop restart update backup restore uninstall
  ssl_provision domain_configure healthcheck provision suspend terminate`.
- **Retries**: `failDeployment` re-queues while `attempts < max_attempts` (default 3, admin
  setting `deployment.max_attempts`) with exponential backoff; a dead worker's lease expiry
  reclaims the job (`recoverOrphanedJobs`).
- **Cancellation**: queued jobs only (`POST /api/v1/deployments/:id/cancel`); running jobs
  finish or fail on their own.
- **Live progress**: `GET /api/v1/deployments/:id/events` (SSE: `events` / `state` / `done`
  frames). EventSource cannot send headers, so this one read-only endpoint accepts the bearer
  token as `?token=` — verification is otherwise identical to `authenticate()`.

## Engines / adapters (spec §38)

`selectAdapter(server, manifest, options)`:

- **docker-compose** (default for VPS/DEDICATED) → `docker-adapter` → Server Agent →
  `docker compose` project per installation. Compose generation is a pure function
  (`src/deployments/compose-generator.ts`): per-project name/network/volumes, resource limits,
  `${VAR}`-style env from the 0600 `.env` file (never inline secrets), Traefik labels only for
  the `app` service when a domain is attached.
- **cpanel** → `cpanel-adapter` → WHM/UAPI only (no SSH, no exec). WordPress is the dual-engine
  app: `deployment.cpanelInstaller: wordpress` + compose services.
- **kubernetes** → `kubernetes-adapter`, **disabled unless `KUBERNETES_ADAPTER_ENABLED=true`**
  (spec: separate optional adapter, off by default).

All adapters implement the same small interface (`src/deployments/adapters/types.ts`), and the
engine never talks to Docker/Kubernetes/WHM directly — only through an adapter.

## The marketplace flow, end to end

1. Customer browses `/apps` (public, catalog-driven) → app detail → install wizard
   (server → configuration → review).
2. `POST /api/v1/app-installations` validates hosting compatibility, capacity, env vars and
   creates: installation (pending) + order + invoice (unpaid). No deployment yet.
3. Payment (webhook verified) → `provisionPaidOrder` → subscription + `install` deployment
   (idempotent on `install:<installation>:<order>`). Zero-total installs skip the webhook but
   go through the same queue.
4. Worker runs the pipeline; the customer watches `/dashboard/deployments/:id` (SSE console).
5. Lifecycle actions from `/dashboard/apps/:id`: start/stop/restart/update/backup/restore/
   uninstall — all queued jobs with status guards (e.g. cannot stop a `pending` installation).

## Key API surfaces

- Public: `GET /api/v1/apps`, `GET /api/v1/apps/:slug`, `GET /api/v1/app-categories`
- Customer: `/api/v1/app-installations…` (CRUD + actions + logs/backups/env/domains),
  `/api/v1/deployments/:id` (+ `/events` SSE, `/cancel`), `/api/v1/domains…` (DNS TXT
  verification: `_cloudhost247-verification.<domain>` = `cloudhost247-verify=<token>`),
  `/api/v1/servers…` (public metadata + own-server metrics/health)
- Admin: `/api/v1/admin/apps…` (+ `/status`, `/versions/:id`, `/manifests/validate|import`),
  `/api/v1/admin/servers…` (+ `/credentials`, `/rotate-credentials`), `/api/v1/admin/deployments`,
  `/api/v1/admin/settings/:key` (whitelist only), `/api/v1/admin/audit`
- Agent (inbound, HMAC): `GET /api/v1/agent/ping`, `POST /api/v1/agent/report`,
  `POST /api/v1/agent/health`

## Testing

Phase 6 added (all against a real embedded Postgres, no mocks of our own code):
`tests/unit/manifest-catalog.test.ts` (all 52 manifests + compose generation),
`tests/integration/marketplace-installations.test.ts` (catalog→order→provisioning gate),
`tests/integration/worker-deployments.test.ts` (queue semantics, retries, recovery, full
pipelines with a typed stub adapter), `tests/integration/agent-deployments-api.test.ts`
(HMAC/nonce/skew auth, SSE token auth), `tests/integration/domains-servers-admin.test.ts`
(DNS verify, secrets-once, settings whitelist, audit).
