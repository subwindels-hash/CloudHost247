/**
 * Postgres drivers differ in how they surface `date` columns: node-pg and PGlite return JS Date
 * objects, while ::text casts return strings. Every Revenue Guardian consumer normalizes through
 * this helper so date handling is identical in production and in the embedded-Postgres tests.
 */
export function toIsoDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') return value.slice(0, 10);
  throw new Error(`Expected a date value, got ${typeof value}`);
}
