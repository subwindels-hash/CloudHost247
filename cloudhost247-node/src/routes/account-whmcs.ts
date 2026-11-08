/**
 * B5.1 — the customer-facing side of the WHMCS identity bridge.
 *
 * Four endpoints, and nothing else:
 *
 *   GET    /api/v1/account/whmcs        what the page is allowed to know / draw
 *   POST   /api/v1/account/whmcs/link   connect this account to its WHMCS client
 *   DELETE /api/v1/account/whmcs/link   disconnect it again (password required)
 *   POST   /api/v1/account/whmcs/sso    mint a one-time session hand-off into the client area
 *
 * Rules that hold across all four:
 *
 *  - `authenticate()` first, always. The bearer token is the only thing that identifies the caller,
 *    and because a login token is only issued after MFA (`src/routes/auth.ts` returns 202 with an
 *    MFA challenge instead of a token when MFA is enabled), an SSO hand-off inherits the strength
 *    of the login that produced the session.
 *  - **No support session may mint one.** An administrator impersonating a customer must not be
 *    able to walk into that customer's billing account. There is no legitimate use for it here.
 *  - The response bodies are built field by field. No WHMCS payload is ever forwarded, so a field
 *    WHMCS adds later — including any password field a `GetClientsDetails`-style call might return —
 *    cannot reach the browser.
 *  - The hand-off URL is a credential for 60 seconds: sent once, `Cache-Control: no-store`, and
 *    never logged.
 *  - When WHMCS is not configured the endpoints answer honestly (`configured: false`, 503 on the
 *    actions) instead of pretending the feature exists.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { findUserById } from '../db/users';
import {
  ConflictError,
  ForbiddenError,
  HttpError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from '../lib/errors';
import { verifyPassword } from '../lib/password';
import { authenticate } from '../lib/require-auth';
import { getMfaStatus } from '../services/totp-mfa-service';
import {
  SSO_DESTINATIONS,
  SSO_DESTINATION_KEYS,
  WhmcsClient,
  WhmcsError,
  consoleLogger,
  findClientLink,
  isSsoDestination,
  linkWhmcsClient,
  loadWhmcsConfig,
  mintSsoHandoff,
  safeCustomerMessage,
  unlinkWhmcsClient,
  type WhmcsConfigResult,
  type WhmcsClientLink,
} from '../whmcs';

const ssoRequestSchema = z.object({
  destination: z.string().min(1).max(32).optional(),
});

const unlinkSchema = z.object({
  password: z.string().min(1, 'Enter your password to disconnect the billing account'),
});

export interface WhmcsAccountRouteDeps {
  /** Test seam: a pre-built client (usually backed by a fake transport) instead of the real one. */
  whmcsClient?: WhmcsClient;
  /** Test seam: config resolved from a fixed environment rather than `process.env`. */
  whmcsConfig?: WhmcsConfigResult;
}

/**
 * Translates the WHMCS taxonomy into HTTP without leaking upstream text. Every customer-facing
 * sentence comes from `safeCustomerMessage()` or is written here; `error.message` never is.
 */
function toHttpError(error: unknown): HttpError {
  if (error instanceof Error && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    const message = safeCustomerMessage(error);
    switch (code) {
      case 'WHMCS_NOT_CONFIGURED':
        return new ServiceUnavailableError(message);
      case 'WHMCS_SSO_CLIENT_NOT_FOUND':
        return new NotFoundError(message);
      case 'WHMCS_SSO_NOT_VERIFIED':
      case 'WHMCS_SSO_ALREADY_LINKED':
      case 'WHMCS_SSO_LINK_CONFLICT':
      case 'WHMCS_SSO_CLIENT_AMBIGUOUS':
      case 'WHMCS_SSO_EMAIL_MISMATCH':
      case 'WHMCS_SSO_BLOCKED':
        return new ConflictError(message);
      case 'WHMCS_SSO_MFA_REQUIRED':
        return new ForbiddenError(message);
      case 'WHMCS_SSO_RATE_LIMITED':
        return new HttpError(429, message, 'RATE_LIMITED');
      case 'WHMCS_SSO_UNSAFE_REDIRECT':
        return new HttpError(502, 'The billing system returned an unexpected sign-in address.', 'UPSTREAM_ERROR');
      case 'WHMCS_TIMEOUT':
      case 'WHMCS_UNREACHABLE':
      case 'WHMCS_HTTP_ERROR':
      case 'WHMCS_CIRCUIT_OPEN':
        return new HttpError(503, message, 'UPSTREAM_UNAVAILABLE');
      default:
        return new HttpError(502, message, 'UPSTREAM_ERROR');
    }
  }
  throw error;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

export async function registerWhmcsAccountRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable,
  deps: WhmcsAccountRouteDeps = {},
) {
  const pool = overridePool ?? getPool(env);

  // Resolved once at registration. `loadWhmcsConfig` never throws on *missing* configuration (it
  // returns `enabled: false` with a reason) and throws on invalid configuration — a deployment that
  // misconfigured WHMCS should hear about it at boot, not on a customer's click.
  const configResult: WhmcsConfigResult = deps.whmcsConfig ?? loadWhmcsConfig(process.env);
  const client: WhmcsClient | null =
    deps.whmcsClient ??
    (configResult.enabled ? new WhmcsClient({ config: configResult.config, logger: consoleLogger }) : null);

  function requireClient(): WhmcsClient {
    if (!configResult.enabled || !client) {
      throw new ServiceUnavailableError(
        configResult.enabled ? 'Billing system is not available' : configResult.reason,
      );
    }
    return client;
  }

  /** A linked client id must never come from a support session. */
  function assertNotSupportSession(auth: { supportSessionId: string | null }): void {
    if (auth.supportSessionId) {
      throw new ForbiddenError('Single sign-on is not available while an administrator is signed in to your account');
    }
  }

  function presentLink(link: WhmcsClientLink) {
    return {
      clientId: link.whmcsClientId,
      email: link.whmcsEmail,
      linkedAt: link.verifiedAt,
      method: link.linkMethod,
    };
  }

  app.get('/api/v1/account/whmcs', async (request) => {
    const auth = await authenticate(request, env, pool);
    const link = await findClientLink(pool, auth.userId);

    if (!configResult.enabled) {
      return {
        configured: false,
        reason: configResult.reason,
        mode: null,
        linked: Boolean(link),
        link: link ? presentLink(link) : null,
        destinations: SSO_DESTINATION_KEYS.map((key) => ({ key, label: SSO_DESTINATIONS[key].label })),
        ssoRequiresMfa: true,
        mfaEnabled: false,
      };
    }

    const mfa = await getMfaStatus(pool, auth.userId);
    return {
      configured: true,
      reason: null,
      mode: configResult.config.mode,
      linked: Boolean(link),
      link: link ? presentLink(link) : null,
      destinations: SSO_DESTINATION_KEYS.map((key) => ({ key, label: SSO_DESTINATIONS[key].label })),
      ssoRequiresMfa: configResult.config.ssoRequireMfa,
      mfaEnabled: mfa.enabled,
    };
  });

  app.post(
    '/api/v1/account/whmcs/link',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request) => {
      const auth = await authenticate(request, env, pool);
      assertNotSupportSession(auth);
      const activeClient = requireClient();

      const user = await findUserById(pool, auth.userId);
      if (!user) throw new NotFoundError('Account no longer exists');

      try {
        const link = await linkWhmcsClient(pool, activeClient, {
          userId: auth.userId,
          email: user.email,
          emailVerified: Boolean(user.email_verified_at),
        });
        return { linked: true, link: presentLink(link) };
      } catch (error) {
        if (error instanceof WhmcsError) throw toHttpError(error);
        throw error;
      }
    },
  );

  app.delete('/api/v1/account/whmcs/link', async (request) => {
    const auth = await authenticate(request, env, pool);
    assertNotSupportSession(auth);

    const { password } = parseOrThrow(unlinkSchema, request.body ?? {});
    const user = await findUserById(pool, auth.userId);
    if (!user) throw new NotFoundError('Account no longer exists');

    // Re-authentication, because unlinking is destructive in the direction that matters: the
    // customer loses the only path into their billing history until support reconnects them.
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new ForbiddenError('That password is not correct');
    }

    const removed = await unlinkWhmcsClient(pool, auth.userId);
    if (!removed) throw new NotFoundError('No billing account is connected to this account');
    return { linked: false };
  });

  app.post(
    '/api/v1/account/whmcs/sso',
    { config: { rateLimit: { max: 12, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      assertNotSupportSession(auth);
      const activeClient = requireClient();

      const body = parseOrThrow(ssoRequestSchema, request.body ?? {});
      const destination = body.destination ?? 'clientarea';
      if (!isSsoDestination(destination)) {
        throw new ValidationError(
          `destination must be one of: ${SSO_DESTINATION_KEYS.join(', ')}`,
        );
      }

      const link = await findClientLink(pool, auth.userId);
      if (!link) {
        throw new ConflictError('Connect your billing account before opening the billing area');
      }

      // WHMCS redeems a trusted token without re-prompting for 2FA. If this deployment requires
      // MFA (the default), the second factor has to have been enforced here first.
      if (configResult.enabled && configResult.config.ssoRequireMfa) {
        const mfa = await getMfaStatus(pool, auth.userId);
        if (!mfa.enabled) {
          throw new ForbiddenError(
            'Enable two-factor authentication on your account before opening the billing area',
          );
        }
      }

      try {
        const handoff = await mintSsoHandoff(pool, activeClient, {
          userId: auth.userId,
          link,
          destination,
          sessionJti: auth.jti ?? null,
        });
        reply.header('cache-control', 'no-store');
        reply.header('pragma', 'no-cache');
        return {
          url: handoff.url,
          destination: handoff.destination,
          expiresAt: handoff.expiresAt,
          ttlSeconds: handoff.ttlSeconds,
        };
      } catch (error) {
        if (error instanceof WhmcsError) throw toHttpError(error);
        throw error;
      }
    },
  );
}
