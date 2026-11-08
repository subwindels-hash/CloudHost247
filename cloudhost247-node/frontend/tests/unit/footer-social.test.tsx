// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Footer from '../../src/layout/Footer';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('shows unconfigured icons without links and refreshes after a settings change', async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ links: {
    instagram: 'https://www.instagram.com/example', whatsapp: 'https://wa.me/123',
    tiktok: 'https://evil.example/tiktok', telegram: ''
  } }) }).mockResolvedValue({ ok: true, json: async () => ({ links: { telegram: 'https://t.me/example' } }) });
  vi.stubGlobal('fetch', fetchMock);
  render(<MemoryRouter><Footer /></MemoryRouter>);
  expect((await screen.findByRole('link', { name: 'CloudHost247 on Instagram' })).getAttribute('href')).toBe('https://www.instagram.com/example');
  expect(screen.getByRole('link', { name: 'CloudHost247 on WhatsApp' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'CloudHost247 on TikTok' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'CloudHost247 on Telegram' })).toBeNull();
  expect(screen.getByRole('img', { name: 'TikTok link not configured' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Telegram link not configured' })).toBeTruthy();
  window.dispatchEvent(new Event('ch247:social-links-changed'));
  await waitFor(() => expect(screen.getByRole('link', { name: 'CloudHost247 on Telegram' })).toBeTruthy());
  expect(screen.queryByRole('link', { name: 'CloudHost247 on Instagram' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Instagram link not configured' })).toBeTruthy();
});
