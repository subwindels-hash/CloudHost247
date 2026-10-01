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
--    CloudHost247 Tools (renamed addon) and CloudHost247 Email Hosting
--    (modules/servers/cloudhost247_email_hosting, renamed from the vendor
--    module id). RENAME TABLE preserves every row, index and grant: no data is
--    copied, converted or dropped. Each call is guarded, so a database that was
--    never on the old names is left untouched.
CALL ch247_rename_if_exists('mod_hostx_tools_cache',        'mod_cloudhost247_tools_cache');
CALL ch247_rename_if_exists('mod_hostx_tools_logs',         'mod_cloudhost247_tools_logs');
CALL ch247_rename_if_exists('mod_hostx_tools_rate_limit',   'mod_cloudhost247_tools_rate_limit');
CALL ch247_rename_if_exists('mod_hostx_tools_settings',     'mod_cloudhost247_tools_settings');
CALL ch247_rename_if_exists('mod_hostx_tools_status',       'mod_cloudhost247_tools_status');

CALL ch247_rename_if_exists('mod_hostx_email_accounts',     'mod_cloudhost247_email_hosting_accounts');
CALL ch247_rename_if_exists('mod_hostx_email_operations',   'mod_cloudhost247_email_hosting_operations');
CALL ch247_rename_if_exists('mod_hostx_email_locks',        'mod_cloudhost247_email_hosting_locks');
CALL ch247_rename_if_exists('mod_hostx_email_log',          'mod_cloudhost247_email_hosting_log');
CALL ch247_rename_if_exists('mod_hostx_email_webhooks',     'mod_cloudhost247_email_hosting_webhooks');
CALL ch247_rename_if_exists('mod_hostx_email_dns',          'mod_cloudhost247_email_hosting_dns');
CALL ch247_rename_if_exists('mod_hostx_email_content',      'mod_cloudhost247_email_hosting_content');
CALL ch247_rename_if_exists('mod_hostx_email_migrations',   'mod_cloudhost247_email_hosting_migrations');

DROP PROCEDURE IF EXISTS ch247_rename_if_exists;

-- 2. Addon module registration and its per-module settings ------------------
UPDATE tbladdonmodules SET module = 'cloudhost247_tools'
    WHERE module = 'hostx_tools';
UPDATE tbladdonmodules SET module = 'cloudhost247_domain_lookup'
    WHERE module = 'hostx_domain_lookup';

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
    WHERE type       = 'hostx_email';
UPDATE tblproducts SET servertype = 'cloudhost247_email_hosting'
    WHERE servertype = 'hostx_email';
--    The inactive legacy `cloudhost247_email` module owns
--    mod_cloudhost247_email_accounts and must never receive these rows, so the
--    two statements above match the old identifier exactly and nothing else.

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
-- has run. The informational counts at the end are identifiers that must
-- remain because the ionCube-encoded page-builder addon queries them at
-- runtime; see docs/BRANDING-COMPATIBILITY.md.
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
SELECT 'renamed-away mod_hostx_email_* tables remaining',
       COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name LIKE 'mod\_hostx\_email\_%'
UNION ALL
SELECT 'servers still bound to the old Email Hosting module',
       COUNT(*) FROM tblservers WHERE type = 'hostx_email'
UNION ALL
SELECT 'products still bound to the old Email Hosting module',
       COUNT(*) FROM tblproducts WHERE servertype = 'hostx_email'
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

-- Informational. Expected to be non-zero for as long as the ionCube-encoded
-- page-builder addon is in service: it queries these four tables by name at
-- runtime and the root marketing pages read them through Capsule.
SELECT 'retained legacy page-builder tables (expected)' AS note,
       COUNT(*) AS retained FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name IN ('mod_hostx_pages', 'mod_hostx_page_products',
                            'mod_hostx_setting', 'mod_hostx_dynmic_translation');
SELECT 'historical module-log rows kept as an audit trail (expected)' AS note,
       COUNT(*) AS retained FROM tblmodulelog WHERE module = 'hostx_email';

-- Deploy order and rollback -------------------------------------------------
--    a. Put the site in maintenance mode and take a full database backup.
--    b. Deploy the files (the module directory is now
--       modules/servers/cloudhost247_email_hosting).
--    c. Run this script. Steps b and c must happen in the same window: with the
--       new files but the old rows, WHMCS cannot resolve `hostx_email` and
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
--       UPDATE tblservers  SET type       = 'hostx_email' WHERE type       = 'cloudhost247_email_hosting';
--       UPDATE tblproducts SET servertype = 'hostx_email' WHERE servertype = 'cloudhost247_email_hosting';
--       RENAME TABLE `mod_cloudhost247_email_hosting_accounts`   TO `mod_hostx_email_accounts`;
--       ... and the other seven tables the same way - then redeploy the
--       previous release. RENAME TABLE is metadata-only and reversible.
--
--    Not migrated on purpose: historical WHMCS module-log rows
--    (tblmodulelog.module = 'hostx_email') are an audit trail of what ran at
--    the time and are never rewritten.
--
