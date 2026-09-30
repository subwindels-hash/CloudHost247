# Server OS catalog and provisioning

CloudHost247 keeps the customer-facing operating-system catalog separate from provider image identifiers:

`product plan → exact availability rule → OS family → OS version → architecture → provider image mapping → provider adapter → provisioning job`

Logos are browser assets only. They are never used as installation images. Public APIs return only combinations that have an active plan rule, active provider, supported OS/version, and an active provider image with a successful live verification timestamp.

## Safe rollout

1. Back up PostgreSQL and run `npm run migrate:status`.
2. Apply migration `0041_create_os_catalog_and_server_provisioning.sql` using the normal migration command. It is additive. Existing `servers` records are retained and point to the archived **Unknown operating system** version when their OS cannot be proven.
3. Set `APP_URL`, `CREDENTIAL_ENCRYPTION_KEY` (or a key ring), `SERVER_AGENT_INSTALL_URL`, provider credentials, and worker settings in the server-side secret store. Restart the API and worker.
4. In **Admin → Infrastructure**, add the provider and location records. Keep the provider disabled until its credentials validate.
5. Add an OS image mapping as `DRAFT`, use **Test**, and enable it only after the provider confirms the image and architecture.
6. Activate the OS version, then create and enable an exact product availability rule. The rule metadata must include resource values and the adapter's provider plan/type identifier.
7. Place a low-cost test order. Confirm that no provider request occurs before verified payment. Observe the queued job and all health stages.
8. Do not enable production sales until provisioning, agent attestation, delete/lifecycle actions, and reinstall have all passed in the intended region.

Production migrations and provider enablement are operator actions; application startup does not apply migrations or create provider mappings.

## Required common configuration

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public HTTPS control-plane origin used by the agent. |
| `CREDENTIAL_ENCRYPTION_KEY` or `CREDENTIAL_ENCRYPTION_KEYS` | Encrypts agent credentials at rest. |
| `SERVER_AGENT_INSTALL_URL` | HTTPS URL for an operator-owned, self-contained executable installer. |
| `PROVISIONING_HEALTH_TIMEOUT_MS` | Maximum provider/network/agent health wait (default 600000). |
| `WORKER_*` | Durable deployment worker identity, polling, concurrency, and lease settings. |
| `NOTIFICATION_EMAIL_WEBHOOK_URL`, `NOTIFICATION_EMAIL_WEBHOOK_TOKEN` | Optional server-side email bridge. In-app notification remains durable if absent; email is marked `CONFIGURATION_REQUIRED`. |

`SERVER_AGENT_INSTALL_URL` must serve one shell executable that can run on the selected clean image. It must install Node.js 20+, Docker, the complete `server-agent/src` tree, its systemd unit, and start the service. The repository's `server-agent/install.sh` installs from a local checkout and is therefore a packaging source, not by itself a remote artifact. Publish a versioned, integrity-controlled installer from operator infrastructure; test it on every image. Never place agent or provider secrets in the installer URL or artifact.

A server reaches READY only after all of these are true:

- the provider resource exists, is powered on, has an IP, and reports the expected image;
- SSH port 22 is reachable;
- a recent HMAC-authenticated agent report matches the requested OS version and hostname;
- the report confirms the security marker and running monitoring agent.

Failure to configure any required service produces an explicit terminal or retryable error. There is no production fallback to a mock provider, fake address, or synthetic health result.

## Provider adapters

### Hetzner Cloud (native)

Admin provider values:

- type: `HETZNER`
- adapter: `hetzner`
- API base URL: normally `https://api.hetzner.cloud/v1`
- credential prefix: normally `HETZNER`

Secrets:

```text
HETZNER_API_TOKEN=...
HETZNER_API_URL=https://api.hetzner.cloud/v1
```

The token needs the server/image operations represented by the configured capabilities. Product availability metadata needs `providerServerType` (for example, an operator-verified Hetzner server type). Region/datacenter codes and image identifiers must be real Hetzner values. Adapter idempotency uses the `cloudhost247_idempotency` label and lookup-before-create.

### DigitalOcean, Vultr, AWS, and Contabo

The provider types and secure environment variables are:

```text
DIGITALOCEAN_API_URL=https://api.digitalocean.com/v2
DIGITALOCEAN_API_TOKEN=...
VULTR_API_URL=https://api.vultr.com/v2
VULTR_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
CONTABO_API_URL=https://api.contabo.com/v1
CONTABO_CLIENT_ID=...
CONTABO_CLIENT_SECRET=...
CONTABO_API_USER=...
CONTABO_API_PASSWORD=...
```

Adapters fail closed with `PROVIDER_NOT_CONFIGURED` if tokens or API credentials are not set. DigitalOcean and Vultr support native droplet/instance creation with user-data, power control, rebuild/reinstall, resize, and snapshot actions.

### OVH, Proxmox, Virtualizor, SolusVM, and OpenStack

The provider types and secure environment names are reserved:

```text
OVH_API_ENDPOINT=...
OVH_APPLICATION_KEY=...
OVH_APPLICATION_SECRET=...
OVH_CONSUMER_KEY=...
PROXMOX_API_URL=...
PROXMOX_API_TOKEN=...
VIRTUALIZOR_API_URL=...
VIRTUALIZOR_API_KEY=...
VIRTUALIZOR_API_SECRET=...
SOLUSVM_API_URL=...
SOLUSVM_API_TOKEN=...
OPENSTACK_API_URL=...
OPENSTACK_API_TOKEN=...
```

Native adapters for these providers are **not implemented in this release**. Selecting their native adapter fails closed with `SERVICE_UNAVAILABLE`; the existence of environment variable names is not a claim of integration support.

Operators may instead deploy a separately secured provider bridge and select `generic_http`. Set the provider's HTTPS `api_base_url`, choose a unique `credential_env_prefix` (for example `MY_OVH_BRIDGE`), and configure only on the API/worker host:

```text
MY_OVH_BRIDGE_API_TOKEN=...
```

The bridge is a real provider integration, not a simulator. It must implement:

- `GET /v1/health`
- `GET /v1/images` and `GET /v1/images/:id`
- `POST /v1/servers`
- `GET /v1/servers/by-idempotency/:key`
- `GET` and `DELETE /v1/servers/:id`
- `POST /v1/servers/:id/{start,shutdown,reboot,reinstall}`
- `GET /v1/servers/:id/{health,console,metrics}`

It must preserve idempotency keys and return explicit HTTP failures. Only activate a bridge-backed provider after API reachability, image lookup, create/retry/delete, health, and reinstall have been tested.

## Payment and queue guarantees

Server order creation atomically creates an `AWAITING_PAYMENT` server, order, and invoice; it does not call a provider. The verified settlement transaction re-reads the authoritative paid order, creates/reuses the subscription, and enqueues one PostgreSQL deployment using a unique idempotency key. The worker re-checks payment and ownership before creation. Provider resource IDs are persisted immediately; after a crash the worker checks both that ID and provider-side idempotency before creating anything.

Reinstall requires server ownership, provider/product capability, the literal confirmation `REINSTALL`, and a newly resolved active image for the server's provider and location. It is always queued. Existing resources may display EOL or archived OS versions, but those versions cannot be selected for a new deployment.

## Live acceptance run

The required acceptance run cannot be simulated:

1. Configure a real provider, region, Ubuntu 24.04 x86_64 image, plan availability row, and agent installer.
2. Create an order and verify the provider has no resource before payment.
3. Settle through a verified gateway webhook and observe one queued job.
4. Confirm provider ID/IP persistence and all health evidence before READY/ACTIVE.
5. Configure and verify a Debian 13 x86_64 image in the same provider/location.
6. Queue reinstall with confirmation `REINSTALL`; confirm Debian 13 agent attestation before the catalog fields change and the server returns to READY.

Record provider request IDs and job/audit IDs outside customer-visible logs. Real credentials and this live acceptance are intentionally not part of repository tests.

## Control Panel & Application Platform Catalog (Phase 3)

The centralized platform supports all 18 hosting control panels and PaaS platforms across 3 primary categories:

1. **Web Hosting Panels (`SERVER_PANEL`)**: cPanel & WHM, Plesk Obsidian, DirectAdmin, CyberPanel, HestiaCP, CloudPanel, aaPanel, FASTPANEL, Webuzo, Webmin, TinyCP, Kusanagi.
2. **Application Deployment & PaaS (`APPLICATION_DEPLOYMENT_PLATFORM`)**: Dokploy, Coolify, Easypanel, Cloudron, Cosmos Cloud.
3. **Server Management & Telemetry (`SERVER_MANAGEMENT`)**: AdminBolt.

### Architecture & APIs

- **Catalog & Plans Schema**: Migration `0043_create_control_panels_and_plans.sql` stores normalized platform capabilities, hardware requirements (min CPU, RAM, disk), compatible operating systems, and commercial licensing tiers (`control_panel_plans`).
- **Brand Assets**: Official SVG vectors located in `/panel-logos/`.
- **Public Endpoints**:
  - `GET /api/v1/control-panels` — Filterable marketplace catalog with starting prices and supported OSes.
  - `GET /api/v1/control-panels/:slug` — Platform detail specification with native capabilities checklist and commercial licensing tiers.
  - `GET /api/v1/control-panel-plans` — Available commercial plans per platform.
- **Admin Endpoints**:
  - `GET /api/v1/admin/control-panels` — Staff directory of all platforms and license tiers.
  - `POST /api/v1/admin/control-panels` — Add new platform with audit logging.
  - `PATCH /api/v1/admin/control-panels/:id` — Update platform metadata and system requirements.
  - `DELETE /api/v1/admin/control-panels/:id` — Safely remove platform.
  - `POST /api/v1/admin/control-panel-plans` — Add license plan / tier.
  - `PATCH /api/v1/admin/control-panel-plans/:id` — Update plan pricing and limits.
  - `DELETE /api/v1/admin/control-panel-plans/:id` — Delete plan.
- **Customer UI**:
  - `/hosting/control-panels` — Responsive marketplace with category filters (`SERVER_PANEL`, `APPLICATION_DEPLOYMENT_PLATFORM`, `SERVER_MANAGEMENT`), search, license filters, and pricing cards.
  - `/hosting/control-panels/:slug` — Deep-dive specification page detailing system requirements, compatible operating systems, capabilities, and software license plans.
- **Admin UI**:
  - `/admin/control-panels` & `/admin/infrastructure/control-panels` — Administration console for managing platforms, toggling active states, editing hardware requirements, and configuring software license tiers.

