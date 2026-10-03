import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { clearSession } from '../lib/auth';
import { useAuthState } from './useAuthState';

const marketingLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/hosting', label: 'Hosting' },
  { to: '/hosting/control-panels', label: 'Control Panels' },
  { to: '/apps', label: 'App Marketplace' },
  { to: '/domains', label: 'Domains' },
  { to: '/tools', label: 'Tools' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
  { to: '/faq', label: 'FAQ' },
];

// Secondary, in-app navigation shown only once signed in (account/feature areas). Kept separate
// from the primary Dashboard/Account/Log out controls in ch247-auth-links so that "how do I sign
// out" is never buried inside a long feature list.
const appLinks = [
  { to: '/services', label: 'Services' },
  { to: '/dashboard/apps', label: 'My Apps' },
  { to: '/dashboard/servers', label: 'Servers' },
  { to: '/dashboard/notifications', label: 'Notifications' },
  { to: '/dashboard/domains', label: 'My Domains' },
  { to: '/dashboard/dns', label: 'DNS Zones' },
  { to: '/dashboard/ssl', label: 'SSL Certificates' },
  { to: '/tools/monitors', label: 'Monitoring' },
  { to: '/billing', label: 'Billing' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/support', label: 'Support' },
  { to: '/account/assistant', label: 'Cloud AI' },
];

// "Admin" is only ever shown to an account whose *locally cached* role is admin/super_admin —
// purely so a customer never sees a nav link to a page that would just show "not available" (see
// components/RequireRole.tsx). This is a UX nicety only; the real authorization check happens
// server-side on every admin API call regardless of what this header renders.
const STAFF_ROLES = ['admin', 'super_admin'];
const SUPPORT_ROLES = ['staff', 'admin', 'super_admin'];

export default function Header() {
  const { token, user } = useAuthState();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    setMenuOpen(false);
    // Best-effort: actually invalidate the token server-side (see /api/auth/logout +
    // database/migrations/0003_create_revoked_tokens.sql) so it can't keep being used elsewhere
    // even after this tab clears its own copy. If the network call fails (offline, server
    // unreachable), still clear the local session immediately — a user clicking "Log out" must
    // never be left looking signed in on the device in front of them.
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Already logged out / offline / network error — fall through to local cleanup regardless.
    }
    clearSession();
    navigate('/');
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="ch247-header">
      <div className="ch247-header__inner">
        <NavLink to="/" className="ch247-brand" end onClick={closeMenu}>
          CloudHost247
        </NavLink>

        <button
          type="button"
          className="ch247-menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="ch247-primary-nav"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="ch247-menu-toggle__bar" />
          <span className="ch247-menu-toggle__bar" />
          <span className="ch247-menu-toggle__bar" />
          <span className="sr-only">{menuOpen ? 'Close menu' : 'Open menu'}</span>
        </button>

        <div id="ch247-primary-nav" className={`ch247-header__collapsible${menuOpen ? ' is-open' : ''}`}>
          <nav className="ch247-nav-links" aria-label="Primary">
            {marketingLinks.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.end} onClick={closeMenu}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="ch247-auth-links">
            {token ? (
              <>
                <NavLink to="/dashboard" onClick={closeMenu}>
                  Dashboard
                </NavLink>
                <NavLink to="/account" onClick={closeMenu}>
                  {user ? user.fullName.split(' ')[0] : 'Account'}
                </NavLink>
                <button type="button" className="ch247-button ch247-button--ghost" onClick={handleLogout}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="ch247-button ch247-button--ghost" onClick={closeMenu}>
                  Sign In
                </NavLink>
                <NavLink to="/register" className="ch247-button" onClick={closeMenu}>
                  Create Account
                </NavLink>
              </>
            )}
          </div>
        </div>
      </div>
      {token && (
        <div className="ch247-subnav">
          <nav aria-label="Account">
            {appLinks.map((link) => (
              <NavLink key={link.to} to={link.to} onClick={closeMenu}>
                {link.label}
              </NavLink>
            ))}
            {user && SUPPORT_ROLES.includes(user.role) && (
              <NavLink to="/admin/ai-support" onClick={closeMenu}>
                AI Support Desk
              </NavLink>
            )}
            {user && SUPPORT_ROLES.includes(user.role) && (
              <NavLink to="/admin/ai-command" onClick={closeMenu}>
                AI Command
              </NavLink>
            )}
            {user && STAFF_ROLES.includes(user.role) && (
              <NavLink to="/admin" onClick={closeMenu}>
                Admin
              </NavLink>
            )}
            {user && STAFF_ROLES.includes(user.role) && (
              <NavLink to="/admin/domain-services" onClick={closeMenu}>
                Domain Services
              </NavLink>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}
