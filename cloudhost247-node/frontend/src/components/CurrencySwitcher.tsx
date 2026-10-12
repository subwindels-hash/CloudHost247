import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useCurrency } from '../currency/CurrencyProvider';
import { BASE_CURRENCY, formatRateTimestamp } from '../currency/display-currency';
import { useLocale } from '../i18n/LocaleProvider';
import '../i18n/language-switcher.css';

function currencyName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Display-currency switcher, used in the header (desktop and the mobile drawer), the footer, the
 * catalogue and the cart. It is independent of the language switcher: each control changes only its
 * own setting.
 *
 * It is a disclosure with the same keyboard model as LanguageSwitcher: Enter or Space opens it, the
 * arrow keys move between options, Home and End jump to the ends, and Escape closes it and returns
 * focus to the trigger. It states, in text, that charges are in USD and that converted amounts are
 * estimates, so the choice never implies a different price.
 */
export default function CurrencySwitcher() {
  const { t, locale } = useLocale();
  const { currency, options, setCurrency, status, ratesState } = useCurrency();
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
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
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

  const asOf = formatRateTimestamp(status.asOf, locale.code);
  const displayName = currencyName(currency, locale.code);

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
            {options.map((code) => {
              const selected = code === currency;
              return (
                <li key={code}>
                  <button
                    type="button"
                    className="ch247-locale__option"
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => choose(code)}
                  >
                    <span>{code}</span>
                    {code !== BASE_CURRENCY ? <span className="ch247-locale__english">{currencyName(code, locale.code)}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          {ratesState === 'unavailable' || options.length === 1 ? (
            <p className="ch247-locale__note">{t('currency.switcher.unavailable')}</p>
          ) : null}
          {asOf ? <p className="ch247-locale__count">{t('currency.switcher.asOf', { time: asOf })}</p> : null}
          <p id={noteId} className="ch247-locale__note">{t('currency.switcher.note')}</p>
        </div>
      ) : null}
    </div>
  );
}
