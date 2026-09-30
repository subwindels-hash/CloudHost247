/**
 * Data access for the Cloudflare subsystem tables (migration 0055). One file per table area,
 * matching the codebase convention. No business rules here — those live in
 * src/services/cloudflare-service.ts and src/integrations/cloudflare/.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

// ------------------------------------------------------------------------------- accounts ---

export interface CloudflareAccountRow {
  id: string;
  account_name: string;
  cloudflare_account_id: string;
  api_base_url: string;
  encrypted_api_token: string;
  status: 'active' | 'disabled';
  default_zone_type: 'full' | 'partial';
  default_ssl_mode: string;
  default_proxied: boolean;
  last_connection_test_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Public shape: NEVER includes the encrypted token envelope, let alone the token. */
export function toAccountDTO(row: CloudflareAccountRow): Omit<CloudflareAccountRow, 'encrypted_api_token'> & { has_token: boolean } {
  const { encrypted_api_token, ...rest } = row;
  return { ...rest, has_token: encrypted_api_token.length > 0 };
}

export async function findActiveCloudflareAccount(db: Queryable, id?: string): Promise<CloudflareAccountRow | null> {
  const { rows } = id
    ? await db.query<CloudflareAccountRow>(`SELECT * FROM cloudflare_accounts WHERE id = $1`, [id])
    : await db.query<CloudflareAccountRow>(`SELECT * FROM cloudflare_accounts WHERE status = 'active' LIMIT 1`);
  return rows[0] ?? null;
}

export async function listCloudflareAccounts(db: Queryable): Promise<CloudflareAccountRow[]> {
  const { rows } = await db.query<CloudflareAccountRow>(`SELECT * FROM cloudflare_accounts ORDER BY created_at ASC`);
  return rows;
}

export async function insertCloudflareAccount(
  db: Queryable,
  input: {
    accountName: string;
    cloudflareAccountId: string;
    apiBaseUrl?: string;
    encryptedApiToken: string;
    defaultZoneType?: 'full' | 'partial';
    defaultSslMode?: string;
    defaultProxied?: boolean;
    createdBy?: string | null;
  }
): Promise<CloudflareAccountRow> {
  const { rows } = await db.query<CloudflareAccountRow>(
    `INSERT INTO cloudflare_accounts
       (id, account_name, cloudflare_account_id, api_base_url, encrypted_api_token,
        default_zone_type, default_ssl_mode, default_proxied, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'https://api.cloudflare.com/client/v4'),$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      randomUUID(),
      input.accountName,
      input.cloudflareAccountId,
      input.apiBaseUrl ?? null,
      input.encryptedApiToken,
      input.defaultZoneType ?? 'full',
      input.defaultSslMode ?? 'full',
      input.defaultProxied ?? true,
      input.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to insert Cloudflare account');
  return row;
}

export async function updateCloudflareAccount(
  db: Queryable,
  id: string,
  fields: {
    accountName?: string;
    cloudflareAccountId?: string;
    apiBaseUrl?: string;
    encryptedApiToken?: string;
    status?: 'active' | 'disabled';
    defaultZoneType?: 'full' | 'partial';
    defaultSslMode?: string;
    defaultProxied?: boolean;
  }
): Promise<CloudflareAccountRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (fields.accountName !== undefined) sets.push(`account_name = $${push(fields.accountName)}`);
  if (fields.cloudflareAccountId !== undefined) sets.push(`cloudflare_account_id = $${push(fields.cloudflareAccountId)}`);
  if (fields.apiBaseUrl !== undefined) sets.push(`api_base_url = $${push(fields.apiBaseUrl)}`);
  if (fields.encryptedApiToken !== undefined) sets.push(`encrypted_api_token = $${push(fields.encryptedApiToken)}`);
  if (fields.status !== undefined) sets.push(`status = $${push(fields.status)}`);
  if (fields.defaultZoneType !== undefined) sets.push(`default_zone_type = $${push(fields.defaultZoneType)}`);
  if (fields.defaultSslMode !== undefined) sets.push(`default_ssl_mode = $${push(fields.defaultSslMode)}`);
  if (fields.defaultProxied !== undefined) sets.push(`default_proxied = $${push(fields.defaultProxied)}`);
  const { rows } = await db.query<CloudflareAccountRow>(
    `UPDATE cloudflare_accounts SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

export async function touchAccountTestResult(db: Queryable, id: string, success: boolean, error: string | null): Promise<void> {
  await db.query(
    success
      ? `UPDATE cloudflare_accounts SET last_connection_test_at = now(), last_success_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`
      : `UPDATE cloudflare_accounts SET last_connection_test_at = now(), last_failure_at = now(), last_error = $2, updated_at = now() WHERE id = $1`,
    success ? [id] : [id, error]
  );
}

// --------------------------------------------------------------------------- plan mappings ---

export interface CloudflarePlanMappingRow {
  id: string;
  plan_id: string;
  cloudflare_plan: 'free' | 'pro' | 'business' | 'enterprise';
  entitlements: Record<string, boolean>;
  max_domains: number;
  provisioning_mode: 'automatic' | 'manual';
  default_ssl_mode: string | null;
  default_proxied: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanMappingWithPlan extends CloudflarePlanMappingRow {
  plan_name: string;
  plan_slug: string;
  plan_status: string;
  product_name: string | null;
  product_type: string | null;
}

export async function findPlanMappingByPlanId(db: Queryable, planId: string): Promise<CloudflarePlanMappingRow | null> {
  const { rows } = await db.query<CloudflarePlanMappingRow>(
    `SELECT * FROM cloudflare_plan_mappings WHERE plan_id = $1`,
    [planId]
  );
  return rows[0] ?? null;
}

export async function listPlanMappings(db: Queryable): Promise<PlanMappingWithPlan[]> {
  const { rows } = await db.query<PlanMappingWithPlan>(
    `SELECT m.*, pl.name AS plan_name, pl.slug AS plan_slug, pl.status AS plan_status,
            p.name AS product_name, p.product_type
       FROM cloudflare_plan_mappings m
       JOIN product_plans pl ON pl.id = m.plan_id
       LEFT JOIN products p ON p.id = pl.product_id
      ORDER BY m.created_at ASC`
  );
  return rows;
}

export async function upsertPlanMapping(
  db: Queryable,
  input: {
    planId: string;
    cloudflarePlan: string;
    entitlements: Record<string, boolean>;
    maxDomains?: number;
    provisioningMode?: string;
    defaultSslMode?: string | null;
    defaultProxied?: boolean | null;
    createdBy?: string | null;
  }
): Promise<CloudflarePlanMappingRow> {
  const { rows } = await db.query<CloudflarePlanMappingRow>(
    `INSERT INTO cloudflare_plan_mappings
       (id, plan_id, cloudflare_plan, entitlements, max_domains, provisioning_mode, default_ssl_mode, default_proxied, created_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
     ON CONFLICT (plan_id) DO UPDATE SET
       cloudflare_plan = EXCLUDED.cloudflare_plan,
       entitlements = EXCLUDED.entitlements,
       max_domains = EXCLUDED.max_domains,
       provisioning_mode = EXCLUDED.provisioning_mode,
       default_ssl_mode = EXCLUDED.default_ssl_mode,
       default_proxied = EXCLUDED.default_proxied,
       updated_at = now()
     RETURNING *`,
    [
      randomUUID(),
      input.planId,
      input.cloudflarePlan,
      JSON.stringify(input.entitlements),
      input.maxDomains ?? 1,
      input.provisioningMode ?? 'automatic',
      input.defaultSslMode ?? null,
      input.defaultProxied ?? null,
      input.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to upsert Cloudflare plan mapping');
  return row;
}

export async function deletePlanMapping(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM cloudflare_plan_mappings WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}

// -------------------------------------------------------------------------------- services ---

export type CloudflareServiceStatus =
  | 'pending' | 'provisioning' | 'active' | 'suspended'
  | 'provisioning_failed' | 'sync_failed' | 'terminating' | 'terminated';

export interface CloudflareServiceRow {
  id: string;
  customer_id: string;
  customer_service_id: string;
  cloudflare_account_id: string | null;
  customer_domain_id: string | null;
  hosting_service_id: string | null;
  subscription_id: string | null;
  order_id: string | null;
  plan_id: string;
  cloudflare_plan: 'free' | 'pro' | 'business' | 'enterprise';
  zone_id: string | null;
  zone_name: string;
  status: CloudflareServiceStatus;
  activation_status: string;
  name_server_1: string | null;
  name_server_2: string | null;
  proxy_default: boolean;
  ssl_mode: string | null;
  development_mode_until: string | null;
  last_synced_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  suspended_at: string | null;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CloudflareServiceWithContext extends CloudflareServiceRow {
  customer_email: string;
  customer_name: string;
  plan_name: string;
  product_name: string | null;
  service_label: string;
  service_status: string;
  dns_record_count: number;
}

const SERVICE_SELECT = `
  SELECT s.*,
         u.email AS customer_email, u.full_name AS customer_name,
         pl.name AS plan_name, p.name AS product_name,
         cs.label AS service_label, cs.status AS service_status,
         (SELECT count(*)::int FROM cloudflare_dns_records r WHERE r.cloudflare_service_id = s.id) AS dns_record_count
    FROM cloudflare_services s
    JOIN users u ON u.id = s.customer_id
    JOIN product_plans pl ON pl.id = s.plan_id
    LEFT JOIN products p ON p.id = pl.product_id
    JOIN customer_services cs ON cs.id = s.customer_service_id
`;

export async function findCloudflareServiceById(db: Queryable, id: string): Promise<CloudflareServiceWithContext | null> {
  const { rows } = await db.query<CloudflareServiceWithContext>(`${SERVICE_SELECT} WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listCloudflareServicesForUser(db: Queryable, userId: string): Promise<CloudflareServiceWithContext[]> {
  const { rows } = await db.query<CloudflareServiceWithContext>(
    `${SERVICE_SELECT} WHERE s.customer_id = $1 ORDER BY s.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function listCloudflareServicesAdmin(
  db: Queryable,
  filters: { page?: number; limit?: number; status?: string; search?: string } = {}
): Promise<{ items: CloudflareServiceWithContext[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.status) where.push(`s.status = $${push(filters.status)}`);
  if (filters.search) {
    const idx = push(`%${filters.search}%`);
    where.push(`(u.email ILIKE $${idx} OR s.zone_name ILIKE $${idx} OR s.zone_id ILIKE $${idx})`);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM cloudflare_services s JOIN users u ON u.id = s.customer_id ${whereSql}`,
    params
  );
  const { rows } = await db.query<CloudflareServiceWithContext>(
    `${SERVICE_SELECT} ${whereSql} ORDER BY s.created_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

export async function insertCloudflareService(
  db: Queryable,
  input: {
    customerId: string;
    customerServiceId: string;
    cloudflareAccountId?: string | null;
    customerDomainId?: string | null;
    hostingServiceId?: string | null;
    subscriptionId?: string | null;
    orderId?: string | null;
    planId: string;
    cloudflarePlan: string;
    zoneName: string;
    proxyDefault?: boolean;
    sslMode?: string | null;
  }
): Promise<CloudflareServiceRow | null> {
  const { rows } = await db.query<CloudflareServiceRow>(
    `INSERT INTO cloudflare_services
       (id, customer_id, customer_service_id, cloudflare_account_id, customer_domain_id,
        hosting_service_id, subscription_id, order_id, plan_id, cloudflare_plan, zone_name,
        proxy_default, ssl_mode, activation_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,lower($11),$12,$13,'pending_nameserver_update')
     ON CONFLICT (customer_service_id) DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.customerId,
      input.customerServiceId,
      input.cloudflareAccountId ?? null,
      input.customerDomainId ?? null,
      input.hostingServiceId ?? null,
      input.subscriptionId ?? null,
      input.orderId ?? null,
      input.planId,
      input.cloudflarePlan,
      input.zoneName,
      input.proxyDefault ?? true,
      input.sslMode ?? null,
    ]
  );
  return rows[0] ?? null;
}

export async function updateCloudflareService(
  db: Queryable,
  id: string,
  fields: {
    status?: CloudflareServiceStatus;
    activationStatus?: string;
    zoneId?: string | null;
    cloudflareAccountId?: string | null;
    cloudflarePlan?: string;
    planId?: string;
    subscriptionId?: string | null;
    nameServer1?: string | null;
    nameServer2?: string | null;
    sslMode?: string | null;
    developmentModeUntil?: Date | null;
    lastSyncedAt?: Date | null;
    lastErrorCode?: string | null;
    lastErrorMessage?: string | null;
    suspendedAt?: Date | null;
    terminatedAt?: Date | null;
  }
): Promise<CloudflareServiceRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (fields.status !== undefined) sets.push(`status = $${push(fields.status)}`);
  if (fields.activationStatus !== undefined) sets.push(`activation_status = $${push(fields.activationStatus)}`);
  if (fields.zoneId !== undefined) sets.push(`zone_id = $${push(fields.zoneId)}`);
  if (fields.cloudflareAccountId !== undefined) sets.push(`cloudflare_account_id = $${push(fields.cloudflareAccountId)}`);
  if (fields.cloudflarePlan !== undefined) sets.push(`cloudflare_plan = $${push(fields.cloudflarePlan)}`);
  if (fields.planId !== undefined) sets.push(`plan_id = $${push(fields.planId)}`);
  if (fields.subscriptionId !== undefined) sets.push(`subscription_id = $${push(fields.subscriptionId)}`);
  if (fields.nameServer1 !== undefined) sets.push(`name_server_1 = $${push(fields.nameServer1)}`);
  if (fields.nameServer2 !== undefined) sets.push(`name_server_2 = $${push(fields.nameServer2)}`);
  if (fields.sslMode !== undefined) sets.push(`ssl_mode = $${push(fields.sslMode)}`);
  if (fields.developmentModeUntil !== undefined) sets.push(`development_mode_until = $${push(fields.developmentModeUntil)}`);
  if (fields.lastSyncedAt !== undefined) sets.push(`last_synced_at = $${push(fields.lastSyncedAt)}`);
  if (fields.lastErrorCode !== undefined) sets.push(`last_error_code = $${push(fields.lastErrorCode)}`);
  if (fields.lastErrorMessage !== undefined) sets.push(`last_error_message = $${push(fields.lastErrorMessage)}`);
  if (fields.suspendedAt !== undefined) sets.push(`suspended_at = $${push(fields.suspendedAt)}`);
  if (fields.terminatedAt !== undefined) sets.push(`terminated_at = $${push(fields.terminatedAt)}`);
  const { rows } = await db.query<CloudflareServiceRow>(
    `UPDATE cloudflare_services SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

// ------------------------------------------------------------------------- DNS record cache ---

export interface CloudflareDnsRecordRow {
  id: string;
  cloudflare_service_id: string;
  cloudflare_record_id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
  comment: string | null;
  ownership: 'SYSTEM_MANAGED' | 'CUSTOMER_MANAGED';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
}

export async function listCachedDnsRecords(db: Queryable, serviceId: string): Promise<CloudflareDnsRecordRow[]> {
  const { rows } = await db.query<CloudflareDnsRecordRow>(
    `SELECT * FROM cloudflare_dns_records WHERE cloudflare_service_id = $1 ORDER BY type ASC, name ASC`,
    [serviceId]
  );
  return rows;
}

export async function findCachedDnsRecord(db: Queryable, serviceId: string, cloudflareRecordId: string): Promise<CloudflareDnsRecordRow | null> {
  const { rows } = await db.query<CloudflareDnsRecordRow>(
    `SELECT * FROM cloudflare_dns_records WHERE cloudflare_service_id = $1 AND cloudflare_record_id = $2`,
    [serviceId, cloudflareRecordId]
  );
  return rows[0] ?? null;
}

export async function upsertCachedDnsRecord(
  db: Queryable,
  input: {
    serviceId: string;
    cloudflareRecordId: string;
    type: string;
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
    priority?: number | null;
    comment?: string | null;
    ownership?: 'SYSTEM_MANAGED' | 'CUSTOMER_MANAGED';
  }
): Promise<CloudflareDnsRecordRow> {
  const { rows } = await db.query<CloudflareDnsRecordRow>(
    `INSERT INTO cloudflare_dns_records
       (id, cloudflare_service_id, cloudflare_record_id, type, name, content, ttl, proxied, priority, comment, ownership, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (cloudflare_service_id, cloudflare_record_id) DO UPDATE SET
       type = EXCLUDED.type, name = EXCLUDED.name, content = EXCLUDED.content,
       ttl = EXCLUDED.ttl, proxied = EXCLUDED.proxied, priority = EXCLUDED.priority,
       comment = EXCLUDED.comment, updated_at = now(), last_synced_at = now()
     RETURNING *`,
    [
      randomUUID(),
      input.serviceId,
      input.cloudflareRecordId,
      input.type,
      input.name,
      input.content,
      input.ttl,
      input.proxied,
      input.priority ?? null,
      input.comment ?? null,
      input.ownership ?? 'CUSTOMER_MANAGED',
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to upsert DNS record cache row');
  return row;
}

export async function deleteCachedDnsRecord(db: Queryable, serviceId: string, cloudflareRecordId: string): Promise<void> {
  await db.query(`DELETE FROM cloudflare_dns_records WHERE cloudflare_service_id = $1 AND cloudflare_record_id = $2`, [
    serviceId,
    cloudflareRecordId,
  ]);
}

export async function deleteCachedDnsRecordsNotIn(db: Queryable, serviceId: string, keepRecordIds: string[]): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    keepRecordIds.length > 0
      ? `DELETE FROM cloudflare_dns_records WHERE cloudflare_service_id = $1 AND NOT (cloudflare_record_id = ANY($2::varchar[])) RETURNING id`
      : `DELETE FROM cloudflare_dns_records WHERE cloudflare_service_id = $1 RETURNING id`,
    keepRecordIds.length > 0 ? [serviceId, keepRecordIds] : [serviceId]
  );
  return rows.length;
}

// ------------------------------------------------------------------------------------ jobs ---

export type CloudflareJobType =
  | 'provision_zone' | 'sync_zone' | 'change_plan' | 'suspend' | 'unsuspend' | 'terminate' | 'sync_hosting_ip';

export interface CloudflareJobRow {
  id: string;
  cloudflare_service_id: string;
  job_type: CloudflareJobType;
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_by: string | null;
  locked_at: string | null;
  idempotency_key: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/** Enqueue; returns null when the idempotency key already exists (duplicate webhook etc.). */
export async function enqueueCloudflareJob(
  db: Queryable,
  input: {
    serviceId: string;
    jobType: CloudflareJobType;
    payload?: Record<string, unknown>;
    idempotencyKey?: string | null;
    maxAttempts?: number;
  }
): Promise<CloudflareJobRow | null> {
  const { rows } = await db.query<CloudflareJobRow>(
    `INSERT INTO cloudflare_jobs (id, cloudflare_service_id, job_type, payload, idempotency_key, max_attempts)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.serviceId,
      input.jobType,
      JSON.stringify(input.payload ?? {}),
      input.idempotencyKey ?? null,
      input.maxAttempts ?? 5,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Claim-lease: atomically locks due queued jobs (and reclaims jobs whose lease expired after a
 * worker crash) so two workers never run the same job concurrently.
 */
export async function claimDueCloudflareJobs(db: Queryable, workerId: string, limit = 5): Promise<CloudflareJobRow[]> {
  const { rows } = await db.query<CloudflareJobRow>(
    `UPDATE cloudflare_jobs SET status = 'running', locked_by = $1, locked_at = now(), updated_at = now()
      WHERE id IN (
        SELECT id FROM cloudflare_jobs
         WHERE (status = 'queued' AND next_attempt_at <= now())
            OR (status = 'running' AND locked_at < now() - interval '15 minutes')
         ORDER BY next_attempt_at ASC
         LIMIT $2
      )
      RETURNING *`,
    [workerId, limit]
  );
  return rows;
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 240];

export async function finishCloudflareJob(
  db: Queryable,
  job: CloudflareJobRow,
  outcome: { success: boolean; error?: string | null; retryable?: boolean }
): Promise<'succeeded' | 'retrying' | 'failed'> {
  if (outcome.success) {
    await db.query(
      `UPDATE cloudflare_jobs SET status = 'succeeded', finished_at = now(), locked_by = NULL, locked_at = NULL,
              last_error = NULL, updated_at = now() WHERE id = $1`,
      [job.id]
    );
    return 'succeeded';
  }
  const attempts = job.attempts + 1;
  const canRetry = (outcome.retryable ?? true) && attempts < job.max_attempts;
  if (canRetry) {
    const delay = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 240;
    await db.query(
      `UPDATE cloudflare_jobs SET status = 'queued', attempts = $2, next_attempt_at = now() + ($3 || ' minutes')::interval,
              locked_by = NULL, locked_at = NULL, last_error = $4, updated_at = now() WHERE id = $1`,
      [job.id, attempts, String(delay), outcome.error ?? null]
    );
    return 'retrying';
  }
  await db.query(
    `UPDATE cloudflare_jobs SET status = 'failed', attempts = $2, finished_at = now(), locked_by = NULL, locked_at = NULL,
            last_error = $3, updated_at = now() WHERE id = $1`,
    [job.id, attempts, outcome.error ?? null]
  );
  return 'failed';
}

export async function listCloudflareJobs(
  db: Queryable,
  filters: { serviceId?: string; status?: string; page?: number; limit?: number } = {}
): Promise<{ items: CloudflareJobRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.serviceId) where.push(`cloudflare_service_id = $${push(filters.serviceId)}`);
  if (filters.status) where.push(`status = $${push(filters.status)}`);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(`SELECT count(*)::text AS total FROM cloudflare_jobs ${whereSql}`, params);
  const { rows } = await db.query<CloudflareJobRow>(
    `SELECT * FROM cloudflare_jobs ${whereSql} ORDER BY created_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

// --------------------------------------------------------------------------------- API logs ---

export async function insertCloudflareApiLog(
  db: Queryable,
  input: {
    requestId: string;
    cloudflareServiceId?: string | null;
    operation: string;
    method: string;
    path: string;
    statusCode: number | null;
    success: boolean;
    durationMs: number;
    errorCode: string | null;
    errorMessage: string | null;
  }
): Promise<void> {
  await db.query(
    `INSERT INTO cloudflare_api_logs
       (id, request_id, cloudflare_service_id, operation, method, path, status_code, success, duration_ms, error_code, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      randomUUID(),
      input.requestId,
      input.cloudflareServiceId ?? null,
      input.operation,
      input.method,
      input.path.slice(0, 255),
      input.statusCode,
      input.success,
      input.durationMs,
      input.errorCode,
      input.errorMessage,
    ]
  );
}

export async function listCloudflareApiLogs(
  db: Queryable,
  filters: { serviceId?: string; success?: boolean; page?: number; limit?: number } = {}
): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; limit: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.serviceId) where.push(`cloudflare_service_id = $${push(filters.serviceId)}`);
  if (filters.success !== undefined) where.push(`success = $${push(filters.success)}`);
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(`SELECT count(*)::text AS total FROM cloudflare_api_logs ${whereSql}`, params);
  const { rows } = await db.query(
    `SELECT * FROM cloudflare_api_logs ${whereSql} ORDER BY created_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}
