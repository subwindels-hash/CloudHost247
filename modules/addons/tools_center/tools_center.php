<?php
/**
 * WHMCS Tools Center - Addon Module
 * Main module file for WHMCS 8.x+
 * 
 * @package WHMCSToolsCenter
 * @version 1.0.0
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

use WHMCS\Database\Capsule;

/**
 * Module configuration
 */
function tools_center_config() {
    return [
        'name' => 'Tools Center',
        'description' => 'All-in-One Tools Marketplace for WHMCS - Provides 60+ network, DNS, IP, developer, and productivity tools',
        'author' => 'Tools Center',
        'language' => 'english',
        'version' => '1.0.0',
        'fields' => [
            'api_endpoint' => [
                'FriendlyName' => 'API Endpoint URL',
                'Type' => 'text',
                'Size' => '60',
                'Default' => 'https://tools-api.yourdomain.com/api.php',
                'Description' => 'Full URL to the external tools API endpoint',
            ],
            'api_token' => [
                'FriendlyName' => 'API Token',
                'Type' => 'password',
                'Size' => '40',
                'Default' => '',
                'Description' => 'Authentication token for the external API',
            ],
            'require_active_product' => [
                'FriendlyName' => 'Require Active Product',
                'Type' => 'yesno',
                'Default' => 'no',
                'Description' => 'Only allow access to users with at least one active/paid product/service',
            ],
            'allowed_client_groups' => [
                'FriendlyName' => 'Allowed Client Groups',
                'Type' => 'text',
                'Size' => '40',
                'Default' => '',
                'Description' => 'Comma-separated list of client group IDs (leave empty for all)',
            ],
            'show_in_menu' => [
                'FriendlyName' => 'Show in Client Area Menu',
                'Type' => 'yesno',
                'Default' => 'yes',
                'Description' => 'Display Tools Center link in client area navigation',
            ],
            'module_link_name' => [
                'FriendlyName' => 'Menu Link Name',
                'Type' => 'text',
                'Size' => '30',
                'Default' => 'Tools Center',
                'Description' => 'Name displayed in the client area menu',
            ],
        ]
    ];
}

/**
 * Module activation
 */
function tools_center_activate() {
    try {
        // Create tables
        $sql = <<<SQL
CREATE TABLE IF NOT EXISTS `mod_tools_center_logs` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `tool_category` VARCHAR(50) NOT NULL,
    `tool_action` VARCHAR(50) NOT NULL,
    `input_hash` VARCHAR(64) NOT NULL,
    `status` ENUM('success','error') NOT NULL DEFAULT 'success',
    `response_time_ms` INT(11) UNSIGNED DEFAULT 0,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    KEY `client_id` (`client_id`),
    KEY `tool_category` (`tool_category`),
    KEY `created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mod_tools_center_usage` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL,
    `date` DATE NOT NULL,
    `requests_count` INT(11) UNSIGNED NOT NULL DEFAULT 0,
    `tools_used` TEXT,
    PRIMARY KEY (`id`),
    UNIQUE KEY `client_date` (`client_id`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mod_tools_center_notepad` (
    `id` INT(11) UNSIGNED NOT NULL AUTO_INCREMENT,
    `client_id` INT(11) UNSIGNED NOT NULL,
    `note_id` VARCHAR(32) NOT NULL,
    `title` VARCHAR(255) DEFAULT NULL,
    `content` LONGTEXT,
    `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE KEY `note_id` (`note_id`),
    KEY `client_id` (`client_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SQL;
        
        Capsule::schema()->getConnection()->unprepared($sql);
        
        return [
            'status' => 'success',
            'description' => 'Tools Center activated successfully. Database tables created.'
        ];
    } catch (Exception $e) {
        return [
            'status' => 'error',
            'description' => 'Failed to activate: ' . $e->getMessage()
        ];
    }
}

/**
 * Module deactivation
 */
function tools_center_deactivate() {
    // Keep tables for data preservation
    return [
        'status' => 'success',
        'description' => 'Tools Center deactivated. Database tables preserved for reactivation.'
    ];
}

/**
 * Module upgrade
 */
function tools_center_upgrade($vars) {
    $version = $vars['version'];
    
    // Handle version upgrades here
    if ($version < '1.0.0') {
        // Future upgrade logic
    }
}

/**
 * Admin area output
 */
function tools_center_output($vars) {
    $moduleLink = $vars['modulelink'];
    $version = $vars['version'];
    
    $action = $_GET['action'] ?? 'dashboard';
    
    echo '<div class="tools-center-admin">';
    echo '<h2>Tools Center Administration</h2>';
    
    // Navigation
    echo '<ul class="nav nav-tabs">';
    echo '<li' . ($action === 'dashboard' ? ' class="active"' : '') . '><a href="' . $moduleLink . '&action=dashboard">Dashboard</a></li>';
    echo '<li' . ($action === 'usage' ? ' class="active"' : '') . '><a href="' . $moduleLink . '&action=usage">Usage Statistics</a></li>';
    echo '<li' . ($action === 'logs' ? ' class="active"' : '') . '><a href="' . $moduleLink . '&action=logs">API Logs</a></li>';
    echo '<li' . ($action === 'settings' ? ' class="active"' : '') . '><a href="' . $moduleLink . '&action=settings">Settings</a></li>';
    echo '</ul>';
    
    switch ($action) {
        case 'usage':
            tools_center_admin_usage($vars);
            break;
        case 'logs':
            tools_center_admin_logs($vars);
            break;
        case 'settings':
            tools_center_admin_settings($vars);
            break;
        default:
            tools_center_admin_dashboard($vars);
            break;
    }
    
    echo '</div>';
}

function tools_center_admin_dashboard($vars) {
    $stats = Capsule::table('mod_tools_center_logs')
        ->selectRaw('COUNT(*) as total_requests')
        ->selectRaw('COUNT(DISTINCT client_id) as unique_users')
        ->selectRaw('COUNT(CASE WHEN status = "error" THEN 1 END) as errors')
        ->first();
    
    $popularTools = Capsule::table('mod_tools_center_logs')
        ->select('tool_category', 'tool_action')
        ->selectRaw('COUNT(*) as count')
        ->groupBy('tool_category', 'tool_action')
        ->orderBy('count', 'desc')
        ->limit(10)
        ->get();
    
    echo '<div class="tab-content">';
    echo '<h3>Overview</h3>';
    echo '<div class="row">';
    echo '<div class="col-sm-3"><div class="panel panel-primary"><div class="panel-heading">Total Requests</div><div class="panel-body text-center"><h2>' . number_format($stats->total_requests ?? 0) . '</h2></div></div></div>';
    echo '<div class="col-sm-3"><div class="panel panel-success"><div class="panel-heading">Unique Users</div><div class="panel-body text-center"><h2>' . number_format($stats->unique_users ?? 0) . '</h2></div></div></div>';
    echo '<div class="col-sm-3"><div class="panel panel-warning"><div class="panel-heading">Error Rate</div><div class="panel-body text-center"><h2>' . ($stats->total_requests > 0 ? round((($stats->errors ?? 0) / $stats->total_requests) * 100, 1) : 0) . '%</h2></div></div></div>';
    echo '<div class="col-sm-3"><div class="panel panel-info"><div class="panel-heading">Active Tools</div><div class="panel-body text-center"><h2>60+</h2></div></div></div>';
    echo '</div>';
    
    echo '<h3>Popular Tools</h3>';
    echo '<table class="table table-striped">';
    echo '<thead><tr><th>Category</th><th>Action</th><th>Usage Count</th></tr></thead><tbody>';
    foreach ($popularTools as $tool) {
        echo '<tr><td>' . ucfirst($tool->tool_category) . '</td><td>' . ucfirst(str_replace('_', ' ', $tool->tool_action)) . '</td><td>' . number_format($tool->count) . '</td></tr>';
    }
    echo '</tbody></table>';
    echo '</div>';
}

function tools_center_admin_usage($vars) {
    $days = (int)($_GET['days'] ?? 30);
    $usage = Capsule::table('mod_tools_center_usage')
        ->where('date', '>=', date('Y-m-d', strtotime("-{$days} days")))
        ->selectRaw('date, SUM(requests_count) as requests')
        ->groupBy('date')
        ->orderBy('date', 'asc')
        ->get();
    
    echo '<div class="tab-content">';
    echo '<h3>Usage Statistics (Last ' . $days . ' Days)</h3>';
    echo '<table class="table table-striped">';
    echo '<thead><tr><th>Date</th><th>Requests</th></tr></thead><tbody>';
    foreach ($usage as $row) {
        echo '<tr><td>' . $row->date . '</td><td>' . number_format($row->requests) . '</td></tr>';
    }
    echo '</tbody></table>';
    echo '</div>';
}

function tools_center_admin_logs($vars) {
    $page = (int)($_GET['page'] ?? 1);
    $perPage = 50;
    $offset = ($page - 1) * $perPage;
    
    $logs = Capsule::table('mod_tools_center_logs')
        ->orderBy('created_at', 'desc')
        ->limit($perPage)
        ->offset($offset)
        ->get();
    
    echo '<div class="tab-content">';
    echo '<h3>API Request Logs</h3>';
    echo '<table class="table table-striped table-condensed">';
    echo '<thead><tr><th>Time</th><th>Client</th><th>Category</th><th>Action</th><th>Status</th><th>Response Time</th></tr></thead><tbody>';
    foreach ($logs as $log) {
        $statusClass = $log->status === 'success' ? 'label-success' : 'label-danger';
        echo '<tr>';
        echo '<td>' . $log->created_at . '</td>';
        echo '<td>' . ($log->client_id > 0 ? 'Client #' . $log->client_id : 'Guest') . '</td>';
        echo '<td>' . ucfirst($log->tool_category) . '</td>';
        echo '<td>' . ucfirst(str_replace('_', ' ', $log->tool_action)) . '</td>';
        echo '<td><span class="label ' . $statusClass . '">' . ucfirst($log->status) . '</span></td>';
        echo '<td>' . $log->response_time_ms . ' ms</td>';
        echo '</tr>';
    }
    echo '</tbody></table>';
    echo '</div>';
}

function tools_center_admin_settings($vars) {
    echo '<div class="tab-content">';
    echo '<h3>Settings</h3>';
    echo '<p>Configure module settings through the <a href="configaddonmods.php">Addon Modules</a> page.</p>';
    echo '</div>';
}