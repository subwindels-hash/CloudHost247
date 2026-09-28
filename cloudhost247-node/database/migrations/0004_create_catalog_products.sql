-- Migration: 0004_create_catalog_products.sql
-- Purpose: Foundation table for the independent CloudHost247 service catalog (Phase 3).
--
-- This table intentionally does NOT store price/plan data — that lives in later catalog tables
-- (product_plans, plan_pricing) so a product can exist and be administered before pricing is
-- ready to publish. See docs/API_CATALOG.md and docs/NODE_PLATFORM_STATUS.md for the full
-- Phase 3 design rationale.
--
-- Columns:
--   slug          Stable public identifier used in URLs/API paths (e.g. "cpanel-hosting"). Never
--                 reused after being retired; renaming a product should get a new slug plus a
--                 redirect at the application layer, not an in-place slug edit, once real
--                 customers depend on the URL.
--   product_type  Coarse category used for grouping in the public catalog UI. Deliberately a
--                 small, broad set (not one value per hosting tier) so new hosting/service lines
--                 can be added later via ordinary INSERTs, without a schema migration every time.
--   status        Internal lifecycle: 'draft' (being configured, not shown as available even if
--                 publicly listed), 'active' (fully available), 'disabled' (fully retired/hidden).
--   visibility    'public' = eligible to appear in the public catalog API at all; 'private' =
--                 never returned by any public endpoint regardless of status (e.g. a product still
--                 being scoped out internally).
--
-- A product with visibility='public' and status='draft' is intentionally still listed publicly
-- (so prospective customers can see a service line exists) but reported as unavailable, with no
-- plans/pricing exposed — this is how "we don't have real pricing for this yet" is represented
-- honestly instead of either hiding the product entirely or inventing numbers.

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY,
  slug varchar(160) NOT NULL,
  name varchar(255) NOT NULL,
  description text NULL,
  product_type varchar(32) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  visibility varchar(16) NOT NULL DEFAULT 'private',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_product_type_check CHECK (product_type IN ('hosting', 'domain', 'service')),
  CONSTRAINT products_status_check CHECK (status IN ('draft', 'active', 'disabled')),
  CONSTRAINT products_visibility_check CHECK (visibility IN ('public', 'private'))
);

CREATE UNIQUE INDEX IF NOT EXISTS products_slug_unique_idx ON products (lower(slug));
CREATE INDEX IF NOT EXISTS products_type_idx ON products (product_type);
CREATE INDEX IF NOT EXISTS products_visibility_status_idx ON products (visibility, status);
CREATE INDEX IF NOT EXISTS products_display_order_idx ON products (display_order);
