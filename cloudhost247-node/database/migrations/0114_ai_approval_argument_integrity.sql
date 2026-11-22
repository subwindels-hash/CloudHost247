-- Existing proposals cannot be proven identical to the original tool request.
-- They remain available for rejection/investigation, not execution by updated code.
ALTER TABLE ai_approvals
  ADD COLUMN IF NOT EXISTS arguments_verified boolean NOT NULL DEFAULT false;
