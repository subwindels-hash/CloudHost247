import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';

const CHALLENGE_MINUTES = 5;
const RP_NAME = 'CloudHost247';

export interface PasskeyRecord {
  id: string;
  name: string;
  device_type: 'singleDevice' | 'multiDevice';
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

function hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
function deriveChallenge(secret: string, id: string) {
  return createHmac('sha256', secret).update(`cloudhost247:webauthn-registration:v1:${id}`).digest('base64url');
}

export function relyingParty(env: Pick<Env, 'APP_URL'>): { rpID: string; origin: string } {
  const url = new URL(env.APP_URL);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') throw new Error('Passkeys require an HTTPS APP_URL');
  return { rpID: url.hostname, origin: url.origin };
}

export async function listPasskeys(db: Queryable, userId: string): Promise<PasskeyRecord[]> {
  const { rows } = await db.query<PasskeyRecord>(
    `SELECT id,name,device_type,backed_up,created_at,last_used_at FROM user_passkeys WHERE user_id=$1 ORDER BY created_at DESC`, [userId]
  );
  return rows;
}

export async function beginPasskeyRegistration(
  db: Queryable, env: Pick<Env, 'APP_URL' | 'JWT_SECRET'>,
  user: { id: string; email: string; fullName: string; authSessionVersion: number }
) {
  const { rpID } = relyingParty(env);
  const existing = await db.query<{ credential_id: string; transports: string[] }>(
    `SELECT credential_id,transports FROM user_passkeys WHERE user_id=$1`, [user.id]
  );
  const id = randomUUID();
  const challenge = deriveChallenge(env.JWT_SECRET, id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME, rpID, userID: Buffer.from(user.id), userName: user.email, userDisplayName: user.fullName,
    challenge, attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
    excludeCredentials: existing.rows.map((row) => ({ id: row.credential_id, transports: row.transports })),
  });
  await withTransaction(db, async (tx) => {
    await tx.query(`UPDATE webauthn_registration_challenges SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`, [user.id]);
    await tx.query(
      `INSERT INTO webauthn_registration_challenges (id,user_id,challenge_hash,session_version,expires_at)
       VALUES ($1,$2,$3,$4,now() + ($5 || ' minutes')::interval)`,
      [id, user.id, hash(challenge), user.authSessionVersion, String(CHALLENGE_MINUTES)]
    );
  });
  return { challengeId: id, options };
}

export async function finishPasskeyRegistration(
  db: Queryable, env: Pick<Env, 'APP_URL' | 'JWT_SECRET'>,
  input: { userId: string; sessionVersion: number; challengeId: string; response: RegistrationResponseJSON; name: string }
): Promise<PasskeyRecord | null> {
  const { rpID, origin } = relyingParty(env);
  return withTransaction(db, async (tx) => {
    const challenge = await tx.query<{ user_id: string; session_version: number; expires_at: string; used_at: string | null }>(
      `SELECT * FROM webauthn_registration_challenges WHERE id=$1 FOR UPDATE`, [input.challengeId]
    );
    const row = challenge.rows[0];
    if (!row || row.user_id !== input.userId || row.used_at || new Date(row.expires_at).getTime() <= Date.now() || row.session_version !== input.sessionVersion) return null;
    const expectedChallenge = deriveChallenge(env.JWT_SECRET, input.challengeId);
    const verification = await verifyRegistrationResponse({
      response: input.response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) return null;
    const info = verification.registrationInfo;
    const credential = info.credential;
    await tx.query(`UPDATE webauthn_registration_challenges SET used_at=now() WHERE id=$1`, [input.challengeId]);
    const inserted = await tx.query<PasskeyRecord>(
      `INSERT INTO user_passkeys (id,user_id,credential_id,public_key,counter,transports,device_type,backed_up,aaguid,name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id,name,device_type,backed_up,created_at,last_used_at`,
      [randomUUID(), input.userId, credential.id, Buffer.from(credential.publicKey), credential.counter,
        JSON.stringify(credential.transports ?? []), info.credentialDeviceType, info.credentialBackedUp, info.aaguid, input.name]
    );
    return inserted.rows[0] ?? null;
  });
}

export async function renamePasskey(db: Queryable, userId: string, id: string, name: string): Promise<PasskeyRecord | null> {
  const { rows } = await db.query<PasskeyRecord>(
    `UPDATE user_passkeys SET name=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,name,device_type,backed_up,created_at,last_used_at`, [id,userId,name]
  ); return rows[0] ?? null;
}
export async function removePasskey(db: Queryable, userId: string, id: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM user_passkeys WHERE id=$1 AND user_id=$2 RETURNING id`, [id,userId]); return !!rows[0];
}
