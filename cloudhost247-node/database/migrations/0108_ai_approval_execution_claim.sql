-- An approval execution is claimed once before any tool runs. An interrupted claim is left in
-- executing for human reconciliation; it is not automatically retried because a write may have
-- reached its downstream system even when the result was lost.
ALTER TABLE ai_approvals DROP CONSTRAINT ai_approvals_status_check;
ALTER TABLE ai_approvals ADD CONSTRAINT ai_approvals_status_check CHECK (status IN (
  'pending', 'approved', 'executing', 'rejected', 'expired', 'cancelled', 'executed', 'failed'
));
