import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { setOrderStatus } from '../../db/orders';
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
  applyCustomerServerResize,
  findCustomerServerById,
  findProvisioningJobByDeployment,
  updateCustomerServerProvisioning,
  updateProvisioningJob,
  type CustomerServerDetailRow,
  type ProvisioningJobRow,
} from '../../db/server-provisioning';
import { findProviderById, type ServerOsImageRow } from '../../db/infrastructure-providers';
import { resolveAvailableConfiguration } from '../../db/operating-systems';
import { recordAuditBestEffort } from '../../lib/audit';
import { notifyServerReady, notifyServerTerminated } from '../../services/notification-service';
import { createInfrastructureProviderAdapter } from '../providers/registry';
import {
  ProviderError,
  type CreateProviderServerInput,
  type InfrastructureProviderAdapter,
} from '../providers/types';
import { sanitizeProviderRecord } from '../providers/sanitize-provider-response';
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
    providerResponse: sanitizeProviderRecord(classified.providerResponse),
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
    let providerResponse: Record<string,unknown>|null=null;
    if (job.operation === 'START') await adapter.startServer(server.provider_server_id);
    else if (job.operation === 'STOP' || job.operation === 'SHUTDOWN') await adapter.shutdownServer(server.provider_server_id);
    else if (job.operation === 'REBOOT') await adapter.rebootServer(server.provider_server_id);
    else if (job.operation === 'DELETE') await adapter.deleteServer(server.provider_server_id);
    else if (job.operation === 'RESIZE') {
      const targetPlanId = typeof payload.targetPlanId === 'string' ? payload.targetPlanId : null;
      if (!targetPlanId || !server.provider_id || !server.region_id || !server.operating_system_version_id || !server.architecture) {
        throw new ProviderError('INVALID_CONFIGURATION', 'Paid resize job has no complete target server configuration', false);
      }
      // Resolve immediately before the mutation. Payment proves the quote was accepted, not that a
      // later-disabled image/template is still eligible for a provider-side resource change.
      const configuration = await resolveAvailableConfiguration(db, {
        planId: targetPlanId,
        providerId: server.provider_id,
        regionId: server.region_id,
        datacenterId: server.datacenter_id,
        operatingSystemVersionId: server.operating_system_version_id,
        architecture: server.architecture,
        serverType: server.server_type,
      });
      if (!configuration) {
        throw new ProviderError('INVALID_CONFIGURATION', 'Target resize configuration is no longer active', false);
      }
      const targetMetadata = configuration.configuration_metadata ?? {};
      const capabilities = typeof targetMetadata.capabilities === 'object' && targetMetadata.capabilities !== null
        ? targetMetadata.capabilities as Record<string, unknown>
        : {};
      const integer = (key: string, minimum: number): number => {
        const value = targetMetadata[key];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
          throw new ProviderError('INVALID_CONFIGURATION', `Target resize configuration is incomplete (${key})`, false);
        }
        return value;
      };
      if (capabilities.resize !== true) {
        throw new ProviderError('INVALID_CONFIGURATION', 'Target resize configuration is not resize-capable', false);
      }
      const cpuCores = integer('cpuCores', 1);
      const memoryMb = integer('memoryMb', 256);
      const storageMb = integer('storageMb', 1024);
      const bandwidthGb = typeof targetMetadata.bandwidthGb === 'number' && Number.isInteger(targetMetadata.bandwidthGb)
        ? targetMetadata.bandwidthGb : null;
      const targetCapabilities = Object.fromEntries(
        Object.entries(capabilities).filter(([, value]) => typeof value === 'boolean'),
      ) as Record<string, boolean>;
      const grows = cpuCores >= server.cpu_cores && memoryMb >= server.memory_mb && storageMb >= server.storage_mb
        && (cpuCores > server.cpu_cores || memoryMb > server.memory_mb || storageMb > server.storage_mb);
      if (!grows) throw new ProviderError('INVALID_CONFIGURATION', 'Target resize configuration is not a non-destructive resource increase', false);

      const resized = await adapter.resizeServer(server.provider_server_id, targetMetadata);
      const subscriptionId = typeof payload.subscriptionId === 'string' ? payload.subscriptionId : null;
      await withTransaction(db, async (tx) => {
        await applyCustomerServerResize(tx, {
          serverId: server.id,
          customerId: server.customer_id,
          targetPlanId,
          targetConfigurationId: configuration.configuration_id,
          providerPlan: targetMetadata,
          cpuCores,
          memoryMb,
          storageMb,
          bandwidthGb,
          capabilities: targetCapabilities,
          subscriptionId,
        });
        // The paid upgrade order is completed only after local billing/server state matches the
        // provider mutation; a provider failure leaves it paid-but-pending for support/refund.
        if (job.order_id) await setOrderStatus(tx, job.order_id, 'completed');
      });
      providerResponse={id:resized.id,status:resized.status,ipAddress:resized.ipAddress};
    } else if (job.operation === 'SNAPSHOT_CREATE') {
      const desc = typeof payload.description === 'string' ? payload.description : `Snapshot-${new Date().toISOString().slice(0, 10)}`;
      providerResponse=await adapter.createSnapshot(server.provider_server_id, desc);
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
    const status = job.operation === 'DELETE' ? 'retired'
      : job.operation === 'START' || job.operation === 'REBOOT' ? 'active'
        : job.operation === 'STOP' || job.operation === 'SHUTDOWN' ? 'stopped'
          : server.status;
    await updateCustomerServerProvisioning(db,server.id,{ status,provisioningStatus: 'READY' });
    // A destroyed server is the one lifecycle action the customer must hear about even though
    // they asked for it: it confirms the resource is gone and that billing has stopped.
    if (job.operation === 'DELETE') {
      const terminated = await findCustomerServerById(db,server.id);
      if (terminated) await notifyServerTerminated(db,terminated);
    }
    await updateProvisioningJob(db,job.id,{
      status: 'READY',attempts: deployment.attempts,completedAt: new Date().toISOString(),
      errorCode: null,errorMessage: null,providerResponse: sanitizeProviderRecord(providerResponse),
    });
    await recordAuditBestEffort(db,{ action: `SERVER_${job.operation}`,resourceType: 'server',resourceId: server.id,actorId: deployment.requested_by });
    // Complete the broker row last. If the worker crashes after the durable job reaches READY,
    // redelivery takes the terminal fast path above instead of repeating the provider action.
    await completeDeployment(db,deployment.id);
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
    if (!server.plan_id || !server.region_id || !server.architecture) {
      throw new ProviderError('INVALID_CONFIGURATION','Server plan, region, or architecture is missing',false);
    }
    const payload = deployment.payload && typeof deployment.payload === 'object'
      ? deployment.payload as Record<string, unknown>
      : {};
    if (job.operation === 'REINSTALL') {
      if (typeof payload.targetOperatingSystemVersionId !== 'string') {
        throw new ProviderError('INVALID_CONFIGURATION','Reinstall target operating-system version is missing',false);
      }
      if (payload.targetArchitecture !== server.architecture) {
        throw new ProviderError('INVALID_CONFIGURATION','A reinstall cannot change the server architecture',false);
      }
    }
    const targetVersionId = job.operation === 'REINSTALL'
      ? payload.targetOperatingSystemVersionId as string
      : server.operating_system_version_id;
    const image: ServerOsImageRow = await resolveVerifiedProviderImage(db,{
      osImageId: job.os_image_id,
      provider,
      architecture: server.architecture,
      operatingSystemVersionId: targetVersionId,
      regionId: server.region_id,
      datacenterId: server.datacenter_id,
    });
    // Re-check the complete purchasable chain at execution time. A provider, product, region,
    // location, OS, image, or template may have been disabled between payment and worker claim.
    const availableConfiguration = await resolveAvailableConfiguration(db,{
      planId: server.plan_id,
      providerId: provider.id,
      regionId: server.region_id,
      datacenterId: server.datacenter_id,
      operatingSystemVersionId: image.operating_system_version_id,
      architecture: server.architecture,
      serverType: server.server_type,
    });
    if (!availableConfiguration) {
      throw new ProviderError('INVALID_CONFIGURATION','The paid server configuration is no longer deployable',false);
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
      await recordAuditBestEffort(db,{
        actorId:deployment.requested_by,
        action:job.operation==='REINSTALL'?'SERVER_REINSTALL_STARTED':'SERVER_PROVISIONING_STARTED',
        resourceType:'server',resourceId:server.id,
        metadata:{jobId:job.id,attempt:deployment.attempts,providerId:provider.id},
      });
    });

    await run(1,async () => {
      await adapter.validateConfiguration();
      const availableImage = await adapter.getImage(image);
      if (!availableImage?.available) throw new ProviderError('IMAGE_UNAVAILABLE','Provider image does not exist or is unavailable',false);
      if (availableImage.architecture && availableImage.architecture !== server.architecture) {
        throw new ProviderError('INVALID_CONFIGURATION','Provider image architecture does not match the server architecture',false);
      }
      await recordAuditBestEffort(db,{
        actorId:deployment.requested_by,action:'OS_IMAGE_SELECTED',resourceType:'server',resourceId:server.id,
        metadata:{jobId:job.id,providerId:provider.id,osImageId:image.id,architecture:image.architecture},
      });
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
        await updateProvisioningJob(db,job.id,{
          status: 'CREATING',providerServerId: remote.id,providerResponse: sanitizeProviderRecord(remote),
        });
        await updateCustomerServerProvisioning(db,server.id,{ status: 'provisioning',provisioningStatus: 'CREATING',providerServerId: remote.id,ipAddress: remote.ipAddress });
        server.provider_server_id = remote.id;
        healthEvidenceAfterMs = Date.now();
        await recordAuditBestEffort(db,{
          actorId:deployment.requested_by,action:'SERVER_CREATED_AT_PROVIDER',resourceType:'server',resourceId:server.id,
          metadata:{jobId:job.id,providerId:provider.id,providerServerId:remote.id},
        });
      });
      await run(3,async () => {
        await stage(db,job,deployment.id,'INSTALLING_OS','Provider accepted the selected operating-system image');
        await recordAuditBestEffort(db,{actorId:deployment.requested_by,action:'OS_INSTALL_STARTED',resourceType:'server',resourceId:server.id,metadata:{jobId:job.id,osImageId:image.id}});
        await stage(db,job,deployment.id,'CONFIGURING','Cloud-init configuration for hostname, SSH access and monitoring was attached to the provider build');
      });
    } else {
      await run(2,async () => {
        if (!server.provider_server_id) throw new ProviderError('INVALID_CONFIGURATION','Cannot reinstall a server without a provider resource id',false);
        await stage(db,job,deployment.id,'INSTALLING_OS','Starting destructive operating-system reinstall');
        await recordAuditBestEffort(db,{actorId:deployment.requested_by,action:'OS_INSTALL_STARTED',resourceType:'server',resourceId:server.id,metadata:{jobId:job.id,osImageId:image.id}});
        await adapter.reinstallServer({ providerServerId: server.provider_server_id,idempotencyKey:job.idempotency_key,isRetry:deployment.attempts>1,image,architecture: createInput.architecture,hostname: server.hostname,sshPublicKeys: sshKeys,userData: createInput.userData });
        await stage(db,job,deployment.id,'CONFIGURING','Cloud-init configuration for hostname, SSH access and monitoring was attached to the provider rebuild');
        healthEvidenceAfterMs = Date.now();
      });
    }

    const waitStepIndex = job.operation === 'PROVISION' ? 4 : 3;
    let healthIp = '';
    await run(waitStepIndex,async () => {
      await stage(db,job,deployment.id,'NETWORK_CONFIGURING','Waiting for provider power and network state');
      await recordAuditBestEffort(db,{actorId:deployment.requested_by,action:'SERVER_HEALTH_CHECK_STARTED',resourceType:'server',resourceId:server.id,metadata:{jobId:job.id}});
      // First health pass also verifies SSH and the authenticated agent where required.
      const result = await waitForServerHealth(db,server,adapter,image,options,healthEvidenceAfterMs);
      healthIp = result.ipAddress;
      await stage(db,job,deployment.id,'SECURITY_CONFIGURING','Authenticated agent confirmed hostname, SSH reachability, security baseline and monitoring');
      await recordAuditBestEffort(db,{actorId:deployment.requested_by,action:'OS_INSTALL_COMPLETED',resourceType:'server',resourceId:server.id,metadata:{jobId:job.id,osImageId:image.id}});
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
      if (ready) await notifyServerReady(db,ready,job.operation==='REINSTALL'?'SERVER_REINSTALLED':'SERVER_READY');
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
