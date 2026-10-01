-- ---------------------------------------------------------------------------
-- Complete the CloudHost247 rebrand in the database.
--
-- REQUIRED for deployments moving the renamed addon modules and legacy theme.
-- WHMCS resolves addon modules, templates and order forms by database value.
-- This script deliberately leaves the separate Email Hosting server module's
-- type (hostx_email) and mod_hostx_email_* tables unchanged: the source at
-- modules/servers/hostx_email still uses those identifiers for compatibility.
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
--   * the Email Hosting server module's technical type `hostx_email` and its
--     mod_hostx_email_* data tables. WHMCS products/servers and the current
--     module source depend on those stable identifiers; renaming them would
--     require a separate staged module/data migration.
--   * the four data tables that the encoded page-builder helper owns and
--     queries at runtime: mod_hostx_pages, mod_hostx_page_products,
--     mod_hostx_setting, mod_hostx_dynmic_translation. Root marketing pages
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
--    Only the renamed tools-module tables move. Email Hosting tables retain
--    their original prefix because modules/servers/hostx_email reads them.
CALL ch247_rename_if_exists('mod_hostx_tools_cache',        'mod_cloudhost247_tools_cache');
CALL ch247_rename_if_exists('mod_hostx_tools_logs',         'mod_cloudhost247_tools_logs');
CALL ch247_rename_if_exists('mod_hostx_tools_rate_limit',   'mod_cloudhost247_tools_rate_limit');
CALL ch247_rename_if_exists('mod_hostx_tools_settings',     'mod_cloudhost247_tools_settings');
CALL ch247_rename_if_exists('mod_hostx_tools_status',       'mod_cloudhost247_tools_status');

DROP PROCEDURE IF EXISTS ch247_rename_if_exists;

-- 2. Addon module registration and its per-module settings ------------------
UPDATE tbladdonmodules SET module = 'cloudhost247_tools'
    WHERE module = 'hostx_tools';
UPDATE tbladdonmodules SET module = 'cloudhost247_domain_lookup'
    WHERE module = 'hostx_domain_lookup';

-- 3. Email Hosting provisioning bindings -----------------------------------
--    Intentionally unchanged. Existing tblproducts.servertype and
--    tblservers.type values `hostx_email` resolve to
--    modules/servers/hostx_email and remain valid.

-- 4. Admin role permissions, which are keyed by addon module name -----------
UPDATE tbladminroles
    SET  permissions = REPLACE(permissions, 'hostx_tools', 'cloudhost247_tools')
    WHERE permissions LIKE '%hostx_tools%';
UPDATE tbladminroles
    SET  permissions = REPLACE(permissions, 'hostx_domain_lookup', 'cloudhost247_domain_lookup')
    WHERE permissions LIKE '%hostx_domain_lookup%';

-- 5. Legacy theme and order form repointing ---------------------------------
--    templates/hostx            is now templates/cloudhost247_legacy
--    templates/orderforms/hostx is now templates/orderforms/cloudhost247_legacy
--    Every row that stores one of those directory names by value must follow,
--    otherwise the client area and cart request a directory that no longer
--    exists and WHMCS falls back to a broken/blank page.
UPDATE tblconfiguration SET value = 'cloudhost247_legacy'
    WHERE setting = 'Template' AND value = 'hostx';
UPDATE tblconfiguration SET value = 'cloudhost247_legacy'
    WHERE setting = 'OrderFormTemplate' AND value = 'hostx';
UPDATE tblproductgroups SET orderfrmtpl = 'cloudhost247_legacy'
    WHERE orderfrmtpl = 'hostx';
--    The theme settings array exposes the template directory to Smarty as
--    template_name_custom (used for asset URLs inside the legacy templates).
UPDATE mod_hostx_setting SET value = 'cloudhost247_legacy'
    WHERE setting = 'template_name_custom' AND value = 'hostx';

-- 6. Company legal name ------------------------------------------------------
--    Only exact legacy company-name values are changed. Custom product names,
--    customer records, contacts, invoice items, and credentials are untouched.
UPDATE tblconfiguration
    SET value = 'CloudHost247 Isc.'
    WHERE setting = 'CompanyName'
      AND LOWER(TRIM(value)) IN (
          'hostx', 'host x', 'host-x', 'host_x',
          'hostx inc', 'hostx inc.', 'host x inc', 'host x inc.',
          'host-x inc', 'host-x inc.', 'host_x inc', 'host_x inc.',
          'cloudhost247 isc',
          'cloudhost247 inc', 'cloudhost247 inc.',
          'cloudhost247 pvt ltd', 'cloudhost247 pvt ltd.'
      );

-- ---------------------------------------------------------------------------
-- Verification. Every MUST-BE-ZERO count below must be 0 once the migration
-- has run. Informational counts at the end include identifiers intentionally
-- retained for the encoded page-builder and Email Hosting compatibility.
-- ---------------------------------------------------------------------------
SELECT 'addon rows still on the old name' AS check_name,
       COUNT(*) AS must_be_zero FROM tbladdonmodules
       WHERE module IN ('hostx_tools', 'hostx_domain_lookup')
UNION ALL
SELECT 'renamed-away mod_hostx_tools_* tables remaining',
       COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name LIKE 'mod\_hostx\_tools\_%'
UNION ALL
SELECT 'system theme still on the old directory',
       COUNT(*) FROM tblconfiguration
       WHERE setting = 'Template' AND value = 'hostx'
UNION ALL
SELECT 'order form still on the old directory',
       COUNT(*) FROM tblconfiguration
       WHERE setting = 'OrderFormTemplate' AND value = 'hostx'
UNION ALL
SELECT 'company name still has a recognized legacy value',
       COUNT(*) FROM tblconfiguration
       WHERE setting = 'CompanyName'
         AND LOWER(TRIM(value)) IN (
             'hostx', 'host x', 'host-x', 'host_x',
             'hostx inc', 'hostx inc.', 'host x inc', 'host x inc.',
             'host-x inc', 'host-x inc.', 'host_x inc', 'host_x inc.',
             'cloudhost247 isc',
             'cloudhost247 inc', 'cloudhost247 inc.',
             'cloudhost247 pvt ltd', 'cloudhost247 pvt ltd.'
         );

-- Informational, expected to be non-zero while the encoded helper and/or
-- compatibility-bound Email Hosting products remain in service.
SELECT 'retained legacy page-builder tables (expected)' AS note,
       COUNT(*) AS retained FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN ('mod_hostx_pages', 'mod_hostx_page_products',
                            'mod_hostx_setting', 'mod_hostx_dynmic_translation');
SELECT 'Email Hosting products retaining hostx_email (expected)' AS note,
       COUNT(*) AS retained FROM tblproducts WHERE servertype = 'hostx_email';
SELECT 'Email Hosting servers retaining hostx_email (expected)' AS note,
       COUNT(*) AS retained FROM tblservers WHERE type = 'hostx_email';
SELECT 'Email Hosting tables retaining mod_hostx_email_* (expected)' AS note,
       COUNT(*) AS retained FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name LIKE 'mod\_hostx\_email\_%';
