/**
 * Phase 6 — Kubernetes adapter (spec §39): a real, extensible implementation kept OFF by
 * default (KUBERNETES_ADAPTER_ENABLED). It renders the manifest contract into Kubernetes
 * objects (Namespace, Deployment, Service, Ingress, PVC, Secret) and applies them through the
 * cluster's REST API using the per-server kubeconfig stored (encrypted) in server_credentials.
 *
 * Paths are the Kubernetes API's own: core resources under `/api/v1/namespaces/{ns}/{resource}`,
 * apps and networking under `/apis/{group}/{version}/namespaces/{ns}/{resource}`. Creating is a
 * POST; a 409 means the object already exists, so the desired body is PUT back with the live
 * object's resourceVersion (optimistic concurrency, exactly what `kubectl apply` does).
 *
 * Lifecycle operations are the cluster's own mechanisms, not inventions:
 *   start  → patch `spec.replicas` back to the last non-zero count (annotation) or 1
 *   stop   → patch `spec.replicas` to 0, remembering the previous count
 *   restart→ patch the pod template's `kubectl.kubernetes.io/restartedAt` annotation
 *            (the documented mechanism behind `kubectl rollout restart`)
 *
 * Status and logs are read from the Deployment and its Pods; health is derived from the
 * Deployment's available replicas, never assumed. Backups stay refused: the platform's backup
 * contract requires a retrievable archive (storage path, size, checksum) that the engine can
 * restore and verify, and a cluster-side Velero backup is asynchronous and not an archive the
 * engine holds. The refusal is explicit rather than a silent success.
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

interface KubeDeployment {
  metadata?: { name?: string; annotations?: Record<string, string>; generation?: number };
  spec?: { replicas?: number; selector?: { matchLabels?: Record<string, string> } };
  status?: {
    replicas?: number;
    readyReplicas?: number;
    availableReplicas?: number;
    unavailableReplicas?: number;
    observedGeneration?: number;
    conditions?: Array<{ type?: string; status?: string; reason?: string; message?: string }>;
  };
}

interface KubePod {
  metadata?: { name?: string; creationTimestamp?: string };
  spec?: { containers?: Array<{ name?: string }> };
  status?: {
    phase?: string;
    containerStatuses?: Array<{ name?: string; ready?: boolean; restartCount?: number }>;
  };
}

interface KubePodList {
  items?: KubePod[];
}

/** The rollout-restart annotation `kubectl rollout restart` writes. */
export const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';
/** Where the adapter remembers the replica count a stop must undo. */
export const LAST_REPLICAS_ANNOTATION = 'cloudhost247.io/last-replicas';
const MANAGED_LABEL = 'app.kubernetes.io/part-of';

function ok(message: string): DeploymentOperationResult {
  return { ok: true, code: 'OK', message };
}

function fail(code: string, err: unknown): DeploymentOperationResult {
  return { ok: false, code, message: err instanceof Error ? err.message : String(err) };
}

/**
 * Manifest → Kubernetes object set. Pure and exported for tests + admin validation.
 *
 * The API path of each object is derived from its kind, because the cluster's REST surface is
 * group/version/resource based — the kind alone does not address an object.
 */
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

  // Secret with the application environment (values filled at apply time by the adapter).
  objects.push({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: `${project}-env`, labels },
    type: 'Opaque',
    stringData: {}, // populated by applyFromEnvironment
  });

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
      selector: { matchLabels: { [MANAGED_LABEL]: project } },
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
        selector: { [MANAGED_LABEL]: project },
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

/** The REST collection path for a rendered object, from its apiVersion + kind. */
export function kubernetesCollectionPath(namespace: string, object: { apiVersion?: string; kind?: string }): string | null {
  const kind = String(object.kind ?? '');
  const group = String(object.apiVersion ?? 'v1');
  const resources: Record<string, string> = {
    PersistentVolumeClaim: 'persistentvolumeclaims',
    Secret: 'secrets',
    Service: 'services',
    Deployment: 'deployments',
    Ingress: 'ingresses',
  };
  const resource = resources[kind];
  if (!resource) return null;
  const prefix = group === 'v1' ? '/api/v1' : `/apis/${group}`;
  return `${prefix}/namespaces/${encodeURIComponent(namespace)}/${resource}`;
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
    return { apiServer, token: token.trim(), namespace };
  }

  /** One authenticated cluster request. Returns the status and parsed body; never logs the token. */
  async function request(
    config: KubeConfig,
    path: string,
    init: { method?: string; body?: unknown; contentType?: string } = {}
  ): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${config.apiServer}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${config.token}`,
        accept: 'application/json',
        ...(init.body === undefined ? {} : { 'content-type': init.contentType ?? 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { message: text.slice(0, 500) };
      }
    }
    return { status: response.status, body };
  }

  function deploymentPath(config: KubeConfig, project: string): string {
    return `/apis/apps/v1/namespaces/${encodeURIComponent(config.namespace)}/deployments/${encodeURIComponent(project)}`;
  }

  function podsPath(config: KubeConfig, project: string): string {
    const selector = encodeURIComponent(`${MANAGED_LABEL}=${project}`);
    return `/api/v1/namespaces/${encodeURIComponent(config.namespace)}/pods?labelSelector=${selector}`;
  }

  async function readDeployment(config: KubeConfig, project: string): Promise<KubeDeployment | null> {
    const { status, body } = await request(config, deploymentPath(config, project));
    if (status === 404) return null;
    if (status >= 400) throw new Error(`Reading Deployment ${project}: HTTP ${status}`);
    return (body ?? {}) as KubeDeployment;
  }

  async function listPods(config: KubeConfig, project: string): Promise<KubePod[]> {
    const { status, body } = await request(config, podsPath(config, project));
    if (status >= 400) throw new Error(`Listing pods for ${project}: HTTP ${status}`);
    return ((body as KubePodList | null)?.items ?? []).filter((pod) => Boolean(pod.metadata?.name));
  }

  function podSummary(pods: KubePod[]): { total: number; ready: number; restarts: number; phases: Record<string, number> } {
    const phases: Record<string, number> = {};
    let ready = 0;
    let restarts = 0;
    for (const pod of pods) {
      const phase = pod.status?.phase ?? 'Unknown';
      phases[phase] = (phases[phase] ?? 0) + 1;
      const containers = pod.status?.containerStatuses ?? [];
      if (containers.length > 0 && containers.every((container) => container.ready)) ready += 1;
      for (const container of containers) restarts += container.restartCount ?? 0;
    }
    return { total: pods.length, ready, restarts, phases };
  }

  async function statusOf(config: KubeConfig, project: string): Promise<ApplicationStatusResult> {
    const deployment = await readDeployment(config, project);
    if (!deployment) {
      return {
        ok: false,
        code: 'DEPLOYMENT_NOT_FOUND',
        message: `Deployment ${project} was not found in namespace ${config.namespace}`,
        running: false,
        health: 'unknown',
      };
    }
    const desired = deployment.spec?.replicas ?? 0;
    const available = deployment.status?.availableReplicas ?? 0;
    const pods = await listPods(config, project);
    const summary = podSummary(pods);
    const conditions = (deployment.status?.conditions ?? [])
      .map((condition) => `${condition.type}=${condition.status}${condition.reason ? `(${condition.reason})` : ''}`)
      .join(', ');
    let health: ApplicationStatusResult['health'] = 'unknown';
    if (desired > 0) health = available >= desired ? 'healthy' : available === 0 ? 'unhealthy' : 'unhealthy';
    const detail = [
      `desired=${desired}`,
      `available=${available}`,
      `ready=${deployment.status?.readyReplicas ?? 0}`,
      `pods=${summary.ready}/${summary.total} ready`,
      `restarts=${summary.restarts}`,
      conditions ? `conditions: ${conditions}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      ok: true,
      code: 'OK',
      message: `Deployment ${project}: ${available}/${desired} replicas available`,
      running: available > 0,
      health,
      detail,
    };
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
          const kind = String((object as { kind?: string }).kind ?? 'object');
          const metadata = (object as { metadata?: { name?: string } }).metadata ?? {};
          const name = String(metadata.name ?? '');
          const collection = kubernetesCollectionPath(config.namespace, object as { apiVersion?: string; kind?: string });
          if (!collection) throw new Error(`No REST resource is mapped for kind ${kind}`);
          const itemPath = `${collection}/${encodeURIComponent(name)}`;
          const body = kind === 'Secret' ? { ...(object as Record<string, unknown>), stringData: input.environment } : object;
          let response = await request(config, collection, { method: 'POST', body });
          if (response.status === 409) {
            // Already exists: replace it with the desired body, keeping the live resourceVersion
            // so the cluster rejects a concurrent writer instead of silently losing their edit.
            const live = await request(config, itemPath);
            const resourceVersion = ((live.body as { metadata?: { resourceVersion?: string } })?.metadata ?? {})
              .resourceVersion;
            const merged = {
              ...(body as Record<string, unknown>),
              metadata: { ...((body as { metadata?: Record<string, unknown> }).metadata ?? {}), resourceVersion },
            };
            response = await request(config, itemPath, { method: 'PUT', body: merged });
          }
          if (response.status >= 400) {
            throw new Error(`Applying ${kind}/${name}: HTTP ${response.status}`);
          }
          await ctx.log('info', `Applied ${kind} ${name}`);
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
        // Everything this platform creates carries the managed label, so teardown discovers the
        // live object set instead of guessing names. Objects already gone are not an error.
        const collections = [
          '/apis/networking.k8s.io/v1/namespaces',
          '/apis/apps/v1/namespaces',
          '/api/v1/namespaces',
        ].flatMap((base) =>
          (base.endsWith('/apis/networking.k8s.io/v1/namespaces')
            ? ['ingresses']
            : base.endsWith('/apis/apps/v1/namespaces')
              ? ['deployments']
              : ['services', 'secrets', 'persistentvolumeclaims']
          ).map((resource) => `${base}/${encodeURIComponent(config.namespace)}/${resource}`)
        );
        const selector = encodeURIComponent(`${MANAGED_LABEL}=${project}`);
        let deleted = 0;
        for (const collection of collections) {
          const { status, body } = await request(config, `${collection}?labelSelector=${selector}`);
          if (status === 404 || status >= 400) continue;
          const items = ((body as { items?: Array<{ metadata?: { name?: string } }> })?.items ?? []);
          for (const item of items) {
            const name = String(item.metadata?.name ?? '');
            if (!name) continue;
            const result = await request(config, `${collection}/${encodeURIComponent(name)}`, { method: 'DELETE' });
            if (result.status >= 400 && result.status !== 404) {
              await ctx.log('warn', `Deleting ${name}: HTTP ${result.status}`);
            } else {
              deleted += 1;
            }
          }
        }
        return ok(`Deleted ${deleted} Kubernetes object(s) for ${project}`);
      } catch (err) {
        return fail('KUBERNETES_DELETE_FAILED', err);
      }
    },

    async startApplication(ctx, project) {
      if (!options.enabled) return notEnabled();
      if (options.simulationMode) return ok(`Simulated start of ${project}`);
      const config = await kube(ctx);
      if (!config) return fail('KUBECONFIG_MISSING', 'Server has no Kubernetes credentials stored');
      try {
        const deployment = await readDeployment(config, project);
        if (!deployment) return fail('DEPLOYMENT_NOT_FOUND', `Deployment ${project} was not found in namespace ${config.namespace}`);
        const current = deployment.spec?.replicas ?? 0;
        if (current > 0) return ok(`Deployment ${project} is already running (${current} replicas)`);
        // Restore the count the stop remembered; a deployment that was never stopped scales to 1.
        const remembered = Number(deployment.metadata?.annotations?.[LAST_REPLICAS_ANNOTATION] ?? '');
        const target = Number.isInteger(remembered) && remembered > 0 ? remembered : 1;
        const { status } = await request(config, deploymentPath(config, project), {
          method: 'PATCH',
          contentType: 'application/merge-patch+json',
          body: { spec: { replicas: target } },
        });
        if (status >= 400) return fail('START_FAILED', new Error(`Scaling Deployment ${project} to ${target}: HTTP ${status}`));
        return ok(`Deployment ${project} scaled to ${target} replicas`);
      } catch (err) {
        return fail('START_FAILED', err);
      }
    },

    async stopApplication(ctx, project) {
      if (!options.enabled) return notEnabled();
      if (options.simulationMode) return ok(`Simulated stop of ${project}`);
      const config = await kube(ctx);
      if (!config) return fail('KUBECONFIG_MISSING', 'Server has no Kubernetes credentials stored');
      try {
        const deployment = await readDeployment(config, project);
        if (!deployment) return fail('DEPLOYMENT_NOT_FOUND', `Deployment ${project} was not found in namespace ${config.namespace}`);
        const current = deployment.spec?.replicas ?? 0;
        if (current === 0) return ok(`Deployment ${project} is already stopped`);
        const { status } = await request(config, deploymentPath(config, project), {
          method: 'PATCH',
          contentType: 'application/merge-patch+json',
          body: {
            metadata: { annotations: { [LAST_REPLICAS_ANNOTATION]: String(current) } },
            spec: { replicas: 0 },
          },
        });
        if (status >= 400) return fail('STOP_FAILED', new Error(`Scaling Deployment ${project} to 0: HTTP ${status}`));
        return ok(`Deployment ${project} scaled to 0 replicas (last count ${current} remembered)`);
      } catch (err) {
        return fail('STOP_FAILED', err);
      }
    },

    /**
     * Rolling restart: patch the pod template so the Deployment rolls new pods out — the
     * mechanism behind `kubectl rollout restart`. Pods are not killed by hand.
     */
    async restartApplication(ctx, project) {
      if (!options.enabled) return notEnabled();
      if (options.simulationMode) return ok(`Simulated restart of ${project}`);
      const config = await kube(ctx);
      if (!config) return fail('KUBECONFIG_MISSING', 'Server has no Kubernetes credentials stored');
      try {
        const deployment = await readDeployment(config, project);
        if (!deployment) return fail('DEPLOYMENT_NOT_FOUND', `Deployment ${project} was not found in namespace ${config.namespace}`);
        const { status } = await request(config, deploymentPath(config, project), {
          method: 'PATCH',
          contentType: 'application/merge-patch+json',
          body: { spec: { template: { metadata: { annotations: { [RESTART_ANNOTATION]: new Date().toISOString() } } } } },
        });
        if (status >= 400) return fail('RESTART_FAILED', new Error(`Rolling restart of ${project}: HTTP ${status}`));
        return ok(`Rolling restart of Deployment ${project} requested`);
      } catch (err) {
        return fail('RESTART_FAILED', err);
      }
    },

    async applicationStatus(ctx, project): Promise<ApplicationStatusResult> {
      if (!options.enabled) return { ...notEnabled(), running: false, health: 'unknown' };
      if (options.simulationMode) {
        return { ok: true, code: 'OK', message: `Simulated status of ${project}`, running: true, health: 'healthy' };
      }
      const config = await kube(ctx);
      if (!config) {
        return { ok: false, code: 'KUBECONFIG_MISSING', message: 'Server has no Kubernetes credentials stored', running: false, health: 'unknown' };
      }
      try {
        return await statusOf(config, project);
      } catch (err) {
        return { ok: false, code: 'STATUS_FAILED', message: (err as Error).message, running: false, health: 'unknown' };
      }
    },

    async applicationLogs(ctx, project, tail): Promise<LogsResult> {
      if (!options.enabled) return { ...notEnabled(), logs: '' };
      if (options.simulationMode) return { ok: true, code: 'OK', message: 'Simulated logs', logs: '[simulated]' };
      const config = await kube(ctx);
      if (!config) return { ok: false, code: 'KUBECONFIG_MISSING', message: 'Server has no Kubernetes credentials stored', logs: '' };
      try {
        const pods = await listPods(config, project);
        if (pods.length === 0) {
          return { ok: false, code: 'NO_PODS', message: `Deployment ${project} has no pods to read logs from`, logs: '' };
        }
        const newest = [...pods].sort((a, b) =>
          String(b.metadata?.creationTimestamp ?? '').localeCompare(String(a.metadata?.creationTimestamp ?? ''))
        )[0] as KubePod;
        const podName = String(newest.metadata?.name ?? '');
        const containers = (newest.spec?.containers ?? []).map((container) => String(container.name ?? ''));
        const container = containers.includes('app') ? 'app' : containers[0];
        if (!container) {
          return { ok: false, code: 'NO_CONTAINERS', message: `Pod ${podName} declares no containers`, logs: '' };
        }
        const requested = Number.isFinite(tail) && (tail as number) > 0 ? Math.min(Math.floor(tail as number), 2000) : 200;
        const path =
          `/api/v1/namespaces/${encodeURIComponent(config.namespace)}/pods/${encodeURIComponent(podName)}/log` +
          `?container=${encodeURIComponent(container)}&tailLines=${requested}`;
        const response = await fetch(`${config.apiServer}${path}`, {
          headers: { authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(30_000),
        });
        const text = await response.text();
        if (!response.ok) {
          return { ok: false, code: 'LOGS_FAILED', message: `Reading logs for pod ${podName}: HTTP ${response.status}`, logs: '' };
        }
        return { ok: true, code: 'OK', message: `Logs from ${podName} (container ${container})`, logs: text };
      } catch (err) {
        return { ok: false, code: 'LOGS_FAILED', message: (err as Error).message, logs: '' };
      }
    },

    async runHealthcheck(ctx, project): Promise<ApplicationStatusResult> {
      if (!options.enabled) return { ...notEnabled(), running: false, health: 'unknown' };
      if (options.simulationMode) {
        return { ok: true, code: 'OK', message: 'Simulated healthcheck', running: true, health: 'healthy' };
      }
      const config = await kube(ctx);
      if (!config) {
        return { ok: false, code: 'KUBECONFIG_MISSING', message: 'Server has no Kubernetes credentials stored', running: false, health: 'unknown' };
      }
      try {
        return await statusOf(config, project);
      } catch (err) {
        return { ok: false, code: 'HEALTHCHECK_FAILED', message: (err as Error).message, running: false, health: 'unknown' };
      }
    },

    /**
     * Refused on purpose. The platform's backup contract is an archive the engine can address and
     * restore (storage path, size, checksum); Kubernetes backups are cluster-side and asynchronous
     * (Velero), so the engine could neither verify nor restore one. A structured refusal keeps the
     * deployment log honest instead of recording an empty success.
     */
    async runBackup(): Promise<BackupResult> {
      return {
        ok: false,
        code: 'K8S_BACKUP_REQUIRES_VELERO',
        message:
          'Kubernetes backups run cluster-side (Velero) and are asynchronous; the platform backup contract requires a retrievable archive it can verify and restore, so this is refused rather than recorded as an empty success',
        archivePath: null,
        sizeBytes: null,
        checksum: null,
      };
    },

    async restoreBackup(): Promise<DeploymentOperationResult> {
      return {
        ok: false,
        code: 'K8S_RESTORE_REQUIRES_VELERO',
        message:
          'Restoring a Kubernetes backup is a cluster-side Velero restore, not an archive the platform holds; refusing instead of pretending to restore',
      };
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
