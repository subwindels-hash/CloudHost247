// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../src/lib/api';
import { getToken, setSession } from '../../src/lib/auth';

/**
 * A 401 response to a request that *sent* a token means that token is no longer valid — expired,
 * or explicitly revoked server-side via /api/auth/logout (see
 * database/migrations/0003_create_revoked_tokens.sql, which can happen from another browser tab).
 * apiFetch centralizes reacting to that: it clears the local session immediately so every part of
 * the UI (header nav, RequireAuth-protected routes) reflects the real, server-verified state on
 * the very next render instead of continuing to show a "logged in" UI backed by a dead token.
 */
describe('apiFetch: session invalidation on 401', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('clears the local session when a request with a token gets a 401 back', async () => {
    setSession('a-token', { id: 'u1', email: 'x@example.com', fullName: 'X Y', role: 'customer' });
    expect(getToken()).toBe('a-token');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'UNAUTHORIZED', message: 'This session has been logged out' }),
      })
    );

    await expect(apiFetch('/api/auth/me')).rejects.toThrow(/logged out/i);
    expect(getToken()).toBeNull();
  });

  it('does not clear the session for a 401 on a request that never sent a token', async () => {
    // No setSession() call — there is nothing to clear, and this shouldn't throw trying.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'UNAUTHORIZED', message: 'Missing bearer token' }),
      })
    );

    await expect(apiFetch('/api/auth/me')).rejects.toThrow();
    expect(getToken()).toBeNull();
  });

  it('leaves the session intact for an unrelated error status (e.g. 500)', async () => {
    setSession('a-token', { id: 'u1', email: 'x@example.com', fullName: 'X Y', role: 'customer' });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'INTERNAL_ERROR', message: 'boom' }),
      })
    );

    await expect(apiFetch('/api/auth/me')).rejects.toThrow('boom');
    expect(getToken()).toBe('a-token');
  });
});
