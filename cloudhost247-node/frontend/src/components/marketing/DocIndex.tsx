import { Link } from 'react-router-dom';
import { documentsBySection } from '../../content/registry';
import { Icon } from '../ui/Icon';
import type { MarketingSection } from '../../content/registry';

/**
 * Documentation index.
 *
 * The documents are the repository's own product documentation — API contracts, service
 * architecture, account security and operations — copied into the static build by
 * `scripts/site/generate.mjs` and read on demand by the document reader at `/docs/:slug`.
 *
 * Internal material (audits, scope proposals, the incomplete-work register, runbooks) is
 * deliberately not published, so this index is short and everything in it is something a customer
 * or integrator should actually read.
 */
const SECTION_ICONS: Record<string, string> = {
  APIs: 'api',
  Services: 'layers',
  Accounts: 'key',
  Operations: 'control',
};

export default function DocIndex({ section }: { section: MarketingSection }) {
  const groups = documentsBySection();

  if (groups.length === 0) {
    return (
      <>
        <h2>{section.heading}</h2>
        <div className="ch-state ch-state--warn">
          <Icon name="alert" size={20} />
          <span>
            <strong>No documents are published on this deployment.</strong>
            {section.emptyMessage}
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      {section.kicker ? <p className="ch-kicker">{section.kicker}</p> : null}
      <h2>{section.heading}</h2>

      {groups.map((group) => (
        <div key={group.section} style={{ marginTop: '36px' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="ch-card__icon" style={{ width: 32, height: 32, borderRadius: 9 }} aria-hidden>
              <Icon name={SECTION_ICONS[group.section] ?? 'file-text'} size={16} />
            </span>
            {group.section}
          </h3>
          <div className="ch-grid ch-grid--2" style={{ marginTop: '16px' }}>
            {group.documents.map((document) => (
              <Link className="ch-card" to={document.href} key={document.slug}>
                <h3>{document.title}</h3>
                <p>{document.summary || 'Open the document to read it.'}</p>
                <span className="ch-card__foot">
                  <span className="ch-pill">{Math.max(1, Math.round(document.bytes / 1024))} KB</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
