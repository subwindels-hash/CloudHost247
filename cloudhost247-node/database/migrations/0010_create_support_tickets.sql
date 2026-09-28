-- Migration: 0010_create_support_tickets.sql
-- Purpose: Phase 4 "Customer App" — a basic support ticket system. A customer can open a ticket
-- and reply to their own; admin/super_admin staff can view and reply to any ticket and change its
-- status. This carries no payment/billing/provisioning meaning whatsoever — it is plain
-- account-to-staff messaging.
--
-- status lifecycle: 'open' (new, awaiting staff) -> 'pending_staff' (customer replied, awaiting
-- staff) / 'pending_customer' (staff replied, awaiting customer) -> 'closed'. A customer reply on
-- a closed ticket reopens it (see src/db/support-tickets.ts) rather than silently being dropped.

CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  subject varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'open',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  CONSTRAINT support_tickets_status_check CHECK (status IN ('open', 'pending_customer', 'pending_staff', 'closed')),
  CONSTRAINT support_tickets_priority_check CHECK (priority IN ('low', 'normal', 'high'))
);

CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx ON support_tickets (user_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON support_tickets (status);
