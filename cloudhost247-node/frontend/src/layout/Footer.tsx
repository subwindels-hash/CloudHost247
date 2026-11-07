import { Link } from 'react-router-dom';
import { Brand } from '../components/navigation/PlatformMegaMenu';
import { Icon } from '../components/ui/Icon';
import { useLocale } from '../i18n/LocaleProvider';
import { FOOTER_COLUMNS, BRAND, UTILITY } from '../navigation/registry.generated';

/**
 * CloudHost247 footer — Amazon-style directory.
 *
 * The reference is the *anatomy*, not the brand: a full-width "Back to top" strip, a deep dark
 * directory of four dense topic columns with white headings and muted small links, a divided
 * brand + locale row, and a darker legal/copyright band. Amazon's own marks, copy and commerce
 * links are not reproduced; every destination here still comes from FOOTER_COLUMNS in the shared
 * registry, so the footer, menus and sitemap cannot disagree about what exists.
 *
 * The eight registry columns are merged into four topics and de-duplicated by destination. No
 * link is dropped — the footer is the one place every registry destination stays reachable.
 * Language/currency switchers deliberately remain in the header only (pinned by Header.test.tsx);
 * the pills below are a read-out of the current locale/currency, not a second set of controls.
 */

const FOOTER_GROUPS: Array<{ title: string; sources: string[] }> = [
  { title: 'Hosting, Cloud & Servers', sources: ['Products', 'Cloud & Servers'] },
  { title: 'Domains & Developers', sources: ['Domains', 'Developers'] },
  { title: 'Tools & Resources', sources: ['Tools', 'Resources'] },
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
      {/* Amazon's first band: a full-width return-to-top strip. The header owns #ch247-top. */}
      <a className="hg-footer__top" href="#ch247-top">Back to top</a>

      <div className="hg-footer__directory">
        <div className="hg-wrap">
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
      </div>

      {/* Amazon's divided brand / locale row. The pills are a read-out, not duplicate controls. */}
      <div className="hg-footer__locale-band">
        <div className="hg-wrap hg-footer__locale-inner">
          <div className="hg-footer__brand">
            <Brand className="ch247-brand--footer" />
            <span className="hg-footer__tagline">{BRAND.tagline}</span>
          </div>
          <div className="hg-footer__locale" aria-label="Current language, currency and region">
            <span className="hg-footer__locale-pill"><Icon name="globe" size={14} /> English</span>
            <span className="hg-footer__locale-pill">USD — US Dollar</span>
            <span className="hg-footer__locale-pill">Worldwide</span>
          </div>
          <Link className="hg-btn hg-btn--sm hg-footer__signup" to={UTILITY.createAccount.to}>
            {UTILITY.createAccount.label}
          </Link>
        </div>
      </div>

      {/* Amazon's darkest band: a centred policy row, then the copyright line. */}
      <div className="hg-footer__legal">
        <div className="hg-wrap">
          <nav className="hg-footer__legal-links" aria-label={t('footer.legalAndAccount')}>
            <Link to="/legal">{t('footer.nav.legalCenter')}</Link>
            <Link to="/legal/privacy-policy">{t('footer.nav.privacy')}</Link>
            <Link to="/legal/cookies">{t('footer.nav.cookies')}</Link>
            <Link to="/legal/terms">{t('footer.nav.terms')}</Link>
            <Link to="/status">{t('footer.nav.status')}</Link>
            <Link to="/help">{t('footer.nav.help')}</Link>
            <Link to="/contact">{t('footer.nav.contact')}</Link>
            <Link to="/sitemap">Sitemap</Link>
          </nav>
          <p className="hg-footer__copyright">
            {t('footer.copyright', { year, legalName: BRAND.legalName })}
          </p>
        </div>
      </div>
    </footer>
  );
}
