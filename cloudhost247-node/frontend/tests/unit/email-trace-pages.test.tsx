// @vitest-environment jsdom
/**
 * Email Trace Centre pages.
 *
 * The API is stubbed, so these tests say nothing about whether any mail was collected. What they
 * protect is the honesty of the presentation: the page must render the server's wording, must never
 * invent "opened"/"inbox" language, must explain an empty list instead of implying nothing was sent,
 * and must keep the admin surface honest about failures.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmailTracePage from '../../src/pages/EmailTracePage';
import AdminEmailTracePage from '../../src/pages/AdminEmailTracePage';
import { setSession, clearSession } from '../../src/lib/auth';

const EVIDENCE_NOTE =
  'Statuses come from SMTP replies recorded in mail server logs. Inbox placement, spam-folder placement and whether a message was opened are never observed by this platform.';

const STATUSES: Record<string, number> = {
  ACCEPTED: 2,
  QUEUED: 0,
  PROCESSING: 0,
  DEFERRED: 1,
  DELIVERED: 3,
  BOUNCED: 1,
  REJECTED: 0,
  FAILED: 0,
  UNKNOWN: 0,
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    traceId: '1xYzAb-000123-CD',
    eventType: 'delivery',
    status: 'DELIVERED',
    statusLabel: 'Delivered',
    statusExplanation:
      'The receiving mail server accepted the message over SMTP. This confirms transport, not inbox placement, and it says nothing about whether the message was read.',
    sender: 'billing@alpha.example',
    recipient: 'customer@example.org',
    senderDomain: 'alpha.example',
    recipientDomain: 'example.org',
    smtpResponseCode: 250,
    smtpResponseText: '250 2.0.0 Ok',
    remoteHostname: 'mx.example.org',
    occurredAt: '2026-11-08T09:14:03.000Z',
    serverId: 'srv-1',
    customerId: 'cust-1',
    hostingAccountId: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

type Handler = (url: string, init?: RequestInit) => unknown;

function stubApi(handler: Handler) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body = await handler(url, init);
      return jsonResponse(body);
    })
  );
}

beforeEach(() => {
  localStorage.clear();
  setSession('token', { id: 'u1', email: 'ada@example.com', fullName: 'Ada Lovelace', role: 'customer' });
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
});

function customerStub(overrides: { events?: unknown[]; sources?: unknown[] } = {}) {
  return stubApi((url) => {
    if (url.includes('/api/v1/email-trace/statuses')) return { statuses: [], evidenceNote: EVIDENCE_NOTE };
    if (url.includes('/api/v1/email-trace/summary')) {
      return { total: 7, byStatus: STATUSES, from: null, to: null, evidenceNote: EVIDENCE_NOTE, window: '24h' };
    }
    if (url.includes('/api/v1/email-trace/queue')) {
      return { servers: [], note: 'Queue figures are a snapshot taken by the last successful collection run.' };
    }
    if (url.includes('/api/v1/email-trace/health')) {
      return {
        sources: overrides.sources ?? [],
        summary: { ok: 0, degraded: 0, error: 0, disabled: 0 },
        note: 'Collection health describes whether this platform could read each mail server.',
      };
    }
    if (url.match(/\/api\/v1\/email-trace\/[^/?]+$/)) {
      return {
        traceId: '1xYzAb-000123-CD',
        latestStatus: 'DELIVERED',
        statusDetail: {
          label: 'Delivered',
          explanation:
            'The receiving mail server accepted the message over SMTP. This confirms transport, not inbox placement.',
          evidence: 'transport',
        },
        sender: 'billing@alpha.example',
        recipient: 'customer@example.org',
        firstSeenAt: '2026-11-08T09:14:02.000Z',
        lastSeenAt: '2026-11-08T09:14:03.000Z',
        eventCount: 2,
        events: [event(), event({ id: 'e0', eventType: 'submission', status: 'ACCEPTED', statusLabel: 'Accepted', smtpResponseCode: null, occurredAt: '2026-11-08T09:14:02.000Z' })],
        evidenceNote: EVIDENCE_NOTE,
      };
    }
    return { events: overrides.events ?? [event()], total: 1, limit: 25, offset: 0, evidenceNote: EVIDENCE_NOTE };
  });
}

describe('/account/email-trace', () => {
  it('renders statuses using the server’s wording and the transport caveat', async () => {
    customerStub();
    render(
      <MemoryRouter>
        <EmailTracePage />
      </MemoryRouter>
    );

    expect(await screen.findByText('billing@alpha.example')).toBeTruthy();
    // Every vocabulary status is counted, including the zeroes.
    expect(screen.getByRole('list', { name: 'Message status counts' })).toBeTruthy();
    expect(screen.getAllByText(EVIDENCE_NOTE).length).toBeGreaterThan(0);
    expect(document.body.textContent ?? '').toContain('not whether it landed in an inbox or was read');
  });

  it('never claims inbox placement or that a message was opened', async () => {
    customerStub();
    render(
      <MemoryRouter>
        <EmailTracePage />
      </MemoryRouter>
    );
    await screen.findByText('billing@alpha.example');

    const text = (document.body.textContent ?? '').toLowerCase();
    expect(text).not.toContain('opened the email');
    expect(text).not.toContain('inbox delivery confirmed');
    expect(text).not.toContain('landed in the inbox');
    // And it does say the opposite, explicitly.
    expect(text).toContain('not whether it landed in an inbox');
  });

  it('explains an empty list instead of implying no mail was sent', async () => {
    customerStub({ events: [], sources: [] });
    render(
      <MemoryRouter>
        <EmailTracePage />
      </MemoryRouter>
    );

    expect(await screen.findByText('No trace data has been collected for your domains yet.')).toBeTruthy();
    expect(
      screen.getByText(/an empty list here does not\s+mean you have not sent mail/i)
    ).toBeTruthy();
  });

  it('shows a message timeline with the SMTP reply, oldest first', async () => {
    customerStub();
    render(
      <MemoryRouter>
        <EmailTracePage />
      </MemoryRouter>
    );
    await screen.findByText('billing@alpha.example');
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(await screen.findByText('Message detail')).toBeTruthy();
    expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0);
    expect(screen.getByText(/250 — 250 2\.0\.0 Ok/)).toBeTruthy();
  });

  it('marks the mail queue as a snapshot, not a live number', async () => {
    customerStub();
    render(
      <MemoryRouter>
        <EmailTracePage />
      </MemoryRouter>
    );
    // The page renders the server's note verbatim — it does not paraphrase it into a friendlier
    // claim, which is how "live queue" language could creep back in.
    expect(
      await screen.findByText('Queue figures are a snapshot taken by the last successful collection run.')
    ).toBeTruthy();
    expect(screen.queryByText(/live queue/i)).toBeNull();
  });
});

describe('/admin/email-trace', () => {
  function adminStub(source: Record<string, unknown>) {
    return stubApi((url, init) => {
      if (url.includes('/sources') && init?.method === 'PATCH') {
        return { source: { ...source, collectionEnabled: true } };
      }
      if (url.includes('/sources')) {
        return {
          sources: [source],
          health: [],
          note: 'Collection is opt-in per server. A server that has never been enabled has no source row and produces no trace data.',
        };
      }
      if (url.includes('/collection-runs')) {
        return {
          total: 1,
          runs: [
            {
              id: 'run-1',
              serverId: 'aaaaaaaa-1111-4111-8111-111111111111',
              status: 'failed',
              startedAt: '2026-11-08T09:00:00.000Z',
              completedAt: '2026-11-08T09:00:02.000Z',
              recordsSeen: 0,
              recordsCollected: 0,
              recordsRejected: 0,
              queueCount: null,
              errorClass: 'agent_unavailable',
              errorMessage: 'Agent unreachable',
            },
          ],
        };
      }
      if (url.includes('/summary')) {
        return { total: 0, byStatus: STATUSES, from: null, to: null, evidenceNote: EVIDENCE_NOTE, window: '24h' };
      }
      if (url.includes('/collect')) {
        return {
          collected: 1,
          results: [
            {
              serverId: 'aaaaaaaa-1111-4111-8111-111111111111',
              runId: 'run-2',
              status: 'ok',
              reason: null,
              seen: 10,
              collected: 8,
              duplicates: 0,
              rejected: 2,
              unattributed: 1,
              capability: null,
            },
          ],
        };
      }
      return { events: [event()], total: 1, limit: 25, offset: 0, evidenceNote: EVIDENCE_NOTE };
    });
  }

  const source = {
    id: 'src-1',
    serverId: 'aaaaaaaa-1111-4111-8111-111111111111',
    providerType: 'exim_cpanel',
    collectionMethod: 'agent',
    collectionEnabled: false,
    status: 'not_configured',
    capability: { mainlog: 'unknown', queue: 'unknown' },
    checkpoint: {},
    retentionDaysOverride: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
  };

  it('shows collection as opt-in and reports the failure state truthfully', async () => {
    adminStub(source);
    render(
      <MemoryRouter>
        <AdminEmailTracePage />
      </MemoryRouter>
    );

    expect(await screen.findByText(/Collection is opt-in per server/)).toBeTruthy();
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(await screen.findByText('failed')).toBeTruthy();
    expect(screen.getByText(/agent_unavailable: Agent unreachable/)).toBeTruthy();
  });

  it('enables collection through the API rather than pretending it was already on', async () => {
    const fetchMock = vi.fn();
    adminStub(source);
    render(
      <MemoryRouter>
        <AdminEmailTracePage />
      </MemoryRouter>
    );

    const enable = await screen.findByRole('button', { name: 'Enable' });
    await userEvent.click(enable);

    await waitFor(() => expect(screen.getByText(/Collection enabled\./)).toBeTruthy());
    fetchMock.mockClear();
  });

  it('reports what a collection actually did, including failures', async () => {
    adminStub({ ...source, collectionEnabled: true });
    render(
      <MemoryRouter>
        <AdminEmailTracePage />
      </MemoryRouter>
    );

    const collect = await screen.findByRole('button', { name: 'Collect now' });
    await userEvent.click(collect);

    await waitFor(() => expect(screen.getByText(/1 source\(s\) collected, 8 new event\(s\)\./)).toBeTruthy());
  });

  it('describes the read-only boundary on the admin page', async () => {
    adminStub(source);
    render(
      <MemoryRouter>
        <AdminEmailTracePage />
      </MemoryRouter>
    );
    const text = document.body.textContent ?? '';
    expect(text).toContain('never edits');
    expect(text).toContain('deletes or forces a queued message');
    expect(text).toContain('never stores message');
  });
});
