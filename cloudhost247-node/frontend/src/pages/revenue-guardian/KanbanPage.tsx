import { useState } from 'react';
import { Link } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import { RgBadge, RgLoad, useRgData } from '../../components/revenue-guardian/rg-widgets';
import { RG_KANBAN_COLUMNS, rgPatch, type Paginated } from '../../lib/revenue-guardian-api';
import type { CaseRow } from './RecoveryQueuePage';

/**
 * Kanban board (spec §8). Moving a card issues the same validated status transition as the
 * case detail page — the server rejects invalid moves and ledger-guarded moves (recovered /
 * partially recovered) that the billing ledger does not confirm.
 */
export default function KanbanPage() {
  const { state, reload } = useRgData<Paginated<CaseRow>>('/recovery-cases', { limit: 100, status: '' });
  const [error, setError] = useState('');
  const [dragged, setDragged] = useState<CaseRow | null>(null);

  async function moveCase(target: string) {
    if (!dragged || dragged.status === target) return;
    setError('');
    try {
      const needsReason = ['disputed', 'closed', 'written_off'].includes(target);
      let reason: string | undefined;
      if (needsReason) {
        reason = window.prompt(`A reason is required to move ${dragged.case_number} to "${target.replace(/_/g, ' ')}":`) ?? undefined;
        if (!reason) return;
      }
      await rgPatch(`/recovery-cases/${dragged.id}`, { status: target, reason });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move rejected');
    } finally {
      setDragged(null);
    }
  }

  return (
    <RGLayout title="Recovery Kanban" hint="Drag a case to change its status. Ledger-guarded and invalid moves are rejected by the server.">
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}
      <RgLoad state={state}>
        {(data) => (
          <div style={{ display: 'flex', gap: '0.6rem', overflowX: 'auto', alignItems: 'flex-start' }}>
            {RG_KANBAN_COLUMNS.map((column) => {
              const cards = data.items.filter((c) => c.status === column);
              return (
                <div
                  key={column}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => void moveCase(column)}
                  style={{ minWidth: '13rem', flex: '0 0 13rem', background: 'rgba(127,127,127,0.06)', borderRadius: '8px', padding: '0.5rem' }}
                >
                  <p className="ch247-page__hint" style={{ fontWeight: 700 }}>
                    {column.replace(/_/g, ' ')} ({cards.length})
                  </p>
                  {cards.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDragged(c)}
                      className="ch247-card"
                      style={{ marginBottom: '0.5rem', cursor: 'grab', padding: '0.5rem' }}
                    >
                      <Link to={`/admin/revenue-guardian/recovery/${c.id}`}><strong>{c.case_number}</strong></Link>
                      <p style={{ margin: '0.15rem 0', fontSize: '0.85rem' }}>{c.customer_email}</p>
                      <p style={{ margin: '0.15rem 0', fontSize: '0.85rem' }}>{c.amount_outstanding} {c.currency}</p>
                      <RgBadge value={c.risk_level} />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </RgLoad>
    </RGLayout>
  );
}
