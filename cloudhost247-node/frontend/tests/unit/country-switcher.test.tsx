// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import CountrySwitcher from '../../src/components/CountrySwitcher';
import CurrencySwitcher from '../../src/components/CurrencySwitcher';
import { browserCountry, COUNTRY_STORAGE_KEY, CurrencyProvider } from '../../src/currency/CurrencyProvider';
import { CURRENCY_STORAGE_KEY, type DisplayCurrencyStatus } from '../../src/currency/display-currency';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';
import { compareWithEnglish } from '../../src/i18n/catalogue';
import { hi } from '../../src/i18n/messages/drafts/hi';
import { sw } from '../../src/i18n/messages/drafts/sw';

const feed: DisplayCurrencyStatus = { base: 'USD', available: true, reason: null, asOf: null, fetchedAt: null,
  currencies: ['NGN', 'INR', 'JPY', 'CNY'].map(code => ({ code, rate: 2, observedAt: '2026-01-01T00:00:00Z' })) };
function setup() {
  return render(<LocaleProvider initialLocale="en"><CurrencyProvider initialStatus={feed}><CountrySwitcher /><CurrencySwitcher /></CurrencyProvider></LocaleProvider>);
}
beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('country selection', () => {
  it('uses only valid browser region subtags as advisory hints', () => {
    expect(browserCountry(['en', 'en-NG'])).toBe('NG');
    expect(browserCountry(['not a locale', 'en'])).toBeNull();
    expect(browserCountry(['en-XX'])).toBeNull();
  });
  it('persists the selected country and suggests a currency with a valid rate', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Country or region'), { target: { value: 'IN' } });
    expect(localStorage.getItem(COUNTRY_STORAGE_KEY)).toBe('IN');
    expect(screen.getByRole('button', { name: /Display currency: INR/ })).toBeTruthy();
  });
  it('honours a manually selected currency over the country suggestion', () => {
    localStorage.setItem(CURRENCY_STORAGE_KEY, 'JPY');
    setup();
    fireEvent.change(screen.getByLabelText('Country or region'), { target: { value: 'NG' } });
    expect(screen.getByRole('button', { name: /Display currency: JPY/ })).toBeTruthy();
    expect(localStorage.getItem(CURRENCY_STORAGE_KEY)).toBe('JPY');
  });
  it('falls back to USD when the suggested currency has no rate', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Country or region'), { target: { value: 'GB' } });
    expect(screen.getByRole('button', { name: /Display currency: USD/ })).toBeTruthy();
  });
  it('keeps draft languages complete but not yet published', () => {
    expect(compareWithEnglish(hi)).toEqual({ missing: [], extra: [] });
    expect(compareWithEnglish(sw)).toEqual({ missing: [], extra: [] });
  });
});

it('suggests a reviewed country language, and never overwrites a manual language', () => {
  const { unmount } = render(<LocaleProvider><CurrencyProvider initialStatus={feed}><CountrySwitcher /></CurrencyProvider></LocaleProvider>);
  fireEvent.change(screen.getByLabelText('Country or region'), { target: { value: 'FR' } });
  expect(document.documentElement.lang).toBe('fr');
  unmount();
  localStorage.setItem('ch247.locale', 'de');
  render(<LocaleProvider><CurrencyProvider initialStatus={feed}><CountrySwitcher /></CurrencyProvider></LocaleProvider>);
  fireEvent.change(screen.getByLabelText('Country or region'), { target: { value: 'ES' } });
  expect(document.documentElement.lang).toBe('de');
});
