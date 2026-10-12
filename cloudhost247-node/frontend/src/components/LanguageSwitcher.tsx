import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLocale } from '../i18n/LocaleProvider';
import { LOCALES } from '../i18n/locales';
import '../i18n/language-switcher.css';

/**
 * Language switcher, used in the global header menu bar (desktop and the mobile drawer).
 *
 * It is a disclosure: a button with `aria-expanded` that reveals a list of buttons. Keyboard users
 * open it with Enter or Space, move through the options with the arrow keys (Home and End jump to
 * the ends), and close it with Escape, which returns focus to the trigger. A pointer press outside
 * the control, or focus leaving it, also closes it.
 *
 * Choosing a language keeps the visitor on the same page. Routes are not locale-prefixed, so the
 * path, query and hash are untouched: this is the "equivalent page" in the current site structure.
 */
export default function LanguageSwitcher() {
  const { locale, t, setLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

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
    setLocale(code);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const options = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    if (options.length === 0) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % options.length;
    if (event.key === 'ArrowUp') next = current <= 0 ? options.length - 1 : current - 1;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next !== null) {
      event.preventDefault();
      options[next]?.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      className="ch247-locale"
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
        aria-label={`${t('language.switcher.label')}: ${locale.nativeName}`}
        onClick={() => setOpen((current) => !current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
        <span lang={locale.code}>{locale.nativeName}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div id={listId} className="ch247-locale__menu">
          <ul ref={listRef} className="ch247-locale__list" aria-label={t('language.switcher.listLabel')} onKeyDown={onListKeyDown}>
            {LOCALES.map((option) => {
              const current = option.code === locale.code;
              return (
                <li key={option.code}>
                  <button
                    type="button"
                    className="ch247-locale__option"
                    lang={option.code}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => choose(option.code)}
                  >
                    <span>{option.nativeName}</span>
                    {option.englishName !== option.nativeName ? (
                      <span className="ch247-locale__english">{option.englishName}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="ch247-locale__count">{t.plural('language.switcher.count', LOCALES.length)}</p>
          <p className="ch247-locale__note">{t('language.switcher.note')}</p>
        </div>
      ) : null}
    </div>
  );
}
