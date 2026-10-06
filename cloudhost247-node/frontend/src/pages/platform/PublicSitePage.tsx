import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import type { PublicForm, PublishedPage, PublishedSite } from '../../lib/platform-api';
import '../../published-site.css';

/**
 * Renders a published CloudHost247 website.
 *
 * Only the immutable publication snapshot is served by the API, so this page shows exactly what the
 * owner published — a draft edit is invisible here until the next publish. Every section type in the
 * registry has a renderer: an unknown or malformed section is skipped rather than printed as
 * markup, and all text reaches the DOM as text nodes (never as HTML), which is why nothing here can
 * render script.
 *
 * A contact form posts to the real public submission endpoint; the message lands in the owner's
 * Unified Inbox.
 */
export default function PublicSitePage() {
  const params = useParams<{ slug: string; '*': string }>();
  const location = useLocation();
  const slug = params.slug ?? '';
  const [site, setSite] = useState<PublishedSite | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);

  useEffect(() => {
    setSite(null);
    setError(null);
    apiFetch<PublishedSite>(`/api/v1/public/sites/${encodeURIComponent(slug)}`)
      .then(setSite)
      .catch((err: Error) => setError({ message: err.message, status: err instanceof ApiRequestError ? err.status : undefined }));
  }, [slug]);

  if (error) {
    return (
      <div className="ch247-published">
        <div className="ch247-published__inner">
          <h1>Website unavailable</h1>
          <p>
            {error.status === 404
              ? 'No published CloudHost247 website is served at this address. If you own it, publish it from the Website Builder.'
              : error.message}
          </p>
          <p>
            <Link to="/websites/builder">Go to the Website Builder</Link>
          </p>
        </div>
      </div>
    );
  }
  if (!site) {
    return (
      <div className="ch247-published">
        <div className="ch247-published__inner">
          <CatalogLoadingBanner label="Loading the website…" />
        </div>
      </div>
    );
  }

  const suffix = params['*'] ?? '';
  const wanted = `/${suffix}`.replace(/\/+$/, '') || '/';
  const page = site.snapshot.pages.find((entry) => entry.path === wanted) ?? site.snapshot.pages.find((entry) => entry.isHome);

  if (!page) {
    return (
      <div className="ch247-published">
        <div className="ch247-published__inner">
          <h1>Page not found</h1>
          <p>That page is not part of this website.</p>
          <p>
            <Link to={`/sites/${slug}`}>Back to the home page</Link>
          </p>
        </div>
      </div>
    );
  }

  return <PublishedPageView site={site} page={page} pathname={location.pathname} slug={slug} />;
}

function PublishedPageView({ site, page, slug }: { site: PublishedSite; page: PublishedPage; pathname: string; slug: string }) {
  const theme = site.snapshot.theme ?? {};
  const style: Record<string, string> = {};
  for (const key of ['primary', 'accent', 'background', 'ink', 'surface']) {
    const value = theme[key];
    if (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)) {
      style[`--ch247-site-${key}`] = value;
    }
  }

  const faqItems = page.content
    .filter((section) => section.type === 'faq')
    .flatMap((section) => propsList(section.props, 'items'))
    .map((item) => ({ question: String(item.question ?? ''), answer: String(item.answer ?? '') }))
    .filter((item) => item.question && item.answer);

  usePageMeta(page.seo?.title || page.title, page.seo?.description, {
    canonical: page.seo?.canonical ?? `/sites/${slug}${page.path === '/' ? '' : page.path}`,
    og: { title: page.seo?.title || page.title, description: page.seo?.description },
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: site.snapshot.name,
        url: `${window.location.origin}/sites/${slug}`,
      },
      ...(faqItems.length
        ? [
            {
              '@context': 'https://schema.org',
              '@type': 'FAQPage',
              mainEntity: faqItems.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
              })),
            },
          ]
        : []),
    ],
  });

  const otherPages = site.snapshot.pages.filter((entry) => entry.path !== page.path);

  return (
    <div className="ch247-published" style={style as React.CSSProperties}>
      <header className="ch247-published__header">
        <Link to={`/sites/${slug}`} className="ch247-published__brand">
          {site.snapshot.name}
        </Link>
        <nav aria-label="Website pages">
          <ul>
            {site.snapshot.pages.map((entry) => (
              <li key={entry.id}>
                <Link to={`/sites/${slug}${entry.path === '/' ? '' : entry.path}`} aria-current={entry.path === page.path ? 'page' : undefined}>
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="ch247-published__main">
        {page.content.map((section) => (
          <SectionView key={section.id} section={section} site={site} slug={slug} />
        ))}
      </main>

      {otherPages.length === 0 ? (
        <footer className="ch247-published__footer">
          <p>
            Built with <Link to="/websites/builder">CloudHost247 Website Builder</Link>
          </p>
        </footer>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Section renderers
 * ------------------------------------------------------------------------------------------- */

function text(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  return typeof value === 'string' ? value : '';
}

function propsList(props: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = props[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
}

/** Rewrites an author-supplied link for the public site: internal paths stay inside the site. */
function resolveHref(href: string, slug: string): string {
  if (href.startsWith('/')) return `/sites/${slug}${href === '/' ? '' : href}`;
  return href;
}

function SectionView({ section, site, slug }: { section: { id: string; type: string; props: Record<string, unknown> }; site: PublishedSite; slug: string }) {
  const props = section.props ?? {};
  switch (section.type) {
    case 'hero':
      return (
        <section className={`ch247-published__hero ch247-published__hero--${text(props, 'align') === 'center' ? 'center' : 'left'}`}>
          {text(props, 'imageUrl') ? <img src={text(props, 'imageUrl')} alt={text(props, 'imageAlt')} /> : null}
          <h1>{text(props, 'heading')}</h1>
          {text(props, 'subheading') ? <p>{text(props, 'subheading')}</p> : null}
          <div className="ch247-published__buttons">
            {propsList(props, 'buttons').map((button, index) => (
              <a key={index} className="ch247-published__button" href={resolveHref(String(button.href ?? ''), slug)}>
                {String(button.label ?? '')}
              </a>
            ))}
          </div>
        </section>
      );
    case 'rich_text':
      return (
        <section className={`ch247-published__section ch247-published__section--${text(props, 'align') === 'center' ? 'center' : 'left'}`}>
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          <Body text={text(props, 'body')} />
        </section>
      );
    case 'features':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          {text(props, 'intro') ? <Body text={text(props, 'intro')} /> : null}
          <div className="ch247-published__grid">
            {propsList(props, 'items').map((item, index) => (
              <article key={index}>
                <h3>{String(item.title ?? '')}</h3>
                {item.description ? <Body text={String(item.description)} /> : null}
              </article>
            ))}
          </div>
        </section>
      );
    case 'image_text': {
      const imageLeft = text(props, 'imagePosition') === 'left';
      return (
        <section className={`ch247-published__section ch247-published__split${imageLeft ? ' is-image-left' : ''}`}>
          {text(props, 'imageUrl') ? <img src={text(props, 'imageUrl')} alt={text(props, 'imageAlt')} /> : null}
          <div>
            <h2>{text(props, 'heading')}</h2>
            <Body text={text(props, 'body')} />
            {text(props, 'ctaHref') ? (
              <a className="ch247-published__button" href={resolveHref(text(props, 'ctaHref'), slug)}>
                {text(props, 'ctaLabel')}
              </a>
            ) : null}
          </div>
        </section>
      );
    }
    case 'gallery':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          <div className={`ch247-published__gallery ch247-published__gallery--${text(props, 'columns') || '3'}`}>
            {propsList(props, 'images').map((image, index) => (
              <figure key={index}>
                <img src={String(image.url ?? '')} alt={String(image.alt ?? '')} />
                {image.caption ? <figcaption>{String(image.caption)}</figcaption> : null}
              </figure>
            ))}
          </div>
        </section>
      );
    case 'cta':
      return (
        <section className="ch247-published__section ch247-published__cta">
          <h2>{text(props, 'heading')}</h2>
          {text(props, 'body') ? <Body text={text(props, 'body')} /> : null}
          <a className="ch247-published__button" href={resolveHref(text(props, 'buttonHref'), slug)}>
            {text(props, 'buttonLabel')}
          </a>
        </section>
      );
    case 'pricing':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          {text(props, 'intro') ? <Body text={text(props, 'intro')} /> : null}
          <div className="ch247-published__grid">
            {propsList(props, 'plans').map((plan, index) => (
              <article key={index} className={String(plan.highlighted ?? '') === 'true' ? 'is-highlighted' : ''}>
                <h3>{String(plan.name ?? '')}</h3>
                <p className="ch247-published__price">
                  {String(plan.price ?? '')} <span>{String(plan.period ?? '')}</span>
                </p>
                {String(plan.features ?? '')
                  .split('\n')
                  .filter(Boolean)
                  .map((feature) => (
                    <p key={feature}>{feature}</p>
                  ))}
                {plan.ctaHref ? (
                  <a className="ch247-published__button" href={resolveHref(String(plan.ctaHref), slug)}>
                    {String(plan.ctaLabel ?? 'Choose')}
                  </a>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      );
    case 'testimonials':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          <div className="ch247-published__grid">
            {propsList(props, 'items').map((item, index) => (
              <blockquote key={index}>
                <p>{String(item.quote ?? '')}</p>
                <footer>
                  {item.avatarUrl ? <img src={String(item.avatarUrl)} alt="" /> : null}
                  <span>
                    {String(item.author ?? '')}
                    {item.role ? `, ${String(item.role)}` : ''}
                  </span>
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      );
    case 'logos':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          <div className="ch247-published__logos">
            {propsList(props, 'items').map((item, index) => (
              <img key={index} src={String(item.url ?? '')} alt={String(item.alt ?? '')} />
            ))}
          </div>
        </section>
      );
    case 'stats':
      return (
        <section className="ch247-published__section ch247-published__stats">
          {propsList(props, 'items').map((item, index) => (
            <div key={index}>
              <strong>{String(item.value ?? '')}</strong>
              <span>{String(item.label ?? '')}</span>
            </div>
          ))}
        </section>
      );
    case 'team':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          <div className="ch247-published__grid">
            {propsList(props, 'members').map((member, index) => (
              <article key={index}>
                {member.photoUrl ? <img src={String(member.photoUrl)} alt={String(member.name ?? '')} /> : null}
                <h3>{String(member.name ?? '')}</h3>
                {member.role ? <p className="ch247-page__hint">{String(member.role)}</p> : null}
                {member.bio ? <Body text={String(member.bio)} /> : null}
              </article>
            ))}
          </div>
        </section>
      );
    case 'faq':
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          <div className="ch247-published__faq">
            {propsList(props, 'items').map((item, index) => (
              <details key={index}>
                <summary>{String(item.question ?? '')}</summary>
                <Body text={String(item.answer ?? '')} />
              </details>
            ))}
          </div>
        </section>
      );
    case 'contact_form': {
      const form = site.snapshot.forms.find((entry) => entry.id === text(props, 'formId'));
      return (
        <section className="ch247-published__section">
          {text(props, 'heading') ? <h2>{text(props, 'heading')}</h2> : null}
          {text(props, 'body') ? <Body text={text(props, 'body')} /> : null}
          {form ? <PublicFormBlock form={form} slug={slug} /> : <p>This form is no longer published.</p>}
        </section>
      );
    }
    case 'footer':
      return (
        <footer className="ch247-published__footer">
          {text(props, 'about') ? <Body text={text(props, 'about')} /> : null}
          <div className="ch247-published__grid">
            {propsList(props, 'columns').map((column, index) => (
              <div key={index}>
                <h3>{String(column.title ?? '')}</h3>
                <ul>
                  {String(column.links ?? '')
                    .split('\n')
                    .map((line) => line.split('|').map((part) => part.trim()))
                    .filter((parts) => parts.length === 2 && parts[0] && parts[1])
                    .map(([label, href]) => (
                      <li key={`${label}-${href}`}>
                        <a href={resolveHref(href!, slug)}>{label}</a>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
          {text(props, 'copyright') ? <p className="ch247-page__hint">{text(props, 'copyright')}</p> : null}
        </footer>
      );
    default:
      // An unrecognised section is skipped: printing unknown props as markup would be a bug.
      return null;
  }
}

/** Body copy: newlines become paragraphs. Values are always text — never HTML. */
function Body({ text: value }: { text: string }) {
  const paragraphs = value.split(/\n{2,}/).filter((paragraph) => paragraph.trim());
  if (paragraphs.length === 0) return null;
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="ch247-pre-wrap">
          {paragraph}
        </p>
      ))}
    </>
  );
}

function PublicFormBlock({ form, slug }: { form: PublicForm; slug: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'sent' | 'error'; message?: string }>({ kind: 'idle' });

  return (
    <form
      className="ch247-published__form"
      onSubmit={async (event) => {
        event.preventDefault();
        setState({ kind: 'busy' });
        try {
          const response = await apiFetch<{ successMessage: string }>(`/api/v1/public/sites/${slug}/forms/${form.id}/submissions`, {
            method: 'POST',
            body: JSON.stringify({ fields: values }),
          });
          setValues({});
          setState({ kind: 'sent', message: response.successMessage });
        } catch (err) {
          setState({ kind: 'error', message: err instanceof Error ? err.message : 'That could not be sent.' });
        }
      }}
    >
      {form.fields.map((field) => (
        <label key={field.key} className="ch247-published__field">
          <span>
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          {field.kind === 'textarea' ? (
            <textarea
              rows={4}
              required={field.required}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            />
          ) : field.kind === 'select' ? (
            <select
              required={field.required}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            >
              <option value="">Choose…</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : field.kind === 'checkbox' ? (
            <input
              type="checkbox"
              checked={values[field.key] === 'true'}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.checked ? 'true' : 'false' })}
            />
          ) : (
            <input
              type={field.kind === 'email' ? 'email' : field.kind === 'phone' ? 'tel' : 'text'}
              required={field.required}
              value={values[field.key] ?? ''}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            />
          )}
        </label>
      ))}
      <button type="submit" className="ch247-published__button" disabled={state.kind === 'busy'}>
        {state.kind === 'busy' ? 'Sending…' : 'Send'}
      </button>
      {state.kind === 'sent' ? <p role="status">{state.message}</p> : null}
      {state.kind === 'error' ? <p role="alert">{state.message}</p> : null}
    </form>
  );
}
