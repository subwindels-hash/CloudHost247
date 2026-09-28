<?php
/**
 * CloudHost247 API & Integrations.
 *
 * Single Super Admin control centre for every external API the platform calls.
 * Provider definitions live in the registry, credentials are stored encrypted,
 * and connection tests run server-side and report only safe classifications.
 */
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use CloudHost247\Foundation\Database\MigrationRunner;
use CloudHost247\Integrations\Migrations\IntegrationsInitialMigration;
use CloudHost247\Integrations\Security\MasterKey;
use CloudHost247\Integrations\Services\AdminController;
use CloudHost247\Integrations\Services\AdminView;
use CloudHost247\Integrations\Support\Environment;

function cloudhost247_integrations_config()
{
    return array(
        'name' => 'CloudHost247 API & Integrations',
        'description' => 'Central Super Admin centre for every external API: provider registry, encrypted credentials, environment separation, server-side connection testing and a real health dashboard.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_integrations_activate()
{
    try {
        $applied = (new MigrationRunner())->run('cloudhost247_integrations', array(new IntegrationsInitialMigration()));
        $description = 'API & Integrations installed. Applied: ' . ($applied ? implode(', ', $applied) : 'already current') . '.';
        if (!MasterKey::available()) {
            $description .= ' IMPORTANT: set the ' . MasterKey::ENV_VARIABLE . ' environment variable (32 or more random bytes) before storing any API credential; credential encryption is unavailable until then.';
        }
        $description .= ' Current platform environment: ' . strtoupper(Environment::active()) . ' (' . Environment::source() . ').';
        return array('status' => 'success', 'description' => $description);
    } catch (\Throwable $error) {
        return array('status' => 'error', 'description' => $error->getMessage());
    }
}

function cloudhost247_integrations_deactivate()
{
    return array(
        'status' => 'success',
        'description' => 'Data retained. Integration configuration, encrypted credentials and connection history remain in place; no provider account was contacted or changed.',
    );
}

function cloudhost247_integrations_output($vars)
{
    $link = isset($vars['modulelink']) ? (string) $vars['modulelink'] : 'addonmodules.php?module=cloudhost247_integrations';
    $data = (new AdminController())->handle();
    echo (new AdminView($link))->render($data);
}
