/** Authorized, transactionally audited human decisions; not an approval executor. */
import type { Queryable } from '../../db/types';
import { withTransaction } from '../../db/transaction';
import { ConflictError, ForbiddenError } from '../../lib/errors';
import { approvalReviewFingerprint } from './approval-review';
import { recordAudit, type AuditContext } from '../../lib/audit';
import { roleHasPermission } from '../permissions';
import { decideApproval } from '../repositories/approvals-repo';
import { approvalEffectKey, recordEffectIntent } from '../repositories/effect-outbox';
import type { ApprovalRow } from '../types';

/**
 * The route must authenticate first. Recheck and lock the current actor during the decision,
 * serialize competing decisions on the approval row, and commit the decision and platform audit
 * together. A lost COMMIT acknowledgement is unknown; callers must not execute on an exception.
 */
export async function decideAuthorizedApproval(
  db: Queryable,
  input: { id: string; decision: 'approved' | 'rejected'; actorId: string; note: string | null; reviewFingerprint: string; auditContext: AuditContext },
): Promise<ApprovalRow | null> {
  return withTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1 AND status = 'active' FOR SHARE`, [input.actorId],
    );
    if (!rows[0] || !roleHasPermission(rows[0].role, 'ai.approvals.manage')) {
      throw new ForbiddenError('Approver is no longer authorized');
    }
    const proposal = await tx.query<ApprovalRow>(`SELECT * FROM ai_approvals WHERE id = $1 FOR UPDATE`, [input.id]);
    const current = proposal.rows[0];
    if (!current || current.status !== 'pending') return null;
    if (approvalReviewFingerprint(current) !== input.reviewFingerprint) {
      throw new ConflictError('Approval changed since review; refresh and review again');
    }
    if (input.decision === 'approved' && current.arguments_verified !== true) {
      throw new ConflictError('Approval arguments lack preservation evidence; reject or investigate');
    }
    const decided = await decideApproval(tx, input.id, input.decision, input.actorId, input.note);
    if (!decided) return null;
    if (input.decision === 'approved') {
      // Durable effect intent commits atomically with the decision: an approval can never be
      // 'approved' without its outbox row, so a crash between decision and dispatch is visible.
      await recordEffectIntent(tx, { effectKey: approvalEffectKey(input.id), kind: 'approval_execution', approvalId: input.id });
    }
    await recordAudit(tx, {
      actorId: input.actorId, action: `ai.approval.${input.decision}`, resourceType: 'ai_approval',
      resourceId: input.id, metadata: { tool: decided.tool, agentId: decided.agent_id },
    }, input.auditContext);
    return decided;
  });
}
