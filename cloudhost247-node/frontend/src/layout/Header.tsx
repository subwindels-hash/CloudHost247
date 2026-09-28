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

  function handleLogout() {
    clearSession();
    navigate('/');
  }

  return (
    <header className="ch247-header">
      <div className="ch247-header__inner">
        <NavLink to="/" className="ch247-brand" end>
          CloudHost247
        </NavLink>
        <nav className="ch247-nav-links" aria-label="Primary">
          {marketingLinks.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end}>
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
              <NavLink to="/login" className="ch247-button ch247-button--ghost">
                Log in
              </NavLink>
              <NavLink to="/register" className="ch247-button">
                Get started
              </NavLink>
            </>
          )}
        </div>
      </div>
      {token && (
        <div className="ch247-subnav">
          <nav aria-label="Account">
            {appLinks.map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
