import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toolsApi, type ToolSummary } from '../../lib/tools-api';
import { usePageMeta } from '../../lib/usePageMeta';

/**
 * Compliance & Document Tools hub.
 *
 * The registry footer and the Tools menu have always linked `/tools/compliance-documents`, and the
 * PHP surface answers it with a curated collection page. The single-page app did not, so the link
 * dead-ended in the catalogue's "Tool not found" state — the one link in the navigation that had
 * no page behind it. This page is that collection for the app: the same groups, the same intent.
 *
 * Two rules keep it from drifting:
 *
 *  1. **Every entry is looked up in the live catalogue.** A slug that is not served is dropped
 *     rather than rendered as a link to nowhere, and the group is dropped with it.
 *  2. **A group is never padded.** These are the tools the PHP collection names, translated to the
 *     slugs this surface actually serves; where this surface has no equivalent of a PHP-only tool
 *     (an age calculator, an API-key generator) the entry is simply absent, because a hub that
 *     advertises tools it cannot open is worse than a shorter hub.
 */

interface Group {
  slug: string;
  label: string;
  blurb: string;
  tools: string[];
}

/** The collection, in the PHP surface's group order and naming. */
const GROUPS: Group[] = [
  {
    slug: 'identity',
    label: 'Identity & Document',
    blurb: 'Machine-readable document formatting and the parsers that check identity data.',
    tools: ['mrz-generator', 'image-ocr', 'word-counter'],
  },
  {
    slug: 'security',
    label: 'Security & Secrets',
    blurb: 'Random material, digests and written policy — generated in the browser, never uploaded.',
    tools: ['password-tools', 'uuid-generator', 'bin-checker', 'ip-blacklist'],
  },
  {
    slug: 'developer',
    label: 'Developer',
    blurb: 'Identifiers, encodings and structured data for build and debug workflows.',
    tools: ['json-tools', 'encoding-tools', 'url-tools', 'qr-generator', 'qr-scanner'],
  },
  {
    slug: 'webmaster',
    label: 'Infrastructure & Domains',
    blurb: 'Configuration files the platform will actually read, and the checks that prove it.',
    tools: ['robots-generator', 'http-headers', 'ssl-checker', 'domain-health'],
  },
];

export default function ComplianceDocumentsPage() {
  usePageMeta(
    'Compliance & Document Tools — MRZ, Security & Developer Utilities | CloudHost247',
    'Compliance and document utilities: ICAO MRZ generation and parsing, secret and identifier generators, encoders, and the configuration checks a live site depends on. Everything runs in your browser.'
  );

  const [tools, setTools] = useState<ToolSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    toolsApi
      .catalog()
      .then((catalog) => {
        if (!cancelled) setTools(catalog.tools);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'The tool catalogue could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const bySlug = new Map((tools ?? []).map((tool) => [tool.slug, tool]));
  // A group survives only if at least one of its tools is served, and `resolved` keeps the order
  // the collection declares rather than the order the catalogue returns.
  const resolved = GROUPS.map((group) => ({
    ...group,
    entries: group.tools.map((slug) => bySlug.get(slug)).filter((tool): tool is ToolSummary => Boolean(tool)),
  })).filter((group) => group.entries.length > 0);

  return (
    <div className="tools-center">
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', opacity: 0.9 }}>Tools → Collections</p>
          <h1>Compliance &amp; Document Tools</h1>
          <p>
            Utilities for identity-document formatting, secret generation, developer data handling and
            the configuration a live site depends on. Every one of them runs in your tab: passwords,
            tokens, hashes and document fields are never uploaded, logged or stored by CloudHost247.
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-stack">
          {error && (
            <div className="ch247-card" role="alert">
              <h2>The tool catalogue could not be loaded</h2>
              <p>{error}</p>
              <p>
                <Link to="/tools">Open the Tools Center</Link> for the same tools with their own status
                and retry behaviour.
              </p>
            </div>
          )}

          {!error && !tools && <p role="status">Loading the collection…</p>}

          {!error && tools && resolved.length === 0 && (
            <div className="ch247-card">
              <h2>Nothing to show yet</h2>
              <p>
                None of the tools in this collection are enabled on this platform right now.{' '}
                <Link to="/tools">Browse every tool</Link> instead.
              </p>
            </div>
          )}

          {resolved.map((group) => (
            <div className="ch247-card" key={group.slug} id={group.slug}>
              <h2>{group.label}</h2>
              <p className="ch247-page__hint">{group.blurb}</p>
              <ul className="ch247-stack">
                {group.entries.map((tool) => (
                  <li key={tool.slug}>
                    <Link to={tool.path}>{tool.name}</Link> — {tool.summary}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {tools && (
            <p className="ch247-page__hint">
              These tools generate, validate or check the data you give them. None of them authenticate
              a document, certify a compliance programme or prove that a system is secure — each states
              what it actually verifies. <Link to="/tools">See the full inventory →</Link>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
