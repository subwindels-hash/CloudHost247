-- 0051 Operating-system logo uploads.
--
-- The original catalog accepted a logo_url, but the admin had no safe upload path. Keeping small
-- raster assets in PostgreSQL makes the upload work on cPanel, containers, and multi-instance
-- deployments without relying on a writable application checkout or an unshared local disk.
--
-- Existing static logo URLs are untouched. Uploaded assets are presentation-only and remain
-- completely separate from server_os_images/provider image identifiers.

CREATE TABLE IF NOT EXISTS operating_system_logo_assets (
  operating_system_id uuid PRIMARY KEY REFERENCES operating_systems (id) ON DELETE CASCADE,
  content_type varchar(32) NOT NULL,
  content bytea NOT NULL,
  byte_size integer NOT NULL,
  sha256 char(64) NOT NULL,
  original_filename varchar(255) NOT NULL,
  uploaded_by uuid NULL REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operating_system_logo_assets_type_check CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp')
  ),
  CONSTRAINT operating_system_logo_assets_size_check CHECK (
    byte_size > 0 AND byte_size <= 524288 AND octet_length(content) = byte_size
  ),
  CONSTRAINT operating_system_logo_assets_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
