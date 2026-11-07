import { Link } from 'react-router-dom';
import { Brand } from '../components/navigation/PlatformMegaMenu';
import { useLocale } from '../i18n/LocaleProvider';
import { FOOTER_COLUMNS, BRAND, UTILITY } from '../navigation/registry.generated';

/**
 * CloudHost247 footer — Hostinger-style dark footer.
 *
 * Hostinger's footer is a conversion band, then a dark five-column directory, then a legal bar.
 * This one follows that shape: a "Build. Host. Deploy. Scale." CTA, a brand block with the
 * white logo and a status link, five curated link columns, and a bottom legal bar.
 *
 * Every column is still built from `FOOTER_COLUMNS` in the shared registry — the eight source
 * columns are merged into five by topic and de-duplicated by destination. No link is invented,
 * and the registry's link-integrity test still covers all of them. Language and currency
 * switchers deliberately stay in the header only (pinned by Header.test.tsx).
 */

const FOOTER_GROUPS: Array<{ title: string; sources: string[] }> = [
  { title: 'Hosting & Cloud', sources: ['Products', 'Cloud & Servers'] },
  { title: 'Domains', sources: ['Domains'] },
  { title: 'Build & Develop', sources: ['Developers', 'Tools'] },
  { title: 'Resources', sources: ['Resources'] },
  { title: 'Company & Legal', sources: ['Company', 'Legal'] },
];

/** Merges registry columns into one curated column, keeping each destination once. */
function linksFor(sources: string[]): Array<{ label: string; to: string }> {
  const seen = new Set<string>();
  const links: Array<{ label: string; to: string }> = [];
  for (const source of sources) {
    const column = FOOTER_COLUMNS.find((entry) => entry.title === source);
    if (!column) continue;
    for (const link of column.links) {
      if (seen.has(link.to)) continue;
      seen.add(link.to);
      links.push(link);
    }
  }
  // Deliberately no truncation: the footer is the one place every registry destination is
  // reachable, and dropping entries would silently break the site-wide link contract.
  return links;
}

export default function Footer() {
  const year = new Date().getFullYear();
  const { t } = useLocale();

  return (
    <footer className="ch247-footer hg-footer">
      <div className="hg-wrap">
        <div className="hg-footer__cta">
          <div>
            <p className="hg-footer__eyebrow">CloudHost247</p>
            <h2>{BRAND.tagline}</h2>
            <p>{BRAND.description}</p>
          </div>
          <Link className="hg-btn hg-btn--light" to={UTILITY.createAccount.to}>
            {UTILITY.createAccount.label}
          </Link>
        </div>

        <div className="hg-footer__main">
          <div className="hg-footer__brand">
            <Brand className="ch247-brand--footer" />
            <p>One account for domains, hosting, cloud servers, applications and the tools that keep them running.</p>
            <Link className="hg-link" to="/status">
              View platform status <span className="hg-link__arrow" aria-hidden>→</span>
            </Link>
          </div>

          <nav className="hg-footer__columns" aria-label="Footer">
            {FOOTER_GROUPS.map((group) => {
              const links = linksFor(group.sources);
              return (
                <div
                  className={`hg-footer__column${links.length > 10 ? ' hg-footer__column--wide' : ''}`}
                  key={group.title}
                >
                  <h2>{group.title}</h2>
                  <ul>
                    {links.map((link) => (
                      <li key={`${group.title}-${link.to}-${link.label}`}>
                        <Link to={link.to}>{link.label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>
        </div>

        <div className="hg-footer__bottom">
          <p>{t('footer.copyright', { year, legalName: BRAND.legalName })}</p>
          <nav aria-label={t('footer.legalAndAccount')}>
            <Link to="/legal">{t('footer.nav.legalCenter')}</Link>
            <Link to="/legal/privacy-policy">{t('footer.nav.privacy')}</Link>
            <Link to="/legal/cookies">{t('footer.nav.cookies')}</Link>
            <Link to="/legal/terms">{t('footer.nav.terms')}</Link>
            <Link to="/status">{t('footer.nav.status')}</Link>
            <Link to="/help">{t('footer.nav.help')}</Link>
            <Link to="/contact">{t('footer.nav.contact')}</Link>
            <Link to="/sitemap">Sitemap</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}
