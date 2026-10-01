-- ---------------------------------------------------------------------------
-- 1.0.0 baseline
--
-- install/schema.sql creates every table. This migration exists so the ledger
-- (mod_cloudhost247_email_hosting_migrations) has an explicit 1.0.0 entry and later releases
-- have a known starting point to migrate from.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO `mod_cloudhost247_email_hosting_content` (`content_key`, `locale`, `value_json`, `updated_at`)
VALUES ('schema_version', 'english', '"1.0.0"', NOW());
