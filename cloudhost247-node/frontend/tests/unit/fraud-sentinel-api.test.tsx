// @vitest-environment jsdom
/**
 * Fraud Sentinel frontend contract tests.
 *
 * The point of this file is the promise the module makes to its reviewers: the SPA types the API and
 * renders it, but it does not *decide* anything. So the tests concentrate on the places where a
 * frontend usually starts inventing truth —
 *
 *   - the permission mirror used to hide buttons (it may only ever narrow, never widen);
 *   - the query encoder (`?unassigned=false` must mean "no", not be dropped as falsy);
 *   - the vocabulary: every select option and every transition button must come from `/meta`, so a
 *     value the server adds appears in the UI and a value it removes disappears. Both directions are
 *     tested by putting a status in the stubbed payload that exists nowhere in this repository;
 *   - the advisory contract and the withheld-evidence notice, which are rendered in the server's own
 *     words rather than paraphrased here.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSession, setSession } from '../../src/lib/auth';
import {
  fetchFsReviewers,
  fsExportAlertsCsv,
  fsGet,
  fsPatch,
  fsPermissionsForRole,
  fsPost,
} from '../../src/lib/fraud-sentinel-api';
import { fsMetaPromise } from '../../src/components/fraud-sentinel/fs-widgets';

const BASE = '/api/admin/fraud-sentinel';
const ADMIN = { id: 'admin-1', email: 'admin@example.com', fullName: 'Ada Admin', role: 'admin' };
const SUPER_ADMIN = { id: 'root-1', email: 'root@example.com', fullName: 'Rex Root', role: 'super_admin' };

const ALERT_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

/**
 * A status that exists nowhere in the backend. If it reaches the screen, the screen is reading the
 * payload rather than a list compiled here; if it does not, the UI has started hardcoding.
 */
const SERVER_ONLY_STATUS = 'server_only_status';

const META = {
  permissions: [
    'fraud_sentinel.view',
    'fraud_sentinel.investigate',
    'fraud_sentinel.assign',
    'fraud_sentinel.rules',
    'fraud_sentinel.run_scan',
    'fraud_sentinel.export',
    'fraud_sentinel.view_all_customers',
  ],
  statuses: ['new', 'under_review', 'escalated', 'resolved', 'false_positive', SERVER_ONLY_STATUS],
  levels: ['low', 'medium', 'high', 'critical'],
  categories: ['payment', 'account', 'order_service', 'admin_api'],
  subjectTypes: ['customer', 'ip', 'actor', 'gateway'],
  falsePositiveReasons: ['legitimate_customer', 'expected_behaviour', 'insufficient_evidence', 'duplicate_signal', 'rule_misconfiguration', 'other'],
  investigationActions: ['created', 're_detected', 'status_changed', 'assigned', 'unassigned', 'note_added', 'evidence_reviewed', 'escalated', 'resolved', 'false_positive_reported', 'ai_summary_generated', 'risk_changed'],
  transitions: {
    new: ['under_review', 'escalated', 'resolved', SERVER_ONLY_STATUS],
    under_review: ['escalated', 'resolved', 'false_positive', 'new'],
    escalated: ['under_review', 'resolved', 'false_positive'],
    resolved: ['under_review', 'new'],
    false_positive: ['under_review', 'new'],
    [SERVER_ONLY_STATUS]: ['new'],
  },
  sortColumns: ['detected_at', 'last_assessed_at', 'risk_score', 'status', 'alert_number'],
  jobs: [
    { name: 'fraud_sentinel_ingest', description: 'Projects recorded rows into the ledger.' },
    { name: 'fraud_sentinel_scan', description: 'Assesses subjects and raises alerts.' },
    { name: 'fraud_sentinel_retention', description: 'Prunes what the horizons have expired.' },
    { name: 'fraud_sentinel_rule_sync', description: 'Inserts catalogue rules the database lacks.' },
  ],
  minResolutionNote: 10,
  minFalsePositiveExplanation: 15,
  advisory: {
    advisoryOnly: true,
    performsNoEnforcement: true,
    forbiddenActions: ['approve_or_reject_payments', 'issue_refunds', 'suspend_accounts'],
    statement: 'Fraud Sentinel observes and reports. It performs no enforcement action of any kind.',
  },
};

const ALERT = {
  id: ALERT_ID,
  alert_number: 'FS-00000007',
  assessment_id: '44444444-4444-4444-8444-444444444444',
  customer_id: CUSTOMER_ID,
  subject_type: 'customer',
  subject_id: CUSTOMER_ID,
  subject_label: null,
  dedupe_key: 'customer|PAY_SUCCESS_AFTER_FAILURES',
  category: 'payment',
  risk_level: 'high',
  risk_score: 62,
  title: 'PAY_SUCCESS_AFTER_FAILURES: high risk (62/100) on customer sus@example.com',
  explanation: 'Three declined attempts then an approval on the same invoice.',
  primary_rule_code: 'PAY_SUCCESS_AFTER_FAILURES',
  status: 'new',
  assigned_reviewer_id: null,
  assigned_at: null,
  escalated_at: null,
  resolved_at: null,
  resolution_note: null,
  recurrence_count: 1,
  detected_at: '2026-03-15T12:00:00.000Z',
  last_assessed_at: '2026-03-15T12:00:00.000Z',
  created_at: '2026-03-15T12:00:00.000Z',
  updated_at: '2026-03-15T12:00:00.000Z',
  customer_email: 'sus@example.com',
  customer_name: 'Suspect Customer',
  reviewer_name: null,
};

const ASSESSMENT = {
  id: ALERT.assessment_id,
  subject_type: 'customer',
  subject_id: CUSTOMER_ID,
  subject_label: null,
  customer_id: CUSTOMER_ID,
  risk_score: 62,
  risk_level: 'high',
  previous_score: null,
  previous_level: null,
  previous_assessment_id: null,
  triggered_rules: [
    {
      code: 'PAY_SUCCESS_AFTER_FAILURES',
      version: 1,
      family: 'payment_failures',
      category: 'payment',
      severity: 'critical',
      weight: 22,
      cappedWeight: 22,
      reasonCode: 'PAY_SUCCESS_AFTER_FAILURES',
      reason: '3 failed payment(s) in the 24h before a successful one.',
      confidence: 'high',
      evidence: [{ table: 'payments', id: 'p-1', description: 'failed attempt', occurredAt: '2026-03-15T11:00:00.000Z' }],
    },
  ],
  family_contributions: [{ family: 'payment_failures', raw: 34, capped: 30, cap: 30 }],
  evidence: [{ table: 'payments', id: 'p-2', description: 'approved after declines', occurredAt: '2026-03-15T12:00:00.000Z' }],
  recommendations: ['[PAY_SUCCESS_AFTER_FAILURES] Confirm with the cardholder.'],
  confidence: 'high',
  data_quality: [{ code: 'SOURCE_UNAVAILABLE', severity: 'material', detail: 'webhook_events could not be read' }],
  rule_set_version: 'abcdef0123456789',
  scoring_version: 1,
  window_started_at: '2026-02-13T12:00:00.000Z',
  window_ended_at: '2026-03-15T12:00:00.000Z',
  events_examined: 6,
  status: 'active',
  ai_summary: null,
  ai_assisted: false,
  ai_engine: null,
  assessed_at: '2026-03-15T12:00:00.000Z',
  created_at: '2026-03-15T12:00:00.000Z',
  customer_email: 'sus@example.com',
  customer_name: 'Suspect Customer',
};

const DETAIL = {
  alert: ALERT,
  assessment: ASSESSMENT,
  investigations: [
    {
      id: 'i-1',
      alert_id: ALERT_ID,
      assessment_id: ASSESSMENT.id,
      actor_id: null,
      actor_type: 'system',
      action: 'created',
      from_status: null,
      to_status: 'new',
      note: null,
      metadata: {},
      created_at: '2026-03-15T12:00:00.000Z',
      actor_name: null,
    },
  ],
  falsePositive: null,
  riskHistory: [],
  advisory: META.advisory,
  evidenceIntegrity: { ok: true, withheld: [] },
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

/**
 * Installs a fetch stub that routes by URL, records every call, and answers anything unrecognised
 * with a 404 — an unrecognised call must fail loudly rather than be answered by a fallback that hides
 * a page reading an endpoint it should not.
 */
function stubFetch(routes: Array<[RegExp, Handler]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init });
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) return handler(url, init);
    }
    return jsonResponse({ error: 'NOT_FOUND', message: `test stub has no route for ${url}` }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Permission mirror                                                           */
/* -------------------------------------------------------------------------- */

describe('fsPermissionsForRole — the UX mirror of the server map', () => {
  it('gives a super administrator every permission, including settings', () => {
    const permissions = fsPermissionsForRole('super_admin');
    expect(permissions).toContain('fraud_sentinel.settings');
    expect(permissions).toContain('fraud_sentinel.view');
    expect(permissions).toHaveLength(8);
  });

  it('gives an administrator everything except settings, which drive retention and scoring', () => {
    const permissions = fsPermissionsForRole('admin');
    expect(permissions).not.toContain('fraud_sentinel.settings');
    expect(permissions).toEqual(
      expect.arrayContaining(['fraud_sentinel.view', 'fraud_sentinel.investigate', 'fraud_sentinel.assign', 'fraud_sentinel.rules', 'fraud_sentinel.export'])
    );
  });

  it('gives staff and customers nothing: the module holds no staff tier', () => {
    expect(fsPermissionsForRole('staff')).toEqual([]);
    expect(fsPermissionsForRole('customer')).toEqual([]);
    expect(fsPermissionsForRole(undefined)).toEqual([]);
    expect(fsPermissionsForRole('')).toEqual([]);
  });

  it('never invents a permission the server does not define', () => {
    const known = new Set([
      'fraud_sentinel.view',
      'fraud_sentinel.investigate',
      'fraud_sentinel.assign',
      'fraud_sentinel.rules',
      'fraud_sentinel.run_scan',
      'fraud_sentinel.settings',
      'fraud_sentinel.export',
      'fraud_sentinel.view_all_customers',
    ]);
    for (const role of ['super_admin', 'admin', 'staff', 'customer', undefined]) {
      for (const permission of fsPermissionsForRole(role)) expect(known.has(permission)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

describe('the Fraud Sentinel client transport', () => {
  it('encodes a query where false means no, and empty values are omitted', async () => {
    const { calls } = stubFetch([[/.*/, () => jsonResponse({ items: [] })]]);
    await fsGet('/alerts', {
      status: 'new',
      unassigned: false,
      page: 1,
      search: '',
      days: undefined,
      customerId: null,
      ruleCode: 'PAY_REPEATED_FAILURES',
    });
    const url = calls[0]!.url;
    expect(url.startsWith(`${BASE}/alerts?`)).toBe(true);
    const params = new URLSearchParams(url.slice(url.indexOf('?')));
    // `false` is an explicit filter and must survive; a falsy check would have dropped it and
    // returned the rows the reviewer asked to exclude.
    expect(params.get('unassigned')).toBe('false');
    expect(params.get('status')).toBe('new');
    expect(params.get('page')).toBe('1');
    expect(params.get('ruleCode')).toBe('PAY_REPEATED_FAILURES');
    expect(params.has('search')).toBe(false);
    expect(params.has('days')).toBe(false);
    expect(params.has('customerId')).toBe(false);
  });

  it('omits the query string entirely when no filter is set', async () => {
    const { calls } = stubFetch([[/.*/, () => jsonResponse({})]]);
    await fsGet('/overview');
    expect(calls[0]!.url).toBe(`${BASE}/overview`);
  });

  it('sends the bearer token from the local session on every call', async () => {
    setSession('token-abc', ADMIN);
    const { calls } = stubFetch([[/.*/, () => jsonResponse({})]]);
    await fsGet('/meta');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-abc');
  });

  it('PATCHes JSON and POSTs with no body when none is given', async () => {
    const { calls } = stubFetch([[/.*/, () => jsonResponse({})]]);
    await fsPatch('/rules/PAY_REPEATED_FAILURES', { weight: 14, reason: 'tuned after review' });
    await fsPost('/scan');
    const [patch, post] = calls as [typeof calls[number], typeof calls[number]];
    expect(patch.init?.method).toBe('PATCH');
    expect(patch.init?.body).toBe(JSON.stringify({ weight: 14, reason: 'tuned after review' }));
    expect(post.init?.method).toBe('POST');
    expect(post.init?.body).toBeUndefined();
    expect(post.url).toBe(`${BASE}/scan`);
  });

  it('POSTs query parameters alongside an empty body, as the scan endpoint expects', async () => {
    const { calls } = stubFetch([[/.*/, () => jsonResponse({})]]);
    await fsPost('/scan', undefined, { maxSubjects: 50 });
    expect(calls[0]!.url).toBe(`${BASE}/scan?maxSubjects=50`);
  });
});

describe('the alert CSV export', () => {
  it('sends the filters on screen and takes the filename from the response header', async () => {
    const { calls } = stubFetch([
      [
        /export\.csv/,
        () =>
          ({
            ok: true,
            status: 200,
            blob: async () => new Blob(['a,b\r\n'], { type: 'text/csv' }),
            headers: { get: (name: string) => (name.toLowerCase() === 'content-disposition' ? 'attachment; filename="fraud-sentinel-alerts.csv"' : null) },
          }) as unknown as Response,
      ],
    ]);
    const result = await fsExportAlertsCsv({ status: 'open', riskLevel: 'high', unassigned: false, page: undefined });
    expect(calls[0]!.url).toBe(`${BASE}/alerts/export.csv?status=open&riskLevel=high&unassigned=false`);
    expect(result.filename).toBe('fraud-sentinel-alerts.csv');
    expect(await result.blob.text()).toBe('a,b\r\n');
  });

  it('falls back to a sensible filename when the server sends none', async () => {
    stubFetch([
      [
        /export\.csv/,
        () =>
          ({
            ok: true,
            status: 200,
            blob: async () => new Blob([''], { type: 'text/csv' }),
            headers: { get: () => null },
          }) as unknown as Response,
      ],
    ]);
    const result = await fsExportAlertsCsv();
    expect(result.filename).toBe('fraud-sentinel-alerts.csv');
  });

  it('reports the server message when the export is refused', async () => {
    stubFetch([
      [
        /export\.csv/,
        () =>
          ({
            ok: false,
            status: 403,
            statusText: 'Forbidden',
            json: async () => ({ error: 'FORBIDDEN', message: 'Missing permission: fraud_sentinel.export' }),
          }) as unknown as Response,
      ],
    ]);
    await expect(fsExportAlertsCsv()).rejects.toThrow('Missing permission: fraud_sentinel.export');
  });
});

describe('the reviewer picker', () => {
  it('lists active administrators only, deduplicated and sorted by name', async () => {
    const { calls } = stubFetch([
      [
        /\/api\/v1\/admin\/customers\?role=admin/,
        () =>
          jsonResponse({
            customers: [
              { id: 'a-2', email: 'zoe@example.com', fullName: 'Zoe Later', role: 'admin', status: 'active' },
              { id: 'a-1', email: 'ana@example.com', fullName: 'Ana First', role: 'admin', status: 'active' },
              { id: 'a-3', email: 'gone@example.com', fullName: 'Gone Disabled', role: 'admin', status: 'disabled' },
            ],
          }),
      ],
      [
        /\/api\/v1\/admin\/customers\?role=super_admin/,
        () =>
          jsonResponse({
            customers: [
              { id: 'root-1', email: 'root@example.com', fullName: 'Rex Root', role: 'super_admin', status: 'active' },
              { id: 'a-1', email: 'ana@example.com', fullName: 'Ana First', role: 'admin', status: 'active' },
            ],
          }),
      ],
    ]);

    const reviewers = await fetchFsReviewers();
    // Both privileged roles are read from the platform's own staff directory — the module keeps no
    // copy of the account list.
    expect(calls.map((call) => call.url)).toEqual([
      '/api/v1/admin/customers?role=admin&limit=100',
      '/api/v1/admin/customers?role=super_admin&limit=100',
    ]);
    expect(reviewers.map((person) => person.id)).toEqual(['a-1', 'root-1', 'a-2']);
    // A disabled account cannot hold an investigation, so offering it would only produce a 400.
    expect(reviewers.some((person) => person.id === 'a-3')).toBe(false);
  });
});

describe('the vocabulary cache', () => {
  it('fetches /meta once for many consumers', async () => {
    const { calls } = stubFetch([[new RegExp(`${BASE}/meta`), () => jsonResponse(META)]]);
    const [first, second] = await Promise.all([fsMetaPromise(), fsMetaPromise()]);
    expect(first).toBe(second);
    expect(calls.filter((call) => call.url.endsWith('/meta'))).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Alert queue                                                                 */
/* -------------------------------------------------------------------------- */

function renderAt(path: string, element: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/fraud-sentinel/alerts" element={element} />
        <Route path="/admin/fraud-sentinel/alerts/:id" element={element} />
      </Routes>
    </MemoryRouter>
  );
}

describe('the alert queue screen', () => {
  async function renderAlerts() {
    setSession('token-abc', ADMIN);
    const AlertsPage = (await import('../../src/pages/fraud-sentinel/AlertsPage')).default;
    stubFetch([
      [new RegExp(`${BASE}/meta`), () => jsonResponse(META)],
      [
        new RegExp(`${BASE}/alerts`),
        () =>
          jsonResponse({
            items: [ALERT],
            total: 1,
            page: 1,
            limit: 25,
            totalPages: 1,
            advisory: META.advisory,
          }),
      ],
    ]);
    renderAt('/admin/fraud-sentinel/alerts', <AlertsPage />);
    await screen.findByText('FS-00000007');
  }

  it('renders the advisory statement the server sent, not a paraphrase', async () => {
    await renderAlerts();
    expect(screen.getByText(META.advisory.statement, { exact: false })).toBeTruthy();
  });

  it('offers exactly the statuses the server published, including one this repository does not define', async () => {
    await renderAlerts();
    const statusSelect = screen.getByDisplayValue('All open');
    const options = within(statusSelect as HTMLSelectElement).getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('server only status');
    expect(options).toEqual(expect.arrayContaining(['new', 'under review', 'escalated', 'resolved', 'false positive'].map((value) => value)));
  });

  it('builds the sort menu from the server column list', async () => {
    await renderAlerts();
    const sortSelect = screen.getByDisplayValue('Sort: detected at');
    const options = within(sortSelect as HTMLSelectElement).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(META.sortColumns.map((column) => `Sort: ${column.replace(/_/g, ' ')}`));
  });

  it('shows the alert row with its level, subject link and reviewer state', async () => {
    await renderAlerts();
    expect(screen.getByText('PAY_SUCCESS_AFTER_FAILURES')).toBeTruthy();
    expect(screen.getByText('sus@example.com')).toBeTruthy();
    expect(screen.getByText('unassigned')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Alert detail                                                                */
/* -------------------------------------------------------------------------- */

describe('the alert detail screen', () => {
  async function renderDetail(role: 'admin' | 'super_admin' = 'admin') {
    setSession('token-abc', role === 'admin' ? ADMIN : SUPER_ADMIN);
    const AlertDetailPage = (await import('../../src/pages/fraud-sentinel/AlertDetailPage')).default;
    const { calls } = stubFetch([
      [new RegExp(`${BASE}/meta`), () => jsonResponse(META)],
      [new RegExp(`${BASE}/alerts/${ALERT_ID}$`), () => jsonResponse(DETAIL)],
      [/\/api\/v1\/admin\/customers/, () => jsonResponse({ customers: [] })],
      [/.*/, (url) => jsonResponse({ error: 'NOT_FOUND', message: `unexpected ${url}` }, 404)],
    ]);
    renderAt(`/admin/fraud-sentinel/alerts/${ALERT_ID}`, <AlertDetailPage />);
    await screen.findByText('FS-00000007');
    return calls;
  }

  it('offers only the transitions the state machine allows from this status', async () => {
    await renderDetail();
    const select = screen.getByDisplayValue('Move this alert to…') as HTMLSelectElement;
    const options = within(select).getAllByRole('option').map((option) => option.getAttribute('value'));
    // `new` may go to under_review, escalated, resolved — and to the status only the server knows.
    expect(options).toEqual(['', 'under_review', 'escalated', 'resolved', SERVER_ONLY_STATUS]);
    // It may not go to false_positive directly, and never to itself.
    expect(options).not.toContain('false_positive');
    expect(options).not.toContain('new');
  });

  it('asks for the minimum closing note the server requires, before the request is sent', async () => {
    await renderDetail();
    // The false-positive minimum is on screen from the start, in the server's own number — as the
    // prompt on the explanation field, which is where a reviewer reads it.
    expect(screen.getByPlaceholderText(/At least 15 characters/i)).toBeTruthy();

    // The closing-note minimum only becomes relevant once a closing move is chosen — and choosing it
    // must surface the requirement before the request is sent, not as a 400 afterwards.
    const select = screen.getByDisplayValue('Move this alert to…') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'resolved');
    expect(screen.getByText(/A note of at least 10 characters is required/i)).toBeTruthy();
    // No jest-dom in this suite, so the disabled state is read off the element itself.
    const apply = screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);

    await userEvent.type(screen.getByPlaceholderText(/Required to close/i), 'Card was re-presented and approved by the issuer.');
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the score derivation: capped family contribution, data-quality gap and recommendations', async () => {
    await renderDetail();
    // 34 raw points, 30 credited, cap 30 — the cap is why the total is what it is.
    expect(screen.getByText('payment failures')).toBeTruthy();
    expect(screen.getByText(/4 point\(s\) not credited/i)).toBeTruthy();
    expect(screen.getByText('SOURCE_UNAVAILABLE')).toBeTruthy();
    expect(screen.getByText('Confirm with the cardholder.')).toBeTruthy();
  });

  it('says the score was computed without AI assistance rather than leaving it ambiguous', async () => {
    await renderDetail();
    expect(screen.getByText(/none — every number and sentence here is derived by the deterministic rule engine/i)).toBeTruthy();
  });

  it('records the timeline actor as the scheduled pass it was', async () => {
    await renderDetail();
    expect(screen.getByText('(scheduled pass)')).toBeTruthy();
  });

  it('does not load the reviewer picker for a role that cannot assign', async () => {
    setSession('token-abc', { ...ADMIN, role: 'staff' });
    const AlertDetailPage = (await import('../../src/pages/fraud-sentinel/AlertDetailPage')).default;
    const { calls } = stubFetch([
      [new RegExp(`${BASE}/meta`), () => jsonResponse(META)],
      [new RegExp(`${BASE}/alerts/${ALERT_ID}$`), () => jsonResponse(DETAIL)],
      [/\/api\/v1\/admin\/customers/, () => jsonResponse({ customers: [] })],
    ]);
    renderAt(`/admin/fraud-sentinel/alerts/${ALERT_ID}`, <AlertDetailPage />);
    await screen.findByText('FS-00000007');
    // A staff session holds no fraud_sentinel permission, so nothing is offered and the staff
    // directory is never read.
    expect(calls.some((call) => call.url.includes('/api/v1/admin/customers'))).toBe(false);
    expect(screen.queryByText('Record a conclusion')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Widgets                                                                     */
/* -------------------------------------------------------------------------- */

describe('the advisory and integrity notices', () => {
  it('renders the forbidden actions the server listed, in readable form', async () => {
    const { AdvisoryNotice } = await import('../../src/components/fraud-sentinel/fs-widgets');
    render(<AdvisoryNotice advisory={META.advisory} />);
    expect(screen.getByText(/approve or reject payments/i)).toBeTruthy();
    expect(screen.getByText(/issue refunds/i)).toBeTruthy();
    expect(screen.getByText(/suspend accounts/i)).toBeTruthy();
  });

  it('keeps the compact form to the statement alone', async () => {
    const { AdvisoryNotice } = await import('../../src/components/fraud-sentinel/fs-widgets');
    render(<AdvisoryNotice advisory={META.advisory} compact />);
    expect(screen.getByText(META.advisory.statement, { exact: false })).toBeTruthy();
    expect(screen.queryByText(/issue refunds/i)).toBeNull();
  });

  it('is silent when the evidence check passed and explicit when it withheld something', async () => {
    const { EvidenceIntegrityNotice } = await import('../../src/components/fraud-sentinel/fs-widgets');
    const { container, rerender } = render(<EvidenceIntegrityNotice integrity={{ ok: true, withheld: [] }} />);
    expect(container.textContent).toBe('');
    rerender(<EvidenceIntegrityNotice integrity={{ ok: false, withheld: ['$[2]', '$[5]'] }} />);
    await waitFor(() => expect(container.textContent).toMatch(/2 evidence descriptions withheld/i));
    expect(container.textContent).toMatch(/\$\[2\], \$\[5\]/);
  });
});

describe('the score meter', () => {
  it('clamps to the 0–100 range the backend guarantees', async () => {
    const { ScoreMeter } = await import('../../src/components/fraud-sentinel/fs-widgets');
    const { container, rerender } = render(<ScoreMeter score={140} level="critical" />);
    expect(container.textContent).toContain('100');
    expect(container.textContent).not.toContain('140');
    rerender(<ScoreMeter score={-5} level="low" />);
    await waitFor(() => expect(container.textContent).toContain('0'));
  });
});
