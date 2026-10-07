import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { PlatformMegaMenu, PlatformMobileNav, Brand } from '../components/navigation/PlatformMegaMenu';
import { Icon } from '../components/ui/Icon';
import { apiFetch } from '../lib/api';
import { clearSession } from '../lib/auth';
import { UTILITY } from '../navigation/registry.generated';
import { useAuthState } from './useAuthState';

/**
 * The universal CloudHost247 header.
 *
 * Structure: brand · mega navigation · search · Sign In / Create Account (or the account
 * controls once signed in). The mega menus come from the shared registry, so this header, the
 * mobile drawer, the footer and the sitemap cannot disagree about what exists.
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
    <header className="ch247-header" ref={headerRef}>
      <div className="ch247-header__inner">
        <Brand />

        <button
          type="button"
          className="ch247-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="ch247-primary-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="ch247-menu-toggle__bar" />
          <span className="ch247-menu-toggle__bar" />
          <span className="ch247-menu-toggle__bar" />
        </button>

        <div id="ch247-primary-nav" className={`ch247-header__collapsible${menuOpen ? ' is-open' : ''}`}>
          <PlatformMegaMenu />

          <div className="ch247-mobile-nav-host">
            <PlatformMobileNav onNavigate={closeMenu} />
          </div>

          <div className="ch247-header__actions">
            <NavLink className="ch247-header__search" to="/search" aria-label="Search CloudHost247" onClick={closeMenu}>
              <Icon name="search" size={18} />
            </NavLink>
            {token ? (
              <>
                <NavLink className="ch-btn ch-btn--outline ch-btn--sm" to="/dashboard" onClick={closeMenu}>
                  Dashboard
                </NavLink>
                <NavLink className="ch-btn ch-btn--sm" to="/account" onClick={closeMenu}>
                  {user?.fullName?.split(' ')[0] ?? 'Account'}
                </NavLink>
                <button type="button" className="ch-btn ch-btn--outline ch-btn--sm" onClick={handleLogout}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink className="ch-btn ch-btn--outline ch-btn--sm" to={UTILITY.signIn.to} onClick={closeMenu}>
                  {UTILITY.signIn.label}
                </NavLink>
                <NavLink className="ch-btn ch-btn--mint ch-btn--sm" to={UTILITY.createAccount.to} onClick={closeMenu}>
                  {UTILITY.createAccount.label}
                </NavLink>
              </>
            )}
          </div>
        </div>
      </div>

      {token ? (
        <div className="ch247-subnav">
          <nav className="ch-wrap--wide" aria-label="Account">
            {ACCOUNT_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} onClick={closeMenu} end={link.to === '/dashboard'}>
                {link.label}
              </NavLink>
            ))}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/ai-support" onClick={closeMenu}>
                AI Support Desk
              </NavLink>
            ) : null}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/unified-inbox" onClick={closeMenu}>
                Inbox
              </NavLink>
            ) : null}
            {user && SUPPORT_ROLES.includes(user.role) ? (
              <NavLink to="/admin/platform-services" onClick={closeMenu}>
                Platform Services
              </NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin" onClick={closeMenu} end>
                Admin
              </NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin/domain-services" onClick={closeMenu}>
                Domain Services
              </NavLink>
            ) : null}
            {user && STAFF_ROLES.includes(user.role) ? (
              <NavLink to="/admin/infrastructure" onClick={closeMenu}>
                Infrastructure
              </NavLink>
            ) : null}
          </nav>
        </div>
      ) : null}
    </header>
  );
}
