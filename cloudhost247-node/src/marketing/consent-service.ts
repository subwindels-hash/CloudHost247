import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import geoip from 'geoip-lite';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { safeEqual } from '../lib/crypto';
import { ForbiddenError, ValidationError } from '../lib/errors';
import { resolveVisitorIpFromRequest } from '../routes/visitor-ip';
import { CONSENT_POLICY_VERSION, defaultPreferences, preferencesSchema, type Preferences } from './types';

export const CONSENT_COOKIE = 'ch247_marketing_consent';
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const OPT_IN_COUNTRIES = new Set(['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','LV','LI','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','GB','CH','NG','BR','ZA','KE','GH','CA','AU','NZ','JP','KR','IN','AR','CL','CO','TH','VN']);
export interface ConsentRow {
  id: string; token_hash: string; preferences: Preferences; decided: boolean;
  jurisdiction: string | null; policy_version: number; expires_at: string; updated_at: string;
}
export interface ConsentContext { row: ConsentRow; token: string; csrfToken: string }
export function hashConsentToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
export function consentCsrf(token: string, env: Pick<Env, 'JWT_SECRET' | 'MARKETING_CONSENT_SECRET'>) {
  // Domain-separated from authentication; a dedicated deployment secret can be rotated independently.
  const key = createHmac('sha256', env.MARKETING_CONSENT_SECRET || env.JWT_SECRET).update('cloudhost247:marketing-consent:v1').digest();
  return createHmac('sha256', key).update(hashConsentToken(token)).digest('hex');
}
export function cookieValue(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (typeof header !== 'string' || header.length > 8192) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0,index).trim() !== name) continue;
    const value = part.slice(index+1).trim();
    return /^[A-Za-z0-9_.-]{1,512}$/.test(value) ? value : null;
  }
  return null;
}
export function resolveJurisdiction(request: FastifyRequest, env: Env): string | null {
  const ip = resolveVisitorIpFromRequest(request, env).ip;
  if (!ip) return null;
  try { const country = geoip.lookup(ip)?.country; return country && /^[A-Z]{2}$/.test(country) ? country : null; }
  catch { return null; }
}
export function requiresOptIn(policy: string, country: string | null) {
  return policy !== 'jurisdiction_opt_in' || !country || OPT_IN_COUNTRIES.has(country);
}
export function consentGranted(row: ConsentRow | null | undefined): boolean {
  return Boolean(row && row.decided && row.policy_version === CONSENT_POLICY_VERSION && row.preferences.marketing && new Date(row.expires_at).getTime() > Date.now());
}
export async function findConsent(pool: Queryable, token: string | null): Promise<ConsentRow | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (await pool.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE token_hash=$1 AND expires_at>now()', [hashConsentToken(token)])).rows[0] ?? null;
}
export async function requestConsent(pool: Queryable, request: FastifyRequest): Promise<ConsentRow | null> {
  return findConsent(pool, cookieValue(request, CONSENT_COOKIE));
}
export function setConsentCookie(reply: FastifyReply, token: string, env: Env) {
  const secure = env.NODE_ENV === 'production' || new URL(env.APP_URL).protocol === 'https:';
  reply.header('Set-Cookie', `${CONSENT_COOKIE}=${token}; Path=/; Max-Age=${CONSENT_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
}
export async function ensureConsent(pool: Queryable, request: FastifyRequest, reply: FastifyReply, env: Env): Promise<ConsentContext> {
  const token = cookieValue(request, CONSENT_COOKIE);
  let row = await findConsent(pool, token);
  let usableToken = token;
  const jurisdiction = resolveJurisdiction(request, env);
  if (!row || !usableToken) {
    usableToken = randomBytes(32).toString('hex');
    row = (await pool.query<ConsentRow>(`INSERT INTO marketing_consent_sessions(id,token_hash,jurisdiction) VALUES($1,$2,$3) RETURNING *`, [randomUUID(), hashConsentToken(usableToken), jurisdiction])).rows[0]!;
    setConsentCookie(reply, usableToken, env);
  }
  return { row, token: usableToken, csrfToken: consentCsrf(usableToken, env) };
}
export function consentDTO(context: ConsentContext, policy: string) {
  const row = context.row;
  const current = row.policy_version === CONSENT_POLICY_VERSION;
  return {
    preferences: current ? row.preferences : defaultPreferences,
    decided: current && row.decided, marketingGranted: consentGranted(row),
    jurisdiction: row.jurisdiction, jurisdictionSource: row.jurisdiction ? 'verified_network_geo_advisory' : 'unknown',
    requiresOptIn: requiresOptIn(policy, row.jurisdiction), policyVersion: CONSENT_POLICY_VERSION,
    expiresAt: row.expires_at, updatedAt: row.updated_at, csrfToken: context.csrfToken,
  };
}
export function assertConsentMutation(request: FastifyRequest, context: ConsentContext, env: Env) {
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite === 'cross-site') throw new ForbiddenError('Cross-site consent changes are not allowed');
  if (origin) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new ForbiddenError('Invalid consent request origin'); }
    const expected = new URL(env.APP_URL);
    // The preview/reverse proxy preserves Host. APP_URL is also accepted for a verified deployment.
    if (!['http:','https:'].includes(parsed.protocol) || (parsed.host !== request.headers.host && parsed.origin !== expected.origin)) throw new ForbiddenError('Consent must be changed from this website');
  } else if (env.NODE_ENV === 'production') throw new ForbiddenError('An Origin header is required to change consent');
  const csrf = request.headers['x-consent-csrf'];
  if (typeof csrf !== 'string' || !safeEqual(csrf, context.csrfToken)) throw new ForbiddenError('Reload cookie preferences before saving');
}
const actionSchema = preferencesSchema;
export async function saveConsent(pool: Queryable, token: string, action: string, input: unknown): Promise<ConsentRow> {
  if (!['accept_all','reject_optional','save_preferences','withdraw'].includes(action)) throw new ValidationError('Unknown cookie preference action');
  let preferences: Preferences;
  if (action === 'accept_all') preferences = { essential: true, analytics: true, marketing: true };
  else if (action === 'reject_optional' || action === 'withdraw') preferences = { ...defaultPreferences };
  else {
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError('Choose valid analytics and marketing preferences; essential cookies cannot be disabled');
    preferences = parsed.data;
  }
  return withTransaction(pool, async tx => {
    const row = (await tx.query<ConsentRow>('SELECT * FROM marketing_consent_sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE', [hashConsentToken(token)])).rows[0];
    if (!row) throw new ForbiddenError('Cookie preference session expired. Reload preferences.');
    const previouslyGranted = consentGranted(row);
    const { rows } = await tx.query<ConsentRow>(`UPDATE marketing_consent_sessions SET preferences=$1,decided=true,policy_version=$2,updated_at=now() WHERE id=$3 RETURNING *`, [JSON.stringify(preferences), CONSENT_POLICY_VERSION, row.id]);
    await tx.query(`INSERT INTO marketing_consent_history(id,session_id,action,preferences,jurisdiction,policy_version) VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(),row.id,action,JSON.stringify(preferences),row.jurisdiction,CONSENT_POLICY_VERSION]);
    if (previouslyGranted && !preferences.marketing) await tx.query(`UPDATE marketing_delivery_outbox SET status='cancelled',worker_id=NULL,lease_until=NULL,last_error='Marketing consent withdrawn',updated_at=now()
      WHERE id IN (SELECT o.id FROM marketing_delivery_outbox o JOIN marketing_events e ON e.id=o.event_id WHERE e.session_id=$1 AND o.status IN ('queued','retry','processing'))`, [row.id]);
    return rows[0]!;
  });
}

/** Only an origin-relative path is retained: query strings can contain credentials or personal data. */
export function safeSourceUrl(value: unknown, appUrl: string): string {
  const base = new URL(appUrl);
  let path = '/';
  if (typeof value === 'string' && value.length <= 4096) {
    try { const url = new URL(value, base); if (url.origin === base.origin) path = url.pathname.slice(0,1024); } catch { /* fail closed to root */ }
  }
  return new URL(path, base).toString().slice(0,2048);
}

export interface CheckoutConsentContext { sessionId: string; sourceUrl: string; fbp: string | null; fbc: string | null; ttp: string | null; ttclid: string | null }
/** Read the current choice before checkout; the order transaction attaches it atomically below. */
export async function checkoutConsentContext(pool: Queryable, request: FastifyRequest, env: Env): Promise<CheckoutConsentContext | null> {
  try {
    const row = await requestConsent(pool, request);
    if (!consentGranted(row)) return null;
    return { sessionId: row!.id, sourceUrl: safeSourceUrl(request.headers.referer, env.APP_URL), fbp: cookieValue(request, '_fbp'), fbc: cookieValue(request, '_fbc'), ttp: cookieValue(request, '_ttp'), ttclid: cookieValue(request, 'ttclid') };
  } catch { return null; }
}
/** Optional marketing context uses a savepoint so a marketing failure cannot roll back a valid order. */
export async function attachOrderConsent(tx: Queryable, orderId: string, context: CheckoutConsentContext | null | undefined): Promise<void> {
  if (!context) return;
  await tx.query('SAVEPOINT marketing_order_context');
  try {
    await tx.query(`INSERT INTO marketing_conversion_contexts(subject_key,order_id,session_id,source_url,fbp,fbc)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(subject_key) DO NOTHING`, [`order:${orderId}`,orderId,context.sessionId,context.sourceUrl,context.fbp,context.fbc]);
    await tx.query('RELEASE SAVEPOINT marketing_order_context');
  } catch {
    await tx.query('ROLLBACK TO SAVEPOINT marketing_order_context');
    await tx.query('RELEASE SAVEPOINT marketing_order_context');
  }
}
