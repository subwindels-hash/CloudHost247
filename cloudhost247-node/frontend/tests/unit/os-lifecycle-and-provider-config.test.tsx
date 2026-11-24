// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OsLifecycleNotice from '../../src/components/OsLifecycleNotice';
import ProviderConfigurationPanel from '../../src/components/ProviderConfigurationPanel';

vi.mock('../../src/lib/api', () => ({ apiFetch: vi.fn() }));
// eslint-disable-next-line import/first
import { apiFetch } from '../../src/lib/api';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('OsLifecycleNotice', () => {
  it('says nothing for a supported version', () => {
    const { container } = render(
      <OsLifecycleNotice status="ACTIVE" displayName="Ubuntu 24.04 LTS" endOfLifeDate={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('warns without claiming the server stopped working, and states the destructive consequence', () => {
    render(<OsLifecycleNotice status="EOL_WARNING" displayName="Ubuntu 20.04 LTS" endOfLifeDate="2027-04-30" />);
    expect(screen.getByText('Approaching end of life')).toBeTruthy();
    expect(screen.getByText(/keeps running/)).toBeTruthy();
    expect(screen.getByText(/erases everything on the server/)).toBeTruthy();
  });

  it('explains an end-of-life version without suggesting data loss has occurred', () => {
    render(<OsLifecycleNotice status="EOL" displayName="Ubuntu 18.04 LTS" endOfLifeDate="2023-05-31" />);
    expect(screen.getByText('End of life')).toBeTruthy();
    expect(screen.getByText(/your data is untouched/)).toBeTruthy();
  });

  it('renders a compact tag for list views', () => {
    const { container } = render(
      <OsLifecycleNotice compact status="EOL" displayName="Ubuntu 18.04 LTS" endOfLifeDate={null} />
    );
    expect(container.querySelector('.ch247-os-lifecycle__tag.is-eol')?.textContent).toBe('End of life');
  });
});

describe('ProviderConfigurationPanel', () => {
  const report = {
    provider: { id: 'p1', name: 'Proxmox Lab', slug: 'proxmox-lab', providerType: 'PROXMOX', adapter: 'proxmox', status: 'CONFIGURATION_REQUIRED' },
    configuration: {
      adapter: 'proxmox', label: 'Proxmox VE', envPrefix: 'PROXMOX_LAB', apiBaseUrl: null,
      apiBaseUrlRequired: true, apiBaseUrlConfigured: false,
      credentials: [
        { suffix: '_API_TOKEN', name: 'PROXMOX_LAB_API_TOKEN', fallbackName: 'PROXMOX_API_TOKEN', description: 'API token', required: true, present: false, stored: false },
        { suffix: '_API_URL', name: 'PROXMOX_LAB_API_URL', fallbackName: null, description: 'PVE API URL', required: false, present: true, stored: false },
      ],
      planMetadata: [{ key: 'providerNode', description: 'Target PVE node', required: true }],
      capabilities: { reinstall: true, snapshot: true, resize: true, console: true, metrics: true, rescue: false },
      notes: 'QEMU clone from a template VMID.',
      ready: false,
      missing: ['PROXMOX_LAB_API_TOKEN', 'api_base_url'],
    },
    images: { total: 3, verifiedActive: 1 },
  };

  it('shows which variables are missing and never renders a credential value', async () => {
    vi.mocked(apiFetch).mockResolvedValue(report);
    const { container } = render(<ProviderConfigurationPanel providerId="p1" />);
    await waitFor(() => expect(screen.getByText(/Configuration required/)).toBeTruthy());
    expect(screen.getByText('PROXMOX_LAB_API_TOKEN')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    expect(screen.getByText('1 of 3')).toBeTruthy();
    // The panel only ever renders names, descriptions and presence booleans.
    expect(container.textContent).not.toMatch(/secret-value|Bearer /i);
  });

  it('reports a fully configured provider as ready', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ...report,
      configuration: {
        ...report.configuration, ready: true, missing: [], apiBaseUrl: 'https://pve.example.test/api2/json',
        apiBaseUrlConfigured: true,
        credentials: report.configuration.credentials.map((credential) => ({ ...credential, present: true })),
      },
    });
    render(<ProviderConfigurationPanel providerId="p1" />);
    await waitFor(() => expect(screen.getByText(/Run a connection test to verify provider access/)).toBeTruthy());
  });

  it('does not render credential entry or connection controls for other admins', async () => {
    vi.mocked(apiFetch).mockResolvedValue(report);
    const { container } = render(<ProviderConfigurationPanel providerId="p1" />);
    await waitFor(() => expect(screen.getByText('Credential entry and provider connection are restricted to Super Admin.')).toBeTruthy());
    expect(screen.queryByText('Connect provider API')).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
  });

  it('lets a Super Admin submit a new credential without rendering it back', async () => {
    const secret = 'never-render-this-token';
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(report)
      .mockResolvedValueOnce({
        provider: { id: 'p1', name: 'Proxmox Lab', status: 'ACTIVE', lastHealthStatus: 'HEALTHY' },
        result: { status: 'connected', code: null, message: 'The provider API accepted the configured credentials.' },
      })
      .mockResolvedValueOnce({ ...report, provider: { ...report.provider, status: 'ACTIVE' } });
    const { container } = render(<ProviderConfigurationPanel providerId="p1" canManageCredentials />);
    await waitFor(() => expect(screen.getByText(/Connect provider API/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('PROXMOX_LAB_API_TOKEN required'), { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: 'Save & connect API' }));
    await waitFor(() => expect(screen.getByText(/accepted the configured credentials/)).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/admin/providers/p1/connect', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ credentials: { _API_TOKEN: secret } }),
    }));
    expect(container.textContent).not.toContain(secret);
  });

  it('surfaces a load failure instead of implying the provider is configured', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Forbidden'));
    render(<ProviderConfigurationPanel providerId="p1" />);
    await waitFor(() => expect(screen.getByText('Forbidden')).toBeTruthy());
  });
});
