import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { PlatformMegaMenu, PlatformMobileNav, Brand } from '../components/navigation/PlatformMegaMenu';
import LanguageSwitcher from '../components/LanguageSwitcher';
import CurrencySwitcher from '../components/CurrencySwitcher';
import { Icon } from '../components/ui/Icon';
import { useLocale } from '../i18n/LocaleProvider';
import { apiFetch } from '../lib/api';
import { clearSession } from '../lib/auth';
import { UTILITY } from '../navigation/registry.generated';
import { useAuthState } from './useAuthState';

/**
 * The universal CloudHost247 header — a single dark horizontal menu bar.
 *
 * Structure at desktop: white brand mark · every top-level registry section shown inline (each
 * opens a compact dropdown, not a full-width mega panel) · language/currency · search · a short
 * utility cluster (Pricing, Help, Cart) · Sign In / Create Account. Below 1200px the same links
 * move into the slim utility strip and the mobile drawer.
 *
 * The menu contents come from the shared registry, so this header, the drawer, the footer and the
 * sitemap cannot disagree about what exists. No link is invented, and the signed-in subnav and
 * mobile drawer keep their behaviour.
 *
 * Signed-in state adds a second, quieter row for account areas (services, domains, billing,
 * support) plus the role-gated staff links. Those links are a convenience only — every one of
 * them re-verifies the caller's role server-side (see components/RequireRole.tsx), so hiding or
 * showing them changes nothing about what an account is allowed to do.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  const closeMenu = () => setMenuOpen(false);

  // Escape closes the drawer and returns focus to the toggle — the behaviour a keyboard user
  // expects from a modal-ish surface, and the reason the toggle keeps a stable DOM position.
  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      headerRef.current?.querySelector<HTMLElement>('.ch247-menu-toggle')?.focus();
    }
    document.addEventListener('keydown', onKeyDown);
    document.body.setAttribute('data-nav-locked', 'true');
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.removeAttribute('data-nav-locked');
    };
  }, [menuOpen]);

  async function handleLogout() {
    closeMenu();
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
    <header className="ch247-header hg-header" id="ch247-top" ref={headerRef}>
      {/* Slim utility strip for compact/drawer widths. The desktop bar folds these destinations
          into its own right-hand cluster instead (see .hg-nav__quick). */}
      <div className="hg-utility">
        <div className="hg-utility__inner">
          <nav className="hg-utility__left" aria-label="Quick links">
            <NavLink to="/pricing" onClick={closeMenu}>Pricing</NavLink>
            <NavLink to="/sitemap" onClick={closeMenu}>All products</NavLink>
            <NavLink to="/status" onClick={closeMenu}>Platform status</NavLink>
          </nav>
          <nav className="hg-utility__right" aria-label="Help and account">
            <NavLink to="/help" onClick={closeMenu}>Help</NavLink>
            <NavLink to="/search" onClick={closeMenu}>Search</NavLink>
            <NavLink to={UTILITY.cart.to} onClick={closeMenu}>Cart</NavLink>
          </nav>
        </div>
      </div>

      <div className="hg-nav__bar">
        <Brand className="hg-nav__brand on-dark" />

        <button
          type="button"
          className="ch247-menu-toggle hg-nav__toggle"
          aria-expanded={menuOpen}
          aria-controls="ch247-primary-nav"
          aria-label={menuOpen ? t('header.menu.close') : t('header.menu.open')}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="ch247-menu-toggle__bar" />
          <span className="ch247-menu-toggle__bar" />
          <span className="ch247-menu-toggle__bar" />
        </button>

        <div id="ch247-primary-nav" className={`hg-nav__collapsible${menuOpen ? ' is-open' : ''}`}>
          <PlatformMegaMenu />

          <div className="hg-nav__utility">
            <LanguageSwitcher />
            <CurrencySwitcher />
            <NavLink className="hg-nav__icon" to="/search" aria-label={t('header.search.label')} onClick={closeMenu}>
              <Icon name="search" size={18} />
            </NavLink>
            {/* Search stays a single icon. The cart, pricing and help links live in the short
                utility cluster below so the seven desktop triggers keep their own flex track. */}
          </div>

          <nav className="hg-nav__quick" aria-label="Quick links">
            <NavLink to="/pricing" onClick={closeMenu}>Pricing</NavLink>
            <NavLink to="/help" onClick={closeMenu}>Help</NavLink>
            <NavLink className="hg-nav__cart" to={UTILITY.cart.to} aria-label={UTILITY.cart.label} onClick={closeMenu}>
              <Icon name="cart" size={19} />
              <span className="hg-cart__dot" aria-hidden="true" />
            </NavLink>
          </nav>

          <div className="hg-nav__actions">
            {token ? (
              <>
                <NavLink className="hg-nav__text-link" to="/dashboard" onClick={closeMenu}>
                  {t('header.account.dashboard')}
                </NavLink>
                <NavLink className="hg-nav__avatar" to="/account" onClick={closeMenu}>
                  {user?.fullName?.split(' ')[0] ?? t('header.account.fallback')}
                </NavLink>
                <button type="button" className="hg-nav__text-link" onClick={handleLogout}>
                  {t('header.account.logout')}
                </button>
              </>
            ) : (
              <>
                <NavLink className="hg-nav__text-link" to={UTILITY.signIn.to} onClick={closeMenu}>
                  {UTILITY.signIn.label}
                </NavLink>
                <NavLink className="hg-btn hg-btn--sm" to={UTILITY.createAccount.to} onClick={closeMenu}>
                  {UTILITY.createAccount.label}
                </NavLink>
              </>
            )}
          </div>

          <div className="hg-nav__drawer">
            <PlatformMobileNav onNavigate={closeMenu} />
          </div>
        </div>
      </div>

      {token ? (
        <div className="ch247-subnav hg-subnav">
          <nav className="hg-nav__bar" aria-label={t('header.account.navLabel')}>
            {ACCOUNT_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} onClick={closeMenu} end={link.to === '/dashboard'}>
                {link.label}
              </NavLink>
            ))}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/ai-support" onClick={closeMenu}>AI Support Desk</NavLink>
            ) : null}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/unified-inbox" onClick={closeMenu}>Inbox</NavLink>
            ) : null}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/platform-services" onClick={closeMenu}>Platform Services</NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin" onClick={closeMenu} end>Admin</NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin/domain-services" onClick={closeMenu}>Domain Services</NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin/infrastructure" onClick={closeMenu}>Infrastructure</NavLink>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
