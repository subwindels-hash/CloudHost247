import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { EmptyState, Feedback, Pill, statusTone, useAction } from '../../components/platform/ui';
import {
  money,
  type PageRow,
  type PlatformPlan,
  type SectionDefinition,
  type SiteRow,
  type SiteTemplate,
  formatDate,
  fetchPublishedPlans,
  titleCase,
} from '../../lib/platform-api';

/**
 * Website Builder.
 *
 * Everything here maps to a real endpoint: sites are created (optionally from a template), pages are
 * edited section-by-section against the server's own section registry, and publishing writes an
 * immutable snapshot that becomes the only thing the public page route serves. Draft edits never
 * leak to the published site, and the editor cannot invent a section or a property the server does
 * not understand — the palette is generated from `GET /api/v1/builder/sections`.
 *
 * Uploaded media and files live in the site's own media library (base64 JSON, magic-byte sniffed
 * server-side); the editor references them by URL, so there is no third-party asset host involved.
 */
export default function BuilderPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const token = getToken();
  const navigate = useNavigate();

  if (siteId) return <SiteEditor siteId={siteId} token={token} />;
  return <SiteList token={token} navigate={navigate} />;
}

function SiteList({ token, navigate }: { token: string | null; navigate: ReturnType<typeof useNavigate> }) {
  usePageMeta('Website Builder', 'Build a CloudHost247 website with templates, pages and publishing.');
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [plans, setPlans] = useState<PlatformPlan[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [templateSlug, setTemplateSlug] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{ sites: SiteRow[] }>('/api/v1/builder/sites')
      .then((response) => setSites(response.sites))
      .catch((err: Error) => setError(err.message));
  }, [token]);

  useEffect(() => {
    load();
    apiFetch<{ templates: SiteTemplate[] }>('/api/v1/builder/templates')
      .then((response) => setTemplates(response.templates))
      .catch(() => setTemplates([]));
    fetchPublishedPlans('website_builder')
      .then((response) => setPlans(response.plans))
      .catch(() => setPlans([]));
  }, [load]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Website Builder</h1>
        <div className="ch247-state-banner">
          <p>
            CloudHost247&apos;s builder gives you templates, pages, sections, forms and one-click publishing. Sign in to
            create your first website.
          </p>
          <Link className="ch247-button" to="/login?next=/websites/builder">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ch247-page">
      <h1>Website Builder</h1>
      <p className="ch247-page__hint">
        Build pages from CloudHost247&apos;s section library, preview the draft, then publish an immutable version. Custom
        domains are bound from My Domains.
      </p>

      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      <section className="ch247-card">
        <h2>Create a website</h2>
        <div className="ch247-form">
          <label className="ch247-field">
            <span className="ch247-field-label">Website name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Acme Studio" />
          </label>
          <label className="ch247-field">
            <span className="ch247-field-label">Start from a template (optional)</span>
            <select value={templateSlug} onChange={(event) => setTemplateSlug(event.target.value)}>
              <option value="">Blank site (hero + footer)</option>
              {templates.map((template) => (
                <option key={template.slug} value={template.slug}>
                  {template.name} — {template.description}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ch247-button"
            disabled={action.busy || name.trim().length < 2}
            onClick={() =>
              void action.run(async () => {
                const response = await apiFetch<{ site: SiteRow }>('/api/v1/builder/sites', {
                  method: 'POST',
                  body: JSON.stringify({ name: name.trim(), templateSlug: templateSlug || null }),
                });
                setName('');
                setTemplateSlug('');
                load();
                navigate(`/websites/builder/${response.site.id}`);
                return `Created ${response.site.name}.`;
              })
            }
          >
            Create website
          </button>
        </div>
      </section>

      {sites === null ? (
        <CatalogLoadingBanner />
      ) : sites.length === 0 ? (
        <EmptyState>You have no websites yet. Create one above to get started.</EmptyState>
      ) : (
        <div className="ch247-service-grid">
          {sites.map((site) => (
            <article key={site.id} className="ch247-service-card">
              <h3>
                {site.name} <Pill tone={statusTone(site.status)}>{site.status}</Pill>
              </h3>
              <p>
                /{site.slug} · updated {formatDate(site.updated_at)}
              </p>
              <div className="ch247-service-card__footer">
                <Link className="ch247-button ch247-button--small" to={`/websites/builder/${site.id}`}>
                  Open editor
                </Link>
                {site.status === 'published' ? (
                  <a className="ch247-button ch247-button--ghost ch247-button--small" href={`/api/v1/public/sites/${site.slug}`} target="_blank" rel="noreferrer">
                    View published
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="ch247-section--muted">
        <h2>Templates</h2>
        <p className="ch247-page__hint">Templates are real page layouts from the same section library the editor uses.</p>
        <div className="ch247-service-grid">
          {templates.length === 0 ? <EmptyState>No templates are published yet.</EmptyState> : null}
          {templates.map((template) => (
            <article key={template.slug} className="ch247-service-card">
              <h3>{template.name}</h3>
              <p>{template.description}</p>
            </article>
          ))}
        </div>
      </section>

      {plans.length ? (
        <section className="ch247-section--muted">
          <h2>Builder plans</h2>
          <div className="ch247-plan-grid">
            {plans.map((plan) => (
              <article key={plan.id} className="ch247-plan-card">
                <h3>{plan.name}</h3>
                <p className="ch247-plan-card__price">
                  {money(plan.price_amount, plan.currency)} <small>/ {plan.billing_period.replace('_', ' ')}</small>
                </p>
                <ul className="ch247-plan-card__features">
                  {(plan.features ?? []).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="ch247-button"
                  onClick={() =>
                    void action.run(async () => {
                      await apiFetch('/api/v1/cart/service-items', {
                        method: 'POST',
                        body: JSON.stringify({ serviceKind: 'platform_plan', serviceRef: plan.id, quantity: 1 }),
                      });
                      return `${plan.name} was added to your cart.`;
                    })
                  }
                >
                  Add to cart
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SiteEditor({ siteId, token }: { siteId: string; token: string | null }) {
  usePageMeta('Website editor', 'Edit pages, sections and SEO, then publish.');
  const [site, setSite] = useState<SiteRow | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [sections, setSections] = useState<SectionDefinition[]>([]);
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [publications, setPublications] = useState<Array<{ id: string; version: number; created_at: string }>>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [newPageTitle, setNewPageTitle] = useState('');
  const action = useAction();

  const load = useCallback(() => {
    if (!token) return;
    apiFetch<{
      site: SiteRow;
      pages: PageRow[];
      publications: Array<{ id: string; version: number; created_at: string }>;
    }>(`/api/v1/builder/sites/${siteId}`)
      .then((response) => {
        setSite(response.site);
        setPages(response.pages);
        setPublications(response.publications);
        setActivePageId((current) => current ?? response.pages.find((page) => page.is_home)?.id ?? response.pages[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, [siteId, token]);

  useEffect(() => {
    load();
    apiFetch<{ sections: SectionDefinition[] }>('/api/v1/builder/sections')
      .then((response) => setSections(response.sections))
      .catch(() => setSections([]));
    apiFetch<{ templates: SiteTemplate[] }>('/api/v1/builder/templates')
      .then((response) => setTemplates(response.templates))
      .catch(() => setTemplates([]));
  }, [load]);

  if (!token) {
    return (
      <div className="ch247-page">
        <h1>Website editor</h1>
        <Link className="ch247-button" to="/login?next=/websites/builder">
          Sign in
        </Link>
      </div>
    );
  }
  if (error) return <CatalogErrorBanner message={error} />;
  if (!site) return <CatalogLoadingBanner label="Opening your website…" />;

  const activePage = pages.find((page) => page.id === activePageId) ?? null;

  return (
    <div className="ch247-page ch247-page--wide">
      <p className="ch247-page__hint">
        <Link to="/websites/builder">← All websites</Link>
      </p>
      <h1>
        {site.name} <Pill tone={statusTone(site.status)}>{site.status}</Pill>
      </h1>
      <Feedback error={action.error} message={action.message} />

      <div className="ch247-inline-actions">
        <button
          type="button"
          className="ch247-button"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const response = await apiFetch<{ publication: { version: number } }>(`/api/v1/builder/sites/${site.id}/publish`, {
                method: 'POST',
                body: JSON.stringify({}),
              });
              load();
              return `Published version ${response.publication.version}. The public site now serves this snapshot.`;
            })
          }
        >
          Publish
        </button>
        <button
          type="button"
          className="ch247-button ch247-button--ghost"
          disabled={action.busy || site.status !== 'published'}
          onClick={() =>
            void action.run(async () => {
              await apiFetch(`/api/v1/builder/sites/${site.id}/unpublish`, { method: 'POST', body: JSON.stringify({}) });
              load();
              return 'The site is no longer public. Your draft pages are untouched.';
            })
          }
        >
          Unpublish
        </button>
        {site.status === 'published' ? (
          <a className="ch247-button ch247-button--ghost" href={`/api/v1/public/sites/${site.slug}`} target="_blank" rel="noreferrer">
            View published site
          </a>
        ) : null}
        <span className="ch247-page__hint">
          {publications.length ? `${publications.length} published version(s), latest ${formatDate(publications[0]?.created_at)}` : 'Never published'}
        </span>
      </div>

      <section className="ch247-card">
        <h2>Pages</h2>
        <ul className="ch247-plainlist">
          {pages.map((page) => (
            <li key={page.id}>
              <button
                type="button"
                className={`ch247-button ch247-button--ghost ch247-button--small${page.id === activePageId ? ' is-active' : ''}`}
                onClick={() => setActivePageId(page.id)}
              >
                {page.is_home ? '★ ' : ''}
                {page.title} <span className="ch247-page__hint">({page.path || '/'})</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="ch247-inlineform">
          <label className="ch247-field">
            <span className="ch247-field-label">New page title</span>
            <input value={newPageTitle} onChange={(event) => setNewPageTitle(event.target.value)} maxLength={200} placeholder="Services" />
          </label>
          <button
            type="button"
            className="ch247-button ch247-button--small"
            disabled={action.busy || newPageTitle.trim().length < 1}
            onClick={() =>
              void action.run(async () => {
                await apiFetch(`/api/v1/builder/sites/${site.id}/pages`, {
                  method: 'POST',
                  body: JSON.stringify({ title: newPageTitle.trim(), content: [] }),
                });
                setNewPageTitle('');
                load();
                return 'Page created as a draft.';
              })
            }
          >
            Add page
          </button>
        </div>
      </section>

      {activePage ? (
        <PageEditor
          key={activePage.id}
          page={activePage}
          sections={sections}
          busy={action.busy}
          onSave={async (content, seo, title) => {
            await action.run(async () => {
              await apiFetch(`/api/v1/builder/pages/${activePage.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ content, seo, title }),
              });
              load();
              return 'Draft saved. Publish to make it live.';
            });
          }}
        />
      ) : (
        <EmptyState>This website has no pages yet. Add one above.</EmptyState>
      )}

      <section className="ch247-card">
        <h2>Start another page from a template</h2>
        <div className="ch247-service-grid">
          {templates.map((template) => (
            <article key={template.slug} className="ch247-service-card">
              <h3>{template.name}</h3>
              <p>{template.description}</p>
              <div className="ch247-service-card__footer">
                <button
                  type="button"
                  className="ch247-button ch247-button--small"
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await apiFetch(`/api/v1/builder/sites/${site.id}/template`, {
                        method: 'POST',
                        body: JSON.stringify({ templateSlug: template.slug, title: template.name }),
                      });
                      load();
                      return `${template.name} was added as a new draft page.`;
                    })
                  }
                >
                  Add as page
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Structured section editor driven by the server's section registry (no free-form HTML). */
function PageEditor({
  page,
  sections,
  busy,
  onSave,
}: {
  page: PageRow;
  sections: SectionDefinition[];
  busy: boolean;
  onSave: (content: PageRow['content'], seo: Record<string, unknown>, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(page.title);
  const [content, setContent] = useState<PageRow['content']>(page.content ?? []);
  const [seo, setSeo] = useState<Record<string, unknown>>(page.seo ?? {});
  const [adding, setAdding] = useState('hero');

  function updateSection(index: number, key: string, value: unknown) {
    setContent((current) => current.map((section, position) => (position === index ? { ...section, props: { ...section.props, [key]: value } } : section)));
  }

  function move(index: number, direction: -1 | 1) {
    setContent((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [moved] = next.splice(index, 1);
      if (moved) next.splice(target, 0, moved);
      return next;
    });
  }

  return (
    <section className="ch247-card">
      <h2>Edit “{page.title}”</h2>
      <label className="ch247-field">
        <span className="ch247-field-label">Page title</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} />
      </label>

      {content.map((section, index) => {
        const definition = sections.find((entry) => entry.type === section.type);
        return (
          <fieldset key={`${section.type}-${index}`} className="ch247-fieldset">
            <legend>
              {definition?.label ?? titleCase(section.type)} — section {index + 1}
            </legend>
            {(definition?.fields ?? []).map((field) => {
              const value = section.props[field.key];
              if (field.kind === 'boolean') {
                return (
                  <label key={field.key} className="ch247-field">
                    <span className="ch247-field-label">{field.label}</span>
                    <input type="checkbox" checked={Boolean(value)} onChange={(event) => updateSection(index, field.key, event.target.checked)} />
                  </label>
                );
              }
              if (field.kind === 'list') {
                return (
                  <label key={field.key} className="ch247-field">
                    <span className="ch247-field-label">{field.label} (one per line: {field.itemFields?.map((item) => item.key).join(', ')})</span>
                    <textarea
                      rows={4}
                      value={Array.isArray(value) ? (value as Array<Record<string, unknown>>).map((item) => Object.values(item).join(' | ')).join('\n') : ''}
                      onChange={(event) => {
                        const itemKeys = (field.itemFields ?? []).map((item) => item.key);
                        const parsed = event.target.value
                          .split('\n')
                          .map((line) => line.split('|').map((part) => part.trim()))
                          .filter((parts) => parts.some((part) => part.length > 0))
                          .map((parts) => Object.fromEntries(itemKeys.map((key, position) => [key, parts[position] ?? ''])));
                        updateSection(index, field.key, parsed);
                      }}
                    />
                  </label>
                );
              }
              if (field.kind === 'select') {
                return (
                  <label key={field.key} className="ch247-field">
                    <span className="ch247-field-label">{field.label}</span>
                    <select value={String(value ?? '')} onChange={(event) => updateSection(index, field.key, event.target.value)}>
                      <option value="">Default</option>
                      {(field.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {titleCase(option)}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              }
              const long = field.kind === 'long_text';
              return (
                <label key={field.key} className="ch247-field">
                  <span className="ch247-field-label">
                    {field.label}
                    {field.required ? ' *' : ''}
                  </span>
                  {long ? (
                    <textarea rows={3} maxLength={field.maxLength ?? 2000} value={String(value ?? '')} onChange={(event) => updateSection(index, field.key, event.target.value)} />
                  ) : (
                    <input maxLength={field.maxLength ?? 400} value={String(value ?? '')} onChange={(event) => updateSection(index, field.key, event.target.value)} />
                  )}
                </label>
              );
            })}
            <div className="ch247-inline-actions">
              <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => move(index, -1)}>
                Move up
              </button>
              <button type="button" className="ch247-button ch247-button--ghost ch247-button--small" onClick={() => move(index, 1)}>
                Move down
              </button>
              <button
                type="button"
                className="ch247-button ch247-button--danger ch247-button--small"
                onClick={() => setContent((current) => current.filter((_, position) => position !== index))}
              >
                Remove section
              </button>
            </div>
          </fieldset>
        );
      })}

      <div className="ch247-inlineform">
        <label className="ch247-field">
          <span className="ch247-field-label">Add a section</span>
          <select value={adding} onChange={(event) => setAdding(event.target.value)}>
            {sections.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="ch247-button ch247-button--small"
          onClick={() => setContent((current) => [...current, { type: adding, props: {} }])}
        >
          Add section
        </button>
      </div>

      <fieldset className="ch247-fieldset">
        <legend>Search engine listing</legend>
        <label className="ch247-field">
          <span className="ch247-field-label">Meta title (max 70 characters)</span>
          <input maxLength={70} value={String(seo.title ?? '')} onChange={(event) => setSeo((current) => ({ ...current, title: event.target.value }))} />
        </label>
        <label className="ch247-field">
          <span className="ch247-field-label">Meta description (max 160 characters)</span>
          <textarea rows={2} maxLength={160} value={String(seo.description ?? '')} onChange={(event) => setSeo((current) => ({ ...current, description: event.target.value }))} />
        </label>
      </fieldset>

      <button type="button" className="ch247-button" disabled={busy} onClick={() => void onSave(content, seo, title)}>
        {busy ? 'Saving…' : 'Save draft'}
      </button>
    </section>
  );
}

/**
 * Public template gallery.
 *
 * `GET /api/v1/builder/templates` serves the first-party templates plus any an administrator has
 * published, so this page can only ever show a template the builder can actually instantiate. Using
 * one creates a real site from it and opens the editor — it does not pretend to preview a design the
 * platform does not have.
 */
export function WebsiteTemplatesPage() {
  usePageMeta('Website templates', 'Start from a real CLOUDHOST247 layout — every template is built from the same section library the editor uses.', {
    canonical: '/websites/templates',
  });
  const token = getToken();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<SiteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const action = useAction();

  useEffect(() => {
    apiFetch<{ templates: SiteTemplate[] }>('/api/v1/builder/templates')
      .then((response) => setTemplates(response.templates))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="ch247-page ch247-page--wide">
      <h1>Website templates</h1>
      <p className="ch247-page__hint">
        Each template is a real, editable site: pages, sections, copy and SEO are imported into your account and stay
        yours to change.
      </p>
      <Feedback error={action.error} message={action.message} />
      {error ? <CatalogErrorBanner message={error} /> : null}

      {loading ? (
        <CatalogLoadingBanner />
      ) : templates.length === 0 ? (
        <EmptyState>No template has been published yet.</EmptyState>
      ) : (
        <div className="ch247-service-grid">
          {templates.map((template) => (
            <article key={template.slug} className="ch247-service-card">
              <h3>{template.name}</h3>
              <p>{template.description}</p>
              <p className="ch247-page__hint">
                {template.category ? `${titleCase(template.category)} · ` : ''}
                {template.source === 'custom' ? 'Published by an administrator' : 'First-party template'}
              </p>
              {template.palette ? (
                <div className="ch247-swatch-row" aria-hidden="true">
                  {['primary', 'accent', 'background'].map((key) =>
                    typeof template.palette?.[key] === 'string' ? (
                      <span key={key} className="ch247-swatch" style={{ background: String(template.palette[key]) }} />
                    ) : null
                  )}
                </div>
              ) : null}
              <div className="ch247-service-card__footer">
                <button
                  type="button"
                  className="ch247-button ch247-button--small"
                  onClick={() => setSelected(template.slug)}
                  aria-pressed={selected === template.slug}
                >
                  {selected === template.slug ? 'Selected' : 'Use this template'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="ch247-card">
        <h2>Create the site</h2>
        {!token ? (
          <p className="ch247-note">
            <Link to="/login?next=/websites/templates">Sign in</Link> to import a template into your account.
          </p>
        ) : (
          <div className="ch247-inlineform">
            <label className="ch247-field">
              <span className="ch247-field-label">Site name</span>
              <input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="My new website" />
            </label>
            <button
              type="button"
              className="ch247-button"
              disabled={action.busy || name.trim().length < 2 || !selected}
              onClick={() =>
                void action.run(async () => {
                  const response = await apiFetch<{ site: { id: string; name: string } }>('/api/v1/builder/sites', {
                    method: 'POST',
                    body: JSON.stringify({ name: name.trim(), templateSlug: selected }),
                  });
                  navigate(`/websites/builder/${response.site.id}`);
                  return '';
                })
              }
            >
              {action.busy ? 'Creating…' : 'Create site from template'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
