import { Link, useLocation } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { usePageMeta } from '../../lib/usePageMeta';
import { LEGAL_DOCUMENTS, findLegal } from '../../content/legal';

/**
 * Legal & Policy Center.
 *
 * The documents rendered here are the real CloudHost247 policies, extracted from their
 * authoritative sources by `scripts/site/extract-legal.mjs` — the signed policy PDFs where they
 * exist, the theme documents where they do not. Nothing on these pages is drafted by the website.
 *
 * The organisation is the same on both surfaces: the WHMCS theme renders the same source files, so
 * a customer reading a policy on either site reads the same words.
 *
 * `dangerouslySetInnerHTML` is used deliberately and narrowly here: the HTML is produced at build
 * time from first-party files by an extractor that strips scripts, event handlers, inline styles
 * and off-site links. No user input ever reaches it.
 */

export function LegalIndexPage() {
  usePageMeta(
    'Legal & Policy Center',
    'Every CloudHost247 legal document, policy and agreement in one place: terms, privacy, acceptable use, refunds, backups, domain agreements and data protection.',
    { canonical: '/legal' }
  );

  const groups: Array<{ title: string; description: string; slugs: string[] }> = [
    {
      title: 'Using the platform',
      description: 'The terms that govern your account, and what may and may not be hosted on it.',
      slugs: ['terms', 'acceptable-use', 'fair-usage', 'cybercrime-policy'],
    },
    {
      title: 'Privacy and data',
      description: 'What we collect, why, how long we keep it, and how to have it removed.',
      slugs: ['privacy-policy', 'cookies', 'privacy-notice-and-consent', 'data-protection-standards', 'data-deletion'],
    },
    {
      title: 'Billing and service',
      description: 'Refunds, cancellations, backups and what happens at the end of a billing period.',
      slugs: ['refund-policy', 'backup-policy'],
    },
    {
      title: 'Domains and brand',
      description: 'Registration, transfer, renewal, brokerage and trademark obligations.',
      slugs: ['domain-agreement', 'domain-registration-addendum', 'domain-renewal-policy', 'domain-brokerage-terms', 'trademark'],
    },
    {
      title: 'Company',
      description: 'Who operates this platform, and how to reach the legal contact.',
      slugs: ['legal-notice'],
    },
  ];

  const bySlug = new Map(LEGAL_DOCUMENTS.map((document) => [document.slug, document]));

  return (
    <div className="ch-ds">
      <section className="ch-hero ch-hero--compact">
        <div className="ch-wrap">
          <p className="ch-kicker">Legal</p>
          <h1>Legal &amp; Policy Center</h1>
          <p className="ch-lede">
            {LEGAL_DOCUMENTS.length} documents. These are the policies in force — every agreement,
            refund rule, privacy commitment and domain term that applies to a CloudHost247 service.
          </p>
        </div>
      </section>

      {groups.map((group) => {
        const documents = group.slugs
          .map((slug) => bySlug.get(slug))
          .filter((document): document is NonNullable<typeof document> => Boolean(document));
        if (documents.length === 0) return null;
        return (
          <section className="ch-section" key={group.title}>
            <div className="ch-wrap">
              <div className="ch-section__head">
                <div>
                  <h2>{group.title}</h2>
                </div>
                <p className="ch-lede">{group.description}</p>
              </div>
              <div className="ch-grid ch-grid--3">
                {documents.map((document) => (
                  <Link className="ch-card" to={document.spa} key={document.slug}>
                    <span className="ch-card__icon" aria-hidden><Icon name="scale" /></span>
                    <h3>{document.title}</h3>
                    <p>{document.meta.description}</p>
                    <span className="ch-card__foot">
                      <span className="ch-pill">
                        {document.meta.words.toLocaleString()} words · {document.meta.headings} sections
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        );
      })}

      <section className="ch-section ch-section--soft">
        <div className="ch-wrap ch-wrap--prose">
          <div className="ch-note">
            <h3>Where these documents come from</h3>
            <p>
              Each policy is extracted from its authoritative source at build time: the signed
              policy document where one exists, or the document maintained in the platform's theme
              where it does not. The website does not paraphrase, summarise or rewrite them.
            </p>
            <p style={{ marginBottom: 0 }}>
              If something here is unclear, or you need a policy confirmation for a procurement
              process, <Link to="/contact">contact us</Link> and you will get an answer from a
              person rather than a link to this page.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export function LegalDocumentPage() {
  const location = useLocation();
  const document = findLegal(location.pathname);

  usePageMeta(
    document?.title ?? 'Legal document',
    document?.meta.description ?? 'CloudHost247 legal documents.',
    { canonical: location.pathname, noIndex: !document }
  );

  if (!document) {
    return (
      <div className="ch-ds">
        <section className="ch-section">
          <div className="ch-wrap ch-wrap--prose">
            <h1>That policy could not be found</h1>
            <p className="ch-lede">The Legal &amp; Policy Center lists every document in force.</p>
            <Link className="ch-btn ch-btn--mint" to="/legal">Open the policy center</Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="ch-ds">
      <div className="ch-wrap--wide">
        <nav className="ch-breadcrumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link to="/">Home</Link><span aria-hidden>/</span></li>
            <li><Link to="/legal">Legal</Link><span aria-hidden>/</span></li>
            <li><span aria-current="page">{document.title}</span></li>
          </ol>
        </nav>
      </div>

      <section className="ch-section ch-section--tight" style={{ paddingTop: '20px' }}>
        <div className="ch-wrap--wide">
          <div className="ch-doc-layout">
            <nav className="ch-doc-nav" aria-label="Policies">
              <h2>Policies</h2>
              <ul>
                {LEGAL_DOCUMENTS.filter((entry) => entry.slug !== 'policy-center').map((entry) => (
                  <li key={entry.slug}>
                    <Link
                      to={entry.spa}
                      aria-current={entry.slug === document.slug ? 'page' : undefined}
                    >
                      {entry.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <article className="ch-prose-doc">
              <h1>{document.title}</h1>
              <p className="ch-muted" style={{ fontSize: '0.85rem' }}>
                {document.meta.words.toLocaleString()} words · source:{' '}
                <code>{document.source}</code>
              </p>
              {/* First-party build-time HTML, sanitised by the extractor — see the module comment. */}
              <div dangerouslySetInnerHTML={{ __html: document.html }} />
              <div className="ch-note" style={{ marginTop: '40px' }}>
                <h3>Questions about this policy</h3>
                <p style={{ marginBottom: 0 }}>
                  Contact <Link to="/contact">CloudHost247 support</Link>, or read the{' '}
                  <Link to="/legal">Legal &amp; Policy Center</Link> for the other documents that
                  apply to your services.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
