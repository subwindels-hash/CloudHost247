// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TldPriceRow from '../../src/components/domain/TldPriceRow';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';

/**
 * The tag row is a view over the registrar's catalogue: it must print the provider's own price and
 * never invent one. These tests pin both halves of that contract — a priced extension becomes a tag
 * linking to its own row on the extensions page, and an extension with no published registration
 * price is left out entirely rather than rendered with a guess.
 */
function stubExtensions(extensions: unknown[]) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const body = String(url).includes('/api/v1/domain-services/extensions') ? { extensions } : null;
    if (body === null) {
      return Promise.resolve({ ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({ error: 'NOT_FOUND' }), text: async () => '{"error":"NOT_FOUND"}' });
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const extension = (overrides: Record<string, unknown>) => ({
  id: `id-${String(overrides.extension)}`,
  extension: '.com',
  description: null,
  restrictions: null,
  registrationRequirements: null,
  isTrending: false,
  status: 'active',
  registrationPrice: '11.98',
  renewalPrice: '14.98',
  transferPrice: '11.98',
  currency: 'USD',
  premiumSupported: false,
  offeringStatus: 'enabled',
  providerName: 'Registrar',
  sourcedAt: '2026-11-08T00:00:00.000Z',
  ...overrides,
});

function renderRow() {
  return render(
    <MemoryRouter>
      <LocaleProvider>
        <TldPriceRow />
      </LocaleProvider>
    </MemoryRouter>
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('TldPriceRow', () => {
  it('renders one tag per priced extension, in popularity order, with the provider price', async () => {
    stubExtensions([
      extension({ extension: '.space', registrationPrice: '1.18' }),
      extension({ extension: '.com', registrationPrice: '11.98' }),
      extension({ extension: '.net', registrationPrice: '13.98' }),
    ]);
    const { container } = renderRow();

    await waitFor(() => expect(container.querySelectorAll('.tld-chip')).toHaveLength(3));
    const tags = [...container.querySelectorAll('.tld-chip')];
    expect(tags.map((tag) => tag.textContent)).toEqual(['.com$11.98', '.net$13.98', '.space$1.18']);
    expect(tags[2]?.getAttribute('href')).toBe('/domains/extensions?search=space');
    expect(screen.getByRole('link', { name: /View all/i }).getAttribute('href')).toBe('/domains/extensions');
  });

  it('omits extensions with no published registration price instead of guessing one', async () => {
    stubExtensions([
      extension({ extension: '.com', registrationPrice: null }),
      extension({ extension: '.org', registrationPrice: '12.48' }),
    ]);
    const { container } = renderRow();

    await waitFor(() => expect(container.querySelectorAll('.tld-chip')).toHaveLength(1));
    expect(container.querySelector('.tld-chip')?.textContent).toBe('.org$12.48');
  });

  it('keeps the View all link when the registrar is not connected and there is nothing to price', async () => {
    stubExtensions([]);
    const { container } = renderRow();

    await waitFor(() => expect(screen.getByRole('link', { name: /View all/i })).toBeTruthy());
    expect(container.querySelectorAll('.tld-chip')).toHaveLength(0);
    expect(screen.getByRole('navigation', { name: /Popular domain extensions/i })).toBeTruthy();
  });
});
