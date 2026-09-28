// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import RequireAuth from '../../src/components/RequireAuth';
import { clearSession, setSession } from '../../src/lib/auth';

/**
 * /dashboard (and the rest of the authenticated app shell) must be a *real* protected route: a
 * signed-out visitor should never see its content, even for an instant, and should land on
 * /login instead. A signed-in visitor (real local session state, same as the rest of the app
 * uses) should see the protected content normally.
 */
function renderProtectedApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<div>Protected dashboard content</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RequireAuth: protects the authenticated app shell', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('redirects an unauthenticated visitor from /dashboard to /login', () => {
    renderProtectedApp('/dashboard');

    expect(screen.getByText('Login page')).toBeTruthy();
    expect(screen.queryByText('Protected dashboard content')).toBeNull();
  });

  it('renders the protected route for an authenticated visitor', () => {
    setSession('fake-token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });

    renderProtectedApp('/dashboard');

    expect(screen.getByText('Protected dashboard content')).toBeTruthy();
    expect(screen.queryByText('Login page')).toBeNull();

    clearSession();
  });
});
