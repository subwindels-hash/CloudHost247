// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Layout from '../../src/layout/Layout';
import { LocaleProvider } from '../../src/i18n/LocaleProvider';
import { CurrencyProvider } from '../../src/currency/CurrencyProvider';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('renders the public shell when browser storage is blocked', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

  render(<MemoryRouter><LocaleProvider><CurrencyProvider><Routes>
    <Route element={<Layout />}><Route path="/" element={<h1>Public homepage</h1>} /></Route>
  </Routes></CurrencyProvider></LocaleProvider></MemoryRouter>);

  expect(screen.getByRole('heading', { name: 'Public homepage' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Sign In' })).toBeTruthy();
});
