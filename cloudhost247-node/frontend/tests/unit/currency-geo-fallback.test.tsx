// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CurrencySwitcher from '../../src/components/CurrencySwitcher';
import { CurrencyProvider } from '../../src/currency/CurrencyProvider';
import { CURRENCY_STORAGE_KEY, type DisplayCurrencyStatus } from '../../src/currency/display-currency';
import { LOCALE_STORAGE_KEY } from '../../src/i18n/locales';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';

/**
 * The geolocation hint is the third of four currency signals. The requirement is that a visitor's
 * address may *suggest* a display currency and may never *decide* one: an explicit choice and the
 * authenticated account's preference both outrank it, an unmapped or disabled currency falls back
 * to USD, and the suggested value is only ever a display currency — billing is untouched.
 *
 * Only the positive and negative paths of the ordering were untested; the switcher's own behaviour,
 * persistence, formatting and keyboard model are covered in `currency-switcher.test.tsx`.
 */
const FEED: DisplayCurrencyStatus = {
  base: 'USD',
  available: true,
  reason: null,
  asOf: '2026-10-12T06:00:00.000Z',
  fetchedAt: '2026-10-12T06:05:00.000Z',
  currencies: [
    { code: 'EUR', rate: 0.9231, observedAt: '2026-10-12T06:00:00.000Z' },
    { code: 'GBP', rate: 0.7844, observedAt: '2026-10-12T06:00:00.000Z' },
    { code: 'NGN', rate: 1540.5, observedAt: '2026-10-12T06:00:00.000Z' },
  ],
};

/**
 * Answers the two public endpoints the provider reads, by path. Anything else fails loudly so a
 * new request in this component cannot silently pass unnoticed.
 */
function mockPublicApi(country: string | null, feed: DisplayCurrencyStatus | 'fail' = FEED) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/v1/currency/rates')) {
      if (feed === 'fail') throw new TypeError('rate feed unavailable');
      return new Response(JSON.stringify(feed), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('/api/v1/currency/geo-country')) {
      return new Response(JSON.stringify({ country, note: 'advisory' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected request in this test: ${url}`);
  });
}

function renderProvider(props: { authenticatedPreference?: string } = {}) {
  return render(
    <MemoryRouter>
      <LocaleProvider initialLocale="en">
        <CurrencyProvider {...props}>
          <CurrencySwitcher />
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

describe('display currency: the geolocation hint is a suggestion, never a decision', () => {
  it('uses the country hint only when the visitor has expressed no preference', async () => {
    mockPublicApi('ng');
    renderProvider();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: NGN/ })).toBeTruthy()
    );
  });

  it('never overrides an explicit choice the visitor already made', async () => {
    mockPublicApi('ng');
    window.localStorage.setItem(CURRENCY_STORAGE_KEY, 'EUR');
    renderProvider();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: EUR/ })).toBeTruthy()
    );
    // And the hint is not even fetched once a choice exists: no request, no inference.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((call) => String(call[0]).includes('geo-country'))).toBe(false);
  });

  it('lets the authenticated account preference outrank the country hint', async () => {
    mockPublicApi('ng');
    renderProvider({ authenticatedPreference: 'GBP' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: GBP/ })).toBeTruthy()
    );
  });

  it('ignores a country whose currency is not offered by the platform', async () => {
    // Japan maps to JPY, which the feed does not publish, so the hint must be dropped rather than
    // shown as an unconvertible option.
    mockPublicApi('jp');
    renderProvider();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy()
    );
  });

  it('ignores an unknown or malformed country value', async () => {
    mockPublicApi('not-a-country');
    renderProvider();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy()
    );
  });

  it('keeps USD when the hint is unavailable', async () => {
    mockPublicApi(null);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy()
    );
  });

  it('still defaults to USD when the rate feed cannot be read', async () => {
    mockPublicApi('ng', 'fail');
    renderProvider();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy()
    );
  });

  it('reports a suggested currency as a display choice, and never as a billing change', async () => {
    mockPublicApi('ng');
    renderProvider();
    const trigger = await screen.findByRole('button', { name: /Display currency: NGN/ });
    // The control says "Display currency" — the underlying charge currency stays USD and the
    // switcher states that in text (covered in currency-switcher.test.tsx).
    expect(trigger.textContent ?? '').not.toMatch(/billing/i);
  });
});
