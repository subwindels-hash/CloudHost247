-- Read-only launch orchestration state. No customer messages, credentials or provider payloads
-- are stored here. Conversation access remains enforced by the existing support routes.
CREATE TABLE ai_launch_workflows (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES ai_support_conversations(id) ON DELETE CASCADE,
  status varchar(24) NOT NULL DEFAULT 'awaiting_choice',
  service_key varchar(40) NULL,
  lookup_task_id uuid NULL REFERENCES ai_tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_launch_workflows_status_check CHECK (status IN ('awaiting_choice','checking','options_ready','needs_support','cancelled','escalated')),
  CONSTRAINT ai_launch_workflows_service_check CHECK (service_key IS NULL OR service_key IN ('hosting-web-hosting','hosting-business','hosting-wordpress'))
);
CREATE UNIQUE INDEX ai_launch_workflows_active_conversation_idx ON ai_launch_workflows(conversation_id)
  WHERE status IN ('awaiting_choice', 'checking');
CREATE INDEX ai_launch_workflows_conversation_idx ON ai_launch_workflows(conversation_id, created_at DESC);
