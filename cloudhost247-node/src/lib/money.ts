/**
 * Minimal fixed-point money helpers used everywhere a monetary amount is computed (Phase 5
 * commerce/billing). Postgres `numeric` columns come back from both `pg` and `@electric-sql/pglite`
 * as *strings*, specifically so a value like `19.99` is never silently corrupted by binary
 * floating-point (`0.1 + 0.2 !== 0.3` in JS). This module is the one place that briefly converts a
 * monetary string to a number — always as whole integer cents, never as a fractional float — so
 * every arithmetic step is exact, and the only thing that ever leaves this module or gets stored
 * back to the database is again a fixed 2-decimal-place string.
 *
 * Do not add/subtract/multiply monetary `string` amounts directly with JS `+`/`-`/`*` anywhere
 * else in the codebase — always go through `toCents`/`fromCents` here.
 */

/** Parses a decimal monetary string (e.g. "19.99") into an exact integer number of cents (1999).
 * Throws on anything that isn't a finite, sane monetary value — a malformed amount must never
 * silently become `NaN`/`0` and continue through a financial calculation. */
export function toCents(amount: string | number): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid monetary amount: ${JSON.stringify(amount)}`);
  }
  // Round at the cent boundary explicitly (rather than trusting the input already has <= 2
  // decimal places) so an unexpected extra-precision input can never silently propagate.
  return Math.round(n * 100);
}

/** Formats an exact integer number of cents back into the fixed 2-decimal-place string every
 * monetary database column expects (e.g. 1999 -> "19.99"). */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`fromCents expects a whole number of cents, got: ${cents}`);
  }
  return (cents / 100).toFixed(2);
}

export function multiplyCents(unitCents: number, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity for a monetary calculation: ${quantity}`);
  }
  return unitCents * quantity;
}

export function sumCents(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
