import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/useAuth.jsx';
import { read as readSupportSession, finish as finishSupportSession } from '../lib/support-session.js';

/**
 * The staff shell.
 *
 * Access is decided by the server on every request; this component only decides what to *show*:
 * a signed-out visitor gets a pointer to the customer sign-in, a customer account is told plainly
 * that the console is for staff (rather than shown an empty page), and staff see the sections their
 * role can actually use. Hiding a link is a courtesy, never a security boundary.
 *
 * When a support session is active, the console is closed: the tab is acting as the customer, so the
 * banner replaces the admin view and the way back is to end the session.
 */
const STAFF_ROLES = ['staff', 'admin', 'super_admin'];

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const session = readSupportSession();
  const [ending, setEnding] = useState(false);
  const [note, setNote] = useState('');

  if (loading) {
    return <div className="page"><p className="muted">Checking your staff access…</p></div>;
  }

  if (session) {
    return (
      <div className="page">
        <div className="card">
          <h2>You are acting as {session.customer?.fullName ?? 'a customer'}</h2>
          <p className="muted">
            Support session {session.sessionId ? <code>{session.sessionId}</code> : 'active'} — started
            {' '}{session.customer?.email ?? ''}. End it to return to your own staff account; the
            delegated session cannot be refreshed, so it also expires on its own after an hour.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={ending}
            onClick={async () => {
              setEnding(true);
              const { error } = await finishSupportSession();
              if (error) setNote(error);
              window.location.assign('/app/admin');
            }}
          >
            {ending ? 'Ending…' : 'End support session'}
          </button>
          {note && <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>{note}</div>}
          <p className="muted" style={{ marginTop: 12 }}>
            <a href="/app/account">Continue viewing the customer's account</a>
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page auth-notice">
        <div className="card">
          <h2>Staff sign-in required</h2>
          <p className="muted">The admin console is for CloudHost247 staff accounts.</p>
          <a className="btn btn-primary" href="/login.html?next=/app/admin">Sign in</a>
        </div>
      </div>
    );
  }

  if (!STAFF_ROLES.includes(user.role)) {
    return (
      <div className="page">
        <div className="card">
          <h2>Not a staff account</h2>
          <p className="muted">
            {user.email} signs in as a customer, so the admin console is unavailable. Customer tools
            are in the <a href="/app/account">account dashboard</a>.
          </p>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin' || user.role === 'super_admin';

  return (
    <div className="admin">
      <nav className="admin-subnav" aria-label="Admin sections">
        <NavLink to="/admin" end className={({ isActive }) => (isActive ? 'active' : '')}>Dashboard</NavLink>
        <NavLink to="/admin/customers" className={({ isActive }) => (isActive ? 'active' : '')}>Customers</NavLink>
        <NavLink to="/admin/tickets" className={({ isActive }) => (isActive ? 'active' : '')}>Tickets</NavLink>
        {isAdmin && <NavLink to="/admin/users" className={({ isActive }) => (isActive ? 'active' : '')}>Staff accounts</NavLink>}
        {isAdmin && <NavLink to="/admin/content" className={({ isActive }) => (isActive ? 'active' : '')}>Content</NavLink>}
        {isAdmin && <NavLink to="/admin/site-settings" className={({ isActive }) => (isActive ? 'active' : '')}>Site settings</NavLink>}
        {isAdmin && <NavLink to="/admin/catalog" className={({ isActive }) => (isActive ? 'active' : '')}>Catalogue</NavLink>}
        {isAdmin && <NavLink to="/admin/servers" className={({ isActive }) => (isActive ? 'active' : '')}>Servers</NavLink>}
        {isAdmin && <NavLink to="/admin/infrastructure" className={({ isActive }) => (isActive ? 'active' : '')}>Infrastructure</NavLink>}
        {isAdmin && <NavLink to="/admin/cloudflare" className={({ isActive }) => (isActive ? 'active' : '')}>Cloudflare</NavLink>}
        {isAdmin && <NavLink to="/admin/billing" className={({ isActive }) => (isActive ? 'active' : '')}>Billing</NavLink>}
        {isAdmin && <NavLink to="/admin/orders" className={({ isActive }) => (isActive ? 'active' : '')}>Orders</NavLink>}
        {isAdmin && <NavLink to="/admin/domain-services" className={({ isActive }) => (isActive ? 'active' : '')}>Domains</NavLink>}
        {isAdmin && <NavLink to="/admin/marketplace" className={({ isActive }) => (isActive ? 'active' : '')}>Marketplace</NavLink>}
        {isAdmin && <NavLink to="/admin/provisioning" className={({ isActive }) => (isActive ? 'active' : '')}>Provisioning</NavLink>}
        {isAdmin && <NavLink to="/admin/monitoring" className={({ isActive }) => (isActive ? 'active' : '')}>Monitoring</NavLink>}
        {isAdmin && <NavLink to="/admin/deployments" className={({ isActive }) => (isActive ? 'active' : '')}>Deployments</NavLink>}
        {isAdmin && <NavLink to="/admin/os-versions" className={({ isActive }) => (isActive ? 'active' : '')}>Operating systems</NavLink>}
        {isAdmin && <NavLink to="/admin/os-images" className={({ isActive }) => (isActive ? 'active' : '')}>OS images</NavLink>}
        {isAdmin && <NavLink to="/admin/availability" className={({ isActive }) => (isActive ? 'active' : '')}>Templates</NavLink>}
        {isAdmin && <NavLink to="/admin/ai-support" className={({ isActive }) => (isActive ? 'active' : '')}>AI support</NavLink>}
        {isAdmin && <NavLink to="/admin/tools" className={({ isActive }) => (isActive ? 'active' : '')}>Tools</NavLink>}
        {isAdmin && <NavLink to="/admin/security-number" className={({ isActive }) => (isActive ? 'active' : '')}>Security numbers</NavLink>}
        <span className="admin-role">{user.role}</span>
      </nav>
      <Outlet />
    </div>
  );
}
