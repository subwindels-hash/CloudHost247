-- Migration: 0014_create_carts.sql
-- Purpose: Phase 5A "Commerce foundation" — a customer's shopping cart. One cart row per user
-- (enforced by the unique index below); `cart_items` (0015) hang off this table.
--
-- Unlike orders/order_items/the future billing ledger, a cart has no financial or audit
-- significance of its own — it is a mutable scratchpad that gets emptied once its contents become
-- a real, immutable `orders` record (see 0016/0017 and src/services/commerce-service.ts). This is
-- why `user_id` cascades on delete here (safe to discard) while every downstream financial table
-- deliberately does not (see 0016's comment).

CREATE TABLE IF NOT EXISTS carts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One active cart per customer — "add to cart" always upserts into this single row rather than
-- creating parallel carts.
CREATE UNIQUE INDEX IF NOT EXISTS carts_user_id_unique_idx ON carts (user_id);
