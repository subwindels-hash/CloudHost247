-- Migration: 0121_create_abuse_reports.sql
-- Purpose: Customer-facing abuse reporting intake (F13).
--
-- Design notes:
--   * Abuse reports are a *distinct* intake from support tickets. A support ticket is a
--     customer's own account-to-staff conversation; an abuse report is typically filed by a
--     customer or an external party about a domain, IP or service hosted on this platform
--     (spam, phishing, copyright, illegal content, security issues). It carries no
--     billing/provisioning meaning and no real transaction — it is a report for staff review.
--   * Submission is public and rate-limited: anyone can report abuse without an account.
--     Reporters may optionally provide contact details so staff can follow up, but they are
--     not required — abuse reports are deliberately able to be filed anonymously.
--   * Nothing is auto-delivered to any abuse@ mailbox or external party. The report is
--     stored and queued for staff review; the status page and admin surfaces reflect what
--     has actually been recorded. This is honest about the absence of configured
--     abuse-handling providers rather than promising a response path that does not exist.
--   * Runs inside the migration runner's own transaction — no BEGIN/COMMIT.
--   * Local schema only — not applied to staging or production.

CREATE TABLE IF NOT EXISTS abuse_reports (
  id uuid PRIMARY KEY,
  reporter_name varchar(255) NULL,
  reporter_email varchar(255) NULL,
  category varchar(32) NOT NULL,
  subject varchar(255) NOT NULL,
  body text NOT NULL,
  target varchar(255) NULL,
  status varchar(32) NOT NULL DEFAULT 'received',
  priority varchar(16) NOT NULL DEFAULT 'normal',
  staff_notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT abuse_reports_category_check CHECK (
    category IN ('spam', 'phishing', 'copyright', 'illegal_content', 'security', 'other')
  ),
  CONSTRAINT abuse_reports_status_check CHECK (
    status IN ('received', 'under_review', 'actioned', 'closed')
  ),
  CONSTRAINT abuse_reports_priority_check CHECK (
    priority IN ('low', 'normal', 'high', 'critical')
  ),
  CONSTRAINT abuse_reports_body_not_blank_check CHECK (length(btrim(body)) > 0)
);

CREATE INDEX IF NOT EXISTS abuse_reports_status_idx ON abuse_reports (status);
CREATE INDEX IF NOT EXISTS abuse_reports_category_idx ON abuse_reports (category);
CREATE INDEX IF NOT EXISTS abuse_reports_created_idx ON abuse_reports (created_at DESC);

-- Staff-facing comment: staff_notes are internal and never surfaced to the reporter.
