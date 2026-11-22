import { describe, expect, it } from 'vitest';
import { approvalReviewFingerprint } from '../../src/ai-os/runtime/approval-review';
import type { ApprovalRow } from '../../src/ai-os/types';

const approval = {
  id: 'id', agent_id: 'agent', task_id: 'task', run_id: 'run', tool: 'tool', action: 'action', reason: 'reason',
  evidence: [{ table: 'test', id: 'source' }], risk_level: 'high', affected_customer_id: 'customer', affected_resource: 'resource',
  arguments: { a: 1, b: { x: 'value', y: true } }, arguments_verified: true, expires_at: '2027-01-01T00:00:00Z', status: 'pending',
} as ApprovalRow;

describe('approval review fingerprint', () => {
  it('is stable for reordered JSON keys and ignores the decision status', () => {
    expect(approvalReviewFingerprint({ ...approval, status: 'approved', arguments: { b: { y: true, x: 'value' }, a: 1 } })).toBe(approvalReviewFingerprint(approval));
  });
  it('changes when any reviewed proposal field changes', () => {
    const changes: Partial<ApprovalRow>[] = [
      { id: 'other' }, { agent_id: 'other' }, { task_id: null }, { run_id: null }, { tool: 'other' },
      { action: 'other' }, { reason: 'other' }, { evidence: [] }, { risk_level: 'critical' },
      { affected_customer_id: null }, { affected_resource: null }, { arguments_verified: false }, { arguments: { a: 2 } }, { expires_at: '2028-01-01T00:00:00Z' },
    ];
    for (const patch of changes) expect(approvalReviewFingerprint({ ...approval, ...patch })).not.toBe(approvalReviewFingerprint(approval));
  });
});
