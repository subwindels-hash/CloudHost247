import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleProvider';
import { FOOTER_COLUMNS, BRAND } from '../navigation/registry.generated';

// The directory keeps the shared registry as its source of truth while presenting six clear
// categories. On mobile each category is an independent, keyboard-accessible disclosure.
const GROUPS = [
  { title: 'Hosting', sources: ['Products', 'Cloud & Servers'] },
  { title: 'Domain', sources: ['Domains'] },
  { title: 'Tools', sources: ['Tools', 'Developers'] },
  { title: 'Information', sources: ['Legal'] },
  { title: 'Company', sources: ['Company'] },
  { title: 'Support', sources: ['Resources'] },
];

function linksFor(sources: string[]) {
  const seen = new Set<string>();
  return sources.flatMap((source) => FOOTER_COLUMNS.find((column) => column.title === source)?.links ?? [])
    .filter((link) => {
      if (seen.has(link.to)) return false;
      seen.add(link.to);
      return true;
    });
}

function FooterColumn({ group }: { group: typeof GROUPS[number] }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const links = linksFor(group.sources);
  const id = `footer-${group.title.toLowerCase()}`;
  return (
    <section className={`hg-footer__column${open ? ' is-open' : ''}`}>
      <h2 className="hg-footer__heading">{group.title}</h2>
      <button type="button" className="hg-footer__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
        {group.title}<span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      <ul id={id} className="hg-footer__list">
        {links.map((link, index) => <li key={link.to} hidden={!showAll && index >= 10}><Link to={link.to}>{link.label}</Link></li>)}
        {links.length > 10 && (
          <li><button type="button" className="hg-footer__view-all" aria-label={`${showAll ? 'Show less' : 'View all'} ${group.title} links`} aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show less' : 'View all'}
          </button></li>
        )}
      </ul>
    </section>
  );
}

export default function Footer() {
  const year = new Date().getFullYear();
  const { t } = useLocale();
  return (
    <footer className="ch247-footer hg-footer">
      <div className="hg-footer__directory">
        <div className="hg-wrap">
          <nav className="hg-footer__columns" aria-label="Footer">
            {GROUPS.map((group) => <FooterColumn key={group.title} group={group} />)}
          </nav>
        </div>
      </div>
      <div className="hg-footer__bottom">
        <div className="hg-wrap hg-footer__bottom-inner">
          <p className="hg-footer__copyright">{t('footer.copyright', { year, legalName: BRAND.legalName })}</p>
          <div className="hg-footer__locale" aria-label="Current language, currency and region">
            <span>English</span><span aria-hidden="true">·</span><span>USD</span><span aria-hidden="true">·</span><span>Worldwide</span>
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
