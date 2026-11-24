// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppDetailPage from '../../src/pages/AppDetailPage';
import { clearSession, setSession } from '../../src/lib/auth';

const application = {
  slug: 'test-app',
  name: 'Test App',
  description: 'Fixture application',
  longDescription: null,
  logoUrl: null,
  websiteUrl: null,
  repositoryUrl: null,
  documentationUrl: null,
  category: null,
  license: null,
  featured: false,
  popularity: 0,
  installCount: 0,
  requirements: { minCpu: 1, minMemoryMb: 512, minStorageMb: 1024, recommendedCpu: 1, recommendedMemoryMb: 512, recommendedStorageMb: 1024, gpu: false },
  supportedHostingTypes: ['docker', 'vps'],
  stableVersion: '1.0.0',
  deploymentType: 'docker-compose',
  versions: [{
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    version: '1.0.0',
    releaseNotes: null,
    stable: true,
    requirements: { minCpu: 1, minMemoryMb: 512, minStorageMb: 1024 },
  }],
  environment: { required: [], optional: [] },
  domainRequired: false,
  sslSupported: false,
  backupsSupported: false,
};

const server = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'test-target',
  serverType: 'VPS',
  region: 'test-region',
  status: 'active',
  dockerEnabled: true,
  kubernetesEnabled: false,
  cpanelEnabled: false,
  cpuCores: 8,
  memoryMb: 8192,
  storageMb: 102400,
};

function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => text,
  } as Response;
}

describe('marketplace installation wizard capability gate', () => {
  beforeEach(() => {
    localStorage.clear();
    setSession('customer-token', { id: 'customer-1', email: 'customer@example.test', fullName: 'Test Customer', role: 'customer' });
  });

  afterEach(() => {
    cleanup();
    clearSession();
    vi.unstubAllGlobals();
  });

  it('keeps the install request disabled when the selected adapter reports unsupported', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/v1/apps/test-app')) return jsonResponse({ app: application });
      if (url.includes('/api/v1/servers')) return jsonResponse({ servers: [], deploymentTargets: [server] });
      if (url.endsWith('/api/v1/app-installations')) return jsonResponse({ installations: [] });
      if (url.endsWith('/api/v1/app-installations/capabilities')) {
        return jsonResponse({
          capabilities: {
            engine: 'docker',
            simulationMode: false,
            operations: { install: { supported: false, reason: 'The selected adapter is not enabled on this server.' } },
          },
          capacity: { available: true, reason: null },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/apps/test-app']}>
        <Routes><Route path="/apps/:slug" element={<AppDetailPage />} /></Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByLabelText(/test-target/));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    expect(await screen.findByText(/this target cannot install the selected version/i)).toBeTruthy();
    const unsupportedSummary = screen.getByText(/operations unsupported for this version and target \(1\)/i);
    fireEvent.click(unsupportedSummary);
    expect(unsupportedSummary.closest('details')?.querySelector('li')?.textContent)
      .toContain('install: The selected adapter is not enabled on this server.');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/app-installations/capabilities',
      expect.objectContaining({ method: 'POST' }),
    );
    const requestButton = screen.getByRole('button', { name: 'Request installation' });
    expect(requestButton.hasAttribute('disabled')).toBe(true);
  });
});
