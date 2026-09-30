import { randomUUID } from 'node:crypto';
import net from 'node:net';
import type { Queryable } from '../../db/types';
import type { DeploymentRow } from '../../db/deployments';
import {
  appendDeploymentEvent,
  completeDeployment,
  createDeploymentSteps,
  failDeployment,
  finishStep,
  startStep,
} from '../../db/deployments';
import {
  appendProvisioningLog,
  findCustomerServerById,
  findProvisioningJobByDeployment,
  updateCustomerServerProvisioning,
  updateProvisioningJob,
  type CustomerServerDetailRow,
  type ProvisioningJobRow,
} from '../../db/server-provisioning';
import { findProviderById, findOsImageById } from '../../db/infrastructure-providers';
import { getCredential, storeCredential } from '../../db/servers';
import { getKeyRing } from '../../lib/keyring';
import { generateSecret } from '../../lib/crypto';
import { recordAuditBestEffort } from '../../lib/audit';
import { notifyServerReady } from '../../services/notification-service';
import { createInfrastructureProviderAdapter } from '../providers/registry';
import { buildServerCloudInitWithControlPanel } from '../../control-panels/registry';
import {
  ProviderError,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
} from '../providers/types';

const PROVISION_STEPS = [
  'Validate paid order and server configuration',
  'Validate provider credentials and image',
  'Allocate provider server idempotently',
  'Deploy operating system image',
  'Wait for powered-on server and network',
  'Verify SSH, operating system, hostname, security and monitoring',
  'Activate server and notify customer',
];

const REINSTALL_STEPS = [
  'Validate server ownership and target image',
  'Validate provider credentials and image',
  'Start destructive operating-system reinstall',
  'Wait for powered-on server and network',
  'Verify SSH, operating system, hostname, security and monitoring',
  'Save new operating system and notify customer',
];

export interface ServerProvisionerOptions {
  adapterOverride?: InfrastructureProviderAdapter;
  source?: NodeJS.ProcessEnv;
  pollIntervalMs?: number;
  healthTimeoutMs?: number;
  requireAgentHealth?: boolean;
  tcpCheck?: (host: string, port: number) => Promise<boolean>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildCloudInit(input: {
  hostname: string;
  sshKeys: string[];
  agentId: string;
  agentSecret: string;
  controlUrl: string;
  installerUrl: string;
}): string {
  const keys = input.sshKeys.map((key) => `      - ${JSON.stringify(key)}`).join('\n');
  const install = [
    `curl -fsSL ${shellQuote(input.installerUrl)} -o /tmp/cloudhost247-agent-install`,
    'chmod 0700 /tmp/cloudhost247-agent-install',
    `CH247_AGENT_ID=${shellQuote(input.agentId)} CH247_AGENT_SECRET=${shellQuote(input.agentSecret)} CH247_CONTROL_URL=${shellQuote(input.controlUrl)} /tmp/cloudhost247-agent-install`,
    'install -d -m 700 /var/lib/cloudhost247 && install -m 600 /dev/null /var/lib/cloudhost247/security-configured',
  ].join(' && ');
  return `#cloud-config\nhostname: ${input.hostname}\nmanage_etc_hosts: true\nssh_pwauth: false\ndisable_root: false\nusers:\n  - default\n  - name: root\n    ssh_authorized_keys:\n${keys}\npackage_update: true\npackages:\n  - curl\n  - ca-certificates\nruncmd:\n  - [ sh, -lc, ${JSON.stringify(install)} ]\n`;
}

async function checkTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host,port,timeout: 3_000 });
    const done = (value: boolean) => { socket.destroy(); resolve(value); };
    socket.once('connect',() => done(true));
    socket.once('timeout',() => done(false));
    socket.once('error',() => done(false));
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve,ms));
}

async function stage(
  db: Queryable,
  job: ProvisioningJobRow,
  deploymentId: string,
  status: string,
  message: string
): Promise<void> {
  await updateProvisioningJob(db,job.id,{ status });
  await updateCustomerServerProvisioning(db,job.server_id,{
    status: status === 'HEALTH_CHECK' ? 'health_check'
      : status === 'INSTALLING_OS' ? 'installing'
        : status === 'CONFIGURING' || status === 'NETWORK_CONFIGURING' || status === 'SECURITY_CONFIGURING' ? 'configuring'
          : status === 'READY' ? 'active' : 'provisioning',
    provisioningStatus: status,
  });
  await appendProvisioningLog(db,job.id,{ stage: status,message });
  await appendDeploymentEvent(db,deploymentId,'info',message);
}

async function getSshKeys(db: Queryable, server: CustomerServerDetailRow): Promise<string[]> {
  const raw = server.metadata.sshKeyIds;
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  if (ids.length === 0) throw new ProviderError('INVALID_CONFIGURATION','Server has no SSH key selection',false);
  const { rows } = await db.query<{ public_key: string }>(
    `SELECT public_key FROM customer_ssh_keys WHERE user_id=$1 AND id=ANY($2::uuid[])`,
    [server.customer_id,ids]
  );
  if (rows.length !== ids.length) throw new ProviderError('INVALID_CONFIGURATION','A selected SSH key is no longer available',false);
  return rows.map((row) => row.public_key);
}

async function ensureAgentIdentity(
  db: Queryable,
  server: CustomerServerDetailRow,
  options: ServerProvisionerOptions
): Promise<{ id: string; secret: string; userData: string }> {
  const source = options.source ?? process.env;
  const controlUrl = source.APP_URL;
  const installerUrl = source.SERVER_AGENT_INSTALL_URL;
  if (!controlUrl || !installerUrl) {
    throw new ProviderError(
      'CONFIGURATION_REQUIRED',
      'APP_URL and SERVER_AGENT_INSTALL_URL are required for monitored server provisioning',
      false
    );
  }
  const id = server.agent_id ?? `agent-${generateSecret(12).toLowerCase()}`;
  let secret = server.agent_id ? await getCredential(db,getKeyRing(),server.id,'agent_secret') : null;
  if (!secret) {
    secret = generateSecret(32);
    await storeCredential(db,getKeyRing(),server.id,'agent_secret',secret);
  }
  if (!server.agent_id) await db.query(`UPDATE servers SET agent_id=$2,updated_at=now() WHERE id=$1`,[server.id,id]);
  const sshKeys = await getSshKeys(db,server);
  
  let controlPanelSlug: string | null = null;
  if (server.control_panel_id) {
    const cp = await db.query<{ slug: string }>(`SELECT slug FROM control_panels WHERE id=$1`, [server.control_panel_id]);
    controlPanelSlug = cp.rows[0]?.slug ?? null;
  }

  return {
    id,
    secret,
    userData: buildServerCloudInitWithControlPanel({
      hostname: server.hostname,
      sshKeys,
      agentId: id,
      agentSecret: secret,
      controlUrl,
      installerUrl,
      controlPanelSlug,
      architecture: server.architecture as 'x86_64' | 'arm64',
    }),
  };
}

async function waitForHealth(
  db: Queryable,
  server: CustomerServerDetailRow,
  adapter: InfrastructureProviderAdapter,
  image: NonNullable<Awaited<ReturnType<typeof findOsImageById>>>,
  options: ServerProvisionerOptions,
  evidenceAfterMs: number
): Promise<{ ipAddress: string }> {
  const timeoutMs = options.healthTimeoutMs ?? Number((options.source ?? process.env).PROVISIONING_HEALTH_TIMEOUT_MS ?? 600_000);
  const pollMs = options.pollIntervalMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let last = 'Provider server has not reached the expected health state';
  while (Date.now() <= deadline) {
    const providerHealth = await adapter.healthCheck(server.provider_server_id as string,image);
    if (!providerHealth.exists) throw new ProviderError('RESOURCE_NOT_FOUND','Provider server disappeared during health check',false);
    if (!providerHealth.poweredOn) { last = `Provider status is ${providerHealth.providerStatus}`; await sleep(pollMs); continue; }
    if (!providerHealth.ipAddress) { last = 'Provider has not assigned an IP address'; await sleep(pollMs); continue; }
    if (!providerHealth.imageMatches) throw new ProviderError('IMAGE_UNAVAILABLE','Provider reports an unexpected operating-system image',false);
    const ssh = await (options.tcpCheck ?? checkTcp)(providerHealth.ipAddress,22);
    if (!ssh) { last = 'SSH is not reachable yet'; await sleep(pollMs); continue; }

    if (options.requireAgentHealth !== false) {
      const fresh = await findCustomerServerById(db,server.id);
      const report = fresh?.metadata.provisioningHealth;
      const reportData = report && typeof report === 'object' ? report as Record<string,unknown> : {};
      const reportTime = typeof reportData.reportedAt === 'string' ? new Date(reportData.reportedAt).getTime() : 0;
      const seen = fresh?.agent_last_seen_at && Date.now() - new Date(fresh.agent_last_seen_at).getTime() < 5 * 60_000 && reportTime >= evidenceAfterMs;
      const expected = await db.query<{ slug: string; os_release_ids: string[]; version: string }>(
        `SELECT os.slug,os.os_release_ids,v.version FROM operating_system_versions v
         JOIN operating_systems os ON os.id=v.operating_system_id WHERE v.id=$1`,
        [image.operating_system_version_id]
      );
      const expectedOs = expected.rows[0];
      const expectedVersion = expectedOs?.version;
      const acceptedOsIds = expectedOs?.os_release_ids.length ? expectedOs.os_release_ids : expectedOs ? [expectedOs.slug] : [];
      const reportedVersion = String(reportData.osVersion ?? '');
      const versionMatches = expectedVersion === 'rolling' ? reportedVersion.length > 0 : reportedVersion.startsWith(expectedVersion ?? '__missing__');
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
  throw new ProviderError('NETWORK_TEMPORARY_FAILURE',last,true);
}

async function fail(
  db: Queryable,
  deployment: DeploymentRow,
  job: ProvisioningJobRow,
  error: unknown,
  activeStepId?: string
): Promise<'failed'> {
  const classified = error instanceof ProviderError
    ? error
    : new ProviderError('INVALID_CONFIGURATION',(error as Error).message || 'Provisioning failed',false);
  if (activeStepId) await finishStep(db,activeStepId,'failed',undefined,`${classified.code}: ${classified.message}`).catch(() => undefined);
  const updatedDeployment = await failDeployment(db,deployment,{
    errorCode: classified.code,errorMessage: classified.message,retryable: classified.retryable,
  });
  const willRetry = updatedDeployment?.status === 'queued';
  await updateProvisioningJob(db,job.id,{
    status: willRetry ? 'QUEUED' : 'FAILED',
    attempts: deployment.attempts,
    errorCode: classified.code,errorMessage: classified.message,retryable: classified.retryable,
    failedAt: willRetry ? null : new Date().toISOString(),
    providerResponse: classified.providerResponse && typeof classified.providerResponse === 'object'
      ? classified.providerResponse as Record<string,unknown> : null,
  });
  await appendProvisioningLog(db,job.id,{
    stage: 'FAILED',level: 'error',message: `${classified.code}: ${classified.message}`,
    metadata: { retryable: classified.retryable,willRetry },
  });
  await appendDeploymentEvent(db,deployment.id,'error',`${classified.code}: ${classified.message}`);
  if (!willRetry) {
    await updateCustomerServerProvisioning(db,job.server_id,{ status: 'error',provisioningStatus: 'FAILED' });
    await recordAuditBestEffort(db,{ action: job.operation === 'REINSTALL' ? 'SERVER_REINSTALL_FAILED' : 'SERVER_PROVISIONING_FAILED',resourceType: 'server',resourceId: job.server_id,metadata: { jobId: job.id,errorCode: classified.code } });
  }
  return 'failed';
}

async function executeLifecycleAction(
  db: Queryable,
  deployment: DeploymentRow,
  job: ProvisioningJobRow,
  adapter: InfrastructureProviderAdapter,
  server: CustomerServerDetailRow
): Promise<'succeeded' | 'failed'> {
  if (!server.provider_server_id) return fail(db,deployment,job,new ProviderError('INVALID_CONFIGURATION','Server has no provider resource id',false));
  const steps = await createDeploymentSteps(db,deployment.id,[`${job.operation} server at provider`]);
  const step = steps[0];
  if (!step) throw new Error('Lifecycle step row missing');
  await startStep(db,step.id);
  try {
    const payload = deployment.payload && typeof deployment.payload === 'object' ? deployment.payload as Record<string, unknown> : {};
    if (job.operation === 'START') await adapter.startServer(server.provider_server_id);
    else if (job.operation === 'STOP' || job.operation === 'SHUTDOWN') await adapter.shutdownServer(server.provider_server_id);
    else if (job.operation === 'REBOOT') await adapter.rebootServer(server.provider_server_id);
    else if (job.operation === 'DELETE') await adapter.deleteServer(server.provider_server_id);
    else if (job.operation === 'RESIZE') {
      const planMetadata = payload.planMetadata && typeof payload.planMetadata === 'object'
        ? payload.planMetadata as Record<string, unknown>
        : (server.metadata.providerPlan && typeof server.metadata.providerPlan === 'object' ? server.metadata.providerPlan as Record<string, unknown> : {});
      await adapter.resizeServer(server.provider_server_id, planMetadata);
    } else if (job.operation === 'SNAPSHOT_CREATE') {
      const desc = typeof payload.description === 'string' ? payload.description : `Snapshot-${new Date().toISOString().slice(0, 10)}`;
      await adapter.createSnapshot(server.provider_server_id, desc);
    } else if (job.operation === 'SNAPSHOT_DELETE') {
      const snapshotId = typeof payload.snapshotId === 'string' ? payload.snapshotId : '';
      if (!snapshotId) throw new ProviderError('INVALID_CONFIGURATION', 'Snapshot ID is required for deletion', false);
      await adapter.deleteSnapshot(server.provider_server_id, snapshotId);
    } else if (job.operation === 'SNAPSHOT_RESTORE') {
      const snapshotId = typeof payload.snapshotId === 'string' ? payload.snapshotId : '';
      if (!snapshotId) throw new ProviderError('INVALID_CONFIGURATION', 'Snapshot ID is required for restore', false);
      await adapter.restoreSnapshot(server.provider_server_id, snapshotId);
    } else throw new ProviderError('UNSUPPORTED_OPERATION',`${job.operation} is not supported by this adapter`,false);

    await finishStep(db,step.id,'succeeded');
    await completeDeployment(db,deployment.id);
    const status = job.operation === 'DELETE' ? 'retired' : job.operation === 'START' || job.operation === 'REBOOT' || job.operation === 'RESIZE' ? 'active' : 'stopped';
    await updateCustomerServerProvisioning(db,server.id,{ status,provisioningStatus: 'READY' });
    await updateProvisioningJob(db,job.id,{ status: 'READY',attempts: deployment.attempts,completedAt: new Date().toISOString(),errorCode: null,errorMessage: null });
    await recordAuditBestEffort(db,{ action: `SERVER_${job.operation}`,resourceType: 'server',resourceId: server.id,actorId: deployment.requested_by });
    return 'succeeded';
  } catch (error) {
    return fail(db,deployment,job,error,step.id);
  }
}

/** Executes one claimed infrastructure deployment. Never simulates a provider response. */
export async function executeServerProvisioning(
  db: Queryable,
  deployment: DeploymentRow,
  options: ServerProvisionerOptions = {}
): Promise<{ outcome: 'succeeded' | 'failed' }> {
  const job = await findProvisioningJobByDeployment(db,deployment.id);
  if (!job) throw new Error(`No provisioning job is linked to deployment ${deployment.id}`);
  // A crash may happen after terminal infrastructure state is persisted but before the queue row
  // is completed. Re-delivery closes the broker row without repeating provider actions or notices.
  if(job.status==='READY'){
    await completeDeployment(db,deployment.id);
    return{outcome:'succeeded'};
  }
  let activeStepId: string | undefined;
  try {
    await updateProvisioningJob(db,job.id,{ attempts: deployment.attempts,startedAt: job.started_at ?? new Date().toISOString() });
    const server = await findCustomerServerById(db,job.server_id);
    if (!server || !server.customer_id) throw new ProviderError('INVALID_CONFIGURATION','Customer server record is missing',false);
    const provider = await findProviderById(db,job.provider_id);
    if (!provider || provider.status !== 'ACTIVE') throw new ProviderError('PROVIDER_NOT_CONFIGURED','Infrastructure provider is not active',false);
    const adapter = options.adapterOverride ?? createInfrastructureProviderAdapter(provider,options.source);

    if (!['PROVISION','REINSTALL'].includes(job.operation)) {
      return { outcome: await executeLifecycleAction(db,deployment,job,adapter,server) };
    }
    const image = job.os_image_id ? await findOsImageById(db,job.os_image_id) : null;
    if (!image || image.status !== 'ACTIVE' || !image.verified_at) throw new ProviderError('IMAGE_UNAVAILABLE','Provider OS image is not verified and active',false);
    if (image.provider_id !== provider.id || image.architecture !== server.architecture) {
      throw new ProviderError('INVALID_CONFIGURATION','Provider image does not match the selected provider/architecture',false);
    }
    const steps = await createDeploymentSteps(db,deployment.id,job.operation === 'REINSTALL' ? REINSTALL_STEPS : PROVISION_STEPS);
    const run = async (index: number,fn: () => Promise<void>) => {
      const step = steps[index];
      if (!step) throw new Error(`Provisioning step ${index} is missing`);
      activeStepId = step.id;
      await startStep(db,step.id);
      await fn();
      await finishStep(db,step.id,'succeeded');
      await appendDeploymentEvent(db,deployment.id,'info',`✓ ${step.name}`);
    };

    let agentUserData = '';
    await run(0,async () => {
      if (job.operation === 'PROVISION') {
        if (!job.order_id) throw new ProviderError('INVALID_CONFIGURATION','Provisioning job has no order',false);
        const order = await db.query<{ payment_status: string; user_id: string }>(`SELECT payment_status,user_id FROM orders WHERE id=$1`,[job.order_id]);
        if (order.rows[0]?.payment_status !== 'paid' || order.rows[0]?.user_id !== server.customer_id) {
          throw new ProviderError('INVALID_CONFIGURATION','Order is unpaid or does not belong to the server owner',false);
        }
      }
      if (options.requireAgentHealth !== false) {
        const identity = await ensureAgentIdentity(db,server,options);
        agentUserData = identity.userData;
      }
    });

    await run(1,async () => {
      await adapter.validateConfiguration();
      const availableImage = await adapter.getImage(image);
      if (!availableImage?.available) throw new ProviderError('IMAGE_UNAVAILABLE','Provider image does not exist or is unavailable',false);
      if (availableImage.architecture && availableImage.architecture !== server.architecture) {
        throw new ProviderError('INVALID_CONFIGURATION','Provider image architecture does not match the server architecture',false);
      }
    });

    const location = await db.query<{ region_code: string; datacenter_code: string | null }>(
      `SELECT r.code region_code,d.code datacenter_code FROM infrastructure_regions r
       LEFT JOIN infrastructure_datacenters d ON d.id=$2 WHERE r.id=$1`,[server.region_id,server.datacenter_id]
    );
    const place = location.rows[0];
    if (!place) throw new ProviderError('INVALID_CONFIGURATION','Server region no longer exists',false);
    const sshKeys = await getSshKeys(db,server);
    const createInput: CreateProviderServerInput = {
      idempotencyKey: job.idempotency_key,name: server.name,hostname: server.hostname,
      architecture: server.architecture as 'x86_64' | 'arm64',image,
      regionCode: place.region_code,datacenterCode: place.datacenter_code,
      planMetadata: server.metadata.providerPlan && typeof server.metadata.providerPlan === 'object'
        ? server.metadata.providerPlan as Record<string,unknown> : {},
      sshPublicKeys: sshKeys,userData: agentUserData,
    };

    let healthEvidenceAfterMs = Date.now();
    if (job.operation === 'PROVISION') {
      await run(2,async () => {
        await stage(db,job,deployment.id,'ALLOCATING','Allocating server at provider');
        let remote = job.provider_server_id || server.provider_server_id
          ? await adapter.getServerStatus((job.provider_server_id ?? server.provider_server_id) as string)
          : await adapter.findServerByIdempotencyKey(job.idempotency_key);
        if (!remote) remote = await adapter.createServer(createInput);
        // Persist immediately. A crash after this write reuses the resource id; a crash before it
        // is recovered by provider-side idempotency lookup on the next attempt.
        await updateProvisioningJob(db,job.id,{ status: 'CREATING',providerServerId: remote.id,providerResponse: { ...remote } });
        await updateCustomerServerProvisioning(db,server.id,{ status: 'provisioning',provisioningStatus: 'CREATING',providerServerId: remote.id,ipAddress: remote.ipAddress });
        server.provider_server_id = remote.id;
        healthEvidenceAfterMs = Date.now();
      });
      await run(3,async () => stage(db,job,deployment.id,'INSTALLING_OS','Provider accepted the selected operating-system image'));
    } else {
      await run(2,async () => {
        if (!server.provider_server_id) throw new ProviderError('INVALID_CONFIGURATION','Cannot reinstall a server without a provider resource id',false);
        await stage(db,job,deployment.id,'INSTALLING_OS','Starting destructive operating-system reinstall');
        await adapter.reinstallServer({ providerServerId: server.provider_server_id,idempotencyKey:job.idempotency_key,isRetry:deployment.attempts>1,image,architecture: createInput.architecture,hostname: server.hostname,sshPublicKeys: sshKeys,userData: createInput.userData });
        healthEvidenceAfterMs = Date.now();
      });
    }

    const waitStepIndex = job.operation === 'PROVISION' ? 4 : 3;
    let healthIp = '';
    await run(waitStepIndex,async () => {
      await stage(db,job,deployment.id,'NETWORK_CONFIGURING','Waiting for provider power and network state');
      // First health pass also verifies SSH and the authenticated agent where required.
      const result = await waitForHealth(db,server,adapter,image,options,healthEvidenceAfterMs);
      healthIp = result.ipAddress;
    });
    await run(waitStepIndex + 1,async () => {
      await stage(db,job,deployment.id,'HEALTH_CHECK','All provider, network, SSH, OS, hostname, security and monitoring checks passed');
    });
    await run(waitStepIndex + 2,async () => {
      await updateCustomerServerProvisioning(db,server.id,{
        status: 'active',provisioningStatus: 'READY',ipAddress: healthIp,
        operatingSystemVersionId: image.operating_system_version_id,osImageId: image.id,architecture: image.architecture,
      });
      if (job.order_id && job.operation === 'PROVISION') await db.query(`UPDATE orders SET status='completed',updated_at=now() WHERE id=$1 AND payment_status='paid'`,[job.order_id]);
      const ready = await findCustomerServerById(db,server.id);
      if (ready) await notifyServerReady(db,ready,options.source,job.operation==='REINSTALL'?'SERVER_REINSTALLED':'SERVER_READY');
      await updateProvisioningJob(db,job.id,{ status: 'READY',attempts: deployment.attempts,completedAt: new Date().toISOString(),errorCode: null,errorMessage: null,retryable: null });
      await recordAuditBestEffort(db,{ actorId: deployment.requested_by,action: job.operation === 'REINSTALL' ? 'SERVER_REINSTALL_COMPLETED' : 'SERVER_READY',resourceType: 'server',resourceId: server.id,metadata: { jobId: job.id,providerId: provider.id,osImageId: image.id } });
    });
    await completeDeployment(db,deployment.id);
    return { outcome: 'succeeded' };
  } catch (error) {
    await fail(db,deployment,job,error,activeStepId);
    return { outcome: 'failed' };
  }
}
