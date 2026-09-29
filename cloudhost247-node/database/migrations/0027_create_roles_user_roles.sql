-- Migration: 0027_create_roles_user_roles.sql
-- Purpose: Phase 6 — explicit RBAC role registry (spec §4) + introduce the STAFF role.
--
-- Design decision (documented, deliberate): the existing platform enforces authorization through
-- `users.role` re-read from the database on every privileged request (src/lib/require-role.ts).
-- That remains the *effective* role and the single source of truth for the hot path — replacing
-- it with a join through user_roles would rewrite 20+ battle-tested route guards for no security
-- gain. `roles` + `user_roles` are added as the explicit, queryable registry the spec asks for:
-- seeded with the four canonical roles (SUPER_ADMIN, ADMIN, STAFF, CUSTOMER), backfilled from
-- users.role, and maintained by the same admin code paths that set users.role (they now write
-- both inside one transaction — src/services/role-service.ts).
--
-- 'staff' is added to the users.role check constraint: a limited operations role that can view
-- deployments/servers but not manage the catalog, customers, or billing.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'staff', 'admin', 'super_admin'));

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY,
  name varchar(32) NOT NULL,
  description text NULL,
  is_system boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_name_check CHECK (name IN ('super_admin', 'admin', 'staff', 'customer'))
);

CREATE UNIQUE INDEX IF NOT EXISTS roles_name_unique_idx ON roles (name);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  granted_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON user_roles (role_id);

-- Seed the four canonical roles with fixed, stable ids so seed/backfill code and tests can
-- reference them without a lookup round-trip.
INSERT INTO roles (id, name, description) VALUES
  ('00000000-0000-0000-0000-000000000001', 'super_admin', 'Full platform control, including role and credential management'),
  ('00000000-0000-0000-0000-000000000002', 'admin', 'Manage catalog, servers, deployments, customers, and billing'),
  ('00000000-0000-0000-0000-000000000003', 'staff', 'Operate deployments and servers; no catalog/customer/billing management'),
  ('00000000-0000-0000-0000-000000000004', 'customer', 'Purchase hosting and install marketplace applications')
ON CONFLICT (name) DO NOTHING;

-- Backfill user_roles from the pre-existing users.role values so the registry is consistent
-- from day one (users created later are written to both tables by the role service).
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
JOIN roles r ON r.name = u.role
ON CONFLICT DO NOTHING;
