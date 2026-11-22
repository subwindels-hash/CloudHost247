import { createHash } from 'node:crypto';
import type { ApprovalRow } from '../types';

/** Stable JSON encoding of database JSON values; this is a stale-review detector, not a MAC. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Fingerprint the reviewed proposal, independent of decision status/timestamps. */
export function approvalReviewFingerprint(row: ApprovalRow): string {
  const proposal = {
    version: 1, id: row.id, agentId: row.agent_id, taskId: row.task_id, runId: row.run_id,
    tool: row.tool, action: row.action, reason: row.reason, evidence: row.evidence,
    risk: row.risk_level, customerId: row.affected_customer_id, resource: row.affected_resource,
    arguments: row.arguments, argumentsVerified: row.arguments_verified, expiresAt: new Date(row.expires_at).toISOString(),
  };
  return createHash('sha256').update(canonical(proposal)).digest('hex');
}
