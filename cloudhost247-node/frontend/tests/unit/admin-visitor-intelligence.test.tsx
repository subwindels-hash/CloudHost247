// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminVisitorIntelligencePage from '../../src/pages/AdminVisitorIntelligencePage';
import { clearSession, setSession } from '../../src/lib/auth';

const settings = {
  enabled: true,
  retentionDays: 90,
  idleAfterSeconds: 120,
  onlineTimeoutSeconds: 120,
  updatedAt: '2026-11-09T12:00:00.000Z',
};
const overview = {
  range: { label: 'today', from: '2026-11-09T00:00:00.000Z', to: '2026-11-10T00:00:00.000Z' },
  tracking: settings,
  stats: { currentlyOnline: 1, activeVisitors: 1, uniqueVisitors: 3, newVisitors: 2, returningVisitors: 1, pageViews: 8, pageViewsToday: 8 },
  topPages: [{ pagePath: '/hosting', pageViews: 5, visitors: 3 }],
  countries: [{ countryName: 'United Kingdom', countryCode: 'GB', visitors: 3, sessions: 3, pageViews: 8 }],
  cities: [{ cityName: 'London', regionName: 'England', countryName: 'United Kingdom', countryCode: 'GB', visitors: 3, sessions: 3, latitude: 51.5, longitude: -0.1 }],
  referrers: [{ source: 'Google', host: 'google.com', visitors: 1, sessions: 1 }],
  devices: [{ label: 'desktop', visitors: 2, sessions: 2 }],
  browsers: [{ label: 'Chrome', visitors: 2, sessions: 2 }],
  operatingSystems: [{ label: 'Windows', visitors: 2, sessions: 2 }],
  timeseries: [{ bucket: '2026-11-09T11:00:00.000Z', visitors: 2, pageViews: 5 }],
};
const onlineVisitor = {
  visitorId: '11111111-1111-4111-8111-111111111111',
  sessionId: '22222222-2222-4222-8222-222222222222',
  status: 'online' as const,
  country: 'United Kingdom', countryCode: 'GB', region: 'England', city: 'London',
  currentPage: '/hosting', currentPages: ['/hosting'], device: 'desktop', browser: 'Chrome', operatingSystem: 'Windows',
  referrerHost: 'google.com', firstSeenAt: '2026-11-09T11:58:00.000Z',
  lastActivityAt: '2026-11-09T11:59:00.000Z', lastHeartbeatAt: '2026-11-09T11:59:30.000Z',
  visitDurationSeconds: 120, openTabs: 1,
  journey: [{ pagePath: '/hosting', occurredAt: '2026-11-09T11:58:00.000Z' }],
};

function jsonResponse(status: number, body: unknown) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? 'Unavailable' : 'OK',
    headers: { get: (name: string) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    text: async () => text,
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;
let requestUrls: string[];
let settingsRequests: Array<{ method: string; body?: unknown }>;

beforeEach(() => {
  localStorage.clear();
  setSession('admin-token', { id: 'admin1', email: 'admin@example.test', fullName: 'Admin User', role: 'admin' });
  requestUrls = [];
  settingsRequests = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    requestUrls.push(url);
    if (url.includes('/stream')) return jsonResponse(503, { error: 'UNAVAILABLE', message: 'Stream unavailable' });
    if (url.includes('/overview')) return jsonResponse(200, overview);
    if (url.includes('/map')) return jsonResponse(200, {
      range: overview.range,
      locations: [{ countryName: 'United Kingdom', countryCode: 'GB', regionName: 'England', cityName: 'London', latitude: 51.5, longitude: -0.1, visitors: 3, online: 1 }],
      countries: overview.countries,
    });
    if (url.includes('/online')) return jsonResponse(200, { generatedAt: '2026-11-09T12:00:00.000Z', visitors: [onlineVisitor], count: 1 });
    if (url.includes('/countries/GB')) return jsonResponse(200, {
      countryCode: 'GB', countryName: 'United Kingdom', visitors: 3, sessions: 3, pageViews: 8,
      cities: overview.cities, topPages: overview.topPages,
    });
    if (url.includes('/settings') && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body));
      settingsRequests.push({ method: 'PATCH', body });
      return jsonResponse(200, { settings: { ...settings, ...body, updatedAt: '2026-11-09T12:01:00.000Z' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  clearSession();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function renderDashboard() {
  return render(<MemoryRouter><AdminVisitorIntelligencePage /></MemoryRouter>);
}

describe('Admin Visitor Intelligence dashboard', () => {
  it('renders aggregate reports, approximate locations, online visitors, journey, and privacy settings', async () => {
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Visitor Intelligence' })).toBeTruthy();
    const metrics = screen.getByRole('region', { name: 'Visitor summary' });
    expect(within(metrics).getByText('Unique visitors')).toBeTruthy();
    expect(within(metrics).getByText('3', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Traffic over time' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Approximate visitor map' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /London, England, United Kingdom: 3 visitors, 1 online/ })).toBeTruthy();
    expect(await screen.findAllByText('/hosting', { selector: 'code' })).not.toHaveLength(0);
    expect(await screen.findByText('Privacy, collection and retention')).toBeTruthy();

    const visitor = await screen.findByText('Active');
    const row = visitor.closest('details');
    expect(row).toBeTruthy();
    await userEvent.click(within(row as HTMLElement).getByText('Active'));
    expect(await within(row as HTMLElement).findByText('Recent journey')).toBeTruthy();
    expect(within(row as HTMLElement).getByText(/google\.com/)).toBeTruthy();
  });

  it('fetches country detail on map selection, filters custom date ranges, and saves validated operator settings', async () => {
    renderDashboard();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Visitor Intelligence' });

    await user.click(await screen.findByRole('button', { name: /London, England, United Kingdom/ }));
    expect((await screen.findAllByText('Cities / regions')).length).toBeGreaterThan(0);
    await waitFor(() => expect(requestUrls.some((url) => url.includes('/countries/GB?range=today'))).toBe(true));

    await user.selectOptions(screen.getByLabelText('Date range'), '7d');
    await waitFor(() => expect(requestUrls.some((url) => url.endsWith('/overview?range=7d'))).toBe(true));
    await user.selectOptions(screen.getByLabelText('Date range'), 'custom');
    expect(screen.getByText(/Choose a valid start and end date/)).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Date range'), 'today');
    await screen.findByRole('button', { name: 'Save Visitor Intelligence settings' });
    const retention = screen.getByLabelText(/Retention period \(days\)/);
    await user.clear(retention);
    await user.type(retention, '30');
    await user.click(screen.getByRole('button', { name: 'Save Visitor Intelligence settings' }));
    await waitFor(() => expect(settingsRequests).toHaveLength(1));
    expect(settingsRequests[0]?.body).toMatchObject({ retentionDays: 30, enabled: true, idleAfterSeconds: 120, onlineTimeoutSeconds: 120 });
    expect(await screen.findByText('Visitor Intelligence is enabled for analytics-consented visits.')).toBeTruthy();
  });
});
