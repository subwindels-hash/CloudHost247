-- ---------------------------------------------------------------------------
-- Rename the CloudHost247-owned "hostx_*" modules to "cloudhost247_*".
--
-- REQUIRED. The code rename alone is not sufficient: WHMCS resolves modules by
-- name out of the database, and the renamed PHP now addresses renamed tables.
-- Deploying the code without running this leaves the addons invisible in admin
-- and every email service pointing at a table that no longer exists.
--
-- Run it in the SAME maintenance window as the deploy, with the site in
-- maintenance mode, AFTER a full database backup.
--
--   mysql -u USER -p DATABASE < scripts/rename-hostx-to-cloudhost247.sql
--
-- Safe to re-run: every statement is guarded and skips work already done.
--
-- NOT covered here, deliberately:
--   * the HostX theme (templates/hostx) and its helper module
--     (modules/addons/hostx) keep their names -- licensed vendor code
--   * tblconfiguration 'Template' therefore still reads 'hostx'
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
--    mod_hostx_email_accounts carries live customer mailbox records; it is
--    renamed rather than recreated so no row is lost.
CALL ch247_rename_if_exists('mod_hostx_email_accounts',     'mod_cloudhost247_email_accounts');
CALL ch247_rename_if_exists('mod_hostx_email_api_logs',     'mod_cloudhost247_email_api_logs');
CALL ch247_rename_if_exists('mod_hostx_email_webhook_logs', 'mod_cloudhost247_email_webhook_logs');
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

-- 3. Provisioning bindings --------------------------------------------------
--    Without this, every product built on the email module loses its server
--    module and provisioning, suspension and renewal stop working.
UPDATE tblproducts SET servertype = 'cloudhost247_email'
    WHERE servertype = 'hostx_email';
UPDATE tblservers  SET type       = 'cloudhost247_email'
    WHERE type       = 'hostx_email';

-- 4. Admin role permissions, which are keyed by addon module name -----------
UPDATE tbladminroles
    SET  permissions = REPLACE(permissions, 'hostx_tools', 'cloudhost247_tools')
    WHERE permissions LIKE '%hostx_tools%';
UPDATE tbladminroles
    SET  permissions = REPLACE(permissions, 'hostx_domain_lookup', 'cloudhost247_domain_lookup')
    WHERE permissions LIKE '%hostx_domain_lookup%';

-- ---------------------------------------------------------------------------
-- Verification. Every count below must be 0 once the migration has run.
-- ---------------------------------------------------------------------------
SELECT 'addon rows still on the old name' AS check_name,
       COUNT(*) AS must_be_zero FROM tbladdonmodules
       WHERE module IN ('hostx_tools', 'hostx_domain_lookup')
UNION ALL
SELECT 'products still bound to hostx_email',
       COUNT(*) FROM tblproducts WHERE servertype = 'hostx_email'
UNION ALL
SELECT 'servers still typed hostx_email',
       COUNT(*) FROM tblservers  WHERE type = 'hostx_email'
UNION ALL
SELECT 'old mod_hostx_* tables remaining',
       COUNT(*) FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name LIKE 'mod\_hostx\_%';
