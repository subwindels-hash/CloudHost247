// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminMarketingIntegrationsPage from '../../src/pages/AdminMarketingIntegrationsPage';
import { setSession, clearSession } from '../../src/lib/auth';
import * as marketing from '../../src/lib/marketing';

const config = { displayName: 'GA4', websiteDomain: 'example.com', enabled: false, measurementId: 'G-1234567890', testMode: false, revision: 1, lastConfigurationUpdate: null, lastConfigurationTestAt: null, lastConfigurationTestStatus: null, installationStatus: 'code_installed', connectionStatus: 'not_verified' };
beforeEach(() => {
  setSession('test', { id: 'admin', email: 'admin@example.test', fullName: 'Admin', role: 'admin' });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith('/test') ? { message: 'Google was not contacted.' } : url.endsWith('/audit') ? { entries: [] } : { configuration: config } })));
});
afterEach(() => { cleanup(); clearSession(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders the GA4 settings without claiming that tracking is available, and saves through the API', async () => {
  render(<MemoryRouter initialEntries={['/admin/marketing-integrations/google-analytics']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText(/Delivery to Google has not been verified/)).toBeTruthy();
  expect((screen.getByLabelText(/Enable Google Analytics/) as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(screen.getByLabelText(/I disabled user-provided data collection/));
  fireEvent.change(screen.getByLabelText('GA4 Measurement ID'), { target: { value: 'G-ABCDEFGHIJ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url, init]) => String(url).endsWith('/google-analytics') && (init as RequestInit)?.method === 'PUT' && JSON.parse(String((init as RequestInit).body)).configuration.measurementId === 'G-ABCDEFGHIJ' && JSON.parse(String((init as RequestInit).body)).configuration.userDataReviewed === true)).toBe(true));
  expect(await screen.findByText(/Google receipt is not verified/i)).toBeTruthy();
});

it('shows that legacy enabled configurations need the new privacy review', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith('/audit') ? { entries: [] } : { configuration: { ...config, enabled: true, streamReviewed: true } } })));
  render(<MemoryRouter initialEntries={['/admin/marketing-integrations/google-analytics']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('Blocked: privacy review required')).toBeTruthy();
  expect((screen.getByLabelText(/I disabled user-provided data collection/) as HTMLInputElement).checked).toBe(false);
});

it('does not describe expired analytics consent as permitted', async () => {
  const consent = { preferences: { essential: true as const, analytics: true, marketing: false }, decided: true, marketingGranted: false, jurisdiction: null, requiresOptIn: true, policyVersion: 1, csrfToken: 'x', expiresAt: '2000-01-01T00:00:00.000Z' };
  vi.spyOn(marketing, 'useMarketing').mockReturnValue({ ready: true, initializedPixel: null, error: null, configuration: null, consent });
  render(<MemoryRouter initialEntries={['/admin/marketing-integrations/google-analytics']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('Consent restricted for this browser')).toBeTruthy();
  expect(screen.queryByText('Analytics permitted for this browser')).toBeNull();
});

it('shows a revision-scoped local validation and recent audit actions without claiming provider verification', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => url.endsWith('/audit') ? { entries: [{ id: 'audit-1', action: 'marketing.google_analytics.configuration_tested', actor_id: 'admin-id', created_at: '2026-11-08T10:00:00.000Z' }] } : { configuration: { ...config, lastSuccessfulLocalTestAt: '2026-11-08T10:00:00.000Z' } } })));
  render(<MemoryRouter initialEntries={['/admin/marketing-integrations/google-analytics']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText('Local configuration tested')).toBeTruthy();
  expect(screen.getByText('admin-id')).toBeTruthy();
  expect(screen.getByText(/format only; Google was not contacted/)).toBeTruthy();
  expect(screen.getByText('Never — this test does not contact Google.')).toBeTruthy();
});

it('reports a failed audit load without hiding settings and allows a retry', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/audit') && fail ? { ok: false, status: 500, json: async () => ({ message: 'failure' }) } : { ok: true, status: 200, json: async () => url.endsWith('/audit') ? { entries: [] } : { configuration: config } }));
  render(<MemoryRouter initialEntries={['/admin/marketing-integrations/google-analytics']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByText(/Audit history could not be loaded/)).toBeTruthy();
  expect(screen.getByLabelText('GA4 Measurement ID')).toBeTruthy();
  fail = false; fireEvent.click(screen.getByRole('button', { name: 'Retry audit history' }));
  expect(await screen.findByText('No configuration audit entries yet.')).toBeTruthy();
});

it('does not overwrite a newer audit refresh with an older response', async () => {
  let completeOld!: (response: unknown) => void; let auditCalls = 0;
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (url.endsWith('/audit')) {
      auditCalls++;
      if (auditCalls === 1) return new Promise(resolve => { completeOld = resolve; });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ entries: [{ id: 'new', action: 'marketing.google_analytics.configuration_saved', actor_id: 'new-admin', created_at: '2026-11-08' }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ configuration: config }) });
  }));
  render(<MemoryRouter initialEntries={['/admin/marketing-integrations/google-analytics']}><Routes><Route path="/admin/marketing-integrations/:provider" element={<AdminMarketingIntegrationsPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByLabelText('GA4 Measurement ID')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(await screen.findByText('new-admin')).toBeTruthy();
  await act(async () => completeOld({ ok: true, status: 200, json: async () => ({ entries: [{ id: 'old', action: 'marketing.google_analytics.configuration_saved', actor_id: 'old-admin', created_at: '2026-11-07' }] }) }));
  expect(screen.getByText('new-admin')).toBeTruthy(); expect(screen.queryByText('old-admin')).toBeNull();
});
