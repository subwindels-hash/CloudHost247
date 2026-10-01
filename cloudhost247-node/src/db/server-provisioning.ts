import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { withTransaction } from './transaction';
import { ConflictError } from '../lib/errors';
import { enqueueDeployment, type DeploymentAction } from './deployments';

export interface ProvisioningJobRow {
  id: string;
  deployment_id: string;
  server_id: string;
  order_id: string | null;
  provider_id: string;
  os_image_id: string | null;
  operation:
    | 'PROVISION'
    | 'REINSTALL'
    | 'START'
    | 'STOP'
    | 'REBOOT'
    | 'SHUTDOWN'
    | 'RESCUE'
    | 'DELETE'
    | 'RESIZE'
    | 'SNAPSHOT_CREATE'
    | 'SNAPSHOT_RESTORE'
    | 'SNAPSHOT_DELETE';
  status: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean | null;
  provider_server_id: string | null;
  provider_response: Record<string, unknown> | null;
  logs: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface CustomerServerDetailRow {
  id: string;
  customer_id: string;
  order_id: string | null;
  plan_id: string | null;
  name: string;
  hostname: string;
  ip_address: string | null;
  server_type: string;
  architecture: string | null;
  status: string;
  provisioning_status: string | null;
  provider_id: string | null;
  provider_name: string | null;
  provider_server_id: string | null;
  agent_id: string | null;
  agent_version: string | null;
  agent_last_seen_at: string | null;
  region_id: string | null;
  region_name: string | null;
  datacenter_id: string | null;
  datacenter_name: string | null;
  operating_system_version_id: string | null;
  os_name: string | null;
  os_slug: string | null;
  os_logo_url: string | null;
  os_version: string | null;
  os_display_name: string | null;
  os_version_status: string | null;
  os_end_of_life_date: string | null;
  os_image_id: string | null;
  control_panel_id?: string | null;
  control_panel_name?: string | null;
  control_panel_slug?: string | null;
  control_panel_logo_url?: string | null;
  control_panel_category?: string | null;
  control_panel_installation_method?: string | null;
  control_panel_capabilities?: Record<string, boolean> | null;
  cpu_cores: number;
  memory_mb: number;
  storage_mb: number;
  bandwidth_gb: number | null;
  renewal_date: string | null;
  capabilities: Record<string, boolean>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const CUSTOMER_SERVER_SELECT = `
  SELECT s.*,
    p.name provider_name,
    r.name region_name,
    dc.name datacenter_name,
    os.name os_name, os.slug os_slug, os.logo_url os_logo_url,
    osv.version os_version, osv.display_name os_display_name, osv.status os_version_status,
    osv.end_of_life_date os_end_of_life_date,
    cp.name control_panel_name, cp.slug control_panel_slug, cp.logo_url control_panel_logo_url,
    cp.category control_panel_category, cp.installation_method control_panel_installation_method,
    cp.capabilities control_panel_capabilities
  FROM servers s
  LEFT JOIN infrastructure_providers p ON p.id=s.provider_id
  LEFT JOIN infrastructure_regions r ON r.id=s.region_id
  LEFT JOIN infrastructure_datacenters dc ON dc.id=s.datacenter_id
  LEFT JOIN operating_system_versions osv ON osv.id=s.operating_system_version_id
  LEFT JOIN operating_systems os ON os.id=osv.operating_system_id
  LEFT JOIN control_panels cp ON cp.id=s.control_panel_id`;

export async function createCustomerServer(
  db: Queryable,
  input: {
    customerId: string; name: string; hostname: string; serverType: 'VPS' | 'DEDICATED' | 'CLOUD';
    planId: string; providerId: string; regionId: string; datacenterId?: string | null;
    operatingSystemVersionId: string; osImageId: string; architecture: 'x86_64' | 'arm64';
    cpuCores: number; memoryMb: number; storageMb: number; bandwidthGb?: number | null;
    controlPanelId?: string | null; capabilities?: Record<string, boolean>; metadata?: Record<string, unknown>;
  }
): Promise<CustomerServerDetailRow> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO servers (
       id,name,hostname,server_type,status,customer_id,plan_id,provider_id,region_id,datacenter_id,
       operating_system_version_id,os_image_id,architecture,provisioning_status,cpu_cores,memory_mb,
       storage_mb,bandwidth_gb,control_panel_id,capabilities,metadata
     ) VALUES ($1,$2,$3,$4,'awaiting_payment',$5,$6,$7,$8,$9,$10,$11,$12,'AWAITING_PAYMENT',$13,$14,$15,$16,$17,$18,$19)`,
    [id,input.name,input.hostname,input.serverType,input.customerId,input.planId,input.providerId,input.regionId,input.datacenterId ?? null,input.operatingSystemVersionId,input.osImageId,input.architecture,input.cpuCores,input.memoryMb,input.storageMb,input.bandwidthGb ?? null,input.controlPanelId ?? null,JSON.stringify(input.capabilities ?? {}),JSON.stringify(input.metadata ?? {})]
  );
  const row = await findCustomerServerById(db, id);
  if (!row) throw new Error('createCustomerServer: insert returned no row');
  return row;
}

export async function attachOrderToCustomerServer(db: Queryable, serverId: string, orderId: string): Promise<void> {
  await db.query(`UPDATE servers SET order_id=$2,updated_at=now() WHERE id=$1`, [serverId,orderId]);
}

export async function listCustomerServers(db: Queryable, customerId: string): Promise<CustomerServerDetailRow[]> {
  const { rows } = await db.query<CustomerServerDetailRow>(
    `${CUSTOMER_SERVER_SELECT} WHERE s.customer_id=$1 ORDER BY s.created_at DESC`, [customerId]
  );
  return rows;
}

export async function findCustomerServerById(db: Queryable, id: string): Promise<CustomerServerDetailRow | null> {
  const { rows } = await db.query<CustomerServerDetailRow>(`${CUSTOMER_SERVER_SELECT} WHERE s.id=$1`, [id]);
  return rows[0] ?? null;
}

export async function findOwnedCustomerServer(db: Queryable, id: string, customerId: string): Promise<CustomerServerDetailRow | null> {
  const { rows } = await db.query<CustomerServerDetailRow>(
    `${CUSTOMER_SERVER_SELECT} WHERE s.id=$1 AND s.customer_id=$2`, [id,customerId]
  );
  return rows[0] ?? null;
}

export async function updateCustomerServerProvisioning(
  db: Queryable,
  serverId: string,
  patch: Partial<{
    status: string; provisioningStatus: string; providerServerId: string | null; ipAddress: string | null;
    operatingSystemVersionId: string; osImageId: string; architecture: string; hostname: string;
  }>
): Promise<void> {
  const current = await findCustomerServerById(db, serverId);
  if (!current) return;
  await db.query(
    `UPDATE servers SET status=$2,provisioning_status=$3,provider_server_id=$4,ip_address=$5,
       operating_system_version_id=$6,os_image_id=$7,architecture=$8,hostname=$9,updated_at=now()
     WHERE id=$1`,
    [serverId,patch.status ?? current.status,patch.provisioningStatus ?? current.provisioning_status,patch.providerServerId !== undefined ? patch.providerServerId : current.provider_server_id,patch.ipAddress !== undefined ? patch.ipAddress : current.ip_address,patch.operatingSystemVersionId ?? current.operating_system_version_id,patch.osImageId ?? current.os_image_id,patch.architecture ?? current.architecture,patch.hostname ?? current.hostname]
  );
}

/**
 * Applies a resize only after the provider action succeeded. The caller obtains all values from a
 * freshly re-resolved, active server template; browser-supplied sizing is never accepted here.
 * `subscriptionId` is optional for legacy servers that predate subscriptions, but when present is
 * ownership-scoped so a malformed deployment payload cannot move another customer's billing plan.
 */
export async function applyCustomerServerResize(
  db: Queryable,
  input: {
    serverId: string;
    customerId: string;
    targetPlanId: string;
    targetConfigurationId: string;
    providerPlan: Record<string, unknown>;
    cpuCores: number;
    memoryMb: number;
    storageMb: number;
    bandwidthGb: number | null;
    capabilities: Record<string, boolean>;
    subscriptionId?: string | null;
  },
): Promise<void> {
  const current = await findCustomerServerById(db, input.serverId);
  if (!current || current.customer_id !== input.customerId) {
    throw new Error('Resize target server is missing or does not belong to the paid order customer');
  }
  const metadata = {
    ...current.metadata,
    productConfigurationId: input.targetConfigurationId,
    providerPlan: input.providerPlan,
  };
  await db.query(
    `UPDATE servers
     SET plan_id=$2,cpu_cores=$3,memory_mb=$4,storage_mb=$5,bandwidth_gb=$6,
         capabilities=$7,metadata=$8,updated_at=now()
     WHERE id=$1 AND customer_id=$9`,
    [
      input.serverId,input.targetPlanId,input.cpuCores,input.memoryMb,input.storageMb,input.bandwidthGb,
      JSON.stringify(input.capabilities),JSON.stringify(metadata),input.customerId,
    ],
  );
  if (input.subscriptionId) {
    await db.query(
      `UPDATE subscriptions SET plan_id=$2,updated_at=now()
       WHERE id=$1 AND customer_id=$3 AND status IN ('active','past_due','grace_period')`,
      [input.subscriptionId,input.targetPlanId,input.customerId],
    );
  }
}

const ACTION_BY_OPERATION: Record<ProvisioningJobRow['operation'], DeploymentAction> = {
  PROVISION: 'server_provision',
  REINSTALL: 'server_reinstall',
  START: 'server_start',
  STOP: 'server_stop',
  REBOOT: 'server_reboot',
  SHUTDOWN: 'server_shutdown',
  RESCUE: 'server_rescue',
  DELETE: 'server_delete',
  RESIZE: 'server_resize',
  SNAPSHOT_CREATE: 'server_snapshot_create',
  SNAPSHOT_RESTORE: 'server_snapshot_restore',
  SNAPSHOT_DELETE: 'server_snapshot_delete',
};

export async function enqueueServerProvisioningJob(
  db: Queryable,
  input: {
    serverId: string; orderId?: string | null; providerId: string; osImageId?: string | null;
    operation: ProvisioningJobRow['operation']; requestedBy?: string | null; idempotencyKey: string;
    payload?: Record<string, unknown>; maxAttempts?: number;
  },
  options: { alreadyInTransaction?: boolean } = {}
): Promise<{ job: ProvisioningJobRow; created: boolean }> {
  const enqueue = async (tx: Queryable): Promise<{ job: ProvisioningJobRow; created: boolean }> => {
    // Serialize *all* infrastructure work for one server. This prevents contradictory operations
    // (for example, reinstall + delete) from being queued by concurrent browser requests. The
    // idempotency lookup is repeated after the row lock so simultaneous retries still receive the
    // first job rather than a conflict.
    await tx.query(`SELECT id FROM servers WHERE id=$1 FOR UPDATE`, [input.serverId]);
    const duplicate = await tx.query<ProvisioningJobRow>(
      `SELECT * FROM provisioning_jobs WHERE idempotency_key=$1`, [input.idempotencyKey]
    );
    if (duplicate.rows[0]) return { job: duplicate.rows[0], created: false };

    const active = await tx.query<Pick<ProvisioningJobRow, 'id' | 'operation' | 'status'>>(
      `SELECT id,operation,status FROM provisioning_jobs
       WHERE server_id=$1 AND status NOT IN('READY','FAILED','CANCELLED')
       ORDER BY created_at ASC LIMIT 1`, [input.serverId]
    );
    if (active.rows[0]) {
      throw new ConflictError(
        `Server operation ${active.rows[0].operation} is already ${active.rows[0].status.toLowerCase()}`
      );
    }

    const deploymentResult = await enqueueDeployment(tx, {
      serverId: input.serverId,
      orderId: input.orderId ?? null,
      action: ACTION_BY_OPERATION[input.operation],
      requestedBy: input.requestedBy ?? null,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      maxAttempts: input.maxAttempts ?? 3,
    });
    if (!deploymentResult.created) {
      const existing = await findProvisioningJobByDeployment(tx, deploymentResult.deployment.id);
      if (!existing) throw new Error('Provisioning deployment exists without a provisioning job');
      return { job: existing, created: false };
    }

    const { rows } = await tx.query<ProvisioningJobRow>(
      `INSERT INTO provisioning_jobs
         (id,deployment_id,server_id,order_id,provider_id,os_image_id,operation,status,max_attempts,idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'QUEUED',$8,$9) RETURNING *`,
      [
        randomUUID(), deploymentResult.deployment.id, input.serverId, input.orderId ?? null,
        input.providerId, input.osImageId ?? null, input.operation, input.maxAttempts ?? 3,
        input.idempotencyKey,
      ]
    );
    const job = rows[0];
    if (!job) throw new Error('enqueueServerProvisioningJob: insert returned no row');
    return { job, created: true };
  };
  return options.alreadyInTransaction ? enqueue(db) : withTransaction(db, enqueue);
}

export async function findProvisioningJobById(db: Queryable, id: string): Promise<ProvisioningJobRow | null> {
  const { rows } = await db.query<ProvisioningJobRow>(`SELECT * FROM provisioning_jobs WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

export async function findProvisioningJobByDeployment(db: Queryable, deploymentId: string): Promise<ProvisioningJobRow | null> {
  const { rows } = await db.query<ProvisioningJobRow>(`SELECT * FROM provisioning_jobs WHERE deployment_id=$1`, [deploymentId]);
  return rows[0] ?? null;
}

export async function listProvisioningJobs(
  db: Queryable,
  filters: { status?: string; serverId?: string; limit?: number } = {}
): Promise<Array<ProvisioningJobRow & { customer_email: string | null; server_name: string; provider_name: string; os_display_name: string | null; order_number: string | null }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (fragment: string,value: unknown) => { params.push(value); conditions.push(fragment.replace('?',`$${params.length}`)); };
  if (filters.status) add('j.status=?',filters.status);
  if (filters.serverId) add('j.server_id=?',filters.serverId);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(200,Math.max(1,filters.limit ?? 100));
  const { rows } = await db.query<ProvisioningJobRow & { customer_email: string | null; server_name: string; provider_name: string; os_display_name: string | null; order_number: string | null }>(
    `SELECT j.*,u.email customer_email,s.name server_name,p.name provider_name,v.display_name os_display_name,o.order_number
     FROM provisioning_jobs j
     JOIN servers s ON s.id=j.server_id
     LEFT JOIN users u ON u.id=s.customer_id
     JOIN infrastructure_providers p ON p.id=j.provider_id
     LEFT JOIN server_os_images img ON img.id=j.os_image_id
     LEFT JOIN operating_system_versions v ON v.id=img.operating_system_version_id
     LEFT JOIN orders o ON o.id=j.order_id
     ${where} ORDER BY j.created_at DESC LIMIT ${limit}`, params
  );
  return rows;
}

export async function updateProvisioningJob(
  db: Queryable,
  jobId: string,
  patch: Partial<{
    status: string; attempts: number; providerServerId: string | null; providerResponse: Record<string, unknown> | null;
    errorCode: string | null; errorMessage: string | null; retryable: boolean | null;
    startedAt: string | null; completedAt: string | null; failedAt: string | null;
  }>
): Promise<ProvisioningJobRow | null> {
  const current = await findProvisioningJobById(db,jobId);
  if (!current) return null;
  const { rows } = await db.query<ProvisioningJobRow>(
    `UPDATE provisioning_jobs SET status=$2,attempts=$3,provider_server_id=$4,provider_response=$5,
       error_code=$6,error_message=$7,retryable=$8,started_at=$9,completed_at=$10,failed_at=$11,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [jobId,patch.status ?? current.status,patch.attempts ?? current.attempts,patch.providerServerId !== undefined ? patch.providerServerId : current.provider_server_id,patch.providerResponse !== undefined ? JSON.stringify(patch.providerResponse) : current.provider_response ? JSON.stringify(current.provider_response) : null,patch.errorCode !== undefined ? patch.errorCode : current.error_code,patch.errorMessage !== undefined ? patch.errorMessage : current.error_message,patch.retryable !== undefined ? patch.retryable : current.retryable,patch.startedAt !== undefined ? patch.startedAt : current.started_at,patch.completedAt !== undefined ? patch.completedAt : current.completed_at,patch.failedAt !== undefined ? patch.failedAt : current.failed_at]
  );
  return rows[0] ?? null;
}

export async function appendProvisioningLog(
  db: Queryable,
  jobId: string,
  input: { stage: string; message: string; level?: 'info' | 'warn' | 'error'; metadata?: Record<string, unknown> }
): Promise<void> {
  const entry = { at: new Date().toISOString(),level: input.level ?? 'info',stage: input.stage,message: input.message,metadata: input.metadata ?? {} };
  await db.query(
    `UPDATE provisioning_jobs SET logs=logs || jsonb_build_array($2::jsonb),updated_at=now() WHERE id=$1`,
    [jobId,JSON.stringify(entry)]
  );
}

export async function cancelProvisioningJob(db: Queryable, jobId: string): Promise<boolean> {
  const { rows } = await db.query(
    `WITH target AS (
       SELECT id,deployment_id FROM provisioning_jobs WHERE id=$1 AND status='QUEUED' FOR UPDATE
     ), cancelled_deployment AS (
       UPDATE deployments d
       SET status='cancelled',completed_at=now(),lease_expires_at=NULL,worker_id=NULL,updated_at=now()
       FROM target t
       WHERE d.id=t.deployment_id AND d.status='queued'
       RETURNING d.id
     )
     UPDATE provisioning_jobs j
     SET status='CANCELLED',completed_at=now(),updated_at=now()
     FROM target t,cancelled_deployment d
     WHERE j.id=t.id AND d.id=t.deployment_id
     RETURNING j.id`,
    [jobId]
  );
  return rows.length > 0;
}

export async function retryProvisioningJob(db: Queryable, jobId: string): Promise<boolean> {
  // Queue row and observability row move together. If another active operation appeared after the
  // failure, the one-active-operation index rolls this whole statement back rather than leaving
  // an orphaned retry in deployments.
  const { rows } = await db.query(
     `WITH target AS (
       SELECT failed.id,failed.deployment_id
       FROM provisioning_jobs failed
       WHERE failed.id=$1 AND failed.status='FAILED' AND failed.retryable IS DISTINCT FROM false
         AND NOT EXISTS (
           SELECT 1 FROM provisioning_jobs active
           WHERE active.server_id=failed.server_id AND active.id<>failed.id
             AND active.status NOT IN('READY','FAILED','CANCELLED')
         )
       FOR UPDATE
     ), queued_deployment AS (
       UPDATE deployments d
       SET status='queued',run_after=now(),completed_at=NULL,lease_expires_at=NULL,
           worker_id=NULL,error_code=NULL,error_message=NULL,updated_at=now()
       FROM target t
       WHERE d.id=t.deployment_id AND d.status IN('failed','rolled_back')
       RETURNING d.id
     )
     UPDATE provisioning_jobs j
     SET status='QUEUED',failed_at=NULL,error_code=NULL,error_message=NULL,updated_at=now()
     FROM target t,queued_deployment d
     WHERE j.id=t.id AND d.id=t.deployment_id
     RETURNING j.id`,
    [jobId]
  );
  return rows.length > 0;
}
