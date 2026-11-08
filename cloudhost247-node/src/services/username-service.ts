/**
 * Username service — the single owner of username format, reservation and uniqueness rules.
 *
 * Why one module: the rules have to be identical at registration (a name is required), in account
 * settings (a name can be changed) and in admin/import paths. A rule that lives in a zod schema at
 * one call site is a rule that the other call sites do not have.
 *
 * Rules enforced here:
 *   - Format: 3–32 characters, starts with a letter, then letters/digits/`.`/`_`/`-`, with no
 *     leading, trailing or doubled separators. This keeps names typeable, greppable and free of the
 *     look-alike noise (`suppor.t`, `admin__`) that makes impersonation easier.
 *   - Uniqueness: case-insensitive, enforced by `users_username_lower_unique_idx`. We never do a
 *     "check it is free then insert" dance for the authoritative answer — that races — but we do
 *     *suggest* alternatives cheaply so the customer is not left guessing after a conflict.
 *   - Reserved names: a static list (always present) unioned with the `reserved_usernames` table
 *     (operator-extendable without a deploy). Brand, role and infrastructural names are refused,
 *     and a few obviously deceptive prefixes are refused as a substring check.
 */
import type { Queryable } from '../db/types';

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/;

/**
 * Separator placement: no leading, trailing or doubled `.`/`_`/`-`.
 *
 * This mirrors the `users_username_format_check` constraint exactly. The two must agree: when they
 * drifted, a name like `dots..` passed validation and was then rejected by PostgreSQL, so the
 * customer saw a 500 instead of "choose a different name".
 */
export const USERNAME_SEPARATOR_PATTERN = /^[._-]|[._-]$|[._-]{2,}/;

/**
 * Names that must never be issued to a customer. Kept in code as well as in the
 * `reserved_usernames` table: the table is operator-editable, so it could be emptied by mistake,
 * and the impersonation guarantee must not depend on a data row existing.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'admins',
  'root',
  'superadmin',
  'super-admin',
  'super_admin',
  'staff',
  'support',
  'support_team',
  'helpdesk',
  'help',
  'billing',
  'finance',
  'accounts',
  'sales',
  'marketing',
  'security',
  'abuse',
  'system',
  'sysadmin',
  'cloudhost247',
  'cloudhost',
  'ch247',
  'official',
  'verified',
  'moderator',
  'mod',
  'owner',
  'ceo',
  'api',
  'www',
  'mail',
  'smtp',
  'noreply',
  'no-reply',
  'postmaster',
  'hostmaster',
  'webmaster',
  'anonymous',
  'guest',
  'null',
  'undefined',
  'me',
  'you',
  'customer_support',
]);

/**
 * Substrings that make a name deceptive even when the exact reserved word is not used, e.g.
 * "official-support", "cloudhost247-billing", "adminteam". Checked against the name with
 * separators removed so `c.l.o.u.d.h.o.s.t.247` cannot slip through either.
 */
const RESERVED_SUBSTRINGS = ['cloudhost247', 'cloudhost', 'ch247', 'admin', 'support'];

export interface UsernameValidation {
  ok: boolean;
  /** Normalised (trimmed) value, present when the format is acceptable. */
  value: string;
  /** Customer-facing explanation when `ok` is false. Never leaks whether a name exists. */
  error?: string;
}

/** Format + reservation check. Does NOT touch the database (see `isUsernameAvailable`). */
export function validateUsernameFormat(raw: string): UsernameValidation {
  const value = String(raw ?? '').trim();
  if (value.length < USERNAME_MIN_LENGTH) {
    return { ok: false, value, error: `Usernames must be at least ${USERNAME_MIN_LENGTH} characters` };
  }
  if (value.length > USERNAME_MAX_LENGTH) {
    return { ok: false, value, error: `Usernames must be at most ${USERNAME_MAX_LENGTH} characters` };
  }
  if (!USERNAME_PATTERN.test(value)) {
    return {
      ok: false,
      value,
      error:
        'Usernames start with a letter and may contain letters, numbers, dots, underscores and hyphens',
    };
  }
  if (USERNAME_SEPARATOR_PATTERN.test(value)) {
    return {
      ok: false,
      value,
      error: 'Usernames cannot start or end with a dot, underscore or hyphen, or repeat one twice in a row',
    };
  }
  if (isReservedUsername(value)) {
    return { ok: false, value, error: 'That username is reserved. Please choose a different one.' };
  }
  return { ok: true, value };
}

/** Case-insensitive reserved-name test, including the deceptive-substring check. */
export function isReservedUsername(username: string): boolean {
  const lower = String(username ?? '').toLowerCase();
  if (RESERVED_USERNAMES.has(lower)) return true;
  // Separators are removed so "a-d-m-i-n" and "supp_ort" are caught as well.
  const compact = lower.replace(/[._-]/g, '');
  if (RESERVED_USERNAMES.has(compact)) return true;
  return RESERVED_SUBSTRINGS.some((substring) => compact.includes(substring));
}

/** Reads the operator-maintained reservation list (best effort: a missing table is not fatal). */
export async function listReservedUsernamesFromDb(db: Queryable): Promise<string[]> {
  try {
    const { rows } = await db.query<{ username: string }>('SELECT lower(username) AS username FROM reserved_usernames');
    return rows.map((row) => row.username);
  } catch {
    return [];
  }
}

/** Case-insensitive availability check against the database. */
export async function isUsernameTaken(db: Queryable, username: string, exceptUserId?: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(username) = lower($1) ${exceptUserId ? 'AND id <> $2' : ''} LIMIT 1`,
    exceptUserId ? [username, exceptUserId] : [username]
  );
  if (rows.length > 0) return true;
  // The table is authoritative; this catches a name reserved after deployment without a code change.
  const reserved = await listReservedUsernamesFromDb(db);
  return reserved.includes(username.toLowerCase());
}

/**
 * Deterministic derivative used at registration when a customer does not type a username, and for
 * backfilling legacy accounts: the email local-part with punctuation removed, made to satisfy the
 * format rules. Deliberately recognisable — support staff can guess it from the email address —
 * and the returned `available` flag is only a suggestion, never the uniqueness decision.
 */
export function deriveUsernameCandidate(email: string): string {
  const localPart = String(email ?? '').split('@')[0] ?? '';
  let base = localPart.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  if (base.length < USERNAME_MIN_LENGTH) base = 'customer';
  if (!/^[a-z]/.test(base)) base = `u${base}`;
  let candidate = base.slice(0, USERNAME_MAX_LENGTH);
  if (isReservedUsername(candidate) || candidate.length < USERNAME_MIN_LENGTH) {
    candidate = `${candidate}customer`.slice(0, USERNAME_MAX_LENGTH);
  }
  return candidate;
}

/**
 * Suggests up to `count` available usernames for `raw`. Best effort: the caller still lets the
 * database decide, but a customer who picks a taken name gets actionable alternatives instead of
 * a dead end.
 */
export async function suggestUsernames(db: Queryable, raw: string, count = 3): Promise<string[]> {
  const base = deriveUsernameCandidate(raw.includes('@') ? raw : `${raw}@example.invalid`);
  const suggestions: string[] = [];
  for (let suffix = 0; suffix < count * 3 && suggestions.length < count; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}${suffix}`;
    if (candidate.length > USERNAME_MAX_LENGTH) continue;
    if (validateUsernameFormat(candidate).ok && !(await isUsernameTaken(db, candidate))) {
      suggestions.push(candidate);
    }
  }
  return suggestions;
}

/** Persists a new username. Uniqueness failures surface as a unique violation (SQLSTATE 23505). */
export async function updateUsername(db: Queryable, userId: string, username: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE users
        SET username = $2, username_changed_at = now(), updated_at = now()
      WHERE id = $1
      RETURNING id`,
    [userId, username]
  );
  return rows.length > 0;
}
