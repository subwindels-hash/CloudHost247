import VisitorPrivacy from '../components/VisitorPrivacy';
import { NavLink, useNavigate } from 'react-router-dom';
import { PlatformMenu, Brand } from '../components/navigation/PlatformMegaMenu';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CurrencySwitcher from '../components/CurrencySwitcher';
import { Icon } from '../components/ui/Icon';
import { useLocale } from '../i18n/LocaleProvider';
import { siteText } from '../i18n/site-text';
import { apiFetch } from '../lib/api';
import { clearSession } from '../lib/auth';
import { UTILITY } from '../navigation/registry.generated';
import { useAuthState } from './useAuthState';

const ACCOUNT_LINKS = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/services', label: 'Services' },
  { to: '/service-plans', label: 'Browse Plans' },
  { to: '/dashboard/domains', label: 'Domains & DNS' },
  { to: '/dashboard/servers', label: 'Servers' },
  { to: '/dashboard/apps', label: 'Applications' },
  { to: '/dashboard/ssl', label: 'SSL' },
  { to: '/billing', label: 'Billing' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/support', label: 'Support' },
  { to: '/account/assistant', label: 'Cloud AI' },
];

const STAFF_ROLES = ['admin', 'super_admin'];
const SUPPORT_ROLES = ['staff', 'admin', 'super_admin'];

export default function Header() {
  const { token, user } = useAuthState();
  const { t, locale } = useLocale();
  const copy = siteText(locale.code);
  const navigate = useNavigate();

  async function handleLogout() {
    // Best-effort server-side revocation, then always clear locally: a person who clicks "Log out"
    // must never be left looking signed in on the device in front of them.
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* offline or already revoked — fall through to local cleanup regardless */
    }
    clearSession();
    navigate('/');
  }

  return (
    <header className="ch247-header hg-header" id="ch247-top" tabIndex={-1}>
      {/* #ch247-primary-nav wraps both rows, so the settings/account controls stay in the
          navigation landmark pinned by Header.test.tsx and the accessibility contract. */}
      <div id="ch247-primary-nav" className="hg-header__body">
        <div className="hg-bar__top">
          <VisitorPrivacy />
          <nav className="hg-bar__quick" aria-label="Quick links">
            <div className="hg-bar__locale">
              <LanguageSwitcher />
              <CurrencySwitcher />
            </div>
            {/* Keep the documented six-control utility line: Pricing, Help, language, currency,
                Sign In and Create Account. Browse Plans remains in the account navigation and
                on My Services; it must not push the signed-out controls onto another line. */}
            <NavLink to="/pricing">{copy.pricing}</NavLink>
            {/*
              No third quick link here. The utility line is a documented six-control row
              (Pricing, Help, language, currency, Sign In, Create Account) and both
              frontend/tests/unit/hostinger-chrome.test.tsx and scripts/check-chrome-benchmark.mjs
              fail when a seventh is added — a wrapped or crowded bar is how Create Account went
              missing before. `/service-plans` stays reachable from /services ("Browse plans"), the
              catalog pages and the account menu.
            */}
            <NavLink to="/help">{copy.help}</NavLink>
          </nav>

          <div className="hg-bar__icons">
            <NavLink className="hg-bar__icon" to={UTILITY.search.to} aria-label={t('header.search.label')}>
              <Icon name="search" size={18} />
            </NavLink>
            <NavLink className="hg-bar__icon hg-bar__cart" to={UTILITY.cart.to} aria-label={UTILITY.cart.label}>
              <Icon name="cart" size={19} />
              <span className="hg-cart__dot" aria-hidden="true" />
            </NavLink>
          </div>

          <div className="hg-bar__actions">
            {token ? (
              <>
                <NavLink className="hg-bar__text-link" to="/dashboard">
                  {t('header.account.dashboard')}
                </NavLink>
                <NavLink className="hg-bar__avatar" to="/account">
                  {user?.fullName?.split(' ')[0] ?? t('header.account.fallback')}
                </NavLink>
                <button type="button" className="hg-bar__text-link" onClick={handleLogout}>
                  {t('header.account.logout')}
                </button>
              </>
            ) : (
              <>
                <NavLink className="hg-bar__text-link" to={UTILITY.signIn.to}>
                  {copy.signIn}
                </NavLink>
                {/* The compact CTA belongs on this line — it is the sixth utility control the
                    chrome contract and scripts/check-chrome-benchmark.mjs both count
                    (Pricing, Help, English, USD, Sign In, Create Account). Removing it leaves a
                    signed-out visitor with no visible route into registration from the header. */}
                <NavLink className="hg-btn hg-btn--sm" to={UTILITY.createAccount.to}>
                  {copy.createAccount}
                </NavLink>
              </>
            )}
          </div>
        </div>

        <div className="hg-nav__bar">
          <Brand className="hg-nav__brand on-dark" />

          <div className="hg-bar__body">
            <PlatformMenu />


          </div>
        </div>
      </div>

      {token ? (
        <div className="ch247-subnav hg-subnav">
          <nav className="hg-nav__bar" aria-label={t('header.account.navLabel')}>
            {ACCOUNT_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === '/dashboard'}>
                {link.label}
              </NavLink>
            ))}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/ai-support">AI Support Desk</NavLink>
            ) : null}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/unified-inbox">Inbox</NavLink>
            ) : null}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/platform-services">Platform Services</NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin" end>Admin</NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin/domain-services">Domain Services</NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin/infrastructure">Infrastructure</NavLink>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
