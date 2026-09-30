import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser } from '../../src/db/users';
import { reconcileServerState, isPoweredOn } from '../../src/services/infrastructure-reconciliation-service';
import { ProviderError, type InfrastructureProviderAdapter, type ProviderServer } from '../../src/infrastructure/providers/types';

const UBUNTU_2404 = '20000000-0000-0000-0000-000000000006';

/** Minimal adapter whose `getServer` is the only interesting method. */
function adapterReturning(result: () => Promise<ProviderServer>): InfrastructureProviderAdapter {
  const server: ProviderServer = { id: 'x', status: 'running', name: 'x', ipAddress: null, imageId: null, metadata: {} };
  return {
    kind: 'test-only', provider: {} as never, validateConfiguration: async () => undefined,
    createServer: async () => server, provisionServer: async () => server, findServerByIdempotencyKey: async () => null,
    deleteServer: async () => undefined, rebootServer: async () => undefined, shutdownServer: async () => undefined,
    startServer: async () => undefined, powerOnServer: async () => undefined, powerOffServer: async () => undefined,
    getServer: result, getServerStatus: result, getServerIP: async () => null, getAvailableImages: async () => [],
    getImage: async () => null, reinstallServer: async () => server, rebuildServer: async () => server,
    resizeServer: async () => server, createSnapshot: async () => ({}), deleteSnapshot: async () => undefined,
    restoreSnapshot: async () => undefined, getConsole: async () => ({}), getServerMetrics: async () => ({}),
    healthCheck: async () => ({ exists: true, poweredOn: true, ipAddress: null, imageMatches: true, providerStatus: 'running' }),
  };
}

/**
 * Reality drifts: customers power machines off from the provider's own console, providers move
 * IPs, and instances get destroyed outside the platform. The sweep must reflect that without
 * ever inventing state or destroying a record.
 */
describe('server state reconciliation', () => {
  let db: PGlite;
  const providerId = randomUUID();
  const regionId = randomUUID();
  let customerId = '';
  let imageId = '';

  async function seedServer(options: { status: string; ip?: string | null; withImage?: boolean }): Promise<string> {
    const id = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,region_id,
         operating_system_version_id,os_image_id,architecture,provisioning_status,provider_server_id,ip_address)
       VALUES($1,$2,$3,'VPS',$4,$5,$6,$7,$8,$9,'x86_64','READY',$10,$11)`,
      [id, `srv-${id.slice(0, 8)}`, `${id.slice(0, 8)}.example.test`, options.status, customerId, providerId, regionId,
        UBUNTU_2404, options.withImage === false ? null : imageId, `prov-${id.slice(0, 8)}`, options.ip ?? '203.0.113.10']
    );
    return id;
  }

  async function readServer(id: string) {
    const { rows } = await db.query<{ status: string; ip_address: string | null; operating_system_version_id: string; os_image_id: string | null; last_reconciled_at: string | null; metadata: Record<string, unknown> }>(
      `SELECT status,ip_address,operating_system_version_id,os_image_id,last_reconciled_at,metadata FROM servers WHERE id=$1`, [id]
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const user = await createUser(db, {
      id: randomUUID(), email: `drift-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Drift Customer',
    });
    customerId = user.id;
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Drift provider',$2,'OTHER','generic_http','ACTIVE')`,
      [providerId, `drift-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'drift-1','Drift Region','ACTIVE')`,
      [regionId, providerId]
    );
    imageId = randomUUID();
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,'ubuntu-24.04','x86_64',$4,'ACTIVE',now())`,
      [imageId, providerId, UBUNTU_2404, regionId]
    );
  });

  afterAll(async () => { await db.close(); });

  it('reads provider power vocabularies without guessing at unknown ones', () => {
    expect(isPoweredOn('running')).toBe(true);
    expect(isPoweredOn('SHUTOFF')).toBe(false);
    expect(isPoweredOn('rebuilding')).toBeNull();
    expect(isPoweredOn(null)).toBeNull();
  });

  it('adopts the provider power state and IP address', async () => {
    const serverId = await seedServer({ status: 'active', ip: '203.0.113.10' });
    const drifts = await reconcileServerState(db, {
      limit: 1,
      adapterFactory: () => adapterReturning(async () => ({
        id: 'remote', status: 'stopped', name: 'x', ipAddress: '203.0.113.99', imageId: 'ubuntu-24.04', metadata: {},
      })),
    });
    expect(drifts.map((d) => d.kind)).toEqual(['POWER_STATE', 'IP_ADDRESS']);
    const server = await readServer(serverId);
    expect(server.status).toBe('stopped');
    expect(server.ip_address).toBe('203.0.113.99');
    expect(server.last_reconciled_at).toBeTruthy();
  });

  it('reports an image mismatch but never rewrites the catalog record', async () => {
    const serverId = await seedServer({ status: 'active' });
    await db.query(`UPDATE servers SET last_reconciled_at=NULL WHERE id=$1`, [serverId]);
    await db.query(`UPDATE servers SET last_reconciled_at=now() WHERE id<>$1`, [serverId]);
    const drifts = await reconcileServerState(db, {
      limit: 1,
      adapterFactory: () => adapterReturning(async () => ({
        id: 'remote', status: 'running', name: 'x', ipAddress: '203.0.113.10', imageId: 'debian-13', metadata: {},
      })),
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0]).toMatchObject({ kind: 'IMAGE_MISMATCH', from: 'ubuntu-24.04', to: 'debian-13', applied: false });
    const server = await readServer(serverId);
    expect(server.operating_system_version_id).toBe(UBUNTU_2404);
    expect(server.os_image_id).toBe(imageId);
    expect(server.status).toBe('active');
  });

  it('flags a server missing at the provider without deleting anything', async () => {
    const serverId = await seedServer({ status: 'active' });
    await db.query(`UPDATE servers SET last_reconciled_at=now() WHERE id<>$1`, [serverId]);
    await db.query(`UPDATE servers SET last_reconciled_at=NULL WHERE id=$1`, [serverId]);
    const drifts = await reconcileServerState(db, {
      limit: 1,
      adapterFactory: () => adapterReturning(async () => { throw new ProviderError('RESOURCE_NOT_FOUND', 'gone', false); }),
    });
    expect(drifts[0]).toMatchObject({ kind: 'MISSING_AT_PROVIDER', applied: false });
    const server = await readServer(serverId);
    expect(server.status).toBe('active');
    expect((server.metadata.reconciliation as Record<string, unknown>).kind).toBe('MISSING_AT_PROVIDER');
    const audit = await db.query(
      `SELECT id FROM audit_logs WHERE resource_id=$1 AND action='SERVER_DRIFT_MISSING_AT_PROVIDER'`, [serverId]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('confirms a termination when the platform was already deleting the server', async () => {
    const serverId = await seedServer({ status: 'deleting' });
    await db.query(`UPDATE servers SET last_reconciled_at=now() WHERE id<>$1`, [serverId]);
    await db.query(`UPDATE servers SET last_reconciled_at=NULL WHERE id=$1`, [serverId]);
    const drifts = await reconcileServerState(db, {
      limit: 1,
      adapterFactory: () => adapterReturning(async () => { throw new ProviderError('RESOURCE_NOT_FOUND', 'gone', false); }),
    });
    expect(drifts[0]).toMatchObject({ kind: 'TERMINATION_CONFIRMED', to: 'retired', applied: true });
    expect((await readServer(serverId)).status).toBe('retired');
  });

  it('leaves the server untouched when the provider cannot be reached, and moves on next run', async () => {
    const serverId = await seedServer({ status: 'active', ip: '203.0.113.10' });
    await db.query(`UPDATE servers SET last_reconciled_at=now() WHERE id<>$1`, [serverId]);
    await db.query(`UPDATE servers SET last_reconciled_at=NULL WHERE id=$1`, [serverId]);
    const drifts = await reconcileServerState(db, {
      limit: 1,
      adapterFactory: () => adapterReturning(async () => { throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'no token', false); }),
    });
    expect(drifts[0]).toMatchObject({ kind: 'PROVIDER_UNREACHABLE', applied: false });
    const server = await readServer(serverId);
    expect(server).toMatchObject({ status: 'active', ip_address: '203.0.113.10' });
    // The round-robin cursor still advances so one broken provider cannot starve the rest.
    expect(server.last_reconciled_at).toBeTruthy();
  });

  it('skips retired servers and clears drift once a server agrees again', async () => {
    const healthyId = await seedServer({ status: 'active' });
    // Every other server from the earlier cases is retired, so the only candidate left is this
    // one — which also proves retired servers are never queried at the provider.
    await db.query(`UPDATE servers SET status='retired' WHERE id<>$1`, [healthyId]);
    await db.query(
      `UPDATE servers SET last_reconciled_at=NULL,metadata=jsonb_build_object('reconciliation',jsonb_build_object('kind','POWER_STATE')) WHERE id=$1`,
      [healthyId]
    );
    const checked: string[] = [];
    const drifts = await reconcileServerState(db, {
      limit: 5,
      adapterFactory: () => adapterReturning(async () => {
        checked.push('call');
        return { id: 'remote', status: 'running', name: 'x', ipAddress: '203.0.113.10', imageId: 'ubuntu-24.04', metadata: {} };
      }),
    });
    expect(drifts).toEqual([]);
    expect(checked).toHaveLength(1);
    const server = await readServer(healthyId);
    expect(server.metadata.reconciliation).toBeUndefined();
    expect(server.last_reconciled_at).toBeTruthy();
  });
});
