// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CurrencySwitcher from '../../src/components/CurrencySwitcher';
import { CurrencyProvider } from '../../src/currency/CurrencyProvider';
import { CURRENCY_STORAGE_KEY, type DisplayCurrencyStatus } from '../../src/currency/display-currency';
import { LOCALE_STORAGE_KEY } from '../../src/i18n/locales';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';
import { ApproxAmount } from '../../src/components/ApproxAmount';

const LIVE: DisplayCurrencyStatus = {
  base: 'USD',
  available: true,
  reason: null,
  asOf: '2026-10-12T06:00:00.000Z',
  fetchedAt: '2026-10-12T06:05:00.000Z',
  currencies: [
    { code: 'EUR', rate: 0.9231, observedAt: '2026-10-12T06:00:00.000Z' },
    { code: 'GBP', rate: 0.7844, observedAt: '2026-10-12T06:00:00.000Z' },
  ],
};

function renderSwitcher(status?: DisplayCurrencyStatus, withPrice = false) {
  return render(
    <MemoryRouter>
      <LocaleProvider initialLocale="en">
        <CurrencyProvider initialStatus={status}>
          <CurrencySwitcher />
          {withPrice ? <ApproxAmount amount={10} currency="USD" /> : null}
        </CurrencyProvider>
      </LocaleProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CurrencySwitcher', () => {
  it('starts in USD, lists USD first, and offers only published currencies', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE);
    const trigger = screen.getByRole('button', { name: /Display currency: USD/ });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: 'Choose a display currency' });
    const options = within(list).getAllByRole('button').map((b) => b.textContent);
    expect(options[0]).toContain('USD');
    expect(options).toHaveLength(3);
    expect(options.join(' ')).toContain('EUR');
    expect(options.join(' ')).not.toContain('JPY');
  });

  it('persists the choice, reflects it in the trigger, and leaves the language unchanged', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE);
    await user.click(screen.getByRole('button', { name: /Display currency/ }));
    await user.click(screen.getByRole('button', { name: /EUR/ }));
    expect(window.localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe('EUR');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
    expect(screen.getByRole('button', { name: /Display currency: EUR/ })).toBeTruthy();
  });

  it('shows the converted estimate under a USD amount, and keeps the USD price authoritative', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE, true);
    expect(screen.queryByText(/About/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Display currency/ }));
    await user.click(screen.getByRole('button', { name: /EUR/ }));
    expect(screen.getByText(/About €9\.23\. Charged in USD\./)).toBeTruthy();
  });

  it('restores a stored choice on the next visit, and drops it when the rate is no longer offered', () => {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, 'GBP');
    renderSwitcher(LIVE, true);
    expect(screen.getByRole('button', { name: /Display currency: GBP/ })).toBeTruthy();
    cleanup();

    window.localStorage.setItem(CURRENCY_STORAGE_KEY, 'GBP');
    renderSwitcher({ ...LIVE, available: false, reason: 'stale', currencies: [] });
    expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy();
  });

  it('ignores a corrupted stored value and falls back to USD', () => {
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, '<img src=x>');
    renderSwitcher(LIVE);
    expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy();
  });

  it('explains, in text, when other currencies are unavailable', async () => {
    const user = userEvent.setup();
    renderSwitcher({ ...LIVE, available: false, reason: 'not_synced', currencies: [] });
    await user.click(screen.getByRole('button', { name: /Display currency/ }));
    expect(screen.getByText('Other currencies are unavailable right now. Prices are shown in USD.')).toBeTruthy();
  });

  it('states that charges are in USD and that converted amounts are estimates', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE);
    await user.click(screen.getByRole('button', { name: /Display currency/ }));
    expect(screen.getByText(/You are charged in USD\. Converted amounts are estimates/)).toBeTruthy();
  });

  it('is fully keyboard operable: Enter opens, arrows move, Escape closes and returns focus', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE);
    const trigger = screen.getByRole('button', { name: /Display currency/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const options = within(screen.getByRole('list', { name: 'Choose a display currency' })).getAllByRole('button');
    options[0]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(options[1]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(options[options.length - 1]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(options[0]);

    await user.keyboard('{Escape}');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('exposes the current selection with aria-current and links the note only while open', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE);
    const trigger = screen.getByRole('button', { name: /Display currency/ });
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    await user.click(trigger);
    expect(trigger.hasAttribute('aria-describedby')).toBe(true);
    const usd = within(screen.getByRole('list')).getAllByRole('button')[0];
    expect(usd.getAttribute('aria-current')).toBe('true');
  });

  it('closes on an outside pointer press', async () => {
    const user = userEvent.setup();
    renderSwitcher(LIVE);
    const trigger = screen.getByRole('button', { name: /Display currency/ });
    await user.click(trigger);
    await user.click(document.body);
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'));
  });
});

describe('CurrencyProvider rate loading', () => {
  it('falls back to USD only when the rate feed cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, 'EUR');
    render(
      <MemoryRouter>
        <LocaleProvider initialLocale="en">
          <CurrencyProvider>
            <CurrencySwitcher />
          </CurrencyProvider>
        </LocaleProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy());
  });

  it('accepts a well-formed feed and drops malformed entries', async () => {
    // The provider reads two endpoints (rates and the IP-country hint), so each request needs its own
    // response body — a real network call does, and a shared Response can only be read once.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          ...LIVE,
          currencies: [...LIVE.currencies, { code: 'bad', rate: 2, observedAt: '' }, { code: 'CHF', rate: -1, observedAt: '' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, 'EUR');
    render(
      <MemoryRouter>
        <LocaleProvider initialLocale="en">
          <CurrencyProvider>
            <CurrencySwitcher />
          </CurrencyProvider>
        </LocaleProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Display currency: EUR/ })).toBeTruthy());
  });

  it('treats a non-JSON or unexpected payload as unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, 'EUR');
    render(
      <MemoryRouter>
        <LocaleProvider initialLocale="en">
          <CurrencyProvider>
            <CurrencySwitcher />
          </CurrencyProvider>
        </LocaleProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy());
  });
});
