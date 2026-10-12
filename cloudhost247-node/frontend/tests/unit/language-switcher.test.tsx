// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import LanguageSwitcher from '../../src/components/LanguageSwitcher';
import { LOCALE_STORAGE_KEY } from '../../src/i18n/locales';
import { LocaleProvider, useLocale } from '../../src/i18n/LocaleProvider';

/** Shows the router location so tests can prove the visitor stayed on the same page. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

/** Calls setLocale directly, the way a future caller would, to test invalid input. */
function SetLocaleProbe({ code }: { code: string }) {
  const { setLocale, locale } = useLocale();
  return (
    <>
      <button type="button" onClick={() => setLocale(code)}>
        try {code}
      </button>
      <output data-testid="active">{locale.code}</output>
    </>
  );
}

function renderSwitcher(initialEntry = '/pricing?plan=vps#compare', initialLocale?: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LocaleProvider initialLocale={initialLocale}>
        <LanguageSwitcher />
        <LocationProbe />
      </LocaleProvider>
    </MemoryRouter>,
  );
}

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('is a disclosure button named after the control and the current language', () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'Language: English' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Choose a language' })).toBeNull();
  });

  it('opens the list, marks the current language, and reports how many are available', async () => {
    renderSwitcher();
    await userEvent.click(screen.getByRole('button', { name: 'Language: English' }));

    expect(screen.getByRole('button', { name: 'Language: English' }).getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Choose a language' });
    const current = within(list).getByRole('button', { name: /English/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(screen.getByText('13 languages available')).toBeTruthy();
  });

  it('opens from the keyboard with Enter, and closes with Escape returning focus to the trigger', async () => {
    renderSwitcher();
    const trigger = screen.getByRole('button', { name: 'Language: English' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Choose a language' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when a pointer press lands outside the control', async () => {
    renderSwitcher();
    await userEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    expect(screen.getByRole('list', { name: 'Choose a language' })).toBeTruthy();

    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Choose a language' })).toBeNull());
  });

  it('moves between options with the arrow keys, wrapping at both ends', async () => {
    renderSwitcher();
    await userEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    const options = within(screen.getByRole('list', { name: 'Choose a language' })).getAllByRole('button');

    options[0]?.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(options[1]);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(options[0]);
    await userEvent.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(options[options.length - 1]);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(options[0]);
  });

  it('keeps the visitor on the same page when a language is chosen, and remembers the choice', async () => {
    renderSwitcher('/pricing?plan=vps#compare');
    await userEvent.click(screen.getByRole('button', { name: 'Language: English' }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Choose a language' })).getByRole('button', { name: /English/ }));

    expect(screen.getByTestId('location').textContent).toBe('/pricing?plan=vps#compare');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(screen.queryByRole('list', { name: 'Choose a language' })).toBeNull();
  });

  it('ignores a stored choice that is not a listed language and uses the default', () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'sv');
    renderSwitcher();
    expect(screen.getByRole('button', { name: 'Language: English' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('refuses an unsupported language code at the provider, changing nothing', async () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    render(
      <MemoryRouter>
        <LocaleProvider>
          <SetLocaleProbe code="xx-INVALID" />
        </LocaleProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'try xx-INVALID' }));
    expect(screen.getByTestId('active').textContent).toBe('en');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('does not write storage when an invalid code is refused', async () => {
    render(
      <MemoryRouter>
        <LocaleProvider>
          <SetLocaleProbe code="<img src=x>" />
        </LocaleProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'try <img src=x>' }));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('keeps working when storage is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    try {
      expect(() => renderSwitcher()).not.toThrow();
      expect(screen.getByRole('button', { name: 'Language: English' })).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });

  it('has touch targets of at least 44px and a small-screen layout rule', () => {
    // Tests run from the application root (npm test), so the path is resolved from there.
    const css = readFileSync(resolve(process.cwd(), 'frontend/src/i18n/language-switcher.css'), 'utf8');
    expect(css).toMatch(/\.ch247-locale__trigger\s*{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/\.ch247-locale__option\s*{[^}]*min-height:\s*44px/s);
    expect(css).toMatch(/@media \(max-width: 720px\)/);
    expect(css).toMatch(/:focus-visible/);
  });
});
