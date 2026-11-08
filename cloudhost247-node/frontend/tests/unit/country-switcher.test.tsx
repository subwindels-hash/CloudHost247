// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
function renderIndicator() {
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

describe('read-only country indicator', () => {
  it('displays the detected flag and UK abbreviation with its suggested currency, without a dropdown', async () => {
    const { container } = renderIndicator();
    await waitFor(() => expect(container.querySelector('.ch247-country__flag')?.classList.contains('fi-gb')).toBe(true));
    await waitFor(() => expect(screen.getByText('en GBP')).toBeTruthy());
    expect(screen.getByRole('status', { name: /Country or region: United Kingdom.*IP address/ })).toBeTruthy();
    expect(container.querySelector('.ch247-country select, .ch247-country button')).toBeNull();
  });
  it('ignores an old manually saved country and uses detection', async () => {
    localStorage.setItem('ch247.country', 'FR');
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-GB']);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    renderIndicator();
    await waitFor(() => expect(screen.getByRole('status', { name: /United Kingdom.*IP address/ })).toBeTruthy());
    await waitFor(() => expect(screen.getByText('en GBP')).toBeTruthy());
  });
  it('uses the browser region immediately when IP detection is unavailable', async () => {
    detected = null;
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    renderIndicator();
    expect(screen.getByRole('status', { name: /France.*browser settings/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('fr EUR')).toBeTruthy());
    expect(localStorage.getItem('ch247.country')).toBeNull();
  });
  it('prefers a verified IP country over the browser region', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    renderIndicator();
    await waitFor(() => expect(screen.getByRole('status', { name: /United Kingdom.*IP address/ })).toBeTruthy());
    await waitFor(() => expect(screen.getByText('en GBP')).toBeTruthy());
  });
  it('shows an honest fallback when neither signal has a country', async () => {
    detected = null;
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en');
    renderIndicator();
    expect(screen.getByRole('status', { name: /Country or region: unavailable/ })).toBeTruthy();
  });
});
