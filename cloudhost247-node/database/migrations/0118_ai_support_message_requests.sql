/*
 * Durable support-message intake identity. A request key and its customer message are
 * inserted under the conversation lock in one transaction. Retrying a key never dispatches
 * processing again; it reports an uncertain outcome. Old clients without a key are unchanged.
 * Local-only migration; retention/deletion and mixed-version rollout require review.
 */
CREATE TABLE ai_support_message_requests (
  conversation_id uuid NOT NULL REFERENCES ai_support_conversations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  message_id uuid NOT NULL REFERENCES ai_support_messages(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, request_id),
  UNIQUE (message_id)
);
