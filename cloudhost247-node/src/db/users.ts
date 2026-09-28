import type { Queryable } from './types';

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export async function findUserByEmail(pool: Queryable, email: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  return rows[0] ?? null;
}

export async function findUserById(pool: Queryable, id: string): Promise<UserRecord | null> {
  const { rows } = await pool.query<UserRecord>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function createUser(
  pool: Queryable,
  input: { id: string; email: string; passwordHash: string; fullName: string }
): Promise<UserRecord> {
  const { rows } = await pool.query<UserRecord>(
    `INSERT INTO users (id, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.id, input.email, input.passwordHash, input.fullName]
  );
  const row = rows[0];
  if (!row) {
    throw new Error('Failed to create user');
  }
  return row;
}

export async function recordAuthEvent(
  pool: Queryable,
  event: {
    id: string;
    userId: string | null;
    eventType: 'register' | 'login_success' | 'login_failure' | 'logout' | 'token_refresh';
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await pool.query(
    `INSERT INTO auth_audit_log (id, user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      event.id,
      event.userId,
      event.eventType,
      event.ipAddress ?? null,
      event.userAgent ?? null,
      JSON.stringify(event.metadata ?? {}),
    ]
  );
}
