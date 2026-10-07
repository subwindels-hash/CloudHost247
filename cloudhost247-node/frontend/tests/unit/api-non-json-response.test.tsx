// @vitest-environment jsdom
/**
 * A tools page that answers with `Unexpected token '<', "<!doctype "... is not valid JSON` is not
 * a broken tool: it is a browser that received the SPA's own index.html from an /api URL, and the
 * parser message is all it had to say about it. These tests pin the behaviour the tools pages
 * depend on — every non-JSON response is named for what it is, with the URL that produced it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiFetch, ApiRequestError } from '../../src/lib/api';
import { getToken, setSession } from '../../src/lib/auth';
import ToolsCenterPage from '../../src/pages/ToolsCenterPage';

const HTML = '<!doctype html><html lang="en"><head><title>Tools</title></head><body><div id="root"></div></body></html>';

/** The shape a browser hands back when a web server answers an API path: 200 OK, HTML. */
function htmlResponse(status = 200, body = HTML) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

function textResponse(status = 200, body = 'Bad gateway', type = 'text/plain') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Bad Gateway',
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('apiFetch on a non-JSON response', () => {
  it('names the URL and the cause instead of repeating the parser message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse()));
    await expect(apiFetch('/api/tools/catalog')).rejects.toThrow(ApiRequestError);

    try {
      await apiFetch('/api/tools/catalog');
      expect.unreachable('the HTML response must not be treated as success');
    } catch (error) {
      const failure = error as ApiRequestError;
      expect(failure.message).not.toMatch(/Unexpected token/i);
      expect(failure.message).toContain('/api/tools/catalog');
      expect(failure.message).toMatch(/HTML page/);
      expect(failure.message).toMatch(/HTTP 200/);
      // It cannot be fixed by asking again, so it must not be offered as retryable.
      expect(failure.retryable).toBe(false);
      expect(failure.code).toBe('NON_JSON_RESPONSE');
    }
  });

  it('says plainly when the body is not JSON and not HTML either', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textResponse(200, 'Bad gateway')));
    await expect(apiFetch('/api/tools/dashboard')).rejects.toThrow(/did not answer \/api\/tools\/dashboard with JSON/);
  });

  it('reports a 5xx served as HTML as retryable, unlike a 200 served as HTML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(502, '<html><body>Bad gateway</body></html>')));
    try {
      await apiFetch('/api/tools/catalog');
      expect.unreachable('a 502 is not success');
    } catch (error) {
      const failure = error as ApiRequestError;
      expect(failure.status).toBe(502);
      expect(failure.retryable).toBe(true);
    }
  });

  /**
   * A non-JSON body is evidence that the response never reached the application, so it cannot be
   * evidence that a token was rejected. Signing a customer out because a proxy returned a login
   * page would be worse than the failure it was trying to explain.
   */
  it('does not end the session when the 401 body is not JSON', async () => {
    setSession('a-token', { id: 'u1', email: 'x@example.com', fullName: 'X Y', role: 'customer' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(401, '<html><body>Sign in</body></html>')));

    await expect(apiFetch('/api/auth/me')).rejects.toThrow(ApiRequestError);
    expect(getToken()).toBe('a-token');
  });
});

describe('Tools Center when the catalogue is answered with HTML', () => {
  it('states that the catalogue is unreachable rather than "temporarily unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse()));
    render(
      <MemoryRouter initialEntries={['/tools']}>
        <ToolsCenterPage />
      </MemoryRouter>
    );

    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.textContent).not.toMatch(/Unexpected token/i));
    expect(alert.textContent).toContain('not reachable from this page');
    expect(alert.textContent).toContain('/api/tools/catalog');
    expect(alert.textContent).not.toContain('temporarily unavailable');
    // The visitor can still ask again — after a redeploy the same click succeeds.
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    // And they can open the URL that failed, which settles in one look whether the request is
    // reaching the application at all.
    const probe = screen.getByRole('link', { name: /Open \/api\/tools\/catalog/ });
    expect(probe.getAttribute('href')).toBe('/api/tools/catalog');
  });
});
