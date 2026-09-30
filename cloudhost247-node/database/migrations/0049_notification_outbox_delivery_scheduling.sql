-- Notification outbox: retry scheduling.
--
-- The outbox table existed but had no way to express "try this again later": delivery was a
-- single inline attempt at notification time, so a webhook that was briefly down — or that was
-- not configured yet — lost the email forever while the in-app notice survived.
--
-- Additive only. Existing rows get a due date of now(), which makes the backlog (including rows
-- previously parked as CONFIGURATION_REQUIRED or FAILED-after-one-try) eligible for the new
-- drain instead of being stranded.

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 6;

-- The drain only ever looks for due rows in a non-terminal state.
CREATE INDEX IF NOT EXISTS notification_outbox_due_idx
  ON notification_outbox (next_attempt_at)
  WHERE status IN ('PENDING', 'CONFIGURATION_REQUIRED');

-- A row that failed only because nothing was configured is not a permanent failure: once an
-- operator sets the webhook variables the sweep should pick it up. Re-arm those rows, and only
-- those, keeping genuine delivery failures terminal.
UPDATE notification_outbox
   SET status = 'CONFIGURATION_REQUIRED', next_attempt_at = now(), updated_at = now()
 WHERE status = 'FAILED'
   AND last_error ILIKE '%not configured%';
