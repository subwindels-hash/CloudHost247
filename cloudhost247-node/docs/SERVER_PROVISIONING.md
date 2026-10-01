# CloudHost247 server provisioning

This document describes the production boundary for the operating-system catalog and infrastructure
provisioning system. It is intentionally explicit about what CloudHost247 knows, what an operator
must configure, and what local development is allowed to simulate.

## Domain model

The server catalog is database-managed. These records are deliberately separate:

- `operating_systems` describes an OS family, lifecycle, product support, logo, and `/etc/os-release`
  identifiers.
- `operating_system_versions` describes a release, lifecycle dates, supported architectures, and
  default/recommended flags.
- `infrastructure_providers` describes the provider and the selected server-side adapter.
- `infrastructure_regions` and `infrastructure_datacenters` describe provider locations.
- `server_os_images` maps one OS version and architecture to a provider image or template identifier,
  optionally scoped to a region or datacenter. A logo URL is never used as an image identifier.
- `server_product_configurations` is the exact purchasable tuple of plan, provider, location, OS
  version, architecture, and server type. A tuple is not orderable until its mapping is verified,
  active, and compatible.
- `servers` stores the customer's selected catalog version, architecture, provider, location, and
  mapping. Existing servers whose OS cannot be safely identified retain the explicit `Unknown`
  catalog record rather than being guessed.

The customer UI reads this catalog through the public configuration API. It does not contain a
hard-coded OS list.

## Payment and queue boundary

A server order creates an unpaid order, invoice, and local server placeholder. It does **not** call a
provider. Only the verified payment settlement path can enqueue `PROVISION` in the existing
PostgreSQL-backed deployments queue. The worker then creates a `provisioning_jobs` record and runs
provider work asynchronously.

Provisioning and reinstall jobs are idempotent and retry-aware:

1. revalidate the paid order, ownership, plan, location, OS version, architecture, and image;
2. validate provider credentials and image availability;
3. find a previously-created provider resource by the job idempotency key before creating one;
4. persist the provider resource ID immediately;
5. install/configure the selected image, hostname, customer SSH keys, security baseline, and agent;
6. require provider, power, IP, image, SSH, and fresh authenticated agent evidence;
7. only then persist `READY`, the final IP, and the selected OS mapping, and send the ready notice.

Provider failures are classified as permanent or transient. Transient failures use the queue's retry
and lease mechanism. Configuration, authentication, invalid-image, ownership, and unsupported
operation failures fail closed and are visible in the job logs. A provider response, IP address, or
`READY` state is never invented by the API or worker.

OS reinstall is destructive. It requires the literal `REINSTALL` confirmation, is ownership
protected, cannot change architecture, resolves the target mapping on the server, and goes through
the same durable job and health gates. A failed reinstall leaves the previously recorded OS in place.

## Provider configuration

Provider credentials are read only by the API/worker process from environment variables. They are
never accepted in catalog forms, returned by configuration endpoints, sent to the browser, placed in
seed data, included in emails, or written to provisioning logs. The admin configuration endpoint
returns only variable names and presence booleans.

A provider row may set `credential_env_prefix` to use a deployment-specific prefix. If it is empty,
the adapter's default prefix is used. The API and worker must receive the same environment. Provider
rows are created disabled/configuration-required and can be activated only after adapter validation.
Missing credentials still fail closed at execution time if the environment changes after activation.

Supported native adapters and their principal configuration are:

| Adapter | Default prefix | Required configuration |
| --- | --- | --- |
| Hetzner Cloud | `HETZNER` | `<PREFIX>_API_TOKEN` |
| OVHcloud Public Cloud | `OVH` | application key, application secret, consumer key, and cloud project ID |
| Proxmox VE | `PROXMOX` | HTTPS API URL and API token |
| Virtualizor | `VIRTUALIZOR` | HTTPS API URL, API key, and API secret |
| SolusVM 1 | `SOLUSVM` | HTTPS API URL, API ID, and API key/token |
| OpenStack | `OPENSTACK` | Keystone password login or Nova endpoint plus pre-issued API token |
| DigitalOcean | `DIGITALOCEAN` | API token |
| Vultr | `VULTR` | API key |
| Operator bridge (`generic_http`) | `PROVIDER_BRIDGE` or custom | HTTPS bridge URL and bearer API token |

Provider-specific resource identifiers such as a flavor, plan, node, network, or storage belong in
admin-managed plan/provider metadata. They are not customer-controlled provider credentials. The
provider bridge is a real remote integration contract; it is not a fallback simulator.

Native AWS and Contabo entries are intentionally configuration-visible but fail closed in this
release because their complete native lifecycle is not enabled. Use a separately configured and
tested `generic_http` bridge if that is the operator's integration boundary; do not mark an
unimplemented native adapter active.

All provider API URLs carrying credentials must use HTTPS. Loopback HTTP is permitted only for an
operator's local development tunnel. Self-hosted providers should use their provider row's
`api_base_url`; public-provider adapters have safe defaults but still permit an explicit URL.

The complete variable list is maintained in `.env.example` and in the admin adapter configuration
screen. At minimum, real server provisioning also requires:

- `APP_URL`, so the agent can report to the control plane;
- `SERVER_AGENT_INSTALL_URL`, pointing to an operator-published authenticated agent installer;
- `PROVISIONING_HEALTH_TIMEOUT_MS`, if the default health wait is not appropriate; and
- the existing notification/email configuration if ready email delivery is desired.

## Development and mock-provider boundary

The mock provider is not a production provider and is never selected automatically. It can be used
only when all of the following are true:

- `NODE_ENV` is not `production`;
- `ALLOW_MOCK_PROVIDER=true` is present in the process environment; and
- an administrator explicitly registers a provider with both `provider_type=MOCK` and
  `adapter=mock`.

A missing credential on a real provider never falls back to the mock adapter. Mock resources are
process-local, use `mock-` identifiers and documentation-range addresses, and carry `mock: true`
metadata. They are suitable for CI and local queue-flow tests only; they are not evidence that a
real provider was contacted and must not be used to validate production capacity or availability.

The tests inject a provider adapter at the service boundary when they need deterministic health or
failure scenarios. That test seam is not used by browser requests or production worker startup.

## Operations and secrets

Power actions, snapshots, rescue, console sessions, termination, and reinstall are ownership- and
capability-checked. Destructive actions are queued where a durable provider operation is required.
Short-lived console/rescue credentials are returned only to the authenticated owner that requested
them; they are not persisted or audited. Audit records contain action, resource, actor, and safe
metadata, not provider tokens, private SSH keys, cloud-init, or one-time passwords.

The worker periodically revalidates enabled image mappings, reconciles provider state, runs OS
lifecycle sweeps, and drains the existing notification outbox. Provider outages do not silently
remove catalog data or turn an unknown state into success. Operators can inspect provisioning steps,
error codes, retries, sanitized provider evidence, queue depth, failures by code, provider health,
state drift, and infrastructure audit logs from the admin infrastructure screens.

## Local verification

From `cloudhost247-node`:

```bash
npm run typecheck
npm exec vitest run tests/integration/provisioning-health-and-images.test.ts
npm exec vitest run tests/integration/server-reinstall-acceptance.test.ts
npm exec vitest run tests/integration/infrastructure-admin-operations.test.ts
```

Use real provider credentials and a real, verified image mapping only in an operator-controlled
integration environment. Never add credentials, provider image identifiers that are treated as
secrets, customer SSH private keys, or provider response dumps to the repository.
