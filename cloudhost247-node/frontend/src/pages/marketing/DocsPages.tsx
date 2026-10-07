import { useEffect, useState } from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { usePageMeta } from '../../lib/usePageMeta';
import { Markdown } from '../../lib/markdown';
import { DOCUMENTS, documentsBySection, findDocument } from '../../content/registry';

/**
 * Documentation reader.
 *
 * The documents are shipped as static Markdown files under `/docs/*.md` and fetched only when a
 * reader opens one, so the application bundle stays small and the full documentation set costs a
 * visitor one file, not all of them.
 *
 * If a document 404s (a deployment that built before the docs were copied), the page says so and
 * links back to the index rather than rendering an empty article.
 */
function DocsSidebar({ currentSlug }: { currentSlug?: string }) {
  return (
    <nav className="ch-doc-nav" aria-label="Documentation">
      {documentsBySection().map((group) => (
        <div key={group.section}>
          <h2>{group.section}</h2>
          <ul>
            {group.documents.map((document) => (
              <li key={document.slug}>
                <NavLink to={document.href} aria-current={document.slug === currentSlug ? 'page' : undefined}>
                  {document.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p style={{ marginBottom: 0 }}>
        <Link className="ch-link" to="/docs">Documentation index</Link>
      </p>
    </nav>
  );
}

export function DocsIndexPage() {
  usePageMeta(
    'Documentation',
    'CloudHost247 platform documentation: API references, service architecture, account security and operations guides.',
    { canonical: '/docs' }
  );

  return (
    <div className="ch-ds">
      <section className="ch-hero ch-hero--compact">
        <div className="ch-wrap">
          <p className="ch-kicker">Resources</p>
          <h1>Documentation</h1>
          <p className="ch-lede">
            {DOCUMENTS.length} documents covering the platform's APIs, services, account security and
            operations — published from the same files the engineering team works from.
          </p>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-grid ch-grid--2">
            {documentsBySection().map((group) => (
              <div key={group.section}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className="ch-card__icon" style={{ width: 36, height: 36, borderRadius: 10 }} aria-hidden>
                    <Icon name="book" size={18} />
                  </span>
                  {group.section}
                </h2>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {group.documents.map((document) => (
                    <li key={document.slug} style={{ borderBottom: '1px solid var(--ch-line)', padding: '12px 0' }}>
                      <Link className="ch-link" to={document.href}>
                        {document.title}
                        <span className="ch-link__arrow" aria-hidden>→</span>
                      </Link>
                      <p className="ch-muted" style={{ margin: '4px 0 0', fontSize: '0.86rem' }}>{document.summary}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function DocPage() {
  const { slug = '' } = useParams();
  const entry = findDocument(slug);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePageMeta(
    entry ? entry.title : 'Documentation',
    entry ? entry.summary || `CloudHost247 documentation: ${entry.title}` : 'CloudHost247 documentation.',
    { canonical: entry?.href ?? '/docs', noIndex: !entry }
  );

  useEffect(() => {
    if (!entry) return;
    let active = true;
    setSource(null);
    setError(null);
    fetch(`/docs/${entry.slug}.md`, { headers: { Accept: 'text/markdown, text/plain' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`This document is not available on this deployment (HTTP ${response.status}).`);
        return response.text();
      })
      .then((text) => {
        if (active) setSource(text);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'The document could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [entry?.slug, entry]);

  if (!entry) {
    return (
      <div className="ch-ds">
        <section className="ch-section">
          <div className="ch-wrap ch-wrap--prose">
            <h1>That document does not exist</h1>
            <p className="ch-lede">
              The address may have changed. The documentation index lists every document this
              deployment publishes.
            </p>
            <Link className="ch-btn ch-btn--mint" to="/docs">Documentation index</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ch-ds">
      <section className="ch-section ch-section--tight" style={{ paddingTop: '28px' }}>
        <div className="ch-wrap--wide">
          <div className="ch-doc-layout">
            <DocsSidebar currentSlug={entry.slug} />
            <article className="ch-prose-doc">
              <nav className="ch-breadcrumbs" aria-label="Breadcrumb" style={{ padding: 0 }}>
                <ol>
                  <li><Link to="/">Home</Link><span aria-hidden>/</span></li>
                  <li><Link to="/docs">Documentation</Link><span aria-hidden>/</span></li>
                  <li><span aria-current="page">{entry.title}</span></li>
                </ol>
              </nav>

              {source === null && error === null ? <CatalogLoadingBanner label="Loading document…" /> : null}
              {error ? <CatalogErrorBanner message={error} /> : null}
              {source !== null ? <Markdown source={source} /> : null}

              <div className="ch-note" style={{ marginTop: '40px' }}>
                <h3>Source of this document</h3>
                <p style={{ marginBottom: 0 }}>
                  Published from <code>{entry.source}</code>. Documents describe the platform as
                  implemented, including the parts that are not finished — corrections go through{' '}
                  <Link to="/support">support</Link>.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
