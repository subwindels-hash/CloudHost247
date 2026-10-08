// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminOsImagesPage from '../../src/pages/AdminOsImagesPage';

vi.mock('../../src/lib/api', () => ({ apiFetch: vi.fn() }));
// eslint-disable-next-line import/first
import { apiFetch } from '../../src/lib/api';

const mockedFetch = apiFetch as unknown as ReturnType<typeof vi.fn>;

const PROVIDER_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const PROVIDER_B = 'bbbbbbbb-0000-0000-0000-000000000002';

const IMAGES = [
  {
    id: 'image-1', provider_id: PROVIDER_A, operating_system_version_id: 'v-ubuntu-2404',
    provider_image_id: 'ubuntu-24.04-x64', provider_template_id: null, architecture: 'x86_64',
    region_id: null, datacenter_id: null, status: 'ACTIVE', verified_at: '2026-01-02T00:00:00Z',
    verification_error: null, provider_name: 'Hetzner', os_display_name: 'Ubuntu 24.04 LTS',
    region_name: null, datacenter_name: null,
  },
  {
    id: 'image-2', provider_id: PROVIDER_B, operating_system_version_id: 'v-debian-13',
    provider_image_id: null, provider_template_id: 'local:vztmpl/debian-13.tar.zst', architecture: 'arm64',
    region_id: 'region-1', datacenter_id: null, status: 'DRAFT', verified_at: null,
    verification_error: null, provider_name: 'Proxmox', os_display_name: 'Debian 13',
    region_name: 'Frankfurt', datacenter_name: null,
  },
];

function mockLoad() {
  mockedFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/os-images')) return { images: IMAGES };
    if (url === '/api/v1/admin/providers') {
      return {
        providers: [
          { id: PROVIDER_A, name: 'Hetzner' },
          { id: PROVIDER_B, name: 'Proxmox' },
        ],
        regions: [{ id: 'region-1', provider_id: PROVIDER_B, name: 'Frankfurt', code: 'fra' }],
        datacenters: [],
      };
    }
    if (url === '/api/v1/admin/operating-systems') return { operatingSystems: [] };
    throw new Error(`unexpected url ${url}`);
  });
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/admin/infrastructure/images']}>
      <AdminOsImagesPage />
    </MemoryRouter>
  );
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AdminOsImagesPage filters', () => {
  it('shows every mapping by default with a result count', async () => {
    mockLoad();
    renderPage();
    await waitFor(() => expect(screen.getByText('Ubuntu 24.04 LTS')).toBeTruthy());
    expect(screen.getByText('Debian 13')).toBeTruthy();
    expect(screen.getByText('Showing 2 of 2 mappings.')).toBeTruthy();
  });

  it('filters by provider, architecture, status, and free-text search', async () => {
    mockLoad();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Ubuntu 24.04 LTS')).toBeTruthy());

    await user.selectOptions(screen.getByLabelText('Provider'), [PROVIDER_B]);
    expect(screen.queryByText('Ubuntu 24.04 LTS')).toBeNull();
    expect(screen.getByText('Debian 13')).toBeTruthy();
    expect(screen.getByText('Showing 1 of 2 mappings.')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Provider'), ['']);

    await user.selectOptions(screen.getByLabelText('Architecture'), ['arm64']);
    expect(screen.queryByText('Ubuntu 24.04 LTS')).toBeNull();
    expect(screen.getByText('Debian 13')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Architecture'), ['']);

    await user.selectOptions(screen.getByLabelText('Status'), ['DRAFT']);
    expect(screen.queryByText('Ubuntu 24.04 LTS')).toBeNull();
    expect(screen.getByText('Debian 13')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Status'), ['']);

    await user.type(screen.getByLabelText('Search'), 'frankfurt');
    expect(screen.queryByText('Ubuntu 24.04 LTS')).toBeNull();
    expect(screen.getByText('Debian 13')).toBeTruthy();
  });

  it('explains an empty filter result instead of rendering an empty table', async () => {
    mockLoad();
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(screen.getByText('Ubuntu 24.04 LTS')).toBeTruthy());
    await user.type(screen.getByLabelText('Search'), 'no-such-image');
    expect(screen.getByText('No image mappings match these filters.')).toBeTruthy();
    expect(screen.getByText('Showing 0 of 2 mappings.')).toBeTruthy();
  });
});
