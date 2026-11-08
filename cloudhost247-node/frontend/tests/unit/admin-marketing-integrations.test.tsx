// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminMarketingIntegrationsPage from '../../src/pages/AdminMarketingIntegrationsPage';
import { META_ADMIN_API } from '../../src/lib/marketing-admin-api';
import { setSession, clearSession } from '../../src/lib/auth';

const config = { providerKey: 'meta_pixel', displayName: 'CloudHost247 Meta Pixel', websiteDomain: 'cloudhost247.com', enabled: false, pixelId: '123456789012345', testMode: false, testEventCode: null, consentPolicy: 'global_opt_in', capi: { enabled: false, apiVersion: 'v26.0', hasToken: true }, revision: 2, lastConfigurationUpdate: null, lastConfigurationTestAt: null, lastConfigurationTestStatus: null, lastError: null };
function page() { return render(<MemoryRouter initialEntries={['/admin/marketing-integrations/meta-pixel']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>); }
describe('Marketing Integrations admin', () => {
  beforeEach(() => {
    setSession('test', { id: 'admin', email: 'admin@example.test', fullName: 'Admin', role: 'admin' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith('/activity') ? { events: [] } : url.endsWith('/audit') ? { entries: [] } : url.endsWith('/test') ? { message: 'Saved configuration is valid. This test did not contact Meta.' } : { configuration: config } })));
  });
  afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals(); });
  it('shows dedicated settings, honest status and no token value', async () => {
    page(); expect(await screen.findByRole('heading', { name: 'Marketing Integrations' })).toBeTruthy();
    expect(screen.getByLabelText(/^Pixel ID/)).toBeTruthy();
    expect(screen.getByText(/Stored encrypted; write-only/)).toBeTruthy();
    expect(screen.getByText('Not tested', { exact: false })).toBeTruthy();
    expect(screen.getByLabelText(/^Meta access token/).getAttribute('type')).toBe('password');
    expect(screen.getByLabelText(/^Meta access token/).getAttribute('value')).toBe('');
  });
  it('saves test mode through the protected API and reports no fabricated receipt', async () => {
    page(); fireEvent.click(await screen.findByLabelText('Enable test mode'));
    fireEvent.change(screen.getByLabelText('Test Event Code'), { target: { value: 'TEST123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith(META_ADMIN_API) && (init as RequestInit)?.method === 'PUT')).toBe(true));
    const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith(META_ADMIN_API) && (init as RequestInit)?.method === 'PUT')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ expectedRevision: 2, configuration: { testMode: true, testEventCode: 'TEST123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test configuration' }));
    expect(await screen.findByText(/did not contact Meta/)).toBeTruthy();
  });
  it('requires reset confirmation and sends the exact acknowledgement', async () => {
    page(); fireEvent.click(await screen.findByRole('button', { name: 'Reset integration' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/reset'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reset' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/reset') && JSON.parse(String((init as RequestInit).body)).confirmation === 'RESET')).toBe(true));
  });
  it('legacy import requires review and keeps tracking disabled', async () => {
    page(); fireEvent.change(await screen.findByLabelText('Legacy Pixel ID'), { target: { value: '987654321098765' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review legacy import' }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import disabled configuration' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/import-legacy') && JSON.parse(String((init as RequestInit).body)).confirmImport === true)).toBe(true));
    expect(await screen.findByText(/imported with tracking disabled/)).toBeTruthy();
  });
});
