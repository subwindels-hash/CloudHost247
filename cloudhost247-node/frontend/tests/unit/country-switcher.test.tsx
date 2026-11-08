// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CountrySwitcher from '../../src/components/CountrySwitcher';
import { CurrencyProvider, useCurrency } from '../../src/currency/CurrencyProvider';
import { LocaleProvider, useLocale } from '../../src/i18n/LocaleProvider';

function Status() {
  const { currency } = useCurrency();
  const { locale } = useLocale();
  return <output>{locale.code} {currency}</output>;
}
const rates = { base: 'USD', available: true, reason: null, asOf: '2026-10-12T06:00:00Z', fetchedAt: '2026-10-12T06:00:00Z', currencies: [
  { code: 'GBP', rate: 0.8, observedAt: '2026-10-12T06:00:00Z' },
  { code: 'EUR', rate: 0.9, observedAt: '2026-10-12T06:00:00Z' },
] };
let detected: string | null = 'GB';
function renderPicker() {
  return render(<LocaleProvider><CurrencyProvider><CountrySwitcher /><Status /></CurrencyProvider></LocaleProvider>);
}
beforeEach(() => {
  localStorage.clear();
  detected = 'GB';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    return new Response(JSON.stringify(url.includes('geo-country') ? { country: detected } : rates), { status: 200 });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('country indicator', () => {
  it('displays the real detected flag and UK abbreviation with its suggested currency', async () => {
    renderPicker();
    await waitFor(() => expect(document.querySelector('.ch247-country__flag')?.classList.contains('fi-gb')).toBe(true));
    await waitFor(() => expect(screen.getByText('en GBP')).toBeTruthy());
    expect((screen.getByLabelText('Country or region') as HTMLSelectElement).value).toBe('GB');
  });
  it('persists a manually chosen country and synchronizes language and available currency', async () => {
    const view = renderPicker();
    await waitFor(() => expect(document.querySelector('.ch247-country__flag')?.classList.contains('fi-gb')).toBe(true));
    fireEvent.change(screen.getByLabelText('Country or region'), { target: { value: 'FR' } });
    await waitFor(() => expect(document.querySelector('.ch247-country__flag')?.classList.contains('fi-fr')).toBe(true));
    await waitFor(() => expect(screen.getByText('fr EUR')).toBeTruthy());
    expect(localStorage.getItem('ch247.country')).toBe('FR');
    view.unmount();
    detected = 'US';
    renderPicker();
    await waitFor(() => expect(document.querySelector('.ch247-country__flag')?.classList.contains('fi-fr')).toBe(true));
    await waitFor(() => expect(screen.getByText('fr EUR')).toBeTruthy());
  });
  it('shows an honest selectable fallback if detection fails', async () => {
    detected = null;
    renderPicker();
    await screen.findByText(/Country unavailable/);
    expect((screen.getByLabelText('Country or region') as HTMLSelectElement).value).toBe('');
  });
});
