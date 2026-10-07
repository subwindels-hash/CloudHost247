import news from '../../../../../shared/site/content/news.json';
import type { MarketingSection } from '../../content/registry';

/**
 * Release notes.
 *
 * These are the platform's own release notes — written from what shipped, each carrying the
 * limitation that came with it. A "what's new" page that only lists wins is marketing; this one
 * is a changelog a customer can use to decide whether to depend on something.
 *
 * Entries live in `shared/site/content/news.json` and are rendered identically wherever a release
 * note appears, including the `News` section type a marketing page can opt into.
 */
interface NewsEntry {
  id: string;
  label: string;
  title: string;
  summary: string;
  body: string[];
  limits: string;
}

export default function News({ section }: { section: MarketingSection }) {
  const entries = (news as { entries: NewsEntry[] }).entries;
  return (
    <>
      <div className="ch-section__head">
        <div>
          {section.kicker ? <p className="ch-kicker">{section.kicker}</p> : null}
          <h2>{section.heading}</h2>
        </div>
        <p className="ch-lede">
          {entries.length} entries. Each one states its own limitation, because a release note that
          only lists improvements is an advertisement.
        </p>
      </div>

      <div className="ch-grid ch-grid--2">
        {entries.map((entry) => (
          <article className="ch-card" key={entry.id} id={entry.id}>
            <span className="ch-pill">{entry.label}</span>
            <h3>{entry.title}</h3>
            <p>{entry.summary}</p>
            {entry.body.map((paragraph) => (
              <p key={paragraph.slice(0, 30)} style={{ fontSize: '0.87rem' }}>{paragraph}</p>
            ))}
            <div className="ch-note" style={{ marginTop: 'auto' }}>
              <h3 style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ch-muted)' }}>
                Limit
              </h3>
              <p style={{ marginBottom: 0, fontSize: '0.85rem' }}>{entry.limits}</p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
