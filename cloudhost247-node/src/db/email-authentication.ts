/**
 * SPF/DKIM/DMARC email authentication (G05 — email and marketing).
 *
 * Stores per-domain email authentication configuration: DKIM selector + RSA key pair, SPF
 * record, DMARC record. DKIM key pairs are generated server-side. No external mail or DNS
 * provider is called — publishing DNS TXT records is the customer's or provider's
 * responsibility. Honest about the absence of a mail provider rather than fabricating delivery.
 */
import { randomUUID, generateKeyPairSync, constants } from 'node:crypto';
import type { Queryable } from './types';

export type EmailAuthStatus = 'active' | 'disabled';

export interface EmailAuthRow {
  id: string;
  user_id: string;
  domain_name: string;
  dkim_selector: string;
  dkim_public_key: string;
  dkim_private_key: string;
  spf_record: string | null;
  dmarc_record: string | null;
  status: EmailAuthStatus;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEmailAuthInput {
  user_id: string;
  domain_name: string;
  dkim_selector?: string;
  spf_record?: string | null;
  dmarc_record?: string | null;
  status?: EmailAuthStatus;
}

export interface ListEmailAuthFilter {
  user_id?: string;
  domain_name?: string;
  status?: EmailAuthStatus;
  limit?: number;
  offset?: number;
}

export interface UpdateEmailAuthInput {
  spf_record?: string | null;
  dmarc_record?: string | null;
  status?: EmailAuthStatus;
  rotate_dkim?: boolean;
}

/** Generate a 2048-bit RSA DKIM key pair and return PEM-encoded public/private keys. */
export function generateDkimKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });
  return {
    publicKey: publicKey as string,
    privateKey: privateKey as string,
  };
}

/** Build the DKIM TXT record value for a selector and public key. */
export function buildDkimTxtRecord(selector: string, publicKeyPem: string): string {
  // Strip PEM headers/footers and whitespace to get the raw base64 key.
  const base64 = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s/g, '');
  return `v=DKIM1; k=rsa; p=${base64}`;
}

/** Build a default SPF record for a domain. */
export function buildDefaultSpfRecord(): string {
  return 'v=spf1 mx -all';
}

/** Build a default DMARC record for a domain. */
export function buildDefaultDmarcRecord(domain: string): string {
  return `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain};`;
}

export async function createEmailAuthentication(
  db: Queryable,
  input: CreateEmailAuthInput,
): Promise<EmailAuthRow> {
  const id = randomUUID();
  const selector = input.dkim_selector ?? 'default';
  const { publicKey, privateKey } = generateDkimKeyPair();

  const { rows } = await db.query<EmailAuthRow>(
    `INSERT INTO email_authentication
       (id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key,
        spf_record, dmarc_record, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key,
               spf_record, dmarc_record, status, created_at, updated_at`,
    [
      id,
      input.user_id,
      input.domain_name,
      selector,
      publicKey,
      privateKey,
      input.spf_record ?? buildDefaultSpfRecord(),
      input.dmarc_record ?? buildDefaultDmarcRecord(input.domain_name),
      input.status ?? 'active',
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create email authentication');
  return row;
}

export async function listEmailAuthentication(
  db: Queryable,
  filter: ListEmailAuthFilter = {}
): Promise<EmailAuthRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.user_id) {
    params.push(filter.user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (filter.domain_name) {
    params.push(filter.domain_name);
    conditions.push(`domain_name = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Math.trunc(filter.limit ?? 50), 1), 100);
  const offset = Math.max(Math.trunc(filter.offset ?? 0), 0);

  const { rows } = await db.query<EmailAuthRow>(
    `SELECT id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key,
            spf_record, dmarc_record, status, created_at, updated_at
     FROM email_authentication
     ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return rows;
}

export async function countEmailAuthentication(
  db: Queryable,
  filter: ListEmailAuthFilter = {}
): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.user_id) {
    params.push(filter.user_id);
    conditions.push(`user_id = $${params.length}`);
  }
  if (filter.domain_name) {
    params.push(filter.domain_name);
    conditions.push(`domain_name = $${params.length}`);
  }
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_authentication ${where}`,
    params
  );
  return Number(rows[0]?.count ?? '0');
}

export async function findEmailAuthenticationById(
  db: Queryable,
  id: string,
  userId?: string,
): Promise<EmailAuthRow | null> {
  const conditions: string[] = ['id = $1'];
  const params: unknown[] = [id];
  if (userId) {
    params.push(userId);
    conditions.push(`user_id = $${params.length}`);
  }
  const { rows } = await db.query<EmailAuthRow>(
    `SELECT id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key,
            spf_record, dmarc_record, status, created_at, updated_at
     FROM email_authentication
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return rows[0] ?? null;
}

export async function findEmailAuthenticationByDomain(
  db: Queryable,
  userId: string,
  domainName: string,
): Promise<EmailAuthRow | null> {
  const { rows } = await db.query<EmailAuthRow>(
    `SELECT id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key,
            spf_record, dmarc_record, status, created_at, updated_at
     FROM email_authentication
     WHERE user_id = $1 AND domain_name = $2`,
    [userId, domainName]
  );
  return rows[0] ?? null;
}

export async function updateEmailAuthentication(
  db: Queryable,
  id: string,
  userId: string,
  input: UpdateEmailAuthInput,
): Promise<EmailAuthRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (input.spf_record !== undefined) {
    params.push(input.spf_record);
    sets.push(`spf_record = $${params.length}`);
  }
  if (input.dmarc_record !== undefined) {
    params.push(input.dmarc_record);
    sets.push(`dmarc_record = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
  }

  if (input.rotate_dkim) {
    const { publicKey, privateKey } = generateDkimKeyPair();
    params.push(publicKey);
    sets.push(`dkim_public_key = $${params.length}`);
    params.push(privateKey);
    sets.push(`dkim_private_key = $${params.length}`);
  }

  if (sets.length === 0) return findEmailAuthenticationById(db, id, userId);

  sets.push(`updated_at = now()`);

  const { rows } = await db.query<EmailAuthRow>(
    `UPDATE email_authentication
     SET ${sets.join(', ')}
     WHERE user_id = $${params.length + 1} AND id = $${params.length + 2}
     RETURNING id, user_id, domain_name, dkim_selector, dkim_public_key, dkim_private_key,
               spf_record, dmarc_record, status, created_at, updated_at`,
    [...params, userId, id]
  );
  return rows[0] ?? null;
}

export async function deleteEmailAuthentication(
  db: Queryable,
  id: string,
  userId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM email_authentication
     WHERE id = $1 AND user_id = $2
     RETURNING id`,
    [id, userId]
  );
  return rows.length > 0;
}