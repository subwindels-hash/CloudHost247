# Server OS catalog and provisioning

CloudHost247 keeps the customer-facing operating-system catalog separate from provider image identifiers:

`product plan → exact availability rule → OS family → OS version → architecture → provider image mapping → provider adapter → provisioning job`

Logos are browser assets only. They are never used as installation images. Public APIs return only combinations that have an active plan rule, active provider, supported OS/version, and an active provider image with a successful live verification timestamp.

## Safe rollout

1. Back up PostgreSQL and run `npm run migrate:status`.
2. Apply migrations `0041_create_os_catalog_and_server_provisioning.sql` through `0052_serialize_server_infrastructure_operations.sql` using the normal migration command. They preserve existing server and billing records. Existing `servers` records point to the archived **Unknown operating system** version when their OS cannot be proven; if legacy data contains overlapping active operations for one server, migration 0052 keeps the oldest and safely cancels the newer queue records before enforcing serialization.
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

The supplied `infrastructure/docker/docker-compose.yml` forwards common provisioning and default
provider variables to **both** `app` and `worker`. If a provider row uses a custom
`credential_env_prefix`, add that prefix's variables to both service environments (or to an
operator-managed Compose override/secret injection); configuring only the API is insufficient
because the worker makes the provisioning calls.

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
- Required variables: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

Native EC2 uses the AWS SDK's Signature Version 4 client. Plan metadata must set
`providerServerType` to an EC2 instance type; the mapped OS image must hold an AMI id. It supports
create/retry lookup through a CloudHost247 idempotency tag, status, start/stop/reboot, terminate,
resize, snapshots, image lookup and console output. Reinstall is implemented as a replacement
instance (same zone, subnet, security groups and key; the previous instance is stopped, never
terminated) and root-volume restore runs in place from a completed snapshot, keeping the detached
root volume. Both are opt-in: they refuse with `UNSUPPORTED_OPERATION` unless the deployment sets
`AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true` (or the provider-prefix equivalent), and the profile keeps
advertising `reinstall: false` until it is enabled. Rescue mode and CloudWatch metrics remain
unavailable; metrics need separately scoped permissions.

### Contabo (`contabo`)

- Default credential prefix: `CONTABO`
- API base URL: `https://api.contabo.com/v1` (default)
- OAuth token URL: `https://auth.contabo.com/auth/realms/contabo/protocol/openid-connect/token` (default)

| Variable | Purpose | Required |
| --- | --- | --- |
| `CONTABO_CLIENT_ID` | OAuth client id | yes |
| `CONTABO_CLIENT_SECRET` | OAuth client secret | yes |
| `CONTABO_API_USER` | Contabo API user | yes |
| `CONTABO_API_PASSWORD` | Contabo API password | yes |
| `CONTABO_API_URL` | Compute API base URL override | no |
| `CONTABO_TOKEN_URL` | OAuth token URL override | no |

Plan/availability metadata: `providerServerType` (Contabo VPS/VDS product id), optional
`providerSshKeyIds` (Contabo Secret ids), `contaboPeriodMonths` (`1`, `12`, or `24`),
`contaboDefaultUser` (`root`, `admin`, or `administrator`), optional `contaboLicense`, and the
common CPU/memory/storage values.

The native adapter exchanges the password-grant OAuth token only at runtime and keeps it in process
memory with a refresh margin. Tokens and the four credential values are never written to database
rows, audit events, deployment logs, or API responses. It passes a unique Contabo `x-request-id` on
each request and uses a deterministic, visible idempotency marker in the instance display name for
lookup-before-create. It supports configuration validation, create/status, start/stop/shutdown/
restart, OS image lookup, in-place reinstall, and snapshots. Contabo's API expects SSH **Secret
ids** rather than raw public key strings; platform cloud-init still receives its customer SSH keys,
and provider-side injection is optional through trusted `providerSshKeyIds` metadata.

Contabo's documented cancellation endpoint schedules cancellation rather than immediately removing
an instance. CloudHost247 therefore refuses the platform's destructive `DELETE` operation for this
adapter rather than claiming a resource is gone or billing has stopped. Resize/product upgrades,
console URLs, metrics, and rescue mode are also explicitly unsupported until each has a safe,
operator-confirmed workflow. Do not enable production sales until the intended account's full
create/retry/reinstall/snapshot/lifecycle/health matrix has been exercised with a low-cost test
instance.

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

Server order creation atomically creates an `AWAITING_PAYMENT` server, order, and invoice; it does not call a provider. The verified settlement transaction re-reads the authoritative paid order, creates/reuses the subscription, and enqueues one PostgreSQL deployment using a unique idempotency key. The worker re-checks payment and ownership before creation. It also re-resolves the complete active/public product → plan → provider → region/datacenter → OS/version/architecture → verified image chain at claim time, so disabling or corrupting any compatibility row after payment fails closed before provider allocation. Provider resource IDs are persisted immediately; after a crash the worker checks both that ID and provider-side idempotency before creating anything.

Reinstall requires server ownership, provider/product capability, the literal confirmation `REINSTALL`, and a newly resolved active image for the server's provider and location. It is always queued and cannot change the existing server's hardware architecture. Existing resources may display EOL or archived OS versions, but those versions cannot be selected for a new deployment.

Enqueueing locks the server row and permits only one non-terminal infrastructure job per server.
The same `Idempotency-Key` returns the existing job; a different concurrent power, snapshot,
reinstall, resize, or delete request returns `409`. Migration 0052 also enforces this invariant
with a partial unique index, while cancel/retry transitions update the queue and provisioning rows
atomically.

## Observability, audit and infrastructure logs

| Endpoint | Purpose |
| --- | --- |
| `GET /api/v1/admin/provider-adapters` | Every adapter with the variables, plan metadata and capabilities it needs. |
| `GET /api/v1/admin/providers/:id/configuration` | Per-provider readiness: which variables are set, what is missing, how many verified images exist. Names and booleans only. |
| `GET /api/v1/admin/provisioning-jobs`, `/:id` | Job list and per-job steps, events and stage logs. |
| `POST /api/v1/admin/provisioning-jobs/:id/{retry,cancel}` | Operator recovery for failed or queued jobs. |
| `GET /api/v1/admin/provisioning-metrics` | Totals, success rate, average duration, retries, queue depth, jobs stalled over 30 minutes, failures grouped by error code, and per-provider job health. |
| `POST /api/v1/admin/os-lifecycle/sweep` | Applies a freshly entered end-of-life date immediately; the worker runs the same sweep hourly. |
| `GET /api/v1/admin/os-image-verifications` | Enabled or invalidated image mappings whose verification is stale, with the provider's reason. |
| `POST /api/v1/admin/os-images/revalidate` | Re-checks enabled mappings against their providers now; the worker runs the same sweep every 6 hours. |
| `GET /api/v1/admin/server-drift` | Servers whose recorded state disagreed with their provider, with what was adopted and what was only reported. |
| `POST /api/v1/admin/server-reconciliation/sweep` | Re-checks a batch of servers against their providers now; the worker runs the same sweep every 10 minutes. |
| `GET /api/v1/admin/notification-outbox` | Email delivery health: queued/delivered/failed counts plus the rows that are failing and why. |
| `POST /api/v1/admin/notification-outbox/drain` | Sends queued notification emails now; the worker runs the same drain every minute. |
| `POST /api/v1/admin/server-terminations/sweep` | Destroys servers whose scheduled cancellation is due; the worker runs the same sweep every 15 minutes. |
| `GET /api/v1/admin/infrastructure-logs` | Append-only audit trail filtered to infrastructure resources (`provider`, `region`, `datacenter`, `os_image`, `operating_system`, `operating_system_version`, `server_product_configuration`, `provisioning_job`, `server`), with `action`, `resourceId`, `limit` and `offset` filters. |

Infrastructure logs are a read-only projection of the existing `audit_logs` table — there is no
second logging system and no UI can edit or delete an entry. Failure classification is visible
in both places: configuration-class errors (`PROVIDER_NOT_CONFIGURED`, `CONFIGURATION_REQUIRED`,
`INVALID_CONFIGURATION`, `IMAGE_UNAVAILABLE`) are terminal and never retried automatically,
while transient errors (`RATE_LIMITED`, `PROVIDER_TIMEOUT`, `NETWORK_TEMPORARY_FAILURE`,
`INSUFFICIENT_CAPACITY`) are retried by the durable queue with backoff.

### What the customer sees

The server page carries a **Monitoring** panel fed by `GET /api/v1/servers/:id/health`: CPU, one
minute load, memory, disk, uptime and the moment the figures were measured. Every number comes
from an HMAC-authenticated agent report — nothing is inferred from the plan the customer bought.
A server that has never reported says so instead of rendering zeroes, and figures older than five
minutes are labelled as the last report received rather than the current state, because a silent
agent and an idle server look identical in a gauge.

## Image verification freshness

An image mapping used to be proven exactly once, when an operator pressed **Test** before
enabling it. The catalog then claimed it was deployable forever — including after the provider
deleted the snapshot, renamed the template or withdrew it from a region. The lie surfaced at the
worst possible moment: after a customer had paid, as a failed provisioning job.

`revalidateProviderImages` (worker every 6 hours; also `POST /api/v1/admin/os-images/revalidate`
and a **Re-check enabled mappings** button on the OS images page) re-asks the provider about the
stalest enabled mappings, oldest first.

| Finding | Action |
| --- | --- |
| Provider still offers the image | `verified_at` refreshed, mapping stays `ACTIVE` |
| Provider no longer offers it, or reports a different architecture | mapping set to `INVALID` with the reason, audited as `OS_IMAGE_INVALIDATED` |
| Provider unreachable, unconfigured, rate limited or timing out | **nothing changes** — an outage is not evidence that an image is gone, and emptying the catalog over it would be worse than the outage |

Because ordering and reinstall join through `ACTIVE` images with a non-null `verified_at`, an
invalidated mapping disappears from the customer flow immediately. Servers already running that
image are never touched — only the ability to sell it again is withdrawn. Only mappings an
operator enabled are re-checked: `DRAFT`, `DISABLED` and `INVALID` rows are left alone, and the
sweep never promotes anything to `ACTIVE` by itself.

## Provider state reconciliation

Health checks used to run exactly once, at provisioning time. After that the platform only
learned about a server's state when it changed that state itself — so a machine powered off from
the provider's own console, given a new IP, or destroyed outside CloudHost247 kept showing the
old state on the customer's dashboard indefinitely.

`reconcileServerState` (worker, every 10 minutes; also
`POST /api/v1/admin/server-reconciliation/sweep`) walks a bounded batch of servers oldest-checked
first — `servers.last_reconciled_at`, added by migration `0050_server_state_reconciliation.sql` —
and asks the provider what it actually has.

| Finding | Action | Applied? |
| --- | --- | --- |
| Provider reports a different power state | server set to `active`/`stopped` (`maintenance` is an operator decision and is never overwritten) | Yes |
| Provider reports a different IP | `servers.ip_address` updated | Yes |
| Provider reports a different image | recorded and audited only | **No** — rewriting the OS from a provider string would be guesswork, and the catalog is what we sold |
| Provider has no such resource | flagged `MISSING_AT_PROVIDER`; the row is **kept** for investigation | No |
| …and the platform was already `deleting` it | `TERMINATION_CONFIRMED`, server set to `retired` | Yes |
| Provider unreachable or unconfigured | `PROVIDER_UNREACHABLE`; the server record is untouched | No |

Every finding is written to `servers.metadata.reconciliation`, audited as `SERVER_DRIFT_<kind>`,
and listed under **Admin → Infrastructure → Infrastructure logs**. `last_reconciled_at` advances
even when a provider call fails, so one broken integration cannot starve the rest of the fleet.

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
`logo_url` is still `NULL` so operator branding is preserved. Admins may alternatively upload a
PNG, JPEG or WebP logo of at most 512 KiB. Migration 0051 stores it in PostgreSQL for multi-instance
and cPanel-safe delivery; the upload endpoint verifies magic bytes and records size/SHA-256/uploader,
then atomically points `logo_url` at the public cache/ETag-enabled logo route. Delete removes only
the uploaded asset and URL, while existing static URLs remain supported. A family without a logo
renders a text badge instead. A logo is never an installation image: installable artifacts exist
only in `server_os_images.provider_image_id` / `provider_template_id`.

## Customer notifications

In-app notifications are durable and written in the same flow as the event that caused them;
email is an optional bridge that never blocks that flow and never fakes the in-app record.

| Type | Raised when | Shown as |
| --- | --- | --- |
| `SERVER_READY` | a provisioning job reaches READY after every health gate | success notice with the server link |
| `SERVER_REINSTALLED` | a reinstall job completes and the new OS is attested | success notice |
| `OS_EOL_WARNING` | the lifecycle sweep moves a version the customer runs to EOL_WARNING | warning notice, one per server |
| `OS_EOL` | the lifecycle sweep moves that version to EOL | end-of-life notice, one per server |
| `SERVER_TERMINATED` | a DELETE job finishes and the provider resource is gone | termination notice confirming billing has stopped |

### Email delivery

Email is **queued, never sent inline**. `createNotification` writes the in-app row and a
`notification_outbox` row atomically in one data-modifying SQL statement; the worker drains the outbox every minute
(`deliverNotificationOutbox`). Two things that used to be broken are now guaranteed: a slow or
dead mail webhook cannot stall the worker that is finishing a customer's server, and a delivery
that fails is retried instead of being lost after one attempt.

| Outcome | State | Retried? |
| --- | --- | --- |
| Webhook not configured | `CONFIGURATION_REQUIRED` | Yes, every 15 minutes, and **without** consuming the attempt budget — configuring the variables later delivers the backlog |
| `401`/`403` from the webhook | `CONFIGURATION_REQUIRED` | Yes, on the same free schedule — a rejected credential is the operator's to fix |
| `408`, `429`, `5xx`, network error | `PENDING` | Yes, backoff 1 → 5 → 15 → 60 → 240 minutes, up to `max_attempts` (default 6), then `FAILED` |
| Any other `4xx` | `FAILED` | No — a rejected payload will not become valid by repeating it |
| `2xx` | `DELIVERED` | Never re-sent |

Claiming pushes a row's `next_attempt_at` forward before the HTTP call, so two workers never send
the same email. Operators see the backlog and every failure reason under
**Admin → Infrastructure → Infrastructure logs**; nothing is silently dropped. Migration
`0049_notification_outbox_delivery_scheduling.sql` adds the scheduling columns and re-arms rows
that had been parked only because nothing was configured.

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
- `capabilities`, the provider-supported action set used to gate the server detail page and API
  (`start`, `stop`, `reboot`, `shutdown`, `reinstall`, `snapshot`, `resize`, `rescue`, `console`),
  subject to additional billing gates such as the resize restriction below.

`capabilities` is checked against the provider's adapter profile before the row is saved: a
template cannot offer `reinstall`, `snapshot`, `resize`, `console` or `rescue` unless that adapter
actually implements it. Otherwise the customer would be shown a button whose only possible
outcome is a failed job, discovered after they clicked it. Power actions (`start`, `stop`,
`reboot`, `shutdown`) are implemented by every adapter and are always available. The admin form
hides or disables whatever the selected provider cannot do and lists what it can.

Two surfaces deliberately remain unavailable rather than pretending that database state changes
infrastructure:

- `firewall` cannot be advertised on a template and all customer firewall endpoints fail closed
  until a provider adapter or authenticated server-agent firewall operation actually applies and
  verifies rules. Existing `firewall_rules` rows are compatibility/audit data, not proof of an
  active network policy.
- self-service `resize` never accepts customer-supplied provider sizing metadata. `POST
  /api/v1/servers/:id/resize` accepts only a target plan id and creates an invoice from server-side
  catalogue data. It supports non-destructive, same-product plan increases only: the exact original
  order-item amount is credited against the currently published target-plan price. After verified
  payment, the worker re-resolves the target provider/image/template before it calls the provider.
  The local plan, resource limits, provider plan metadata, and matching subscription change only
  after that provider action succeeds. Downgrades, proration, and legacy servers without an
  immutable source-order price snapshot remain deliberately unavailable rather than estimating a
  charge or allowing an unbilled resize.

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

## Rescue mode

A server that no longer boots cannot be repaired from inside itself. Rescue mode boots it from
the provider's own rescue system with the disks attached but not running, so the customer can
repair a broken filesystem, bootloader or configuration.

`POST /api/v1/servers/:id/rescue` (confirmation `RESCUE`) enters it; `DELETE` on the same path
leaves it and reboots back into the installed operating system. Both are owner-only, capability
gated, and audited as `SERVER_RESCUE_ENTERED` / `SERVER_RESCUE_EXITED`. While rescue is active the
server is `maintenance`, which is the honest state — it is up, but it is not running the
customer's OS — and `servers.metadata.rescue` records when it was entered and which rescue system
was booted.

Two deliberate constraints:

- **Only adapters with a real rescue API may offer it.** Hetzner (`enable_rescue` + `reset`) and
  OpenStack (Nova `rescue` / `unrescue`) implement it; every other adapter refuses with a
  non-retryable `UNSUPPORTED_OPERATION`, and their profile capability stays `false` so a template
  cannot offer the button in the first place. A rescue that silently did nothing would strand a
  customer who believes they are about to repair a disk.
- **The one-time root password is never stored.** Like the console session, it runs in request
  scope and is returned only to the browser that asked for it — never a job payload, a log line,
  an audit row or a database column. Reloading the page does not show it again; leaving and
  re-entering rescue asks the provider for a new one. This is asserted by
  `tests/integration/server-rescue.test.ts`, which greps our own storage for the credential.

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

Record provider request IDs and job/audit IDs outside customer-visible logs. Real credentials and
this live acceptance are intentionally not part of repository tests.

The same sequence — order, payment, queued job, provider create, health gates, `READY`,
notification, then a confirmed reinstall onto Debian 13 that moves the catalog OS recorded against
the server — runs against a stub adapter on every test run in
`tests/integration/server-reinstall-acceptance.test.ts`. It also asserts the two ways the flow must
refuse: an unconfirmed or non-owner reinstall never creates a job, and a reinstall that fails at
the provider leaves the previously installed OS recorded rather than advertising one the server is
not running. What that test cannot prove is that a real provider behaves as the stub does — which
is what the live run above is for.

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

