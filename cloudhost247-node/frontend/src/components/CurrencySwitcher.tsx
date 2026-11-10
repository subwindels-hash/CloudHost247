import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useCurrency } from '../currency/CurrencyProvider';
import { useLocale } from '../i18n/LocaleProvider';
import '../i18n/language-switcher.css';

// These are examples, not exchange rates or a list of billable currencies. A code remains
// disabled until the server publishes a current, validated rate for it.
//
// The first eleven are the billing registry's currencies (src/currency/registry.ts) in its own
// order after the USD base, rather than one market's currency promoted to the top of the menu;
// the rest are further examples in no particular ranking.
const COMMON_CURRENCIES = [
  'GBP', 'EUR', 'NGN', 'CAD', 'AUD', 'GHS', 'KES', 'ZAR', 'INR', 'JPY', 'KRW',
  'AED', 'SAR', 'EGP', 'MAD', 'TZS', 'UGX', 'RWF', 'XOF', 'XAF', 'CNY', 'HKD',
  'SGD', 'MYR', 'IDR', 'PHP', 'PKR', 'BDT', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK',
  'PLN', 'TRY', 'MXN', 'BRL', 'ARS', 'CLP', 'COP',
] as const;

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Display-currency switcher, used in the header menu bar (desktop and the mobile drawer), the
 * catalogue and the cart. It is independent of the language switcher: each control changes only its
 * own setting.
 *
 * It is a disclosure with the same keyboard model as LanguageSwitcher: Enter or Space opens it, the
 * arrow keys move between options, Home and End jump to the ends, and Escape closes it and returns
 * focus to the trigger. The billing note remains available to assistive technology.
 */
export default function CurrencySwitcher() {
  const { t, locale } = useLocale();
  const { currency, options, setCurrency } = useCurrency();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const noteId = useId();

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function choose(code: string) {
    setCurrency(code);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = current <= 0 ? items.length - 1 : current - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next !== null) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  const displayName = currencyName(currency, locale.code);
  const visibleCurrencies = [...options, ...COMMON_CURRENCIES.filter((code) => !options.includes(code))];

  return (
    <div
      ref={rootRef}
      className="ch247-locale ch247-currency"
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ch247-locale__trigger"
        aria-expanded={open}
        aria-controls={listId}
        aria-describedby={open ? noteId : undefined}
        aria-label={`${t('currency.switcher.label')}: ${currency} ${displayName}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{currency}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div id={listId} className="ch247-locale__menu">
          <ul ref={listRef} className="ch247-locale__list" aria-label={t('currency.switcher.listLabel')} onKeyDown={onListKeyDown}>
            {visibleCurrencies.map((code) => {
              const selected = code === currency;
              const available = options.includes(code);
              return (
                <li key={code}>
                  <button
                    type="button"
                    className="ch247-locale__option"
                    aria-current={selected ? 'true' : undefined}
                    disabled={!available}
                    onClick={() => choose(code)}
                  >
                    <span>{code}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p id={noteId} className="ch247-currency__sr-note">{t('currency.switcher.note')}</p>
        </div>
      ) : null}
    </div>
  );
}
