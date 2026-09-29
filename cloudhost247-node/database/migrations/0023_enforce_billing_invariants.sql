-- Migration: 0023_enforce_billing_invariants.sql
-- Purpose: Phase 5B/5C financial invariant hardening (B1–B4 and B5).
--
-- Enforces cross-row and cross-table financial consistency at the database level:
--   - Invariant B1: payments.currency must match parent invoices.currency.
--   - Invariant B2: payments.user_id must match parent invoices.user_id.
--   - Invariant B3: billing_ledger.user_id and currency must match parent invoices.user_id and currency (when invoice_id IS NOT NULL).
--   - Invariant B4: payments.amount must not exceed parent invoices.total_amount.
--   - Invariant B5: invoices (user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount) must match parent orders.
--
-- Purely additive: creates validation trigger functions and triggers; modifies no existing columns,
-- tables, or historical data.
--
-- NOTE: Prepared for review and verification only. NOT AUTHORIZED FOR PRODUCTION EXECUTION.

-- 1. Invoices -> Orders invariant validation (B5)
CREATE OR REPLACE FUNCTION validate_invoice_invariants() RETURNS trigger AS $$
DECLARE
  v_order record;
BEGIN
  SELECT user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount INTO v_order
  FROM orders
  WHERE id = NEW.order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invoice references nonexistent order_id: %', NEW.order_id;
  END IF;

  IF NEW.user_id <> v_order.user_id THEN
    RAISE EXCEPTION 'invoice user_id (%) does not match order user_id (%)', NEW.user_id, v_order.user_id;
  END IF;

  IF NEW.currency <> v_order.currency THEN
    RAISE EXCEPTION 'invoice currency (%) does not match order currency (%)', NEW.currency, v_order.currency;
  END IF;

  IF NEW.subtotal_amount <> v_order.subtotal_amount THEN
    RAISE EXCEPTION 'invoice subtotal_amount (%) does not match order subtotal_amount (%)', NEW.subtotal_amount, v_order.subtotal_amount;
  END IF;

  IF NEW.discount_amount <> v_order.discount_amount THEN
    RAISE EXCEPTION 'invoice discount_amount (%) does not match order discount_amount (%)', NEW.discount_amount, v_order.discount_amount;
  END IF;

  IF NEW.tax_amount <> v_order.tax_amount THEN
    RAISE EXCEPTION 'invoice tax_amount (%) does not match order tax_amount (%)', NEW.tax_amount, v_order.tax_amount;
  END IF;

  IF NEW.total_amount <> v_order.total_amount THEN
    RAISE EXCEPTION 'invoice total_amount (%) does not match order total_amount (%)', NEW.total_amount, v_order.total_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS invoices_validate_invariants ON invoices;
CREATE TRIGGER invoices_validate_invariants
  BEFORE INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION validate_invoice_invariants();

-- 2. Payments -> Invoices invariant validation (B1, B2, B4)
CREATE OR REPLACE FUNCTION validate_payment_invariants() RETURNS trigger AS $$
DECLARE
  v_invoice record;
BEGIN
  SELECT user_id, currency, total_amount INTO v_invoice
  FROM invoices
  WHERE id = NEW.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment references nonexistent invoice_id: %', NEW.invoice_id;
  END IF;

  IF NEW.user_id <> v_invoice.user_id THEN
    RAISE EXCEPTION 'payment user_id (%) does not match invoice user_id (%)', NEW.user_id, v_invoice.user_id;
  END IF;

  IF NEW.currency <> v_invoice.currency THEN
    RAISE EXCEPTION 'payment currency (%) does not match invoice currency (%)', NEW.currency, v_invoice.currency;
  END IF;

  IF NEW.amount > v_invoice.total_amount THEN
    RAISE EXCEPTION 'payment amount (%) exceeds invoice total_amount (%)', NEW.amount, v_invoice.total_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_validate_invariants ON payments;
CREATE TRIGGER payments_validate_invariants
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION validate_payment_invariants();

-- 3. Billing Ledger -> Invoices invariant validation (B3)
CREATE OR REPLACE FUNCTION validate_billing_ledger_invariants() RETURNS trigger AS $$
DECLARE
  v_invoice record;
BEGIN
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT user_id, currency INTO v_invoice
    FROM invoices
    WHERE id = NEW.invoice_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ledger entry references nonexistent invoice_id: %', NEW.invoice_id;
    END IF;

    IF NEW.user_id <> v_invoice.user_id THEN
      RAISE EXCEPTION 'ledger user_id (%) does not match invoice user_id (%)', NEW.user_id, v_invoice.user_id;
    END IF;

    IF NEW.currency <> v_invoice.currency THEN
      RAISE EXCEPTION 'ledger currency (%) does not match invoice currency (%)', NEW.currency, v_invoice.currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS billing_ledger_validate_invariants ON billing_ledger;
CREATE TRIGGER billing_ledger_validate_invariants
  BEFORE INSERT ON billing_ledger
  FOR EACH ROW EXECUTE FUNCTION validate_billing_ledger_invariants();
