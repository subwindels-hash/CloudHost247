// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StatusPage from '../../src/pages/StatusPage';

/**
 * Frontend unit tests for the public status page (K07 — incident notifications):
 * - renders component states from the status endpoint,
 * - renders active incidents when present,
 * - shows an honest empty state when no incidents are declared.
 */
describe('Status page (public)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders component states and incidents from the status endpoint', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        monitored: false,
        checkedAt: '2026-11-22T10:00:00.000Z',
        latencyMs: 42,
        incidents: [
          {
            incident_number: 'INC-2026-001',
            title: 'DNS degradation in eu-west',
            status: 'investigating',
            severity: 'critical',
            started_at: '2026-11-22T09:00:00.000Z',
          },
        ],
        components: [
          { id: 'api', name: 'CloudHost247 API', state: 'operational', detail: 'The API is answering.' },
          { id: 'database', name: 'Data store', state: 'operational', detail: 'The database answered.' },
        ],
      }),
    });

    render(
      <MemoryRouter initialEntries={['/status']}>
        <StatusPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText('CloudHost247 API')).toBeTruthy()
    );
    expect(screen.getByText('INC-2026-001')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('DNS degradation in eu-west', { exact: false })).toBeTruthy()
    );
    expect(screen.getByText('critical', { exact: false })).toBeTruthy();
    expect(screen.getByText('Not continuously monitored', { exact: false })).toBeTruthy();
  });

  it('shows an honest empty state when no incidents are declared', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        monitored: false,
        checkedAt: '2026-11-22T10:00:00.000Z',
        latencyMs: 42,
        incidents: [],
        components: [
          { id: 'api', name: 'CloudHost247 API', state: 'operational', detail: 'The API is answering.' },
        ],
      }),
    });

    render(
      <MemoryRouter initialEntries={['/status']}>
        <StatusPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText('No active incidents.')).toBeTruthy()
    );
  });

  it('shows an error state when the endpoint fails', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'INTERNAL_ERROR' }),
    });

    render(
      <MemoryRouter initialEntries={['/status']}>
        <StatusPage />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByText(/Status is unavailable/)).toBeTruthy()
    );
  });
});
