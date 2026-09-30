-- 0048 Operating system logo assets.
--
-- Migration 0041 seeded the twelve catalog families but five of them had no logo asset yet, so
-- their logo_url stayed NULL and the UI fell back to a text badge. The missing SVGs now ship in
-- frontend/public/os-logos/, so point the catalog rows at them.
--
-- Logos are presentation assets only: they are never used to select, build or install an image.
-- Provider image identifiers live exclusively in server_os_images.
--
-- Safe and additive: only rows that still have no logo are updated, so an operator who uploaded
-- their own branding keeps it, and nothing outside the catalog metadata is touched.

BEGIN;

UPDATE operating_systems SET logo_url = '/os-logos/alpine.svg', updated_at = now()
  WHERE slug = 'alpine-linux' AND logo_url IS NULL;
UPDATE operating_systems SET logo_url = '/os-logos/arch.svg', updated_at = now()
  WHERE slug = 'arch-linux' AND logo_url IS NULL;
UPDATE operating_systems SET logo_url = '/os-logos/kali.svg', updated_at = now()
  WHERE slug = 'kali-linux' AND logo_url IS NULL;
UPDATE operating_systems SET logo_url = '/os-logos/nixos.svg', updated_at = now()
  WHERE slug = 'nixos' AND logo_url IS NULL;
UPDATE operating_systems SET logo_url = '/os-logos/opensuse.svg', updated_at = now()
  WHERE slug = 'opensuse' AND logo_url IS NULL;

COMMIT;
