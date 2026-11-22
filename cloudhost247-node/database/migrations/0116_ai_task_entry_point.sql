/**
 * Phase 2 gate item 1 — central orchestration entry-point provenance.
 *
 * Every ai_tasks row created through the shared orchestration contract records which
 * authorized server-side entry point produced it. Pre-0116 rows keep NULL because their
 * provenance was never captured; historical values are deliberately not backfilled with
 * guesses. The CHECK constraint admits only known entry points (NULL allowed for legacy rows).
 *
 * Local schema only — not applied to staging or production.
 */
ALTER TABLE ai_tasks ADD COLUMN IF NOT EXISTS entry_point TEXT;

ALTER TABLE ai_tasks DROP CONSTRAINT IF EXISTS ai_tasks_entry_point_check;
ALTER TABLE ai_tasks ADD CONSTRAINT ai_tasks_entry_point_check CHECK (
  entry_point IS NULL OR entry_point IN (
    'admin.task',
    'admin.copilot',
    'admin.board.briefing',
    'schedule.scan',
    'schedule.board.briefing',
    'workflow.event',
    'customer.account_assistant',
    'customer.website_launch',
    'board.child'
  )
);

CREATE INDEX IF NOT EXISTS ai_tasks_entry_point_idx ON ai_tasks (entry_point)
  WHERE entry_point IS NOT NULL;
