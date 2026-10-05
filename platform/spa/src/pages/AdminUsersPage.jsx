import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { useAuth } from '../lib/useAuth.jsx';

const ROLE_ORDER = ['super_admin', 'admin', 'staff', 'customer'];

/**
 * Staff and admin accounts.
 *
 * The server exposes no filters and caps the list at 200, so the search box narrows what has already
 * been fetched and the page states that limit out loud rather than implying a complete directory.
 * The list is admin-only; a staff account that reaches the route by URL gets the server's refusal.
 */
export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await adminApi.users();
      setUsers(data.users);
    } catch (err) {
      setError(describeError(err));
      setUsers([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="page"><div className="alert alert-error" role="alert">{error}</div></div>;

  const query = filter.trim().toLowerCase();
  const visible = (users ?? [])
    .filter((u) => !query || u.email.toLowerCase().includes(query) || u.fullName.toLowerCase().includes(query))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.email.localeCompare(b.email));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Staff accounts</h1>
          <p className="muted">
            Signed in as {user?.email} ({user?.role}). The server returns at most 200 accounts and offers
            no role filter; use the box below to narrow the returned page.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="field">
          <label htmlFor="user-filter">Filter</label>
          <input id="user-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Email or name" />
        </div>
        {users === null ? <p className="muted">Loading accounts…</p> : visible.length === 0 ? (
          <p className="muted">No accounts match.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((u) => (
                  <tr key={u.id}>
                    <td>{u.fullName}</td>
                    <td>{u.email}</td>
                    <td><span className="pill">{u.role}</span></td>
                    <td>{u.status}</td>
                    <td>{u.createdAt ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
