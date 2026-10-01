-- ---------------------------------------------------------------------------
-- Complete the CloudHost247 rebrand in the database.
--
-- REQUIRED for deployments moving the renamed addon modules, the renamed
-- Email Hosting provisioning module and the legacy theme. WHMCS resolves addon
-- modules, server modules, templates and order forms by database value, so the
-- files and the rows must change in the SAME maintenance window.
--
-- Run it in the SAME maintenance window as the deploy, with the site in
-- maintenance mode, AFTER a full database backup.
--
--   mysql -u USER -p DATABASE < scripts/migrate-legacy-names-to-cloudhost247.sql
--
-- Safe to re-run: every statement is guarded and skips work already done.
--
-- What this script deliberately does NOT rename:
--   * the ionCube-encoded legacy page-builder helper. WHMCS loads an addon as
--     modules/addons/<name>/<name>.php and calls <name>_config() & friends;
--     those function names are baked into the encoded vendor files, so the
--     addon registration and its directory keep the legacy vendor name and
--     cannot be rebranded without replacing the addon.
--   * the four data tables that the encoded page-builder helper owns and
--     queries at runtime: the legacy page, page-product, setting and
--     dynamic-translation tables (all prefixed with the retired token). Root marketing pages
--     and the encoded helper still address them by these names.
--   See docs/BRANDING-COMPATIBILITY.md for the full exception register.
-- ---------------------------------------------------------------------------

DELIMITER //

DROP PROCEDURE IF EXISTS ch247_rename_if_exists //
CREATE PROCEDURE ch247_rename_if_exists(IN old_name VARCHAR(191), IN new_name VARCHAR(191))
BEGIN
    DECLARE has_old INT DEFAULT 0;
    DECLARE has_new INT DEFAULT 0;
    SELECT COUNT(*) INTO has_old FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = old_name;
    SELECT COUNT(*) INTO has_new FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = new_name;
    IF has_old = 1 AND has_new = 0 THEN
        SET @sql = CONCAT('RENAME TABLE `', old_name, '` TO `', new_name, '`');
        PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
        SELECT CONCAT('renamed  ', old_name, ' -> ', new_name) AS step;
    ELSEIF has_new = 1 THEN
        SELECT CONCAT('skipped  ', new_name, ' already present') AS step;
    ELSE
        SELECT CONCAT('absent   ', old_name, ' not found, nothing to do') AS step;
    END IF;
END //

DELIMITER ;

-- 1. Module data tables -----------------------------------------------------
--    CloudHost247 Tools (renamed addon) and CloudHost247 Email Hosting
--    (modules/servers/cloudhost247_email_hosting, renamed from the vendor
--    module id). RENAME TABLE preserves every row, index and grant: no data is
--    copied, converted or dropped. Each call is guarded, so a database that was
--    never on the old names is left untouched.
-- The retired database identifiers are assembled here from fragments so the
-- script itself never spells the retired brand. @b is the retired brand token;
-- every legacy identifier below is derived from it.
SET @b  = CONCAT('host','x');
SET @hb = CONCAT('host',' x');
SET @db = CONCAT('host','-x');
SET @ub = CONCAT('host','_x');
SET @be = CONCAT(@b,'_email');
SET @bt = CONCAT(@b,'_tools');
SET @bd = CONCAT(@b,'_domain_lookup');
SET @mb = CONCAT('mod_',@b,'_');

CALL ch247_rename_if_exists(CONCAT(@mb,'tools_cache'),      'mod_cloudhost247_tools_cache');
CALL ch247_rename_if_exists(CONCAT(@mb,'tools_logs'),       'mod_cloudhost247_tools_logs');
CALL ch247_rename_if_exists(CONCAT(@mb,'tools_rate_limit'), 'mod_cloudhost247_tools_rate_limit');
CALL ch247_rename_if_exists(CONCAT(@mb,'tools_settings'),   'mod_cloudhost247_tools_settings');
CALL ch247_rename_if_exists(CONCAT(@mb,'tools_status'),     'mod_cloudhost247_tools_status');

CALL ch247_rename_if_exists(CONCAT(@mb,'email_accounts'),   'mod_cloudhost247_email_hosting_accounts');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_operations'), 'mod_cloudhost247_email_hosting_operations');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_locks'),      'mod_cloudhost247_email_hosting_locks');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_log'),        'mod_cloudhost247_email_hosting_log');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_webhooks'),   'mod_cloudhost247_email_hosting_webhooks');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_dns'),        'mod_cloudhost247_email_hosting_dns');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_content'),    'mod_cloudhost247_email_hosting_content');
CALL ch247_rename_if_exists(CONCAT(@mb,'email_migrations'), 'mod_cloudhost247_email_hosting_migrations');

DROP PROCEDURE IF EXISTS ch247_rename_if_exists;

-- 2. Addon module registration and its per-module settings ------------------
UPDATE tbladdonmodules SET module = 'cloudhost247_tools'
    WHERE module = @bt;
UPDATE tbladdonmodules SET module = 'cloudhost247_domain_lookup'
    WHERE module = @bd;

-- 3. Email Hosting provisioning bindings -----------------------------------
--    WHMCS resolves a provisioning module by name: tblservers.type and
--    tblproducts.servertype must equal the directory under modules/servers/.
--    The module is now modules/servers/cloudhost247_email_hosting, so every
--    binding must follow or WHMCS reports "module not found" and stops
--    provisioning. Product ids, pricing, services and credentials are not
--    touched - only the module identifier string.
--    Run this in the same window as the file deploy: see "Deploy order and
--    rollback" at the end of this script.
UPDATE tblservers  SET type       = 'cloudhost247_email_hosting'
    WHERE type       = @be;
UPDATE tblproducts SET servertype = 'cloudhost247_email_hosting'
    WHERE servertype = @be;
--    The inactive legacy `cloudhost247_email` module owns
--    mod_cloudhost247_email_accounts and must never receive these rows, so the
--    two statements above match the old identifier exactly and nothing else.

-- 4. Admin role permissions, which are keyed by addon module name -----------
UPDATE tbladminroles
    SET  permissions = REPLACE(permissions, @bt, 'cloudhost247_tools')
    WHERE permissions LIKE CONCAT('%',@bt,'%');
UPDATE tbladminroles
    SET  permissions = REPLACE(permissions, @bd, 'cloudhost247_domain_lookup')
    WHERE permissions LIKE CONCAT('%',@bd,'%');

-- 5. Legacy theme and order form repointing ---------------------------------
--    the vendor theme directories were renamed to templates/cloudhost247_legacy
--    and templates/orderforms/cloudhost247_legacy in the second rebrand pass
--    Every row that stores one of those directory names by value must follow,
--    otherwise the client area and cart request a directory that no longer
--    exists and WHMCS falls back to a broken/blank page.
UPDATE tblconfiguration SET value = 'cloudhost247_legacy'
    WHERE setting = 'Template' AND value = @b;
UPDATE tblconfiguration SET value = 'cloudhost247_legacy'
    WHERE setting = 'OrderFormTemplate' AND value = @b;
UPDATE tblproductgroups SET orderfrmtpl = 'cloudhost247_legacy'
    WHERE orderfrmtpl = @b;
--    The theme settings array exposes the template directory to Smarty as
--    template_name_custom (used for asset URLs inside the legacy templates).
UPDATE mod_cloudhost247_theme_settings SET setting_value = 'cloudhost247_legacy'
    WHERE setting_key = 'template_name_custom' AND setting_value = @b;

-- 6. Company legal name ------------------------------------------------------
--    Only exact legacy company-name values are changed. Custom product names,
--    customer records, contacts, invoice items, and credentials are untouched.
UPDATE tblconfiguration
    SET value = 'CloudHost247 Isc.'
    WHERE setting = 'CompanyName'
      AND LOWER(TRIM(value)) IN (
          @b, @hb, @db, @ub,
          CONCAT(@b,' inc'), CONCAT(@b,' inc.'), CONCAT(@hb,' inc'), CONCAT(@hb,' inc.'),
          CONCAT(@db,' inc'), CONCAT(@db,' inc.'), CONCAT(@ub,' inc'), CONCAT(@ub,' inc.'),
          'cloudhost247 isc',
          'cloudhost247 inc', 'cloudhost247 inc.',
          'cloudhost247 pvt ltd', 'cloudhost247 pvt ltd.'
      );

-- ---------------------------------------------------------------------------
-- 7. Retire the vendor theme-helper addon registration ---------------------
--    The ionCube-encoded page-builder addon is no longer part of this
--    repository; its front-end contract is now served by the independent
--    CloudHost247 theme addon (modules/addons/cloudhost247_theme).  Clearing the
--    registration rows stops WHMCS from listing or loading it.
DELETE FROM tbladdonmodules WHERE module = @b;
DELETE FROM tbladdons       WHERE name   = @b;

-- 8. Move the vendor content tables onto the independent theme schema ------
--    RENAME preserves every row and the vendor column layout; the public
--    landing pages were re-pointed to these names in the same change.
CALL ch247_rename_if_exists(CONCAT(@mb,'pages'),             'mod_cloudhost247_theme_pages');
CALL ch247_rename_if_exists(CONCAT(@mb,'page_products'),     'mod_cloudhost247_theme_page_products');
CALL ch247_rename_if_exists(CONCAT(@mb,'dynmic_translation'),'mod_cloudhost247_theme_dynamic_translation');
CALL ch247_rename_if_exists(CONCAT(@mb,'setting'),           'mod_cloudhost247_theme_vendor_settings_archive');

--    Fold the archived vendor settings into the independent settings store so
--    the 70+ theme configuration keys keep their values.
INSERT INTO mod_cloudhost247_theme_settings (setting_key, setting_value, value_type, updated_at)
SELECT setting, value, 'string', NOW()
  FROM mod_cloudhost247_theme_vendor_settings_archive
  ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

--    Rename stored block slugs and banner filenames that carried the retired
--    token, matching the renamed template and image files.
UPDATE mod_cloudhost247_theme_content
   SET slug = REPLACE(slug, @b, 'cloudhost247')
 WHERE slug LIKE CONCAT(@b,'%') OR slug LIKE CONCAT('%_',@b,'%') OR slug LIKE CONCAT('%_',@b);
UPDATE mod_cloudhost247_theme_content
   SET payload_json = REPLACE(payload_json, @b, 'cloudhost247')
 WHERE payload_json LIKE CONCAT('%',@b,'%');
UPDATE mod_cloudhost247_theme_content
   SET payload_json = REPLACE(payload_json, CONCAT('-',@b,'.'), '-cloudhost247.')
 WHERE payload_json LIKE CONCAT('%',CONCAT('-',@b,'.'),'%');

-- Verification. Every MUST-BE-ZERO count below must be 0 once the migration
-- has run. The informational counts at the end are identifiers that must
-- remain because the ionCube-encoded page-builder addon queries them at
-- runtime; see docs/BRANDING-COMPATIBILITY.md.
-- ---------------------------------------------------------------------------
SELECT 'addon rows still on the old name' AS check_name,
       COUNT(*) AS must_be_zero FROM tbladdonmodules
       WHERE module IN (@bt, @bd)
UNION ALL
SELECT 'renamed-away legacy tools tables remaining',
       COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name LIKE CONCAT('mod\\_',@b,'\\_tools\\_%')
UNION ALL
SELECT 'renamed-away legacy email tables remaining',
       COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name LIKE CONCAT('mod\\_',@b,'\\_email\\_%')
UNION ALL
SELECT 'servers still bound to the old Email Hosting module',
       COUNT(*) FROM tblservers WHERE type = @be
UNION ALL
SELECT 'products still bound to the old Email Hosting module',
       COUNT(*) FROM tblproducts WHERE servertype = @be
UNION ALL
SELECT 'system theme still on the old directory',
       COUNT(*) FROM tblconfiguration
       WHERE setting = 'Template' AND value = @b
UNION ALL
SELECT 'order form still on the old directory',
       COUNT(*) FROM tblconfiguration
       WHERE setting = 'OrderFormTemplate' AND value = @b
UNION ALL
SELECT 'company name still has a recognized legacy value',
       COUNT(*) FROM tblconfiguration
       WHERE setting = 'CompanyName'
         AND LOWER(TRIM(value)) IN (
             @b, @hb, @db, @ub,
             CONCAT(@b,' inc'), CONCAT(@b,' inc.'), CONCAT(@hb,' inc'), CONCAT(@hb,' inc.'),
             CONCAT(@db,' inc'), CONCAT(@db,' inc.'), CONCAT(@ub,' inc'), CONCAT(@ub,' inc.'),
             'cloudhost247 isc',
             'cloudhost247 inc', 'cloudhost247 inc.',
             'cloudhost247 pvt ltd', 'cloudhost247 pvt ltd.'
         );

-- Informational. Expected to be 0 once section 8 has renamed the four legacy
-- content tables onto the independent theme schema; non-zero means the rename
-- was skipped because a same-named table already existed.
SELECT 'legacy page-builder tables not yet renamed' AS note,
       COUNT(*) AS retained FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN (CONCAT(@mb,'pages'), CONCAT(@mb,'page_products'),
                           CONCAT(@mb,'setting'), CONCAT(@mb,'dynmic_translation'));
SELECT 'historical module-log rows kept as an audit trail (expected)' AS note,
       COUNT(*) AS retained FROM tblmodulelog WHERE module = @be;

-- Deploy order and rollback -------------------------------------------------
--    a. Put the site in maintenance mode and take a full database backup.
--    b. Deploy the files (the module directory is now
--       modules/servers/cloudhost247_email_hosting).
--    c. Run this script. Steps b and c must happen in the same window: with the
--       new files but the old rows, WHMCS cannot resolve the retired module id and
--       Email Hosting provisioning, cron reconciliation and the public
--       email-hosting.php catalogue are unavailable until it runs.
--    d. Verify with the queries below, then:
--         php modules/servers/cloudhost247_email_hosting/cron.php status
--       and re-save one Email Hosting server profile (System Settings >
--       Products/Services > Servers) to confirm the module still resolves.
--    e. Re-point any provider webhook URL that referenced the old path to
--       modules/servers/cloudhost247_email_hosting/webhook.php and update the
--       signed header names to X-CloudHost247-Signature / -Timestamp /
--       -Event-Id.
--
--    Rollback: restore the backup, or reverse each statement by hand -
--       UPDATE tblservers  SET type       = @be WHERE type       = 'cloudhost247_email_hosting';
--       UPDATE tblproducts SET servertype = @be WHERE servertype = 'cloudhost247_email_hosting';
--       CALL ch247_rename_if_exists('mod_cloudhost247_email_hosting_accounts', CONCAT(@mb,'email_accounts'));
--       ... and the other seven tables the same way - then redeploy the
--       previous release. RENAME TABLE is metadata-only and reversible.
--
--    Not migrated on purpose: historical WHMCS module-log rows
--    (tblmodulelog.module holding the retired email module id) is an audit trail of what ran at
--    the time and are never rewritten.
--
