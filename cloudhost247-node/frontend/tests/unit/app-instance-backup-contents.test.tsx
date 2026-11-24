// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('marks the undo copy a destructive restore took, so it is recognisable in the list', async () => {
    // A safety snapshot (0069) is the only way back after a destructive restore, so the customer
    // must be able to tell it apart from a backup they asked for — and a row with no kind (older
    // rows, standard backups) must not borrow the label.
    const backups = [
      {
        id: 's1',
        status: 'completed',
        size_bytes: 4096,
        created_at: '2026-10-03T11:00:00.000Z',
        storage_provider: 'local',
        database_dump: null,
        includes: { volumes: true, databases: 'postgres' },
        backup_kind: 'safety_snapshot',
      },
      {
        id: 'b1',
        status: 'completed',
        size_bytes: 2048,
        created_at: '2026-10-03T10:00:00.000Z',
        storage_provider: 'local',
        database_dump: { engine: 'postgres' },
        includes: { volumes: true, databases: 'postgres' },
        backup_kind: 'standard',
      },
      {
        id: 'old',
        status: 'completed',
        size_bytes: 1024,
        created_at: '2026-10-02T10:00:00.000Z',
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

    const snapshotBadge = await screen.findByText('safety snapshot');
    expect(snapshotBadge.getAttribute('title')).toContain('undo');
    // Exactly one row carries the label: the standard backup and the pre-0069 row do not.
    expect(screen.getAllByText('safety snapshot')).toHaveLength(1);

    // The includes evidence (0070) is shown where it was recorded…
    const recordedCell = screen.getByText('database (postgres)').closest('td');
    expect(recordedCell?.getAttribute('title')).toContain('volumes archived');
    // …including on a row whose dump evidence says "not recorded": the two reports are independent.
    const notRecordedCells = screen.getAllByText('not recorded');
    expect(notRecordedCells).toHaveLength(2);
    const withEvidence = notRecordedCells.filter((el) => (el.getAttribute('title') ?? '').includes('volumes archived'));
    expect(withEvidence).toHaveLength(1);
    // …and the pre-0070 row says nothing either way — no title invented.
    const legacyCell = notRecordedCells.find((el) => el.getAttribute('title') === null);
    expect(legacyCell).toBeDefined();
  });

  it('gates cPanel lifecycle buttons by adapter capability and explains unsupported operations', async () => {
    const unsupportedReason = 'WHM has no per-account application restart operation in this adapter.';
    const capabilities = {
      engine: 'cpanel',
      simulationMode: false,
      operations: {
        install: { supported: true, reason: null },
        verify: { supported: false, reason: 'No application-level health probe is implemented.' },
        status: { supported: true, reason: null, method: 'Account status only' },
        logs: { supported: false, reason: 'Per-application logs are unavailable.' },
        start: { supported: true, reason: null },
        stop: { supported: true, reason: null },
        restart: { supported: false, reason: unsupportedReason },
        update: { supported: false, reason: 'Application updates are not implemented for cPanel.' },
        reinstall: { supported: false, reason: 'Reinstall is not implemented for cPanel.' },
        backup: { supported: true, reason: null },
        restore: { supported: true, reason: null },
        uninstall: { supported: true, reason: null },
      },
    };
    const backups = [{
      id: 'b1', status: 'completed', size_bytes: 2048,
      created_at: '2026-10-03T10:00:00.000Z', storage_provider: 'local', database_dump: null,
    }];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes(`/api/v1/app-installations/${INSTALLATION_ID}/backups`)) {
          return { ok: true, status: 200, json: async () => ({ backups }) };
        }
        if (url.includes(`/api/v1/app-installations/${INSTALLATION_ID}/domains`)) {
          return { ok: true, status: 200, json: async () => ({ domains: [] }) };
        }
        if (url.endsWith(`/api/v1/app-installations/${INSTALLATION_ID}`)) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              installation: {
                id: INSTALLATION_ID, name: 'My WordPress', status: 'healthy', health_status: 'unknown',
                domain: 'wordpress.example.test', application_id: 'wordpress', application_version_id: 'version-1', server_id: 'server-1',
                cpu_limit: 1, memory_limit_mb: 512, storage_limit_mb: 5120, restart_count: 0,
                last_backup_at: null, created_at: '2026-10-01T00:00:00.000Z',
              },
              application: { name: 'WordPress', slug: 'wordpress' },
              capabilities,
            }),
          };
        }
        if (url.endsWith('/api/v1/app-installations')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              installations: [{
                id: INSTALLATION_ID, name: 'My WordPress', application: { name: 'WordPress', slug: 'wordpress', logoUrl: null },
                version: '1.0.0', server: { name: 'cpanel-1', type: 'CPANEL' }, status: 'healthy', domain: null,
                health: 'unknown', cpuLimit: 1, memoryLimitMb: 512, storageLimitMb: 5120,
                restartCount: 0, lastBackupAt: null, createdAt: '2026-10-01T00:00:00.000Z',
              }],
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

    expect(await screen.findByText('wordpress.example.test')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'wordpress.example.test' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Domains' }));
    expect(await screen.findByText(/No domains attached/)).toBeDefined();
    expect(screen.getByText(/Domain verification and attachment do not confirm DNS readiness or certificate issuance/i)).toBeDefined();
    expect(screen.queryByText(/SSL is issued automatically/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Backups' }));

    const verify = await screen.findByRole('button', { name: 'Verify health unavailable' });
    expect((verify as HTMLButtonElement).disabled).toBe(true);
    const restart = screen.getByRole('button', { name: 'Restart unavailable' });
    expect((restart as HTMLButtonElement).disabled).toBe(true);
    expect(restart.getAttribute('title')).toContain(unsupportedReason);
    expect((screen.getByRole('button', { name: 'Update unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reinstall unavailable' }) as HTMLButtonElement).disabled).toBe(true);

    const restore = await screen.findByRole('button', { name: 'Restore' });
    expect((restore as HTMLButtonElement).disabled).toBe(false);
    const operationDisclosure = screen.getByText('Operations unavailable on this cpanel target');
    fireEvent.click(operationDisclosure);
    expect(screen.getByText(unsupportedReason)).toBeDefined();
  });
});
