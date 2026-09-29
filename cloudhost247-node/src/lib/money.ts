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
 *
 * ---------------------------------------------------------------------------------------------
 * INVARIANT: every monetary value in this platform is a NON-NEGATIVE MAGNITUDE.
 * ---------------------------------------------------------------------------------------------
 * Direction/sign is never encoded in the number itself — it is carried by the column or row that
 * holds it:
 *   - `billing_ledger.entry_type` ('charge' | 'payment' | 'refund' | 'credit') says which way the
 *     money moved; the schema enforces `CHECK (amount > 0)` (0019_create_billing_ledger.sql).
 *   - `orders.discount_amount` is a positive amount that is *subtracted*; the column is
 *     `CHECK (discount_amount >= 0)` (0016_create_orders.sql).
 *   - `plan_pricing.amount`, `orders.*_amount`, `order_items.*_amount`, `invoices.*`, `payments.amount`
 *     all carry `>= 0` (or `> 0`) CHECK constraints in their migrations.
 *
 * These helpers therefore REJECT negative input rather than propagating it. This is a deliberate
 * defence-in-depth choice made after an independent review observed that the primitives accepted
 * negatives even though every storage path rejected them: a negative value reaching this module at
 * all means an upstream invariant has already been broken, and the correct response to a broken
 * financial invariant is to fail loudly, not to compute a plausible-looking wrong answer. If a
 * future phase genuinely needs signed arithmetic (e.g. a running account balance that can go
 * negative), it must introduce an explicit, separately-named signed helper and document why —
 * it must not relax these guards.
 */

/** Largest magnitude this module will handle, in cents. `numeric(12,2)` tops out at
 * 9,999,999,999.99 — i.e. 999,999,999,999 cents — which is comfortably inside
 * `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991), so integer-cent arithmetic stays exact.
 * Anything larger cannot be stored anyway and is rejected here rather than being silently
 * truncated by the database. */
const MAX_CENTS = 999_999_999_999;

function assertSafeCents(cents: number, context: string): void {
  if (!Number.isInteger(cents)) {
    throw new Error(`${context}: expected a whole number of cents, got: ${cents}`);
  }
  if (cents < 0) {
    throw new Error(
      `${context}: monetary amounts must be non-negative magnitudes (got ${cents} cents). ` +
        `Direction is carried by the column/entry_type, never by a negative number.`
    );
  }
  if (cents > MAX_CENTS) {
    throw new Error(`${context}: amount exceeds the maximum storable value (${cents} > ${MAX_CENTS} cents)`);
  }
}

/** Parses a decimal monetary string (e.g. "19.99") into an exact integer number of cents (1999).
 * Throws on anything that isn't a finite, non-negative, in-range monetary value — a malformed or
 * negative amount must never silently become `NaN`/`0`/a negative total and continue through a
 * financial calculation. */
export function toCents(amount: string | number): number {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid monetary amount: ${JSON.stringify(amount)}`);
  }
  // An empty/whitespace string coerces to 0 via Number(), which would silently turn a missing
  // price into a free item. Reject it explicitly rather than treating it as zero.
  if (typeof amount === 'string' && amount.trim() === '') {
    throw new Error('Invalid monetary amount: empty string');
  }
  // Round at the cent boundary explicitly (rather than trusting the input already has <= 2
  // decimal places) so an unexpected extra-precision input can never silently propagate.
  // `Math.round` is half-up and fully deterministic for the non-negative domain this module
  // accepts (the half-to-even / half-away-from-zero ambiguity only arises for negatives, which
  // are rejected above).
  const cents = Math.round(n * 100);
  assertSafeCents(cents, 'toCents');
  return cents;
}

/** Formats an exact integer number of cents back into the fixed 2-decimal-place string every
 * monetary database column expects (e.g. 1999 -> "19.99"). */
export function fromCents(cents: number): string {
  assertSafeCents(cents, 'fromCents');
  return (cents / 100).toFixed(2);
}

export function multiplyCents(unitCents: number, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`Invalid quantity for a monetary calculation: ${quantity}`);
  }
  assertSafeCents(unitCents, 'multiplyCents');
  const total = unitCents * quantity;
  assertSafeCents(total, 'multiplyCents result');
  return total;
}

export function sumCents(values: number[]): number {
  const total = values.reduce((runningTotal, value) => {
    assertSafeCents(value, 'sumCents element');
    return runningTotal + value;
  }, 0);
  assertSafeCents(total, 'sumCents result');
  return total;
}
