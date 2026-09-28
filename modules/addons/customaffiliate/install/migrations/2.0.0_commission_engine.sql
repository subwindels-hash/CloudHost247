-- ---------------------------------------------------------------------------
-- 2.0.0 - commission engine
--
-- Brings 1.x installations (which only tracked commissions in their own tables
-- and never credited the affiliate) up to the 2.0 schema.
-- ---------------------------------------------------------------------------

-- Ledger: columns added in 2.0.
ALTER TABLE `mod_customaffiliate_commissions`
    ADD COLUMN IF NOT EXISTS `product_group_id` INT(10) UNSIGNED NOT NULL DEFAULT 0 AFTER `product_id`;

ALTER TABLE `mod_customaffiliate_commissions`
    ADD COLUMN IF NOT EXISTS `client_was_new` TINYINT(1) NOT NULL DEFAULT 1 AFTER `product_group_id`;

ALTER TABLE `mod_customaffiliate_commissions`
    ADD COLUMN IF NOT EXISTS `first_commission_reversed_at` DATETIME NULL DEFAULT NULL AFTER `first_commission_paid_at`;

ALTER TABLE `mod_customaffiliate_commissions`
    ADD COLUMN IF NOT EXISTS `total_commission` DECIMAL(16,2) NOT NULL DEFAULT 0.00 AFTER `recurring_count`;

ALTER TABLE `mod_customaffiliate_commissions`
    ADD COLUMN IF NOT EXISTS `last_invoice_id` INT(10) UNSIGNED NULL DEFAULT NULL AFTER `total_commission`;

-- Audit log gained severity levels.
ALTER TABLE `mod_customaffiliate_log`
    ADD COLUMN IF NOT EXISTS `level` ENUM('debug','info','warning','error') NOT NULL DEFAULT 'info' AFTER `id`;

ALTER TABLE `mod_customaffiliate_log`
    MODIFY COLUMN `percentage` DECIMAL(6,3) NOT NULL DEFAULT 0.000;
