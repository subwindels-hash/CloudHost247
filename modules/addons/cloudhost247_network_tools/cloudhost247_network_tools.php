<?php
/**
 * CloudHost247 Network Tools — WHMCS addon module.
 *
 * Native DNS, IP, network, webmaster, security, domain, developer, productivity
 * and diagnostics tools, built into the CloudHost247 platform: the same client
 * accounts, the same admin RBAC and audit trail, the same API & Integrations
 * centre, the same theme and the same database.
 *
 * The module owns its tables (mod_cloudhost247_nt_*), its registry of tool
 * definitions and its resolver registry. It owns no credential: every external
 * API it uses is configured in the integrations centre and read through
 * ProviderBridge.
 */
if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\NetworkTools\Admin\AdminController;
use CloudHost247\NetworkTools\Admin\AdminView;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Core\Repository\ProviderRepository;
use CloudHost247\NetworkTools\Core\Repository\ResolverRepository;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Core\Repository\ToolStateRepository;
use CloudHost247\NetworkTools\Migrations\NetworkToolsInitialMigration;

const CH247_NETWORK_TOOLS_VERSION = '1.0.0';

function cloudhost247_network_tools_config()
{
    return array(
        'name' => 'CloudHost247 Network Tools',
        'description' => 'Native DNS, IP, network, webmaster, security, domain, developer, productivity and diagnostics tools with SSRF protection, per-IP/account rate limits, a resolver registry and a Super Admin control centre. Credentials stay in the API & Integrations centre.',
        'version' => CH247_NETWORK_TOOLS_VERSION,
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(
            'api_token' => array(
                'FriendlyName' => 'REST API Token',
                'Type' => 'text',
                'Size' => '64',
                'Default' => '',
                'Description' => 'Token for modules/addons/cloudhost247_network_tools/api/index.php, sent as X-API-Token or Authorization: Bearer. Leave empty to keep the REST API disabled. Use at least 32 random characters; the value is compared in constant time and is never logged.',
            ),
            'terms_notice' => array(
                'FriendlyName' => 'Usage notice',
                'Type' => 'textarea',
                'Size' => '4',
                'Rows' => '4',
                'Default' => 'Every tool reports only what the network actually answered. When a capability is missing (for example raw ICMP on a shared host) or a provider is not configured, the tool says so instead of returning a guess.',
                'Description' => 'Shown on the tools dashboard. It is not a setting; edit it to explain your own acceptable-use policy.',
            ),
        ),
    );
}

function cloudhost247_network_tools_activate()
{
    try {
        $applied = (new MigrationRunner())->run('cloudhost247_network_tools', array(new NetworkToolsInitialMigration()));
        $seed = cloudhost247_network_tools_seed();
        $description = 'Network Tools installed. Migrations applied: ' . ($applied ? implode(', ', $applied) : 'already current') . '. '
            . $seed['tools'] . ' tool row(s) added, ' . $seed['resolvers'] . ' resolver(s) added, ' . $seed['providers'] . ' provider row(s) added. '
            . 'Resolver health and provider health are checked by the WHMCS cron (crons/cloudhost247_network_tools.php).';
        if (!extension_loaded('curl')) {
            $description .= ' IMPORTANT: the PHP cURL extension is missing, so every tool that fetches a URL reports SERVICE_UNAVAILABLE until it is enabled.';
        }
        if (!function_exists('openssl_x509_parse')) {
            $description .= ' The PHP OpenSSL extension is missing, so the SSL checker and HTTPS fetches are unavailable.';
        }
        return array('status' => 'success', 'description' => $description);
    } catch (\Throwable $error) {
        return array('status' => 'error', 'description' => $error->getMessage());
    }
}

function cloudhost247_network_tools_deactivate()
{
    return array(
        'status' => 'success',
        'description' => 'Data retained: tool settings, favourites, history, reports, monitors and the resolver registry all remain in place, and no external service was contacted or changed. URLs under /tools stop working while the addon is inactive.',
    );
}

function cloudhost247_network_tools_upgrade()
{
    return cloudhost247_network_tools_activate();
}

/**
 * Seed the registry-backed rows. Every seed is additive and idempotent: an
 * existing row (including one an administrator edited) is never overwritten.
 */
function cloudhost247_network_tools_seed()
{
    $tools = 0;
    $resolvers = 0;
    $providers = 0;
    try {
        $definitions = array();
        foreach (ToolRegistry::all() as $definition) {
            $definitions[$definition->slug()] = $definition->toArray();
        }
        $tools = (new ToolStateRepository())->seed($definitions);
    } catch (\Throwable $toolsUnavailable) {
        $tools = 0;
    }
    try {
        $resolvers = (new ResolverRepository())->seed();
    } catch (\Throwable $resolversUnavailable) {
        $resolvers = 0;
    }
    try {
        $providers = (new ProviderRepository())->seed();
    } catch (\Throwable $providersUnavailable) {
        $providers = 0;
    }
    return array('tools' => $tools, 'resolvers' => $resolvers, 'providers' => $providers);
}

function cloudhost247_network_tools_output($vars)
{
    $link = isset($vars['modulelink']) ? (string) $vars['modulelink'] : 'addonmodules.php?module=cloudhost247_network_tools';
    $data = (new AdminController())->handle();
    echo (new AdminView($link))->render($data);
}

function cloudhost247_network_tools_clientarea($vars)
{
    // The tools UI is served by the root front controller (tools.php) so it can
    // render inside the client theme with full navigation. Nothing is served
    // from a module URL, which keeps a single canonical route.
    return array(
        'pagetitle' => 'Network Tools',
        'templatefile' => 'cloudhost247-tools',
        'requirelogin' => false,
        'forcessl' => true,
        'vars' => array('ch247Tools' => array('available' => false, 'reason' => 'Open /tools to use the tools platform.')),
    );
}
