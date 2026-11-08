import { useEffect, useState, type MouseEvent } from 'react';
import { faInstagram, faWhatsapp, faTiktok, faTelegram, faCcVisa, faCcMastercard, faCcDiscover, faCcJcb, faCcDinersClub } from '@fortawesome/free-brands-svg-icons';
import { publicFetch } from '../lib/api';
import FooterLogoIcon from '../components/FooterLogoIcon';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleProvider';
import { useCurrency } from '../currency/CurrencyProvider';
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

const SOCIAL_LINKS = [
  { key: 'instagram', label: 'Instagram', icon: faInstagram, hosts: ['instagram.com', 'www.instagram.com'] },
  { key: 'whatsapp', label: 'WhatsApp', icon: faWhatsapp, hosts: ['wa.me', 'api.whatsapp.com', 'www.whatsapp.com', 'whatsapp.com'] },
  { key: 'tiktok', label: 'TikTok', icon: faTiktok, hosts: ['tiktok.com', 'www.tiktok.com'] },
  { key: 'telegram', label: 'Telegram', icon: faTelegram, hosts: ['t.me', 'telegram.me', 'www.telegram.me'] },
] as const;
function safeSocialUrl(value: unknown, hosts: readonly string[]): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && hosts.includes(url.hostname.toLowerCase()) ? value : null;
  } catch { return null; }
}

/** Share buttons and configured public profiles are separate; unconfigured profiles are visible but not clickable. */
function FooterBrandBand() {
  const [links, setLinks] = useState<Record<string, unknown>>({});
  useEffect(() => {
    let active = true;
    const refresh = () => {
      publicFetch<{ links?: Record<string, unknown> }>('/api/v1/site/social-links', { cache: 'no-store' })
        .then((data) => { if (active) setLinks(data.links ?? {}); })
        .catch(() => { if (active) setLinks({}); });
    };
    refresh();
    window.addEventListener('ch247:social-links-changed', refresh);
    return () => { active = false; window.removeEventListener('ch247:social-links-changed', refresh); };
  }, []);
  const site = encodeURIComponent('https://cloudhost247.com/');
  return (
    <div className="hg-footer-brandband">
      <div className="hg-wrap hg-footer-brandband__inner">
        <div className="hg-footer-brandband__top">
          <Link to="/" className="hg-footer-brandband__logo" aria-label="CloudHost247 home">
            <FooterLogoIcon />
          </Link>
          <nav className="hg-footer-brandband__social" aria-label="Social media">
            <a href={`https://www.linkedin.com/sharing/share-offsite/?url=${site}`} target="_blank" rel="noopener noreferrer" aria-label="Share CloudHost247 on LinkedIn">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2ZM8.4 18H5.8V9.7h2.6V18ZM7.1 8.6a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM18.2 18h-2.6v-4.1c0-1-.1-2.2-1.5-2.2s-1.7 1-1.7 2.1V18H9.8V9.7h2.5v1.1h.1a2.8 2.8 0 0 1 2.5-1.4c2.6 0 3.3 1.6 3.3 3.7V18Z" /></svg>
            </a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${site}`} target="_blank" rel="noopener noreferrer" aria-label="Share CloudHost247 on Facebook">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-1.6 19.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.7-1.6 1.5V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 12 2Z" /></svg>
            </a>
            <a href={`https://twitter.com/intent/tweet?url=${site}`} target="_blank" rel="noopener noreferrer" aria-label="Share CloudHost247 on X">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h4.7l4.1 5.5L17.6 3H20l-6.1 7.1L20.4 21h-4.7l-4.5-6L6 21H3.6l6.5-7.6L4 3Zm3.6 2L16.7 19h1.2L8.8 5H7.6Z" /></svg>
            </a>
            {SOCIAL_LINKS.map(({ key, label, icon, hosts }) => {
              const href = safeSocialUrl(links[key], hosts);
              const [width, height, , , path] = icon.icon;
              const image = <svg viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><path d={Array.isArray(path) ? path.join(' ') : path} /></svg>;
              return href ? <a key={key} href={href} target="_blank" rel="noopener noreferrer" aria-label={`CloudHost247 on ${label}`}>{image}</a>
                : <span key={key} className="hg-footer-brandband__social-unconfigured" role="img" aria-label={`${label} link not configured`} title={`${label} link not configured`}>{image}</span>;
            })}
          </nav>
        </div>
        <div className="hg-footer-brandband__bottom">
          <div className="hg-footer-brandband__payments">
            <div className="hg-footer-brandband__cards" aria-label="Card networks">
              {([[faCcVisa, 'Visa'], [faCcMastercard, 'Mastercard'], [null, 'Verve'], [null, 'American Express'], [faCcDiscover, 'Discover'], [faCcJcb, 'JCB'], [faCcDinersClub, 'Diners Club']] as const).map(([icon, name]) => {
                if (!icon) return <svg className="hg-footer-brandband__card" key={name} viewBox="0 0 576 512" role="img" aria-label={name}>
                  <rect x="0" y="32" width="576" height="448" rx="56" />
                  <text x="288" y="275" textAnchor="middle" dominantBaseline="middle" fill="#fff" fontFamily="Arial, sans-serif" fontWeight="700" fontSize="145" textLength="480" lengthAdjust="spacingAndGlyphs">{name === 'Verve' ? 'Verve' : 'AMEX'}</text>
                </svg>;
                const [width, height, , , path] = icon.icon;
                return <svg className="hg-footer-brandband__card" key={name} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={name}>
                  <path d={Array.isArray(path) ? path.join(' ') : path} />
                </svg>;
              })}
            </div>
            <span>Payment options vary at checkout</span>
          </div>
          <p className="hg-footer-brandband__tax-note">Prices are listed without VAT</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Amazon-style "Back to top" strip: a full-width bar (see hostinger-chrome.css
 * `.hg-footer__top`), placed as the footer's final band below the bottom row (copyright / locale)
 * rather than as a small link buried inside it.
 * The whole bar is the click target. The `href` keeps the action working without JS and
 * gives the link a real destination (`#ch247-top` is the header); the handler upgrades
 * it to a smooth scroll that respects reduced-motion, and moves keyboard focus to the
 * top of the page so keyboard/screen-reader users land where the view lands.
 */
function scrollToTop(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  document.getElementById('ch247-top')?.focus({ preventScroll: true });
}

export default function Footer() {
  const year = new Date().getFullYear();
  const { t, locale } = useLocale();
  const { currency, country } = useCurrency();
  return (
    <footer className="ch247-footer hg-footer">
      <div className="hg-footer__directory">
        <div className="hg-wrap">
          <nav className="hg-footer__columns" aria-label="Footer">
            {GROUPS.map((group) => <FooterColumn key={group.title} group={group} />)}
          </nav>
        </div>
      </div>
      <FooterBrandBand />
      <div className="hg-footer__bottom">
        <div className="hg-wrap hg-footer__bottom-inner">
          <div className="hg-footer__brand-lines">
            <p className="hg-footer__copyright">{t('footer.copyright', { year, legalName: BRAND.legalName })} · This product includes GeoLite2 data created by <a href="https://www.maxmind.com">MaxMind</a>.</p>
            <p className="hg-footer__powered">Proudly Powered by WINDELS GROUP &amp; COMPANY®</p>
            <p className="hg-footer__geo-credit">This product includes GeoLite2 data created by WIL<strong>®</strong>.</p>
          </div>
          <div className="hg-footer__locale" aria-label="Current language, currency and region">
            <span>{locale.nativeName}</span><span aria-hidden="true">·</span><span>{currency}</span><span aria-hidden="true">·</span><span>{country === 'GB' ? 'UK' : country ?? 'Country unavailable'}</span>
          </div>
        </div>
      </div>
      {/* Back-to-top strip sits below the footer bottom row (copyright / locale),
          as the final full-width band of the footer. */}
      <a className="hg-footer__top" href="#ch247-top" onClick={scrollToTop}>
        Back to top
      </a>
    </footer>
  );
}
