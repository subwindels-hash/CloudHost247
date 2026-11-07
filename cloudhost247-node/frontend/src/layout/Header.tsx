import { NavLink, useNavigate } from 'react-router-dom';
import { PlatformMenu, Brand } from '../components/navigation/PlatformMegaMenu';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CurrencySwitcher from '../components/CurrencySwitcher';
import { Icon } from '../components/ui/Icon';
import { useLocale } from '../i18n/LocaleProvider';
import { apiFetch } from '../lib/api';
import { clearSession } from '../lib/auth';
import { UTILITY } from '../navigation/registry.generated';
import { useAuthState } from './useAuthState';

/**
 * The universal CloudHost247 header — one flat dark bar, no dropdowns.
 *
 * Everything is visible beside the logo: the seven registry sections as direct links, the quick
 * links, the language/currency disclosures, search, cart, and Sign In / Create Account (or the
 * signed-in account controls). There is no hamburger, no `+` accordion, no mega panel and no
 * compact dropdown, so no menu destination is ever hidden behind a disclosure.
 *
 * At narrower widths the bar wraps onto additional rows rather than collapsing into a drawer —
 * the links stay visible. The header stops being sticky on phones so a wrapped bar never covers
 * the content underneath it.
 *
 * The menu comes from the shared registry, so the header, the footer and the sitemap cannot
 * disagree about what exists. No link is invented. Signed-in state adds a quieter second row for
 * account areas plus the role-gated staff links; those links re-verify the caller's role
 * server-side (see components/RequireRole.tsx), so showing them changes nothing about access.
 */

const ACCOUNT_LINKS = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/services', label: 'Services' },
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
  const { t } = useLocale();
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
    <header className="ch247-header hg-header" id="ch247-top">
      <div className="hg-nav__bar">
        <Brand className="hg-nav__brand on-dark" />

        <div id="ch247-primary-nav" className="hg-bar__body">
          <PlatformMenu />

          <nav className="hg-bar__quick" aria-label="Quick links">
            <NavLink to="/pricing">Pricing</NavLink>
            <NavLink to="/help">Help</NavLink>
          </nav>

          <div className="hg-bar__locale">
            <LanguageSwitcher />
            <CurrencySwitcher />
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
                  {UTILITY.signIn.label}
                </NavLink>
                <NavLink className="hg-btn hg-btn--sm" to={UTILITY.createAccount.to}>
                  {UTILITY.createAccount.label}
                </NavLink>
              </>
            )}
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
