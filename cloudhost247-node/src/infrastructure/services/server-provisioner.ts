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
import { findProviderById, type ServerOsImageRow } from '../../db/infrastructure-providers';
import { recordAuditBestEffort } from '../../lib/audit';
import { notifyServerReady } from '../../services/notification-service';
import { createInfrastructureProviderAdapter } from '../providers/registry';
import {
  ProviderError,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
} from '../providers/types';
// Provisioning is composed from focused services (spec §8): image resolution, server
// configuration inputs, and health verification each live in their own module.
import { resolveVerifiedProviderImage } from './image-resolver';
import { ensureAgentIdentity, getServerSshKeys } from './server-configurator';
import { waitForServerHealth, type HealthCheckOptions } from './health-checker';

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

export interface ServerProvisionerOptions extends HealthCheckOptions {
  adapterOverride?: InfrastructureProviderAdapter;
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
    const image: ServerOsImageRow = await resolveVerifiedProviderImage(db,{
      osImageId: job.os_image_id,provider,architecture: server.architecture,
    });
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
    const sshKeys = await getServerSshKeys(db,server);
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
      const result = await waitForServerHealth(db,server,adapter,image,options,healthEvidenceAfterMs);
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
