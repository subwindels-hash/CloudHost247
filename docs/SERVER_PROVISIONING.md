# Server OS catalog and provisioning

CloudHost247 keeps the customer-facing operating-system catalog separate from provider image identifiers:

`product plan → exact availability rule → OS family → OS version → architecture → provider image mapping → provider adapter → provisioning job`

Logos are browser assets only. They are never used as installation images. Public APIs return only combinations that have an active plan rule, active provider, supported OS/version, and an active provider image with a successful live verification timestamp.

## Safe rollout

1. Back up PostgreSQL and run `npm run migrate:status`.
2. Apply migrations `0041_create_os_catalog_and_server_provisioning.sql` through `0048_operating_system_logo_assets.sql` using the normal migration command. It is additive. Existing `servers` records are retained and point to the archived **Unknown operating system** version when their OS cannot be proven.
3. Set `APP_URL`, `CREDENTIAL_ENCRYPTION_KEY` (or a key ring), `SERVER_AGENT_INSTALL_URL`, provider credentials, and worker settings in the server-side secret store. Restart the API and worker.
4. In **Admin → Infrastructure**, add the provider and location records. Keep the provider disabled until its credentials validate.
5. Add an OS image mapping as `DRAFT`, use **Test**, and enable it only after the provider confirms the image and architecture.
6. Activate the OS version, then create and enable an exact server template (product availability rule). The rule metadata must include resource values and the adapter's provider plan/type identifier.
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
| `ALLOW_MOCK_PROVIDER` | Development-only opt-in for the isolated mock adapter. Ignored (and refused) when `NODE_ENV=production`. Default `false`. |
| `NOTIFICATION_EMAIL_WEBHOOK_URL`, `NOTIFICATION_EMAIL_WEBHOOK_TOKEN` | Optional server-side email bridge. In-app notification remains durable if absent; email is marked `CONFIGURATION_REQUIRED`. |

`SERVER_AGENT_INSTALL_URL` must serve one shell executable that can run on the selected clean image. It must install Node.js 20+, Docker, the complete `server-agent/src` tree, its systemd unit, and start the service. The repository's `server-agent/install.sh` installs from a local checkout and is therefore a packaging source, not by itself a remote artifact. Publish a versioned, integrity-controlled installer from operator infrastructure; test it on every image. Never place agent or provider secrets in the installer URL or artifact.

A server reaches READY only after all of these are true:

- the provider resource exists, is powered on, has an IP, and reports the expected image;
- SSH port 22 is reachable;
- a recent HMAC-authenticated agent report matches the requested OS version and hostname;
- the report confirms the security marker and running monitoring agent.

Failure to configure any required service produces an explicit terminal or retryable error. There is no production fallback to a mock provider, fake address, or synthetic health result.

## Provider adapters

Every adapter reads its credentials **only** from server-side environment variables. Nothing is
stored in the database, returned by an API, written to a log, or shipped to the browser. A
provider whose variables are absent fails closed with `PROVIDER_NOT_CONFIGURED` or
`CONFIGURATION_REQUIRED` *before* any network call, and it cannot be activated in the admin UI.

Each provider row carries an optional `credential_env_prefix`. When set, the adapter reads
`<PREFIX>_<SUFFIX>` (for example `HETZNER_EU_API_TOKEN`), which lets one deployment hold several
accounts of the same provider. When it is not set, the default prefix in the tables below is
used. Self-hosted platforms (Proxmox, Virtualizor, SolusVM, OpenStack, and bridges) additionally
require an HTTPS `api_base_url` on the provider row; plain HTTP is rejected except for localhost
in development.

**Admin → Infrastructure → Providers & regions → Configuration** renders exactly these
requirements per provider and shows which variables are set — names and booleans only, never a
value — via `GET /api/v1/admin/providers/:id/configuration`. The catalogue of all adapters is
available at `GET /api/v1/admin/provider-adapters`. Both endpoints are admin-only.

### Hetzner Cloud (`hetzner`)

- Default credential prefix: `HETZNER`
- API base URL: `https://api.hetzner.cloud/v1` (default)

| Variable | Purpose | Required |
| --- | --- | --- |
| `HETZNER_API_TOKEN` | Hetzner Cloud project API token | yes |

Plan/availability metadata: `providerServerType`, `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console, metrics.

Native API. Idempotency uses the cloudhost247_idempotency label plus lookup-before-create.

### DigitalOcean (`digitalocean`)

- Default credential prefix: `DIGITALOCEAN`
- API base URL: `https://api.digitalocean.com/v2` (default)

| Variable | Purpose | Required |
| --- | --- | --- |
| `DIGITALOCEAN_API_TOKEN` | DigitalOcean personal access token | yes |

Plan/availability metadata: `providerServerType`, `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console.

Native droplet API with user-data, rebuild, resize and snapshots.

### Vultr (`vultr`)

- Default credential prefix: `VULTR`
- API base URL: `https://api.vultr.com/v2` (default)

| Variable | Purpose | Required |
| --- | --- | --- |
| `VULTR_API_KEY` | Vultr API key | yes |

Plan/availability metadata: `providerServerType`, `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console.

Native instance API.

### Amazon EC2 (`aws`)

- Default credential prefix: `AWS`
- API base URL: not required

| Variable | Purpose | Required |
| --- | --- | --- |
| `AWS_ACCESS_KEY_ID` | IAM access key id | yes |
| `AWS_SECRET_ACCESS_KEY` | IAM secret access key | yes |
| `AWS_REGION` | Default EC2 region | yes |

Plan/availability metadata: `providerServerType`, `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: snapshot, resize, metrics.

SigV4 EC2 API.

### Contabo (`contabo`)

- Default credential prefix: `CONTABO`
- API base URL: `https://api.contabo.com/v1` (default)

| Variable | Purpose | Required |
| --- | --- | --- |
| `CONTABO_CLIENT_ID` | OAuth client id | yes |
| `CONTABO_CLIENT_SECRET` | OAuth client secret | yes |
| `CONTABO_API_USER` | API user | yes |
| `CONTABO_API_PASSWORD` | API password | yes |

Plan/availability metadata: `providerServerType`, `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot.

OAuth2 client-credentials API.

### OVHcloud Public Cloud (`ovh`)

- Default credential prefix: `OVH`
- API base URL: `https://eu.api.ovh.com/1.0` (default)

| Variable | Purpose | Required |
| --- | --- | --- |
| `OVH_APPLICATION_KEY` | OVH application key | yes |
| `OVH_APPLICATION_SECRET` | OVH application secret | yes |
| `OVH_CONSUMER_KEY` | OVH consumer key with /cloud access | yes |
| `OVH_CLOUD_PROJECT_ID` | Public Cloud project (service name) that owns the instances | yes |
| `OVH_API_ENDPOINT` | Regional API endpoint when it is not set on the provider row | optional |

Plan/availability metadata: `providerFlavorId`, `providerSshKeyId` (optional), `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console, metrics.

Signed OVH v1 API against /cloud/project/{id}/instance. Instances are named from the job idempotency key and looked up before creation.

### Proxmox VE (`proxmox`)

- Default credential prefix: `PROXMOX`
- API base URL: **required on the provider row** (self-hosted endpoint)

| Variable | Purpose | Required |
| --- | --- | --- |
| `PROXMOX_API_TOKEN` | API token in the form user@realm!tokenid=uuid | yes |
| `PROXMOX_API_URL` | https URL of the PVE API when it is not set on the provider row | optional |

Plan/availability metadata: `providerNode`, `providerStorage` (optional), `providerBridge` (optional), `providerSnippetStorage` (optional), `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console, metrics.

QEMU full clone from a template VMID, or LXC from a vztmpl volume. Provider server ids are node/type/vmid.

### Virtualizor (`virtualizor`)

- Default credential prefix: `VIRTUALIZOR`
- API base URL: **required on the provider row** (self-hosted endpoint)

| Variable | Purpose | Required |
| --- | --- | --- |
| `VIRTUALIZOR_API_KEY` | Virtualizor admin API key | yes |
| `VIRTUALIZOR_API_SECRET` | Virtualizor admin API password | yes |
| `VIRTUALIZOR_API_URL` | https URL of the admin panel when it is not set on the provider row | optional |

Plan/availability metadata: `providerVirtType`, `providerNode` (optional), `providerUserId` (optional), `providerPlanId` (optional), `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console, metrics.

Admin API. The selected OS template must have cloud-init enabled so the agent, SSH keys and hostname are applied.

### SolusVM 1 (`solusvm`)

- Default credential prefix: `SOLUSVM`
- API base URL: **required on the provider row** (self-hosted endpoint)

| Variable | Purpose | Required |
| --- | --- | --- |
| `SOLUSVM_API_ID` | SolusVM admin API id | yes |
| `SOLUSVM_API_KEY` | SolusVM admin API key | yes |
| `SOLUSVM_API_URL` | https URL of the SolusVM master when it is not set on the provider row | optional |

Plan/availability metadata: `providerVirtType`, `providerClientId`, `providerPlanId`, `providerNode` (optional), `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, resize, console, metrics.

Admin API v1 (api/admin/command.php). Snapshots are not exposed by SolusVM 1.

### OpenStack (`openstack`)

- Default credential prefix: `OPENSTACK`
- API base URL: not required

| Variable | Purpose | Required |
| --- | --- | --- |
| `OPENSTACK_AUTH_URL` | Keystone v3 URL (password login) | optional |
| `OPENSTACK_USERNAME` | Keystone user (password login) | optional |
| `OPENSTACK_PASSWORD` | Keystone password (password login) | optional |
| `OPENSTACK_PROJECT_ID` | Project id (or _PROJECT_NAME) | optional |
| `OPENSTACK_API_URL` | Nova compute endpoint (token login) | optional |
| `OPENSTACK_API_TOKEN` | Pre-issued Keystone token (token login) | optional |

Plan/availability metadata: `providerFlavorId`, `providerNetworkId` (optional), `providerKeypairName` (optional), `cpuCores`, `memoryMb`, `storageMb`.

Capabilities: reinstall, snapshot, resize, console.

Keystone v3 + Nova + Glance. Either password login or a pre-issued token is required.

### Operator provider bridge (`generic_http`)

- Default credential prefix: `PROVIDER_BRIDGE`
- API base URL: **required on the provider row**
- Variable: `<PREFIX>_API_TOKEN` (bearer token for the operator-owned bridge, required)
- Plan metadata: `providerServerType` (optional), `cpuCores`, `memoryMb`, `storageMb`
- Capabilities: reinstall, console, metrics

When a provider has no native adapter, deploy a separately secured HTTPS bridge and select the
`generic_http` adapter. Set the provider's `api_base_url`, choose a unique
`credential_env_prefix` (for example `MY_OVH_BRIDGE`), and set `MY_OVH_BRIDGE_API_TOKEN` on the
API/worker host only. The bridge is a real integration, not a simulator, and must implement:

- `GET /v1/health`
- `GET /v1/images` and `GET /v1/images/:id`
- `POST /v1/servers`
- `GET /v1/servers/by-idempotency/:key`
- `GET` and `DELETE /v1/servers/:id`
- `POST /v1/servers/:id/{start,shutdown,reboot,reinstall}`
- `GET /v1/servers/:id/{health,console,metrics}`

It must preserve idempotency keys and return explicit HTTP failures. Only activate a
bridge-backed provider after API reachability, image lookup, create/retry/delete, health, and
reinstall have been tested.

### Development mock provider (`mock`)

- Default credential prefix: `MOCK` (no credentials are read)
- Plan metadata: `cpuCores`, `memoryMb`, `storageMb`
- Capabilities: reinstall, snapshot, resize

The `mock` adapter exists so the provisioning pipeline can be exercised without a provider
account. It is deliberately isolated:

- it requires `NODE_ENV` other than `production` **and** `ALLOW_MOCK_PROVIDER=true`; otherwise
  every call — including `validateConfiguration` — fails with `SERVICE_UNAVAILABLE` or
  `CONFIGURATION_REQUIRED`;
- the admin API refuses to create or activate a mock provider unless both conditions hold, and
  the database enforces that `adapter='mock'` is paired with `provider_type='MOCK'`
  (`infrastructure_providers_mock_pairing_check`, migration `0047`);
- it never returns a routable address: mock servers report `192.0.2.10` from the RFC 5737
  documentation range and carry `metadata.mock = true`, so mock and real inventory can always be
  told apart;
- it is never selected automatically. Provider choice always comes from an explicit, enabled
  product availability rule.

### Unsupported adapters

If a provider row names an adapter that has no implementation, the registry returns a
fail-closed adapter that rejects every operation with `SERVICE_UNAVAILABLE`. A mock or partially
working implementation is never substituted.

## Payment and queue guarantees

Server order creation atomically creates an `AWAITING_PAYMENT` server, order, and invoice; it does not call a provider. The verified settlement transaction re-reads the authoritative paid order, creates/reuses the subscription, and enqueues one PostgreSQL deployment using a unique idempotency key. The worker re-checks payment and ownership before creation. Provider resource IDs are persisted immediately; after a crash the worker checks both that ID and provider-side idempotency before creating anything.

Reinstall requires server ownership, provider/product capability, the literal confirmation `REINSTALL`, and a newly resolved active image for the server's provider and location. It is always queued. Existing resources may display EOL or archived OS versions, but those versions cannot be selected for a new deployment.

## Observability, audit and infrastructure logs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/admin/provider-adapters` | Every adapter with the variables, plan metadata and capabilities it needs. |
| `GET /api/v1/admin/providers/:id/configuration` | Per-provider readiness: which variables are set, what is missing, how many verified images exist. Names and booleans only. |
| `GET /api/v1/admin/provisioning-jobs`, `/:id` | Job list and per-job steps, events and stage logs. |
| `POST /api/v1/admin/provisioning-jobs/:id/{retry,cancel}` | Operator recovery for failed or queued jobs. |
| `GET /api/v1/admin/provisioning-metrics` | Totals, success rate, average duration, retries, queue depth, jobs stalled over 30 minutes, failures grouped by error code, and per-provider job health. |
| `POST /api/v1/admin/os-lifecycle/sweep` | Applies a freshly entered end-of-life date immediately; the worker runs the same sweep hourly. |
| `POST /api/v1/admin/server-terminations/sweep` | Destroys servers whose scheduled cancellation is due; the worker runs the same sweep every 15 minutes. |
| `GET /api/v1/admin/infrastructure-logs` | Append-only audit trail filtered to infrastructure resources (`provider`, `region`, `datacenter`, `os_image`, `operating_system`, `operating_system_version`, `provisioning_job`, `server`), with `action`, `resourceId`, `limit` and `offset` filters. |

Infrastructure logs are a read-only projection of the existing `audit_logs` table — there is no
second logging system and no UI can edit or delete an entry. Failure classification is visible
in both places: configuration-class errors (`PROVIDER_NOT_CONFIGURED`, `CONFIGURATION_REQUIRED`,
`INVALID_CONFIGURATION`, `IMAGE_UNAVAILABLE`) are terminal and never retried automatically,
while transient errors (`RATE_LIMITED`, `PROVIDER_TIMEOUT`, `NETWORK_TEMPORARY_FAILURE`,
`INSUFFICIENT_CAPACITY`) are retried by the durable queue with backoff.

## Operating-system lifecycle (EOL)

Every version carries an operator-entered `end_of_life_date`. The worker runs
`sweepOperatingSystemLifecycle` hourly (and an admin can trigger it with
`POST /api/v1/admin/os-lifecycle/sweep`) to advance the catalog:

| Transition | Condition | Effect |
| --- | --- | --- |
| `ACTIVE`/`MAINTENANCE` → `EOL_WARNING` | end of life within 90 days (`warningDays`) | still orderable and reinstallable; every affected customer gets one in-app notice per server |
| `ACTIVE`/`MAINTENANCE`/`EOL_WARNING` → `EOL` | end-of-life date has passed | removed from ordering and reinstall; customers are notified once per server |
| `EOL` → `ARCHIVED` | 180 days past end of life (`archiveAfterDays`) **and** no server references the version | catalog cleanup only |

`MAINTENANCE` remains a manual operator decision; the sweep never sets it.

Guarantees the sweep must keep, all covered by `tests/integration/os-lifecycle.test.ts`:

- **Running servers are never modified.** Status, IP, image, and recorded OS version stay exactly
  as they were; only catalog rows change. A server keeps showing the version it actually runs,
  annotated with its lifecycle state, instead of being silently re-pointed at another OS.
- **Nothing is deleted.** A version is only archived once no server references it, so historical
  records never dangle.
- **New deployments stop immediately.** Public catalog, ordering, and reinstall queries only
  accept `ACTIVE`, `MAINTENANCE` and `EOL_WARNING`, so an EOL version cannot be selected even
  though existing servers still display it.
- **Customers are told once.** The notification unique index makes repeated sweeps idempotent;
  `GET /api/v1/servers/:id` returns `os_version_status` and `os_end_of_life_date`, and the
  dashboard and server detail pages render a notice that states plainly that the server keeps
  running and that reinstalling erases the disk.
- **Everything is audited.** Each transition writes `OS_VERSION_EOL_WARNING`, `OS_VERSION_EOL`,
  or `OS_VERSION_ARCHIVED` to `audit_logs`, visible in Admin → Infrastructure logs.

## Operating-system logos

`operating_systems.logo_url` is the only source of OS branding; no component contains
per-distribution conditionals. Assets live in `cloudhost247-node/frontend/public/os-logos/` and
migration `0048_operating_system_logo_assets.sql` points the five previously unillustrated
families (Alpine, Arch, Kali, NixOS, openSUSE) at their SVGs, updating only rows whose
`logo_url` is still `NULL` so operator branding is preserved. A family without a logo renders a
text badge instead. A logo is never an installation image: installable artifacts exist only in
`server_os_images.provider_image_id` / `provider_template_id`.

## Customer notifications

In-app notifications are durable and written inside the same transaction flow as the event that
caused them; email is an optional bridge that never blocks or fakes the in-app record.

| Type | Raised when | Shown as |
| --- | --- | --- |
| `SERVER_READY` | a provisioning job reaches READY after every health gate | success notice with the server link |
| `SERVER_REINSTALLED` | a reinstall job completes and the new OS is attested | success notice |
| `OS_EOL_WARNING` | the lifecycle sweep moves a version the customer runs to EOL_WARNING | warning notice, one per server |
| `OS_EOL` | the lifecycle sweep moves that version to EOL | end-of-life notice, one per server |
| `SERVER_TERMINATED` | a DELETE job finishes and the provider resource is gone | termination notice confirming billing has stopped |

Customers read them at **Dashboard → Notifications** (`/dashboard/notifications`):
`GET /api/v1/notifications` returns the list plus the unread count, and
`POST /api/v1/notifications/:id/read` / `POST /api/v1/notifications/read-all` mark them read.
All three are scoped to the authenticated user id, so a notification belonging to another
account returns `404` rather than confirming it exists. Notification text never contains
credentials, tokens or provider responses.

## Server templates (admin)

`server_product_configurations` **is** the server-template registry: one row per
plan × provider × region × datacenter × OS version × architecture × server type. There is no
second template table — a duplicate registry would let ordering and reinstall disagree about
what is deployable. Operators manage the rows at
**Admin → Infrastructure → Server templates** (`/admin/infrastructure/availability`).

Each row carries, in `metadata`:

- the adapter's own plan identifier (`providerServerType`, `providerFlavorId`, `providerVirtType`,
  … — see the per-adapter tables above) — without it, provisioning fails closed;
- the resources the customer is sold (`cpuCores`, `memoryMb`, `storageMb`, `bandwidthGb`);
- `capabilities`, the exact set of actions the server detail page offers and the API accepts
  (`start`, `stop`, `reboot`, `shutdown`, `reinstall`, `snapshot`, `resize`, `rescue`, `console`).

Rows are created `DISABLED` on purpose. Enable one only after a verified provider image exists
for that provider, OS version, architecture and region; the ordering and reinstall queries join
through `ACTIVE` images with a non-null `verified_at`, so a template enabled too early simply
never appears rather than producing a broken order.

## Cancellation and termination

Provisioning has a counterpart: `POST /api/v1/servers/:id/cancel`. It is deliberately **not**
gated on a `capabilities.delete` flag — a customer must always be able to stop paying for a
service, whatever the product template allows.

| Mode | Effect | Reversible |
| --- | --- | --- |
| `AT_PERIOD_END` (default) | Subscriptions on the server's order are flagged `cancel_at_period_end`; the server keeps running until the term the customer already paid for ends. | Yes — `DELETE /api/v1/servers/:id/cancel` until the sweep fires |
| `IMMEDIATE` | Requires the typed confirmation `"DELETE"`. Subscriptions are cancelled and a `DELETE` provisioning job is enqueued at once. | No |

Both modes record the request under `servers.metadata.cancellation`
(`mode`, `requestedAt`, `requestedBy`, `effectiveAt`, `reason`) and audit it
(`SERVER_TERMINATION_SCHEDULED`, `SERVER_TERMINATION_REQUESTED`, `SERVER_TERMINATION_REVOKED`).

The destruction itself never happens in the request:

- `sweepScheduledTerminations` (worker, every 15 minutes; also
  `POST /api/v1/admin/server-terminations/sweep`) enqueues the `DELETE` job once `effectiveAt`
  passes, skipping servers already `deleting` or `retired` and deriving the idempotency key from
  the effective date so a re-run reuses the existing job;
- the worker calls the provider adapter's `deleteServer`, sets the server to `retired`, and
  raises a `SERVER_TERMINATED` notification — once, even if the queue redelivers the job;
- a server that never reached the provider (an abandoned unpaid order) is retired directly with
  the audit action `SERVER_RETIRED_WITHOUT_PROVIDER_RESOURCE`. No provider call is faked.

The `servers` row is **kept** with status `retired`. Nothing deletes customer records: orders,
invoices, payments and the audit trail are untouched, so billing history stays intact.

## Serial console access

`POST /api/v1/servers/:id/console` issues a provider console session for the owner of the
server. It is the single server action that is answered synchronously, because a console
session is a short-lived credential that is only useful in the browser that requested it;
everything that changes server state still goes through the durable queue.

Guarantees:

- ownership is checked first, and a server belonging to another account returns `404` rather
  than `403`, so the endpoint cannot be used to probe for server ids;
- the template must declare `capabilities.console` (`400` otherwise) and the server must already
  exist at the provider (`409` while it is still queued);
- an unconfigured, unauthenticated or unreachable provider returns `503`
  (`SERVICE_UNAVAILABLE`) with a neutral message — never a fabricated console URL. The mapping
  lives in `src/infrastructure/providers/error-mapping.ts`; the provider's own wording is logged
  server-side only, because it can name internal endpoints;
- the session URL, password and token are returned to the owner's browser and are never written
  to logs, the audit trail or the database. The audit record is `SERVER_CONSOLE_OPENED` with the
  server and provider ids only.

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

