/**
 * Login bookkeeping: record the session, and tell the customer when a sign-in is unfamiliar.
 *
 * Split out of src/routes/auth.ts so the three token-issuing login paths (password, passkey, MFA
 * completion) share exactly one implementation, and so the familiarity rule is testable without
 * driving an HTTP login.
 *
 * What "unfamiliar" means, precisely: this account already has at least one other active recorded
 * session, and none of them carries this request's user agent. So
 *   - the first recorded sign-in is never announced (there is nothing to be unfamiliar from);
 *   - a second browser/device is announced once, and not again on its next login;
 *   - a client that sends no user agent is never treated as a known device.
 *
 * The decision is deliberately conservative in the direction of *fewer* alerts rather than more:
 * a missed "new device" notice is a nuisance, while a flood of them trains a customer to ignore the
 * one that matters. Anything stronger (IP reputation, geo-velocity, locking the account) is not
 * implemented and must not be implied.
 */
import type { Queryable } from '../db/types';
import { decodeAuthTokenClaims } from '../lib/jwt';
import {
  hasActiveSessionWithUserAgent,
  hasOtherActiveSession,
  recordAuthSession,
} from '../db/auth-sessions';
import { notifyUnfamiliarLogin } from './notification-service';

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

function headerString(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export async function recordLoginSessionAndNotify(input: {
  db: Queryable;
  request: RequestLike;
  userId: string;
  /** The token this login just issued. Read for its `jti`/`exp` only — never verified here. */
  token: string;
  /** Called with a message when the bookkeeping itself fails; a login must not fail over it. */
  onError?: (message: string, error: unknown) => void;
}): Promise<void> {
  try {
    const { jti, exp } = decodeAuthTokenClaims(input.token);
    const userAgent = headerString(input.request.headers['user-agent']);
    const ipAddress = input.request.ip ?? null;

    const sessionId = await recordAuthSession(input.db, {
      userId: input.userId,
      jti,
      expiresAt: new Date(exp * 1000),
      userAgent,
      ipAddress,
    });

    const knownDevice = await hasActiveSessionWithUserAgent(input.db, {
      userId: input.userId,
      userAgent,
      excludeJti: jti,
    });
    if (knownDevice) return;

    const hasOthers = await hasOtherActiveSession(input.db, { userId: input.userId, excludeJti: jti });
    if (!hasOthers) return;

    await notifyUnfamiliarLogin(input.db, {
      userId: input.userId,
      sessionId,
      userAgent,
      ipAddress,
      signedInAt: new Date(),
    });
  } catch (error) {
    // Session bookkeeping and alerting are additions to login, never conditions of it: a database
    // hiccup here must not lock a customer out of an otherwise valid sign-in. The failure is
    // reported, not swallowed silently.
    input.onError?.('failed to record the sign-in session or its alert', error);
  }
}
