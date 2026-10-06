import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import { toolsApi, type ToolSummary } from '../../lib/tools-api';
import {
  fetchNavigation,
  formatDate,
  money,
  titleCase,
  type MarketingCampaign,
  type MarketingCampaignDetail,
  type MarketingOffering,
  type NavSection,
} from '../../lib/platform-api';

/**
 * Managed digital marketing.
 *
 * `/marketing` is the hub, `/marketing/digital` is the engagement workspace (request a campaign,
 * follow it, read its reports), and `/marketing/seo` + `/marketing/analytics` are channel pages that
 * combine the published offerings for that channel with the CloudHost247 tools that support it.
 *
 * Reporting numbers come from `marketing_report_metrics`, each labelled with the integration that
 * produced it and whether it is estimated. A period with no source is shown as unavailable — the UI
 * never turns missing data into zeros, and never presents a channel as connected when it is not.
 */
export default function MarketingPage() {
  usePageMeta('Digital marketing', 'SEO, search, social, email, advertising, analytics and conversion from CloudHost247.', {
    canonical: '/marketing',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'Service',
      serviceType: 'Digital marketing services',
      provider: { '@type': 'Organization', name: 'CloudHost247' },
    },
  });
  const [sections, setSections] = useState<NavSection[] | null>(null);
  const [offerings, setOfferings] = useState<MarketingOffering[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchNavigation()
      .then((response) => setSections(response.sections))
      .catch((err: Error) => setError(err.message));
    apiFetch<{ offerings: MarketingOffering[] }>('/api/v1/marketing-services/offerings')
      .then((response) => setOfferings(response.offerings))
      .catch(() => setOfferings([]));
  }, []);

  const marketing = sections?.find((section) => section.id === 'marketing');

  return (
    <div className="ch247-page">
      <h1>Digital marketing</h1>
      <p className="ch247-page__hint">
        Managed marketing engagements run by the CloudHost247 delivery team, alongside the analytics and
        SEO tooling built into the platform. Every campaign is a tracked engagement with a timeline and real reports.
      </p>
      {error ? <CatalogErrorBanner message={error} /> : null}

      <div className="ch247-service-grid">
        {(marketing?.groups.flatMap((group) => group.links) ?? [{ label: 'Managed campaigns', to: '/marketing/digital', description: 'SEO, search, social, email and advertising engagements.', badge: 'INCLUDED' as const }]).map(
          (link) => (
            <article key={link.to} className="ch247-service-card">
              <h3>
                {link.label} {link.badge ? <Pill tone="ok">{link.badge}</Pill> : null}
              </h3>
              <p>{link.description}</p>
              <div className="ch247-service-card__footer">
                <Link className="ch247-button ch247-button--small" to={link.to}>
                  Open
                </Link>
              </div>
            </article>
          )
        )}
      </div>

      <section className="ch247-card">
        <h2>What the platform can run today</h2>
        {offerings.length === 0 ? (
          <p>
            Marketing offerings have not been published yet. The delivery team publishes the services customers can buy —
            until then there is no request form here, rather than a form that leads nowhere.
          </p>
        ) : (
          <ul className="ch247-plainlist">
            {offerings.map((offering) => (
              <li key={offering.id}>
                <strong>{offering.name}</strong> <span className="ch247-page__hint">({titleCase(offering.channel)})</span> —{' '}
                {offering.channelConnected === false ? (
                  <span>{offering.channelNote ?? 'This channel is still being onboarded.'}</span>
                ) : (
                  <span>{offering.summary}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function MarketingServicesPage() {
  usePageMeta('Managed campaigns', 'Request and track a CloudHost247 marketing campaign.', { canonical: '/marketing/digital' });
  const token = getToken();
  const [offerings, setOfferings] = useState<MarketingOffering[] | null>(null);
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);
  const [form, setForm] = useState({ offeringCode: '', name: '', goal: '', targetUrl: '', monthlyBudget: '' });
  const [error, setError] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    apiFetch<{ offerings: MarketingOffering[] }>('/api/v1/marketing-services/offerings')
      .then((response) => {
        setOfferings(response.offerings);
        setForm((current) => (current.offeringCode ? current : { ...current, offeringCode: response.offerings[0]?.code ?? '' }));
      })
      .catch((err: Error) => setError(err.message));
    if (token) {
      apiFetch<{ campaigns: MarketingCampaign[] }>('/api/v1/marketing-services/campaigns')
        .then((response) => setCampaigns(response.campaigns))
        .catch(() => setCampaigns([]));
    }
  }, [token]);

  useEffect(() => load(), [load]);

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Managed campaigns</h1>
      <p className="ch247-page__hint">
        Tell us the goal, the destination and the budget. The delivery team plans the engagement, and every stage —
        planning, live, reporting, completed — is recorded with a timeline you can read.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      {offerings === null ? (
        <CatalogLoadingBanner />
      ) : offerings.length === 0 ? (
        <EmptyState>No campaign offering has been published yet, so requests cannot be opened.</EmptyState>
      ) : (
        <section className="ch247-card">
          <h2>Request a campaign</h2>
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Service</span>
              <select value={form.offeringCode} onChange={(event) => setForm({ ...form, offeringCode: event.target.value })}>
                {offerings.map((offering) => (
                  <option key={offering.id} value={offering.code}>
                    {offering.name} ({titleCase(offering.channel)})
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const selected = offerings.find((offering) => offering.code === form.offeringCode);
              return selected?.channelConnected === false ? (
                <p className="ch247-note">{selected.channelNote ?? 'This channel is still being onboarded; the team will confirm the timeline.'}</p>
              ) : null;
            })()}
            <label className="ch247-field">
              <span className="ch247-field-label">Campaign name</span>
              <input value={form.name} maxLength={200} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Goal (at least 20 characters)</span>
              <textarea rows={4} maxLength={4000} value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Destination URL (optional)</span>
              <input value={form.targetUrl} onChange={(event) => setForm({ ...form, targetUrl: event.target.value })} placeholder="https://" />
            </label>
            <label className="ch247-field">
              <span className="ch247-field-label">Monthly budget (optional)</span>
              <input value={form.monthlyBudget} inputMode="decimal" onChange={(event) => setForm({ ...form, monthlyBudget: event.target.value })} />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || !form.offeringCode || form.name.trim().length < 3 || form.goal.trim().length < 20}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch('/api/v1/marketing-services/campaigns', {
                    method: 'POST',
                    body: JSON.stringify({
                      offeringCode: form.offeringCode,
                      name: form.name.trim(),
                      goal: form.goal.trim(),
                      targetUrl: form.targetUrl.trim() || null,
                      monthlyBudgetAmount: form.monthlyBudget ? Number(form.monthlyBudget) : null,
                    }),
                  });
                  setForm({ offeringCode: form.offeringCode, name: '', goal: '', targetUrl: '', monthlyBudget: '' });
                  load();
                  return 'Campaign requested. The delivery team will pick it up and plan it here.';
                })
              }
            >
              {action.busy ? 'Sending…' : 'Request campaign'}
            </button>
            {!token ? (
              <p className="ch247-note">
                <Link to="/login?next=/marketing/digital">Sign in</Link> to submit the request against your account.
              </p>
            ) : null}
          </div>
        </section>
      )}

      {token ? (
        <section className="ch247-card">
          <h2>Your campaigns</h2>
          {campaigns.length === 0 ? (
            <EmptyState>No campaigns yet.</EmptyState>
          ) : (
            <div className="ch247-table-scroll">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th scope="col">Reference</th>
                    <th scope="col">Name</th>
                    <th scope="col">Channel</th>
                    <th scope="col">Status</th>
                    <th scope="col">Budget</th>
                    <th scope="col">Reports</th>
                    <th scope="col">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((campaign) => (
                    <tr key={campaign.id}>
                      <td>
                        <Link to={`/marketing/digital/${campaign.id}`}>{campaign.reference}</Link>
                      </td>
                      <td>{campaign.name}</td>
                      <td>{titleCase(campaign.channel)}</td>
                      <td>
                        <Pill tone={statusTone(campaign.status)}>{titleCase(campaign.status)}</Pill>
                      </td>
                      <td>{campaign.monthly_budget_amount ? `${money(campaign.monthly_budget_amount, campaign.currency)}/mo` : '—'}</td>
                      <td>{campaign.published_report_count ?? 0}</td>
                      <td>{formatDate(campaign.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function MarketingCampaignView() {
  usePageMeta('Campaign', 'Campaign progress, reports and messages.', { noIndex: true });
  const { id } = useParams<{ id: string }>();
  const token = getToken();
  const [detail, setDetail] = useState<MarketingCampaignDetail | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token || !id) return;
    apiFetch<MarketingCampaignDetail>(`/api/v1/marketing-services/campaigns/${id}`)
      .then(setDetail)
      .catch((err: Error) => setError(err.message));
  }, [id, token]);

  useEffect(() => load(), [load]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Campaign</h1>
        <div className="ch247-state-banner">
          <p>Campaign details are private to your account.</p>
          <Link className="ch247-button" to={`/login?next=/marketing/digital/${id}`}>
            Sign in
          </Link>
        </div>
      </div>
    );
  }
  if (error) return <CatalogErrorBanner message={error} />;
  if (!detail) return <CatalogLoadingBanner label="Loading your campaign…" />;

  const { campaign, messages, timeline, reports } = detail;

  return (
    <div className="ch247-page ch247-page--wide">
      <p className="ch247-page__hint">
        <Link to="/marketing/digital">← Managed campaigns</Link>
      </p>
      <h1>
        {campaign.name} <Pill tone={statusTone(campaign.status)}>{titleCase(campaign.status)}</Pill>
      </h1>
      <p className="ch247-page__hint">
        {campaign.reference} · {titleCase(campaign.channel)} · {campaign.offering_name ?? '—'} · opened {formatDate(campaign.created_at)}
      </p>
      <Feedback error={action.error} message={action.message} />

      <section className="ch247-card">
        <h2>Goal</h2>
        <p className="ch247-pre-wrap">{campaign.goal}</p>
        {campaign.target_url ? (
          <p className="ch247-page__hint">
            Destination: <a href={campaign.target_url}>{campaign.target_url}</a>
          </p>
        ) : null}
        {campaign.offering_deliverables?.length ? (
          <ul className="ch247-plainlist">
            {campaign.offering_deliverables.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="ch247-card">
        <h2>Reports</h2>
        {reports.length === 0 ? (
          <p>No reporting period has been published yet for this campaign.</p>
        ) : (
          reports.map((report) => (
            <div key={report.id} className="ch247-card">
              <h3>
                {formatDate(report.period_start)} → {formatDate(report.period_end)}{' '}
                <Pill tone={statusTone(report.status)}>{titleCase(report.status)}</Pill>
              </h3>
              {report.summary ? <p className="ch247-pre-wrap">{report.summary}</p> : null}
              {report.status === 'unavailable' ? (
                <p className="ch247-note">
                  This period has no provider data, so it is reported as unavailable rather than as zeroes.
                </p>
              ) : (
                <div className="ch247-table-scroll">
                  <table className="ch247-table">
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Value</th>
                        <th scope="col">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.metrics.map((metric) => (
                        <tr key={metric.key}>
                          <td>{metric.label ?? metric.key}</td>
                          <td>
                            {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
                            {metric.unit && metric.unit !== 'count' ? ` ${metric.unit}` : ''}
                            {metric.estimated ? ' (estimated)' : ''}
                          </td>
                          <td>{metric.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))
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
        {['cancelled', 'completed', 'rejected'].includes(campaign.status) ? (
          <p className="ch247-page__hint">This campaign is closed — messaging is disabled.</p>
        ) : (
          <div className="ch247-form">
            <label className="ch247-field">
              <span className="ch247-field-label">Message the team</span>
              <textarea rows={3} maxLength={8000} value={message} onChange={(event) => setMessage(event.target.value)} />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || message.trim().length < 1}
              onClick={() =>
                void action.run(async () => {
                  await apiFetch(`/api/v1/marketing-services/campaigns/${campaign.id}/messages`, {
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
      </section>
    </div>
  );
}

const CHANNEL_COPY: Record<string, { title: string; intro: string; channels: string[]; toolKeyword: RegExp }> = {
  seo: {
    title: 'SEO services',
    intro:
      'Technical SEO, on-page work, content and reporting. The tools below are part of the platform and available on your own account right now; the managed services are delivered by the CloudHost247 team.',
    channels: ['seo', 'content'],
    toolKeyword: /seo|sitemap|robots|index|crawl|keyword|serp|schema|webmaster/i,
  },
  analytics: {
    title: 'Analytics & conversion',
    intro:
      'Measurement, tracking and conversion work. Reporting is only ever shown with the integration that produced it, so you always know where a number came from.',
    channels: ['analytics', 'conversion'],
    toolKeyword: /analytic|tracking|tag|conversion|performance|speed|core web vitals|dns|tls|ssl/i,
  },
};

export function MarketingChannelPage({ channel }: { channel: 'seo' | 'analytics' }) {
  const copy = CHANNEL_COPY[channel] ?? CHANNEL_COPY.seo!;
  usePageMeta(copy.title, copy.intro, { canonical: `/marketing/${channel}` });
  const [offerings, setOfferings] = useState<MarketingOffering[] | null>(null);
  const [tools, setTools] = useState<ToolSummary[]>([]);

  useEffect(() => {
    apiFetch<{ offerings: MarketingOffering[] }>('/api/v1/marketing-services/offerings')
      .then((response) => setOfferings(response.offerings.filter((offering) => copy.channels.includes(offering.channel))))
      .catch(() => setOfferings([]));
    toolsApi
      .catalog()
      .then((response) => setTools(response.tools.filter((tool) => copy.toolKeyword.test(`${tool.name} ${tool.summary}`)).slice(0, 12)))
      .catch(() => setTools([]));
  }, [copy.channels, copy.toolKeyword]);

  return (
    <div className="ch247-page">
      <h1>{copy.title}</h1>
      <p className="ch247-page__hint">{copy.intro}</p>
      <div className="ch247-inline-actions">
        <Link className="ch247-button" to="/marketing/digital">
          Request a managed campaign
        </Link>
        <Link className="ch247-button ch247-button--ghost" to="/tools">
          Open the Tools Center
        </Link>
      </div>

      <section className="ch247-card">
        <h2>Managed {channel === 'seo' ? 'SEO' : 'analytics'} services</h2>
        {offerings === null ? (
          <CatalogLoadingBanner />
        ) : offerings.length === 0 ? (
          <p>No offering is published for this channel yet, so no request can be opened against it.</p>
        ) : (
          <div className="ch247-service-grid">
            {offerings.map((offering) => (
              <article key={offering.id} className="ch247-service-card">
                <h3>{offering.name}</h3>
                <p>{offering.summary}</p>
                {offering.channelConnected === false ? <p className="ch247-note">{offering.channelNote}</p> : null}
                <p className="ch247-page__hint">
                  {offering.starting_price_amount ? `From ${money(offering.starting_price_amount, offering.currency)}` : 'Quoted per engagement'}
                  {offering.min_term_months ? ` · minimum ${offering.min_term_months} month(s)` : ''}
                </p>
                <div className="ch247-service-card__footer">
                  <Link className="ch247-button ch247-button--small" to="/marketing/digital">
                    Start a request
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="ch247-card">
        <h2>Do it yourself with the platform tools</h2>
        {tools.length === 0 ? (
          <p>No matching tool is enabled on this platform right now.</p>
        ) : (
          <ul className="ch247-plainlist">
            {tools.map((tool) => (
              <li key={tool.slug}>
                <Link to={tool.path}>{tool.name}</Link> — {tool.summary}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
