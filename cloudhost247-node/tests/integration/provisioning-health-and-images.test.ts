import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { findOsImageById } from '../../src/db/infrastructure-providers';
import { findCustomerServerById } from '../../src/db/server-provisioning';
import { createUser } from '../../src/db/users';
import {
  ImageResolutionError,
  resolveReinstallTarget,
  resolveVerifiedProviderImage,
} from '../../src/infrastructure/services/image-resolver';
import { waitForServerHealth } from '../../src/infrastructure/services/health-checker';
import { getServerSshKeys } from '../../src/infrastructure/services/server-configurator';
import type { InfrastructureProviderAdapter, ProviderHealth } from '../../src/infrastructure/providers/types';

const UBUNTU_2404 = '20000000-0000-0000-0000-000000000006';
const DEBIAN_13 = '20000000-0000-0000-0000-000000000003';

/**
 * The provisioning pipeline is decomposed into image resolution, server configuration and
 * health verification. Each part must independently refuse to let an unverified image, an
 * unowned SSH key, or an unproven server reach the customer.
 */
describe('image resolution and health verification', () => {
  let db: PGlite;
  const providerId = randomUUID();
  const regionId = randomUUID();
  let verifiedImageId = '';
  let unverifiedImageId = '';
  let customerId = '';

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const user = await createUser(db, {
      id: randomUUID(), email: `health-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Health Customer',
    });
    customerId = user.id;
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Health provider',$2,'OTHER','generic_http','ACTIVE')`,
      [providerId, `health-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'test-1','Test Region','ACTIVE')`,
      [regionId, providerId]
    );
    verifiedImageId = randomUUID();
    unverifiedImageId = randomUUID();
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,'ubuntu-24.04','x86_64',$4,'ACTIVE',now())`,
      [verifiedImageId, providerId, UBUNTU_2404, regionId]
    );
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status)
       VALUES($1,$2,$3,'debian-13','x86_64',$4,'DRAFT')`,
      [unverifiedImageId, providerId, DEBIAN_13, regionId]
    );
  });

  afterAll(async () => { await db.close(); });

  function provider() {
    return { id: providerId } as never;
  }

  it('refuses an image that has never been verified against the provider', async () => {
    await expect(resolveVerifiedProviderImage(db, {
      osImageId: unverifiedImageId, provider: provider(), architecture: 'x86_64',
    })).rejects.toMatchObject({ code: 'IMAGE_UNAVAILABLE', retryable: false });
  });

  it('refuses an image that belongs to another provider or architecture', async () => {
    await expect(resolveVerifiedProviderImage(db, {
      osImageId: verifiedImageId, provider: provider(), architecture: 'arm64',
    })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION', retryable: false });
    await expect(resolveVerifiedProviderImage(db, {
      osImageId: null, provider: provider(), architecture: 'x86_64',
    })).rejects.toMatchObject({ code: 'IMAGE_UNAVAILABLE' });
  });

  it('accepts only the verified, matching mapping', async () => {
    const image = await resolveVerifiedProviderImage(db, {
      osImageId: verifiedImageId, provider: provider(), architecture: 'x86_64',
      operatingSystemVersionId: UBUNTU_2404, regionId, datacenterId: null,
    });
    expect(image.provider_image_id).toBe('ubuntu-24.04');
  });

  it('rechecks version and location scope when a queued job is executed', async () => {
    await expect(resolveVerifiedProviderImage(db, {
      osImageId: verifiedImageId, provider: provider(), architecture: 'x86_64',
      operatingSystemVersionId: DEBIAN_13, regionId, datacenterId: null,
    })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(resolveVerifiedProviderImage(db, {
      osImageId: verifiedImageId, provider: provider(), architecture: 'x86_64',
      operatingSystemVersionId: UBUNTU_2404, regionId: randomUUID(), datacenterId: null,
    })).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });

  it('refuses a reinstall target that is not an enabled configuration for the server', async () => {
    await expect(resolveReinstallTarget(db, {
      planId: randomUUID(), providerId, regionId, datacenterId: null, serverType: 'VPS',
      operatingSystemVersionId: DEBIAN_13, architecture: 'x86_64',
    })).rejects.toBeInstanceOf(ImageResolutionError);
  });

  it('only returns SSH keys that belong to the requesting customer', async () => {
    const otherUser = await createUser(db, {
      id: randomUUID(), email: `other-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Other',
    });
    const foreignKeyId = randomUUID();
    await db.query(
      `INSERT INTO customer_ssh_keys(id,user_id,name,public_key,fingerprint) VALUES($1,$2,'Foreign','ssh-ed25519 AAAAForeign other@example.test',$3)`,
      [foreignKeyId, otherUser.id, `SHA256:${randomUUID()}`]
    );
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,operating_system_version_id,architecture,provisioning_status,metadata)
       VALUES($1,'ssh-vps','ssh.example.test','VPS','queued',$2,$3,'x86_64','QUEUED',$4)`,
      [serverId, customerId, UBUNTU_2404, JSON.stringify({ sshKeyIds: [foreignKeyId] })]
    );
    const server = await findCustomerServerById(db, serverId);
    await expect(getServerSshKeys(db, server!)).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
  });

  describe('health gates', () => {
    const image = () => findOsImageById(db, verifiedImageId);
    let serverId = '';

    function adapterWith(health: Partial<ProviderHealth>): InfrastructureProviderAdapter {
      const full: ProviderHealth = {
        exists: true, poweredOn: true, ipAddress: '203.0.113.20', imageMatches: true, providerStatus: 'running',
        ...health,
      };
      return { healthCheck: async () => full } as unknown as InfrastructureProviderAdapter;
    }

    beforeAll(async () => {
      serverId = randomUUID();
      await db.query(
        `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,provider_server_id,operating_system_version_id,os_image_id,architecture,provisioning_status)
         VALUES($1,'health-vps','health.example.test','VPS','provisioning',$2,$3,'remote-health-1',$4,$5,'x86_64','HEALTH_CHECK')`,
        [serverId, customerId, providerId, UBUNTU_2404, verifiedImageId]
      );
    });

    async function server() {
      return (await findCustomerServerById(db, serverId))!;
    }

    it('never reports ready when the provider resource is gone', async () => {
      await expect(waitForServerHealth(
        db, await server(), adapterWith({ exists: false }), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, requireAgentHealth: false, tcpCheck: async () => true }, 0
      )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', retryable: false });
    });

    it('treats a wrong installed image as a permanent failure, not a retry', async () => {
      await expect(waitForServerHealth(
        db, await server(), adapterWith({ imageMatches: false }), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, requireAgentHealth: false, tcpCheck: async () => true }, 0
      )).rejects.toMatchObject({ code: 'IMAGE_UNAVAILABLE', retryable: false });
    });

    it('keeps retrying, then fails retryably, while SSH stays closed', async () => {
      await expect(waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, requireAgentHealth: false, tcpCheck: async () => false }, 0
      )).rejects.toMatchObject({ code: 'NETWORK_TEMPORARY_FAILURE', retryable: true });
    });

    it('will not mark a server healthy on provider and SSH evidence alone', async () => {
      await expect(waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, tcpCheck: async () => true }, Date.now() - 1_000
      )).rejects.toMatchObject({ code: 'NETWORK_TEMPORARY_FAILURE', retryable: true });
    });

    it('rejects an agent report for a different operating system or hostname', async () => {
      const report = (extra: Record<string, unknown>) => JSON.stringify({
        provisioningHealth: {
          reportedAt: new Date().toISOString(), osId: 'ubuntu', osVersion: '24.04',
          hostname: 'health.example.test', securityConfigured: true, monitoringRunning: true, ...extra,
        },
      });
      const evidenceAfter = Date.now() - 1_000;
      await db.query(`UPDATE servers SET agent_last_seen_at=now(),metadata=$2::jsonb WHERE id=$1`, [serverId, report({ osId: 'debian' })]);
      await expect(waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, tcpCheck: async () => true }, evidenceAfter
      )).rejects.toMatchObject({ code: 'NETWORK_TEMPORARY_FAILURE' });

      await db.query(`UPDATE servers SET metadata=$2::jsonb WHERE id=$1`, [serverId, report({ hostname: 'somewhere-else.example.test' })]);
      await expect(waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, tcpCheck: async () => true }, evidenceAfter
      )).rejects.toMatchObject({ code: 'NETWORK_TEMPORARY_FAILURE' });

      await db.query(`UPDATE servers SET metadata=$2::jsonb WHERE id=$1`, [serverId, report({ securityConfigured: false })]);
      await expect(waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, tcpCheck: async () => true }, evidenceAfter
      )).rejects.toMatchObject({ code: 'NETWORK_TEMPORARY_FAILURE' });
    });

    it('rejects a stale agent report produced before this deployment attempt', async () => {
      await db.query(
        `UPDATE servers SET agent_last_seen_at=now(),metadata=$2::jsonb WHERE id=$1`,
        [serverId, JSON.stringify({
          provisioningHealth: {
            reportedAt: new Date(Date.now() - 3_600_000).toISOString(), osId: 'ubuntu', osVersion: '24.04',
            hostname: 'health.example.test', securityConfigured: true, monitoringRunning: true,
          },
        })]
      );
      await expect(waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 20, tcpCheck: async () => true }, Date.now() - 1_000
      )).rejects.toMatchObject({ code: 'NETWORK_TEMPORARY_FAILURE' });
    });

    it('returns the provider IP once every gate passes with a fresh, matching agent report', async () => {
      await db.query(
        `UPDATE servers SET agent_last_seen_at=now(),metadata=$2::jsonb WHERE id=$1`,
        [serverId, JSON.stringify({
          provisioningHealth: {
            reportedAt: new Date().toISOString(), osId: 'ubuntu', osVersion: '24.04.1',
            hostname: 'health.example.test', securityConfigured: true, monitoringRunning: true,
          },
        })]
      );
      const result = await waitForServerHealth(
        db, await server(), adapterWith({}), (await image())!,
        { pollIntervalMs: 1, healthTimeoutMs: 200, tcpCheck: async () => true }, Date.now() - 1_000
      );
      expect(result).toEqual({ ipAddress: '203.0.113.20' });
    });
  });
});
