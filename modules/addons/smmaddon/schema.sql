--
-- SMM Panel Integration Module - Database Schema
-- For WHMCS 8.9.x
--

-- Config table
CREATE TABLE IF NOT EXISTS `mod_smm_config` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `setting` VARCHAR(255) NOT NULL,
    `value` TEXT NOT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `setting` (`setting`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Services mapping table
CREATE TABLE IF NOT EXISTS `mod_smm_services` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `smm_service_id` VARCHAR(255) NOT NULL,
    `smm_name` VARCHAR(500) NOT NULL,
    `smm_category` VARCHAR(255) NOT NULL DEFAULT '',
    `smm_rate` DECIMAL(10,4) NOT NULL DEFAULT '0.0000',
    `smm_min` INT(11) NOT NULL DEFAULT '0',
    `smm_max` INT(11) NOT NULL DEFAULT '0',
    `smm_type` VARCHAR(50) NOT NULL DEFAULT 'default',
    `whmcs_product_id` INT(11) UNSIGNED NOT NULL DEFAULT '0',
    `whmcs_server_id` INT(11) UNSIGNED NOT NULL DEFAULT '0',
    `markup_percent` DECIMAL(5,2) NOT NULL DEFAULT '0.00',
    `markup_fixed` DECIMAL(10,4) NOT NULL DEFAULT '0.0000',
    `is_active` TINYINT(1) NOT NULL DEFAULT '1',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `smm_service_id_server` (`smm_service_id`, `whmcs_server_id`),
    KEY `whmcs_product_id` (`whmcs_product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Orders tracking table
CREATE TABLE IF NOT EXISTS `mod_smm_orders` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `whmcs_order_id` INT(11) UNSIGNED NOT NULL,
    `whmcs_service_id` INT(11) UNSIGNED NOT NULL,
    `whmcs_user_id` INT(11) UNSIGNED NOT NULL,
    `smm_order_id` VARCHAR(255) NOT NULL DEFAULT '',
    `smm_service_id` VARCHAR(255) NOT NULL,
    `quantity` INT(11) NOT NULL DEFAULT '0',
    `link` TEXT NOT NULL,
    `status` ENUM('pending','processing','inprogress','completed','canceled','partial','refunded','error') NOT NULL DEFAULT 'pending',
    `start_count` INT(11) NOT NULL DEFAULT '0',
    `remains` INT(11) NOT NULL DEFAULT '0',
    `api_response` TEXT,
    `last_check` DATETIME DEFAULT NULL,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `whmcs_service_id` (`whmcs_service_id`),
    KEY `smm_order_id` (`smm_order_id`),
    KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API Logs table
CREATE TABLE IF NOT EXISTS `mod_smm_logs` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `action` VARCHAR(255) NOT NULL,
    `endpoint` VARCHAR(500) NOT NULL,
    `request` TEXT,
    `response` TEXT,
    `http_code` INT(11) DEFAULT NULL,
    `error` TEXT,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `action` (`action`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server mapping table
CREATE TABLE IF NOT EXISTS `mod_smm_server_map` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `server_id` INT(11) UNSIGNED NOT NULL,
    `api_url` VARCHAR(500) NOT NULL,
    `api_key` VARCHAR(500) NOT NULL,
    `is_active` TINYINT(1) NOT NULL DEFAULT '1',
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `server_id` (`server_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
