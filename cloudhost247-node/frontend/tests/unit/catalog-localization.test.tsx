// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider, useLocale } from '../../src/i18n/LocaleProvider';
import { useApiResource } from '../../src/lib/useApiResource';

function Page() {
  const { setLocale } = useLocale();
  const result = useApiResource<{ products: { name: string }[] }>('/api/v1/catalog/products?type=hosting');
  return <><button onClick={() => setLocale('fr')}>French</button><div>{result.status === 'success' ? result.data.products[0]?.name : 'Loading'}</div></>;
}
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
it('re-fetches catalog content when language changes without navigating', async () => {
  localStorage.clear();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const name = url.includes('lang=fr') ? 'Hébergement' : 'Hosting';
    return new Response(JSON.stringify({ products: [{ name }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  render(<LocaleProvider initialLocale="en"><Page /></LocaleProvider>);
  expect(await screen.findByText('Hosting')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'French' }));
  expect(await screen.findByText('Hébergement')).toBeTruthy();
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/v1/catalog/products?type=hosting&lang=fr', expect.anything()));
});
