-- Native deterministic AI support operator. Conversations are separate from support tickets only
-- while AI is handling them; authenticated offline escalations are linked to the existing ticket
-- system. Visitor escalations remain in the same support queue without inventing user accounts.
CREATE TABLE IF NOT EXISTS ai_support_conversations (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  visitor_name varchar(160) NULL,
  visitor_email varchar(320) NULL,
  access_token_hash char(64) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'AI_ACTIVE',
  escalation_reason varchar(48) NULL,
  escalation_note text NULL,
  assigned_agent_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  support_ticket_id uuid NULL REFERENCES support_tickets(id) ON DELETE SET NULL,
  source varchar(32) NOT NULL DEFAULT 'ai_assistant',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  last_message_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_support_conversations_status_check CHECK (status IN ('AI_ACTIVE','WAITING_FOR_HUMAN','ASSIGNED','IN_PROGRESS','WAITING_FOR_CUSTOMER','RESOLVED','CLOSED')),
  CONSTRAINT ai_support_conversations_reason_check CHECK (escalation_reason IS NULL OR escalation_reason IN ('USER_REQUESTED_HUMAN','AI_UNABLE_TO_ANSWER','ACCOUNT_SPECIFIC_REQUEST','BILLING_SUPPORT_REQUIRED','TECHNICAL_SUPPORT_REQUIRED','SERVER_SUPPORT_REQUIRED','COMPLAINT','REFUND_REQUEST','SECURITY_RELATED','OTHER')),
  CONSTRAINT ai_support_conversations_priority_check CHECK (priority IN ('low','normal','high'))
);
CREATE INDEX IF NOT EXISTS ai_support_conversations_user_idx ON ai_support_conversations(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_support_conversations_queue_idx ON ai_support_conversations(status,priority,last_message_at);

CREATE TABLE IF NOT EXISTS ai_support_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES ai_support_conversations(id) ON DELETE CASCADE,
  author_type varchar(16) NOT NULL,
  author_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  intent varchar(64) NULL,
  confidence numeric(4,3) NULL,
  knowledge_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_support_messages_author_check CHECK (author_type IN ('CUSTOMER','AI','AGENT','SYSTEM')),
  CONSTRAINT ai_support_messages_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 10000)
);
CREATE INDEX IF NOT EXISTS ai_support_messages_conversation_idx ON ai_support_messages(conversation_id,created_at);

CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id uuid PRIMARY KEY,
  name varchar(160) NOT NULL,
  email varchar(320) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE',
  source varchar(32) NOT NULL DEFAULT 'ai_assistant',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_subscriptions_status_check CHECK (status IN ('ACTIVE','UNSUBSCRIBED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS newsletter_subscriptions_email_unique_idx ON newsletter_subscriptions(lower(email));

CREATE TABLE IF NOT EXISTS support_agent_presence (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'OFFLINE',
  capacity integer NOT NULL DEFAULT 3 CHECK (capacity BETWEEN 1 AND 20),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_agent_presence_status_check CHECK (status IN ('ONLINE','BUSY','OFFLINE'))
);
