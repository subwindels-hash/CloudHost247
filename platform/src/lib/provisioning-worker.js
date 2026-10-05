/**
 * The provisioning worker: executes queued jobs against the provider that owns the machine.
 *
 * `domains/servers.js` records lifecycle actions as `provisioning_jobs` rows, and until this module
 * existed nothing read them — the admin reconcile route failed every non-terminal job with
 * "reconciled: no active worker", so a customer's reboot was a row that went red. This is the thing
 * that makes the queue mean something.
 *
 * Four properties it is built to hold, each pinned by `tests/provisioning-worker.test.js`:
 *
 *  1. **Idempotent creation.** `createServer` is called with the *job id* as the idempotency key, so
 *     a crash between the provider call and the local write cannot allocate a second billable
 *     machine — the adapter's own lookup-before-create finds the first one.
 *  2. **A refusal is not a retry.** `ProviderError.retryable` decides between re-queueing with
 *     backoff and dead-lettering. An `UNSUPPORTED_OPERATION` or a rejected credential is final;
 *     retrying it would only burn attempts.
 *  3. **Secrets never land on the job row.** `result` is readable through the admin API, so it goes
 *     through `sanitizeProviderResponse` before it is stored. A rescue password is written to
 *     `server_credentials` — write-only, like every other server secret — and is redacted from the
 *     job.
 *  4. **An unknown job kind fails by name.** It is never marked complete: a job this worker does not
 *     understand is a bug or a new feature, and silently succeeding would hide both.
 *
 * **Known limit, stated rather than papered over.** Claiming happens inside `store.transaction()`
 * with a lease, which is a single-writer guarantee within one process. The store abstraction exposes
 * no `SELECT … FOR UPDATE`, so a deployment running more than one worker process needs row-level
 * locking (or a claim row with a unique constraint, the way `provider-webhook-service.js` claims
 * events) before it can run more than one. This build runs one.
 *
 * What is not claimed: no call has been made to a real provider account, so provider-side acceptance
 * of these requests is unverified.
 */
'use strict';

const { uuidv7 } = require('./ids');
const { ProviderError } = require('./providers/types');
const { sanitizeProviderRecord } = require('./providers/sanitize');
const {
  resolveProviderAdapter, resolveOwningProvider, resolveServerProvider, describeProvider,
} = require('./provider-egress');

/** How long a claimed job may run before another cycle is allowed to take it over. */
const JOB_LEASE_MS = 5 * 60 * 1000;
/** Attempts before a still-retryable failure is dead-lettered instead of re-queued. */
const MAX_ATTEMPTS = 3;
const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);

/**
 * Job kind → the provider capability it needs.
 *
 * This is the single source of truth shared with `domains/servers.js`, which refuses to *queue* an
 * action the provider does not perform. One map for both means the queue-time gate and the worker
 * cannot drift apart — the same failure mode the EC2 reinstall opt-in was fixed for.
 */
const PROVISIONING_CAPABILITY = Object.freeze({
  RESIZE: 'resize',
  SNAPSHOT_CREATE: 'snapshot',
  SNAPSHOT_DELETE: 'snapshot',
  SNAPSHOT_RESTORE: 'snapshot',
  REINSTALL: 'reinstall',
  REBUILD: 'reinstall',
  RESCUE_ENABLE: 'rescue',
  RESCUE_DISABLE: 'rescue',
  CONSOLE: 'console',
  METRICS: 'metrics',
});

/** A failure that is ours to fix or the operator's, not the provider's. Never retried. */
class JobRefusal extends Error {
  constructor(reason, code = 'JOB_REFUSED') {
    super(reason);
    this.name = 'JobRefusal';
    this.code = code;
  }
}

/**
 * The `planMetadata` an adapter needs: the plan's provider-specific spec, not our own display
 * columns. A plan with no `providerServerType` is refused rather than guessed at, because guessing
 * provisions the wrong machine and bills the customer for it.
 */
async function planMetadataFor(store, planId) {
  if (!planId) throw new JobRefusal('The job names no plan, so there is no provider plan metadata to send');
  const plan = await store.table('server_plans').findById(planId);
  if (!plan) throw new JobRefusal(`Plan ${planId} no longer exists`);
  const spec = plan.spec && typeof plan.spec === 'object' ? plan.spec : {};
  if (!spec.providerServerType) {
    throw new JobRefusal(`Plan "${plan.name}" has no providerServerType in its spec, so the provider cannot be told what to build`);
  }
  return spec;
}

/** The OS image row a server should be built from, or a refusal naming what is missing. */
async function imageFor(store, server) {
  const images = await store.table('os_images').all();
  const candidates = images.filter((image) => image.os_id === server.os_id);
  if (candidates.length === 0) {
    throw new JobRefusal('The server names an operating system that has no image mapping at all');
  }
  const match = candidates.find((image) => image.region_id === server.region_id)
    ?? candidates.find((image) => !image.region_id);
  if (!match) throw new JobRefusal('No image mapping covers this server\'s region');
  if (!match.provider_image_id) {
    throw new JobRefusal('The image mapping has no provider image id, so there is nothing to ask the provider to boot');
  }
  if (!match.verified_at) {
    // Verification is what proves the provider actually has this image. Building from an unverified
    // mapping is how a customer ends up with a machine that never boots.
    throw new JobRefusal('The image mapping has not been verified against the provider; verify it before provisioning');
  }
  return match;
}

/** Store a provider-issued secret where server secrets live: write-only, never returned by an API. */
async function recordRescueCredential(store, server, session) {
  if (!session || typeof session.password !== 'string' || session.password.length === 0) return false;
  await store.table('server_credentials').insert({
    id: uuidv7(), server_id: server.id, kind: 'rescue',
    username: session.username ?? 'root', secret: session.password,
    created_at: new Date().toISOString(),
  });
  return true;
}

/**
 * Executes one claimed job. Returns the evidence to record; it does not write the job row, so the
 * caller owns the state transition.
 */
async function executeJob(deps, job) {
  const { store, config = {} } = deps;
  const kind = String(job.kind ?? '');

  if (!job.server_id) throw new JobRefusal('The job names no server, so there is nothing to act on');
  const server = await store.table('servers').findById(job.server_id);
  if (!server) throw new JobRefusal(`Server ${job.server_id} no longer exists`);

  // CREATE is the one kind that runs before a provider handle exists, so it resolves the provider
  // from the region rather than from the machine.
  const owning = await resolveOwningProvider(store, server, config);
  if (!owning.provider) throw new JobRefusal(owning.reason);
  const { provider, region, description } = owning;

  const capability = PROVISIONING_CAPABILITY[kind];
  if (capability) {
    const capabilities = describeProvider(provider, config).capabilities ?? {};
    if (capabilities[capability] === false) {
      throw new JobRefusal(`The ${description.label} provider does not offer ${capability} through its API`);
    }
  }

  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  let adapter;
  try {
    ({ adapter } = resolveProviderAdapter(provider, { config }));
  } catch (error) {
    // Not configured is final: no amount of retrying supplies a missing credential.
    throw new JobRefusal(error.message ?? 'The provider is not configured', 'PROVIDER_NOT_CONFIGURED');
  }

  const handle = job.kind === 'CREATE' ? null : (await resolveServerProvider(store, server, config)).providerServerId;
  if (!handle && kind !== 'CREATE') {
    throw new JobRefusal('This platform holds no provider record for that server, so no provider action can be sent to it');
  }

  switch (kind) {
    case 'CREATE': {
      const image = await imageFor(store, server);
      const planMetadata = await planMetadataFor(store, server.plan_id);
      const created = await adapter.createServer({
        // The job id is the idempotency key: it is stable across retries, so a crash after the
        // provider call cannot allocate a second machine.
        idempotencyKey: job.id,
        name: server.hostname ?? server.name ?? `cloudhost247-${job.id.slice(-8)}`,
        planMetadata,
        image,
        regionCode: region.code,
        userData: undefined,
      });
      await store.table('servers').updateById(server.id, {
        ip_address: created.ipAddress ?? server.ip_address ?? null,
        status: 'active',
        metadata: { ...(server.metadata ?? {}), providerServerId: String(created.id) },
        updated_at: new Date().toISOString(),
      });
      return { status: 'completed', result: sanitizeProviderRecord({ providerServerId: String(created.id), providerStatus: created.status ?? null, ipAddress: created.ipAddress ?? null }) };
    }

    case 'START':
      await adapter.startServer(handle);
      await store.table('servers').updateById(server.id, { status: 'active', updated_at: new Date().toISOString() });
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'start' }) };

    case 'STOP':
    case 'SHUTDOWN':
      await adapter.shutdownServer(handle);
      await store.table('servers').updateById(server.id, { status: 'stopped', updated_at: new Date().toISOString() });
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'shutdown' }) };

    case 'REBOOT':
      await adapter.rebootServer(handle);
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'reboot' }) };

    case 'DELETE': {
      await adapter.deleteServer(handle);
      await store.table('servers').updateById(server.id, {
        status: 'terminated', metadata: { ...(server.metadata ?? {}), terminatedAt: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'delete', providerServerId: handle }) };
    }

    case 'RESIZE': {
      const planMetadata = await planMetadataFor(store, payload.targetPlanId ?? server.plan_id);
      const resized = await adapter.resizeServer(handle, planMetadata);
      await store.table('servers').updateById(server.id, {
        plan_id: payload.targetPlanId ?? server.plan_id, updated_at: new Date().toISOString(),
      });
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'resize', providerStatus: resized?.status ?? null }) };
    }

    case 'SNAPSHOT_CREATE': {
      const snapshot = await adapter.createSnapshot(handle, payload.description ?? null);
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'snapshot_create', snapshot }) };
    }

    case 'SNAPSHOT_DELETE': {
      if (!payload.snapshotId) throw new JobRefusal('The job names no snapshot to delete');
      await adapter.deleteSnapshot(handle, payload.snapshotId);
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'snapshot_delete', snapshotId: payload.snapshotId }) };
    }

    case 'SNAPSHOT_RESTORE': {
      if (!payload.snapshotId) throw new JobRefusal('The job names no snapshot to restore');
      await adapter.restoreSnapshot(handle, payload.snapshotId);
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'snapshot_restore', snapshotId: payload.snapshotId }) };
    }

    case 'REINSTALL':
    case 'REBUILD': {
      const image = await imageFor(store, server);
      const planMetadata = server.plan_id ? (await store.table('server_plans').findById(server.plan_id))?.spec ?? {} : {};
      const method = kind === 'REINSTALL' ? 'reinstallServer' : 'rebuildServer';
      await adapter[method]({
        providerServerId: handle, image, planMetadata,
        regionCode: region.code, idempotencyKey: job.id,
      });
      return { status: 'completed', result: sanitizeProviderRecord({ action: kind.toLowerCase() }) };
    }

    case 'RESCUE_ENABLE': {
      const session = await adapter.enableRescue(handle, {});
      // The password is the customer's only way into rescue mode, and `job.result` is readable
      // through the admin API — so it goes to the write-only credentials table and is redacted here.
      const stored = await recordRescueCredential(store, server, session);
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'rescue_enable', credentialStored: stored, type: session?.type ?? null }) };
    }

    case 'RESCUE_DISABLE':
      await adapter.disableRescue(handle);
      await store.table('servers').updateById(server.id, { status: 'active', updated_at: new Date().toISOString() });
      return { status: 'completed', result: sanitizeProviderRecord({ action: 'rescue_disable' }) };

    default:
      // Never mark an unknown kind complete: that would hide a bug or an unimplemented feature
      // behind a green job row.
      throw new JobRefusal(`No worker handler is implemented for job kind "${kind}"`, 'UNKNOWN_JOB_KIND');
  }
}

/**
 * Whether a job may be claimed now: queued, or claimed by a cycle that died and let its lease
 * expire. A terminal job is never touched, and a lease that has not expired belongs to its holder.
 *
 * The table has no `metadata` column to hang a lease token on, so `started_at` *is* the lease: a
 * running job is reclaimable once it has been running longer than the lease. Re-claiming refreshes
 * `started_at`, which costs the original start timestamp and buys the only property that matters —
 * a job cannot be stranded behind a worker that no longer exists.
 */
function isClaimable(job, nowMs) {
  if (TERMINAL_STATUSES.includes(job.status)) return false;
  if (job.status === 'queued') return true;
  const startedAt = job.started_at ? Date.parse(job.started_at) : NaN;
  if (!Number.isFinite(startedAt)) return true;
  return nowMs - startedAt > JOB_LEASE_MS;
}

/**
 * Claim one job. The re-read inside the transaction is what makes a double claim fail loudly rather
 * than silently: if the row is no longer claimable, the claim is abandoned.
 */
async function claimNextJob(store, limit = 25, exclude = new Set()) {
  const nowMs = Date.now();
  const rows = (await store.table('provisioning_jobs').all())
    .filter((job) => isClaimable(job, nowMs) && !exclude.has(job.id))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .slice(0, limit);
  if (rows.length === 0) return null;
  const candidate = rows[0];

  return store.transaction(async (tx) => {
    const jobs = tx.table('provisioning_jobs');
    const fresh = await jobs.findById(candidate.id);
    if (!fresh || !isClaimable(fresh, nowMs)) return null;
    return jobs.updateById(fresh.id, {
      status: 'running',
      attempts: (fresh.attempts ?? 0) + 1,
      started_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    });
  });
}

/**
 * Run one job to a terminal outcome. A retryable provider failure is re-queued until attempts run
 * out; everything else is dead-lettered with the reason on the row.
 */
async function runJob(deps, job) {
  const { store, logger } = deps;
  const finish = async (patch) => {
    const updated = await store.table('provisioning_jobs').updateById(job.id, {
      ...patch, finished_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    return updated;
  };

  try {
    const outcome = await executeJob(deps, job);
    const updated = await finish({ status: 'completed', result: outcome.result ?? null, error: null });
    return { jobId: job.id, kind: job.kind, outcome: 'completed', job: updated };
  } catch (error) {
    const retryable = error instanceof ProviderError ? Boolean(error.retryable) : false;
    // `claimNextJob` already incremented attempts, so the claimed row's count is this attempt's
    // number — adding one here would dead-letter a job one attempt early.
    const attempts = job.attempts ?? 1;
    const exhausted = attempts >= MAX_ATTEMPTS;
    const reason = error.message ?? 'The provider action failed';

    logger?.warn(
      { jobId: job.id, kind: job.kind, attempts, retryable, code: error.code ?? 'JOB_REFUSED', reason },
      'provisioning job failed',
    );

    if (retryable && !exhausted) {
      const updated = await finish({
        status: 'queued', error: reason, finished_at: null,
        // No metadata column on this table, so the failure evidence rides on `result` — which is
        // sanitized, because a provider's error body can name internal endpoints.
        result: sanitizeProviderRecord({
          lastFailure: { at: new Date().toISOString(), retryable: true, code: error.code ?? null },
        }),
      });
      return { jobId: job.id, kind: job.kind, outcome: 'requeued', attempts, job: updated };
    }

    const updated = await finish({
      status: 'failed', error: reason,
      result: sanitizeProviderRecord({ failure: { code: error.code ?? 'JOB_REFUSED', retryable, attempts } }),
    });
    return {
      jobId: job.id, kind: job.kind,
      outcome: retryable ? 'dead_lettered' : 'failed',
      attempts, job: updated,
    };
  }
}

/**
 * Drain up to `limit` claimable jobs. Returns a summary an operator can act on: how many were
 * claimed, how each finished, and how many were left alone.
 */
async function runProvisioningCycle(deps, { limit = 25 } = {}) {
  const results = [];
  // One attempt per job per cycle. Without this a job that fails retryably is re-queued and then
  // immediately claimed again by the same loop, so a single cycle burns every attempt with no
  // backoff between them — which is what makes retrying a melting provider pointless.
  const attempted = new Set();
  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob(deps.store, limit, attempted);
    if (!job) break;
    attempted.add(job.id);
    results.push(await runJob(deps, job));
  }
  const tally = { completed: 0, failed: 0, requeued: 0, dead_lettered: 0 };
  for (const result of results) tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
  return { claimed: results.length, ...tally, results };
}

module.exports = {
  PROVISIONING_CAPABILITY,
  JOB_LEASE_MS,
  MAX_ATTEMPTS,
  TERMINAL_STATUSES,
  JobRefusal,
  isClaimable,
  claimNextJob,
  executeJob,
  runJob,
  runProvisioningCycle,
};
