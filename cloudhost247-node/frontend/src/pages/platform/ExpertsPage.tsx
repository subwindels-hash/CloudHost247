import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import {
  fetchPublishedPlans,
  formatDate,
  money,
  titleCase,
  type ExpertOffering,
  type ExpertRequestDetail,
  type ExpertRequestSummary,
  type PlatformPlan,
} from '../../lib/platform-api';

/**
 * Hire an Expert / Website Design Services.
 *
 * The catalogue price is a *starting* price and never what the customer is charged — the charge is
 * the quote issued by the delivery team, which the customer approves here. Approval creates a normal
 * platform order + invoice in the same commerce stack as every other service; verified payment is
 * what starts the work.
 */
export default function ExpertsPage() {
  const { id } = useParams<{ id: string }>();
  const token = getToken();
  if (id) return <RequestView requestId={id} token={token} />;
  return <ExpertsHome token={token} />;
}

function ExpertsHome({ token }: { token: string | null }) {
  usePageMeta('Hire an Expert', 'Website design, development, ecommerce and SEO delivered by CloudHost247 specialists.', {
    canonical: '/websites/experts',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Service',
      serviceType: 'Website design and development',
      provider: { '@type': 'Organization', name: 'CloudHost247' },
      areaServed: 'Worldwide',
    },
  });
  const [offerings, setOfferings] = useState<ExpertOffering[] | null>(null);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [requests, setRequests] = useState<ExpertRequestSummary[]>([]);
  const [error, setError] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    apiFetch<{ offerings: ExpertOffering[] }>('/api/v1/experts/offerings')
      .then((response) => setOfferings(response.offerings))
      .catch((err: Error) => setError(err.message));
    fetchPublishedPlans('website_builder')
      .then((response) => setPlans(response.plans))
      .catch(() => setPlans([]));
    if (token) {
      apiFetch<{ requests: ExpertRequestSummary[] }>('/api/v1/experts/requests')
        .then((response) => setRequests(response.requests))
        .catch(() => setRequests([]));
    }
  }, [token]);

  useEffect(() => load(), [load]);

  return (
    <div className="ch247-page">
      <h1>Hire an expert</h1>
      <p className="ch247-page__hint">
        Send us the brief. A specialist scopes it, quotes it, and only after you approve the quote does anything get
        billed — then you follow the work on this page, ask questions, and review the delivery.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      {offerings === null ? (
        <CatalogLoadingBanner />
      ) : offerings.length === 0 ? (
        <EmptyState>
          The expert catalogue has not been published yet. An administrator publishes the service offerings here — until
          then there is nothing to buy.
        </EmptyState>
      ) : (
        <div className="ch247-service-grid">
          {offerings.map((offering) => (
            <article key={offering.id} className="ch247-service-card">
              <h3>{offering.name}</h3>
              <p>{offering.summary || offering.description?.slice(0, 180)}</p>
              {offering.deliverables?.length ? (
                <ul className="ch247-plainlist">
                  {offering.deliverables.slice(0, 5).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
              <p className="ch247-page__hint">
                {offering.starting_price_amount ? `From ${money(offering.starting_price_amount, offering.currency)}` : 'Quoted per project'}
                {offering.typical_delivery_days ? ` · typically ${offering.typical_delivery_days} days` : ''}
                {offering.pricing_model === 'quoted' ? ' · final price is quoted and approved by you' : ''}
              </p>
              <div className="ch247-service-card__footer">
                <Link className="ch247-button ch247-button--small" to={`/websites/experts/new?offering=${encodeURIComponent(offering.code)}`}>
                  Start a request
                </Link>
              </div>
            </article>
          ))}
        </div>
      )}

      {plans.length ? (
        <section className="ch247-card">
          <h2>Website plans that include expert help</h2>
          <div className="ch247-service-grid">
            {plans.map((plan) => (
              <article key={plan.id} className="ch247-service-card">
                <h3>{plan.name}</h3>
                <p>{plan.description}</p>
                <ul className="ch247-plainlist">
                  {plan.features.slice(0, 4).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <div className="ch247-service-card__footer">
                  <span className="ch247-price">
                    {money(plan.price_amount, plan.currency)} <span className="ch247-page__hint">{titleCase(plan.billing_period)}</span>
                  </span>
                  <Link className="ch247-button ch247-button--small" to={`/cart?add=${encodeURIComponent(plan.code)}`}>
                    Add to cart
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {token && requests.length ? (
        <section className="ch247-card">
          <h2>Your requests</h2>
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Title</th>
                  <th scope="col">Status</th>
                  <th scope="col">Live quote</th>
                  <th scope="col">Messages</th>
                  <th scope="col">Opened</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <Link to={`/websites/experts/${request.id}`}>{request.reference}</Link>
                    </td>
                    <td>{request.title}</td>
                    <td>
                      <Pill tone={statusTone(request.status)}>{titleCase(request.status)}</Pill>
                    </td>
                    <td>{request.live_quote_amount ? money(request.live_quote_amount, request.currency) : 'Not quoted yet'}</td>
                    <td>{request.message_count}</td>
                    <td>{formatDate(request.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!token ? (
        <p className="ch247-note">
          <Link to="/login?next=/websites/experts">Sign in</Link> to open a request, approve a quote and follow delivery.
        </p>
      ) : null}
    </div>
  );
}

function RequestView({ requestId, token }: { requestId: string; token: string | null }) {
  usePageMeta('Expert request', 'Track your CloudHost247 expert request, quotes and messages.', { noIndex: true });
  const [detail, setDetail] = useState<ExpertRequestDetail | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<ExpertRequestDetail>(`/api/v1/experts/requests/${requestId}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [requestId, token]);

  useEffect(() => load(), [load]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Expert request</h1>
        <div className="ch247-state-banner">
          <p>Requests are private to your account.</p>
          <Link className="ch247-button" to={`/login?next=/websites/experts/${requestId}`}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }
  if (error) return <CatalogErrorBanner message={error} />;
  if (!detail) return <CatalogLoadingBanner label="Loading your request…" />;

  const { request, quotes, messages, timeline } = detail;
  const openQuote = quotes.find((quote) => quote.status === 'issued');

  return (
    <div className="ch247-page ch247-page--wide">
      <p className="ch247-page__hint">
        <Link to="/websites/experts">← All expert services</Link>
      </p>
      <h1>
        {request.title} <Pill tone={statusTone(request.status)}>{titleCase(request.status)}</Pill>
      </h1>
      <p className="ch247-page__hint">
        Reference {request.reference} · {request.offering_name ?? request.offering_code} · opened {formatDate(request.created_at)}
      </p>
      <Feedback error={action.error} message={action.message} />

      <section className="ch247-card">
        <h2>Brief</h2>
        <p className="ch247-pre-wrap">{request.description}</p>
        {request.goals?.length ? (
          <ul className="ch247-plainlist">
            {request.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        ) : null}
        {request.reference_url ? (
          <p className="ch247-page__hint">
            Reference: <a href={request.reference_url}>{request.reference_url}</a>
          </p>
        ) : null}
        {request.budget_amount ? <p className="ch247-page__hint">Budget you indicated: {money(request.budget_amount, request.currency)}</p> : null}
      </section>

      <section className="ch247-card">
        <h2>Quotes</h2>
        {quotes.length === 0 ? (
          <p>
            No quote yet. The team reads the brief first and issues a scoped quote — you are never billed without
            approving one.
          </p>
        ) : (
          <>
            <div className="ch247-table-scroll">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th scope="col">Amount</th>
                    <th scope="col">Scope</th>
                    <th scope="col">Delivery</th>
                    <th scope="col">Valid until</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td>{money(quote.amount, quote.currency)}</td>
                      <td className="ch247-pre-wrap">{quote.scope}</td>
                      <td>{quote.delivery_days ? `${quote.delivery_days} days` : '—'}</td>
                      <td>{formatDate(quote.valid_until)}</td>
                      <td>
                        <Pill tone={statusTone(quote.status)}>{titleCase(quote.status)}</Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {openQuote ? (
              <div className="ch247-inlineform">
                <button
                  type="button"
                  className="ch247-button"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      const response = await apiFetch<{ orderNumber: string; invoiceNumber: string; amount: string; currency: string }>(
                        `/api/v1/experts/requests/${request.id}/approve-quote`,
                        { method: 'POST', body: JSON.stringify({ quoteId: openQuote.id }) }
                      );
                      load();
                      return `Quote approved. Order ${response.orderNumber} and invoice ${response.invoiceNumber} were created for ${money(response.amount, response.currency)}.`;
                    })
                  }
                >
                  Approve {money(openQuote.amount, openQuote.currency)}
                </button>
                <span className="ch247-page__hint">
                  Approving creates the order and invoice in your account; the work starts once payment is verified.
                </span>
              </div>
            ) : null}
          </>
        )}
      </section>

      <section className="ch247-card">
        <h2>Messages</h2>
        <div className="ch247-thread-list">
          {messages.length === 0 ? <p>No messages yet.</p> : null}
          {messages.map((entry) => (
            <div key={entry.id} className={`ch247-message ch247-message--${entry.author_role === 'staff' ? 'staff' : 'customer'}`}>
              <div className="ch247-message__meta">
                {entry.author_role === 'staff' ? 'CloudHost247 team' : 'You'} · {formatDate(entry.created_at)}
              </div>
              <div className="ch247-pre-wrap">{entry.body}</div>
            </div>
          ))}
        </div>
        {['cancelled', 'completed', 'rejected'].includes(request.status) ? (
          <p className="ch247-page__hint">This request is closed — messaging is disabled.</p>
        ) : (
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Reply to the team</span>
              <textarea rows={3} value={message} maxLength={8000} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || message.trim().length < 1}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/experts/requests/${request.id}/messages`, {
                    method: 'POST',
                    body: JSON.stringify({ body: message.trim() }),
                  });
                  setMessage('');
                  load();
                  return 'Message sent.';
                })
              }
            >
              Send message
            </button>
          </div>
        )}
      </section>

      <section className="ch247-card">
        <h2>Progress</h2>
        <ol className="ch247-timeline">
          {timeline.map((entry, index) => (
            <li key={`${entry.event_type}-${index}`}>
              <span className="ch247-timeline__time">{formatDate(entry.created_at)}</span>
              <span>
                {titleCase(entry.event_type)}
                {entry.to_status ? ` → ${titleCase(entry.to_status)}` : ''}
              </span>
            </li>
          ))}
        </ol>
        {request.order_id ? (
          <p className="ch247-page__hint">
            <Link to="/invoices">View the related invoice</Link>
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** The brief form. Lives on its own route so a link can pre-select an offering. */
export function ExpertRequestForm() {
  usePageMeta('Start an expert request', 'Tell us what you need and the CloudHost247 team will scope it.', { noIndex: true });
  const navigate = useNavigate();
  const token = getToken();
  const [offerings, setOfferings] = useState<ExpertOffering[]>([]);
  const [form, setForm] = useState({ offeringCode: '', title: '', description: '', goals: '', referenceUrl: '' });
  const action = useAction();

  useEffect(() => {
    apiFetch<{ offerings: ExpertOffering[] }>('/api/v1/experts/offerings')
      .then((response) => {
        setOfferings(response.offerings);
        const preselect = new URLSearchParams(window.location.search).get('offering');
        const chosen = response.offerings.find((offering) => offering.code === preselect) ?? response.offerings[0];
        if (chosen) setForm((current) => ({ ...current, offeringCode: chosen.code }));
      })
      .catch(() => setOfferings([]));
  }, []);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Start an expert request</h1>
        <div className="ch247-state-banner">
          <p>Sign in so the request can be tracked against your account.</p>
          <Link className="ch247-button" to="/login?next=/websites/experts/new">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ch247-page">
      <h1>Start an expert request</h1>
      <p className="ch247-page__hint">
        A detailed brief gets a faster, more accurate quote. You approve the quote before anything is billed.
      </p>
      <Feedback error={action.error} message={action.message} />
      <section className="ch247-card">
        <div className="ch247-form">
          <label className="ch247-field">
            <span className="ch247-field-label">Service</span>
            <select value={form.offeringCode} onChange={(event) => setForm({ ...form, offeringCode: event.target.value })}>
              {offerings.map((offering) => (
                <option key={offering.id} value={offering.code}>
                  {offering.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Project title</span>
            <input value={form.title} maxLength={200} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">What do you need? (at least 30 characters)</span>
            <textarea rows={6} maxLength={8000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Goals (comma separated)</span>
            <input value={form.goals} onChange={(event) => setForm({ ...form, goals: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Existing site or reference (optional)</span>
            <input value={form.referenceUrl} onChange={(event) => setForm({ ...form, referenceUrl: event.target.value })} placeholder="https://…" />
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || !form.offeringCode || form.title.trim().length < 4 || form.description.trim().length < 30}
            onClick={() =>
              void action.run(async () => {
                const response = await apiFetch<{ request?: { id: string }; id?: string }>('/api/v1/experts/requests', {
                  method: 'POST',
                  body: JSON.stringify({
                    offeringCode: form.offeringCode,
                    title: form.title.trim(),
                    description: form.description.trim(),
                    goals: form.goals.split(',').map((goal) => goal.trim()).filter(Boolean),
                    referenceUrl: form.referenceUrl.trim() || null,
                  }),
                });
                const id = response.request?.id ?? response.id;
                if (id) navigate(`/websites/experts/${id}`);
                return 'Request received. The team is scoping it now.';
              })
            }
          >
            {action.busy ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </section>
    </div>
  );
}
