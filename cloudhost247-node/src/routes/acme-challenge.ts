/**
 * The HTTP-01 responder (RFC 8555 §8.3).
 *
 * When a certificate is requested with the HTTP-01 challenge, the CA fetches
 * `http://<domain>/.well-known/acme-challenge/<token>` and compares the body byte-for-byte with the
 * key authorization. Without this route, HTTP-01 can never validate — which is why it is part of
 * the feature rather than an afterthought.
 *
 * Deliberate properties:
 *
 *   - **Unauthenticated, and it has to be.** The CA has no session with us. It is therefore the one
 *     intentionally public route in the SSL module, and it is written to be safe as such: it answers
 *     only for a token that exists in `acme_challenges`, belongs to a certificate that is currently
 *     PENDING/VALIDATING, and is HTTP-01. Nothing else is disclosed — no domain name, no account, no
 *     certificate row. A miss is a plain `404` with a short body, identical to a nonexistent path.
 *   - **Strict token shape.** A token must match the RFC's base64url alphabet and length before any
 *     query runs, so a hostile path cannot be used to probe the database.
 *   - **Short-lived by construction.** Once the authorization is valid (or the certificate leaves
 *     PENDING/VALIDATING) the lookup stops matching, so a token cannot be replayed indefinitely.
 *   - **Path flexibility.** The CA always requests the well-known path, but a proxy or a
 *     sub-path deployment (this app supports a BaseURI mount, see src/app.ts) can land the request
 *     elsewhere. Both the exact well-known path and the mount-prefixed form are registered. The
 *     redirect-free direct answer matters: a CA will not follow a redirect to a different host.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { findHttp01Challenge } from '../ssl/ssl-issuance-service';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export async function registerAcmeChallengeRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
): Promise<void> {
  const pool = overridePool ?? getPool(env);

  /**
   * `text/plain` is what the CA compares; the body must be exactly the key authorization with no
   * trailing decoration. `no-store` because these are single-use validation artifacts.
   */
  async function respond(token: string, reply: FastifyReply) {
    if (!TOKEN_PATTERN.test(token)) {
      reply.code(404).header('content-type', 'text/plain; charset=utf-8');
      return reply.send('Not found');
    }

    const challenge = await findHttp01Challenge(pool, token);
    if (!challenge) {
      // Same body and status as a token that never existed — no oracle for "this token was real
      // once, but that certificate is now issued".
      reply.code(404).header('content-type', 'text/plain; charset=utf-8');
      return reply.send('Not found');
    }

    reply
      .code(200)
      .header('content-type', 'text/plain; charset=utf-8')
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff');
    return reply.send(challenge.keyAuthorization);
  }

  const handler = async (request: { params: { token?: string } }, reply: FastifyReply) =>
    respond(request.params.token ?? '', reply);

  app.get<{ Params: { token: string } }>('/.well-known/acme-challenge/:token', handler);

  // Sub-path deployments: APP_URL may carry a BaseURI (cPanel Passenger). Registering the same
  // handler under that prefix keeps the CA's well-known request reachable without a redirect.
  const mount = new URL(env.APP_URL).pathname.replace(/\/+$/, '');
  if (mount) {
    app.get<{ Params: { token: string } }>(`${mount}/.well-known/acme-challenge/:token`, handler);
  }
}
