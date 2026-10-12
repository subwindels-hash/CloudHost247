import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { publicFetch } from '../lib/api';
import {
  BASE_CURRENCY,
  CURRENCY_STORAGE_KEY,
  UNAVAILABLE_STATUS,
  formatAmountInDisplayCurrency,
  isCurrencyCode,
  resolveDisplayCurrency,
  selectableCurrencies,
  type DisplayCurrencyStatus,
} from './display-currency';
import { useLocale } from '../i18n/LocaleProvider';

export type RatesState = 'loading' | 'ready' | 'unavailable';

export interface CurrencyContextValue {
  /** The currency amounts are shown in. Always the base currency unless a valid, current rate is chosen. */
  readonly currency: string;
  readonly options: readonly string[];
  readonly ratesState: RatesState;
  readonly status: DisplayCurrencyStatus;
  /** Chooses a display currency. Returns false, and changes nothing, for a code the site does not offer. */
  readonly setCurrency: (code: string) => boolean;
  /** Formats a base-currency (USD) amount for display. Non-USD sources are never converted. */
  readonly formatAmount: (amount: number, sourceCurrency?: string) => { text: string; converted: boolean; currency: string };
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

function readStored(): string | null {
  try {
    return window.localStorage.getItem(CURRENCY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(code: string): void {
  try {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, code);
  } catch {
    /* Storage can be disabled. The choice then lasts for this page view only. */
  }
}

/** Accepts only the server's documented shape. Anything else is treated as "no rates". */
function normalizeStatus(value: unknown): DisplayCurrencyStatus {
  if (!value || typeof value !== 'object') return UNAVAILABLE_STATUS;
  const raw = value as Partial<DisplayCurrencyStatus> & { currencies?: unknown };
  if (raw.base !== BASE_CURRENCY || raw.available !== true || !Array.isArray(raw.currencies)) {
    return { ...UNAVAILABLE_STATUS, reason: raw.reason === 'stale' ? 'stale' : 'not_synced', asOf: typeof raw.asOf === 'string' ? raw.asOf : null };
  }
  const currencies = raw.currencies.filter(
    (r): r is { code: string; rate: number; observedAt: string } =>
      !!r &&
      typeof r === 'object' &&
      isCurrencyCode((r as { code?: unknown }).code) &&
      typeof (r as { rate?: unknown }).rate === 'number' &&
      Number.isFinite((r as { rate: number }).rate) &&
      (r as { rate: number }).rate > 0 &&
      typeof (r as { observedAt?: unknown }).observedAt === 'string'
  );
  return {
    base: BASE_CURRENCY,
    available: currencies.length > 0,
    reason: currencies.length > 0 ? null : 'not_synced',
    asOf: typeof raw.asOf === 'string' ? raw.asOf : null,
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null,
    currencies,
  };
}

/**
 * Holds the display-currency choice and the current rate status. Independent of the language choice:
 * changing one never changes the other. The status is loaded once per page view; if the request fails,
 * the site keeps working in USD.
 */
export function CurrencyProvider({ children, initialStatus }: { children: ReactNode; initialStatus?: DisplayCurrencyStatus }) {
  const { locale } = useLocale();
  const [status, setStatus] = useState<DisplayCurrencyStatus>(initialStatus ?? UNAVAILABLE_STATUS);
  const [ratesState, setRatesState] = useState<RatesState>(initialStatus ? 'ready' : 'loading');
  const [requested, setRequested] = useState<string>(() => {
    const stored = readStored();
    return isCurrencyCode(stored) ? stored : BASE_CURRENCY;
  });

  useEffect(() => {
    if (initialStatus) return undefined;
    let cancelled = false;
    publicFetch<unknown>('/api/v1/currency/rates')
      .then((payload) => {
        if (cancelled) return;
        setStatus(normalizeStatus(payload));
        setRatesState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(UNAVAILABLE_STATUS);
        setRatesState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [initialStatus]);

  const currency = resolveDisplayCurrency(requested, status);
  const options = useMemo(() => selectableCurrencies(status), [status]);

  const setCurrency = useCallback(
    (code: string) => {
      if (!isCurrencyCode(code) || !selectableCurrencies(status).includes(code)) return false;
      writeStored(code);
      setRequested(code);
      return true;
    },
    [status]
  );

  const formatAmount = useCallback(
    (amount: number, sourceCurrency: string = BASE_CURRENCY) =>
      formatAmountInDisplayCurrency(amount, sourceCurrency, currency, status, locale.code),
    [currency, status, locale.code]
  );

  const value = useMemo<CurrencyContextValue>(
    () => ({ currency, options, ratesState, status, setCurrency, formatAmount }),
    [currency, options, ratesState, status, setCurrency, formatAmount]
  );
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

const FALLBACK: CurrencyContextValue = {
  currency: BASE_CURRENCY,
  options: [BASE_CURRENCY],
  ratesState: 'unavailable',
  status: UNAVAILABLE_STATUS,
  setCurrency: () => false,
  formatAmount: (amount, sourceCurrency = BASE_CURRENCY) => ({
    text: formatAmountInDisplayCurrency(amount, sourceCurrency, BASE_CURRENCY, UNAVAILABLE_STATUS, 'en-US').text,
    converted: false,
    currency: sourceCurrency,
  }),
};

/** Outside a provider (e.g. an isolated component test) the site behaves as USD-only. */
export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext) ?? FALLBACK;
}
