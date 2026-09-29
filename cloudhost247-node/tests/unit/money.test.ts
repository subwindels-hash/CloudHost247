import { describe, expect, it } from 'vitest';
import { fromCents, multiplyCents, sumCents, toCents } from '../../src/lib/money';

/**
 * These tests pin the invariant documented at the top of src/lib/money.ts:
 *
 *   Every monetary value in this platform is a NON-NEGATIVE MAGNITUDE. Direction is carried by
 *   the column or row that holds it (billing_ledger.entry_type, orders.discount_amount being
 *   subtracted, and so on) — never by the sign of the number.
 *
 * An independent review observed that these primitives previously accepted negative input and
 * relied entirely on upstream guards + database CHECK constraints to catch it. That is a thin
 * defence: a negative value arriving here means an upstream invariant is already broken, and the
 * correct response to a broken financial invariant is to fail loudly rather than to compute a
 * plausible-looking wrong total. The rejection now happens at the primitive boundary, so it holds
 * for every present and future caller regardless of which route or service is involved.
 */
describe('money primitives', () => {
  describe('exactness (the reason this module exists)', () => {
    it('adds amounts that binary floating point gets wrong', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in IEEE-754 doubles.
      expect(fromCents(sumCents([toCents('0.10'), toCents('0.20')]))).toBe('0.30');
      // A classic repeating-fraction case: 3 x 19.99 must be exactly 59.97.
      expect(fromCents(multiplyCents(toCents('19.99'), 3))).toBe('59.97');
    });

    it('round-trips numeric strings exactly as the database returns them', () => {
      for (const amount of ['0.00', '0.01', '9.99', '19.99', '100.00', '1234.56', '9999999999.99']) {
        expect(fromCents(toCents(amount))).toBe(amount);
      }
    });

    it('accepts zero, which is a legitimate amount (discount_amount, tax_amount default to 0.00)', () => {
      expect(toCents('0.00')).toBe(0);
      expect(fromCents(0)).toBe('0.00');
      expect(sumCents([])).toBe(0);
    });
  });

  describe('INVARIANT: negative amounts are rejected at the primitive boundary', () => {
    it('toCents rejects a negative string amount', () => {
      expect(() => toCents('-1.00')).toThrow(/non-negative magnitude/);
    });

    it('toCents rejects a negative number amount', () => {
      expect(() => toCents(-0.01)).toThrow(/non-negative magnitude/);
    });

    it('fromCents refuses to format a negative cent value back into a storable string', () => {
      // Without this guard fromCents(-500) would happily return "-5.00", which would then be
      // handed to Postgres and only be caught by a CHECK constraint — as an unhandled 500.
      expect(() => fromCents(-500)).toThrow(/non-negative magnitude/);
    });

    it('multiplyCents rejects a negative unit price', () => {
      expect(() => multiplyCents(-100, 2)).toThrow(/non-negative magnitude/);
    });

    it('sumCents rejects a negative element rather than letting it cancel out a positive one', () => {
      // This is the dangerous case the guard exists for: a -50.00 line silently reducing an
      // order subtotal would look entirely plausible in the response body.
      expect(() => sumCents([toCents('50.00'), -5000])).toThrow(/non-negative magnitude/);
    });

    it('the error explains where the sign belongs, so the invariant is discoverable from the failure', () => {
      expect(() => toCents('-1.00')).toThrow(/Direction is carried by the column\/entry_type/);
    });
  });

  describe('malformed input never degrades into a silent zero or NaN', () => {
    it('rejects a non-numeric string instead of producing NaN', () => {
      expect(() => toCents('abc')).toThrow(/Invalid monetary amount/);
      expect(() => toCents('19.99USD')).toThrow(/Invalid monetary amount/);
    });

    it('rejects an empty or whitespace-only string instead of treating it as free', () => {
      // Number('') === 0, so without an explicit guard a missing price would become 0.00.
      expect(() => toCents('')).toThrow(/empty string/);
      expect(() => toCents('   ')).toThrow(/empty string/);
    });

    it('rejects Infinity and NaN', () => {
      expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(/Invalid monetary amount/);
      expect(() => toCents(Number.NaN)).toThrow(/Invalid monetary amount/);
    });

    it('rejects a fractional cent value in fromCents rather than emitting a rounded string', () => {
      expect(() => fromCents(10.5)).toThrow(/whole number of cents/);
    });
  });

  describe('range and quantity guards', () => {
    it('rejects an amount larger than the numeric(12,2) columns can store', () => {
      // Postgres would otherwise raise "numeric field overflow" as an unhandled 500.
      expect(() => toCents('10000000000.00')).toThrow(/exceeds the maximum storable value/);
    });

    it('rejects a multiplication whose result would overflow the storable range', () => {
      expect(() => multiplyCents(toCents('9999999999.99'), 2)).toThrow(/exceeds the maximum storable value/);
    });

    it('rejects a non-positive or fractional quantity', () => {
      expect(() => multiplyCents(1999, 0)).toThrow(/Invalid quantity/);
      expect(() => multiplyCents(1999, -1)).toThrow(/Invalid quantity/);
      expect(() => multiplyCents(1999, 1.5)).toThrow(/Invalid quantity/);
    });
  });
});
