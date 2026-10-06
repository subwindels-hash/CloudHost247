import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';

/**
 * Tools → Developer / Document Tools directory page.
 *
 * Links to the canonical catalogue route (/tools/mrz-generator) plus the retained
 * /tools/document/mrz and /tools/document/mrz-parser URLs, so every entry here is a route that is
 * registered in the Tools Center catalogue and reachable from the footer, mega menu and search.
 */
export default function ToolsHubPage() {
  usePageMeta(
    'Developer & Document Tools — CloudHost247',
    'CloudHost247 Developer and Document Tools including the ICAO Doc 9303 TD3 ePassport MRZ Calculator, Validator, and Parser.'
  );

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <p style={{ margin: '0 0 0.35rem', fontSize: '0.85rem', opacity: 0.9 }}>
            Tools → Developer / Document Tools
          </p>
          <h1>Developer &amp; Document Tools</h1>
          <p>
            Privacy-first utilities for software engineering, document-format testing, OCR calibration,
            and parser integration testing.
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-stack">
          <div className="ch247-card">
            <h2>Document &amp; OCR Testing Utilities</h2>
            <p className="ch247-page__hint">
              Tools → Developer / Document Tools → MRZ Calculator &amp; Parser
            </p>

            <div className="ch247-dsvc-result-grid" style={{ marginTop: '1rem' }}>
              <article className="ch247-dsvc-card" style={{ border: '1px solid var(--ch247-border)', borderRadius: 10, padding: '1.25rem', background: '#fff' }}>
                <h3 style={{ marginTop: 0 }}>MRZ Calculator &amp; Validator</h3>
                <p>
                  Generate and validate ICAO Doc 9303 TD3 two-line machine-readable passport format strings,
                  inspect Latin diacritic transliteration, and verify 7-3-1 check digits for software testing.
                </p>
                <p style={{ marginBottom: 0 }}>
                  <Link className="ch247-button" to="/tools/mrz-generator">
                    Open MRZ Generator / MRZ Tools →
                  </Link>
                </p>
                <p className="ch247-page__hint" style={{ margin: '0.5rem 0 0' }}>
                  Registered in the Tools Center catalogue, so it also appears in the Tools menu, the
                  Developer category and the site footer. Calculator, validator and parser are tabs on
                  the same page; the original <code>/tools/document/mrz</code> URL still works.
                </p>
              </article>

              <article className="ch247-dsvc-card" style={{ border: '1px solid var(--ch247-border)', borderRadius: 10, padding: '1.25rem', background: '#fff' }}>
                <h3 style={{ marginTop: 0 }}>MRZ Parser</h3>
                <p>
                  Parse existing two-line TD3 MRZ strings into structured document fields and verify
                  individual and composite check digits with CloudHost247 AI technical explanations.
                </p>
                <p style={{ marginBottom: 0 }}>
                  <Link className="ch247-button ch247-button--ghost" to="/tools/mrz-parser">
                    Open MRZ Parser →
                  </Link>
                </p>
                <p className="ch247-page__hint" style={{ margin: '0.5rem 0 0' }}>
                  Same engine and privacy behaviour; the retained <code>/tools/document/mrz-parser</code>{' '}
                  URL still works.
                </p>
              </article>
            </div>
          </div>

          <div className="ch247-card">
            <h3>Privacy &amp; Intended Use</h3>
            <p className="ch247-page__hint" style={{ marginBottom: 0 }}>
              Calculations run locally in your browser by default and no submitted MRZ strings, passport
              numbers, dates of birth, nationalities, or names are persisted or logged. These utilities
              generate and validate machine-readable text for software testing only—mathematical MRZ
              validation never verifies that a physical passport is genuine.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
