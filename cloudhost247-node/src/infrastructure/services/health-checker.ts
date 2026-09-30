/**
 * Server health verification (spec §19).
 *
 * A provisioned or reinstalled server only becomes READY after *evidence*, never after a
 * provider API simply accepted a request. Each poll requires, in order:
 *
 *   1. the provider resource exists,
 *   2. it is powered on,
 *   3. it has an IP address,
 *   4. the provider reports the expected image (where the provider exposes one),
 *   5. SSH/22 is reachable at that address,
 *   6. a fresh HMAC-authenticated agent report — produced *after* this deployment attempt
 *      started — confirms the expected OS family/version, the configured hostname, the security
 *      marker and a running monitoring agent.
 *
 * Any missing condition retries until the configured timeout and then fails the job; nothing is
 * assumed, defaulted, or simulated.
 */
import net from 'node:net';
import type { ServerOsImageRow } from '../../db/infrastructure-providers';
import { findCustomerServerById, type CustomerServerDetailRow } from '../../db/server-provisioning';
import type { Queryable } from '../../db/types';
import { ProviderError, type InfrastructureProviderAdapter } from '../providers/types';

export interface HealthCheckOptions {
  source?: NodeJS.ProcessEnv;
  pollIntervalMs?: number;
  healthTimeoutMs?: number;
  /** Only ever disabled by tests that assert the non-agent gates; production keeps it on. */
  requireAgentHealth?: boolean;
  tcpCheck?: (host: string, port: number) => Promise<boolean>;
}

export async function checkTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, timeout: 3_000 });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForServerHealth(
  db: Queryable,
  server: CustomerServerDetailRow,
  adapter: InfrastructureProviderAdapter,
  image: ServerOsImageRow,
  options: HealthCheckOptions,
  evidenceAfterMs: number
): Promise<{ ipAddress: string }> {
  const timeoutMs = options.healthTimeoutMs
    ?? Number((options.source ?? process.env).PROVISIONING_HEALTH_TIMEOUT_MS ?? 600_000);
  const pollMs = options.pollIntervalMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let last = 'Provider server has not reached the expected health state';
  while (Date.now() <= deadline) {
    const providerHealth = await adapter.healthCheck(server.provider_server_id as string, image);
    if (!providerHealth.exists) {
      throw new ProviderError('RESOURCE_NOT_FOUND', 'Provider server disappeared during health check', false);
    }
    if (!providerHealth.poweredOn) { last = `Provider status is ${providerHealth.providerStatus}`; await sleep(pollMs); continue; }
    if (!providerHealth.ipAddress) { last = 'Provider has not assigned an IP address'; await sleep(pollMs); continue; }
    if (!providerHealth.imageMatches) {
      throw new ProviderError('IMAGE_UNAVAILABLE', 'Provider reports an unexpected operating-system image', false);
    }
    const ssh = await (options.tcpCheck ?? checkTcp)(providerHealth.ipAddress, 22);
    if (!ssh) { last = 'SSH is not reachable yet'; await sleep(pollMs); continue; }

    if (options.requireAgentHealth !== false) {
      const fresh = await findCustomerServerById(db, server.id);
      const report = fresh?.metadata.provisioningHealth;
      const reportData = report && typeof report === 'object' ? report as Record<string, unknown> : {};
      const reportTime = typeof reportData.reportedAt === 'string' ? new Date(reportData.reportedAt).getTime() : 0;
      const seen = fresh?.agent_last_seen_at
        && Date.now() - new Date(fresh.agent_last_seen_at).getTime() < 5 * 60_000
        && reportTime >= evidenceAfterMs;
      const expected = await db.query<{ slug: string; os_release_ids: string[]; version: string }>(
        `SELECT os.slug,os.os_release_ids,v.version FROM operating_system_versions v
         JOIN operating_systems os ON os.id=v.operating_system_id WHERE v.id=$1`,
        [image.operating_system_version_id]
      );
      const expectedOs = expected.rows[0];
      const expectedVersion = expectedOs?.version;
      const acceptedOsIds = expectedOs?.os_release_ids.length ? expectedOs.os_release_ids : expectedOs ? [expectedOs.slug] : [];
      const reportedVersion = String(reportData.osVersion ?? '');
      const versionMatches = expectedVersion === 'rolling'
        ? reportedVersion.length > 0
        : reportedVersion.startsWith(expectedVersion ?? '__missing__');
      const osMatches = acceptedOsIds.includes(String(reportData.osId ?? '')) && versionMatches;
      const hostnameMatches = reportData.hostname === fresh?.hostname;
      if (!seen || !osMatches || !hostnameMatches || reportData.securityConfigured !== true || reportData.monitoringRunning !== true) {
        last = 'Waiting for authenticated agent OS, hostname, security and monitoring report';
        await sleep(pollMs);
        continue;
      }
    }
    return { ipAddress: providerHealth.ipAddress };
  }
  throw new ProviderError('NETWORK_TEMPORARY_FAILURE', last, true);
}
