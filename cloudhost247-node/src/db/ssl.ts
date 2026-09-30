import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface SslCertificateRow {
  id: string;
  user_id: string;
  server_id: string | null;
  domain_id: string | null;
  domain_name: string;
  sans: string[];
  issuer: 'LETS_ENCRYPT' | 'ZERO_SSL' | 'CUSTOM' | 'SELF_SIGNED';
  certificate_pem: string | null;
  private_key_encrypted: string | null;
  expires_at: string | null;
  status: 'PENDING' | 'VALIDATING' | 'ISSUED' | 'EXPIRED' | 'FAILED' | 'REVOKED';
  challenge_type: 'HTTP_01' | 'DNS_01' | 'MANUAL';
  auto_renew: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateSslCertificateInput {
  userId: string;
  serverId?: string | null;
  domainId?: string | null;
  domainName: string;
  sans?: string[];
  issuer?: 'LETS_ENCRYPT' | 'ZERO_SSL' | 'CUSTOM' | 'SELF_SIGNED';
  certificatePem?: string | null;
  privateKeyEncrypted?: string | null;
  expiresAt?: string | null;
  status?: 'PENDING' | 'VALIDATING' | 'ISSUED' | 'EXPIRED' | 'FAILED' | 'REVOKED';
  challengeType?: 'HTTP_01' | 'DNS_01' | 'MANUAL';
  autoRenew?: boolean;
  metadata?: Record<string, unknown>;
}

export async function listSslCertificatesForUser(db: Queryable, userId: string): Promise<SslCertificateRow[]> {
  const { rows } = await db.query<SslCertificateRow>(
    `SELECT * FROM ssl_certificates WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

export async function findSslCertificateById(db: Queryable, id: string): Promise<SslCertificateRow | null> {
  const { rows } = await db.query<SslCertificateRow>(
    `SELECT * FROM ssl_certificates WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createSslCertificate(
  db: Queryable,
  input: CreateSslCertificateInput
): Promise<SslCertificateRow> {
  const id = randomUUID();
  const sans = input.sans ?? [];
  const issuer = input.issuer ?? 'LETS_ENCRYPT';
  const status = input.status ?? 'PENDING';
  const challengeType = input.challengeType ?? 'HTTP_01';
  const autoRenew = input.autoRenew ?? true;
  const metadata = input.metadata ?? {};

  const { rows } = await db.query<SslCertificateRow>(
    `INSERT INTO ssl_certificates (
      id, user_id, server_id, domain_id, domain_name, sans, issuer,
      certificate_pem, private_key_encrypted, expires_at, status, challenge_type,
      auto_renew, metadata
    ) VALUES ($1, $2, $3, $4, lower($5), $6, $7, $8, $9, $10, $11, $12, $13, $14)
    RETURNING *`,
    [
      id,
      input.userId,
      input.serverId ?? null,
      input.domainId ?? null,
      input.domainName,
      sans,
      issuer,
      input.certificatePem ?? null,
      input.privateKeyEncrypted ?? null,
      input.expiresAt ?? null,
      status,
      challengeType,
      autoRenew,
      JSON.stringify(metadata),
    ]
  );
  return rows[0]!;
}

export async function updateSslCertificate(
  db: Queryable,
  id: string,
  patch: Partial<CreateSslCertificateInput>
): Promise<SslCertificateRow | null> {
  const current = await findSslCertificateById(db, id);
  if (!current) return null;

  const { rows } = await db.query<SslCertificateRow>(
    `UPDATE ssl_certificates
     SET certificate_pem = $1, private_key_encrypted = $2, expires_at = $3, status = $4, updated_at = now()
     WHERE id = $5
     RETURNING *`,
    [
      patch.certificatePem !== undefined ? patch.certificatePem : current.certificate_pem,
      patch.privateKeyEncrypted !== undefined ? patch.privateKeyEncrypted : current.private_key_encrypted,
      patch.expiresAt !== undefined ? patch.expiresAt : current.expires_at,
      patch.status !== undefined ? patch.status : current.status,
      id,
    ]
  );
  return rows[0] ?? null;
}

export async function deleteSslCertificate(db: Queryable, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM ssl_certificates WHERE id = $1 RETURNING id`,
    [id]
  );
  return rows.length > 0;
}
