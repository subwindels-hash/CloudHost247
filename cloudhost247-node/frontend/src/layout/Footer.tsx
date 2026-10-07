import { Link } from 'react-router-dom';
import { FOOTER_COLUMNS, BRAND, UTILITY } from '../navigation/registry.generated';

/**
 * The global CloudHost247 footer.
 *
 * Nine columns covering Products, Cloud & Infrastructure, Domains, Platforms & Developers, Tools,
 * Websites, Company, Support and Legal. Every link comes from the same registry as the header, so
 * the footer can never advertise a route the application does not serve — and because the registry
 * is validated against the router at build time, "no dead footer links" is a build guarantee rather
 * than a promise.
 *
 * The Tools column comes from the same registry as the header and sitemap. It links the current
 * discovery categories and the complete index rather than duplicating a second category list here.
 */
export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="ch247-footer">
      <div className="ch-wrap--wide">
        <div className="ch247-footer__top">
          <div>
            <Link to="/" className="ch247-brand ch247-brand--footer" aria-label="CloudHost247 — home">
              <span className="ch247-brand__mark" aria-hidden>
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9L12 2.5Z" fill="none" stroke="#7ff0b4" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M3 7.5 12 13l9-5.5M12 13v8.5" fill="none" stroke="#7ff0b4" strokeWidth="1" opacity="0.7" />
                  <circle cx="12" cy="13" r="1.7" fill="#7ff0b4" />
                </svg>
              </span>
              <span>
                CloudHost<span className="ch247-brand__suffix">247</span>
              </span>
            </Link>
            <p>{BRAND.description}</p>
            <p style={{ fontWeight: 600, color: '#fff', marginBottom: 0 }}>{BRAND.tagline}</p>
            <div className="ch247-footer__badge">
              <Link className="ch-btn ch-btn--on-ink ch-btn--sm" to={UTILITY.createAccount.to}>
                {UTILITY.createAccount.label}
              </Link>
            </div>
          </div>

          <nav className="ch247-footer__columns" aria-label="Footer">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <h2>{column.title}</h2>
                <ul>
                  {column.links.map((link) => (
                    <li key={`${column.title}-${link.to}-${link.label}`}>
                      <Link to={link.to}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="ch247-footer__bottom">
          <p style={{ margin: 0 }}>
            © {year} {BRAND.legalName} All rights reserved.
          </p>
          <nav aria-label="Legal and account">
            <Link to="/legal">Legal &amp; Policy Center</Link>
            <Link to="/legal/privacy-policy">Privacy</Link>
            <Link to="/legal/cookies">Cookies</Link>
            <Link to="/legal/terms">Terms</Link>
            <Link to="/status">Status</Link>
            <Link to="/help">Help</Link>
            <Link to="/contact">Contact</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
