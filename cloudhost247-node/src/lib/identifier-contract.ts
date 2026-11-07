import { z } from 'zod';

/**
 * Canonical identifier contract for CloudHost247.
 *
 * Background (P0, 2026-11-07)
 * ---------------------------
 * Every identifier column in this platform is PostgreSQL `uuid`. PostgreSQL accepts any 32 hex
 * digits in canonical 8-4-4-4-12 form; it does NOT require an RFC 4122/9562 version or variant.
 *
 * The catalogue rows seeded by migrations 0027 (roles), 0041 (operating systems, OS versions,
 * control panels), 0043 (control panels/plans) and 0066 (nil UUID default) are deliberately
 * deterministic, human-readable well-known identifiers such as
 *   '20000000-0000-0000-0000-000000000006'  (Ubuntu 24.04 LTS)
 *   '30000000-0000-0000-0000-000000000001'  (cPanel & WHM)
 * Their version nibble is 0 and their variant nibble is 0. They are valid `uuid` values and are
 * referenced by foreign keys throughout the schema.
 *
 * zod 4 changed `z.string().uuid()` / `z.uuid()` from "UUID-shaped" to "RFC 4122 versioned UUID".
 * Using it on a request field that carries a seeded catalogue id therefore rejects perfectly
 * valid database rows with HTTP 400 before any handler runs. That was the VPS OS-image defect:
 * `POST /api/v1/servers` and `POST /api/v1/servers/:id/reinstall` rejected EVERY seeded OS image.
 *
 * The contract
 * ------------
 *  - `dbUuidSchema` is the ONE validator for identifiers that come from, or reference, the
 *    database. It enforces the strict canonical UUID *shape* (and nothing looser): it rejects
 *    arbitrary strings, wrong lengths, non-hex characters, braces, URNs and whitespace. It simply
 *    does not impose a version/variant requirement that the database itself does not impose.
 *  - It also accepts identifiers generated at runtime with `randomUUID()` (RFC 4122 v4), so it is
 *    safe on mixed endpoints that accept both seeded and generated ids.
 *  - Values are normalised to lowercase so lookups against lowercase seed rows are deterministic.
 *  - This is NOT a weakening to `z.string()`: `z.guid()` is zod's strict GUID/UUID-shape
 *    validator. We deliberately did not relax input validation to hide the defect, and we did not
 *    edit test fixtures. The DB seed data stays untouched and the quarantined migrations stay
 *    quarantined.
 *
 * Do not use `z.string().uuid()` for catalogue ids. Use `catalogIdSchema` (an alias of
 * `dbUuidSchema`) so the intent is explicit at the call site.
 */

/** Strict canonical UUID shape, matching PostgreSQL's `uuid` input domain. */
export const DB_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Base validator: strict shape, version-agnostic, lowercased. */
export const dbUuidSchema = z
  .guid({ error: 'must be a canonical UUID' })
  .transform((value) => value.toLowerCase());

/** Alias for fields carrying a deterministic catalogue identifier (OS, panel, plan, role, ...). */
export const catalogIdSchema = dbUuidSchema;

/** Non-schema helper for scripts, seeds and diagnostics. */
export function isCanonicalDbUuid(value: unknown): value is string {
  return typeof value === 'string' && DB_UUID_PATTERN.test(value);
}

/**
 * Assert that a value is a canonical DB UUID and return it lowercased.
 * Throws rather than silently coercing — used by seed/audit code, not by HTTP handlers.
 */
export function requireDbUuid(value: unknown, label = 'identifier'): string {
  if (!isCanonicalDbUuid(value)) throw new Error(`${label} is not a canonical UUID: ${String(value)}`);
  return (value as string).toLowerCase();
}
