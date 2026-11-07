// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '../../src/pages/LoginPage';
import RegisterPage from '../../src/pages/RegisterPage';
import DomainsMarketingPage from '../../src/pages/DomainsMarketingPage';
import AiBuilderPage from '../../src/pages/platform/AiBuilderPage';
import DomainSearchPage from '../../src/pages/domains/SearchPage';
import TransferPage from '../../src/pages/domains/TransferPage';
import { apiFetch } from '../../src/lib/api';
import { clearSession, setSession } from '../../src/lib/auth';
import { safeReturnTo } from '../../src/lib/return-to';

vi.mock('../../src/lib/api', () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url === '/api/auth/login') return { token: 'token', user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada', role: 'customer' } };
    if (url === '/api/auth/register') return { token: 'token', user: { id: 'u1', email: 'ada@example.com', fullName: 'Ada', role: 'customer' }, emailVerification: { queued: true } };
    if (url === '/api/v1/domain-services/search') return { status: 'completed', results: [{ domainName: 'example.com', availabilityStatus: 'available', registrationPrice: '12', renewalPrice: '12', transferPrice: '12', currency: 'USD' }] };
    if (url.includes('/engines')) return { engines: [] };
    return { projects: [] };
  }),
  ApiRequestError: class extends Error {},
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

afterEach(() => { cleanup(); clearSession(); vi.clearAllMocks(); });

describe('contextual navigation', () => {
  it('accepts only local return destinations', () => {
    expect(safeReturnTo('/cart?item=1')).toBe('/cart?item=1');
    for (const value of ['//evil.example', '/\\evil.example', 'https://evil.example', '/login', '/register', '/\nevil']) {
      expect(safeReturnTo(value)).toBeNull();
    }
  });

  it('returns a customer to the requested service after signing in', async () => {
    render(<MemoryRouter initialEntries={['/login?next=%2Fcart%3Fitem%3D1']}><Routes>
      <Route path="/login" element={<LoginPage />} /><Route path="*" element={<LocationProbe />} />
    </Routes></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/register?next=%2Fcart%3Fitem%3D1');
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.click(screen.getByRole('button', { name: 'Login' }));
    expect((await screen.findByTestId('location')).textContent).toBe('/cart?item=1');
  });

  it('carries the homepage idea through account creation into the builder', async () => {
    render(<MemoryRouter initialEntries={['/register?idea=A%20design%20studio%20website']}><Routes>
      <Route path="/register" element={<RegisterPage />} /><Route path="/websites/ai-builder" element={<AiBuilderPage />} />
    </Routes></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Full name'), 'Ada Lovelace');
    await userEvent.type(screen.getByLabelText('Email address'), 'ada@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-horse');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'correct-horse');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register' }));
    expect((await screen.findByLabelText(/What does it do/) as HTMLTextAreaElement).value).toBe('A design studio website');
  });

  it('prefills the AI brief for a signed-in customer', () => {
    setSession('token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada', role: 'customer' });
    render(<MemoryRouter initialEntries={['/websites/ai-builder?idea=My%20new%20site']}><AiBuilderPage /></MemoryRouter>);
    expect((screen.getByLabelText(/What does it do/) as HTMLTextAreaElement).value).toBe('My new site');
  });

  it('keeps the submitted domain with results and account links even if the input is edited', async () => {
    render(<MemoryRouter><DomainsMarketingPage /></MemoryRouter>);
    const input = screen.getByLabelText('Domain name to search');
    fireEvent.change(input, { target: { value: 'example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('example.com');
    fireEvent.change(input, { target: { value: 'another' } });
    expect(screen.getByRole('link', { name: /See all 1 results/ }).getAttribute('href')).toBe('/domains/search?domain=example');
    expect(screen.getByRole('link', { name: /Create an account to register/ }).getAttribute('href')).toBe('/register?next=%2Fdomains%2Fsearch%3Fdomain%3Dexample');
  });

  it('returns a visitor to the selected domain after sign-in', async () => {
    render(<MemoryRouter initialEntries={['/domains/search?domain=example']}><DomainSearchPage /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: 'Sign in to register' });
    expect(link.getAttribute('href')).toBe('/login?next=%2Fdomains%2Fsearch%3Fdomain%3Dexample.com');
  });

  it('updates domain results when a new deep link is followed on the same page', async () => {
    render(<MemoryRouter initialEntries={['/domains/search?domain=first']}>
      <Link to="/domains/search?domain=second">Second domain</Link><DomainSearchPage />
    </MemoryRouter>);
    await screen.findByText('example.com');
    fireEvent.click(screen.getByRole('link', { name: 'Second domain' }));
    await waitFor(() => expect((screen.getByLabelText('Domain name') as HTMLInputElement).value).toBe('second'));
    await waitFor(() => expect(vi.mocked(apiFetch).mock.calls.some(([path, options]) =>
      path === '/api/v1/domain-services/search' && String(options?.body).includes('second'))).toBe(true));
  });

  it('prefills the transfer form from the domain link', () => {
    setSession('token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada', role: 'customer' });
    render(<MemoryRouter initialEntries={['/domains/transfer?domain=example.com']}><TransferPage /></MemoryRouter>);
    expect((screen.getByLabelText('Domain to transfer') as HTMLInputElement).value).toBe('example.com');
  });

});
