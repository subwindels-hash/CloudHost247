import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { useAuth } from '../lib/useAuth.jsx';
import { formatDate, humanizeStatus } from '../lib/format.js';

/**
 * The console's landing page: the queue sizes a support team works from.
 *
 * Every number here is a real server count (`total` from the paginated endpoints with `limit: 1`),
 * never a length of a page-sized array. Tickets are split into "waiting on us" and "open" because
 * that is the distinction the queue actually acts on. Admin-only panels (staff accounts, support
 * sessions) are loaded only for admins, so a staff account never fires requests it would be refused.
 */
export default function AdminDashboardPage() {
  const { user } = useAuth();
  const [counts, setCounts] = useState(null);
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const load = useCallback(async () => {
    setError('');
    try {
      const [customers, open, pendingStaff, pendingCustomer, closed] = await Promise.all([
        adminApi.customers({ limit: 1 }),
        adminApi.tickets({ status: 'open', limit: 1 }),
        adminApi.tickets({ status: 'pending_staff', limit: 1 }),
        adminApi.tickets({ status: 'pending_customer', limit: 1 }),
        adminApi.tickets({ status: 'closed', limit: 1 }),
      ]);
      setCounts({
        customers: customers.total,
        tickets: { open: open.total, pendingStaff: pendingStaff.total, pendingCustomer: pendingCustomer.total, closed: closed.total },
      });

      if (isAdmin) {
        const [users, supportSessions] = await Promise.all([adminApi.users(), adminApi.supportSessions()]);
        const now = Date.now();
        setSessions({
          totalUsers: users.total,
          active: supportSessions.sessions.filter((s) => !s.endedAt && Date.parse(s.endsAt) > now),
          all: supportSessions.sessions,
        });
      }
    } catch (err) {
      setError(describeError(err));
    }
  }, [isAdmin]);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="page"><div className="alert alert-error" role="alert">{error}</div></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin console</h1>
          <p className="muted">
            Signed in as {user?.email} · {humanizeStatus(user?.role)}. Counts are live totals from the
            server, not the current page.
          </p>
        </div>
      </div>

      {counts === null ? <p className="muted">Loading counts…</p> : (
        <>
          <div className="stats">
            <Link className="stat card" to="/admin/customers">
              <span className="stat-value">{counts.customers}</span>
              <span className="stat-label">Customer accounts</span>
            </Link>
            <Link className="stat card" to="/admin/tickets?status=pending_staff">
              <span className="stat-value">{counts.tickets.pendingStaff}</span>
              <span className="stat-label">Tickets waiting on staff</span>
            </Link>
            <Link className="stat card" to="/admin/tickets?status=open">
              <span className="stat-value">{counts.tickets.open}</span>
              <span className="stat-label">Open tickets</span>
            </Link>
            <Link className="stat card" to="/admin/tickets?status=pending_customer">
              <span className="stat-value">{counts.tickets.pendingCustomer}</span>
              <span className="stat-label">Waiting on customer</span>
            </Link>
            <Link className="stat card" to="/admin/tickets?status=closed">
              <span className="stat-value">{counts.tickets.closed}</span>
              <span className="stat-label">Closed tickets</span>
            </Link>
            {sessions && (
              <Link className="stat card" to="/admin/users">
                <span className="stat-value">{sessions.totalUsers}</span>
                <span className="stat-label">Staff and customer accounts (first 200)</span>
              </Link>
            )}
          </div>

          {sessions && (
            <section className="card">
              <h2>Support sessions</h2>
              {sessions.active.length === 0 ? (
                <p className="muted">No support session is currently active.</p>
              ) : (
                <ul className="list">
                  {sessions.active.map((s) => (
                    <li key={s.id}>
                      <span>
                        <code>{s.id}</code>
                        <span className="muted"> ends {formatDate(s.endsAt, { withTime: true })}</span>
                      </span>
                      <span className="pill pill-warn">Acting</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="muted">
                Sessions record who is acting as which customer; only the admin who opened a session
                (or a super admin) can end it from the API.
              </p>
            </section>
          )}
        </>
      )}

      <section className="card">
        <h2>Common tasks</h2>
        <ul className="list">
          <li><Link to="/admin/customers">Find a customer by email, name or customer ID</Link></li>
          <li><Link to="/admin/tickets?status=pending_staff">Work the tickets waiting on staff</Link></li>
          <li><span className="muted">Status and role changes require a super admin; every change is audited.</span></li>
        </ul>
      </section>
    </div>
  );
}
