// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/api', () => ({ apiFetch: vi.fn() }));
// eslint-disable-next-line import/first
import { apiFetch } from '../../src/lib/api';
// eslint-disable-next-line import/first
import ServerDetailPage from '../../src/pages/ServerDetailPage';

const SERVER_ID = '11111111-1111-1111-1111-111111111111';
const DEBIAN_13 = '22222222-2222-2222-2222-222222222222';

const server = {
  id: SERVER_ID, plan_id: 'plan-1', provider_id: 'prov-1', region_id: 'reg-1', datacenter_id: null,
  operating_system_version_id: 'ubuntu-2404', name: 'vps-1', hostname: 'vps-1.example.test',
  ip_address: '203.0.113.9', server_type: 'VPS', architecture: 'x86_64', status: 'active',
  provisioning_status: 'READY', provider_name: 'Test Provider', region_name: 'Frankfurt',
  datacenter_name: null, os_name: 'Ubuntu', os_logo_url: '/os-logos/ubuntu.svg',
  os_display_name: 'Ubuntu 24.04 LTS', cpu_cores: 4, memory_mb: 8192, storage_mb: 163840,
  bandwidth_gb: 2000, renewal_date: null, created_at: '2026-01-02T00:00:00.000Z',
  capabilities: { start: true, stop: true, reboot: true, shutdown: true, reinstall: true },
};

const configuration = {
  plan: { id: 'plan-1', name: 'VPS Basic', description: null },
  regions: [],
  operatingSystems: [{
    id: 'debian', name: 'Debian', slug: 'debian', vendor: 'Debian', description: null, logoUrl: null,
    versions: [{
      id: DEBIAN_13, version: '13', displayName: 'Debian 13', releaseName: null, status: 'ACTIVE',
      lts: false, recommended: true, default: true, architectures: ['x86_64'] as Array<'x86_64' | 'arm64'>,
      availability: [{ configurationId: 'c1', providerId: 'prov-1', regionId: 'reg-1', datacenterId: null, architecture: 'x86_64' as const }],
    }],
  }],
};

/** Routes every page request to a fixture; anything unexpected fails loudly rather than silently. */
function stubApi(overrides: Record<string, unknown> = {}) {
  vi.mocked(apiFetch).mockImplementation(((url: string, init?: { method?: string }) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    if (key in overrides) return Promise.resolve(overrides[key]);
    if (url === `/api/v1/servers/${SERVER_ID}`) return Promise.resolve({ server: overrides.server ?? server });
    if (url === `/api/v1/servers/${SERVER_ID}/provisioning-status`) {
      return Promise.resolve(overrides.provisioning ?? { server: { status: 'active', provisioningStatus: 'READY' }, job: null });
    }
    if (url === `/api/v1/servers/${SERVER_ID}/firewall`) return Promise.resolve({ rules: [] });
    if (url === `/api/v1/servers/${SERVER_ID}/health`) return Promise.resolve(overrides.health ?? { status: 'active', agent: { version: null, lastSeenAt: null, reachable: false }, latest: null });
    if (url.startsWith('/api/v1/server-products/')) return Promise.resolve(configuration);
    return Promise.reject(new Error(`Unexpected request: ${key}`));
  }) as unknown as typeof apiFetch);
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/servers/${SERVER_ID}`]}>
      <Routes><Route path="/dashboard/servers/:id" element={<ServerDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

/** The confirmation box inside the destructive panel — the page has other text inputs. */
function confirmationInput(): HTMLInputElement {
  const panel = Array.from(document.querySelectorAll('section')).find(
    (section) => section.textContent?.includes('Reinstall operating system')
  );
  const input = panel?.querySelector('input');
  if (!input) throw new Error('The reinstall panel has no confirmation field');
  return input;
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ServerDetailPage — provisioning status', () => {
  it('shows the running job, its attempt count and the failure reason the provider gave', async () => {
    stubApi({
      provisioning: {
        server: { status: 'error', provisioningStatus: 'FAILED' },
        job: {
          id: 'job-1', status: 'FAILED', attempts: 2, max_attempts: 3,
          error_code: 'IMAGE_UNAVAILABLE', error_message: 'Provider image does not exist or is unavailable',
          started_at: '2026-01-02T00:00:00.000Z', completed_at: null,
        },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('FAILED')).toBeTruthy());
    expect(screen.getByText('Attempt 2/3')).toBeTruthy();
    expect(screen.getByText(/Provider image does not exist/)).toBeTruthy();
  });
});

describe('ServerDetailPage — monitoring', () => {
  it('says nothing has been measured rather than showing zeroes', async () => {
    stubApi();
    renderPage();
    await waitFor(() => expect(screen.getByText('Resource usage')).toBeTruthy());
    expect(screen.getByText(/No measurements have been received/)).toBeTruthy();
    expect(screen.getByText('Agent has not reported yet')).toBeTruthy();
  });

  it('renders agent-reported figures, and marks stale ones as the last report received', async () => {
    stubApi({
      health: {
        status: 'active',
        agent: { version: '1.4.0', lastSeenAt: '2026-01-02T00:00:00.000Z', reachable: false },
        latest: {
          captured_at: '2026-01-02T00:00:00.000Z', cpu_percent: '12.50', load_1: '0.420',
          memory_used_mb: 2048, memory_total_mb: 8192, disk_used_mb: 20480, disk_total_mb: 163840,
          uptime_seconds: 180000,
        },
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('12.5 %')).toBeTruthy());
    expect(screen.getByText('0.42')).toBeTruthy();
    expect(screen.getByText('2 / 8 GB')).toBeTruthy();
    expect(screen.getByText('20 / 160 GB')).toBeTruthy();
    expect(screen.getByText(/last report received, not the current state/)).toBeTruthy();
  });
});

describe('ServerDetailPage — honest access and security controls',()=>{
  it('never fabricates root/admin credentials or exposes the database-only firewall editor',async()=>{
    stubApi({server:{...server,capabilities:{...server.capabilities,firewall:true}}});
    renderPage();
    await waitFor(()=>expect(screen.getByText('Server details')).toBeTruthy());
    expect(screen.queryByText('root / admin')).toBeNull();
    expect(screen.queryByText('Firewall & Port Rules')).toBeNull();
    expect(screen.queryByText(/Apply Baseline Rules/)).toBeNull();
  });
});

describe('ServerDetailPage — reinstall confirmation', () => {
  it('states the destructive consequence and keeps the action disabled until it is typed exactly', async () => {
    stubApi();
    renderPage();
    await waitFor(() => expect(screen.getByText('Reinstall OS')).toBeTruthy());
    fireEvent.click(screen.getByText('Reinstall OS'));

    await waitFor(() => expect(screen.getByText('Reinstall operating system')).toBeTruthy());
    expect(screen.getByText(/will erase the current operating-system data/).textContent).toMatch(/cannot be undone/);

    const trigger = screen.getByText('Erase and reinstall').closest('button') as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    // A near-miss is still a miss: only the exact word arms the button.
    const confirmField = confirmationInput();
    fireEvent.change(confirmField, { target: { value: 'reinstall' } });
    expect((screen.getByText('Erase and reinstall').closest('button') as HTMLButtonElement).disabled).toBe(true);
    expect(vi.mocked(apiFetch).mock.calls.some(([, init]) => (init as { method?: string } | undefined)?.method === 'POST')).toBe(false);

    fireEvent.change(confirmField, { target: { value: 'REINSTALL' } });
    await waitFor(() => expect((screen.getByText('Erase and reinstall').closest('button') as HTMLButtonElement).disabled).toBe(false));
  });

  it('sends the confirmation and the chosen catalog ids, never a provider image reference', async () => {
    stubApi({ [`POST /api/v1/servers/${SERVER_ID}/reinstall`]: { jobId: 'job-9', status: 'QUEUED', queued: true } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Reinstall OS')).toBeTruthy());
    fireEvent.click(screen.getByText('Reinstall OS'));
    await waitFor(() => expect(screen.getByText('Debian 13')).toBeTruthy());
    fireEvent.change(confirmationInput(), { target: { value: 'REINSTALL' } });
    fireEvent.click(screen.getByText('Erase and reinstall'));

    await waitFor(() => {
      const posted = vi.mocked(apiFetch).mock.calls.find(([, init]) => (init as { method?: string } | undefined)?.method === 'POST');
      expect(posted).toBeTruthy();
      expect(posted?.[0]).toBe(`/api/v1/servers/${SERVER_ID}/reinstall`);
      expect(JSON.parse((posted?.[1] as { body: string }).body)).toEqual({
        operatingSystemVersionId: DEBIAN_13, architecture: 'x86_64', confirmation: 'REINSTALL',
      });
    });
    expect(await screen.findByText(/Reinstall queued as job job-9/)).toBeTruthy();
  });
});
