import type { Queryable } from './types';

/**
 * Enhanced customer_services model (Section 21).
 *
 * Links customer hosting accounts with infrastructure servers, control panels,
 * licenses, domain records, billing cycles, and lifecycle states.
 */
export interface CustomerServiceRow {
  id: string;
  user_id: string;
  customer_id?: string;
  product_id: string | null;
  plan_id: string | null;
  server_id: string | null;
  control_panel_id: string | null;
  license_id: string | null;
  domain: string | null;
  hostname: string | null;
  username: string | null;
  label: string;
  status: string;
  billing_cycle: string;
  amount: number | string;
  currency: string;
  next_due_date: string | null;
  suspension_date: string | null;
  termination_date: string | null;
  external_reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  product_slug: string | null;
  product_name: string | null;
  plan_slug: string | null;
  plan_name: string | null;
  server_name: string | null;
  server_ip: string | null;
  server_status: string | null;
  panel_name: string | null;
  panel_slug: string | null;
  license_key: string | null;
  license_status: string | null;
  customer_email?: string;
  customer_name?: string;
}

export type CustomerServiceStatus =
  | 'active'
  | 'pending'
  | 'provisioning'
  | 'suspended'
  | 'cancelled'
  | 'terminated'
  | 'pending_migration'
  | 'degraded';

const SELECT_WITH_CATALOG = `
  SELECT
    cs.*,
    COALESCE(cs.customer_id, cs.user_id) AS customer_id,
    p.slug AS product_slug,
    p.name AS product_name,
    pl.slug AS plan_slug,
    pl.name AS plan_name,
    s.name AS server_name,
    COALESCE(s.ipv4, s.ip_address) AS server_ip,
    s.status AS server_status,
    cp.name AS panel_name,
    cp.slug AS panel_slug,
    l.license_key AS license_key,
    l.status AS license_status,
    u.email AS customer_email,
    u.full_name AS customer_name
  FROM customer_services cs
  LEFT JOIN products p ON p.id = cs.product_id
  LEFT JOIN product_plans pl ON pl.id = cs.plan_id
  LEFT JOIN servers s ON s.id = cs.server_id
  LEFT JOIN control_panels cp ON cp.id = cs.control_panel_id
  LEFT JOIN licenses l ON l.id = cs.license_id
  LEFT JOIN users u ON u.id = COALESCE(cs.customer_id, cs.user_id)
`;

export async function listServicesForUser(pool: Queryable, userId: string): Promise<CustomerServiceRow[]> {
  const { rows } = await pool.query<CustomerServiceRow>(
    `${SELECT_WITH_CATALOG} WHERE cs.user_id = $1 OR cs.customer_id = $1 ORDER BY cs.created_at DESC`,
    [userId]
  );
  return rows;
}

export async function listAllServices(
  pool: Queryable,
  filters?: { status?: string; search?: string; serverId?: string; panelId?: string }
): Promise<CustomerServiceRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    params.push(filters.status.toLowerCase());
    clauses.push(`lower(cs.status) = $${params.length}`);
  }

  if (filters?.serverId) {
    params.push(filters.serverId);
    clauses.push(`cs.server_id = $${params.length}`);
  }

  if (filters?.panelId) {
    params.push(filters.panelId);
    clauses.push(`cs.control_panel_id = $${params.length}`);
  }

  if (filters?.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    clauses.push(
      `(lower(cs.label) LIKE $${params.length} OR lower(cs.domain) LIKE $${params.length} OR lower(cs.hostname) LIKE $${params.length} OR lower(u.email) LIKE $${params.length})`
    );
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query<CustomerServiceRow>(
    `${SELECT_WITH_CATALOG} ${where} ORDER BY cs.created_at DESC`,
    params
  );
  return rows;
}

export async function findServiceById(pool: Queryable, id: string): Promise<CustomerServiceRow | null> {
  const { rows } = await pool.query<CustomerServiceRow>(`${SELECT_WITH_CATALOG} WHERE cs.id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export interface CreateCustomerServiceInput {
  id?: string;
  userId: string;
  customerId?: string;
  productId?: string | null;
  planId?: string | null;
  serverId?: string | null;
  controlPanelId?: string | null;
  licenseId?: string | null;
  domain?: string | null;
  hostname?: string | null;
  username?: string | null;
  label: string;
  status?: string;
  billingCycle?: string;
  amount?: number | string;
  currency?: string;
  nextDueDate?: string | null;
  suspensionDate?: string | null;
  terminationDate?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export async function createCustomerService(pool: Queryable, input: CreateCustomerServiceInput): Promise<CustomerServiceRow> {
  const customId = input.id ?? undefined;
  const user = input.customerId ?? input.userId;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO customer_services (
       ${customId ? 'id, ' : ''}user_id, customer_id, product_id, plan_id, server_id,
       control_panel_id, license_id, domain, hostname, username,
       label, status, billing_cycle, amount, currency, next_due_date,
       suspension_date, termination_date, external_reference, notes, created_by
     ) VALUES (
       ${customId ? '$1, ' : ''}${customId ? '$2' : '$1'}, ${customId ? '$3' : '$2'}, ${customId ? '$4' : '$3'},
       ${customId ? '$5' : '$4'}, ${customId ? '$6' : '$5'}, ${customId ? '$7' : '$6'},
       ${customId ? '$8' : '$7'}, ${customId ? '$9' : '$8'}, ${customId ? '$10' : '$9'},
       ${customId ? '$11' : '$10'}, ${customId ? '$12' : '$11'}, ${customId ? '$13' : '$12'},
       ${customId ? '$14' : '$13'}, ${customId ? '$15' : '$14'}, ${customId ? '$16' : '$15'},
       ${customId ? '$17' : '$16'}, ${customId ? '$18' : '$17'}, ${customId ? '$19' : '$18'},
       ${customId ? '$20' : '$19'}, ${customId ? '$21' : '$20'}, ${customId ? '$22' : '$21'}
     ) RETURNING id`,
    customId
      ? [
          customId,
          user,
          user,
          input.productId ?? null,
          input.planId ?? null,
          input.serverId ?? null,
          input.controlPanelId ?? null,
          input.licenseId ?? null,
          input.domain ?? null,
          input.hostname ?? null,
          input.username ?? null,
          input.label,
          input.status ?? 'active',
          input.billingCycle ?? 'monthly',
          input.amount ?? 0.0,
          input.currency ?? 'USD',
          input.nextDueDate ?? null,
          input.suspensionDate ?? null,
          input.terminationDate ?? null,
          input.externalReference ?? null,
          input.notes ?? null,
          input.createdBy ?? null,
        ]
      : [
          user,
          user,
          input.productId ?? null,
          input.planId ?? null,
          input.serverId ?? null,
          input.controlPanelId ?? null,
          input.licenseId ?? null,
          input.domain ?? null,
          input.hostname ?? null,
          input.username ?? null,
          input.label,
          input.status ?? 'active',
          input.billingCycle ?? 'monthly',
          input.amount ?? 0.0,
          input.currency ?? 'USD',
          input.nextDueDate ?? null,
          input.suspensionDate ?? null,
          input.terminationDate ?? null,
          input.externalReference ?? null,
          input.notes ?? null,
          input.createdBy ?? null,
        ]
  );

  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create customer service record');
  const created = await findServiceById(pool, id);
  if (!created) throw new Error('Failed to load newly created customer service record');
  return created;
}

export interface UpdateCustomerServiceInput {
  label?: string;
  status?: string;
  externalReference?: string | null;
  notes?: string | null;
  productId?: string | null;
  planId?: string | null;
  serverId?: string | null;
  controlPanelId?: string | null;
  licenseId?: string | null;
  domain?: string | null;
  hostname?: string | null;
  username?: string | null;
  billingCycle?: string;
  amount?: number | string;
  currency?: string;
  nextDueDate?: string | null;
  suspensionDate?: string | null;
  terminationDate?: string | null;
}

export async function updateCustomerService(
  pool: Queryable,
  id: string,
  patch: UpdateCustomerServiceInput
): Promise<CustomerServiceRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.label !== undefined) set('label', patch.label);
  if (patch.status !== undefined) set('status', patch.status);
  if (patch.externalReference !== undefined) set('external_reference', patch.externalReference);
  if (patch.notes !== undefined) set('notes', patch.notes);
  if (patch.productId !== undefined) set('product_id', patch.productId);
  if (patch.planId !== undefined) set('plan_id', patch.planId);
  if (patch.serverId !== undefined) set('server_id', patch.serverId);
  if (patch.controlPanelId !== undefined) set('control_panel_id', patch.controlPanelId);
  if (patch.licenseId !== undefined) set('license_id', patch.licenseId);
  if (patch.domain !== undefined) set('domain', patch.domain);
  if (patch.hostname !== undefined) set('hostname', patch.hostname);
  if (patch.username !== undefined) set('username', patch.username);
  if (patch.billingCycle !== undefined) set('billing_cycle', patch.billingCycle);
  if (patch.amount !== undefined) set('amount', patch.amount);
  if (patch.currency !== undefined) set('currency', patch.currency);
  if (patch.nextDueDate !== undefined) set('next_due_date', patch.nextDueDate);
  if (patch.suspensionDate !== undefined) set('suspension_date', patch.suspensionDate);
  if (patch.terminationDate !== undefined) set('termination_date', patch.terminationDate);

  if (sets.length === 0) {
    return findServiceById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE customer_services SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (!rows[0]) return null;
  return findServiceById(pool, id);
}

export async function suspendService(pool: Queryable, id: string): Promise<CustomerServiceRow | null> {
  return updateCustomerService(pool, id, {
    status: 'suspended',
    suspensionDate: new Date().toISOString(),
  });
}

export async function unsuspendService(pool: Queryable, id: string): Promise<CustomerServiceRow | null> {
  return updateCustomerService(pool, id, {
    status: 'active',
    suspensionDate: null,
  });
}

export async function terminateService(pool: Queryable, id: string): Promise<CustomerServiceRow | null> {
  return updateCustomerService(pool, id, {
    status: 'terminated',
    terminationDate: new Date().toISOString(),
  });
}
