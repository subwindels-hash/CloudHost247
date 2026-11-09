// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminMarketingIntegrationsPage from '../../src/pages/AdminMarketingIntegrationsPage';
import { TIKTOK_ADMIN_API } from '../../src/lib/marketing-admin-api';
import { setSession, clearSession } from '../../src/lib/auth';

const config = { providerKey: 'tiktok_pixel', displayName: 'CloudHost247 TikTok Pixel', websiteDomain: 'cloudhost247.com', enabled: false, pixelId: 'C4A7B2D9E1F0A3B5C6D7', testMode: false, testEventCode: null, remarketingEnabled: false, enabledEvents: ['PageView', 'CompletePayment', 'Contact', 'Subscribe'], eventsApi: { enabled: false, hasToken: false }, revision: 2, lastConfigurationUpdate: null, lastConfigurationTestAt: null, lastConfigurationTestStatus: null, lastError: null };
const diagnostics = { pixelId: config.pixelId, enabled: false, installationStatus: 'configured_disabled', pixelInitialization: 'runtime', consentConfiguration: 'shared', eventsApiConnection: 'disabled', enabledEvents: config.enabledEvents, lastSuccessfulTest: null, lastServerDeliveryStatus: null, lastServerDeliveredAt: null, eventsRecorded: 0, duplicateEventWarnings: 0 };
function page(path = '/admin/integrations/tiktok-pixel') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/admin/integrations/tiktok-pixel" element={<AdminMarketingIntegrationsPage />} /><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
}
describe('TikTok Pixel admin page', () => {
  beforeEach(() => {
    setSession('test', { id: 'admin', email: 'admin@example.test', fullName: 'Admin', role: 'admin' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => String(url).endsWith('/diagnostics') ? { configuration: config, diagnostics }
        : String(url).endsWith('/activity') ? { events: [] }
        : String(url).endsWith('/test') ? { message: 'Saved configuration is valid. Verify browser events in TikTok Events Manager (Test Events); this test did not contact TikTok.' }
        : { configuration: config },
    })));
  });
  afterEach(() => { cleanup(); clearSession(); vi.unstubAllGlobals(); });

  it('renders the dedicated TikTok settings, event toggles and honest diagnostics at /admin/integrations/tiktok-pixel', async () => {
    page();
    expect(await screen.findByRole('heading', { name: 'TikTok Pixel' })).toBeTruthy();
    expect(screen.getByLabelText(/TikTok Pixel ID/)).toBeTruthy();
    expect(screen.getByLabelText(/TikTok access token/).getAttribute('type')).toBe('password');
    expect(screen.getByLabelText(/CompletePayment/)).toBeTruthy();
    expect(screen.getByLabelText(/Subscribe \(lead\)/)).toBeTruthy();
    expect(screen.getByText(/pending external TikTok account configuration/)).toBeTruthy();
    expect(screen.getByText('Diagnostics')).toBeTruthy();
  });

  it('also renders via the marketing-integrations tab route', async () => {
    page('/admin/marketing-integrations/tiktok-pixel');
    expect(await screen.findByRole('heading', { name: 'TikTok Pixel' })).toBeTruthy();
  });

  it('saves through the protected TikTok API with revision checking', async () => {
    page();
    fireEvent.click(await screen.findByLabelText('Enable TikTok Pixel for consented visitors'));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith(TIKTOK_ADMIN_API) && (init as RequestInit)?.method === 'PUT')).toBe(true));
    const call = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith(TIKTOK_ADMIN_API) && (init as RequestInit)?.method === 'PUT')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toMatchObject({ expectedRevision: 2, configuration: { enabled: true, pixelId: config.pixelId } });
    fireEvent.click(screen.getByRole('button', { name: 'Test configuration' }));
    expect(await screen.findByText(/did not contact TikTok/)).toBeTruthy();
  });
});
