const POSITIVE = new Set(['active', 'open']);
const WARNING = new Set(['pending_staff', 'pending_customer', 'pending_migration', 'pending_transfer', 'suspended']);
const NEGATIVE = new Set(['cancelled', 'expired', 'disabled', 'closed']);

/** Small colored status pill reused across services/domains/tickets/customer status displays, so
 * "active" always reads positive, "suspended"/"pending_*" always reads as a caution state, and
 * "cancelled"/"expired"/"disabled"/"closed" always reads as a terminal/negative state, regardless
 * of which record type it is describing. */
export default function StatusBadge({ status }: { status: string }) {
  let variant = '';
  if (POSITIVE.has(status)) variant = 'ch247-badge--active';
  else if (WARNING.has(status)) variant = 'ch247-badge--warning';
  else if (NEGATIVE.has(status)) variant = 'ch247-badge--danger';

  return <span className={`ch247-badge ${variant}`}>{status.replace(/_/g, ' ')}</span>;
}
