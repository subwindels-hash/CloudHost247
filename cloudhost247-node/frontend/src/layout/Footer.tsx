import { Link } from 'react-router-dom';
import { Brand } from '../components/navigation/PlatformMegaMenu';
import { useLocale } from '../i18n/LocaleProvider';
import { FOOTER_COLUMNS, BRAND, UTILITY } from '../navigation/registry.generated';

/**
 * CloudHost247 footer — professional corporate directory.
 *
 * The footer is arranged as a brand/intro row, four evenly-balanced topic columns, then a compact
 * legal bar. Each of the eight registry columns is placed under a labelled sub-group inside one of
 * those four columns, so a visitor can scan "Hosting", "Domains", "Tools", "Legal" … without a
 * single undifferentiated wall of links.
 *
 * *Every* registry destination is still rendered (de-duplicated within each column), so the
 * footer, menus and sitemap cannot disagree about what exists. Language/currency switchers stay
 * in the header only (`Header.test.tsx`); the locale line below is a plain read-out. "Back to top"
 * is an inline link in the legal bar rather than a full-width retail band.
 */

interface FooterSection {
  title: string;
  source: string;
}

const FOOTER_GROUPS: Array<{ title: string; sections: FooterSection[] }> = [
  {
    title: 'Products & Domains',
    sections: [{ title: 'Hosting', source: 'Products' }, { title: 'Domains', source: 'Domains' }],
  },
  {
    title: 'Cloud & Resources',
    sections: [{ title: 'Infrastructure', source: 'Cloud & Servers' }, { title: 'Resources', source: 'Resources' }],
  },
  {
    title: 'Developers & Tools',
    sections: [{ title: 'Developers', source: 'Developers' }, { title: 'Tools', source: 'Tools' }],
  },
  {
    title: 'Company & Legal',
    sections: [{ title: 'Company', source: 'Company' }, { title: 'Legal', source: 'Legal' }],
  },
];

/** Resolves a column's sub-groups from the registry, de-duplicating destinations within it. */
function columnSections(sections: FooterSection[]) {
  const seen = new Set<string>();
  return sections.map((section) => {
    const column = FOOTER_COLUMNS.find((entry) => entry.title === section.source);
    const links = (column?.links ?? []).filter((link) => {
      if (seen.has(link.to)) return false;
      seen.add(link.to);
      return true;
    });
    return { ...section, links };
  });
}

export default function Footer() {
  const year = new Date().getFullYear();
  const { t } = useLocale();

  return (
    <footer className="ch247-footer hg-footer">
      <div className="hg-footer__directory">
        <div className="hg-wrap">
          <div className="hg-footer__intro">
            <div className="hg-footer__brand">
              <Brand className="ch247-brand--footer" />
              <p>{BRAND.description}</p>
            </div>
            <div className="hg-footer__intro-actions">
              <Link className="hg-link" to="/status">
                Platform status <span className="hg-link__arrow" aria-hidden="true">→</span>
              </Link>
              <Link className="hg-btn hg-btn--sm" to={UTILITY.createAccount.to}>
                {UTILITY.createAccount.label}
              </Link>
            </div>
          </div>

          <nav className="hg-footer__columns" aria-label="Footer">
            {FOOTER_GROUPS.map((group) => (
              <div className="hg-footer__column" key={group.title}>
                <h2>{group.title}</h2>
                {columnSections(group.sections).map((section) => (
                  <div className="hg-footer__subgroup" key={section.title}>
                    <h3>{section.title}</h3>
                    <ul>
                      {section.links.map((link) => (
                        <li key={`${section.title}-${link.to}-${link.label}`}>
                          <Link to={link.to}>{link.label}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </nav>
        </div>
      </div>

      <div className="hg-footer__bottom">
        <div className="hg-wrap hg-footer__bottom-inner">
          <p className="hg-footer__copyright">
            {t('footer.copyright', { year, legalName: BRAND.legalName })}
          </p>
          <div className="hg-footer__locale" aria-label="Current language, currency and region">
            <span>English</span><span aria-hidden="true">·</span>
            <span>USD</span><span aria-hidden="true">·</span>
            <span>Worldwide</span>
          </div>
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
          <a className="hg-footer__top" href="#ch247-top">Back to top ↑</a>
        </div>
      </div>
    </footer>
  );
}
