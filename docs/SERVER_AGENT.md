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
- Out-of-band health transitions (e.g. a container crash-loop the scheduler didn't cause) are
  pushed to `POST /api/v1/agent/health` and recorded on the installation.

## Backups

On-server: `POST /v1/apps/:project/backup` (agent) archives the project tree plus a
`pg_dumpall` / `mysqldump` when a database service exists. Off-server: the control plane's
backup job uploads archives to S3/R2 (`BACKUP_S3_*`) and records the object path — the agent
never sees those credentials. Retention comes from `platform_settings.backup.retention_days`.
Restores run through the deployment pipeline like any other action (audited, cancelable while
queued, rollback on failure).

## Failure modes and recovery

- **Agent down**: deployments targeting that server fail with `AGENT_UNREACHABLE`, retry with
  backoff to `max_attempts`, and surface in the customer console and admin deployment list.
- **Worker dies mid-job**: the lease expires; `recoverOrphanedJobs` reassigns it and the
  customer sees a "recovered after lease expiry" event.
- **Server retires**: admin sets the server to `retired` — the registry keeps history; deletion
  is refused while installations reference it.
- **Bad manifest**: the engine re-validates the stored manifest before executing; invalid
  manifests fail the job with `MANIFEST_INVALID` before touching infrastructure.
