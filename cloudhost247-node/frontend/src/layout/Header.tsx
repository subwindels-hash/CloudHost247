import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { clearSession } from '../lib/auth';
import { useAuthState } from './useAuthState';

const marketingLinks = [
  { to: '/', label: 'Home', end: true },
  { to: '/hosting/cpanel', label: 'Hosting' },
  { to: '/about', label: 'About' },
  { to: '/support', label: 'Support' },
];

const appLinks = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/services', label: 'Services' },
  { to: '/domains', label: 'Domains' },
  { to: '/billing', label: 'Billing' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/admin', label: 'Admin' },
];

export default function Header() {
  const { token, user } = useAuthState();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  function handleLogout() {
    setMenuOpen(false);
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
                {user && <span className="ch247-auth-greeting">{user.fullName}</span>}
                <button type="button" className="ch247-button ch247-button--ghost" onClick={handleLogout}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="ch247-button ch247-button--ghost" onClick={closeMenu}>
                  Log in
                </NavLink>
                <NavLink to="/register" className="ch247-button" onClick={closeMenu}>
                  Get started
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
          </nav>
        </div>
      )}
    </header>
  );
}
