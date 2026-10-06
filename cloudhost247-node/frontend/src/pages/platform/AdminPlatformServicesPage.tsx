import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import { formatDate, money, titleCase, type PlatformPlan } from '../../lib/platform-api';

/**
 * Admin control centre for the platform services added on top of the existing domain/hosting
 * platform.
 *
 * Everything here is role-gated server-side: staff can see and work the queues, while changing what
 * the public can buy (plan pricing, published offerings, channel connections) requires an
 * administrator. The UI mirrors that honestly — a staff account sees the action and the server's
 * refusal, never a button that silently does nothing.
 *
 * Prices are shown exactly as stored. An unpublished or unpriced plan reads "not published yet"
 * rather than inventing a number.
 */

const SERVICE_KINDS = ['website_builder', 'ai_builder', 'online_store', 'marketing', 'inbox', 'logo_maker'] as const;
const BILLING_PERIODS = ['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually'] as const;

export function AdminPlatformServicesPage() {
  usePageMeta('Platform services', 'Control centre for the new CLOUDHOST247 platform services.', { noIndex: true });
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ overview: Record<string, number> }>('/api/v1/admin/platform-services/overview')
      .then((response) => setOverview(response.overview))
      .catch((err: Error) => setError(err.message));
  }, []);

  const tiles: Array<{ label: string; value: number; to: string; hint: string }> = overview
    ? [
        { label: 'Platform plans', value: overview.plans ?? 0, to: '/admin/platform-plans', hint: `${overview.published_plans ?? 0} published` },
        { label: 'Expert requests', value: overview.expert_requests ?? 0, to: '/admin/expert-services', hint: `${overview.expert_open ?? 0} open` },
        { label: 'Marketing campaigns', value: overview.campaigns ?? 0, to: '/admin/marketing-services', hint: `${overview.campaigns_live ?? 0} live` },
        { label: 'Stores', value: overview.stores ?? 0, to: '/admin/online-store', hint: `${overview.store_paid_orders ?? 0} paid orders` },
        { label: 'Websites', value: overview.builder_sites ?? 0, to: '/admin/website-builder', hint: `${overview.builder_published ?? 0} published` },
        { label: 'Inbox conversations', value: overview.inbox_open ?? 0, to: '/admin/unified-inbox', hint: `${overview.inbox_unread ?? 0} unread` },
        { label: 'Logo projects', value: overview.logo_projects ?? 0, to: '/websites', hint: 'customer projects' },
      ]
    : [];

  return (
    <div className="ch247-page">
      <h1>Platform services</h1>
      <p className="ch247-page__hint">
        The services added on top of the existing hosting platform: packaged plans, expert delivery, managed marketing,
        online stores, the website builder and the unified inbox. Each area has its own queue below.
      </p>
      {error ? <CatalogErrorBanner message={error} /> : null}
      {overview === null && !error ? (
        <CatalogLoadingBanner />
      ) : (
        <div className="ch247-service-grid">
          {tiles.map((tile) => (
            <article key={tile.label} className="ch247-service-card">
              <h3>
                <Link to={tile.to}>{tile.label}</Link>
              </h3>
              <p className="ch247-metric">{tile.value.toLocaleString()}</p>
              <p className="ch247-page__hint">{tile.hint}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Packaged plans
 * ------------------------------------------------------------------------------------------- */

export function AdminPlatformPlansPage() {
  usePageMeta('Platform plans', 'Publish and price the packaged services.', { noIndex: true });
  const [plans, setPlans] = useState<PlatformPlan[] | null>(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [draft, setDraft] = useState({
    serviceKind: 'website_builder',
    code: '',
    name: '',
    description: '',
    billingPeriod: 'monthly',
    priceAmount: '',
    currency: 'USD',
    features: '',
    status: 'draft',
    limits: '{"sites":1,"pagesPerSite":5}',
  });
  const action = useAction();

  const load = useCallback(() => {
    apiFetch<{ plans: PlatformPlan[] }>(`/api/v1/admin/platform-services/plans${filter ? `?serviceKind=${filter}` : ''}`)
      .then((response) => setPlans(response.plans))
      .catch((err: Error) => setError(err.message));
  }, [filter]);

  useEffect(() => load(), [load]);

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Platform plans</h1>
      <p className="ch247-page__hint">
        These plans are the pricing authority for the new services: the public catalogue only ever offers a plan that is
        published and priced here. Plan limits (for example sites per account) are enforced by the service itself.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      <div className="ch247-inline-actions">
        <label className="ch247-field">
          <span className="ch247-field-label">Filter</span>
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">All services</option>
            {SERVICE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {titleCase(kind)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="ch247-card">
        <h2>Create a plan</h2>
        <div className="ch247-form">
          <label className="ch247-field">
            <span className="ch247-field-label">Service</span>
            <select value={draft.serviceKind} onChange={(event) => setDraft({ ...draft, serviceKind: event.target.value })}>
              {SERVICE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {titleCase(kind)}
                </option>
              ))}
            </select>
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Code (lower-case, unique)</span>
            <input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="builder-starter" />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Name</span>
            <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Description</span>
            <textarea rows={2} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Billing period</span>
            <select value={draft.billingPeriod} onChange={(event) => setDraft({ ...draft, billingPeriod: event.target.value })}>
              {BILLING_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {titleCase(period)}
                </option>
              ))}
            </select>
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Price</span>
            <input value={draft.priceAmount} onChange={(event) => setDraft({ ...draft, priceAmount: event.target.value })} placeholder="19.00" inputMode="decimal" />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Currency</span>
            <input value={draft.currency} maxLength={3} onChange={(event) => setDraft({ ...draft, currency: event.target.value.toUpperCase() })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Features (one per line)</span>
            <textarea rows={3} value={draft.features} onChange={(event) => setDraft({ ...draft, features: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Limits (JSON, whole numbers)</span>
            <input value={draft.limits} onChange={(event) => setDraft({ ...draft, limits: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Status</span>
            <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || !/^[a-z0-9][a-z0-9_-]*$/.test(draft.code) || draft.name.trim().length < 2 || !/^\d+(\.\d{1,2})?$/.test(draft.priceAmount)}
            onClick={() =>
              void action.run(async () => {
                let limits: Record<string, number> = {};
                try {
                  limits = JSON.parse(draft.limits || '{}') as Record<string, number>;
                } catch {
                  throw new Error('Limits must be valid JSON, for example {"sites":1}.');
                }
                await apiFetch('/api/v1/admin/platform-services/plans', {
                  method: 'POST',
                  body: JSON.stringify({
                    serviceKind: draft.serviceKind,
                    code: draft.code,
                    name: draft.name.trim(),
                    description: draft.description.trim() || null,
                    billingPeriod: draft.billingPeriod,
                    priceAmount: draft.priceAmount,
                    currency: draft.currency,
                    features: draft.features.split('\n').map((line) => line.trim()).filter(Boolean),
                    limits,
                    status: draft.status,
                  }),
                });
                setDraft({ ...draft, code: '', name: '', description: '', priceAmount: '', features: '' });
                load();
                return 'Plan created. Publishing it makes it available in the public catalogue.';
              })
            }
          >
            {action.busy ? 'Saving…' : 'Create plan'}
          </button>
        </div>
      </section>

      <section className="ch247-card">
        <h2>Plans</h2>
        {plans === null ? (
          <CatalogLoadingBanner />
        ) : plans.length === 0 ? (
          <EmptyState>No plans yet.</EmptyState>
        ) : (
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Service</th>
                  <th scope="col">Price</th>
                  <th scope="col">Limits</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>
                      <strong>{plan.name}</strong>
                      <div className="ch247-page__hint">{plan.code}</div>
                    </td>
                    <td>{titleCase(plan.service_kind)}</td>
                    <td>
                      {money(plan.price_amount, plan.currency)} <span className="ch247-page__hint">{titleCase(plan.billing_period)}</span>
                    </td>
                    <td>{Object.entries(plan.limits ?? {}).map(([key, value]) => `${key}: ${value}`).join(', ') || '—'}</td>
                    <td>
                      <Pill tone={statusTone(plan.status)}>{titleCase(plan.status)}</Pill>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="ch247-button ch247-button--ghost ch247-button--small"
                        disabled={action.busy}
                        onClick={() =>
                          void action.run(async () => {
                            const next = plan.status === 'published' ? 'draft' : 'published';
                            await apiFetch(`/api/v1/admin/platform-services/plans/${plan.id}`, {
                              method: 'PATCH',
                              body: JSON.stringify({ status: next }),
                            });
                            load();
                            return next === 'published' ? `${plan.name} is now in the public catalogue.` : `${plan.name} is no longer offered.`;
                          })
                        }
                      >
                        {plan.status === 'published' ? 'Unpublish' : 'Publish'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Expert services queue
 * --------------------------------------------------------------------------------------------- */

interface StaffExpertRequest {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  offering_code: string;
  currency: string;
  budget_amount: string | null;
  live_quote_amount: string | null;
  quote_count: number;
  assigned_staff_id: string | null;
  customer_email: string;
  customer_name: string | null;
  created_at: string;
}

interface StaffExpertDetail {
  request: StaffExpertRequest & { description: string; goals: string[] | null; reference_url: string | null };
  quotes: Array<{ id: string; amount: string; currency: string; scope: string; status: string; created_at: string }>;
  messages: Array<{ id: string; author_role: string; visibility: string; body: string; created_at: string }>;
  events: Array<{ event_type: string; from_status: string | null; to_status: string | null; created_at: string }>;
}

const EXPERT_STATUSES = ['researching', 'quoted', 'approved', 'in_progress', 'review', 'completed', 'rejected', 'cancelled', 'failed'] as const;

export function AdminExpertServicesPage() {
  usePageMeta('Expert services', 'Delivery queue for expert requests.', { noIndex: true });
  const [requests, setRequests] = useState<StaffExpertRequest[] | null>(null);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<StaffExpertDetail | null>(null);
  const [staff, setStaff] = useState<Array<{ id: string; email: string; full_name?: string }>>([]);
  const [quote, setQuote] = useState({ amount: '', scope: '', deliveryDays: '' });
  const [message, setMessage] = useState({ body: '', visibility: 'customer' as 'customer' | 'internal' });
  const [error, setError] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    apiFetch<{ requests: StaffExpertRequest[] }>('/api/v1/admin/expert-services/requests')
      .then((response) => setRequests(response.requests))
      .catch((err: Error) => setError(err.message));
    apiFetch<{ users: Array<{ id: string; email: string; fullName: string | null }> }>('/api/v1/admin/users?role=staff&limit=50')
      .then((response) => setStaff(response.users.map((user) => ({ id: user.id, email: user.email, full_name: user.fullName ?? undefined }))))
      .catch(() => setStaff([]));
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    apiFetch<StaffExpertDetail>(`/api/v1/admin/expert-services/requests/${openId}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [openId]);

  const reloadDetail = () => {
    if (!openId) return;
    apiFetch<StaffExpertDetail>(`/api/v1/admin/expert-services/requests/${openId}`)
      .then(setDetail)
      .catch(() => undefined);
    load();
  };

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Expert services</h1>
      <p className="ch247-page__hint">
        Work the queue: assign an owner, move the request through its states, issue the quote the customer approves, and
        answer in the same thread the customer reads. Every action is audited.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      {requests === null ? (
        <CatalogLoadingBanner />
      ) : requests.length === 0 ? (
        <EmptyState>No expert requests yet.</EmptyState>
      ) : (
        <div className="ch247-table-scroll">
          <table className="ch247-table">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Customer</th>
                <th scope="col">Title</th>
                <th scope="col">Status</th>
                <th scope="col">Quote</th>
                <th scope="col">Owner</th>
                <th scope="col">Opened</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{request.reference}</td>
                  <td>
                    {request.customer_name || request.customer_email}
                    <div className="ch247-page__hint">{request.customer_email}</div>
                  </td>
                  <td>{request.title}</td>
                  <td>
                    <Pill tone={statusTone(request.status)}>{titleCase(request.status)}</Pill>
                  </td>
                  <td>{request.live_quote_amount ? money(request.live_quote_amount, request.currency) : `${request.quote_count} issued`}</td>
                  <td>{request.assigned_staff_id ? 'Assigned' : 'Unassigned'}</td>
                  <td>{formatDate(request.created_at)}</td>
                  <td>
                    <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setOpenId(request.id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openId && detail ? (
        <section className="ch247-card">
          <h2>
            {detail.request.reference} — {detail.request.title}
          </h2>
          <p className="ch247-page__hint">
            {detail.request.customer_name || detail.request.customer_email} · {detail.request.offering_code} ·{' '}
            {detail.request.budget_amount ? `Budget ${money(detail.request.budget_amount, detail.request.currency)}` : 'No budget given'}
          </p>
          <p className="ch247-pre-wrap">{detail.request.description}</p>
          {detail.request.goals?.length ? (
            <ul className="ch247-plainlist">
              {detail.request.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          ) : null}
          {detail.request.reference_url ? (
            <p className="ch247-page__hint">
              Reference: <a href={detail.request.reference_url}>{detail.request.reference_url}</a>
            </p>
          ) : null}

          <div className="ch247-inline-actions">
            <label className="ch247-field">
              <span className="ch247-field-label">Assign to</span>
              <select
                value={detail.request.assigned_staff_id ?? ''}
                onChange={(event) =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/admin/expert-services/requests/${openId}/assign`, {
                      method: 'POST',
                      body: JSON.stringify({ staffId: event.target.value || null }),
                    });
                    reloadDetail();
                    return 'Assignment updated.';
                  })
                }
              >
                <option value="">Unassigned</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name || member.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Status</span>
              <select
                value={detail.request.status}
                onChange={(event) =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/admin/expert-services/requests/${openId}/status`, {
                      method: 'POST',
                      body: JSON.stringify({ status: event.target.value }),
                    });
                    reloadDetail();
                    return 'Status updated.';
                  })
                }
              >
                <option value={detail.request.status}>{titleCase(detail.request.status)}</option>
                {EXPERT_STATUSES.filter((status) => status !== detail.request.status).map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>Quotes</h3>
          <ul className="ch247-plainlist">
            {detail.quotes.map((entry) => (
              <li key={entry.id}>
                {money(entry.amount, entry.currency)} · {entry.status} · {entry.scope.slice(0, 120)}
              </li>
            ))}
            {detail.quotes.length === 0 ? <li>No quote issued yet.</li> : null}
          </ul>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Amount</span>
              <input value={quote.amount} inputMode="decimal" onChange={(event) => setQuote({ ...quote, amount: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Scope (at least 10 characters)</span>
              <textarea rows={3} value={quote.scope} onChange={(event) => setQuote({ ...quote, scope: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Delivery days (optional)</span>
              <input value={quote.deliveryDays} inputMode="numeric" onChange={(event) => setQuote({ ...quote, deliveryDays: event.target.value })} />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || !(Number(quote.amount) > 0) || quote.scope.trim().length < 10}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/admin/expert-services/requests/${openId}/quotes`, {
                    method: 'POST',
                    body: JSON.stringify({
                      amount: Number(quote.amount),
                      scope: quote.scope.trim(),
                      deliveryDays: quote.deliveryDays ? Number(quote.deliveryDays) : null,
                    }),
                  });
                  setQuote({ amount: '', scope: '', deliveryDays: '' });
                  reloadDetail();
                  return 'Quote issued. The customer approves it before anything is billed.';
                })
              }
            >
              Issue quote
            </button>
          </div>

          <h3>Messages</h3>
          <div className="ch247-thread-list">
            {detail.messages.map((entry) => (
              <div key={entry.id} className={`ch247-message ch247-message--${entry.visibility === 'internal' ? 'internal' : entry.author_role === 'staff' ? 'staff' : 'customer'}`}>
                <div className="ch247-message__meta">
                  {entry.author_role === 'staff' ? 'Team' : 'Customer'} · {entry.visibility === 'internal' ? 'internal note' : 'visible to customer'} ·{' '}
                  {formatDate(entry.created_at)}
                </div>
                <div className="ch247-pre-wrap">{entry.body}</div>
              </div>
            ))}
          </div>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Message</span>
              <textarea rows={3} maxLength={8000} value={message.body} onChange={(event) => setMessage({ ...message, body: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Visibility</span>
              <select value={message.visibility} onChange={(event) => setMessage({ ...message, visibility: event.target.value as 'customer' | 'internal' })}>
                <option value="customer">Send to customer</option>
                <option value="internal">Internal note</option>
              </select>
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || message.body.trim().length < 1}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/admin/expert-services/requests/${openId}/messages`, {
                    method: 'POST',
                    body: JSON.stringify({ body: message.body.trim(), visibility: message.visibility }),
                  });
                  setMessage({ ...message, body: '' });
                  reloadDetail();
                  return 'Message recorded.';
                })
              }
            >
              Add message
            </button>
          </div>

          <h3>History</h3>
          <ol className="ch247-timeline">
            {detail.events.map((event, index) => (
              <li key={index}>
                <span className="ch247-timeline__time">{formatDate(event.created_at)}</span>
                <span>
                  {titleCase(event.event_type)}
                  {event.to_status ? ` → ${titleCase(event.to_status)}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Managed marketing queue
 * --------------------------------------------------------------------------------------------- */

interface StaffCampaign {
  id: string;
  reference: string;
  name: string;
  channel: string;
  status: string;
  monthly_budget_amount: string | null;
  currency: string;
  assigned_staff_id: string | null;
  customer_email: string;
  customer_name: string | null;
  report_count: number;
  created_at: string;
}

interface StaffCampaignDetail {
  campaign: StaffCampaign & { goal: string; target_url: string | null; offering_name: string | null };
  messages: Array<{ id: string; author_role: string; visibility: string; body: string; created_at: string }>;
  events: Array<{ event_type: string; from_status: string | null; to_status: string | null; created_at: string }>;
  reports: Array<{ id: string; period_start: string; period_end: string; status: string; summary: string | null }>;
}

interface MarketingChannelConnection {
  id: string;
  channel: string;
  name: string;
  provider_key: string;
  status: string;
  last_checked_at: string | null;
  last_error_message: string | null;
  requiredEnv: string[];
}

const CHANNELS = ['seo', 'search_ads', 'social', 'email', 'advertising', 'analytics', 'content', 'conversion'] as const;
const CAMPAIGN_STATUSES = ['planning', 'active', 'paused', 'reporting', 'completed', 'rejected', 'cancelled', 'failed'] as const;

export function AdminMarketingServicesPage() {
  usePageMeta('Marketing services', 'Campaign delivery queue and channel connections.', { noIndex: true });
  const [campaigns, setCampaigns] = useState<StaffCampaign[] | null>(null);
  const [connections, setConnections] = useState<MarketingChannelConnection[]>([]);
  const [openId, setOpenId] = useState('');
  const [detail, setDetail] = useState<StaffCampaignDetail | null>(null);
  const [error, setError] = useState('');
  const [channelDraft, setChannelDraft] = useState({ channel: 'seo' as (typeof CHANNELS)[number], name: '', providerKey: '' });
  const [metricDraft, setMetricDraft] = useState({ key: '', label: '', value: '', unit: 'count', source: '' });
  const [period, setPeriod] = useState({ id: '', periodStart: '', periodEnd: '' });
  const [staffMessage, setStaffMessage] = useState({ body: '', visibility: 'customer' as 'customer' | 'internal' });
  const action = useAction();

  const load = useCallback(() => {
    apiFetch<{ campaigns: StaffCampaign[] }>('/api/v1/admin/marketing-services/campaigns')
      .then((response) => setCampaigns(response.campaigns))
      .catch((err: Error) => setError(err.message));
    apiFetch<{ connections: MarketingChannelConnection[] }>('/api/v1/admin/marketing-services/channels')
      .then((response) => setConnections(response.connections))
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    apiFetch<StaffCampaignDetail>(`/api/v1/admin/marketing-services/campaigns/${openId}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [openId]);

  const reload = () => {
    load();
    if (openId) {
      apiFetch<StaffCampaignDetail>(`/api/v1/admin/marketing-services/campaigns/${openId}`)
        .then(setDetail)
        .catch(() => undefined);
    }
  };

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Marketing services</h1>
      <p className="ch247-page__hint">
        Campaign delivery and the data plumbing behind it. A report period only ever carries metrics an integration
        actually reported, each labelled with its source; a period with no provider data is published as unavailable.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      <section className="ch247-card">
        <h2>Channel connections</h2>
        <p className="ch247-page__hint">
          A channel is live only when the credential it needs is configured. The required settings are named here so an
          operator can connect a provider without guessing.
        </p>
        {connections.length === 0 ? (
          <p>No channel connection has been registered yet.</p>
        ) : (
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Name</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Status</th>
                  <th scope="col">Required configuration</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr key={connection.id}>
                    <td>{titleCase(connection.channel)}</td>
                    <td>{connection.name}</td>
                    <td>{connection.provider_key}</td>
                    <td>
                      <Pill tone={statusTone(connection.status)}>{titleCase(connection.status)}</Pill>
                      {connection.last_error_message ? <div className="ch247-page__hint">{connection.last_error_message}</div> : null}
                    </td>
                    <td>{connection.requiredEnv.length ? connection.requiredEnv.join(', ') : 'No credential required'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="ch247-form">
          <label className="ch247-field">
            <span className="ch247-field-label">Channel</span>
            <select value={channelDraft.channel} onChange={(event) => setChannelDraft({ ...channelDraft, channel: event.target.value as (typeof CHANNELS)[number] })}>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {titleCase(channel)}
                </option>
              ))}
            </select>
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Name (optional)</span>
            <input value={channelDraft.name} onChange={(event) => setChannelDraft({ ...channelDraft, name: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Provider key</span>
            <input value={channelDraft.providerKey} placeholder="google_ads" onChange={(event) => setChannelDraft({ ...channelDraft, providerKey: event.target.value })} />
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || channelDraft.providerKey.trim().length < 2}
            onClick={() =>
              void action.run(async () => {
                const response = await apiFetch<{ connection: MarketingChannelConnection }>('/api/v1/admin/marketing-services/channels', {
                  method: 'POST',
                  body: JSON.stringify({ channel: channelDraft.channel, name: channelDraft.name.trim() || undefined, providerKey: channelDraft.providerKey.trim() }),
                });
                setChannelDraft({ channel: channelDraft.channel, name: '', providerKey: '' });
                load();
                return `Connection saved with status “${response.connection.status}”.`;
              })
            }
          >
            Save connection
          </button>
        </div>
      </section>

      <section className="ch247-card">
        <h2>Campaigns</h2>
        {campaigns === null ? (
          <CatalogLoadingBanner />
        ) : campaigns.length === 0 ? (
          <EmptyState>No campaigns requested yet.</EmptyState>
        ) : (
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Campaign</th>
                  <th scope="col">Status</th>
                  <th scope="col">Budget</th>
                  <th scope="col">Reports</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.reference}</td>
                    <td>
                      {campaign.customer_name || campaign.customer_email}
                      <div className="ch247-page__hint">{campaign.customer_email}</div>
                    </td>
                    <td>
                      {campaign.name}
                      <div className="ch247-page__hint">{titleCase(campaign.channel)}</div>
                    </td>
                    <td>
                      <Pill tone={statusTone(campaign.status)}>{titleCase(campaign.status)}</Pill>
                    </td>
                    <td>{campaign.monthly_budget_amount ? `${money(campaign.monthly_budget_amount, campaign.currency)}/mo` : '—'}</td>
                    <td>{campaign.report_count}</td>
                    <td>
                      <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setOpenId(campaign.id)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openId && detail ? (
        <section className="ch247-card">
          <h2>
            {detail.campaign.reference} — {detail.campaign.name}
          </h2>
          <p className="ch247-pre-wrap">{detail.campaign.goal}</p>
          <div className="ch247-inline-actions">
            <label className="ch247-field">
              <span className="ch247-field-label">Status</span>
              <select
                value={detail.campaign.status}
                onChange={(event) =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/admin/marketing-services/campaigns/${openId}/status`, {
                      method: 'POST',
                      body: JSON.stringify({ status: event.target.value }),
                    });
                    reload();
                    return 'Status updated.';
                  })
                }
              >
                <option value={detail.campaign.status}>{titleCase(detail.campaign.status)}</option>
                {CAMPAIGN_STATUSES.filter((status) => status !== detail.campaign.status).map((status) => (
                  <option key={status} value={status}>
                    {titleCase(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3>Reporting periods</h3>
          <ul className="ch247-plainlist">
            {detail.reports.map((report) => (
              <li key={report.id}>
                {report.period_start} → {report.period_end} · <Pill tone={statusTone(report.status)}>{titleCase(report.status)}</Pill>{' '}
                <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => setPeriod({ ...period, id: report.id })}>
                  Add metrics
                </button>
              </li>
            ))}
            {detail.reports.length === 0 ? <li>No period created yet.</li> : null}
          </ul>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Period start</span>
              <input type="date" value={period.periodStart} onChange={(event) => setPeriod({ ...period, periodStart: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Period end</span>
              <input type="date" value={period.periodEnd} onChange={(event) => setPeriod({ ...period, periodEnd: event.target.value })} />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || !period.periodStart || !period.periodEnd}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/admin/marketing-services/campaigns/${openId}/reports`, {
                    method: 'POST',
                    body: JSON.stringify({ periodStart: period.periodStart, periodEnd: period.periodEnd, status: 'collecting' }),
                  });
                  reload();
                  return 'Reporting period created.';
                })
              }
            >
              Create period
            </button>
          </div>

          {period.id ? (
            <div className="ch247-form">
              <h4>Record a metric</h4>
              <label className="ch247-field">
                <span className="ch247-field-label">Key</span>
                <input value={metricDraft.key} onChange={(event) => setMetricDraft({ ...metricDraft, key: event.target.value })} placeholder="sessions" />
              </label>
              <label className="ch247-field">
                <span className="ch247-field-label">Label</span>
                <input value={metricDraft.label} onChange={(event) => setMetricDraft({ ...metricDraft, label: event.target.value })} placeholder="Sessions" />
              </label>
              <label className="ch247-field">
                <span className="ch247-field-label">Value</span>
                <input value={metricDraft.value} inputMode="decimal" onChange={(event) => setMetricDraft({ ...metricDraft, value: event.target.value })} />
              </label>
              <label className="ch247-field">
                <span className="ch247-field-label">Unit</span>
                <select value={metricDraft.unit} onChange={(event) => setMetricDraft({ ...metricDraft, unit: event.target.value })}>
                  {['count', 'currency', 'percent', 'ratio', 'seconds'].map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ch247-field">
                <span className="ch247-field-label">Source (required — where this number came from)</span>
                <input value={metricDraft.source} onChange={(event) => setMetricDraft({ ...metricDraft, source: event.target.value })} placeholder="ga4" />
              </label>
              <button
                type="button"
                className="ch247-button"
                disabled={action.busy || !metricDraft.key || !metricDraft.label || metricDraft.value === '' || !metricDraft.source}
                onClick={() =>
                  void action.run(async () => {
                    await apiFetch(`/api/v1/admin/marketing-services/reports/${period.id}/metrics`, {
                      method: 'POST',
                      body: JSON.stringify({
                        metrics: [
                          {
                            key: metricDraft.key,
                            label: metricDraft.label,
                            value: Number(metricDraft.value),
                            unit: metricDraft.unit,
                            source: metricDraft.source,
                          },
                        ],
                      }),
                    });
                    setMetricDraft({ key: '', label: '', value: '', unit: 'count', source: '' });
                    reload();
                    return 'Metric recorded against its source.';
                  })
                }
              >
                Record metric
              </button>
            </div>
          ) : null}

          <h3>Messages</h3>
          <div className="ch247-thread-list">
            {detail.messages.map((entry) => (
              <div key={entry.id} className={`ch247-message ch247-message--${entry.visibility === 'internal' ? 'internal' : entry.author_role === 'staff' ? 'staff' : 'customer'}`}>
                <div className="ch247-message__meta">
                  {entry.author_role === 'staff' ? 'Team' : 'Customer'} · {entry.visibility === 'internal' ? 'internal note' : 'visible to customer'} ·{' '}
                  {formatDate(entry.created_at)}
                </div>
                <div className="ch247-pre-wrap">{entry.body}</div>
              </div>
            ))}
          </div>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Message</span>
              <textarea rows={3} maxLength={8000} value={staffMessage.body} onChange={(event) => setStaffMessage({ ...staffMessage, body: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Visibility</span>
              <select
                value={staffMessage.visibility}
                onChange={(event) => setStaffMessage({ ...staffMessage, visibility: event.target.value as 'customer' | 'internal' })}
              >
                <option value="customer">Send to customer</option>
                <option value="internal">Internal note</option>
              </select>
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || staffMessage.body.trim().length < 1}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/admin/marketing-services/campaigns/${openId}/messages`, {
                    method: 'POST',
                    body: JSON.stringify({ body: staffMessage.body.trim(), visibility: staffMessage.visibility }),
                  });
                  setStaffMessage({ ...staffMessage, body: '' });
                  reload();
                  return 'Message recorded.';
                })
              }
            >
              Add message
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Store oversight
 * --------------------------------------------------------------------------------------------- */

interface AdminStoreRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  payment_mode: string;
  currency: string;
  plan_code: string | null;
  created_at: string;
  owner_email: string;
  product_count: number;
  order_count: number;
}

export function AdminOnlineStorePage() {
  usePageMeta('Online store oversight', 'Every store, its owner and its trading state.', { noIndex: true });
  const [overview, setOverview] = useState<Record<string, number> | null>(null);
  const [stores, setStores] = useState<AdminStoreRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ overview: Record<string, number> }>('/api/v1/admin/store/overview')
      .then((response) => setOverview(response.overview))
      .catch((err: Error) => setError(err.message));
    apiFetch<{ stores: AdminStoreRow[] }>('/api/v1/admin/store/stores')
      .then((response) => setStores(response.stores))
      .catch((err: Error) => setError(err.message));
  }, []);

  const tiles = overview
    ? [
        { label: 'Stores', value: overview.stores ?? 0, hint: `${overview.active_stores ?? 0} active` },
        { label: 'Products', value: overview.active_products ?? 0, hint: `${overview.digital_products ?? 0} digital` },
        { label: 'Orders', value: overview.orders ?? 0, hint: `${overview.open_orders ?? 0} open` },
        { label: 'Paid orders', value: overview.paid_orders ?? 0, hint: 'provider-verified payments' },
      ]
    : [];

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Online store</h1>
      <p className="ch247-page__hint">
        Store oversight across the platform. A paid order is one a payment provider verified — the platform never marks an
        order paid on a claim from the browser.
      </p>
      {error ? <CatalogErrorBanner message={error} /> : null}
      {overview === null && !error ? (
        <CatalogLoadingBanner />
      ) : (
        <div className="ch247-service-grid">
          {tiles.map((tile) => (
            <article key={tile.label} className="ch247-service-card">
              <h3>{tile.label}</h3>
              <p className="ch247-metric">{tile.value.toLocaleString()}</p>
              <p className="ch247-page__hint">{tile.hint}</p>
            </article>
          ))}
        </div>
      )}

      <section className="ch247-card">
        <h2>Stores</h2>
        {stores === null ? (
          <CatalogLoadingBanner />
        ) : stores.length === 0 ? (
          <EmptyState>No stores yet.</EmptyState>
        ) : (
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Store</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Status</th>
                  <th scope="col">Payments</th>
                  <th scope="col">Products</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr key={store.id}>
                    <td>
                      <strong>{store.name}</strong>
                      <div className="ch247-page__hint">{store.slug}</div>
                    </td>
                    <td>{store.owner_email}</td>
                    <td>
                      <Pill tone={statusTone(store.status)}>{titleCase(store.status)}</Pill>
                    </td>
                    <td>{store.payment_mode === 'provider' ? 'Connected provider' : 'Order intake'}</td>
                    <td>{store.product_count}</td>
                    <td>{store.order_count}</td>
                    <td>{formatDate(store.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Website builder oversight
 * --------------------------------------------------------------------------------------------- */

interface AdminSiteRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
  owner_email: string;
  page_count: number;
  publication_count: number;
  published_at: string | null;
  submission_count: number;
}

export function AdminWebsiteBuilderPage() {
  usePageMeta('Website builder oversight', 'Published websites, form submissions and owners.', { noIndex: true });
  const [sites, setSites] = useState<AdminSiteRow[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<{ sites: AdminSiteRow[] }>('/api/v1/admin/website-builder/sites')
      .then((response) => setSites(response.sites))
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Website builder</h1>
      <p className="ch247-page__hint">
        Every website on the platform with its owner and publication state. Visitors only ever see the immutable
        publication snapshot, so a draft edit never leaks to a live site.
      </p>
      {error ? <CatalogErrorBanner message={error} /> : null}
      {sites === null && !error ? (
        <CatalogLoadingBanner />
      ) : sites && sites.length === 0 ? (
        <EmptyState>No websites yet.</EmptyState>
      ) : (
        <div className="ch247-table-scroll">
          <table className="ch247-table">
            <thead>
              <tr>
                <th scope="col">Website</th>
                <th scope="col">Owner</th>
                <th scope="col">Status</th>
                <th scope="col">Pages</th>
                <th scope="col">Publications</th>
                <th scope="col">Form submissions</th>
                <th scope="col">Last published</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {(sites ?? []).map((site) => (
                <tr key={site.id}>
                  <td>
                    <strong>{site.name}</strong>
                    <div className="ch247-page__hint">{site.slug}</div>
                  </td>
                  <td>{site.owner_email}</td>
                  <td>
                    <Pill tone={statusTone(site.status)}>{titleCase(site.status)}</Pill>
                  </td>
                  <td>{site.page_count}</td>
                  <td>{site.publication_count}</td>
                  <td>{site.submission_count}</td>
                  <td>{formatDate(site.published_at)}</td>
                  <td>
                    {site.status === 'published' ? (
                      <a className="ch247-button ch247-button--ghost ch247-button--small" href={`/sites/${site.slug}`} target="_blank" rel="noreferrer">
                        View
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
