import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

const PAGE_SIZE = 50;

/**
 * Audit log console. The log is append-only everywhere else — this screen only reads it. The full
 * admin view filters by actor, resource type/id and action substring, pages with limit/offset, and
 * joins the actor's email/name plus the recorded metadata. Filter parameter names follow the
 * upstream contract (`resourceType`/`resourceId` map onto this platform's entity columns).
 */
export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState({ actorId: '', resourceType: '', resourceId: '', action: '' });
  const [applied, setApplied] = useState({ actorId: '', resourceType: '', resourceId: '', action: '' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = { limit: PAGE_SIZE, offset };
      if (applied.actorId) params.actorId = applied.actorId;
      if (applied.resourceType) params.resourceType = applied.resourceType;
      if (applied.resourceId) params.resourceId = applied.resourceId;
      if (applied.action) params.action = applied.action;
      const res = await adminApi.auditLogs(params);
      setLogs(res.logs ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setLogs([]);
      setError(describeError(e));
    }
  }, [applied, offset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Append-only record of security-relevant actions. This console reads the log; nothing here edits it.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <form className="form-row" onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setApplied({ ...filters });
        }}>
          <label>
            <span>Actor ID</span>
            <input value={filters.actorId} onChange={(e) => setFilters({ ...filters, actorId: e.target.value })} />
          </label>
          <label>
            <span>Resource type</span>
            <input value={filters.resourceType} onChange={(e) => setFilters({ ...filters, resourceType: e.target.value })}
              placeholder="e.g. user, invoice" />
          </label>
          <label>
            <span>Resource ID</span>
            <input value={filters.resourceId} onChange={(e) => setFilters({ ...filters, resourceId: e.target.value })} />
          </label>
          <label>
            <span>Action contains</span>
            <input value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}
              placeholder="e.g. security_number" />
          </label>
          <button className="btn btn-primary">Apply filters</button>
        </form>

        {logs === null ? (
          <p className="muted">Loading audit log…</p>
        ) : logs.length === 0 ? (
          <p className="muted">No audit entries match these filters.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Resource</th>
                    <th scope="col">IP</th>
                    <th scope="col">Metadata</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((row) => (
                    <tr key={row.id}>
                      <td>{formatDate(row.createdAt, { withTime: true })}</td>
                      <td>
                        {row.actorName ?? row.actorEmail ?? row.actorId ?? '—'}
                        {row.actorEmail && <div className="muted small">{row.actorEmail}</div>}
                      </td>
                      <td className="mono">{row.action}</td>
                      <td>
                        {row.resourceType ?? '—'}
                        {row.resourceId && <div className="muted small mono">{row.resourceId}</div>}
                      </td>
                      <td className="muted">{row.ipAddress ?? '—'}</td>
                      <td className="muted small mono">
                        {row.metadata ? JSON.stringify(row.metadata) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="actions">
              <button className="btn btn-ghost" type="button" disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
              <span className="muted">
                {offset + 1}–{offset + logs.length} of {total}
              </span>
              <button className="btn btn-ghost" type="button" disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
