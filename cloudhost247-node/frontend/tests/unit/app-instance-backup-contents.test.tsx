// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { clearSession, setSession } from '../../src/lib/auth';

const INSTALLATION_ID = '11111111-2222-3333-4444-555555555555';

const SIGNED_IN = { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' };

/**
 * The backups tab tells the customer what each archive holds.
 *
 * The agent has reported since A18 whether it produced a database dump, or why it produced none, and
 * the platform used to throw that away — every "completed" backup looked identical. It is now on the
 * row (migration 0068). This test pins the three states the UI can be handed, because the dangerous
 * one is the collapse: a backup taken before the platform recorded this must not be shown as "no
 * database dump", and an archive whose dump is missing must not look like a complete one.
 */
describe('/dashboard/apps/:id/backups — what each archive holds', () => {
  beforeEach(() => {
    localStorage.clear();
    setSession('token', SIGNED_IN);
  });

  afterEach(() => {
    cleanup();
    clearSession();
    vi.unstubAllGlobals();
  });

  it('distinguishes a dump, a missing dump and no record at all', async () => {
    const backups = [
      {
        id: 'b1',
        status: 'completed',
        size_bytes: 2048,
        created_at: '2026-10-03T10:00:00.000Z',
        storage_provider: 'local',
        database_dump: { engine: 'postgres' },
      },
      {
        id: 'b2',
        status: 'completed',
        size_bytes: 1024,
        created_at: '2026-10-03T09:00:00.000Z',
        storage_provider: 'local',
        database_dump: { engine: null, reason: 'no service produced a logical database dump' },
      },
      {
        id: 'b3',
        status: 'completed',
        size_bytes: 512,
        created_at: '2026-10-03T08:00:00.000Z',
        storage_provider: 'local',
        database_dump: null,
      },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes(`/api/v1/app-installations/${INSTALLATION_ID}/backups`)) {
          return { ok: true, status: 200, json: async () => ({ backups }) };
        }
        if (url.includes(`/api/v1/app-installations/${INSTALLATION_ID}`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              installation: {
                id: INSTALLATION_ID,
                name: 'My n8n',
                status: 'healthy',
                application_name: 'n8n',
                server_name: 'docker-1',
                domain: null,
                last_backup_at: null,
                created_at: '2026-10-01T00:00:00.000Z',
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      })
    );

    render(
      <MemoryRouter initialEntries={[`/dashboard/apps/${INSTALLATION_ID}/backups`]}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByText('database (postgres)')).toBeDefined();
    expect(screen.getByText('no database dump')).toBeDefined();
    expect(screen.getByText('not recorded')).toBeDefined();
    // The reason travels with the row, so an operator can tell "checked and absent" from "unknown".
    await waitFor(() => {
      expect(screen.getByText('no database dump').getAttribute('title')).toContain('no service produced');
    });
  });
});
