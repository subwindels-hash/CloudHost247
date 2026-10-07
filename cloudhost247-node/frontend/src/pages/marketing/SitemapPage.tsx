import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { NAV_SECTIONS, FOOTER_COLUMNS, LEGAL_INDEX, TOOLS_CATEGORIES } from '../../navigation/registry.generated';
import { MARKETING_PAGES, DOCUMENTS, CONTENT_COUNTS } from '../../content/registry';
import { LEGAL_DOCUMENTS } from '../../content/legal';

/**
 * Human sitemap.
 *
 * Generated from the same registry that produces the header, the footer and `/sitemap.xml` — so
 * this page cannot list a route that does not exist, and cannot omit one that does. That is the
 * whole reason it exists: a hand-maintained sitemap page is the first thing to go stale on a site
 * this size, and the first thing a crawler or a lost visitor reads.
 */
export default function SitemapPage() {
  usePageMeta(
    'Sitemap',
    'Every public page on CloudHost247: hosting, cloud and servers, domains, platforms, developers, websites, tools, documentation, legal policies and support.',
    { canonical: '/sitemap' }
  );

  const legalDocs = LEGAL_DOCUMENTS.filter((document) => document.slug !== 'policy-center');

  return (
    <div className="ch-ds">
      <section className="ch-hero ch-hero--compact">
        <div className="ch-wrap">
          <p className="ch-kicker">Navigation</p>
          <h1>Sitemap</h1>
          <p className="ch-lede">
            {CONTENT_COUNTS.pages} product pages, {CONTENT_COUNTS.documents} documents,{' '}
            {legalDocs.length} policies and {FOOTER_COLUMNS.length} footer sections — every one of
            them generated from the same navigation registry the menu uses.
          </p>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-grid ch-grid--2">
            {NAV_SECTIONS.map((section) => (
              <div key={section.id}>
                <h2>{section.label}</h2>
                <p className="ch-muted" style={{ fontSize: '0.88rem' }}>{section.blurb}</p>
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {section.groups.flatMap((group) => group.links).map((link) => (
                    <li key={`${section.id}-${link.to}-${link.label}`} style={{ padding: '5px 0' }}>
                      <Link to={link.to}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="ch-section ch-section--soft">
        <div className="ch-wrap">
          <div className="ch-grid ch-grid--3">
            <div>
              <h2>Documentation</h2>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li style={{ padding: '5px 0' }}><Link to="/docs">Documentation index</Link></li>
                {DOCUMENTS.map((document) => (
                  <li key={document.slug} style={{ padding: '5px 0' }}><Link to={document.href}>{document.title}</Link></li>
                ))}
              </ul>
            </div>

            <div>
              <h2>Policies</h2>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li style={{ padding: '5px 0' }}><Link to="/legal">Legal &amp; Policy Center</Link></li>
                {legalDocs.map((document) => (
                  <li key={document.slug} style={{ padding: '5px 0' }}><Link to={document.spa}>{document.title}</Link></li>
                ))}
              </ul>
            </div>

            <div>
              <h2>Tools</h2>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                <li style={{ padding: '5px 0' }}><Link to="/tools">All tools</Link></li>
                {TOOLS_CATEGORIES.map((category) => (
                  <li key={category.slug} style={{ padding: '5px 0' }}>
                    <Link to={`/tools/category/${category.slug}`}>{category.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">Machine readable</p>
              <h2>For crawlers and integrations</h2>
            </div>
            <p className="ch-lede">
              The XML sitemap is generated from the same navigation definition on every request, so it
              always matches the routes the application serves.
            </p>
          </div>
          <ul className="ch-pill-row">
            <li className="ch-pill"><a href="/sitemap.xml">/sitemap.xml</a></li>
            <li className="ch-pill"><a href="/robots.txt">/robots.txt</a></li>
            <li className="ch-pill"><a href="/api/v1/navigation">/api/v1/navigation</a></li>
            <li className="ch-pill">{LEGAL_INDEX.length} indexed policies</li>
            <li className="ch-pill">{MARKETING_PAGES.length} product pages</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
