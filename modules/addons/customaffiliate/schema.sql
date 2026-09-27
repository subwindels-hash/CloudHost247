/**
 * Custom Affiliate Commission Module - SQL Schema
 *
 * Run this SQL in your WHMCS database (via phpMyAdmin or mysql CLI)
 * before activating the module. Note: The module activation will
 * also attempt to create these tables automatically.
 */

-- ============================================================
-- Table: mod_customaffiliate_commissions
-- Purpose: Track first vs recurring commission status per service
-- ============================================================

CREATE TABLE IF NOT EXISTS `mod_customaffiliate_commissions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `service_id` int(10) unsigned NOT NULL DEFAULT 0,
  `affiliate_id` int(10) unsigned NOT NULL DEFAULT 0,
  `client_id` int(10) unsigned NOT NULL DEFAULT 0,
  `product_id` int(10) unsigned NOT NULL DEFAULT 0,
  `first_commission_amount` decimal(16,2) NOT NULL DEFAULT 0.00,
  `first_commission_paid` tinyint(1) NOT NULL DEFAULT 0,
  `first_commission_invoice_id` int(10) unsigned NULL DEFAULT NULL,
  `first_commission_paid_at` datetime NULL DEFAULT NULL,
  `total_recurring_commission` decimal(16,2) NOT NULL DEFAULT 0.00,
  `recurring_count` int(10) unsigned NOT NULL DEFAULT 0,
  `last_commission_at` datetime NULL DEFAULT NULL,
  `notes` text NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `svc_aff_unique` (`service_id`, `affiliate_id`),
  KEY `service_id` (`service_id`),
  KEY `affiliate_id` (`affiliate_id`),
  KEY `client_id` (`client_id`),
  KEY `product_id` (`product_id`),
  KEY `first_commission_paid` (`first_commission_paid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;


-- ============================================================
-- Table: mod_customaffiliate_log
-- Purpose: Audit trail for all commission activities
-- ============================================================

CREATE TABLE IF NOT EXISTS `mod_customaffiliate_log` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `service_id` int(10) unsigned NULL DEFAULT NULL,
  `affiliate_id` int(10) unsigned NULL DEFAULT NULL,
  `invoice_id` int(10) unsigned NULL DEFAULT NULL,
  `action` varchar(50) NOT NULL DEFAULT '',
  `amount` decimal(16,2) NOT NULL DEFAULT 0.00,
  `percentage` decimal(5,2) NOT NULL DEFAULT 0.00,
  `description` text NULL DEFAULT NULL,
  `debug_data` text NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `service_id` (`service_id`),
  KEY `affiliate_id` (`affiliate_id`),
  KEY `invoice_id` (`invoice_id`),
  KEY `action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
