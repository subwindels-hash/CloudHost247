import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import { formatDate, titleCase, type AiEngine, type AiGeneration, type AiProject, type SiteRow } from '../../lib/platform-api';

/**
 * AI Website Builder.
 *
 * The brief goes to a real generator. Two engines exist: CloudHost247's own deterministic generator
 * (which needs nothing and is always available) and a connected model provider (`AI_LLM_*`
 * configuration). The engine list is served by the API with its real configured state, so a customer
 * can see — before generating — which engine will run, and asking for an unconfigured model fails
 * with the reason instead of quietly falling back to the built-in one.
 *
 * A generated plan is a proposal: nothing touches the site until the customer applies it, and when
 * applied the pages land as drafts and must be published deliberately.
 */
export default function AiBuilderPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const token = getToken();
  const navigate = useNavigate();

  if (projectId) return <ProjectView projectId={projectId} token={token} />;
  return <BriefForm token={token} navigate={navigate} />;
}

interface BriefState {
  businessName: string;
  industry: string;
  description: string;
  audience: string;
  goals: string;
  tone: string;
  keywords: string;
  pages: string;
}

const EMPTY_BRIEF: BriefState = {
  businessName: '',
  industry: '',
  description: '',
  audience: '',
  goals: '',
  tone: '',
  keywords: '',
  pages: 'home, about, services, contact',
};

function BriefForm({ token, navigate }: { token: string | null; navigate: ReturnType<typeof useNavigate> }) {
  usePageMeta('AI Website Builder', 'Describe your website in plain language and get real pages, copy and SEO.');
  const [engines, setEngines] = useState<AiEngine[]>([]);
  const [engine, setEngine] = useState('rules');
  const [brief, setBrief] = useState<BriefState>(EMPTY_BRIEF);
  const [projects, setProjects] = useState<AiProject[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ projects: AiProject[] }>('/api/v1/ai-builder/projects')
      .then((response) => setProjects(response.projects))
      .catch((err: Error) => setLoadError(err.message));
  }, [token]);

  useEffect(() => {
    load();
    if (token) {
      apiFetch<{ engines: AiEngine[] }>('/api/v1/ai-builder/engines')
        .then((response) => setEngines(response.engines))
        .catch(() => setEngines([]));
    }
  }, [load, token]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>AI Website Builder</h1>
        <div className="ch247-state-banner">
          <p>
            Describe what you need — a business, an audience, the pages you want — and CloudHost247 drafts the structure,
            copy, calls to action and SEO metadata for you to edit and publish.
          </p>
          <Link className="ch247-button" to="/login?next=/websites/ai-builder">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  const selected = engines.find((entry) => entry.engine === engine);

  return (
    <div className="ch247-page">
      <h1>AI Website Builder</h1>
      <p className="ch247-page__hint">
        Answer a few questions and CloudHost247 produces a real site plan: pages, sections, copy, CTAs and SEO — all
        editable in the Website Builder afterwards.
      </p>
      <Feedback error={action.error} message={action.message} />
      {loadError ? <CatalogErrorBanner message={loadError} /> : null}

      <div className="ch247-note">
        Each generation is recorded. Only successful generations count against your monthly allowance, and a generation
        that needs a provider you have not connected says exactly that.
      </div>

      <section className="ch247-card">
        <h2>Tell us about the website</h2>
        <div className="ch247-form">
          <label className="ch247-field">
            <span className="ch247-field-label">Business or website name *</span>
            <input value={brief.businessName} maxLength={160} onChange={(event) => setBrief({ ...brief, businessName: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Industry</span>
            <input value={brief.industry} maxLength={80} onChange={(event) => setBrief({ ...brief, industry: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">What does it do? * (at least 20 characters)</span>
            <textarea rows={4} maxLength={4000} value={brief.description} onChange={(event) => setBrief({ ...brief, description: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Who is it for?</span>
            <input value={brief.audience} maxLength={200} onChange={(event) => setBrief({ ...brief, audience: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Goals (comma separated)</span>
            <input value={brief.goals} onChange={(event) => setBrief({ ...brief, goals: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Tone</span>
            <input value={brief.tone} maxLength={80} placeholder="Warm and professional" onChange={(event) => setBrief({ ...brief, tone: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Keywords (comma separated)</span>
            <input value={brief.keywords} onChange={(event) => setBrief({ ...brief, keywords: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Pages</span>
            <input value={brief.pages} onChange={(event) => setBrief({ ...brief, pages: event.target.value })} />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Engine</span>
            <select value={engine} onChange={(event) => setEngine(event.target.value)}>
              {(engines.length ? engines : [{ engine: 'rules', label: 'Built-in generator', configured: true, reason: null }]).map((entry) => (
                <option key={entry.engine} value={entry.engine} disabled={!entry.configured}>
                  {entry.label}
                  {entry.configured ? '' : ' — not connected'}
                </option>
              ))}
            </select>
          </label>
          {selected && !selected.configured ? <p className="ch247-status-error">{selected.reason}</p> : null}
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || brief.businessName.trim().length < 2 || brief.description.trim().length < 20}
            onClick={() =>
              void action.run(async () => {
                const response = await apiFetch<{ project: AiProject }>('/api/v1/ai-builder/projects', {
                  method: 'POST',
                  body: JSON.stringify({
                    name: brief.businessName.trim(),
                    brief: {
                      businessName: brief.businessName.trim(),
                      industry: brief.industry.trim() || undefined,
                      description: brief.description.trim(),
                      audience: brief.audience.trim() || undefined,
                      tone: brief.tone.trim() || undefined,
                      goals: brief.goals.split(',').map((goal) => goal.trim()).filter(Boolean),
                      keywords: brief.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean),
                      pages: brief.pages.split(',').map((page) => page.trim()).filter(Boolean),
                    },
                  }),
                });
                setBrief(EMPTY_BRIEF);
                load();
                navigate(`/websites/ai-builder/${response.project.id}`);
                return 'Brief saved. Generate the site from the project page.';
              })
            }
          >
            {action.busy ? 'Saving…' : 'Create project'}
          </button>
        </div>
      </section>

      {projects === null ? (
        <CatalogLoadingBanner />
      ) : projects.length === 0 ? (
        <EmptyState>No AI projects yet. Describe a website above to create your first one.</EmptyState>
      ) : (
        <section className="ch247-card">
          <h2>Your AI projects</h2>
          <div className="ch247-table-scroll">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>{project.name}</td>
                    <td>
                      <Pill tone={statusTone(project.status)}>{project.status}</Pill>
                    </td>
                    <td>{formatDate(project.created_at)}</td>
                    <td>
                      <Link to={`/websites/ai-builder/${project.id}`}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function ProjectView({ projectId, token }: { projectId: string; token: string | null }) {
  usePageMeta('AI project', 'Generate and apply a website plan.');
  const [project, setProject] = useState<AiProject | null>(null);
  const [generations, setGenerations] = useState<AiGeneration[]>([]);
  const [engines, setEngines] = useState<AiEngine[]>([]);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [engine, setEngine] = useState('rules');
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState('');
  const [engineNotice, setEngineNotice] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ project: AiProject; generations: AiGeneration[] }>(`/api/v1/ai-builder/projects/${projectId}`)
      .then((response) => {
        setProject(response.project);
        setGenerations(response.generations);
        if (response.project.site_id) setSiteId(response.project.site_id);
      })
      .catch((err: Error) => setError(err.message));
  }, [projectId, token]);

  useEffect(() => {
    load();
    if (token) {
      apiFetch<{ engines: AiEngine[] }>('/api/v1/ai-builder/engines')
        .then((response) => setEngines(response.engines))
        .catch(() => setEngines([]));
      apiFetch<{ sites: SiteRow[] }>('/api/v1/builder/sites')
        .then((response) => {
          setSites(response.sites);
          setSiteId((current) => current || response.sites[0]?.id || '');
        })
        .catch(() => setSites([]));
    }
  }, [load, token]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>AI project</h1>
        <Link className="ch247-button" to="/login?next=/websites/ai-builder">
          Sign in
        </Link>
      </div>
    );
  }
  if (error) return <CatalogErrorBanner message={error} />;
  if (!project) return <CatalogLoadingBanner label="Loading your project…" />;

  const latest = generations[0];

  return (
    <div className="ch247-page">
      <p className="ch247-page__hint">
        <Link to="/websites/ai-builder">← All AI projects</Link>
      </p>
      <h1>
        {project.name} <Pill tone={statusTone(project.status)}>{project.status}</Pill>
      </h1>
      <Feedback error={action.error || engineNotice} message={action.message} />

      <section className="ch247-card">
        <h2>Brief</h2>
        <dl className="ch247-definition-list">
          {Object.entries(project.brief ?? {}).map(([key, value]) => (
            <div key={key} className="ch247-kv">
              <dt>{titleCase(key)}</dt>
              <dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="ch247-card">
        <h2>Generate</h2>
        <div className="ch247-inlineform">
          <label className="ch247-field">
            <span className="ch247-field-label">Engine</span>
            <select value={engine} onChange={(event) => setEngine(event.target.value)}>
              {engines.map((entry) => (
                <option key={entry.engine} value={entry.engine} disabled={!entry.configured}>
                  {entry.label}
                  {entry.configured ? '' : ' — not connected'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                setEngineNotice('');
                try {
                  await apiFetch<{ generation: AiGeneration }>(`/api/v1/ai-builder/projects/${project.id}/generate`, {
                    method: 'POST',
                    body: JSON.stringify({ engine }),
                  });
                  load();
                  return 'Site plan generated. Review it below, then apply it to a website.';
                } catch (err) {
                  if (err instanceof ApiRequestError) {
                    // The API answers with the honest reason for an unconnected engine.
                    setEngineNotice(err.message);
                    return;
                  }
                  throw err;
                }
              })
            }
          >
            {action.busy ? 'Generating…' : 'Generate site plan'}
          </button>
        </div>
      </section>

      {generations.length === 0 ? (
        <EmptyState>No generations yet. Generate a plan to see pages, sections and copy.</EmptyState>
      ) : (
        generations.map((generation) => (
          <section key={generation.id} className="ch247-card">
            <h2>
              {titleCase(generation.engine)} — <Pill tone={statusTone(generation.status)}>{generation.status}</Pill>{' '}
              <span className="ch247-page__hint">{formatDate(generation.created_at)}</span>
            </h2>
            {generation.error ? <CatalogErrorBanner message={`${generation.error.code}: ${generation.error.message}`} /> : null}
            {generation.plan ? (
              <>
                <ul className="ch247-plainlist">
                  {generation.plan.pages.map((page) => (
                    <li key={page.path}>
                      <strong>{page.title}</strong> <span className="ch247-page__hint">{page.path}</span> — {page.sections.length} sections
                    </li>
                  ))}
                </ul>
                <div className="ch247-inlineform">
                  <label className="ch247-field">
                    <span className="ch247-field-label">Apply to website</span>
                    <select value={siteId} onChange={(event) => setSiteId(event.target.value)}>
                      <option value="">Choose a website…</option>
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="ch247-button"
                    disabled={action.busy || !siteId}
                    onClick={() =>
                      void action.run(async () => {
                        const response = await apiFetch<{ result: { pagesCreated: number; pagesSkipped: number } }>(
                          `/api/v1/ai-builder/generations/${generation.id}/apply`,
                          { method: 'POST', body: JSON.stringify({ siteId }) }
                        );
                        return `Applied ${response.result.pagesCreated} page(s)${
                          response.result.pagesSkipped ? `, skipped ${response.result.pagesSkipped} that already existed` : ''
                        }. The pages are drafts until you publish.`;
                      })
                    }
                  >
                    Apply to website
                  </button>
                  {siteId ? (
                    <Link className="ch247-button ch247-button--ghost" to={`/websites/builder/${siteId}`}>
                      Open in builder
                    </Link>
                  ) : null}
                </div>
              </>
            ) : null}
          </section>
        ))
      )}

      {latest?.plan ? null : null}
    </div>
  );
}
