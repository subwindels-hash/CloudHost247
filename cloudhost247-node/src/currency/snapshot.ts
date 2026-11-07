/**
 * Immutable transaction currency / price snapshots.
 *
 * The project owner's rule: "Do not silently change the currency or amount of an existing order or
 * invoice." Every monetary row (cart item, order, invoice, payment, renewal, refund) carries one
 * of these. Once frozen, the currency and minor-unit amount cannot be recomputed from a later FX
 * rate, a different country, or a changed user preference.
 */
import { currencyDefinition } from './registry';

export interface TransactionMoney {
  /** ISO 4217 currency that will actually be charged. */
  readonly currency: string;
  /** Exact minor-unit amount as a decimal string (BigInt-safe). */
  readonly amountMinor: string;
  /** Canonical catalogue price this was derived from (auditability). */
  readonly pricingId: string;
  /** Currency the canonical price was authored in. */
  readonly canonicalCurrency: string;
  /** Exact canonical minor-unit amount. */
  readonly canonicalAmountMinor: string;
  /** FX provenance; null when the charge currency IS the canonical currency. */
  readonly fx: null | {
    readonly rate: string;
    readonly source: string;
    readonly observedAt: string;
    readonly snapshotId: string;
    readonly roundingRule: 'HALF_UP';
  };
  /** ISO timestamp when the price was frozen. */
  readonly frozenAt: string;
  /** Monotonic schema version, so a future format change never rewrites historical rows. */
  readonly schemaVersion: 1;
}

export class CurrencyMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyMutationError';
  }
}

export interface FreezeInput {
  currency: string;
  amountMinor: string | bigint;
  pricingId: string;
  canonicalCurrency: string;
  canonicalAmountMinor: string | bigint;
  fx?: null | {
    rate: string;
    source: string;
    observedAt: string;
    snapshotId: string;
  };
  frozenAt?: string;
}

/** Freeze a price. Throws rather than normalising a bad value silently. */
export function freezeTransactionMoney(input: FreezeInput): Readonly<TransactionMoney> {
  const currency = input.currency.toUpperCase();
  const canonicalCurrency = input.canonicalCurrency.toUpperCase();
  currencyDefinition(currency);
  currencyDefinition(canonicalCurrency);
  const amountMinor = BigInt(input.amountMinor);
  const canonicalAmountMinor = BigInt(input.canonicalAmountMinor);
  if (amountMinor < 0n || canonicalAmountMinor < 0n) throw new CurrencyMutationError('Amounts must be non-negative');
  if (currency !== canonicalCurrency && !input.fx) throw new CurrencyMutationError('A converted price must record FX provenance');
  if (currency === canonicalCurrency && input.fx) throw new CurrencyMutationError('A canonical price must not record an FX conversion');
  const frozenAt = input.frozenAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(frozenAt))) throw new CurrencyMutationError('Invalid frozenAt timestamp');
  return Object.freeze({
    currency,
    amountMinor: amountMinor.toString(),
    pricingId: input.pricingId,
    canonicalCurrency,
    canonicalAmountMinor: canonicalAmountMinor.toString(),
    fx: input.fx ? Object.freeze({ ...input.fx, roundingRule: 'HALF_UP' as const }) : null,
    frozenAt,
    schemaVersion: 1 as const,
  });
}

/**
 * Guard used before ANY update to an order, invoice, payment, renewal or refund. A change of
 * currency or charged amount must be an explicit, separately audited operation — never a side
 * effect of a country/currency preference change or a new FX feed.
 */
export function assertTransactionMoneyUnchanged(
  existing: TransactionMoney,
  candidate: Pick<TransactionMoney, 'currency' | 'amountMinor'>
): void {
  if (existing.currency !== candidate.currency.toUpperCase()) {
    throw new CurrencyMutationError(`Cannot change currency of a frozen transaction (${existing.currency} -> ${candidate.currency})`);
  }
  if (existing.amountMinor !== BigInt(candidate.amountMinor).toString()) {
    throw new CurrencyMutationError(`Cannot change the amount of a frozen transaction (${existing.amountMinor} -> ${candidate.amountMinor})`);
  }
}

/**
 * Refunds are issued in the ORIGINAL currency and NEVER re-converted. A partial refund is a subset
 * of the original minor-unit amount, checked against the frozen value.
 */
export function refundMoney(original: TransactionMoney, partialMinor?: string | bigint): Readonly<TransactionMoney> {
  const originalMinor = BigInt(original.amountMinor);
  const requested = partialMinor === undefined ? originalMinor : BigInt(partialMinor);
  if (requested <= 0n || requested > originalMinor) throw new CurrencyMutationError('Refund amount is out of range');
  return Object.freeze({
    ...original,
    amountMinor: requested.toString(),
    frozenAt: new Date().toISOString(),
  });
}

/** Human-readable, stable representation for invoices and receipts (never a converted estimate). */
export function transactionMoneyLabel(money: TransactionMoney, locale = 'en'): string {
  // Dynamic import avoided here to keep this module pure; formatting lives in money.ts.
  const def = currencyDefinition(money.currency);
  const divisor = 10n ** BigInt(def.minorUnits);
  const value = BigInt(money.amountMinor);
  const major = def.minorUnits === 0
    ? value.toString()
    : `${value / divisor}.${(value % divisor).toString().padStart(def.minorUnits, '0')}`;
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: def.code,
    minimumFractionDigits: def.minorUnits, maximumFractionDigits: def.minorUnits,
  }).format(Number(major));
}
