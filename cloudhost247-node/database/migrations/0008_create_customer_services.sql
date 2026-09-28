-- Migration: 0008_create_customer_services.sql
-- Purpose: Phase 4 "Customer App" — a purely informational record of a hosting/domain/service a
-- customer already has, entered and maintained only by authorized staff (admin/super_admin).
--
-- This table intentionally has NO automation hooks: creating or updating a row here never calls
-- any cPanel/WHM/hosting-control-plane API, and never provisions, activates, or verifies anything
-- technical. It exists purely so a customer can see an accurate, staff-entered summary of what
-- they have (e.g. mirroring an existing WHMCS-managed service during a future migration, or a
-- service arranged outside this platform) instead of the Dashboard's Phase 1-3 placeholder text.
-- Automated provisioning/service activation remains explicitly out of scope until a later phase.
--
-- Columns:
--   product_id / plan_id   Optional soft links into the Phase 3 catalog, purely descriptive (e.g.
--                          "this is a cPanel Hosting / Plan A service"). Nullable and
--                          ON DELETE SET NULL so retiring a catalog product/plan can never break
--                          or delete a customer's service history.
--   status                 'active' | 'suspended' | 'cancelled' | 'pending_migration'. There is no
--                          hard delete anywhere in this table — history is preserved by moving to
--                          'cancelled', consistent with how the Phase 3 catalog "disables" rather
--                          than deletes a product.
--   external_reference     Free-text staff reference (e.g. a legacy WHMCS service id) for
--                          migration traceability only — not a live link/foreign key to any
--                          external system.
--   notes                  Staff-only free text, never returned by any customer-facing endpoint
--                          (see src/dto/account.ts).
--   created_by             The staff user who entered this record (nullable — SET NULL if that
--                          staff account is later removed; the customer's record itself must
--                          never disappear as a side effect).

CREATE TABLE IF NOT EXISTS customer_services (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id uuid NULL REFERENCES products (id) ON DELETE SET NULL,
  plan_id uuid NULL REFERENCES product_plans (id) ON DELETE SET NULL,
  label varchar(255) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'active',
  external_reference varchar(255) NULL,
  notes text NULL,
  created_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_services_status_check CHECK (status IN ('active', 'suspended', 'cancelled', 'pending_migration'))
);

CREATE INDEX IF NOT EXISTS customer_services_user_id_idx ON customer_services (user_id);
CREATE INDEX IF NOT EXISTS customer_services_status_idx ON customer_services (status);
