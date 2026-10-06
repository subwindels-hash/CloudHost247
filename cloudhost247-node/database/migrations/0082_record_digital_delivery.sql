-- Migration: 0082_record_digital_delivery.sql
-- Purpose: record what actually happened when a paid online-store order's digital goods were sent
-- to the buyer.
--
-- A download token is the goods, so "were the links delivered, and how?" is a fact the merchant and
-- the platform both need to be able to answer. Three states are possible and all three are stored
-- verbatim:
--   * sent   — the platform's email transport accepted the message.
--   * manual — no transport is configured; the links are still available to the buyer through the
--              order-status lookup, and the merchant sees that the email was not sent.
--   * failed — the transport answered with an error; the reason is kept.
--
-- Nothing here is nullable-by-accident: an order with no digital lines keeps NULLs and is never
-- labelled delivered.

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS download_delivery_status varchar(16) NULL,
  ADD COLUMN IF NOT EXISTS download_delivery_note varchar(500) NULL,
  ADD COLUMN IF NOT EXISTS download_links_sent_at timestamptz NULL;

ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_download_delivery_status_check;
ALTER TABLE store_orders ADD CONSTRAINT store_orders_download_delivery_status_check CHECK (
  download_delivery_status IS NULL OR download_delivery_status IN ('sent', 'manual', 'failed')
);

COMMENT ON COLUMN store_orders.download_delivery_status IS
  'Delivery outcome for the digital download links of this order: sent | manual | failed. NULL when the order has no digital lines.';
