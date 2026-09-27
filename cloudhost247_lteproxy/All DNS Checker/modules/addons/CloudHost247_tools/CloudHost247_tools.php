<?php
/**
 * CloudHost247 Tools Platform - WHMCS Addon Module
 * Version: 2.2.6
 * Compatible: WHMCS 8.9+, PHP 7.4+
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use Illuminate\Database\Capsule\Manager as Capsule;

/**
 * Module configuration
 */
function CloudHost247_tools_config()
{
    return [
        'name' => 'CloudHost247 Tools Platform',
        'description' => 'All-in-one online tools platform for DNS, IP, Developer, Security and Productivity tools.',
        'author' => 'CloudHost247',
        'version' => '2.2.6',
        'language' => 'english',
        'fields' => [
            'whois_api_key' => [
                'FriendlyName' => 'WHOIS API Key',
                'Type' => 'text',
                'Size' => '50',
                'Default' => '',
                'Description' => 'API key for WHOIS lookups (optional)',
            ],
            'geoip_api_key' => [
                'FriendlyName' => 'GeoIP API Key',
                'Type' => 'text',
                'Size' => '50',
                'Default' => '',
                'Description' => 'API key for IP Geolocation (ipgeolocation.io or ip-api.com)',
            ],
            'ocr_api_key' => [
                'FriendlyName' => 'OCR API Key',
                'Type' => 'text',
                'Size' => '50',
                'Default' => '',
                'Description' => 'API key for Image to Text OCR (optional)',
            ],
            'rate_limit_requests' => [
                'FriendlyName' => 'Rate Limit (requests/minute)',
                'Type' => 'text',
                'Size' => '10',
                'Default' => '60',
                'Description' => 'Maximum tool requests per minute per IP',
            ],
            'cache_duration' => [
                'FriendlyName' => 'Cache Duration (minutes)',
                'Type' => 'dropdown',
                'Options' => [
                    '5' => '5 minutes',
                    '10' => '10 minutes',
                    '15' => '15 minutes',
                    '30' => '30 minutes',
                ],
                'Default' => '10',
                'Description' => 'How long to cache DNS/IP results',
            ],
            'enable_logs' => [
                'FriendlyName' => 'Enable Activity Logs',
                'Type' => 'yesno',
                'Default' => 'on',
                'Description' => 'Log all tool usage for analytics',
            ],
        ]
    ];
}

/**
 * Module activation
 */
function CloudHost247_tools_activate()
{
    try {
        // Create tools settings table
        if (!Capsule::schema()->hasTable('mod_CloudHost247_tools_settings')) {
            Capsule::schema()->create('mod_CloudHost247_tools_settings', function ($table) {
                $table->increments('id');
                $table->string('setting_name', 100)->unique();
                $table->text('setting_value')->nullable();
                $table->timestamps();
            });
        }

        // Create tools status table
        if (!Capsule::schema()->hasTable('mod_CloudHost247_tools_status')) {
            Capsule::schema()->create('mod_CloudHost247_tools_status', function ($table) {
                $table->increments('id');
                $table->string('tool_id', 100)->unique();
                $table->string('tool_name', 255);
                $table->string('category', 100);
                $table->tinyInteger('enabled')->default(1);
                $table->integer('usage_count')->default(0);
                $table->timestamps();
            });
        }

        // Create tools logs table
        if (!Capsule::schema()->hasTable('mod_CloudHost247_tools_logs')) {
            Capsule::schema()->create('mod_CloudHost247_tools_logs', function ($table) {
                $table->increments('id');
                $table->string('tool_id', 100);
                $table->string('input', 500)->nullable();
                $table->string('ip_address', 50);
                $table->integer('user_id')->default(0);
                $table->text('result')->nullable();
                $table->string('status', 20)->default('success');
                $table->text('error_message')->nullable();
                $table->timestamp('created_at')->useCurrent();
            });
        }

        // Create cache table
        if (!Capsule::schema()->hasTable('mod_CloudHost247_tools_cache')) {
            Capsule::schema()->create('mod_CloudHost247_tools_cache', function ($table) {
                $table->increments('id');
                $table->string('cache_key', 255)->unique();
                $table->longText('cache_value');
                $table->timestamp('expires_at');
                $table->timestamp('created_at')->useCurrent();
            });
        }

        // Create rate limit table
        if (!Capsule::schema()->hasTable('mod_CloudHost247_tools_rate_limit')) {
            Capsule::schema()->create('mod_CloudHost247_tools_rate_limit', function ($table) {
                $table->increments('id');
                $table->string('ip_address', 50);
                $table->integer('request_count')->default(0);
                $table->timestamp('window_start')->useCurrent();
            });
        }

        // Seed default tool statuses
        CloudHost247_tools_seed_tools();

        return [
            'status' => 'success',
            'description' => 'CloudHost247 Tools Platform activated successfully.',
        ];
    } catch (\Exception $e) {
        return [
            'status' => 'error',
            'description' => 'Failed to activate: ' . $e->getMessage(),
        ];
    }
}

/**
 * Module deactivation
 */
function CloudHost247_tools_deactivate()
{
    try {
        // Keep data by default - admin can manually drop tables if needed
        return [
            'status' => 'success',
            'description' => 'CloudHost247 Tools Platform deactivated. Database tables preserved.',
        ];
    } catch (\Exception $e) {
        return [
            'status' => 'error',
            'description' => 'Failed to deactivate: ' . $e->getMessage(),
        ];
    }
}

/**
 * Admin area output
 */
function CloudHost247_tools_output($vars)
{
    $moduleLink = $vars['modulelink'];
    $version = $vars['version'];
    $LANG = $vars['_lang'];

    $action = isset($_GET['action']) ? htmlspecialchars($_GET['action']) : 'dashboard';
    $tab = isset($_GET['tab']) ? htmlspecialchars($_GET['tab']) : '';

    // Include core classes and functions
    require_once __DIR__ . '/includes/functions.php';
    require_once __DIR__ . '/includes/classes.php';

    $adminController = new CloudHost247ToolsAdmin($vars);

    echo '<div class="CloudHost247-admin-wrapper">';
    echo $adminController->renderNavigation($action);

    switch ($action) {
        case 'tools':
            echo $adminController->renderToolsManager();
            break;
        case 'logs':
            echo $adminController->renderLogs();
            break;
        case 'settings':
            echo $adminController->renderSettings();
            break;
        case 'dashboard':
        default:
            echo $adminController->renderDashboard();
            break;
    }

    echo '</div>';
}

/**
 * Client area output
 */
function CloudHost247_tools_clientarea($vars)
{
    // Include core files
    require_once __DIR__ . '/includes/functions.php';
    require_once __DIR__ . '/includes/classes.php';

    $controller = new CloudHost247ToolsClient($vars);
    return $controller->handleRequest();
}

/**
 * Seed default tools into database
 */
function CloudHost247_tools_seed_tools()
{
    $tools = CloudHost247_tools_get_all_tools();

    foreach ($tools as $category => $categoryTools) {
        foreach ($categoryTools as $toolId => $toolData) {
            $exists = Capsule::table('mod_CloudHost247_tools_status')
                ->where('tool_id', $toolId)
                ->first();

            if (!$exists) {
                Capsule::table('mod_CloudHost247_tools_status')->insert([
                    'tool_id' => $toolId,
                    'tool_name' => $toolData['name'],
                    'category' => $category,
                    'enabled' => 1,
                    'created_at' => date('Y-m-d H:i:s'),
                    'updated_at' => date('Y-m-d H:i:s'),
                ]);
            }
        }
    }
}

/**
 * Get all available tools definition
 */
function CloudHost247_tools_get_all_tools()
{
    return [
        'dns' => [
            'spf_checker' => ['name' => 'SPF Record Checker', 'icon' => 'fa-shield-alt', 'desc' => 'Validate SPF records for email authentication'],
            'domain_dns_validation' => ['name' => 'Domain DNS Validation', 'icon' => 'fa-check-circle', 'desc' => 'Comprehensive DNS validation for domains'],
            'reverse_ip_lookup' => ['name' => 'Reverse IP Lookup', 'icon' => 'fa-exchange-alt', 'desc' => 'Find domains hosted on an IP address'],
            'dns_lookup' => ['name' => 'DNS Lookup', 'icon' => 'fa-server', 'desc' => 'Query A, AAAA, MX, TXT, NS records'],
            'cname_lookup' => ['name' => 'CNAME Lookup', 'icon' => 'fa-link', 'desc' => 'Check CNAME records'],
            'ns_lookup' => ['name' => 'NS Lookup', 'icon' => 'fa-network-wired', 'desc' => 'Find name servers for a domain'],
            'mx_lookup' => ['name' => 'MX Lookup', 'icon' => 'fa-envelope', 'desc' => 'Check mail exchange records'],
            'dns_propagation' => ['name' => 'DNS Propagation Checker', 'icon' => 'fa-globe', 'desc' => 'Check DNS propagation worldwide'],
            'dmarc_lookup' => ['name' => 'DMARC Lookup & Validator', 'icon' => 'fa-shield-alt', 'desc' => 'Validate DMARC records'],
            'dns_health' => ['name' => 'DNS Health Checker', 'icon' => 'fa-heartbeat', 'desc' => 'Overall DNS health assessment'],
            'dmarc_generator' => ['name' => 'DMARC Generator', 'icon' => 'fa-magic', 'desc' => 'Generate DMARC DNS records'],
            'dnskey_lookup' => ['name' => 'DNSKEY Lookup', 'icon' => 'fa-key', 'desc' => 'Query DNSSEC keys'],
            'ds_record_lookup' => ['name' => 'DS Record Lookup', 'icon' => 'fa-lock', 'desc' => 'Check Delegation Signer records'],
            'dkim_checker' => ['name' => 'DKIM Checker', 'icon' => 'fa-signature', 'desc' => 'Verify DKIM signatures'],
        ],
        'ip' => [
            'ping_ipv4' => ['name' => 'Ping IPv4', 'icon' => 'fa-broadcast-tower', 'desc' => 'Test IPv4 connectivity'],
            'ping_ipv6' => ['name' => 'Ping IPv6', 'icon' => 'fa-broadcast-tower', 'desc' => 'Test IPv6 connectivity'],
            'what_is_my_ip' => ['name' => 'What is My IP', 'icon' => 'fa-map-marker-alt', 'desc' => 'Display your current IP address'],
            'traceroute' => ['name' => 'Traceroute', 'icon' => 'fa-route', 'desc' => 'Trace network path to host'],
            'ip_location' => ['name' => 'IP Location Lookup', 'icon' => 'fa-globe-americas', 'desc' => 'Geolocate an IP address'],
            'email_header_analyzer' => ['name' => 'Email Header Analyzer', 'icon' => 'fa-envelope-open-text', 'desc' => 'Analyze email headers for routing info'],
            'ip_blacklist' => ['name' => 'IP Blacklist Checker', 'icon' => 'fa-ban', 'desc' => 'Check IP against multiple RBLs'],
            'ip_to_decimal' => ['name' => 'IP to Decimal', 'icon' => 'fa-calculator', 'desc' => 'Convert IP to decimal notation'],
            'ip_to_hostname' => ['name' => 'IP to Hostname', 'icon' => 'fa-desktop', 'desc' => 'Reverse DNS lookup'],
            'ip_whois' => ['name' => 'IP WHOIS', 'icon' => 'fa-info-circle', 'desc' => 'WHOIS lookup for IPv4 addresses'],
            'ipv6_whois' => ['name' => 'IPv6 WHOIS', 'icon' => 'fa-info-circle', 'desc' => 'WHOIS lookup for IPv6 addresses'],
            'ipv4_ipv6_converter' => ['name' => 'IPv4 ↔ IPv6 Converter', 'icon' => 'fa-exchange-alt', 'desc' => 'Convert between IPv4 and IPv6'],
            'ipv6_generator' => ['name' => 'IPv6 Generator', 'icon' => 'fa-random', 'desc' => 'Generate IPv6 addresses'],
            'ipv6_cidr' => ['name' => 'IPv6 CIDR Tools', 'icon' => 'fa-project-diagram', 'desc' => 'IPv6 subnet calculator'],
            'ipv6_compress' => ['name' => 'IPv6 Compress/Expand', 'icon' => 'fa-compress-alt', 'desc' => 'Compress or expand IPv6 addresses'],
            'subnet_calculator' => ['name' => 'Subnet Calculator', 'icon' => 'fa-calculator', 'desc' => 'Calculate IPv4 subnets'],
            'isp_checker' => ['name' => 'ISP Checker', 'icon' => 'fa-building', 'desc' => 'Find ISP for an IP address'],
            'domain_to_ip' => ['name' => 'Domain to IP', 'icon' => 'fa-arrow-right', 'desc' => 'Resolve domain to IP address'],
        ],
        'developer' => [
            'http_headers' => ['name' => 'HTTP Headers Checker', 'icon' => 'fa-heading', 'desc' => 'Check HTTP response headers'],
            'server_os_detector' => ['name' => 'Server OS Detector', 'icon' => 'fa-server', 'desc' => 'Detect server operating system'],
            'md5_base64' => ['name' => 'MD5/Base64 Generator', 'icon' => 'fa-fingerprint', 'desc' => 'Generate MD5 and Base64 hashes'],
            'multi_url_opener' => ['name' => 'Multi URL Opener', 'icon' => 'fa-external-link-alt', 'desc' => 'Open multiple URLs at once'],
            'smtp_test' => ['name' => 'SMTP Test', 'icon' => 'fa-paper-plane', 'desc' => 'Test SMTP server connectivity'],
            'htaccess_generator' => ['name' => '.htaccess Redirect Generator', 'icon' => 'fa-file-code', 'desc' => 'Generate redirect rules'],
            'url_rewrite' => ['name' => 'URL Rewrite Generator', 'icon' => 'fa-sync', 'desc' => 'Generate rewrite rules'],
            'broken_link_checker' => ['name' => 'Broken Link Checker', 'icon' => 'fa-unlink', 'desc' => 'Find broken links on a page'],
            'open_graph' => ['name' => 'Open Graph Generator', 'icon' => 'fa-share-alt', 'desc' => 'Generate Open Graph meta tags'],
            'raid_calculator' => ['name' => 'RAID Calculator', 'icon' => 'fa-hdd', 'desc' => 'Calculate RAID storage capacity'],
            'binary_text' => ['name' => 'Binary/Text Converter', 'icon' => 'fa-code', 'desc' => 'Convert between binary and text'],
            'json_formatter' => ['name' => 'JSON Viewer/Formatter', 'icon' => 'fa-code', 'desc' => 'Format and validate JSON'],
        ],
        'designer' => [
            'rgb_to_pantone' => ['name' => 'RGB → Pantone', 'icon' => 'fa-palette', 'desc' => 'Convert RGB to Pantone colors'],
            'hex_to_pantone' => ['name' => 'HEX → Pantone', 'icon' => 'fa-palette', 'desc' => 'Convert HEX to Pantone colors'],
            'cmyk_to_pantone' => ['name' => 'CMYK → Pantone', 'icon' => 'fa-palette', 'desc' => 'Convert CMYK to Pantone colors'],
            'hsv_to_pantone' => ['name' => 'HSV → Pantone', 'icon' => 'fa-palette', 'desc' => 'Convert HSV to Pantone colors'],
        ],
        'webmaster' => [
            'link_analyzer' => ['name' => 'Link Analyzer', 'icon' => 'fa-link', 'desc' => 'Analyze links on a webpage'],
            'user_agent' => ['name' => 'User Agent Checker', 'icon' => 'fa-user-secret', 'desc' => 'Check your browser user agent'],
            'pagerank' => ['name' => 'Google PageRank', 'icon' => 'fa-google', 'desc' => 'Check PageRank score (mock)'],
            'punycode' => ['name' => 'Punycode Converter', 'icon' => 'fa-language', 'desc' => 'Convert IDN domain encoding'],
            'serp_preview' => ['name' => 'SERP Preview Tool', 'icon' => 'fa-search', 'desc' => 'Preview how your page appears in search'],
            'robots_generator' => ['name' => 'Robots.txt Generator', 'icon' => 'fa-robot', 'desc' => 'Generate robots.txt rules'],
        ],
        'network' => [
            'port_checker' => ['name' => 'Port Checker (TCP)', 'icon' => 'fa-plug', 'desc' => 'Check if a TCP port is open'],
            'mac_lookup' => ['name' => 'MAC Address Lookup', 'icon' => 'fa-ethernet', 'desc' => 'Find vendor by MAC address'],
            'mac_generator' => ['name' => 'MAC Generator', 'icon' => 'fa-random', 'desc' => 'Generate random MAC addresses'],
            'asn_lookup' => ['name' => 'ASN Lookup', 'icon' => 'fa-globe', 'desc' => 'Lookup Autonomous System Number'],
        ],
        'security' => [
            'ssl_checker' => ['name' => 'SSL Checker', 'icon' => 'fa-lock', 'desc' => 'Check SSL certificate details'],
            'password_encryptor' => ['name' => 'Password Encryptor', 'icon' => 'fa-key', 'desc' => 'Encrypt passwords with various algorithms'],
            'password_generator' => ['name' => 'Password Generator', 'icon' => 'fa-random', 'desc' => 'Generate secure passwords'],
            'password_strength' => ['name' => 'Password Strength Checker', 'icon' => 'fa-shield-alt', 'desc' => 'Analyze password strength'],
        ],
        'productivity' => [
            'qr_generator' => ['name' => 'QR Generator', 'icon' => 'fa-qrcode', 'desc' => 'Generate QR codes'],
            'qr_scanner' => ['name' => 'QR Scanner', 'icon' => 'fa-camera', 'desc' => 'Scan QR codes via camera'],
            'lorem_ipsum' => ['name' => 'Lorem Ipsum Generator', 'icon' => 'fa-paragraph', 'desc' => 'Generate placeholder text'],
            'time_calculator' => ['name' => 'Time Calculator', 'icon' => 'fa-clock', 'desc' => 'Calculate time differences'],
            'bin_checker' => ['name' => 'BIN Checker', 'icon' => 'fa-credit-card', 'desc' => 'Check Bank Identification Number'],
            'credit_card_validator' => ['name' => 'Credit Card Validator', 'icon' => 'fa-credit-card', 'desc' => 'Validate card numbers (Luhn)'],
            'reverse_image_search' => ['name' => 'Reverse Image Search', 'icon' => 'fa-image', 'desc' => 'Search by image URL'],
            'username_checker' => ['name' => 'Username Checker', 'icon' => 'fa-user', 'desc' => 'Check username availability'],
            'online_notepad' => ['name' => 'Online Notepad', 'icon' => 'fa-sticky-note', 'desc' => 'Simple text notepad'],
            'small_text' => ['name' => 'Small Text Generator', 'icon' => 'fa-font', 'desc' => 'Generate tiny/small text'],
            'word_counter' => ['name' => 'Word Counter', 'icon' => 'fa-calculator', 'desc' => 'Count words and characters'],
            'domain_availability' => ['name' => 'Domain Availability Checker', 'icon' => 'fa-globe', 'desc' => 'Check if domain is available'],
            'rot13' => ['name' => 'ROT13 Tool', 'icon' => 'fa-sync', 'desc' => 'Encode/decode ROT13'],
            'morse_code' => ['name' => 'Morse Code Tool', 'icon' => 'fa-dots', 'desc' => 'Convert text to Morse code'],
            'bimi_checker' => ['name' => 'BIMI Checker', 'icon' => 'fa-envelope', 'desc' => 'Check BIMI email records'],
            'image_to_text' => ['name' => 'Image to Text (OCR)', 'icon' => 'fa-file-image', 'desc' => 'Extract text from images'],
        ],
        'gaming' => [
            'minecraft_colors' => ['name' => 'Minecraft Color Codes', 'icon' => 'fa-gamepad', 'desc' => 'Generate Minecraft color codes'],
        ],
    ];
}
