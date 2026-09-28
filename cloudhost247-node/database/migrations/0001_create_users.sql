-- Migration: 0001_create_users.sql
-- Purpose: Foundation "users" table for the independent CloudHost247 authentication system.
--
-- Notes:
--   * The primary key is a plain `uuid` column populated by the application (crypto.randomUUID()).
--     This intentionally avoids requiring the pgcrypto/uuid-ossp extensions, which many managed
--     PostgreSQL providers and shared-hosting accounts do not grant CREATE EXTENSION rights for
--     (least-privilege database users, per docs/CPANEL_DEPLOYMENT.md).
--   * Runs inside the migration runner's own transaction — do not add BEGIN/COMMIT here.

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email varchar(255) NOT NULL,
  password_hash text NOT NULL,
  full_name varchar(255) NOT NULL,
  role varchar(32) NOT NULL DEFAULT 'customer',
  status varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('customer', 'admin', 'super_admin')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'disabled'))
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (lower(email));
