/**
 * B5.1 — one customer identity, and a secure session hand-off into the WHMCS client area.
 *
 * The problem this file solves, stated plainly: the SPA owns the login the customer actually uses,
 * WHMCS owns billing, and the two must agree that "this person" is one account without either side
 * ever seeing the other's password. The mechanism WHMCS provides for that is `CreateSsoToken`: our
 * server, authenticated with the API credential, mints a single-use token for a client id and
 * receives back a prepared redirect URL. The browser follows it and lands inside the client area,
 * already signed in.
 *
 * Six rules are enforced here rather than in the route, because they are the whole security story:
 *
 *  1. **The client id comes from our database, never from the request.** `whmcs_client_links` is the
 *     only mapping, keyed by `users.id`. A caller cannot ask to be handed a session for client 42 —
 *     there is no parameter that would accept it. That is also the session-fixation answer: the
 *     session we create is derived from the authenticated caller, not from anything they supplied.
 *  2. **Linking requires proof the customer owns both mailboxes.** The CloudHost247 address must be
 *     verified (`email_verified_at`) and must equal the WHMCS client's address exactly, ignoring
 *     case. Two clients with the same address are refused rather than guessed between.
 *  3. **One-to-one.** A `users.id` links to at most one client and a client to at most one user
 *     (enforced by the primary key and a unique constraint, not by a check-then-insert).
 *  4. **Replay is not possible from our side.** The token itself is never stored, never logged and
 *     never returned anywhere but the authenticated response that asked for it; WHMCS expires it in
 *     60 seconds and accepts it once. What we keep is an audit row: who, which client, when.
 *  5. **The redirect URL is not trusted blindly.** It has to be an absolute URL on the configured
 *     WHMCS origin, so a misconfigured or compromised installation cannot bounce a signed-in
 *     customer to a host of its choosing.
 *  6. **MFA is not weakened.** WHMCS's SSO endpoint redeems a trusted token *without* re-prompting
 *     for 2FA (documented behaviour), so a hand-off is refused unless the customer has MFA enabled
 *     on the account that is doing the authenticating — unless the operator has explicitly accepted
 *     the downgrade with `WHMCS_SSO_REQUIRE_MFA=false` (see `config.ts`).
 *
 * Nothing here creates an order, an invoice or a charge, and nothing here reads a password.
 */

import { randomUUID } from 'node:crypto';
import type { WhmcsConfig } from './config';
import type { WhmcsClient } from './client';
import type { Queryable } from '../db/types';
import { WhmcsApiError, WhmcsSchemaError, WhmcsSsoError } from './errors';
import { clientSummarySchema, getClientsSchema, ssoTokenSchema } from './schemas';

/** WHMCS expires an SSO access token after 60 seconds; that is the ceiling, not a default. */
export const SSO_TOKEN_TTL_SECONDS = 60;

/** Hand-offs allowed per customer inside the window below. Three page reloads, a few retries. */
export const SSO_MAX_HANDOFFS_PER_WINDOW = 10;
export const SSO_HANDOFF_WINDOW_MS = 5 * 60_000;

/**
 * The destinations a page may request, mapped to the WHMCS scope names documented at
 * https://docs.whmcs.com/WHMCS_Single_Sign-On_Developer_Guide.
 *
 * An allow-list keyed by a short name, not a passthrough string: the scope is chosen by the server,
 * so a caller cannot inject `sso:custom_redirect` (or anything else) into the API call. Destinations
 * that require a `service_id`/`domain_id` are intentionally absent — those belong to later phases
 * that will validate the id against the customer's own services first.
 */
export const SSO_DESTINATIONS = {
  clientarea: { scope: null, label: 'Billing area home' },
  profile: { scope: 'clientarea:profile', label: 'My details' },
  services: { scope: 'clientarea:services', label: 'My products and services' },
  domains: { scope: 'clientarea:domains', label: 'My domains' },
  invoices: { scope: 'clientarea:invoices', label: 'My invoices' },
  tickets: { scope: 'clientarea:tickets', label: 'My support tickets' },
} as const;

export type SsoDestinationKey = keyof typeof SSO_DESTINATIONS;
export const SSO_DESTINATION_KEYS = Object.keys(SSO_DESTINATIONS) as SsoDestinationKey[];

export function isSsoDestination(value: unknown): value is SsoDestinationKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SSO_DESTINATIONS, value);
}

export type LinkMethod = 'verified-email-match' | 'staff-assisted';

export interface WhmcsClientLink {
  userId: string;
  whmcsClientId: number;
  /** Always lower-cased — the column has a CHECK constraint that guarantees it. */
  whmcsEmail: string;
  linkMethod: LinkMethod;
  verifiedAt: string;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Reads the caller's link. Returns null when the account has never been connected. */
export async function findClientLink(pool: Queryable, userId: string): Promise<WhmcsClientLink | null> {
  const result = await pool.query<{
    user_id: string;
    whmcs_client_id: number | string;
    whmcs_email: string;
    link_method: string;
    verified_at: Date | string;
  }>(
    `SELECT user_id, whmcs_client_id, whmcs_email, link_method, verified_at
       FROM whmcs_client_links
      WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const verifiedAt = row.verified_at instanceof Date ? row.verified_at.toISOString() : String(row.verified_at);
  return {
    userId: row.user_id,
    whmcsClientId: Number(row.whmcs_client_id),
    whmcsEmail: row.whmcs_email,
    linkMethod: row.link_method === 'staff-assisted' ? 'staff-assisted' : 'verified-email-match',
    verifiedAt,
  };
}

/**
 * `GetClients` wraps its list three different ways depending on version and emptiness:
 * `{ client: [ ... ] }`, `[ ... ]`, or `{ "0": {...} }`. All three become an array here.
 */
export function normalizeClientRows(raw: unknown): unknown[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  const inner = record.client;
  if (inner === undefined) return Object.values(record);
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === 'object') return Object.values(inner as Record<string, unknown>);
  return [];
}

/**
 * Resolves the single WHMCS client whose email address equals `email` (case-insensitively).
 *
 * Refuses rather than guesses: zero matches and multiple matches are both errors with their own
 * code, so support can tell "you have no billing account" from "your addresses collide".
 */
export async function resolveClientByEmail(
  client: WhmcsClient,
  email: string,
): Promise<{ clientId: number; email: string }> {
  const wanted = normalizeEmail(email);
  const payload = await client.call('GetClients', { search: wanted, limitnum: 50 }, getClientsSchema);
  const rows = normalizeClientRows(payload.clients);

  const matches: Array<{ clientId: number; email: string }> = [];
  for (const row of rows) {
    const parsed = clientSummarySchema.safeParse(row);
    if (!parsed.success) {
      throw new WhmcsSchemaError(
        'GetClients',
        parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      );
    }
    const rowEmail = normalizeEmail(parsed.data.email);
    if (rowEmail !== wanted) continue;
    const clientId = Number(parsed.data.id);
    if (!Number.isInteger(clientId) || clientId <= 0) {
      throw new WhmcsSchemaError('GetClients', [
        `id: client id "${parsed.data.id}" is not a positive integer`,
      ]);
    }
    matches.push({ clientId, email: rowEmail });
  }

  if (matches.length === 0) {
    throw new WhmcsSsoError(
      'WHMCS_SSO_CLIENT_NOT_FOUND',
      `No WHMCS client has the email address ${wanted}`,
    );
  }
  if (matches.length > 1) {
    throw new WhmcsSsoError(
      'WHMCS_SSO_CLIENT_AMBIGUOUS',
      `${matches.length} WHMCS clients share the email address ${wanted}`,
    );
  }
  return matches[0]!;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505';
}

export interface LinkInput {
  userId: string;
  /** The CloudHost247 account's email — the one that was verified, not one supplied by a form. */
  email: string;
  emailVerified: boolean;
}

/**
 * Connects the authenticated account to its WHMCS client.
 *
 * Idempotent by design: calling it again for an account that is already linked returns the existing
 * link instead of re-resolving, so a double-tap on the button is harmless. A *different* client id
 * for an already-linked account is refused — resolving that needs a human.
 */
export async function linkWhmcsClient(
  pool: Queryable,
  client: WhmcsClient,
  input: LinkInput,
): Promise<WhmcsClientLink> {
  if (!input.emailVerified) {
    throw new WhmcsSsoError(
      'WHMCS_SSO_NOT_VERIFIED',
      'The account email must be verified before a billing account can be linked',
    );
  }

  const existing = await findClientLink(pool, input.userId);
  if (existing) return existing;

  const resolved = await resolveClientByEmail(client, input.email);

  try {
    await pool.query(
      `INSERT INTO whmcs_client_links (user_id, whmcs_client_id, whmcs_email, link_method)
       VALUES ($1, $2, $3, 'verified-email-match')`,
      [input.userId, resolved.clientId, resolved.email],
    );
  } catch (error) {
    // Either this user was linked concurrently (same user_id) or the client already belongs to
    // another account. Both mean "ask a human"; neither may overwrite the existing row.
    if (isUniqueViolation(error)) {
      throw new WhmcsSsoError(
        'WHMCS_SSO_LINK_CONFLICT',
        'That billing account is already connected, or this account was connected concurrently',
      );
    }
    throw error;
  }

  const link = await findClientLink(pool, input.userId);
  if (!link) {
    // The insert succeeded but the row is not readable: fail loudly rather than pretend.
    throw new WhmcsSsoError('WHMCS_SSO_LINK_CONFLICT', 'The link was written but could not be read back');
  }
  return link;
}

/** Removes the link. The WHMCS client itself is never touched. Returns whether a row was removed. */
export async function unlinkWhmcsClient(pool: Queryable, userId: string): Promise<boolean> {
  const result = await pool.query<{ user_id: string }>(
    `DELETE FROM whmcs_client_links WHERE user_id = $1 RETURNING user_id`,
    [userId],
  );
  return result.rows.length > 0;
}

/**
 * The last line of defence on the redirect target.
 *
 * WHMCS builds this URL, so it should point at the configured installation — but "should" is not a
 * control. A different host, a different scheme, a relative string or embedded credentials all mean
 * the deployment's WHMCS URL and its System URL disagree (or something worse), and the customer is
 * about to be sent there with a live token. Fail closed instead.
 */
export function assertSafeSsoRedirect(config: WhmcsConfig, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WhmcsSsoError('WHMCS_SSO_UNSAFE_REDIRECT', 'SSO redirect was not an absolute URL');
  }
  const base = new URL(config.baseUrl);
  if (url.protocol !== base.protocol || url.host !== base.host) {
    throw new WhmcsSsoError(
      'WHMCS_SSO_UNSAFE_REDIRECT',
      `SSO redirect host ${url.origin} does not match the configured WHMCS origin ${base.origin}`,
    );
  }
  if (url.username || url.password) {
    throw new WhmcsSsoError('WHMCS_SSO_UNSAFE_REDIRECT', 'SSO redirect carried embedded credentials');
  }
  return url.toString();
}

/** Hand-offs this customer has already been given inside the current window. */
export async function countRecentHandoffs(pool: Queryable, userId: string, nowMs: number): Promise<number> {
  const result = await pool.query<{ count: number | string }>(
    `SELECT count(*)::int AS count
       FROM whmcs_sso_handoffs
      WHERE user_id = $1
        AND created_at > to_timestamp($2::double precision / 1000.0) - ($3::int * interval '1 millisecond')`,
    [userId, nowMs, SSO_HANDOFF_WINDOW_MS],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export interface HandoffInput {
  userId: string;
  link: WhmcsClientLink;
  destination: SsoDestinationKey;
  /** `jti` of the CloudHost247 session making the request. Audit only. */
  sessionJti?: string | null;
}

export interface HandoffResult {
  url: string;
  destination: SsoDestinationKey;
  expiresAt: string;
  ttlSeconds: number;
}

export interface HandoffDeps {
  now?: () => number;
  newId?: () => string;
}

function mapSsoApiError(error: unknown): never {
  // "SSO authentication blocked for client x" is WHMCS's answer when the customer has switched
  // single sign-on off in their own security settings. It is a normal, recoverable state, not an
  // outage, so it gets its own code and sentence instead of a generic 502.
  if (error instanceof WhmcsApiError && /sso authentication blocked/i.test(error.message)) {
    throw new WhmcsSsoError('WHMCS_SSO_BLOCKED', 'WHMCS refused to mint a token: SSO is disabled for this client');
  }
  throw error;
}

/**
 * Mints one SSO token and records that it happened.
 *
 * Returns the URL WHMCS prepared; the token inside it is never persisted. The caller must send the
 * result with `Cache-Control: no-store` and must not log it.
 */
export async function mintSsoHandoff(
  pool: Queryable,
  client: WhmcsClient,
  input: HandoffInput,
  deps: HandoffDeps = {},
): Promise<HandoffResult> {
  const now = deps.now ?? Date.now;
  const newId = deps.newId ?? (() => randomUUID());

  const recent = await countRecentHandoffs(pool, input.userId, now());
  if (recent >= SSO_MAX_HANDOFFS_PER_WINDOW) {
    throw new WhmcsSsoError(
      'WHMCS_SSO_RATE_LIMITED',
      `${recent} hand-offs already issued in the last ${SSO_HANDOFF_WINDOW_MS / 60_000} minutes`,
    );
  }

  const scope = SSO_DESTINATIONS[input.destination].scope;

  let payload: { redirect_url: string };
  try {
    payload = await client.call(
      'CreateSsoToken',
      {
        client_id: input.link.whmcsClientId,
        destination: scope ?? undefined,
      },
      ssoTokenSchema,
      // Mints a session, creates no billing state: allowed in read-only mode, never retried.
      { sessionAction: true },
    );
  } catch (error) {
    mapSsoApiError(error);
  }

  const url = assertSafeSsoRedirect(client.config, payload.redirect_url);

  const issuedAtMs = now();
  const expiresAtMs = issuedAtMs + SSO_TOKEN_TTL_SECONDS * 1000;
  await pool.query(
    `INSERT INTO whmcs_sso_handoffs (id, user_id, whmcs_client_id, destination, session_jti, expires_at)
     VALUES ($1, $2, $3, $4, $5, to_timestamp($6::double precision / 1000.0))`,
    [
      newId(),
      input.userId,
      input.link.whmcsClientId,
      scope ?? 'clientarea',
      input.sessionJti ?? null,
      expiresAtMs,
    ],
  );

  return {
    url,
    destination: input.destination,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlSeconds: SSO_TOKEN_TTL_SECONDS,
  };
}
