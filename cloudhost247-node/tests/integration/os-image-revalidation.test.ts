import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser } from '../../src/db/users';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { listAvailableConfigurations } from '../../src/db/operating-systems';
import { revalidateProviderImages } from '../../src/services/os-image-revalidation-service';
import { ProviderError, type InfrastructureProviderAdapter, type ProviderImage } from '../../src/infrastructure/providers/types';

const UBUNTU_2404 = '20000000-0000-0000-0000-000000000006';

function adapterWithImage(getImage: () => Promise<ProviderImage | null>): InfrastructureProviderAdapter {
  const server = { id: 'x', status: 'running', name: 'x', ipAddress: null, imageId: null, metadata: {} };
  return {
    kind: 'test-only', provider: {} as never, validateConfiguration: async () => undefined,
    createServer: async () => server, provisionServer: async () => server, findServerByIdempotencyKey: async () => null,
    deleteServer: async () => undefined, rebootServer: async () => undefined, shutdownServer: async () => undefined,
    startServer: async () => undefined, powerOnServer: async () => undefined, powerOffServer: async () => undefined,
    getServer: async () => server, getServerStatus: async () => server, getServerIP: async () => null,
    getAvailableImages: async () => [], getImage, reinstallServer: async () => server, rebuildServer: async () => server,
    resizeServer: async () => server, createSnapshot: async () => ({}), deleteSnapshot: async () => undefined,
    restoreSnapshot: async () => undefined, getConsole: async () => ({}), getServerMetrics: async () => ({}),
    healthCheck: async () => ({ exists: true, poweredOn: true, ipAddress: null, imageMatches: true, providerStatus: 'running' }),
  };
}

/**
 * An image is only deployable for as long as the provider still offers it. Verifying once, at
 * the moment an operator enables the mapping, means the catalog keeps promising images that were
 * withdrawn months ago — and the lie is only discovered after a customer has paid.
 */
describe('provider image re-verification', () => {
  let db: PGlite;
  const providerId = randomUUID();
  let planId = '';

  /**
   * Each mapping gets its own region: the catalog enforces one image per
   * provider × version × architecture × region × datacenter, which is exactly the uniqueness the
   * platform relies on, so the fixtures must respect it rather than work around it.
   */
  async function seedImage(options: { status: string; verifiedDaysAgo: number | null; architecture?: 'x86_64' | 'arm64' }): Promise<{ imageId: string; regionId: string }> {
    const id = randomUUID();
    const regionId = randomUUID();
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,$3,'Image Region','ACTIVE')`,
      [regionId, providerId, `img-${regionId.slice(0, 8)}`]
    );
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,${options.verifiedDaysAgo === null ? 'NULL' : `now() - interval '${options.verifiedDaysAgo} days'`})`,
      [id, providerId, UBUNTU_2404, `img-${id.slice(0, 8)}`, options.architecture ?? 'x86_64', regionId, options.status]
    );
    return { imageId: id, regionId };
  }

  async function readImage(id: string) {
    const { rows } = await db.query<{ status: string; verified_at: string | null; verification_error: string | null; metadata: Record<string, unknown> }>(
      `SELECT status,verified_at,verification_error,metadata FROM server_os_images WHERE id=$1`, [id]
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Image provider',$2,'OTHER','generic_http','ACTIVE')`,
      [providerId, `image-${providerId}`]
    );
    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id=$1`, [UBUNTU_2404]);
    const product = await createProduct(db, {
      id: randomUUID(), slug: `image-compute-${randomUUID()}`, name: 'Image Compute',
      productType: 'hosting', status: 'active', visibility: 'public',
    });
    const plan = await createPlan(db, {
      id: randomUUID(), productId: product.id, slug: `image-vps-${randomUUID()}`, name: 'Image VPS', status: 'active',
    });
    planId = plan.id;
  });

  afterAll(async () => { await db.close(); });

  it('leaves a freshly verified image alone', async () => {
    const { imageId } = await seedImage({ status: 'ACTIVE', verifiedDaysAgo: 1 });
    const results = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => { throw new Error('should not be called'); }),
    });
    expect(results.map((item) => item.imageId)).not.toContain(imageId);
    expect((await readImage(imageId)).status).toBe('ACTIVE');
  });

  it('refreshes the verification when the provider still offers the image', async () => {
    const { imageId } = await seedImage({ status: 'ACTIVE', verifiedDaysAgo: 30 });
    const before = await readImage(imageId);
    const results = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => ({ id: 'ubuntu-24.04', name: 'Ubuntu 24.04', architecture: 'x86_64', available: true, metadata: {} })),
    });
    expect(results).toContainEqual(expect.objectContaining({ imageId, outcome: 'VERIFIED' }));
    const after = await readImage(imageId);
    expect(after.status).toBe('ACTIVE');
    expect(new Date(after.verified_at!).getTime()).toBeGreaterThan(new Date(before.verified_at!).getTime());
    await db.query(`UPDATE server_os_images SET status='DISABLED' WHERE id=$1`, [imageId]);
  });

  it('invalidates a withdrawn image so it can no longer be ordered, without touching running servers', async () => {
    const { imageId, regionId } = await seedImage({ status: 'ACTIVE', verifiedDaysAgo: 30 });
    await db.query(
      `INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,operating_system_version_id,architecture,server_type,status)
       VALUES($1,$2,$3,$4,$5,'x86_64','VPS','ACTIVE')`,
      [randomUUID(), planId, providerId, regionId, UBUNTU_2404]
    );
    const customer = await createUser(db, {
      id: randomUUID(), email: `img-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Image Customer',
    });
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,region_id,
         operating_system_version_id,os_image_id,architecture,provisioning_status,provider_server_id)
       VALUES($1,'live-vps','live.example.test','VPS','active',$2,$3,$4,$5,$6,'x86_64','READY','prov-live')`,
      [serverId, customer.id, providerId, regionId, UBUNTU_2404, imageId]
    );
    // The combination is orderable while the image is verified.
    expect((await listAvailableConfigurations(db, { planId, serverType: 'VPS' })).length).toBeGreaterThan(0);

    const results = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => null),
    });
    expect(results).toContainEqual(expect.objectContaining({ imageId, outcome: 'INVALIDATED', affectedConfigurations: 1 }));
    const after = await readImage(imageId);
    expect(after.status).toBe('INVALID');
    expect(after.verified_at).toBeNull();
    expect(after.verification_error).toMatch(/no longer offers/i);

    // Ordering is closed, the running server is untouched, and the loss is auditable.
    expect(await listAvailableConfigurations(db, { planId, serverType: 'VPS' })).toEqual([]);
    const server = await db.query<{ status: string; os_image_id: string }>(
      `SELECT status,os_image_id FROM servers WHERE id=$1`, [serverId]
    );
    expect(server.rows[0]).toEqual({ status: 'active', os_image_id: imageId });
    expect((await db.query(
      `SELECT id FROM audit_logs WHERE resource_id=$1 AND action='OS_IMAGE_INVALIDATED'`, [imageId]
    )).rows).toHaveLength(1);

    await db.query(`DELETE FROM server_product_configurations`);
    await db.query(`UPDATE server_os_images SET status='DISABLED' WHERE id=$1`, [imageId]);
  });

  it('invalidates an image whose architecture no longer matches the mapping', async () => {
    const { imageId } = await seedImage({ status: 'ACTIVE', verifiedDaysAgo: 30 });
    const results = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => ({ id: 'ubuntu-24.04', name: 'Ubuntu 24.04', architecture: 'arm64', available: true, metadata: {} })),
    });
    expect(results).toContainEqual(expect.objectContaining({ imageId, outcome: 'INVALIDATED' }));
    expect((await readImage(imageId)).verification_error).toMatch(/architecture/i);
    await db.query(`UPDATE server_os_images SET status='DISABLED' WHERE id=$1`, [imageId]);
  });

  it('never empties the catalog because a provider was unreachable', async () => {
    const { imageId } = await seedImage({ status: 'ACTIVE', verifiedDaysAgo: 30 });
    const results = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => { throw new ProviderError('PROVIDER_NOT_CONFIGURED', 'no token', false); }),
    });
    expect(results).toContainEqual(expect.objectContaining({ imageId, outcome: 'PROVIDER_UNREACHABLE' }));
    const after = await readImage(imageId);
    expect(after.status).toBe('ACTIVE');
    expect(after.verified_at).not.toBeNull();
    // The attempt is recorded so a dead provider cannot hold the head of the queue forever.
    expect(after.metadata.revalidationAttemptedAt).toBeTruthy();

    const second = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => { throw new ProviderError('RATE_LIMITED', 'slow down', true); }),
    });
    expect(second.map((item) => item.imageId)).not.toContain(imageId);
    await db.query(`UPDATE server_os_images SET status='DISABLED' WHERE id=$1`, [imageId]);
  });

  it('ignores draft, disabled and already-invalid mappings', async () => {
    const { imageId: draft } = await seedImage({ status: 'DRAFT', verifiedDaysAgo: null });
    const { imageId: disabled } = await seedImage({ status: 'DISABLED', verifiedDaysAgo: 400 });
    const { imageId: invalid } = await seedImage({ status: 'INVALID', verifiedDaysAgo: null });
    const results = await revalidateProviderImages(db, {
      adapterFactory: () => adapterWithImage(async () => { throw new Error('should not be called'); }),
    });
    const touched = results.map((item) => item.imageId);
    expect(touched).not.toContain(draft);
    expect(touched).not.toContain(disabled);
    expect(touched).not.toContain(invalid);
  });
});
