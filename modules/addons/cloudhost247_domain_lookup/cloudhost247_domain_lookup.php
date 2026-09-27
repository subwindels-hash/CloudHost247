<?php
/**
 * CloudHost247 Domain Lookup - WHMCS Addon Module
 *
 * A comprehensive toolkit for domain WHOIS, IP lookup, DNS lookup,
 * and domain availability checks. Built for CloudHost247 v2.2.6 theme.
 *
 * @package    WHMCS
 * @author     CloudHost247
 * @copyright  Copyright (c) 2024
 * @license    MIT License
 * @version    1.0.0
 * @link       https://www.cloudhost247.com
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

define('CLOUDHOST247_DOMAIN_LOOKUP_VERSION', '1.0.0');
define('CLOUDHOST247_DOMAIN_LOOKUP_MODULE', 'cloudhost247_domain_lookup');
define('CLOUDHOST247_DOMAIN_LOOKUP_ROOT', __DIR__);
define('CLOUDHOST247_DOMAIN_LOOKUP_CACHE_DIR', __DIR__ . '/cache');
define('CLOUDHOST247_DOMAIN_LOOKUP_TEMPLATE_DIR', __DIR__ . '/templates');
define('CLOUDHOST247_DOMAIN_LOOKUP_INCLUDES_DIR', __DIR__ . '/includes');
define('CLOUDHOST247_DOMAIN_LOOKUP_API_DIR', __DIR__ . '/api');

require_once CLOUDHOST247_DOMAIN_LOOKUP_INCLUDES_DIR . '/Autoloader.php';

use WHMCS\Module\Addon\CloudHost247DomainLookup\CacheManager;
use WHMCS\Module\Addon\CloudHost247DomainLookup\SecurityManager;

/**
 * Module configuration
 *
 * @return array
 */
function cloudhost247_domain_lookup_config()
{
    return [
        'name'        => 'CloudHost247 Domain Lookup',
        'description' => 'Professional domain WHOIS, IP lookup, DNS lookup, and domain availability toolkit for CloudHost247 theme.',
        'author'      => 'CloudHost247',
        'language'    => 'english',
        'version'     => CLOUDHOST247_DOMAIN_LOOKUP_VERSION,
        'fields'      => [
            'whatismyip_api_key' => [
                'FriendlyName' => 'WhatIsMyIP API Key',
                'Type'         => 'text',
                'Size'         => '50',
                'Description'  => 'Enter your WhatIsMyIP API key for WHOIS lookups. Get one at https://www.whatismyip.com/',
                'Default'      => '',
            ],
            'ipinfo_token' => [
                'FriendlyName' => 'IPinfo Access Token',
                'Type'         => 'text',
                'Size'         => '50',
                'Description'  => 'Enter your IPinfo access token for IP geolocation. Get one at https://ipinfo.io/',
                'Default'      => '',
            ],
            'ipwho_api_key' => [
                'FriendlyName' => 'IPWho API Key (Optional)',
                'Type'         => 'text',
                'Size'         => '50',
                'Description'  => 'Optional API key for IPWho (fallback IP service).',
                'Default'      => '',
            ],
            'cache_duration' => [
                'FriendlyName' => 'Cache Duration (Minutes)',
                'Type'         => 'dropdown',
                'Options'      => [
                    '5'   => '5 minutes',
                    '10'  => '10 minutes',
                    '15'  => '15 minutes',
                    '30'  => '30 minutes',
                    '60'  => '1 hour',
                ],
                'Description'  => 'How long to cache lookup results.',
                'Default'      => '10',
            ],
            'cache_method' => [
                'FriendlyName' => 'Cache Method',
                'Type'         => 'dropdown',
                'Options'      => [
                    'database' => 'WHMCS Database (Recommended)',
                    'file'     => 'File System',
                ],
                'Description'  => 'Choose where to store cached results.',
                'Default'      => 'database',
            ],
            'request_timeout' => [
                'FriendlyName' => 'API Request Timeout (Seconds)',
                'Type'         => 'dropdown',
                'Options'      => [
                    '5'  => '5 seconds',
                    '10' => '10 seconds',
                    '15' => '15 seconds',
                    '20' => '20 seconds',
                ],
                'Description'  => 'Maximum time to wait for API responses.',
                'Default'      => '10',
            ],
            'rate_limit_requests' => [
                'FriendlyName' => 'Rate Limit (Requests per Minute)',
                'Type'         => 'text',
                'Size'         => '5',
                'Description'  => 'Maximum requests per minute per user IP. Set 0 to disable.',
                'Default'      => '30',
            ],
            'enable_domain_whois' => [
                'FriendlyName' => 'Enable Domain WHOIS',
                'Type'         => 'yesno',
                'Description'  => 'Enable the Domain WHOIS lookup tool.',
                'Default'      => 'on',
            ],
            'enable_ip_whois' => [
                'FriendlyName' => 'Enable IP WHOIS',
                'Type'         => 'yesno',
                'Description'  => 'Enable the IP WHOIS lookup tool.',
                'Default'      => 'on',
            ],
            'enable_dns_lookup' => [
                'FriendlyName' => 'Enable DNS Lookup',
                'Type'         => 'yesno',
                'Description'  => 'Enable the DNS lookup tool.',
                'Default'      => 'on',
            ],
            'enable_availability' => [
                'FriendlyName' => 'Enable Domain Availability',
                'Type'         => 'yesno',
                'Description'  => 'Enable the Domain Availability check tool.',
                'Default'      => 'on',
            ],
            'debug_mode' => [
                'FriendlyName' => 'Debug Mode',
                'Type'         => 'yesno',
                'Description'  => 'Enable debug logging for troubleshooting.',
                'Default'      => '',
            ],
        ],
    ];
}

/**
 * Module activation
 *
 * Creates necessary database tables and cache directory.
 *
 * @return array
 */
function cloudhost247_domain_lookup_activate()
{
    try {
        // Create cache table
        if (!Capsule::schema()->hasTable('cloudhost247_domain_lookup_cache')) {
            Capsule::schema()->create('cloudhost247_domain_lookup_cache', function ($table) {
                $table->increments('id');
                $table->string('cache_key', 255);
                $table->mediumText('cache_value');
                $table->integer('expires')->unsigned();
                $table->timestamp('created_at')->default(Capsule::raw('CURRENT_TIMESTAMP'));
                $table->index('cache_key');
                $table->index('expires');
            });
        }

        // Create rate limiting table
        if (!Capsule::schema()->hasTable('cloudhost247_domain_lookup_rate_limit')) {
            Capsule::schema()->create('cloudhost247_domain_lookup_rate_limit', function ($table) {
                $table->increments('id');
                $table->string('ip_address', 45);
                $table->string('tool', 50);
                $table->integer('requests')->unsigned()->default(0);
                $table->integer('window_start')->unsigned();
                $table->timestamp('created_at')->default(Capsule::raw('CURRENT_TIMESTAMP'));
                $table->index(['ip_address', 'tool']);
                $table->index('window_start');
            });
        }

        // Create log table for debug
        if (!Capsule::schema()->hasTable('cloudhost247_domain_lookup_log')) {
            Capsule::schema()->create('cloudhost247_domain_lookup_log', function ($table) {
                $table->increments('id');
                $table->string('tool', 50);
                $table->string('query', 255);
                $table->string('source', 50)->nullable();
                $table->string('status', 20);
                $table->text('message')->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->timestamp('created_at')->default(Capsule::raw('CURRENT_TIMESTAMP'));
                $table->index(['tool', 'query']);
                $table->index('created_at');
            });
        }

        // Ensure cache directory exists
        if (!is_dir(CLOUDHOST247_DOMAIN_LOOKUP_CACHE_DIR)) {
            mkdir(CLOUDHOST247_DOMAIN_LOOKUP_CACHE_DIR, 0755, true);
        }

        // Create .htaccess to protect cache directory
        $htaccess = CLOUDHOST247_DOMAIN_LOOKUP_CACHE_DIR . '/.htaccess';
        if (!file_exists($htaccess)) {
            file_put_contents($htaccess, "Order deny,allow\nDeny from all\n");
        }

        return [
            'status'  => 'success',
            'description' => 'CloudHost247 Domain Lookup module activated successfully. Cache and rate limit tables created.',
        ];
    } catch (Exception $e) {
        return [
            'status'  => 'error',
            'description' => 'Failed to activate CloudHost247 Domain Lookup: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module deactivation
 *
 * @return array
 */
function cloudhost247_domain_lookup_deactivate()
{
    // Keep tables for data preservation, just disable the module
    return [
        'status'  => 'success',
        'description' => 'CloudHost247 Domain Lookup module deactivated. All data has been preserved.',
    ];
}

/**
 * Module upgrade
 *
 * @param array $vars
 */
function cloudhost247_domain_lookup_upgrade($vars)
{
    $version = $vars['version'];
    
    // Future upgrade paths
    if ($version < '1.0.0') {
        // Add upgrade logic here when needed
    }
}

/**
 * Admin area output
 *
 * @param array $vars
 * @return string
 */
function cloudhost247_domain_lookup_output($vars)
{
    $moduleLink = $vars['modulelink'];
    $version = $vars['version'];
    $lang = $vars['_lang'];
    
    $action = isset($_GET['action']) ? $_GET['action'] : 'dashboard';
    
    $smarty = new Smarty();
    $smarty->setTemplateDir(CLOUDHOST247_DOMAIN_LOOKUP_TEMPLATE_DIR . '/admin');
    $smarty->setCompileDir(CLOUDHOST247_DOMAIN_LOOKUP_CACHE_DIR . '/templates_c');
    $smarty->setCacheDir(CLOUDHOST247_DOMAIN_LOOKUP_CACHE_DIR . '/cache');
    
    $smarty->assign('moduleLink', $moduleLink);
    $smarty->assign('version', $version);
    $smarty->assign('action', $action);
    
    switch ($action) {
        case 'dashboard':
            $stats = cloudhost247_domain_lookup_get_stats();
            $smarty->assign('stats', $stats);
            echo $smarty->fetch('dashboard.tpl');
            break;
            
        case 'logs':
            $logs = cloudhost247_domain_lookup_get_logs(100);
            $smarty->assign('logs', $logs);
            echo $smarty->fetch('logs.tpl');
            break;
            
        case 'settings':
            echo $smarty->fetch('settings.tpl');
            break;
            
        default:
            echo $smarty->fetch('dashboard.tpl');
    }
}

/**
 * Admin area sidebar
 *
 * @param array $vars
 * @return string
 */
function cloudhost247_domain_lookup_sidebar($vars)
{
    $moduleLink = $vars['modulelink'];
    $version = $vars['version'];
    
    $sidebar = '<div class="sidebar-header">CloudHost247 Domain Lookup v' . $version . '</div>';
    $sidebar .= '<ul class="menu">';
    $sidebar .= '<li><a href="' . $moduleLink . '&action=dashboard">Dashboard</a></li>';
    $sidebar .= '<li><a href="' . $moduleLink . '&action=logs">Request Logs</a></li>';
    $sidebar .= '<li><a href="configaddonmods.php?module=cloudhost247_domain_lookup">Module Settings</a></li>';
    $sidebar .= '</ul>';
    
    return $sidebar;
}

/**
 * Client area output
 *
 * @param array $vars
 * @return array
 */
function cloudhost247_domain_lookup_clientarea($vars)
{
    $config = cloudhost247_domain_lookup_get_config();
    
    // Determine which template to show
    $page = isset($_GET['page']) ? $_GET['page'] : 'tools';
    $tool = isset($_GET['tool']) ? $_GET['tool'] : '';
    
    $tools = [];
    
    if ($config['enable_domain_whois'] === 'on') {
        $tools[] = [
            'id' => 'domain_whois',
            'name' => 'Domain WHOIS',
            'description' => 'Look up domain registration details including registrar, creation date, expiry date, and name servers.',
            'icon' => 'fa fa-globe',
            'url' => 'index.php?m=cloudhost247_domain_lookup&page=tool&tool=domain_whois',
        ];
    }
    
    if ($config['enable_ip_whois'] === 'on') {
        $tools[] = [
            'id' => 'ip_whois',
            'name' => 'IP Lookup',
            'description' => 'Get detailed information about any IP address including ISP, location, and ASN details.',
            'icon' => 'fa fa-map-marker',
            'url' => 'index.php?m=cloudhost247_domain_lookup&page=tool&tool=ip_whois',
        ];
    }
    
    if ($config['enable_dns_lookup'] === 'on') {
        $tools[] = [
            'id' => 'dns_lookup',
            'name' => 'DNS Lookup',
            'description' => 'Query DNS records including A, AAAA, MX, NS, TXT, CNAME, and SOA records.',
            'icon' => 'fa fa-server',
            'url' => 'index.php?m=cloudhost247_domain_lookup&page=tool&tool=dns_lookup',
        ];
    }
    
    if ($config['enable_availability'] === 'on') {
        $tools[] = [
            'id' => 'availability',
            'name' => 'Domain Availability',
            'description' => 'Check if a domain name is available for registration across popular TLDs.',
            'icon' => 'fa fa-search',
            'url' => 'index.php?m=cloudhost247_domain_lookup&page=tool&tool=availability',
        ];
    }
    
    // Generate CSRF token for forms
    $csrfToken = SecurityManager::generateCsrfToken();
    
    // Build breadcrumb
    $breadcrumb = [
        'index.php?m=cloudhost247_domain_lookup' => 'Tools',
    ];
    
    if ($page === 'tool' && !empty($tool)) {
        $toolNames = [
            'domain_whois' => 'Domain WHOIS',
            'ip_whois' => 'IP Lookup',
            'dns_lookup' => 'DNS Lookup',
            'availability' => 'Domain Availability',
        ];
        $breadcrumb['index.php?m=cloudhost247_domain_lookup&page=tool&tool=' . $tool] = $toolNames[$tool] ?? 'Tool';
    }
    
    return [
        'pagetitle'    => 'CloudHost247 Domain Lookup',
        'breadcrumb'   => $breadcrumb,
        'templatefile' => 'client/' . ($page === 'tool' ? 'tool' : 'tools'),
        'requirelogin' => false,
        'vars'         => [
            'tools'       => $tools,
            'page'        => $page,
            'tool'        => $tool,
            'csrfToken'   => $csrfToken,
            'modulePath'  => 'modules/addons/cloudhost247_domain_lookup',
            'config'      => $config,
        ],
    ];
}

/**
 * Get module configuration values
 *
 * @return array
 */
function cloudhost247_domain_lookup_get_config()
{
    $settings = [];
    $result = Capsule::table('tbladdonmodules')
        ->where('module', 'cloudhost247_domain_lookup')
        ->get();
    
    foreach ($result as $row) {
        $settings[$row->setting] = $row->value;
    }
    
    return $settings;
}

/**
 * Get usage statistics
 *
 * @return array
 */
function cloudhost247_domain_lookup_get_stats()
{
    $totalQueries = Capsule::table('cloudhost247_domain_lookup_log')->count();
    $todayQueries = Capsule::table('cloudhost247_domain_lookup_log')
        ->whereDate('created_at', date('Y-m-d'))
        ->count();
    
    $successQueries = Capsule::table('cloudhost247_domain_lookup_log')
        ->where('status', 'success')
        ->count();
    
    $failedQueries = Capsule::table('cloudhost247_domain_lookup_log')
        ->where('status', 'error')
        ->count();
    
    $successRate = $totalQueries > 0 ? round(($successQueries / $totalQueries) * 100, 2) : 0;
    
    $topTools = Capsule::table('cloudhost247_domain_lookup_log')
        ->select('tool', Capsule::raw('COUNT(*) as count'))
        ->groupBy('tool')
        ->orderBy('count', 'desc')
        ->limit(5)
        ->get();
    
    return [
        'total_queries' => $totalQueries,
        'today_queries' => $todayQueries,
        'success_rate'  => $successRate,
        'failed_queries'=> $failedQueries,
        'top_tools'     => $topTools,
    ];
}

/**
 * Get request logs
 *
 * @param int $limit
 * @return array
 */
function cloudhost247_domain_lookup_get_logs($limit = 100)
{
    return Capsule::table('cloudhost247_domain_lookup_log')
        ->orderBy('id', 'desc')
        ->limit($limit)
        ->get();
}

/**
 * Log a request
 *
 * @param string $tool
 * @param string $query
 * @param string $source
 * @param string $status
 * @param string $message
 */
function cloudhost247_domain_lookup_log($tool, $query, $source, $status, $message = '')
{
    try {
        Capsule::table('cloudhost247_domain_lookup_log')->insert([
            'tool'       => $tool,
            'query'      => substr($query, 0, 255),
            'source'     => $source,
            'status'     => $status,
            'message'    => substr($message, 0, 1000),
            'ip_address' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
            'created_at' => date('Y-m-d H:i:s'),
        ]);
    } catch (Exception $e) {
        // Silently fail logging to prevent disrupting user experience
    }
}
