/**
 * Automatic renewal controls (I12 — domains and DNS).
 *
 * Stores and toggles the `auto_renew` flag on customer domains. This is a backend toggle only;
 * no registrar provider is called. Actual renewal depends on a registrar integration that is
 * not yet activated.
 */
import type { Queryable } from './types';

export interface DomainAutoRenewRow {
  id: string;
  user_id: string;
  domain_name: string;
  auto_renew: boolean;
  updated_at: Date;
}

export async function getDomainAutoRenew(
  db: Queryable,
  domainId: string,
  userId?: string,
): Promise<DomainAutoRenewRow | null> {
  const conditions: string[] = ['id = $1'];
  const params: unknown[] = [domainId];
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  const { rows } = await db.query<DomainAutoRenewRow>(
    `SELECT id, user_id, domain_name, auto_renew, updated_at
     FROM customer_domains
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows[0] ?? null;
}

export async function setDomainAutoRenew(
  db: Queryable,
  domainId: string,
  userId: string,
  autoRenew: boolean,
): Promise<DomainAutoRenewRow | null> {
  const { rows } = await db.query<DomainAutoRenewRow>(
    `UPDATE customer_domains
     SET auto_renew = $1, updated_at = now()
     WHERE id = $2 AND user_id = $3
     RETURNING id, user_id, domain_name, auto_renew, updated_at`,
    [autoRenew, domainId, userId]
  );
  return rows[0] ?? null;
}