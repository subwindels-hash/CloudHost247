// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import VisitorPrivacy from '../../src/components/VisitorPrivacy';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('visitor privacy indicator', () => {
  it('shows the detected IPv4 and an honest unknown privacy status, once to assistive technology', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ip: '8.8.8.8', privacyStatus: 'unknown' }), { status: 200 }));
    render(<VisitorPrivacy />);
    await screen.findByText('IP: 8.8.8.8');
    const region = screen.getByRole('region', { name: 'Privacy status' });
    expect(region.textContent).toContain('Privacy status cannot be verified');
    expect(region.textContent).not.toMatch(/100%|protection is active/i);
    expect(region.querySelectorAll('[aria-hidden="true"] .ch247-privacy-ticker__message').length).toBe(0);
    expect(region.querySelectorAll('.ch247-privacy-ticker__message[aria-hidden="true"]')).toHaveLength(1);
  });
  it('updates an IPv6 address on reconnect and handles failures without displaying a fake IP', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(new Response(JSON.stringify({ ip: '2606:4700:4700::1111' }), { status: 200 }));
    render(<VisitorPrivacy />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(screen.getByText('IP: unavailable')).toBeTruthy();
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await screen.findByText('IP: 2606:4700:4700::1111');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
});

it('shows the detected country next to the IP without a country selector', async () => {
  const { LocaleProvider } = await import('../../src/i18n/LocaleProvider');
  const { CurrencyProvider } = await import('../../src/currency/CurrencyProvider');
  const { UNAVAILABLE_STATUS } = await import('../../src/currency/display-currency');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => new Response(JSON.stringify(
    String(input).includes('geo-country') ? { country: 'NG' } : { ip: '8.8.8.8' },
  ), { status: 200 }));
  const { container } = render(<LocaleProvider initialLocale="en"><CurrencyProvider initialStatus={UNAVAILABLE_STATUS}><VisitorPrivacy /></CurrencyProvider></LocaleProvider>);
  await screen.findByText('IP: 8.8.8.8');
  await screen.findByRole('status', { name: /Country or region: Nigeria/ });
  const location = container.querySelector('.ch247-visitor-privacy__location');
  expect(location?.textContent).toContain('IP: 8.8.8.8');
  expect(location?.querySelector('.ch247-country select')).toBeNull();
});
