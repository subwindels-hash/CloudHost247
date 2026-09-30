/**
 * Server state reconciliation (spec §27 observability).
 *
 * Health checks used to happen exactly once, during provisioning. After that the platform only
 * learned about a server's state when it changed the state itself, so a machine powered off from
 * the provider's own console, given a new IP, or destroyed outside CloudHost247 kept showing the
 * old state on the customer's dashboard forever.
 *
 * This sweep asks each provider what it actually has and reconciles the difference. Three rules
 * keep it safe:
 *
 *  - it only ever *reflects* reality, never invents it. Power state and IP are copied from the
 *    provider; an image that does not match is reported, never rewritten, because guessing which
 *    operating system a server runs is exactly the kind of fiction this platform refuses to do;
 *  - it never destroys. A server missing at the provider is flagged (and confirmed `retired` only
 *    when the platform was already deleting it), never deleted from the database;
 *  - an unreachable or unconfigured provider is drift in the *integration*, not in the server, so
 *    nothing about the server changes.
 */
import type { Queryable } from '../db/types';
import { findProviderById, type InfrastructureProviderRow } from '../db/infrastructure-providers';
import { findCustomerServerById, updateCustomerServerProvisioning } from '../db/server-provisioning';
import { createInfrastructureProviderAdapter } from '../infrastructure/providers/registry';
import { ProviderError, type InfrastructureProviderAdapter } from '../infrastructure/providers/types';
import { recordAuditBestEffort } from '../lib/audit';

export type DriftKind =
  | 'MISSING_AT_PROVIDER'
  | 'TERMINATION_CONFIRMED'
  | 'POWER_STATE'
  | 'IP_ADDRESS'
  | 'IMAGE_MISMATCH'
  | 'PROVIDER_UNREACHABLE';

export interface ServerDrift {
  serverId: string;
  name: string;
  kind: DriftKind;
  from: string | null;
  to: string | null;
  /** True when the platform changed its own record to match the provider. */
  applied: boolean;
  detail?: string;
}

export interface ReconciliationOptions {
  limit?: number;
  now?: Date;
  source?: NodeJS.ProcessEnv;
  /** Test seam: supply an adapter instead of building one from provider credentials. */
  adapterFactory?: (provider: InfrastructureProviderRow) => InfrastructureProviderAdapter;
}

/** States worth checking: anything the customer is told is a live machine. */
const RECONCILABLE_STATUSES = ['active', 'stopped', 'maintenance', 'offline', 'error', 'deleting'];

interface CandidateRow {
  id: string;
  provider_id: string;
}

async function markChecked(db: Queryable, serverId: string, now: Date): Promise<void> {
  await db.query(`UPDATE servers SET last_reconciled_at=$2 WHERE id=$1`, [serverId, now.toISOString()]);
}

/** Records what was found on the server row so operators can see drift without reading audit logs. */
async function recordDrift(db: Queryable, serverId: string, drift: ServerDrift | null, now: Date): Promise<void> {
  if (!drift) {
    await db.query(`UPDATE servers SET metadata=metadata - 'reconciliation',updated_at=now() WHERE id=$1`, [serverId]);
    return;
  }
  await db.query(
    `UPDATE servers
        SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reconciliation',$2::jsonb),updated_at=now()
      WHERE id=$1`,
    [serverId, JSON.stringify({ kind: drift.kind, from: drift.from, to: drift.to, detail: drift.detail ?? null, applied: drift.applied, observedAt: now.toISOString() })]
  );
}

/**
 * Reconciles up to `limit` servers, oldest-checked first. Returns only the servers that were
 * actually out of sync — a quiet run returns an empty array.
 */
export async function reconcileServerState(db: Queryable, options: ReconciliationOptions = {}): Promise<ServerDrift[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 25;
  const { rows: candidates } = await db.query<CandidateRow>(
    `SELECT id,provider_id FROM servers
      WHERE provider_server_id IS NOT NULL AND provider_id IS NOT NULL AND status=ANY($1::varchar[])
      ORDER BY last_reconciled_at NULLS FIRST, created_at
      LIMIT $2`,
    [RECONCILABLE_STATUSES, limit]
  );

  const drifts: ServerDrift[] = [];
  for (const candidate of candidates) {
    const server = await findCustomerServerById(db, candidate.id);
    if (!server?.provider_server_id || !server.provider_id) continue;
    const provider = await findProviderById(db, server.provider_id);
    if (!provider) {
      await markChecked(db, server.id, now);
      continue;
    }

    let remote;
    try {
      const adapter = options.adapterFactory
        ? options.adapterFactory(provider)
        : createInfrastructureProviderAdapter(provider, options.source);
      remote = await adapter.getServer(server.provider_server_id);
    } catch (error) {
      await markChecked(db, server.id, now);
      // A missing resource is a fact about the server. Anything else is a fact about the
      // integration, and must not be turned into a state change for the customer's machine.
      if (error instanceof ProviderError && error.code === 'RESOURCE_NOT_FOUND') {
        const confirmed = server.status === 'deleting';
        if (confirmed) {
          await updateCustomerServerProvisioning(db, server.id, { status: 'retired', provisioningStatus: 'CANCELLED' });
        }
        const drift: ServerDrift = {
          serverId: server.id, name: server.name,
          kind: confirmed ? 'TERMINATION_CONFIRMED' : 'MISSING_AT_PROVIDER',
          from: server.status, to: confirmed ? 'retired' : server.status, applied: confirmed,
          detail: confirmed
            ? 'The provider confirms the resource is gone; the server is now retired.'
            : 'The provider has no resource with this id. The record is kept for investigation and nothing was deleted.',
        };
        await recordDrift(db, server.id, drift, now);
        await recordAuditBestEffort(db, {
          actorId: null, action: `SERVER_DRIFT_${drift.kind}`, resourceType: 'server', resourceId: server.id,
          metadata: { providerId: provider.id, from: drift.from, to: drift.to, applied: drift.applied },
        });
        drifts.push(drift);
        continue;
      }
      const code = error instanceof ProviderError ? error.code : 'PROVIDER_ERROR';
      const drift: ServerDrift = {
        serverId: server.id, name: server.name, kind: 'PROVIDER_UNREACHABLE',
        from: server.status, to: server.status, applied: false,
        detail: `The provider could not be queried (${code}). The server record was left untouched.`,
      };
      await recordDrift(db, server.id, drift, now);
      drifts.push(drift);
      continue;
    }

    const found: ServerDrift[] = [];

    // --- power state ------------------------------------------------------------------------
    const poweredOn = isPoweredOn(remote.status);
    if (poweredOn !== null) {
      const expected = poweredOn ? 'active' : 'stopped';
      // 'maintenance' is an operator decision about our own platform, so it is never overwritten.
      if (server.status !== expected && server.status !== 'maintenance' && server.status !== 'deleting') {
        await updateCustomerServerProvisioning(db, server.id, { status: expected });
        found.push({
          serverId: server.id, name: server.name, kind: 'POWER_STATE',
          from: server.status, to: expected, applied: true,
          detail: `Provider reports "${remote.status}".`,
        });
      }
    }

    // --- IP address -------------------------------------------------------------------------
    if (remote.ipAddress && remote.ipAddress !== server.ip_address) {
      await updateCustomerServerProvisioning(db, server.id, { ipAddress: remote.ipAddress });
      found.push({
        serverId: server.id, name: server.name, kind: 'IP_ADDRESS',
        from: server.ip_address, to: remote.ipAddress, applied: true,
      });
    }

    // --- image ------------------------------------------------------------------------------
    const expectedImage = await expectedProviderImageId(db, server.os_image_id);
    if (remote.imageId && expectedImage && remote.imageId !== expectedImage) {
      // Reported only. Rewriting operating_system_version_id from a provider string would be
      // guesswork, and the catalog — not the provider — is the source of truth for what we sold.
      found.push({
        serverId: server.id, name: server.name, kind: 'IMAGE_MISMATCH',
        from: expectedImage, to: remote.imageId, applied: false,
        detail: 'The provider reports a different image than the catalog records. The catalog was not changed.',
      });
    }

    await markChecked(db, server.id, now);
    const primary = found[0] ?? null;
    await recordDrift(db, server.id, primary, now);
    for (const drift of found) {
      await recordAuditBestEffort(db, {
        actorId: null, action: `SERVER_DRIFT_${drift.kind}`, resourceType: 'server', resourceId: server.id,
        metadata: { providerId: provider.id, from: drift.from, to: drift.to, applied: drift.applied, source: 'reconciliation-sweep' },
      });
      drifts.push(drift);
    }
  }
  return drifts;
}

/** Maps a provider's own status vocabulary onto powered on/off, or null when it is unknown. */
export function isPoweredOn(status: string | null | undefined): boolean | null {
  if (!status) return null;
  const value = status.toLowerCase();
  if (['running', 'active', 'on', 'poweron', 'powered_on', 'started', 'up'].includes(value)) return true;
  if (['stopped', 'off', 'poweroff', 'powered_off', 'shutoff', 'shut_off', 'halted', 'down', 'suspended'].includes(value)) return false;
  return null;
}

async function expectedProviderImageId(db: Queryable, osImageId: string | null): Promise<string | null> {
  if (!osImageId) return null;
  const { rows } = await db.query<{ provider_image_id: string | null; provider_template_id: string | null }>(
    `SELECT provider_image_id,provider_template_id FROM server_os_images WHERE id=$1`, [osImageId]
  );
  return rows[0]?.provider_image_id ?? rows[0]?.provider_template_id ?? null;
}

/** Servers currently carrying recorded drift, for the admin view. */
export async function listServerDrift(db: Queryable, limit = 100) {
  const { rows } = await db.query(
    `SELECT id,name,hostname,status,provider_id,last_reconciled_at,metadata->'reconciliation' reconciliation
       FROM servers
      WHERE metadata ? 'reconciliation'
      ORDER BY (metadata->'reconciliation'->>'observedAt') DESC NULLS LAST
      LIMIT $1`,
    [Math.min(limit, 200)]
  );
  return rows;
}
