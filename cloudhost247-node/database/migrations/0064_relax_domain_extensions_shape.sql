-- -----------------------------------------------------------------------------------------------
-- 0064 — domain_extensions.extension must accept multi-label public suffixes.
--
-- 0063's shape check allowed only a single DNS label (e.g. `com`), but registrar TLD catalogues
-- include second-level suffixes such as `com.ng`, `co.uk` and `co.za`. Syncing a real catalogue
-- violated the constraint and rolled the whole sync back. The corrected shape allows one or more
-- dot-separated labels while still forbidding leading/trailing dots, hyphens and uppercase.
-- -----------------------------------------------------------------------------------------------
ALTER TABLE domain_extensions DROP CONSTRAINT IF EXISTS domain_extensions_shape_check;
ALTER TABLE domain_extensions ADD CONSTRAINT domain_extensions_shape_check CHECK (
  extension ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
);
