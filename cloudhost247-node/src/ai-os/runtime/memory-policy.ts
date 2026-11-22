import type { MemoryScope, TaskRow } from '../types';

/**
 * Temporary fail-closed boundary, not a complete memory authorization policy. Customer and
 * customer-attributed tasks cannot read or write shared memory; customer memory is disabled for
 * all runtime handlers until ownership, audience, retention and deletion are designed and reviewed.
 * Internal tasks without customer attribution retain existing non-customer memory behavior.
 */
export function assertRuntimeMemoryAllowed(task: Pick<TaskRow, 'requested_by_type' | 'customer_id'>, scope: MemoryScope): void {
  if (task.requested_by_type === 'customer' || task.customer_id !== null || scope === 'customer') {
    throw new Error('Memory unavailable for this task or scope');
  }
}
