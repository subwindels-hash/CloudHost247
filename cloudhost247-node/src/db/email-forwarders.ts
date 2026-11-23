/**
 * Email forwarding rules (G06 — email forwarding).
 *
 * A forwarder maps a local address to a destination address. Every forwarder is tenant-scoped
 * via user_id. No SMTP or mail provider is configured here — the rule is stored as configured
 * and delivery depends on a mail provider that is not yet activated. Honest about the absence
 * of a mail provider rather than fabricating delivery.
 */
import type { Queryable } from './types';
import { randomUUID } from 'node:crypto';

export type ForwarderStatus = 'active' | 'disabled';

export interface EmailForwarderRow {
  id: string;
  user_id: string;
  local_address: string;
  destination_address: string;
  status: ForwarderStatus;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEmailForwarderInput {
  user_id: string;
  local_address: string;
  destination_address: string;
  status?: ForwarderStatus;
}

export interface ListEmailForwardersFilter {
  user_id?: string;
  status?: ForwarderStatus;
  local_address?: string;
  limit?: number;
  offset?: number;
}

export interface UpdateEmailForwarderInput {
  destination_address?: string;
  status?: ForwarderStatus;
}

export async function createEmailForwarder(
  db: Queryable,
  input: CreateEmailForwarderInput,
): Promise<EmailForwarderRow> {
  const id = randomUUID();
  const { rows } = await db.query<EmailForwarderRow>(
    `INSERT INTO email_forwarders
       (id, user_id, local_address, destination_address, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, user_id, local_address, destination_address, status, created_at, updated_at`,
    [
      id,
      input.user_id,
      input.local_address,
      input.destination_address,
      input.status ?? 'active',
    ]
  );
  const forwarder = rows[0];
  if (!forwarder) throw new Error('Failed to create email forwarder');
  return forwarder;
}

export async function listEmailForwarders(
  db: Queryable,
  filter: ListEmailForwardersFilter = {}
): Promise<EmailForwarderRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.user_id) {
    params.push(filter.user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.local_address) {
    params.push(filter.local_address);
    conditions.push(`local_address = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { rows } = await db.query<EmailForwarderRow>(
    `SELECT id, user_id, local_address, destination_address, status, created_at, updated_at
     FROM email_forwarders
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

export async function countEmailForwarders(
  db: Queryable,
  filter: ListEmailForwardersFilter = {}
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.user_id) {
    params.push(filter.user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter.local_address) {
    params.push(filter.local_address);
    conditions.push(`local_address = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_forwarders ${where}`,
    params
  );
  return Number(rows[0]?.count ?? '0');
}

export async function findEmailForwarderById(
  db: Queryable,
  id: string,
  userId?: string,
): Promise<EmailForwarderRow | null> {
  const conditions: string[] = ['id = $1'];
  const params: unknown[] = [id];
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  const { rows } = await db.query<EmailForwarderRow>(
    `SELECT id, user_id, local_address, destination_address, status, created_at, updated_at
     FROM email_forwarders
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows[0] ?? null;
}

export async function updateEmailForwarder(
  db: Queryable,
  id: string,
  userId: string,
  input: UpdateEmailForwarderInput,
): Promise<EmailForwarderRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.destination_address !== undefined) {
    params.push(input.destination_address);
    sets.push(`destination_address = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }

  if (sets.length === 0) return findEmailForwarderById(db, id, userId);

  sets.push(`updated_at = now()`);

  const { rows } = await db.query<EmailForwarderRow>(
    `UPDATE email_forwarders
     SET ${sets.join(', ')}
     WHERE user_id = $${params.length + 1} AND id = $${params.length + 2}
     RETURNING id, user_id, local_address, destination_address, status, created_at, updated_at`,
    [...params, userId, id]
  );
  return rows[0] ?? null;
}

export async function deleteEmailForwarder(
  db: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM email_forwarders
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}