import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildKeyRing, encryptSecret } from '../../src/lib/crypto';
import { setKeyRingForTesting } from '../../src/lib/keyring';
import { createCpanelAdapter, cpanelUsernameForProject } from '../../src/deployments/adapters/cpanel-adapter';
import {
  createKubernetesAdapter,
  kubernetesCollectionPath,
  RESTART_ANNOTATION,
  LAST_REPLICAS_ANNOTATION,
} from '../../src/deployments/adapters/kubernetes-adapter';
import { createDockerAdapter } from '../../src/deployments/adapters/docker-adapter';
import { UnsupportedOperationError } from '../../src/deployments/adapters/types';
import type { AdapterContext } from '../../src/deployments/adapters/types';
import type { ServerRow } from '../../src/db/servers';
import type { Queryable } from '../../src/db/types';

/**
 * A7 — deployment adapters. The gaps this pins:
 *  - cPanel must use the account suspension state for start/stop (there is no container), report
 *    account status from WHM, and use the UAPI Backup module for backup/restore — while still
 *    refusing restart and per-account logs, because those genuinely do not exist.
 *  - Kubernetes must address its API with real group/version/resource paths, apply idempotently,
 *    and use the cluster's own mechanisms for start/stop/restart (replica patches and the rollout
 *    restart annotation) rather than inventing anything. Backups stay a structured refusal.
 */

const TEST_KEY = 'a'.repeat(64);

// getKeyRing() derives its ring from process.env, so the key must exist there for the adapters'
// credential lookups; the injected ring below keeps encryptSecret() consistent with it.
beforeEach(() => {
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET = 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
  setKeyRingForTesting(buildKeyRing(TEST_KEY, undefined));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setKeyRingForTesting(null);
  delete process.env.CREDENTIAL_ENCRYPTION_KEY;
  delete process.env.DATABASE_URL;
  delete process.env.JWT_SECRET;
});

function cipherFor(type: string, value: string) {
  return async () => ({
    rows: [{ server_id: 'server-1', credential_type: type, encrypted_secret: encryptSecret(buildKeyRing(TEST_KEY, undefined), value) }],
  });
}

function fakeDb(credentialType: string, secret: string): Queryable {
  return { query: cipherFor(credentialType, secret) } as unknown as Queryable;
}

function serverRow(overrides: Partial<ServerRow> = {}): ServerRow {
  return {
    id: 'server-1', name: 'host', hostname: 'host.test', ip_address: '192.0.2.1', server_type: 'CPANEL',
    provider: null, region: null, status: 'active', agent_id: null, agent_version: null,
    agent_last_seen_at: null, cpu_cores: 2, memory_mb: 2048, storage_mb: 40960,
    docker_enabled: false, kubernetes_enabled: false, cpanel_enabled: true, metadata: {},
    created_at: '', updated_at: '', ...overrides,
  } as ServerRow;
}

function context(server: ServerRow, db: Queryable, logs: string[] = []): AdapterContext {
  return {
    db,
    server,
    log: async (level, message) => {
      logs.push(`${level}: ${message}`);
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function installFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function whmSuccess(data: unknown = {}): Response {
  return json({ metadata: { result: 1 }, data });
}

function uapiSuccess(data: unknown = {}): Response {
  return json({ result: { status: 1, data } });
}

describe('cPanel adapter uses the account state that actually exists', () => {
  const whmServer = serverRow({ metadata: { whm_url: 'https://whm.test:2087', whm_user: 'root' } });

  function adapter() {
    return createCpanelAdapter({ simulationMode: false });
  }
  function db() {
    return fakeDb('whm_api_token', 'whm-token');
  }

  it('derives the cPanel username the same way provisioning does', () => {
    expect(cpanelUsernameForProject('My-Project_2026!!')).toBe('myproject2026');
    expect(cpanelUsernameForProject('9-lives')).toBe('u9lives');
    expect(cpanelUsernameForProject('')).toBe('');
    expect(cpanelUsernameForProject('a-project-name-that-is-far-too-long')).toHaveLength(16);
  });

  it('start unsuspends a suspended account and is a no-op when it is already active', async () => {
    const suspended = installFetch((url) =>
      url.includes('accountsummary')
        ? whmSuccess({ acct: [{ domain: 'shop.test', user: 'shop', suspended: 1, diskused: 10, disklimit: 'unlimited' }] })
        : whmSuccess({})
    );
    const logs: string[] = [];
    const result = await adapter().startApplication(context(whmServer, db(), logs), 'shop');
    expect(result.ok).toBe(true);
    expect(suspended.some((call) => call.url.includes('unsuspendacct'))).toBe(true);
    expect(logs.join('\n')).toContain('unsuspended');

    installFetch((url) =>
      url.includes('accountsummary')
        ? whmSuccess({ acct: [{ domain: 'shop.test', user: 'shop', suspended: 0, diskused: 10, disklimit: 'unlimited' }] })
        : whmSuccess({})
    );
    const already = await adapter().startApplication(context(whmServer, db()), 'shop');
    expect(already.message).toContain('already active');
  });

  it('stop suspends through WHM with a reason, and reports the suspension as not running', async () => {
    const calls = installFetch(() => whmSuccess({}));
    const stop = await adapter().stopApplication(context(whmServer, db()), 'shop');
    expect(stop.ok).toBe(true);
    const suspend = calls.find((call) => call.url.includes('suspendacct'));
    expect(suspend).toBeDefined();
    expect(String(suspend?.url)).toContain('reason=');

    installFetch((url) =>
      url.includes('accountsummary')
        ? whmSuccess({ acct: [{ domain: 'shop.test', user: 'shop', suspended: 1, diskused: 5, disklimit: 'unlimited' }] })
        : whmSuccess({})
    );
    const status = await adapter().applicationStatus(context(whmServer, db()), 'shop');
    expect(status).toMatchObject({ ok: true, code: 'ACCOUNT_SUSPENDED', running: false, health: 'unknown' });
    expect(status.detail).toContain('domain=shop.test');
  });

  it('reports a missing account honestly instead of inventing a status', async () => {
    installFetch(() => whmSuccess({ acct: [] }));
    const status = await adapter().applicationStatus(context(whmServer, db()), 'ghost');
    expect(status).toMatchObject({ ok: false, code: 'ACCOUNT_NOT_FOUND', running: false, health: 'unknown' });
  });

  it('still refuses restart and per-account logs, because cPanel has neither', async () => {
    const ctx = context(whmServer, db());
    await expect(adapter().restartApplication(ctx, 'shop')).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter().applicationLogs(ctx, 'shop')).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('runs a full backup through UAPI and records the server-side archive', async () => {
    const uapiCalls: string[] = [];
    installFetch((url) => {
      if (url.includes('cpanel_jsonapi_func=fullbackup_to_homedir')) {
        uapiCalls.push('start');
        return uapiSuccess({});
      }
      if (url.includes('cpanel_jsonapi_func=list_backups')) {
        uapiCalls.push('list');
        return uapiSuccess({
          backup: uapiCalls.filter((entry) => entry === 'start').length
            ? [{ file: 'backup-10.02.2026_10-00-00_shop.tar.gz', status: 'complete', size: 4096 }]
            : [],
        });
      }
      return whmSuccess({});
    });
    const result = await adapter().runBackup(context(whmServer, db()), 'shop', {} as never);
    expect(result.ok).toBe(true);
    expect(result.archivePath).toBe('/home/shop/backup-10.02.2026_10-00-00_shop.tar.gz');
    expect(result.sizeBytes).toBe(4096);
    expect(result.checksum).toBeNull();
    expect(uapiCalls).toContain('start');
  });

  it('restores only an archive inside the account home, and passes the file name to UAPI', async () => {
    const calls = installFetch(() => uapiSuccess({}));
    const outside = await adapter().restoreBackup(context(whmServer, db()), 'shop', '/etc/passwd');
    expect(outside).toMatchObject({ ok: false, code: 'INVALID_ARCHIVE_PATH' });
    expect(calls.length).toBe(0);

    const traversal = await adapter().restoreBackup(context(whmServer, db()), 'shop', '/home/shop/../root/x.tar.gz');
    expect(traversal.ok).toBe(false);

    const inside = await adapter().restoreBackup(context(whmServer, db()), 'shop', '/home/shop/backup-10.02.2026_10-00-00_shop.tar.gz');
    expect(inside.ok).toBe(true);
    const restore = calls.find((call) => call.url.includes('cpanel_jsonapi_func=restore_backup'));
    expect(restore).toBeDefined();
    expect(String(restore?.url)).toContain('file=backup-10.02.2026_10-00-00_shop.tar.gz');
  });
});

describe('Kubernetes adapter addresses the cluster API the way Kubernetes does', () => {
  const kubeServer = serverRow({
    server_type: 'KUBERNETES',
    kubernetes_enabled: true,
    metadata: { kubernetes_api: 'https://kube.test:6443', kubernetes_namespace: 'cloudhost247' },
  });

  function adapter() {
    return createKubernetesAdapter({ enabled: true, simulationMode: false });
  }
  function db() {
    return fakeDb('kubernetes_kubeconfig', 'kube-token');
  }

  it('maps each rendered kind to its real group/version/resource collection', () => {
    expect(kubernetesCollectionPath('ns', { apiVersion: 'v1', kind: 'Secret' })).toBe('/api/v1/namespaces/ns/secrets');
    expect(kubernetesCollectionPath('ns', { apiVersion: 'v1', kind: 'PersistentVolumeClaim' })).toBe(
      '/api/v1/namespaces/ns/persistentvolumeclaims'
    );
    expect(kubernetesCollectionPath('ns', { apiVersion: 'apps/v1', kind: 'Deployment' })).toBe(
      '/apis/apps/v1/namespaces/ns/deployments'
    );
    expect(kubernetesCollectionPath('ns', { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress' })).toBe(
      '/apis/networking.k8s.io/v1/namespaces/ns/ingresses'
    );
    expect(kubernetesCollectionPath('ns', { apiVersion: 'v1', kind: 'Mystery' })).toBeNull();
  });

  it('applies every object to its own collection, Secret first, with the environment inline', async () => {
    const calls = installFetch(() => json({}, 201));
    const manifest = {
      services: { app: { image: 'app:1', port: 8080, volumes: ['/data'] } },
      requirements: { storage: 512 },
    } as never;
    const result = await adapter().deployApplication(context(kubeServer, db()), {
      installationId: 'i-1', project: 'shop', manifest, appImage: 'app:1', domain: 'shop.test',
      sslEnabled: true, cpuLimit: 1, memoryLimitMb: 512, storageLimitMb: 512,
      environment: { SECRET_TOKEN: 's3cret' },
    });
    expect(result.ok).toBe(true);
    const paths = calls.map((call) => call.url.replace('https://kube.test:6443', ''));
    expect(paths[0]).toBe('/api/v1/namespaces/cloudhost247/secrets');
    expect(paths).toContain('/api/v1/namespaces/cloudhost247/persistentvolumeclaims');
    expect(paths).toContain('/apis/apps/v1/namespaces/cloudhost247/deployments');
    expect(paths).toContain('/api/v1/namespaces/cloudhost247/services');
    expect(paths).toContain('/apis/networking.k8s.io/v1/namespaces/cloudhost247/ingresses');
    const secret = calls[0];
    expect(JSON.parse(String(secret.init.body))).toMatchObject({ stringData: { SECRET_TOKEN: 's3cret' } });
    expect((secret.init.headers as Record<string, string>).authorization).toBe('Bearer kube-token');
  });

  it('re-PUTs an object that already exists, keeping the live resourceVersion', async () => {
    const calls = installFetch((url, init) => {
      if (init.method === 'POST') return json({ metadata: { name: 'shop' } }, 409);
      if (init.method === 'GET') return json({ metadata: { resourceVersion: '12345' } });
      return json({}, 200);
    });
    const manifest = { services: {}, requirements: { storage: 0 } } as never;
    const result = await adapter().deployApplication(context(kubeServer, db()), {
      installationId: 'i-1', project: 'shop', manifest, appImage: 'app:1', domain: null,
      sslEnabled: false, cpuLimit: 1, memoryLimitMb: 512, storageLimitMb: 512, environment: {},
    });
    expect(result.ok).toBe(true);
    const put = calls.find((call) => call.init.method === 'PUT');
    expect(put).toBeDefined();
    expect(JSON.parse(String(put?.init.body))).toMatchObject({ metadata: { resourceVersion: '12345' } });
  });

  it('start restores the replicas a stop remembered, and stop records them', async () => {
    const calls = installFetch((url, init) => {
      if (!init.method || init.method === 'GET') {
        return json({ metadata: { name: 'shop' }, spec: { replicas: 3 }, status: {} });
      }
      return json({}, 200);
    });
    await adapter().stopApplication(context(kubeServer, db()), 'shop');
    const stopPatch = calls.find((call) => call.init.method === 'PATCH');
    const stopBody = JSON.parse(String(stopPatch?.init.body));
    expect(stopBody.spec.replicas).toBe(0);
    expect((stopPatch?.init.headers as Record<string, string>)['content-type']).toBe('application/merge-patch+json');

    installFetch((url, init) => {
      if (!init.method || init.method === 'GET') {
        return json({
          metadata: { name: 'shop', annotations: { [LAST_REPLICAS_ANNOTATION]: '3' } },
          spec: { replicas: 0 },
          status: {},
        });
      }
      return json({}, 200);
    });
    const startCalls = installFetch((url, init) =>
      init.method === 'PATCH' ? json({}, 200) : json({ metadata: { name: 'shop', annotations: { [LAST_REPLICAS_ANNOTATION]: '3' } }, spec: { replicas: 0 } })
    );
    void calls;
    const started = await adapter().startApplication(context(kubeServer, db()), 'shop');
    expect(started.ok).toBe(true);
    const startPatch = startCalls.find((call) => call.init.method === 'PATCH');
    expect(JSON.parse(String(startPatch?.init.body)).spec.replicas).toBe(3);
  });

  it('restart is the documented rollout-restart annotation patch', async () => {
    const calls = installFetch((url, init) =>
      init.method === 'PATCH' ? json({}, 200) : json({ metadata: { name: 'shop' }, spec: { replicas: 1 }, status: {} })
    );
    const result = await adapter().restartApplication(context(kubeServer, db()), 'shop');
    expect(result.ok).toBe(true);
    const patch = calls.find((call) => call.init.method === 'PATCH');
    const body = JSON.parse(String(patch?.init.body));
    expect(body.spec.template.metadata.annotations[RESTART_ANNOTATION]).toBeTruthy();
    expect(patch?.url).toBe('https://kube.test:6443/apis/apps/v1/namespaces/cloudhost247/deployments/shop');
  });

  it('reports health from the Deployment and its pods, never from an assumption', async () => {
    installFetch((url) => {
      if (url.includes('/pods')) {
        return json({ items: [{ metadata: { name: 'shop-1' }, status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 2 }] } }] });
      }
      return json({
        metadata: { name: 'shop' },
        spec: { replicas: 2 },
        status: { availableReplicas: 1, readyReplicas: 1, conditions: [{ type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' }] },
      });
    });
    const status = await adapter().applicationStatus(context(kubeServer, db()), 'shop');
    expect(status).toMatchObject({ ok: true, running: true, health: 'unhealthy' });
    expect(status.detail).toContain('desired=2');
    expect(status.detail).toContain('restarts=2');
    expect(status.detail).toContain('Progressing=True(NewReplicaSetAvailable)');
  });

  it('reads logs from the newest pod of the deployment', async () => {
    const calls = installFetch((url) => {
      if (url.includes('/pods?')) {
        return json({
          items: [
            { metadata: { name: 'shop-old', creationTimestamp: '2026-10-01T00:00:00Z' }, spec: { containers: [{ name: 'app' }] } },
            { metadata: { name: 'shop-new', creationTimestamp: '2026-10-02T00:00:00Z' }, spec: { containers: [{ name: 'app' }] } },
          ],
        });
      }
      return new Response('serve\nrequest 200\n', { status: 200 });
    });
    const result = await adapter().applicationLogs(context(kubeServer, db()), 'shop', 50);
    expect(result.ok).toBe(true);
    expect(result.logs).toContain('request 200');
    const logCall = calls.find((call) => call.url.includes('/log?'));
    expect(logCall?.url).toContain('pods/shop-new/log');
    expect(logCall?.url).toContain('tailLines=50');
  });

  it('refuses backups with a structured reason instead of reporting an empty success', async () => {
    const backup = await adapter().runBackup(context(kubeServer, db()), 'shop', {} as never);
    expect(backup).toMatchObject({ ok: false, code: 'K8S_BACKUP_REQUIRES_VELERO', archivePath: null, sizeBytes: null, checksum: null });
    const restore = await adapter().restoreBackup(context(kubeServer, db()), 'shop', '/tmp/x.tar.gz');
    expect(restore).toMatchObject({ ok: false, code: 'K8S_RESTORE_REQUIRES_VELERO' });
  });

  it('tears down by discovering labelled objects, and still refuses hosting operations', async () => {
    const calls = installFetch((url, init) => {
      if (!init.method || init.method === 'GET') {
        return url.includes('labelSelector=app.kubernetes.io%2Fpart-of%3Dshop')
          ? json({ items: [{ metadata: { name: 'shop' } }] })
          : json({ items: [] });
      }
      return json({}, 200);
    });
    const teardown = await adapter().destroyApplication(context(kubeServer, db()), 'shop');
    expect(teardown.ok).toBe(true);
    expect(calls.some((call) => call.init.method === 'DELETE')).toBe(true);

    const ctx = context(kubeServer, db());
    await expect(adapter().provisionHosting(ctx, {} as never)).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter().suspendHosting(ctx, 'x')).rejects.toBeInstanceOf(UnsupportedOperationError);
    await expect(adapter().terminateHosting(ctx, 'x')).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  it('stays off when the experimental switch is not set', async () => {
    const disabled = createKubernetesAdapter({ enabled: false, simulationMode: false });
    const result = await disabled.deployApplication(context(kubeServer, db()), {
      installationId: randomUUID(), project: 'shop', manifest: { services: {}, requirements: { storage: 0 } } as never,
      appImage: 'app:1', domain: null, sslEnabled: false, cpuLimit: 1, memoryLimitMb: 256, storageLimitMb: 256, environment: {},
    });
    expect(result).toMatchObject({ ok: false, code: 'KUBERNETES_ADAPTER_DISABLED' });
  });
});

/**
 * The agent's backup reply now says what the archive actually holds. A manifest that asks for a
 * database dump and gets none must leave a trace in the deployment log: silently reporting a clean
 * backup is what let a MongoDB deployment (a first-class manifest dependency) be backed up for as
 * long as the agent has existed with no database dump inside the archive at all.
 */
describe('docker adapter reports what a backup really contains', () => {
  const dockerServer = serverRow({
    server_type: 'VPS',
    docker_enabled: true,
    agent_id: 'agent-1',
    metadata: { agent_url: 'https://agent.test:8787' },
  });
  const dockerManifest = (includes: string[]) =>
    ({ services: { app: { port: 3000 } }, requirements: { storage: 1 }, backup: { includes } }) as never;
  function db() {
    return fakeDb('agent_secret', 'agent-secret-value');
  }

  function backupReply(databaseDump: unknown) {
    return json({
      archivePath: '/opt/cloudhost247/backups/shop-2026.tar.gz',
      sizeBytes: 4096,
      checksum: 'a'.repeat(64),
      includes: { volumes: true, databases: null },
      ...(databaseDump === undefined ? {} : { databaseDump }),
    });
  }

  it('warns, and names the reason, when a requested database dump produced nothing', async () => {
    installFetch(() =>
      backupReply({ engine: null, service: null, file: null, reason: 'no service produced a logical database dump', attempted: ['cache:postgres (empty output)'] })
    );
    const logs: string[] = [];
    const result = await createDockerAdapter({ simulationMode: false }).runBackup(
      context(dockerServer, db(), logs),
      'shop',
      dockerManifest(['volumes', 'database'])
    );

    expect(result.ok).toBe(true);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('warn:');
    expect(logs[0]).toContain('a database dump but the agent produced none');
    expect(logs[0]).toContain('no service produced a logical database dump');
    expect(logs[0]).toContain('cache:postgres (empty output)');
  });

  it('stays quiet when the dump was produced, and names the engine in the result', async () => {
    installFetch(() => backupReply({ engine: 'postgres', service: 'db', file: '/opt/db-dump-postgres.sql' }));
    const logs: string[] = [];
    const result = await createDockerAdapter({ simulationMode: false }).runBackup(
      context(dockerServer, db(), logs),
      'shop',
      dockerManifest(['volumes', 'database'])
    );

    expect(result).toMatchObject({ ok: true, message: 'Backup completed (postgres dump included)' });
    expect(logs).toEqual([]);
  });

  it('does not warn when the manifest never asked for a database dump', async () => {
    installFetch(() => backupReply(undefined));
    const logs: string[] = [];
    const result = await createDockerAdapter({ simulationMode: false }).runBackup(
      context(dockerServer, db(), logs),
      'shop',
      dockerManifest(['volumes'])
    );

    expect(result).toMatchObject({ ok: true, message: 'Backup completed' });
    expect(logs).toEqual([]);
  });

  it('does not warn about an agent too old to report a dump outcome', async () => {
    // "absent" must mean unknown, not "the dump is missing" — an older agent must not be accused.
    installFetch(() => backupReply(undefined));
    const logs: string[] = [];
    const result = await createDockerAdapter({ simulationMode: false }).runBackup(
      context(dockerServer, db(), logs),
      'shop',
      dockerManifest(['volumes', 'database'])
    );

    expect(result).toMatchObject({ ok: true, message: 'Backup completed' });
    expect(logs).toEqual([]);
  });
});

/**
 * The restore pipeline stops a running application before restoring *only* when the engine declares
 * that its restore writes underneath live workloads (see restorePipeline and
 * DeploymentAdapter.restoreRequiresStoppedApplication). That declaration is what makes the pipeline
 * correct, and the pipeline's own integration tests inject a stub adapter — so nothing there notices
 * if the real docker adapter stops declaring it. This pins the declaration against the real adapters.
 */
describe('restore quiescence is declared by the engine, not inferred by the pipeline', () => {
  it('the docker engine declares that its restore replaces volume data under running containers', () => {
    expect(createDockerAdapter({ simulationMode: false }).restoreRequiresStoppedApplication).toBe(true);
  });

  it('cPanel and Kubernetes do not, because their restores are not container-volume replacements', () => {
    // cPanel restores an account's home directory through the panel's own UAPI, which is the
    // account's normal live path; suspending the account around a restore would take the customer's
    // site and mail offline. Kubernetes restores are refused outright.
    expect(createCpanelAdapter({ simulationMode: false }).restoreRequiresStoppedApplication).toBeUndefined();
    expect(
      createKubernetesAdapter({ enabled: true, simulationMode: false }).restoreRequiresStoppedApplication
    ).toBeUndefined();
  });
});

/**
 * A restore is destructive and irreversible, so the archive it applies must be the archive that was
 * taken. The platform records the sha256 at backup time; this pins that the adapter sends it and that
 * the result distinguishes "verified against the recorded digest" from "nothing was available to check
 * against" — a caller reading only "Restored" could not tell the two apart.
 */
describe('docker adapter verifies a restore archive against the recorded checksum', () => {
  const dockerServer = serverRow({
    server_type: 'VPS',
    docker_enabled: true,
    agent_id: 'agent-1',
    metadata: { agent_url: 'https://agent.test:8787' },
  });
  function db() {
    return fakeDb('agent_secret', 'agent-secret-value');
  }

  it('sends the recorded checksum with the restore request and reports the verification', async () => {
    const calls = installFetch(() => json({ restored: true, members: 6, checksumVerified: true }));
    const recorded = 'c'.repeat(64);

    const result = await createDockerAdapter({ simulationMode: false }).restoreBackup(
      context(dockerServer, db()),
      'shop',
      '/opt/cloudhost247/backups/shop-2026.tar.gz',
      { expectedChecksum: recorded }
    );

    expect(result.ok).toBe(true);
    expect(result.message).toContain('verified against the recorded checksum');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ archivePath: '/opt/cloudhost247/backups/shop-2026.tar.gz', checksum: recorded });
  });

  it('does not claim a verification that did not happen', async () => {
    // No digest on record (a backup row written before checksums were stored), or an agent older than
    // the check: the restore still succeeds, and the message must not imply the archive was checked.
    const calls = installFetch(() => json({ restored: true, members: 6 }));
    const result = await createDockerAdapter({ simulationMode: false }).restoreBackup(
      context(dockerServer, db()),
      'shop',
      '/opt/cloudhost247/backups/shop-old.tar.gz',
      { expectedChecksum: null }
    );

    expect(result.ok).toBe(true);
    expect(result.message).not.toContain('verified');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ archivePath: '/opt/cloudhost247/backups/shop-old.tar.gz' });
  });

  it('surfaces the agent refusal when the archive does not match the recorded digest', async () => {
    installFetch(() =>
      json({ error: 'OPERATION_FAILED', message: 'backup archive checksum mismatch: the control plane recorded ccc…, the archive on disk is ddd…' }, 500)
    );
    const result = await createDockerAdapter({ simulationMode: false }).restoreBackup(
      context(dockerServer, db()),
      'shop',
      '/opt/cloudhost247/backups/shop-2026.tar.gz',
      { expectedChecksum: 'c'.repeat(64) }
    );

    expect(result.ok).toBe(false);
    expect(result.code).toBe('RESTORE_FAILED');
    expect(result.message).toContain('checksum mismatch');
  });
});
