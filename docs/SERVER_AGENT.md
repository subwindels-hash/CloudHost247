# Server Agent — operations and security model

The agent source lives in `/server-agent/` (its own package, zero npm dependencies, Node ≥ 20).
See `/server-agent/README.md` for install instructions and the request-authentication spec.
This document is the operator-facing companion: what the agent can and cannot do, and how to
run it safely.

## Threat model, explicitly

The control plane authenticates every request with HMAC-SHA256 over
`agentId\ntimestamp\nnonce\nMETHOD\npath\nsha256(body)` with a ±60s window and nonce replay
protection (`src/deployments/agent-protocol.ts` ⇄ `server-agent/src/auth.js` — one protocol,
two files, change them together). A leaked URL, a replayed capture, or a stale request all
fail closed.

Two test suites hold that boundary, and both run in the release candidate:

- `server-agent/tests/auth.test.js` (`node --test`, no dependencies) covers the agent's own
  verification: mandatory headers, agent-id binding, the skew window in both directions, nonce
  replay, body/method/path tampering, the nonce cache, and the outbound signing path.
- `cloudhost247-node/tests/integration/agent-protocol-conformance.test.ts` imports both
  implementations and proves they are one protocol by cross-verifying signatures in both
  directions. It exists because a drift between the two files is not cosmetic: every deployment
  on every customer server would fail closed at once and look like an authentication fault
  rather than a version mismatch.

**Nonce generation (fixed 2026-10-03).** The agent's outbound `signOutbound()` derived its nonce
from `Math.random()` — a predictable PRNG, while this document and the control-plane mirror both
specify "random 16-byte hex per request". It now uses `randomBytes(16)` from `node:crypto`, and a
static regression guard fails the suite if `Math.random()` reappears anywhere in the agent.

What an attacker who fully compromises the control plane's agent secret can do is **exactly**
the fixed operation set below, on that one server, while that credential is current — and
nothing else:

| Can | Cannot |
| --- | --- |
| deploy/teardown/start/stop/restart one compose project | execute arbitrary commands |
| read that project's logs / status | read the filesystem (paths are derived, validated `^[a-z0-9][a-z0-9_-]{3,63}$`) |
| run the manifest-declared health probe | open the Docker API to the network (`DOCKER_HOST`/TCP is never configured) |
| create/restore a tar.gz backup locally | reach object-storage credentials (they live only in the control plane) |
| report system metrics | read other servers' data, platform secrets, or the database |

Rotation is instant: `POST /api/v1/admin/servers/:id/rotate-credentials` stores a new secret,
re-encrypts every envelope under the new key version, and returns the secret exactly once. The
old secret stops working the moment the agent is restarted with the new value.

## Deployment layout on a server

```
/opt/cloudhost247/
├── agent/            # the agent itself (runs as the cloudhost-agent user)
├── apps/<project>/   # one directory per installation
│   ├── compose.yaml  # generated from the manifest; regenerated on update
│   ├── .env          # 0600, this project's secrets only
│   └── volumes/      # bind-mounted data + logical DB dumps
└── backups/          # tar.gz archives with sha256 checksums
```

`<project>` is the platform-assigned `container_project` (e.g. `c1a2b3c4-inst9f8e7`) —
per-customer isolation (spec §32): each project gets its own compose project name, network,
and volumes; Traefik routes only its `app` service, only when a domain is attached.

## Metrics and health

- The agent reports CPU / memory / disk / load / uptime / container counts every 60s
  (`CH247_REPORT_SECONDS`) to `POST /api/v1/agent/report`; snapshots land in `server_metrics`.
- A server whose agent has not been seen in 5 minutes is shown as not reachable
  (`GET /api/v1/servers/:id/health`).
- **`monitoringRunning` is evidence, not a constant.** The provisioning health gate refuses to hand a
  server to a customer until a fresh report says `securityConfigured === true` **and**
  `monitoringRunning === true`, so that field has to mean something. It reports whether the agent
  could actually produce the readings above on this host — Docker reachable (container counts) and
  `/proc/stat` readable (CPU %) — and a host where either is unavailable reports `false` and stays
  unprovisioned. It was previously the literal `true` on every host, including hosts with no
  monitoring of any kind; nothing in this repository installs a monitoring agent, so the gate's
  monitoring condition was satisfied by a constant. If a host fails this gate, the fix is to make its
  agent's readings work (Docker socket access, readable `/proc`), not to relax the gate.
- Out-of-band health transitions (e.g. a container crash-loop the scheduler didn't cause) are
  pushed to `POST /api/v1/agent/health` and recorded on the installation.

## Backups

On-server: `POST /v1/apps/:project/backup` (agent) archives the project tree plus a logical database
dump when a database service exists. Off-server: the control plane's backup job uploads archives to
S3/R2 (`BACKUP_S3_*`) and records the object path — the agent never sees those credentials. Retention
comes from `platform_settings.backup.retention_days`. Restores run through the deployment pipeline
like any other action (audited, cancelable while queued, rollback on failure).

**What is actually dumped.** The agent reads the real service list from `docker compose config
--services` and probes each service with `pg_dumpall`, `mysqldump`, `mariadb-dump`, then
`mongodump --archive`, taking the first that produces output. It identifies the engine by what runs,
not by the service's name: service names are free-form slugs in the manifest schema, so assuming a
service called `db` meant a database whose service was named anything else was dumped by nobody.
`mongodump` output is BSON and is captured as a buffer — decoding it as text would corrupt it.

**The reply says what the archive holds**, and a requested dump that produced nothing is reported
rather than implied:

```json
{ "archivePath": "…", "sizeBytes": 4096, "checksum": "…",
  "includes": { "volumes": true, "databases": "postgres" },
  "databaseDump": { "engine": "postgres", "service": "db", "file": "…/db-dump-postgres.sql" } }
```

On the failure path `databaseDump` is `{ engine: null, service: null, file: null, reason,
services?, attempted? }`, `includes.databases` is `null`, and the docker adapter writes a `warn` line
into the deployment log naming the reason and every engine/service it tried. That is deliberately a
warning and not a failure: the platform cannot know whether a service runs an engine with a logical
dump at all (`redis` is allowed by the manifest schema and persists in the volume tar, which is always
part of the archive). An agent older than this contract omits `databaseDump` entirely, and the adapter
treats *absent* as *unknown* — never as a missing dump.

**File modes.** The archive is created 0600 *before* `tar` runs. It deliberately contains the project's
`.env`, and `tar` creates its output from the process umask (0644 for the usual 022), so fixing the
mode afterwards would leave every application secret readable by any local user for the duration of
the archive. `tar` truncates an existing file and keeps its mode, so pre-creating it closes the window;
the post-run `chmod` is defence in depth.

**Restore** (`POST /v1/apps/:project/restore`) refuses an archive that is not a readable gzip tar,
refuses an archive with no members, and refuses absolute or `..` member paths — all before anything is
written. It lists the archive first and returns the member count it applied. Without that pass,
`tar -xzf` on a truncated archive extracted what it could and exited 0, so the control plane recorded a
successful restore of a project that had been only partly replaced; on an empty archive it wrote
nothing and still reported success.

**Known gap, not fixed here:** restores extract over a *running* project — the deployment pipeline does
not stop the app first, so a restore can write volume data under live containers. That is a
control-plane pipeline decision (stop → restore → start), not an agent one, and it is recorded as an
open item in `docs/UNFINISHED-MODULES.md`.

## Failure modes and recovery

- **Agent down**: deployments targeting that server fail with `AGENT_UNREACHABLE`, retry with
  backoff to `max_attempts`, and surface in the customer console and admin deployment list.
- **Worker dies mid-job**: the lease expires; `recoverOrphanedJobs` reassigns it and the
  customer sees a "recovered after lease expiry" event.
- **Server retires**: admin sets the server to `retired` — the registry keeps history; deletion
  is refused while installations reference it.
- **Bad manifest**: the engine re-validates the stored manifest before executing; invalid
  manifests fail the job with `MANIFEST_INVALID` before touching infrastructure.
