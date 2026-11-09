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

/**
 * A bare "unavailable" was indistinguishable from a broken request, so the widget could not tell a
 * visitor whether this deployment never switched detection on or their own connection failed. The
 * endpoint now names the reason; these pin that the widget reports the server's reason and never
 * invents one of its own.
 */
describe('visitor privacy indicator: why nothing was detected', () => {
  const cases = [
    ['disabled', 'IP: not enabled', /switched off on this server/i],
    ['unverified', 'IP: unverified', /could not be verified/i],
    ['not_public', 'IP: not public', /not a public one/i],
  ] as const;

  it.each(cases)('renders the server reason %s instead of a bare "unavailable"', async (reason, label, explanation) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ip: null, reason, privacyStatus: 'unknown' }), { status: 200 }));
    render(<VisitorPrivacy />);
    await screen.findByText(label);
    // The full reason is inside the live region for assistive tech, and a tooltip for pointer users.
    const ip = document.querySelector('.ch247-visitor-privacy__ip')!;
    expect(ip.textContent).toContain(label);
    expect(ip.textContent).toMatch(explanation);
    expect(ip.getAttribute('title')).toMatch(explanation);
    // Still no claim of protection either way.
    expect(screen.getByRole('region', { name: 'Privacy status' }).textContent).toContain('Privacy status cannot be verified');
  });

  it('falls back to "unavailable" when the request itself fails or the reason is not one it knows', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ip: null, reason: 'something-new', privacyStatus: 'unknown' }), { status: 200 }));
    const { unmount } = render(<VisitorPrivacy />);
    await screen.findByText('IP: unavailable');
    unmount();

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    render(<VisitorPrivacy />);
    await screen.findByText('IP: unavailable');
  });

  it('reports no reason at all once an address is detected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ip: '8.8.8.8', reason: 'detected' }), { status: 200 }));
    render(<VisitorPrivacy />);
    await screen.findByText('IP: 8.8.8.8');
    const ip = document.querySelector('.ch247-visitor-privacy__ip')!;
    expect(ip.querySelector('.sr-only')).toBeNull();
    expect(ip.getAttribute('title')).toMatch(/as this server observed it/i);
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
