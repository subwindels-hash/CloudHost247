--
-- WHMCS Tools Center - Database Installation Script
-- Run this SQL in your WHMCS database
-- Compatible with MySQL 5.7+ / MariaDB 10.2+
--

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------
-- API Request Logs Table
-- Tracks all tool usage for analytics and billing
-- --------------------------------------------------------
DROP TABLE IF EXISTS `mod_tools_center_logs`;
CREATE TABLE `mod_tools_center_logs` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `tool_category` VARCHAR(50) NOT NULL COLLATE utf8mb4_unicode_ci,
    `tool_action` VARCHAR(50) NOT NULL COLLATE utf8mb4_unicode_ci,
    `input_hash` VARCHAR(64) NOT NULL COLLATE utf8mb4_unicode_ci,
    `status` ENUM('success','error') NOT NULL DEFAULT 'success' COLLATE utf8mb4_unicode_ci,
    `response_time_ms` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `idx_client_id` (`client_id`),
    KEY `idx_tool_category` (`tool_category`),
    KEY `idx_tool_action` (`tool_action`),
    KEY `idx_created_at` (`created_at`),
    KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tools Center API request logs';

-- --------------------------------------------------------
-- Daily Usage Statistics Table
-- Aggregated per-user daily usage for quotas and billing
-- --------------------------------------------------------
DROP TABLE IF EXISTS `mod_tools_center_usage`;
CREATE TABLE `mod_tools_center_usage` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL,
    `date` DATE NOT NULL,
    `requests_count` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `tools_used` TEXT COLLATE utf8mb4_unicode_ci DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_client_date` (`client_id`, `date`),
    KEY `idx_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tools Center daily usage stats';

-- --------------------------------------------------------
-- User Notepad Table
-- Stores user notes (online notepad feature)
-- --------------------------------------------------------
DROP TABLE IF EXISTS `mod_tools_center_notepad`;
CREATE TABLE `mod_tools_center_notepad` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL,
    `note_id` VARCHAR(32) NOT NULL COLLATE utf8mb4_unicode_ci,
    `title` VARCHAR(255) DEFAULT NULL COLLATE utf8mb4_unicode_ci,
    `content` LONGTEXT COLLATE utf8mb4_unicode_ci,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_note_id` (`note_id`),
    KEY `idx_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tools Center user notepad';

-- --------------------------------------------------------
-- User Favorites Table
-- Stores user's favorite/bookmarked tools
-- --------------------------------------------------------
DROP TABLE IF EXISTS `mod_tools_center_favorites`;
CREATE TABLE `mod_tools_center_favorites` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL,
    `tool_category` VARCHAR(50) NOT NULL COLLATE utf8mb4_unicode_ci,
    `tool_action` VARCHAR(50) NOT NULL COLLATE utf8mb4_unicode_ci,
    `display_order` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_client_tool` (`client_id`, `tool_category`, `tool_action`),
    KEY `idx_client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tools Center user favorite tools';

-- --------------------------------------------------------
-- Tool Access Control Table
-- Per-tool access permissions by client group
-- --------------------------------------------------------
DROP TABLE IF EXISTS `mod_tools_center_permissions`;
CREATE TABLE `mod_tools_center_permissions` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_group_id` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `tool_category` VARCHAR(50) NOT NULL COLLATE utf8mb4_unicode_ci,
    `tool_action` VARCHAR(50) DEFAULT NULL COLLATE utf8mb4_unicode_ci COMMENT 'NULL = all tools in category',
    `allowed` TINYINT(1) NOT NULL DEFAULT 1,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `idx_group_tool` (`client_group_id`, `tool_category`, `tool_action`),
    KEY `idx_group_id` (`client_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tools Center access permissions';

SET FOREIGN_KEY_CHECKS = 1;