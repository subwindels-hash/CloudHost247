/**
 * Narrow ownership preflight for explicitly customer-tagged workflow steps. This binds the
 * customer IDs of currently supported event types to their real invoice/payment owner. It is not
 * event authentication or a general tenant sandbox: workflow inputs and subjects may still
 * contain other references, and a granted agent can use operational tools across customers.
 */
import { z } from 'zod';
import type { Queryable } from '../../db/types';
import type { EventRow } from '../types';
import type { PreparedWorkflowStep } from './workflow-contract';

export async function authorizeWorkflowCustomerScope(
  db: Queryable,
  event: EventRow,
  steps: readonly PreparedWorkflowStep[],
  lock = false,
): Promise<boolean> {
  const scoped = steps.filter((step) => step.customerId !== null);
  if (!scoped.length) return true;
  const spec = event.event_type === 'invoice.overdue'
    ? { table: 'invoices', key: 'invoiceId' }
    : event.event_type === 'payment.failed'
      ? { table: 'payments', key: 'paymentId' }
      : null;
  if (!spec) return false;
  const resource = z.string().uuid().safeParse(event.payload?.[spec.key]);
  if (!resource.success) return false;
  // The table is selected only from the fixed server-owned allowlist above, never event input.
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT r.user_id FROM ${spec.table} r JOIN users u ON u.id = r.user_id AND u.status = 'active'
     WHERE r.id = $1${lock ? ' FOR SHARE OF r, u' : ''}`,
    [resource.data],
  );
  return !!rows[0] && scoped.every((step) => step.customerId === rows[0]!.user_id);
}
