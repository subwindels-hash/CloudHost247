-- Migration: 0021_add_payment_confirmation_fields.sql
-- Purpose: Phase 5C "Payment integration" — records *who* attested that a manual/offline payment
-- (src/payments/manual-gateway.ts) was actually received, for the audit trail the Phase 5 spec
-- calls for explicitly ("auditable financial action chain"). A manual payment has no external
-- provider asynchronously confirming it the way a real gateway's webhook does (Phase 5D) — a staff
-- member is directly asserting a real-world fact ("this bank transfer arrived"), so recording which
-- staff member made that assertion, and when, is the manual gateway's equivalent of a webhook's
-- provider signature: the thing that makes the state transition attributable and auditable rather
-- than an unexplained status flip.
--
-- `ON DELETE SET NULL` (not `RESTRICT`): unlike the financial amounts/references elsewhere in this
-- schema, losing the *identity* of which staff account did the confirming (if that account is ever
-- deleted) must never block deleting the account or corrupt the payment record itself — the
-- completed payment and its ledger entry remain intact and correct either way.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS confirmed_by_user_id uuid NULL REFERENCES users (id) ON DELETE SET NULL;
