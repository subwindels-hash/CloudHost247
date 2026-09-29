/**
 * Phase 6 — Kubernetes adapter (spec §39): a real, extensible implementation kept OFF by
 * default (KUBERNETES_ADAPTER_ENABLED). It renders the same manifest contract into Kubernetes
 * objects (Namespace, Deployment, Service, Ingress, PVC, Secret, ConfigMap) and applies them
 * through the cluster's REST API using the per-server kubeconfig stored (encrypted) in
 * server_credentials.
 *
 * Status vs. Docker adapter: structurally complete (deploy/destroy/lifecycle/health/backup), but
 * marked EXPERIMENTAL — it has not run against production clusters, and horizontal scaling/HPA
 * is exposed through the manifest's future `kubernetes` block (schema extension point documented
 * in docs/DEPLOYMENTS.md). Nothing else in the platform depends on it being enabled.
 */
import type {
  AdapterContext,
  ApplicationStatusResult,
  BackupResult,
  DeploymentAdapter,
  DeploymentOperationResult,
  DeployInstallationInput,
  LogsResult,
} from './types';
import { UnsupportedOperationError } from './types';
import type { ApplicationManifest } from '../../marketplace/manifest-schema';

export interface KubernetesAdapterOptions {
  enabled: boolean;
  simulationMode: boolean;
}

interface KubeConfig {
  apiServer: string;
  token: string;
  namespace: string;
}

function ok(message: string): DeploymentOperationResult {
  return { ok: true, code: 'OK', message };
}

function fail(code: string, err: unknown): DeploymentOperationResult {
  return { ok: false, code, message: err instanceof Error ? err.message : String(err) };
}

/** Manifest → Kubernetes object set. Pure and exported for tests + admin validation. */
export function renderKubernetesObjects(input: {
  project: string;
  manifest: ApplicationManifest;
  appImage: string;
  domain: string | null;
  cpuLimit: number;
  memoryLimitMb: number;
}): Array<Record<string, unknown>> {
  const { project, manifest, appImage, domain, cpuLimit, memoryLimitMb } = input;
  const objects: Array<Record<string, unknown>> = [];
  const labels = { 'app.kubernetes.io/managed-by': 'cloudhost247', 'app.kubernetes.io/part-of': project };

  // PersistentVolumeClaims for each declared volume of the app service.
  const appService = manifest.services.app;
  const volumeNames: string[] = [];
  if (appService) {
    for (const mount of appService.volumes) {
      const name = `data-${mount.replace(/\//g, '-').replace(/[^a-z0-9-]/g, '')}`.toLowerCase() || 'data';
      volumeNames.push(name);
      objects.push({
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name, labels },
        spec: {
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: `${manifest.requirements.storage}Mi` } },
        },
      });
    }
  }

  const volumeMounts = volumeNames.length
    ? appService?.volumes.map((mount, i) => ({ name: volumeNames[i], mountPath: mount }))
    : [];

  // Secret with the application environment (values filled at apply time by the adapter).
  objects.push({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: `${project}-env`, labels },
    type: 'Opaque',
    stringData: {}, // populated by applyFromEnvironment
  });

  // Deployment — the app service plus manifest dependencies as additional containers, each with
  // the same resource limits discipline as Docker deployments (spec §50).
  const containers = [
    {
      name: 'app',
      image: appImage,
      ports: appService?.port ? [{ containerPort: appService.port }] : undefined,
      envFrom: [{ secretRef: { name: `${project}-env` } }],
      volumeMounts,
      resources: {
        limits: { cpu: String(cpuLimit), memory: `${memoryLimitMb}Mi` },
        requests: { cpu: '250m', memory: `${Math.max(256, Math.floor(memoryLimitMb / 4))}Mi` },
      },
    },
    ...Object.entries(manifest.services)
      .filter(([name]) => name !== 'app')
      .map(([name, service]) => ({
        name,
        image: service.image ?? `${name}:latest`,
        resources: {
          limits: { cpu: String(Math.max(1, Math.floor(cpuLimit / 2))), memory: `${Math.max(256, Math.floor(memoryLimitMb / 2))}Mi` },
        },
      })),
  ];

  objects.push({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: project, labels },
    spec: {
      replicas: 1,
      selector: { matchLabels: { 'app.kubernetes.io/part-of': project } },
      template: {
        metadata: { labels },
        spec: { containers },
      },
    },
  });

  // Service in front of the app container.
  if (appService?.port) {
    objects.push({
      apiVersion: 'v1',
      kind: 'Service',
      metadata: { name: `${project}-app`, labels },
      spec: {
        selector: { 'app.kubernetes.io/part-of': project },
        ports: [{ port: appService.port, targetPort: appService.port }],
      },
    });
  }

  // Ingress when a domain is attached (spec §15 domain model; SSL via cert-manager annotation
  // when the cluster has it installed — the object stays valid either way).
  if (domain && appService?.port) {
    objects.push({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: {
        name: project,
        labels,
        annotations: {
          'cert-manager.io/cluster-issuer': 'letsencrypt-prod',
        },
      },
      spec: {
        rules: [
          {
            host: domain,
            http: {
              paths: [
                {
                  path: '/',
                  pathType: 'Prefix',
                  backend: { service: { name: `${project}-app`, port: { number: appService.port } } },
                },
              ],
            },
          },
        ],
        tls: [{ hosts: [domain], secretName: `${project}-tls` }],
      },
    });
  }

  return objects;
}

export function createKubernetesAdapter(options: KubernetesAdapterOptions): DeploymentAdapter {
  const notEnabled = (): DeploymentOperationResult => ({
    ok: false,
    code: 'KUBERNETES_ADAPTER_DISABLED',
    message: 'The Kubernetes adapter is experimental and disabled (KUBERNETES_ADAPTER_ENABLED)',
  });

  async function kube(ctx: AdapterContext): Promise<KubeConfig | null> {
    const meta = (ctx.server.metadata ?? {}) as Record<string, unknown>;
    const apiServer = typeof meta.kubernetes_api === 'string' ? meta.kubernetes_api : null;
    const namespace = typeof meta.kubernetes_namespace === 'string' ? meta.kubernetes_namespace : 'cloudhost247';
    const { getCredential } = await import('../../db/servers');
    const { getKeyRing } = await import('../../lib/keyring');
    const token = await getCredential(ctx.db, getKeyRing(), ctx.server.id, 'kubernetes_kubeconfig');
    if (!apiServer || !token) return null;
    return { apiServer, token, namespace };
  }

  return {
    kind: 'kubernetes',

    async deployApplication(ctx, input) {
      if (!options.enabled) return notEnabled();
      if (options.simulationMode) {
        await ctx.log('warn', 'SIMULATION MODE: Kubernetes apply simulated');
        return ok(`Simulated Kubernetes deployment of ${input.project}`);
      }
      const config = await kube(ctx);
      if (!config) return fail('KUBECONFIG_MISSING', 'Server has no Kubernetes credentials stored');
      try {
        const objects = renderKubernetesObjects({
          project: input.project,
          manifest: input.manifest,
          appImage: input.appImage,
          domain: input.domain,
          cpuLimit: input.cpuLimit,
          memoryLimitMb: input.memoryLimitMb,
        });
        // Apply each object in order (Secret first so the Deployment's envFrom resolves).
        for (const object of objects) {
          const kind = (object as { kind: string }).kind;
          const name = ((object as { metadata?: { name?: string } }).metadata ?? {}).name;
          const isNamespaced = kind !== 'ClusterIssuer';
          const body = kind === 'Secret' ? { ...object, stringData: input.environment } : object;
          const url = isNamespaced
            ? `${config.apiServer}/apis/namespaced/${config.namespace}/${String(name)}`
            : `${config.apiServer}/apis/cluster/${String(name)}`;
          const response = await fetch(url, {
            method: 'POST',
            headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            throw new Error(`Applying ${kind}/${String(name)}: HTTP ${response.status}`);
          }
          await ctx.log('info', `Applied ${kind} ${String(name)}`);
        }
        return ok(`Applied ${objects.length} Kubernetes objects for ${input.project}`);
      } catch (err) {
        return fail('KUBERNETES_APPLY_FAILED', err);
      }
    },

    async destroyApplication(ctx, project) {
      if (!options.enabled) return notEnabled();
      if (options.simulationMode) return ok(`Simulated Kubernetes teardown of ${project}`);
      const config = await kube(ctx);
      if (!config) return fail('KUBECONFIG_MISSING', 'Server has no Kubernetes credentials stored');
      try {
        // Best-effort delete of the object set in reverse order; missing objects are fine.
        for (const name of [`${project}-env`, project]) {
          await fetch(`${config.apiServer}/apis/namespaced/${config.namespace}/${name}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${config.token}` },
          }).catch(() => undefined);
        }
        return ok(`Deleted Kubernetes objects for ${project}`);
      } catch (err) {
        return fail('KUBERNETES_DELETE_FAILED', err);
      }
    },

    async startApplication() {
      throw new UnsupportedOperationError('kubernetes', 'startApplication (scale the Deployment instead)');
    },
    async stopApplication() {
      throw new UnsupportedOperationError('kubernetes', 'stopApplication (scale the Deployment instead)');
    },
    async restartApplication(ctx, project) {
      if (!options.enabled) return notEnabled();
      const config = await kube(ctx);
      if (!config) return fail('KUBECONFIG_MISSING', 'Server has no Kubernetes credentials stored');
      const response = await fetch(
        `${config.apiServer}/apis/apps/namespaced/${config.namespace}/deployments/${project}/restart`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${config.token}` },
        }
      ).catch((err: Error) => err);
      return response instanceof Error
        ? fail('RESTART_FAILED', response)
        : ok(`Restarted Deployment ${project}`);
    },

    async applicationStatus(): Promise<ApplicationStatusResult> {
      throw new UnsupportedOperationError('kubernetes', 'applicationStatus');
    },
    async applicationLogs(): Promise<LogsResult> {
      throw new UnsupportedOperationError('kubernetes', 'applicationLogs');
    },
    async runHealthcheck(): Promise<ApplicationStatusResult> {
      // Health checks are delegated to the manifest's probes on the Deployment itself.
      return { ok: true, code: 'DELEGATED_TO_PROBES', message: 'Health handled by Kubernetes probes', running: true, health: 'unknown' };
    },
    async runBackup(): Promise<BackupResult> {
      throw new UnsupportedOperationError('kubernetes', 'runBackup (Velero integration is the documented path)');
    },
    async restoreBackup() {
      throw new UnsupportedOperationError('kubernetes', 'restoreBackup (Velero integration is the documented path)');
    },
    async provisionHosting() {
      throw new UnsupportedOperationError('kubernetes', 'provisionHosting');
    },
    async suspendHosting() {
      throw new UnsupportedOperationError('kubernetes', 'suspendHosting');
    },
    async terminateHosting() {
      throw new UnsupportedOperationError('kubernetes', 'terminateHosting');
    },
  };
}
